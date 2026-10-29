// Boredom Blaster skill families: seven families, tiers 0-7 (1-5 normal, 6 = MASTERED, 7 = ULTRA-MAD),
// the numbers per tier, the capsule-to-picker flow and the picker's keys and layout. Plain script;
// game.js and rewards.js call it through globalThis.BBSkills. State lives on the game object:
// game.skills { id: tier }, game.picks (picks still to make), game.picker (open picker or null).
(function (root) {
  const MAX_TIER = 7, MASTERED = 6, ULTRA = 7;
  const SLOW = 0.15; // the game runs at 15 % speed while the picker is open
  const ULTRA_BONUS_POINTS = 2000; // a capsule is worth this when every family is ULTRA-MAD
  const FAMILIES = [
    { id: "more", name: "More shots", icon: "weapon", base: 1 },
    { id: "faster", name: "Faster shots", icon: "fire", base: 0 },
    { id: "larger", name: "Larger shots", icon: "spec", base: 0 },
    { id: "laser", name: "Laser", icon: "boom", base: 0 },
    { id: "moons", name: "Moons", icon: "star", base: 0 },
    { id: "magneto", name: "Magneto", icon: "shield", base: 0 },
    { id: "score", name: "Score per hit", icon: "heart", base: 0 },
  ];
  const IDS = FAMILIES.map((f) => f.id);
  const family = (id) => FAMILIES.find((f) => f.id === id);
  const clampTier = (t) => Math.max(0, Math.min(MAX_TIER, Math.floor(t) || 0));

  const tierName = (t) => (t >= ULTRA ? "ULTRA-MAD" : t >= MASTERED ? "MASTERED" : "");
  const MAGNETO_COL = 48;

  // ---- numbers per tier (design section 5) ----
  // forward streams: 1-5 = tier; MASTERED 7 in a fan; ULTRA-MAD 9 plus 2 rear shots
  function moreCount(t) { t = clampTier(t); return t >= ULTRA ? 9 : t >= MASTERED ? 7 : Math.max(1, t); }
  function rearShots(t) { return clampTier(t) >= ULTRA ? 2 : 0; }
  const FAN_STEP = 0.1; // radians between neighbouring fan streams
  const SPREAD = 14; // px between parallel streams
  // one entry per bullet: dx from the ship centre, angle (rad, 0 = straight), dir (-1 up, +1 rear)
  function volley(t) {
    const n = moreCount(t), fan = clampTier(t) >= MASTERED, out = [];
    for (let i = 0; i < n; i++) {
      const k = i - (n - 1) / 2;
      out.push(fan ? { dx: k * 6, angle: k * FAN_STEP, dir: -1 } : { dx: k * SPREAD, angle: 0, dir: -1 });
    }
    for (let i = 0; i < rearShots(t); i++) out.push({ dx: (i ? 1 : -1) * 8, angle: (i ? 1 : -1) * 0.12, dir: 1 });
    return out;
  }
  function fireRate(t) { t = clampTier(t); return t >= ULTRA ? 2.5 : t >= MASTERED ? 2 : 1 + 0.15 * t; }
  const bulletSpeed = (t) => 1 + 0.08 * clampTier(t);
  const hasTrails = (t) => clampTier(t) >= ULTRA;
  function sizeMult(t) { t = clampTier(t); return 1 + 0.15 * t; }
  const widthMult = (t) => sizeMult(t) * (clampTier(t) >= ULTRA ? 2 : 1);
  function pierce(t) { t = clampTier(t); return t >= ULTRA ? 3 : t >= MASTERED ? 2 : t >= 3 ? 1 : 0; }
  function laserCrosses(t) { t = clampTier(t); return t >= MASTERED ? Infinity : t; }
  function laserBeams(t) { t = clampTier(t); return t >= ULTRA ? 3 : t >= MASTERED ? 2 : t > 0 ? 1 : 0; }
  function moonCount(t) { return clampTier(t); }
  function moonHits(t) { t = clampTier(t); return t >= ULTRA ? 7 : t >= MASTERED ? 5 : t > 0 ? 3 : 0; }
  // px either side of the ship that Magneto pulls from; Infinity = the whole width
  function magnetoRange(t) { t = clampTier(t); return t >= MASTERED ? Infinity : t * MAGNETO_COL; }
  const magnetoSpeed = (t) => (clampTier(t) >= ULTRA ? 2 : 1);
  function scoreMult(t) { t = clampTier(t); return t >= ULTRA ? 3 : t >= MASTERED ? 2 : 1 + 0.1 * t; }

  const NEXT = { // what the next tier gives, for the picker cards
    more: ["2 streams", "3 streams", "4 streams", "5 streams", "5 streams", "7 streams in a fan", "9 streams + 2 rear shots"],
    faster: ["+15% fire rate", "+30% fire rate", "+45%", "+60%", "+75%", "fire rate x2", "fire rate x2.5 + trails"],
    larger: ["+15% size", "+30% size", "pierce 1 enemy", "+60% size", "+75% size", "pierce 2", "pierce 3, twice as wide"],
    laser: ["laser through 1", "through 2", "through 3", "through 4", "through 5", "2 full-column beams", "3 full-column beams"],
    moons: ["1 moon", "2 moons", "3 moons", "4 moons", "5 moons", "6 moons of 5 hits", "7 moons of 7 hits"],
    magneto: ["pull 1 column", "pull 2 columns", "pull 3 columns", "pull 4 columns", "pull 5 columns", "pull the whole width", "whole width, twice as fast"],
    score: ["+10% points", "+20% points", "+30% points", "+40% points", "+50% points", "points x2", "points x3, red floats"],
  };
  function nextText(id, t) { return t >= MAX_TIER ? "ULTRA-MAD" : NEXT[id][clampTier(t)]; }

  // ---- state ----
  function init(game) {
    game.skills = {};
    for (const f of FAMILIES) game.skills[f.id] = f.base;
    game.skillHistory = []; // family ids, most recently upgraded last
    game.picks = 0;
    game.picker = null;
    root.BBSkills.picker = null; // a new run forgets any picker left open by the last one
    root.BBSkills.game = null;
  }
  const tier = (game, id) => (game.skills && game.skills[id]) || 0;
  const highestTier = (game) => Math.max(0, ...IDS.map((id) => tier(game, id)));
  const owned = (game) => FAMILIES.filter((f) => tier(game, f.id) > 0);
  const available = (game) => FAMILIES.filter((f) => tier(game, f.id) < MAX_TIER);
  const allUltra = (game) => available(game).length === 0;

  function setTier(game, id, t) {
    const old = tier(game, id);
    game.skills[id] = clampTier(t);
    if (game.skills[id] > old) {
      game.skillHistory = game.skillHistory.filter((x) => x !== id);
      game.skillHistory.push(id);
    }
  }
  function upgrade(game, id) {
    if (!family(id) || tier(game, id) >= MAX_TIER) return false;
    setTier(game, id, tier(game, id) + 1);
    return true;
  }

  // An unabsorbed hit drops the most recently upgraded family one tier (MASTERED and ULTRA-MAD included).
  function onLifeLost(game) {
    const id = game.skillHistory[game.skillHistory.length - 1];
    if (!id) return false;
    const next = Math.max(family(id).base, tier(game, id) - 1);
    game.skills[id] = next;
    if (next <= family(id).base) game.skillHistory.pop();
    return true;
  }

  // ---- capsules and the picker ----
  const PICKS = { bronze: 1, silver: 1, gold: 2 };
  const OFFER_ODDS = { [MASTERED]: 0.5, [ULTRA]: 0.25 }; // chance a choice that reaches this tier is offered
  // Families the picker may offer now: a step to MASTERED or ULTRA-MAD must win its roll on game.rng.
  function rollOffers(game) {
    const rng = game.rng || Math.random;
    return available(game).filter((f) => {
      const odds = OFFER_ODDS[tier(game, f.id) + 1];
      return odds === undefined || rng() < odds;
    }).map((f) => f.id);
  }
  // Gives picks for a capsule rank; when everything is ULTRA-MAD the capsule is worth points instead.
  // Returns "points" | "picker" | false (rank is not a skill capsule).
  function addPicks(game, n) {
    if (game.picker) { game.picks += n; return "picker"; }
    const offered = rollOffers(game);
    if (!offered.length) { game.score += ULTRA_BONUS_POINTS; return "points"; }
    game.picks += n;
    openPicker(game, offered);
    return "picker";
  }
  function capsule(game, rank) {
    if (!PICKS[rank]) return false;
    if (rank === "silver") game.shield = Math.min(root.BBRewards.SHIELD.max, game.shield + 3);
    return addPicks(game, PICKS[rank]);
  }

  function openPicker(game, offered) {
    const free = game.picks > 0 ? (offered || rollOffers(game)) : [];
    if (!free.length) { game.picks = 0; game.picker = null; return null; }
    game.picker = { cursor: IDS.indexOf(free[0]), offered: free };
    root.BBSkills.picker = game.picker;
    root.BBSkills.game = game;
    return game.picker;
  }
  function closePicker(game) {
    game.picker = null;
    if (root.BBSkills.game === game) { root.BBSkills.picker = null; root.BBSkills.game = null; }
  }
  // Picks family `id` (needs the picker open); reopens for the next pick, if any.
  function choose(game, id) {
    if (!game.picker || !family(id) || tier(game, id) >= MAX_TIER || !game.picker.offered.includes(id)) return false;
    upgrade(game, id);
    game.picks -= 1;
    closePicker(game);
    if (game.picks > 0) openPicker(game);
    return true;
  }
  function moveCursor(game, dir) {
    const p = game.picker;
    if (!p) return false;
    for (let i = 1; i <= IDS.length; i++) {
      const j = (p.cursor + dir * i + IDS.length * 8) % IDS.length;
      if (p.offered.includes(IDS[j])) { p.cursor = j; return true; }
    }
    return false;
  }

  // Keys while the picker is open: 1-7 pick, arrows (and WASD) move, Enter confirms. True = key used.
  function pickerKey(game, code) {
    if (!game || !game.picker) return false;
    const m = /^(?:Digit|Numpad)([1-7])$/.exec(code);
    if (m) { choose(game, IDS[Number(m[1]) - 1]); return true; }
    if (code === "ArrowLeft" || code === "ArrowUp" || code === "KeyA" || code === "KeyW") { moveCursor(game, -1); return true; }
    if (code === "ArrowRight" || code === "ArrowDown" || code === "KeyD" || code === "KeyS") { moveCursor(game, 1); return true; }
    if (code === "Enter" || code === "NumpadEnter" || code === "Space") { choose(game, IDS[game.picker.cursor]); return true; }
    return false;
  }

  // Cards: two columns of rows in canvas px (7 cards: 4 + 3).
  const CARD = { x: 30, y: 150, w: 205, h: 98, gap: 10 };
  function cardRect(i) {
    const col = i % 2, row = Math.floor(i / 2);
    return { x: CARD.x + col * (CARD.w + CARD.gap), y: CARD.y + row * (CARD.h + CARD.gap), w: CARD.w, h: CARD.h };
  }
  function cardAt(x, y) {
    for (let i = 0; i < IDS.length; i++) {
      const r = cardRect(i);
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
    }
    return -1;
  }
  // A tap: picks the card hit (greyed-out ones do nothing). True = the tap belonged to the picker.
  function pickerTap(game, x, y) {
    if (!game || !game.picker) return false;
    const i = cardAt(x, y);
    if (i >= 0) choose(game, IDS[i]);
    return true;
  }

  // dt as the game sees it: slowed to 15 % while the picker is open
  const timeScale = (game) => (game.picker ? SLOW : 1);

  root.BBSkills = {
    MAX_TIER, MASTERED, ULTRA, SLOW, ULTRA_BONUS_POINTS, FAMILIES, IDS, PICKS, CARD, SPREAD, FAN_STEP,
    family, tierName, nextText, init, tier, highestTier, owned, available, allUltra, setTier, upgrade,
    onLifeLost, capsule, addPicks, openPicker, choose, moveCursor, pickerKey, cardRect, cardAt, pickerTap, timeScale,
    moreCount, rearShots, volley, fireRate, bulletSpeed, hasTrails, sizeMult, widthMult, pierce,
    laserCrosses, laserBeams, moonCount, moonHits, magnetoRange, magnetoSpeed, scoreMult,
    picker: null, game: null,
  };
})(globalThis);
