// Boredom Blaster game logic. Plain script (no import/export) so index.html works from file://;
// the tests load it in Node and read globalThis.BB.
(function (root) {
  const W = 480, H = 640;
  const TRAY_H = 0; // no tray: the controls float over the playfield
  const PLAY_H = H;
  const HUD_H = 64; // top bar
  const SHIP = { w: 28, h: 20, speed: 280, y: PLAY_H - 50 };
  const BULLET = { w: 4, h: 12, speed: 520, cooldown: 0.25 };
  const DRONE = { w: 28, h: 20, gapX: 44, gapY: 36, points: 10 };
  const SHIP_MIN_Y = HUD_H; // the ship goes anywhere below the top bar
  const SPECIAL = { w: 40, h: 16, speed: 420, cooldown: 6 };
  const KABOOM = { killsPerCharge: 10, maxCharges: 3, targets: 5 };
  const START_LIVES = 3;
  const MAX_LIVES = 9;
  const INVULN = 1.5;

  const PIERCE_DAMAGE = 5; // the special shot hurts each enemy once, so mini-bosses take 5 of their HP
  const KABOOM_BOSS_DAMAGE = 10;
  const BOSS_TOUCH_INVULN = INVULN / 3;

  const R = () => root.BBRewards; // src/rewards.js, loaded before the game is created
  const E = () => root.BBEnemies; // src/enemies.js, loaded before the game is created
  const K = () => root.BBSkills; // src/skills.js, loaded right behind this file
  const LASER = { duration: 1.5, cooldown: 6, tick: 0.1, damage: 1, bossDamage: 2, w: 10, gap: 36 };
  const MOON = { r: 8, orbit: 46, speed: 2.4, bossDamage: 5, bossGap: 0.5 };
  const BEND = { radius: 30, accel: 900 }; // ULTRA-MAD Magneto bends enemy bullets near the ship

  function hit(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function spawnWave(game) {
    const script = E().waveScript(game.wave);
    const { cols, rows } = script.drones;
    const left = (W - (cols - 1) * DRONE.gapX - DRONE.w) / 2;
    game.drones = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        game.drones.push(E().createEnemy(game, "drone", left + c * DRONE.gapX, HUD_H + 10 + r * DRONE.gapY));
      }
    }
    game.drones.push(...E().spawnEnemies(game, script));
    game.dir = 1;
    regrowMoons(game); // broken moons grow back at the next wave
  }

  // ---- moons ----
  function regrowMoons(game) {
    const S = K(), t = S.tier(game, "moons");
    game.moons = Array.from({ length: S.moonCount(t) }, () => ({ hp: S.moonHits(t), max: S.moonHits(t), cd: 0 }));
  }
  function moonPos(game, i) {
    const n = game.moons.length, a = game.moonAngle + (i * Math.PI * 2) / n;
    return {
      x: game.ship.x + game.ship.w / 2 + Math.cos(a) * MOON.orbit - MOON.r,
      y: game.ship.y + game.ship.h / 2 + Math.sin(a) * MOON.orbit - MOON.r,
      w: MOON.r * 2, h: MOON.r * 2,
    };
  }
  // an upgrade adds moons (and refreshes the hits of the ones that exist) at once
  function syncMoons(game) {
    const S = K(), t = S.tier(game, "moons"), hits = S.moonHits(t);
    while (game.moons.length < S.moonCount(t)) game.moons.push({ hp: hits, max: hits, cd: 0 });
    for (const m of game.moons) if (m.max !== hits) { m.max = hits; m.hp = hits; }
  }
  function stepMoons(game, dt) {
    syncMoons(game);
    game.moonAngle = (game.moonAngle + MOON.speed * dt) % (Math.PI * 2);
    game.moons.forEach((m, i) => {
      m.cd = Math.max(0, m.cd - dt);
      if (m.hp <= 0) return;
      const box = moonPos(game, i);
      for (const eb of game.enemyBullets) {
        if (m.hp > 0 && !eb.dead && hit(eb, box)) { eb.dead = true; m.hp -= 1; }
      }
      for (const e of game.drones) {
        if (m.hp <= 0 || e.dead || !hit(e, box)) continue;
        if (e.boss) {
          if (m.cd > 0) continue;
          m.cd = MOON.bossGap;
          hurt(game, e, MOON.bossDamage);
        } else hurt(game, e, Infinity);
        m.hp -= 1;
      }
    });
    game.enemyBullets = game.enemyBullets.filter((eb) => !eb.dead);
  }

  // ---- laser ----
  function laser(game) {
    if (game.status !== "playing" || game.paused || K().tier(game, "laser") <= 0 || game.laserCooldown > 0 || game.laserBeam) return false;
    game.laserBeam = { time: LASER.duration, acc: 0, cols: laserColumns(game), reach: [] };
    game.laserCooldown = LASER.cooldown;
    return true;
  }
  function laserColumns(game) {
    const S = K(), n = S.laserBeams(S.tier(game, "laser")), cx = game.ship.x + game.ship.w / 2;
    return Array.from({ length: n }, (_, i) => cx + (i - (n - 1) / 2) * LASER.gap);
  }
  // the beam goes straight up; each tick it damages the nearest `crosses` enemies in every column
  function stepLaser(game, dt) {
    game.laserCooldown = Math.max(0, game.laserCooldown - dt);
    const beam = game.laserBeam;
    if (!beam) return;
    const crosses = K().laserCrosses(K().tier(game, "laser"));
    beam.time -= dt; beam.acc += dt;
    beam.cols = laserColumns(game);
    while (beam.acc >= LASER.tick - 1e-9) {
      beam.acc -= LASER.tick;
      beam.reach = beam.cols.map((cx) => {
        const hits = game.drones.filter((e) => !e.dead && e.x < cx + LASER.w / 2 && e.x + e.w > cx - LASER.w / 2 && e.y + e.h <= game.ship.y)
          .sort((a, b) => b.y - a.y).slice(0, crosses);
        for (const e of hits) hurt(game, e, e.boss ? LASER.bossDamage : LASER.damage);
        return hits.length === crosses ? Math.min(...hits.map((e) => e.y)) : 0; // where a limited beam ends (0 = the top)
      });
    }
    if (beam.time <= 1e-9) game.laserBeam = null;
  }

  // ---- twin ship ----
  function twinRect(game) {
    const s = game.ship, off = R().TWIN.offset;
    return { x: s.x + off + s.w > W ? s.x - off : s.x + off, y: s.y, w: s.w, h: s.h };
  }
  // Calls the twin ship (spends a charge); it flies 15 s or until it takes one hit.
  function twin(game) {
    if (game.status !== "playing" || game.paused || game.twinCharges <= 0 || game.twin) return false;
    game.twinCharges -= 1;
    game.twin = { life: R().TWIN.duration };
    return true;
  }
  function twinHit(game) { // it leaves in a flash
    game.twinFlash = { ...twinRect(game), life: 0.3 };
    game.twin = null;
  }

  // opts.rng: optional seeded random source (tests); defaults to Math.random
  function createGame(opts) {
    const game = {
      w: W, h: H,
      ship: { x: (W - SHIP.w) / 2, y: SHIP.y, w: SHIP.w, h: SHIP.h },
      bullets: [], drones: [], enemyBullets: [],
      score: 0, lives: START_LIVES, wave: 1,
      cooldown: 0, invuln: 0, dir: 1,
      specialCooldown: 0, laserCooldown: 0, laserBeam: null, moonAngle: 0, moons: [], twinFlash: null, kills: 0, kaboomCharges: 0, paused: false,
      status: "playing", // "playing" | "over"
    };
    if (opts && opts.rng) game.rng = opts.rng;
    R().initRewards(game);
    spawnWave(game);
    return game;
  }

  function shoot(game) {
    if (game.status !== "playing" || game.cooldown > 0) return false;
    const S = K(), tr = (id) => S.tier(game, id);
    const w = BULLET.w * S.widthMult(tr("larger")), h = BULLET.h * S.sizeMult(tr("larger"));
    const speed = BULLET.speed * S.bulletSpeed(tr("faster"));
    const origins = [game.ship];
    if (game.twin) origins.push(twinRect(game)); // the twin fires the full pattern too
    for (const o of origins) {
      for (const v of S.volley(tr("more"))) {
        game.bullets.push({
          x: o.x + (o.w - w) / 2 + v.dx,
          y: v.dir < 0 ? o.y - h : o.y + o.h,
          w, h, speed, vx: Math.sin(v.angle) * speed, dir: v.dir,
          pierces: S.pierce(tr("larger")), trail: S.hasTrails(tr("faster")),
          tier: S.highestTier(game),
        });
      }
    }
    game.cooldown = BULLET.cooldown / R().fireRateMult(game);
    return true;
  }

  // Special: a wide piercing shot, one every SPECIAL.cooldown seconds.
  function special(game) {
    if (game.status !== "playing" || game.paused || game.specialCooldown > 0) return false;
    game.bullets.push({
      x: game.ship.x + (game.ship.w - SPECIAL.w) / 2,
      y: game.ship.y - SPECIAL.h,
      w: SPECIAL.w, h: SPECIAL.h, pierce: true,
    });
    game.specialCooldown = SPECIAL.cooldown;
    return true;
  }

  const isFormation = (e) => !e.pattern || e.pattern === "formation";
  const pointsOf =(e) => e.points || DRONE.points;

  // points for one enemy, with Score per hit; ULTRA-MAD also floats red points
  function award(game, e) {
    const tier = K().tier(game, "score");
    const pts = Math.round(pointsOf(e) * K().scoreMult(tier));
    game.score += pts;
    if (tier < K().ULTRA) return;
    game.pops = (game.pops || []).slice(-19);
    game.pops.push({ x: e.x + e.w / 2, y: e.y, text: "+" + pts, life: 0.8, max: 0.8 });
  }

  function addKill(game, drone) {
    award(game, drone);
    game.kills += 1;
    if (drone) R().onKill(game, drone.x + drone.w / 2, drone.y);
    if (game.kills % KABOOM.killsPerCharge === 0) {
      game.kaboomCharges = Math.min(KABOOM.maxCharges, game.kaboomCharges + 1);
    }
  }

  // An enemy dies: scored (kaboom kills do not count toward charges or drops), splitters split,
  // mini-bosses always drop a capsule.
  function destroy(game, e, byKaboom) {
    e.dead = true;
    if (byKaboom) award(game, e);
    else addKill(game, e);
    if (e.boss) R().onMiniBossKill(game, e.x + e.w / 2, e.y + e.h);
    if (!byKaboom) game.drones.push(...E().splitChildren(game, e));
  }

  function hurt(game, e, amount, byKaboom) {
    if (!e.dead && E().damage(e, amount)) destroy(game, e, byKaboom);
  }

  // Kaboom: spend a charge to destroy the 5 drones nearest the ship (scored, but they do not recharge it).
  function kaboom(game) {
    if (game.status !== "playing" || game.paused || game.kaboomCharges <= 0) return false;
    const cx = game.ship.x + game.ship.w / 2, cy = game.ship.y + game.ship.h / 2;
    const dist = (d) => Math.hypot(d.x + d.w / 2 - cx, d.y + d.h / 2 - cy);
    const doomed = new Set([...game.drones].sort((a, b) => dist(a) - dist(b)).slice(0, KABOOM.targets));
    for (const d of doomed) hurt(game, d, d.boss ? KABOOM_BOSS_DAMAGE : Infinity, true);
    game.drones = game.drones.filter((d) => !d.dead);
    game.kaboomCharges -= 1;
    return true;
  }

  function addLife(game) {
    if (game.lives >= MAX_LIVES) return false;
    game.lives += 1;
    return true;
  }

  function togglePause(game) {
    if (game.status !== "playing") return false;
    game.paused = !game.paused;
    return game.paused;
  }

  function loseLife(game) {
    game.lives -= 1;
    game.invuln = INVULN;
    R().onLifeLost(game);
    if (game.lives <= 0) {
      game.lives = 0;
      game.status = "over";
    }
  }

  // Movement as a 2D vector of length <= 1: analog mx/my (joystick) or left/right/up/down booleans.
  function moveVector(input) {
    let x = input.mx || 0, y = input.my || 0;
    if (!x && !y) {
      x = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      y = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    }
    const len = Math.hypot(x, y);
    return len > 1 ? { x: x / len, y: y / len } : { x, y };
  }

  // ULTRA-MAD Magneto: enemy bullets within 30 px of the ship are bent away from it
  function bendBullets(game, dt) {
    if (K().tier(game, "magneto") < K().ULTRA) return;
    const cx = game.ship.x + game.ship.w / 2, cy = game.ship.y + game.ship.h / 2;
    for (const b of game.enemyBullets) {
      const dx = b.x + b.w / 2 - cx, dy = b.y + b.h / 2 - cy;
      if (Math.hypot(dx, dy) < BEND.radius) b.vx += (dx >= 0 ? 1 : -1) * BEND.accel * dt;
    }
  }

  // input: { mx, my (analog -1..1) or left, right, up, down, fire }; dt in seconds
  function update(game, dt, input) {
    if (game.status !== "playing" || game.paused) return;
    input = input || {};
    dt *= K().timeScale(game); // the skill picker slows the game to 15 %
    if (game.pops) game.pops = game.pops.map((p) => ({ ...p, y: p.y - 30 * dt, life: p.life - dt })).filter((p) => p.life > 0);
    const move = moveVector(input);
    game.ship.x = Math.max(0, Math.min(W - game.ship.w, game.ship.x + move.x * SHIP.speed * dt));
    game.ship.y = Math.max(SHIP_MIN_Y, Math.min(PLAY_H - game.ship.h, game.ship.y + move.y * SHIP.speed * dt));
    game.cooldown = Math.max(0, game.cooldown - dt);
    game.specialCooldown = Math.max(0, game.specialCooldown - dt);
    game.invuln = Math.max(0, game.invuln - dt);
    R().updateTimers(game, dt);
    R().updateCapsules(game, dt, hit, H);
    const queued = root.BBInput && root.BBInput.takeActions ? root.BBInput.takeActions() : {};
    if (input.laser || queued.laser) laser(game);
    if (input.twin || queued.twin) twin(game);
    if (game.twin) { game.twin.life -= dt; if (game.twin.life <= 0) game.twin = null; }
    if (game.twinFlash) { game.twinFlash.life -= dt; if (game.twinFlash.life <= 0) game.twinFlash = null; }
    if (input.fire) shoot(game);
    bendBullets(game, dt);

    E().updateEnemies(game, dt);
    E().moveBullets(game, dt);
    game.enemyBullets = game.enemyBullets.filter((b) => b.y < PLAY_H); // shots stop at the bottom edge
    for (const b of game.bullets) {
      b.y += (b.dir || -1) * (b.speed || (b.pierce ? SPECIAL.speed : BULLET.speed)) * dt;
      if (b.vx) b.x += b.vx * dt;
    }
    game.bullets = game.bullets.filter((b) => b.y + b.h > 0 && b.y < PLAY_H && b.x + b.w > 0 && b.x < W);

    // formation drones sweep sideways, drop half a row at each edge; faster with the wave, the cycle
    // and as the swarm thins. The other species move on their own patterns (enemies.js).
    const formation = game.drones.filter(isFormation);
    const speed = (50 + game.wave * 12 + (40 - Math.min(formation.length, 40)) * 2) * E().speedMult(game.wave);
    // the formation moves as one rigid block: the shift is cut at the wall so spacing never changes
    if (formation.length) {
      let dx = game.dir * speed * dt;
      const minX = Math.min(...formation.map((d) => d.x));
      const maxR = Math.max(...formation.map((d) => d.x + d.w));
      let edge = false;
      if (dx < 0 && minX + dx <= 0) { dx = -minX; edge = true; }
      else if (dx > 0 && maxR + dx >= W) { dx = W - maxR; edge = true; }
      for (const d of formation) d.x += dx;
      if (edge) {
        game.dir = -game.dir;
        for (const d of formation) d.y += DRONE.gapY / 2;
      }
    }

    // bullets vs enemies: 1 damage each; the special pierces and hurts each enemy once
    for (const b of game.bullets) {
      if (b.pierce) {
        b.struck = b.struck || new Set();
        for (const d of [...game.drones]) {
          if (d.dead || b.struck.has(d) || !hit(b, d)) continue;
          b.struck.add(d);
          hurt(game, d, PIERCE_DAMAGE);
        }
        continue;
      }
      b.struck = b.struck || new Set();
      const d = game.drones.find((e) => !e.dead && !b.struck.has(e) && hit(b, e));
      if (d) {
        b.struck.add(d);
        if (b.pierces > 0) b.pierces -= 1; // a Larger shots bullet passes through
        else b.dead = true;
        hurt(game, d, 1);
      }
    }
    game.bullets = game.bullets.filter((b) => !b.dead);
    stepLaser(game, dt);
    stepMoons(game, dt);
    game.drones = game.drones.filter((d) => !d.dead);

    // the twin takes the first hit (a shot or a touch) and leaves
    if (game.twin) {
      const box = twinRect(game), eb = game.enemyBullets.find((b) => hit(b, box)), touch = game.drones.find((d) => hit(d, box));
      if (eb) eb.dead = true;
      if (touch && !touch.boss) touch.dead = true;
      if (eb || touch) twinHit(game);
      game.enemyBullets = game.enemyBullets.filter((b) => !b.dead);
      game.drones = game.drones.filter((d) => !d.dead);
    }

    // enemy shots hit the ship (during invulnerability the shot is just removed)
    for (const eb of game.enemyBullets) {
      if (!hit(eb, game.ship)) continue;
      eb.dead = true;
      if (game.invuln <= 0 && game.status === "playing" && !R().absorbHit(game)) loseLife(game);
    }
    game.enemyBullets = game.enemyBullets.filter((eb) => !eb.dead);

    // enemies touching the ship cost a life (mini-bosses stay); formation drones at the floor too
    for (const d of game.drones) {
      if (R().hitEscort(game, d, hit)) { if (!d.boss) d.dead = true; continue; }
      const touch = game.invuln <= 0 && hit(d, game.ship);
      if (touch || (isFormation(d) && d.y + d.h >= PLAY_H)) {
        if (!d.boss) d.dead = true;
        if (game.invuln <= 0 && game.status === "playing" && !R().absorbHit(game)) loseLife(game);
        if (d.boss) game.invuln = Math.max(game.invuln, BOSS_TOUCH_INVULN);
      }
    }
    game.drones = game.drones.filter((d) => !d.dead);

    if (game.status === "playing" && game.drones.length === 0) {
      game.wave += 1;
      game.bullets = [];
      game.enemyBullets = [];
      spawnWave(game);
    }
  }

  function restart() {
    return createGame();
  }

  root.BB = { R, E, PIERCE_DAMAGE, K, W, H, PLAY_H, TRAY_H, HUD_H, SHIP, SHIP_MIN_Y, SPECIAL, KABOOM, special, laser, twin, twinRect, laserColumns, moonPos, LASER, MOON, BEND, kaboom, togglePause, addLife, BULLET, DRONE, START_LIVES, MAX_LIVES, createGame, shoot, update, restart, hit };
})(globalThis);

// index.html does not list enemies.js: pull it in right behind game.js, before main.js runs.
if (!globalThis.BBEnemies && typeof document !== "undefined" && document.currentScript) {
  document.write('<script src="' + document.currentScript.src.replace(/game\.js(\?.*)?$/, "enemies.js") + '"><\/script>');
}
if (!globalThis.BBSkills && typeof document !== "undefined" && document.currentScript) {
  document.write('<script src="' + document.currentScript.src.replace(/game\.js(\?.*)?$/, "skills.js") + '"><\/script>');
}
