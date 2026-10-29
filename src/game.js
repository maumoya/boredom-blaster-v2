// Boredom Blaster game logic. Plain script (no import/export) so index.html works from file://;
// the tests load it in Node and read globalThis.BB.
(function (root) {
  const W = 480, H = 640;
  const SHIP = { w: 28, h: 20, speed: 280, y: H - 50 };
  const BULLET = { w: 4, h: 12, speed: 520, cooldown: 0.25 };
  const DRONE = { w: 28, h: 20, gapX: 44, gapY: 36, points: 10 };
  const SHIP_MIN_Y = H * 0.55; // the ship lives in the lower 45% of the screen
  const SPECIAL = { w: 40, h: 16, speed: 420, cooldown: 6 };
  const KABOOM = { killsPerCharge: 10, maxCharges: 3, targets: 5 };
  const START_LIVES = 3;
  const INVULN = 1.5;

  const PIERCE_DAMAGE = 5; // the special shot hurts each enemy once, so mini-bosses take 5 of their HP
  const KABOOM_BOSS_DAMAGE = 10;
  const BOSS_TOUCH_INVULN = INVULN / 3;

  const R = () => root.BBRewards; // src/rewards.js, loaded before the game is created
  const E = () => root.BBEnemies; // src/enemies.js, loaded before the game is created

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
        game.drones.push(E().createEnemy(game, "drone", left + c * DRONE.gapX, 50 + r * DRONE.gapY));
      }
    }
    game.drones.push(...E().spawnEnemies(game, script));
    game.dir = 1;
  }

  // opts.rng: optional seeded random source (tests); defaults to Math.random
  function createGame(opts) {
    const game = {
      w: W, h: H,
      ship: { x: (W - SHIP.w) / 2, y: SHIP.y, w: SHIP.w, h: SHIP.h },
      bullets: [], drones: [], enemyBullets: [],
      score: 0, lives: START_LIVES, wave: 1,
      cooldown: 0, invuln: 0, dir: 1,
      specialCooldown: 0, kills: 0, kaboomCharges: 0, paused: false,
      status: "playing", // "playing" | "over"
    };
    if (opts && opts.rng) game.rng = opts.rng;
    R().initRewards(game);
    spawnWave(game);
    return game;
  }

  function shoot(game) {
    if (game.status !== "playing" || game.cooldown > 0) return false;
    for (const dx of R().weaponShots(game.weaponLevel)) {
      game.bullets.push({
        x: game.ship.x + (game.ship.w - BULLET.w) / 2 + dx,
        y: game.ship.y - BULLET.h,
        w: BULLET.w, h: BULLET.h,
      });
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

  function addKill(game, drone) {
    game.score += pointsOf(drone);
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
    if (byKaboom) game.score += pointsOf(e);
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

  // input: { mx, my (analog -1..1) or left, right, up, down, fire }; dt in seconds
  function update(game, dt, input) {
    if (game.status !== "playing" || game.paused) return;
    input = input || {};
    const move = moveVector(input);
    game.ship.x = Math.max(0, Math.min(W - game.ship.w, game.ship.x + move.x * SHIP.speed * dt));
    game.ship.y = Math.max(SHIP_MIN_Y, Math.min(H - game.ship.h, game.ship.y + move.y * SHIP.speed * dt));
    game.cooldown = Math.max(0, game.cooldown - dt);
    game.specialCooldown = Math.max(0, game.specialCooldown - dt);
    game.invuln = Math.max(0, game.invuln - dt);
    R().updateTimers(game, dt);
    R().updateCapsules(game, dt, hit, H);
    if (input.fire) shoot(game);

    E().updateEnemies(game, dt);
    E().moveBullets(game, dt);
    for (const b of game.bullets) b.y -= (b.pierce ? SPECIAL.speed : BULLET.speed) * dt;
    game.bullets = game.bullets.filter((b) => b.y + b.h > 0);

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
      const d = game.drones.find((e) => !e.dead && hit(b, e));
      if (d) {
        b.dead = true;
        hurt(game, d, 1);
      }
    }
    game.bullets = game.bullets.filter((b) => !b.dead);
    game.drones = game.drones.filter((d) => !d.dead);

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
      if (touch || (isFormation(d) && d.y + d.h >= H)) {
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

  root.BB = { R, E, PIERCE_DAMAGE, W, H, SHIP, SHIP_MIN_Y, SPECIAL, KABOOM, special, kaboom, togglePause, BULLET, DRONE, START_LIVES, createGame, shoot, update, restart, hit };
})(globalThis);

// index.html does not list enemies.js: pull it in right behind game.js, before main.js runs.
if (!globalThis.BBEnemies && typeof document !== "undefined" && document.currentScript) {
  document.write('<script src="' + document.currentScript.src.replace(/game\.js(\?.*)?$/, "enemies.js") + '"><\/script>');
}
