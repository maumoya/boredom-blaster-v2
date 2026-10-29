// Boredom Blaster weapons and rewards: winged capsules (bronze, silver, gold, rainbow), weapon
// levels 1-5, shield, escorts and the Super Star. Plain script; game.js calls it through
// globalThis.BBRewards. All state lives on the game object, randomness comes from game.rng.
(function (root) {
  const WEAPON = { maxLevel: 5, spread: 14 }; // spread: horizontal px between shots
  const CAPSULE = { w: 28, h: 16, speed: 90, everyKills: 12, dropChance: 0.3 };
  const RANKS = ["bronze", "silver", "gold", "rainbow", "heart"];
  // chance of each rank when a capsule is rolled (sums to 1)
  const RANK_ODDS = { bronze: 0.52, silver: 0.23, gold: 0.14, rainbow: 0.03, heart: 0.08 };
  // what each rank gives: bronze = weapon level up, silver = shield, gold = escort, rainbow = Super Star,
  // heart = an extra life
  // (the escort capsule is retired: gold now gives 2 skill picks, see skills.js)
  const REWARD = { bronze: "skill", silver: "skill", gold: "skill", rainbow: "superstar", heart: "life" };
  // a TWIN charge (at most 2) calls a twin ship for 15 s; a rainbow capsule gives one while Super Star is on
  const TWIN = { maxCharges: 2, duration: 15, offset: 40 };
  const MAGNETO = { pull: 140 }; // px/s a pulled capsule moves toward the ship (x2 at ULTRA-MAD)
  const SHIELD = { hits: 3, max: 9 }; // each shield capsule adds `hits`, stacking up to `max`
  const ESCORT = { max: 2, w: 14, h: 14, offset: 34 };
  const SUPER_STAR = { duration: 8, fireRateMult: 3 };

  function initRewards(game) {
    const S = root.BBSkills;
    S.init(game);
    // game.weaponLevel is the "More shots" tier
    Object.defineProperty(game, "weaponLevel", {
      configurable: true, enumerable: true,
      get() { return game.skills.more; },
      set(v) { S.setTier(game, "more", Math.max(1, v)); },
    });
    game.twinCharges = 0;
    game.twin = null; // { life } while a twin ship flies
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

  // Every 12th kill drops a rolled capsule where the drone died, after a 30 % roll.
  function onKill(game, x, y) {
    if (game.kills % CAPSULE.everyKills === 0 && game.rng() < CAPSULE.dropChance) spawnCapsule(game, x, y);
  }

  // Every mini-boss drops a capsule after the same 30 % roll.
  function onMiniBossKill(game, x, y) {
    if (!(game.rng() < CAPSULE.dropChance)) return null;
    return spawnCapsule(game, x, y);
  }

  // Shot x offsets from the ship centre for a weapon level (forward streams only).
  function weaponShots(level) {
    return root.BBSkills.volley(Math.max(1, level)).filter((v) => v.dir < 0).map((v) => v.dx);
  }

  function fireRateMult(game) {
    const S = root.BBSkills;
    return (game.superStar > 0 ? SUPER_STAR.fireRateMult : 1) * S.fireRate(S.tier(game, "faster"));
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
      case "skill": root.BBSkills.capsule(game, rank); break;
      case "life": root.BB.addLife(game); break;
      case "superstar":
        if (game.superStar > 0) game.twinCharges = Math.min(TWIN.maxCharges, game.twinCharges + 1);
        else game.superStar = SUPER_STAR.duration;
        break;
      default: return false;
    }
    return true;
  }

  // Capsules fall; the ship catches them. hit is passed in to avoid a second copy.
  function updateCapsules(game, dt, hit, height) {
    const S = root.BBSkills, mt = S.tier(game, "magneto"), range = S.magnetoRange(mt);
    const sx = game.ship.x + game.ship.w / 2, sy = game.ship.y + game.ship.h / 2;
    for (const c of game.capsules) {
      const dx = sx - (c.x + c.w / 2), dy = sy - (c.y + c.h / 2), len = Math.hypot(dx, dy);
      if (range > 0 && Math.abs(dx) <= range && len > 0) { // Magneto: the capsule is drawn to the ship
        const step = Math.min(len, MAGNETO.pull * S.magnetoSpeed(mt) * dt);
        c.x += (dx / len) * step; c.y += (dy / len) * step;
      }
      c.y += CAPSULE.speed * dt;
      if (hit(c, game.ship)) { c.caught = true; applyCapsule(game, c.rank); }
    }
    game.capsules = game.capsules.filter((c) => !c.caught && c.y < height);
  }

  function updateTimers(game, dt) {
    game.superStar = Math.max(0, game.superStar - dt);
    placeEscorts(game);
  }

  // Losing a life drops the most recently upgraded skill family one tier (MASTERED and ULTRA-MAD too).
  function onLifeLost(game) {
    root.BBSkills.onLifeLost(game);
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
    WEAPON, TWIN, MAGNETO, CAPSULE, RANKS, RANK_ODDS, REWARD, SHIELD, ESCORT, SUPER_STAR,
    initRewards, rollRank, spawnCapsule, onKill, onMiniBossKill, weaponShots, fireRateMult,
    addEscort, placeEscorts, applyCapsule, updateCapsules, updateTimers, onLifeLost, absorbHit, hitEscort,
  };
})(globalThis);
