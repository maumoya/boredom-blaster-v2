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

  function hit(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function spawnWave(game) {
    const cols = Math.min(4 + game.wave, 8);
    const rows = Math.min(1 + Math.ceil(game.wave / 2), 4);
    const left = (W - (cols - 1) * DRONE.gapX - DRONE.w) / 2;
    game.drones = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        game.drones.push({ x: left + c * DRONE.gapX, y: 50 + r * DRONE.gapY, w: DRONE.w, h: DRONE.h });
      }
    }
    game.dir = 1;
  }

  function createGame() {
    const game = {
      w: W, h: H,
      ship: { x: (W - SHIP.w) / 2, y: SHIP.y, w: SHIP.w, h: SHIP.h },
      bullets: [], drones: [],
      score: 0, lives: START_LIVES, wave: 1,
      cooldown: 0, invuln: 0, dir: 1,
      specialCooldown: 0, kills: 0, kaboomCharges: 0, paused: false,
      status: "playing", // "playing" | "over"
    };
    spawnWave(game);
    return game;
  }

  function shoot(game) {
    if (game.status !== "playing" || game.cooldown > 0) return false;
    game.bullets.push({
      x: game.ship.x + (game.ship.w - BULLET.w) / 2,
      y: game.ship.y - BULLET.h,
      w: BULLET.w, h: BULLET.h,
    });
    game.cooldown = BULLET.cooldown;
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

  function addKill(game) {
    game.score += DRONE.points;
    game.kills += 1;
    if (game.kills % KABOOM.killsPerCharge === 0) {
      game.kaboomCharges = Math.min(KABOOM.maxCharges, game.kaboomCharges + 1);
    }
  }

  // Kaboom: spend a charge to destroy the 5 drones nearest the ship (scored, but they do not recharge it).
  function kaboom(game) {
    if (game.status !== "playing" || game.paused || game.kaboomCharges <= 0) return false;
    const cx = game.ship.x + game.ship.w / 2, cy = game.ship.y + game.ship.h / 2;
    const dist = (d) => Math.hypot(d.x + d.w / 2 - cx, d.y + d.h / 2 - cy);
    const doomed = new Set([...game.drones].sort((a, b) => dist(a) - dist(b)).slice(0, KABOOM.targets));
    game.drones = game.drones.filter((d) => !doomed.has(d));
    game.score += doomed.size * DRONE.points;
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
    if (input.fire) shoot(game);

    for (const b of game.bullets) b.y -= (b.pierce ? SPECIAL.speed : BULLET.speed) * dt;
    game.bullets = game.bullets.filter((b) => b.y + b.h > 0);

    // drones sweep sideways, drop half a row at each edge; faster with the wave and as the swarm thins
    const speed = 50 + game.wave * 12 + (40 - Math.min(game.drones.length, 40)) * 2;
    // the formation moves as one rigid block: the shift is cut at the wall so spacing never changes
    if (game.drones.length) {
      let dx = game.dir * speed * dt;
      const minX = Math.min(...game.drones.map((d) => d.x));
      const maxR = Math.max(...game.drones.map((d) => d.x + d.w));
      let edge = false;
      if (dx < 0 && minX + dx <= 0) { dx = -minX; edge = true; }
      else if (dx > 0 && maxR + dx >= W) { dx = W - maxR; edge = true; }
      for (const d of game.drones) d.x += dx;
      if (edge) {
        game.dir = -game.dir;
        for (const d of game.drones) d.y += DRONE.gapY / 2;
      }
    }

    // bullets vs drones
    for (const b of game.bullets) {
      if (b.pierce) { // the special shot passes through everything it touches
        game.drones = game.drones.filter((d) => {
          if (!hit(b, d)) return true;
          addKill(game);
          return false;
        });
        continue;
      }
      const i = game.drones.findIndex((d) => hit(b, d));
      if (i !== -1) {
        game.drones.splice(i, 1);
        b.dead = true;
        addKill(game);
      }
    }
    game.bullets = game.bullets.filter((b) => !b.dead);

    // drones reaching the ship or the floor cost a life and are removed
    for (const d of game.drones) {
      const touch = game.invuln <= 0 && hit(d, game.ship);
      if (touch || d.y + d.h >= H) {
        d.dead = true;
        if (game.invuln <= 0 && game.status === "playing") loseLife(game);
      }
    }
    game.drones = game.drones.filter((d) => !d.dead);

    if (game.status === "playing" && game.drones.length === 0) {
      game.wave += 1;
      game.bullets = [];
      spawnWave(game);
    }
  }

  function restart() {
    return createGame();
  }

  root.BB = { W, H, SHIP, SHIP_MIN_Y, SPECIAL, KABOOM, special, kaboom, togglePause, BULLET, DRONE, START_LIVES, createGame, shoot, update, restart, hit };
})(globalThis);
