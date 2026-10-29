// Boredom Blaster enemies: five species, two mini-bosses, Catmull-Rom entry paths, movement
// patterns, wave scripts (waves 1-11, then the cycle repeats faster) and enemy fire.
// Plain script; game.js calls it through globalThis.BBEnemies. Randomness comes from game.rng.
(function (root) {
  const FIELD = { w: 480, h: root.BB_FIELD_H || 640 };
  const EDGE = 24; // non-formation enemies never go closer than this to the left/right wall
  const CYCLE_LENGTH = 11;
  const CYCLE_SPEEDUP = 0.2; // each finished cycle makes everything 20% faster
  const CYCLE_FIREUP = 0.25; // ...and lets every shooter fire 25% more often
  const ENEMY_BULLET = { w: 6, h: 10, speed: 200 };
  const FIRE = { firstWave: 2, start: 0.08, perWave: 0.04, max: 0.35 }; // shots/s per shooter, by wave
  const WANDER = { speed: 70, minY: 40, maxY: 300, turnMin: 0.6, turnMax: 1.4 };
  const DASH = { speed: 380, wait: 1.2, sink: 20, maxY: 200 };
  const DIVE = { duration: 2, swoop: 60 };
  const ORBIT = { rx: 140, ry: 50, omega: 0.9, cy: 110 };
  const ENTRY_TIME = 1.6;
  const SPAWN_STAGGER = 0.3;

  // pattern: formation | sine | zigzag | dive | wander | orbit | dash
  // fireShare: fraction of the wave's fire rate; fireEvery: fixed seconds between shots (bosses)
  const SPECIES = {
    drone: { pattern: "formation", w: 28, h: 20, hp: 1, points: 10, fireShare: 0.08 },
    wasp: { pattern: "sine", w: 26, h: 18, hp: 1, points: 15, fireShare: 0.6, sway: 40, homeY: 110, lane: 40 },
    viper: { pattern: "zigzag", w: 26, h: 18, hp: 1, points: 20, fireShare: 0.6, sway: 55, homeY: 90, lane: 40 },
    diver: { pattern: "dive", w: 24, h: 24, hp: 2, points: 25, fireShare: 0, sway: 0, homeY: 80, lane: 30 },
    splitter: { pattern: "wander", w: 34, h: 26, hp: 3, points: 30, fireShare: 0.6, sway: 0, homeY: 110, lane: 40 },
    splitling: { pattern: "wander", w: 16, h: 12, hp: 1, points: 5, fireShare: 0 },
    orbiter: { pattern: "orbit", w: 64, h: 40, hp: 40, points: 200, boss: true, fireEvery: 1.1 },
    dasher: { pattern: "dash", w: 72, h: 36, hp: 60, points: 400, boss: true, fireEvery: 1.6 },
  };
  const BOSSES = { orbiter: SPECIES.orbiter, dasher: SPECIES.dasher };

  // wave in cycle -> drone grid and extra groups; drones use the original grid size growth
  const WAVE_SCRIPTS = {
    1: { drones: [5, 2], groups: [] },
    2: { drones: [6, 2], groups: [["wasp", 4]] },
    3: { drones: [6, 2], groups: [["viper", 4]] },
    4: { drones: [6, 2], groups: [["diver", 3]] },
    5: { drones: [5, 1], groups: [["orbiter", 1]] },
    6: { drones: [6, 2], groups: [["splitter", 3]] },
    7: { drones: [6, 2], groups: [["wasp", 4], ["viper", 4]] },
    8: { drones: [6, 2], groups: [["diver", 3], ["splitter", 3]] },
    9: { drones: [7, 2], groups: [["wasp", 3], ["viper", 3], ["diver", 3], ["splitter", 2]] },
    10: { drones: [5, 1], groups: [["dasher", 1], ["wasp", 4]] },
    11: { drones: [8, 3], groups: [["wasp", 4], ["viper", 4], ["diver", 4], ["splitter", 3]] },
  };

  // Every world (100 waves) starts the ramp again from its own wave 1; each later world is 10 % faster
  // and its wave 100 is the world boss (both bosses, tougher each world).
  const WAVES_PER_WORLD = 100;
  const WORLD_SPEEDUP = 0.1;
  const WORLD_BOSS = { drones: [6, 2], groups: [["orbiter", 1], ["dasher", 1], ["wasp", 4]] };
  const worldIndex = (wave) => Math.floor((Math.max(1, Math.floor(wave) || 1) - 1) / WAVES_PER_WORLD);
  const waveInWorld = (wave) => ((Math.max(1, Math.floor(wave) || 1) - 1) % WAVES_PER_WORLD) + 1;
  const worldBossHp = (wave) => 2 + worldIndex(wave); // x HP of a world boss

  const cycleOf = (wave) => Math.floor((waveInWorld(wave) - 1) / CYCLE_LENGTH);
  const waveInCycle = (wave) => ((waveInWorld(wave) - 1) % CYCLE_LENGTH) + 1;
  const speedMult = (wave) => (1 + CYCLE_SPEEDUP * cycleOf(wave)) * (1 + WORLD_SPEEDUP * worldIndex(wave));

  function fireRate(wave) {
    wave = waveInWorld(wave);
    if (wave < FIRE.firstWave) return 0;
    return Math.min(FIRE.start + FIRE.perWave * (wave - FIRE.firstWave), FIRE.max);
  }

  const fireMult = (wave) => 1 + CYCLE_FIREUP * cycleOf(wave);
  // shots/s for a full-share shooter: the wave ramp (capped) times the cycle bonus, so wave 40 out-fires wave 20
  const shotRate = (wave) => fireRate(wave) * fireMult(wave);

  function waveScript(wave) {
    const worldBoss = waveInWorld(wave) === WAVES_PER_WORLD;
    const s = worldBoss ? WORLD_BOSS : WAVE_SCRIPTS[waveInCycle(wave)];
    return {
      wave, cycle: cycleOf(wave), speed: speedMult(wave), worldBoss,
      drones: { cols: s.drones[0], rows: s.drones[1] },
      groups: s.groups.map(([species, count]) => ({ species, count })),
      boss: s.groups.map((g) => g[0]).find((k) => SPECIES[k].boss) || null,
    };
  }

  const clampX = (x, w) => Math.max(EDGE, Math.min(FIELD.w - EDGE - w, x));

  // Uniform Catmull-Rom through points, t in [0, 1]; t >= 1 returns the last point exactly.
  function catmullRom(points, t) {
    const n = points.length;
    if (n === 1 || t >= 1) return { x: points[n - 1].x, y: points[n - 1].y };
    const s = Math.max(0, t) * (n - 1), i = Math.min(Math.floor(s), n - 2), u = s - i;
    const p0 = points[Math.max(i - 1, 0)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(i + 2, n - 1)];
    const at = (a, b, c, d) =>
      0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
    return { x: at(p0.x, p1.x, p2.x, p3.x), y: at(p0.y, p1.y, p2.y, p3.y) };
  }

  // triangle wave: 0 at p=0, +1 at 0.25, -1 at 0.75
  function triangle(p) {
    const f = p - Math.floor(p);
    return f < 0.25 ? 4 * f : f < 0.75 ? 2 - 4 * f : 4 * f - 4;
  }

  // Time-driven patterns: position at pattern time tau (seconds since the entry finished).
  // At tau = 0 every one of them is exactly at the enemy's home, so the entry path hands over cleanly.
  const TIMED = {
    sine: (e, tau) => ({ x: e.home.x + SPECIES.wasp.sway * Math.sin(2 * Math.PI * 0.4 * tau), y: e.home.y + 22 * tau }),
    zigzag: (e, tau) => ({ x: e.home.x + SPECIES.viper.sway * triangle(tau * 0.5), y: e.home.y + 30 * tau }),
    orbit: (e, tau) => ({
      x: e.orbit.x + ORBIT.rx * Math.cos(ORBIT.omega * tau),
      y: e.orbit.y + ORBIT.ry * Math.sin(ORBIT.omega * tau),
    }),
  };

  function armFire(game, e) {
    const s = SPECIES[e.species];
    const rate = shotRate(game.wave) * (s.fireShare || 0);
    e.fireEvery = s.fireEvery ? s.fireEvery / fireMult(game.wave) : (rate > 0 ? 1 / rate : 0);
    e.fireTimer = e.fireEvery ? e.fireEvery * (0.5 + game.rng()) : Infinity;
  }

  function createEnemy(game, species, x, y) {
    const s = SPECIES[species];
    const e = {
      species, pattern: s.pattern, x, y, w: s.w, h: s.h,
      hp: s.hp, maxHp: s.hp, points: s.points, boss: !!s.boss, age: 0,
    };
    armFire(game, e);
    return e;
  }

  // Entry swoop from above the screen (alternating sides) to the home slot.
  function entryPath(home, w, fromLeft) {
    const start = { x: fromLeft ? -w - 10 : FIELD.w + 10, y: -60 };
    return [
      start,
      { x: (start.x + home.x) / 2, y: home.y * 0.3 },
      { x: home.x + (FIELD.w / 2 - home.x) * 0.3, y: home.y * 0.8 },
      { x: home.x, y: home.y },
    ];
  }

  function homeFor(species, i, count) {
    const s = SPECIES[species];
    if (species === "orbiter") {
      const orbit = { x: (FIELD.w - s.w) / 2, y: ORBIT.cy };
      return { home: { x: orbit.x + ORBIT.rx, y: orbit.y }, orbit };
    }
    if (species === "dasher") return { home: { x: (FIELD.w - s.w) / 2, y: 90 } };
    const lo = EDGE + s.sway, hi = FIELD.w - EDGE - s.w - s.sway;
    return { home: { x: lo + ((hi - lo) * (i + 0.5)) / count, y: s.homeY + (i % 2) * s.lane } };
  }

  // One enemy of a group, entering on a Catmull-Rom path that ends exactly at its home.
  function spawnOne(game, species, i, count, order) {
    const { home, orbit } = homeFor(species, i, count);
    const path = entryPath(home, SPECIES[species].w, i % 2 === 0);
    const e = createEnemy(game, species, path[0].x, path[0].y);
    e.home = home;
    if (orbit) e.orbit = orbit;
    e.entry = { path, t: 0, duration: ENTRY_TIME };
    e.delay = order * SPAWN_STAGGER;
    if (species === "diver") e.hover = 1.2 + i * 0.6;
    if (species === "dasher") { e.dashState = "wait"; e.waitT = 0; }
    return e;
  }

  function spawnEnemies(game, script) {
    const out = [];
    for (const g of script.groups) {
      for (let i = 0; i < g.count; i++) out.push(spawnOne(game, g.species, i, g.count, out.length));
    }
    if (script.worldBoss) {
      const k = worldBossHp(script.wave);
      for (const e of out) if (e.boss) { e.hp = e.maxHp = e.hp * k; e.points *= k; e.worldBoss = true; }
    }
    return out;
  }

  function splitChildren(game, e) {
    if (e.species !== "splitter") return [];
    return [-1, 1].map((side) => {
      const c = createEnemy(game, "splitling", e.x + e.w / 2 - SPECIES.splitling.w / 2 + side * 10, e.y);
      c.vx = side * WANDER.speed; c.vy = 0; c.turn = WANDER.turnMin;
      return c;
    });
  }

  // returns true when the hit kills it (plain drones without hp have 1)
  function damage(e, amount) {
    e.hp = (e.hp === undefined ? 1 : e.hp) - amount;
    return e.hp <= 0;
  }

  function stepWander(game, e, dt) {
    e.turn = (e.turn || 0) - dt;
    if (e.turn <= 0) {
      const a = game.rng() * Math.PI * 2;
      e.vx = Math.cos(a) * WANDER.speed; e.vy = Math.sin(a) * WANDER.speed;
      e.turn = WANDER.turnMin + game.rng() * (WANDER.turnMax - WANDER.turnMin);
    }
    e.x += e.vx * dt; e.y += e.vy * dt;
    if (e.x < EDGE || e.x > FIELD.w - EDGE - e.w) e.vx = -e.vx;
    if (e.y < WANDER.minY || e.y > WANDER.maxY) e.vy = -e.vy;
    e.y = Math.max(WANDER.minY, Math.min(WANDER.maxY, e.y));
  }

  function stepDive(game, e, dt) {
    if (!e.dive) {
      e.hover -= dt;
      if (e.hover > 0) return;
      const tx = clampX(game.ship.x + game.ship.w / 2 - e.w / 2, e.w), side = tx > e.x ? -1 : 1;
      e.dive = {
        t: 0,
        path: [
          { x: e.x, y: e.y }, { x: e.x + side * DIVE.swoop, y: e.y + 100 },
          { x: tx, y: game.ship.y - 80 }, { x: tx, y: FIELD.h + 40 },
        ],
      };
      return;
    }
    e.dive.t += dt / DIVE.duration;
    const p = catmullRom(e.dive.path, e.dive.t);
    e.x = p.x; e.y = p.y;
  }

  // Boss: waits, then dashes to the far wall (inside the safe zone) and sinks a little each time.
  function stepDash(e, dt) {
    if (e.dashState === "wait") {
      e.waitT += dt;
      e.y = e.home.y + 6 * Math.sin(e.waitT * 6);
      if (e.waitT >= DASH.wait) {
        e.dashState = "dash";
        e.dashDir = e.x + e.w / 2 < FIELD.w / 2 ? 1 : -1;
      }
      return;
    }
    e.x += e.dashDir * DASH.speed * dt;
    const target = e.dashDir > 0 ? FIELD.w - EDGE - e.w : EDGE;
    if ((e.dashDir > 0 && e.x >= target) || (e.dashDir < 0 && e.x <= target)) {
      e.x = target;
      e.dashState = "wait"; e.waitT = 0;
      e.home = { x: e.x, y: Math.min(e.home.y + DASH.sink, DASH.maxY) };
    }
  }

  function stepPattern(game, e, dt) {
    if (TIMED[e.pattern]) {
      e.age += dt;
      const p = TIMED[e.pattern](e, e.age);
      e.x = p.x; e.y = p.y;
    } else if (e.pattern === "dive") stepDive(game, e, dt);
    else if (e.pattern === "wander") stepWander(game, e, dt);
    else if (e.pattern === "dash") stepDash(e, dt);
  }

  function enemyShot(x, y, vx, vy) {
    return { x: x - ENEMY_BULLET.w / 2, y, w: ENEMY_BULLET.w, h: ENEMY_BULLET.h, vx, vy };
  }

  function fire(game, e) {
    const cx = e.x + e.w / 2, by = e.y + e.h, v = ENEMY_BULLET.speed;
    if (e.species === "orbiter") { // aimed at the ship
      const dx = game.ship.x + game.ship.w / 2 - cx, dy = game.ship.y - by, len = Math.hypot(dx, dy) || 1;
      game.enemyBullets.push(enemyShot(cx, by, (dx / len) * v, (dy / len) * v));
    } else if (e.species === "dasher") { // three-way fan
      for (const vx of [-80, 0, 80]) game.enemyBullets.push(enemyShot(cx, by, vx, v));
    } else {
      game.enemyBullets.push(enemyShot(cx, by, 0, v));
    }
  }

  const isActive = (e) => !e.entry && !(e.delay > 0) && e.y + e.h > 0 && e.y < FIELD.h;

  // Moves every non-formation enemy (entry path, then its pattern) and lets shooters fire.
  function updateEnemies(game, dt) {
    const mult = speedMult(game.wave);
    for (const e of game.drones) {
      if (e.pattern && e.pattern !== "formation") {
        if (e.delay > 0) { e.delay -= dt; continue; }
        if (e.entry) {
          e.entry.t += (dt * mult) / e.entry.duration;
          const p = catmullRom(e.entry.path, e.entry.t);
          e.x = p.x; e.y = p.y;
          if (e.entry.t >= 1) e.entry = null;
          continue;
        }
        stepPattern(game, e, dt * mult);
        e.x = clampX(e.x, e.w);
        if (e.y >= FIELD.h) { e.dead = true; continue; }
      }
      if (e.fireTimer === undefined || !isActive(e)) continue;
      e.fireTimer -= dt;
      if (e.fireTimer <= 0) {
        fire(game, e);
        e.fireTimer = e.fireEvery * (0.75 + 0.5 * game.rng());
      }
    }
  }

  function moveBullets(game, dt) {
    for (const b of game.enemyBullets) { b.x += b.vx * dt; b.y += b.vy * dt; }
    game.enemyBullets = game.enemyBullets.filter(
      (b) => b.y < FIELD.h && b.y + b.h > 0 && b.x + b.w > 0 && b.x < FIELD.w);
  }

  root.BBEnemies = {
    FIELD, EDGE, CYCLE_LENGTH, CYCLE_SPEEDUP, ENEMY_BULLET, SPECIES, BOSSES, WAVE_SCRIPTS,
    WAVES_PER_WORLD, WORLD_SPEEDUP, WORLD_BOSS, worldIndex, waveInWorld, worldBossHp,
    cycleOf, waveInCycle, speedMult, fireRate, fireMult, shotRate, CYCLE_FIREUP, waveScript, clampX, catmullRom, triangle, TIMED,
    createEnemy, entryPath, spawnEnemies, splitChildren, damage, updateEnemies, moveBullets,
  };
})(globalThis);
