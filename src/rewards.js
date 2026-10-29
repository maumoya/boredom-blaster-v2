// Boredom Blaster weapons and rewards: winged capsules (bronze, silver, gold, rainbow), weapon
// levels 1-5, shield, escorts and the Super Star. Plain script; game.js calls it through
// globalThis.BBRewards. All state lives on the game object, randomness comes from game.rng.
(function (root) {
  const WEAPON = { maxLevel: 5, spread: 14 }; // spread: horizontal px between shots
  const CAPSULE = { w: 28, h: 16, speed: 90, everyKills: 12 };
  const RANKS = ["bronze", "silver", "gold", "rainbow"];
  // chance of each rank when a capsule is rolled (sums to 1)
  const RANK_ODDS = { bronze: 0.55, silver: 0.25, gold: 0.15, rainbow: 0.05 };
  // what each rank gives: bronze = weapon level up, silver = shield, gold = escort, rainbow = Super Star
  const REWARD = { bronze: "weapon", silver: "shield", gold: "escort", rainbow: "superstar" };
  const SHIELD = { hits: 3 };
  const ESCORT = { max: 2, w: 14, h: 14, offset: 34 };
  const SUPER_STAR = { duration: 8, fireRateMult: 3 };

  function initRewards(game) {
    game.weaponLevel = 1;
    game.capsules = [];
    game.shield = 0;
    game.escorts = [];
    game.superStar = 0;
    if (!game.rng) game.rng = Math.random;
  }

  // Rank by cumulative odds; r in [0, 1).
  function rollRank(r) {
    let acc = 0;
    for (const rank of RANKS) {
      acc += RANK_ODDS[rank];
      if (r < acc) return rank;
    }
    return "bronze";
  }

  function spawnCapsule(game, x, y, rank) {
    const c = { x: x - CAPSULE.w / 2, y, w: CAPSULE.w, h: CAPSULE.h, rank: rank || rollRank(game.rng()) };
    game.capsules.push(c);
    return c;
  }

  // Every 12th kill drops a rolled capsule where the drone died.
  function onKill(game, x, y) {
    if (game.kills % CAPSULE.everyKills === 0) spawnCapsule(game, x, y);
  }

  // Every mini-boss always drops a capsule.
  function onMiniBossKill(game, x, y) {
    return spawnCapsule(game, x, y);
  }

  // Shot x offsets from the ship centre for a weapon level: one shot per level.
  function weaponShots(level) {
    const n = Math.max(1, Math.min(WEAPON.maxLevel, level));
    return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * WEAPON.spread);
  }

  function fireRateMult(game) {
    return game.superStar > 0 ? SUPER_STAR.fireRateMult : 1;
  }

  function addEscort(game) {
    if (game.escorts.length >= ESCORT.max) return false;
    game.escorts.push({ x: 0, y: 0, w: ESCORT.w, h: ESCORT.h });
    placeEscorts(game);
    return true;
  }

  // Escorts hover beside the ship: first on the left, second on the right.
  function placeEscorts(game) {
    const s = game.ship;
    game.escorts.forEach((e, i) => {
      e.x = i % 2 === 0 ? s.x - ESCORT.offset : s.x + s.w + ESCORT.offset - e.w;
      e.y = s.y + s.h - e.h;
    });
  }

  function applyCapsule(game, rank) {
    switch (REWARD[rank]) {
      case "weapon": game.weaponLevel = Math.min(WEAPON.maxLevel, game.weaponLevel + 1); break;
      case "shield": game.shield = SHIELD.hits; break;
      case "escort": addEscort(game); break;
      case "superstar": game.superStar = SUPER_STAR.duration; break;
      default: return false;
    }
    return true;
  }

  // Capsules fall; the ship catches them. hit is passed in to avoid a second copy.
  function updateCapsules(game, dt, hit, height) {
    for (const c of game.capsules) {
      c.y += CAPSULE.speed * dt;
      if (hit(c, game.ship)) { c.caught = true; applyCapsule(game, c.rank); }
    }
    game.capsules = game.capsules.filter((c) => !c.caught && c.y < height);
  }

  function updateTimers(game, dt) {
    game.superStar = Math.max(0, game.superStar - dt);
    placeEscorts(game);
  }

  // Losing a life drops the weapon one level (never below 1).
  function onLifeLost(game) {
    game.weaponLevel = Math.max(1, game.weaponLevel - 1);
  }

  // A hit on the ship: Super Star ignores it, the shield soaks it, otherwise it goes through.
  function absorbHit(game) {
    if (game.superStar > 0) return true;
    if (game.shield > 0) { game.shield -= 1; return true; }
    return false;
  }

  // An enemy touching an escort kills that escort (1 hit); returns true if one died.
  function hitEscort(game, enemy, hit) {
    const i = game.escorts.findIndex((e) => hit(enemy, e));
    if (i === -1) return false;
    game.escorts.splice(i, 1);
    placeEscorts(game);
    return true;
  }

  root.BBRewards = {
    WEAPON, CAPSULE, RANKS, RANK_ODDS, REWARD, SHIELD, ESCORT, SUPER_STAR,
    initRewards, rollRank, spawnCapsule, onKill, onMiniBossKill, weaponShots, fireRateMult,
    addEscort, placeEscorts, applyCapsule, updateCapsules, updateTimers, onLifeLost, absorbHit, hitEscort,
  };
})(globalThis);
