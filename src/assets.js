// Boredom Blaster sprite manifest and loader. Plain script like game.js; the tests load it in Node.
// Every name maps to a file under assets/ (Kenney Space Shooter Redux, CC0). If an image fails to
// load, get() returns null and render.js draws a plain shape instead.
(function (root) {
  const DIR = "assets/";
  const K = "kenney/";

  const MANIFEST = {
    ship: K + "playerShip1_blue.png",
    shipDamage1: K + "Damage/playerShip1_damage1.png",
    shipDamage2: K + "Damage/playerShip1_damage2.png",
    shipDamage3: K + "Damage/playerShip1_damage3.png",
    flame: K + "Effects/fire00.png",
    escort: K + "playerShip3_green.png",
    lifeIcon: K + "UI/playerLife1_blue.png",
    drone: K + "Enemies/enemyBlack1.png",
    wasp: K + "Enemies/enemyBlue2.png",
    viper: K + "Enemies/enemyRed3.png",
    diver: K + "Enemies/enemyGreen4.png",
    splitter: K + "Enemies/enemyBlack5.png",
    splitling: K + "Enemies/enemyRed5.png",
    orbiter: K + "ufoBlue.png",
    dasher: K + "ufoRed.png",
    bullet: K + "Lasers/laserBlue01.png",
    special: K + "Lasers/laserBlue12.png",
    enemyBullet: K + "Lasers/laserRed01.png",
    capsuleBronze: K + "Power-ups/bolt_bronze.png",
    capsuleSilver: K + "Power-ups/shield_silver.png",
    capsuleGold: K + "Power-ups/things_gold.png",
    capsuleRainbow: K + "Power-ups/powerupBlue_star.png",
    shield: K + "Effects/shield1.png",
    spark: K + "Effects/star1.png",
    star1: K + "Effects/star1.png",
    star2: K + "Effects/star2.png",
    star3: K + "Effects/star3.png",
    meteorBig1: K + "Meteors/meteorGrey_big1.png",
    meteorBig2: K + "Meteors/meteorBrown_big1.png",
    meteorMed: K + "Meteors/meteorGrey_med1.png",
    meteorSmall: K + "Meteors/meteorBrown_small1.png",
    meteorTiny: K + "Meteors/meteorGrey_tiny1.png",
    button: K + "UI/buttonBlue.png",
    buttonHot: K + "UI/buttonYellow.png",
  };

  const urlOf = (name) => DIR + MANIFEST[name];

  // makeImage: () => Image-like (browser: () => new Image()). Loads everything up front.
  function createAssets(makeImage) {
    const images = {}, status = {};
    for (const name of Object.keys(MANIFEST)) {
      const img = makeImage();
      status[name] = "loading";
      img.onload = () => { status[name] = "ok"; };
      img.onerror = () => { status[name] = "failed"; };
      img.src = urlOf(name);
      images[name] = img;
    }
    return {
      status,
      get: (name) => (status[name] === "ok" ? images[name] : null),
      failed: () => Object.keys(status).filter((n) => status[n] === "failed"),
    };
  }

  // ---- ship art, drawn in code (design section 10c) ----
  // Every routine draws in a 100-unit-wide box, nose up for the player and nose down for enemies.
  // createShipArt renders each (type, accent, damage) once to an offscreen canvas and reuses it.
  const NEON = { cyan: "#22E5FF", magenta: "#FF2BD6", lime: "#6CFF3A", orange: "#FF7A1A", yellow: "#FFE53B" };
  const SHIP_SS = 3; // offscreen pixels per game pixel, enough for the sharpest HD scale
  const EDGE = "#0b1020";
  const METAL = [[0, "#9aa7be"], [0.5, "#44506c"], [1, "#161c2e"]];

  // gradients degrade to the first stop colour on a canvas without gradient support (the test stub)
  function stops(g, list) {
    if (!g || typeof g.addColorStop !== "function") return list[0][1];
    for (const [at, color] of list) g.addColorStop(at, color);
    return g;
  }
  const lin = (c, y0, y1, list) => stops(c.createLinearGradient(0, y0, 0, y1), list || METAL);
  const mirror = (pts) => pts.map(([x, y]) => [100 - x, y]);
  function trace(c, pts, close) {
    c.beginPath();
    pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    if (close) c.closePath();
  }
  function plate(c, pts, fill) {
    trace(c, pts, true);
    c.fillStyle = fill || lin(c, 0, 100);
    c.fill();
    c.lineWidth = 1; c.lineJoin = "round"; c.strokeStyle = EDGE; c.stroke();
  }
  const sym = (c, pts, fill) => { plate(c, pts, fill); plate(c, mirror(pts), fill); };
  function neon(c, pts, color, width) { // glowing open line
    c.save();
    c.shadowColor = color; c.shadowBlur = 6;
    c.strokeStyle = color; c.lineWidth = width || 1.6; c.lineJoin = "round"; c.lineCap = "round";
    trace(c, pts, false); c.stroke();
    c.restore();
  }
  const symNeon = (c, pts, color, width) => { neon(c, pts, color, width); neon(c, mirror(pts), color, width); };
  function line(c, pts, color, width) { // thin panel line
    c.strokeStyle = color || "rgba(8,12,24,0.7)"; c.lineWidth = width || 0.8;
    trace(c, pts, false); c.stroke();
  }
  function orb(c, x, y, r, color) { // glowing core
    c.fillStyle = stops(c.createRadialGradient(x, y, 0, x, y, r),
      [[0, "#fff"], [0.35, color], [1, "rgba(0,0,0,0)"]]);
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  }
  function disc(c, x, y, rx, ry, fill, stroke) {
    c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    c.fillStyle = fill; c.fill();
    if (stroke) { c.lineWidth = 1; c.strokeStyle = stroke; c.stroke(); }
  }

  function damageMarks(c, dmg) { // scorch, cracks, a chipped wing and fire as the lives run out
    if (dmg < 1) return;
    c.save();
    disc(c, 22, 76, 9, 5, "rgba(10,8,8,0.6)");
    line(c, [[30, 60], [25, 70], [28, 78], [20, 88]], "#05070d", 1.2);
    if (dmg >= 2) {
      disc(c, 70, 66, 8, 6, "rgba(10,8,8,0.65)");
      line(c, [[52, 44], [58, 56], [54, 66], [62, 80]], "#05070d", 1.2);
      plate(c, [[4, 92], [10, 84], [14, 94]], "#05070d");
      orb(c, 70, 66, 7, NEON.orange);
    }
    if (dmg >= 3) {
      disc(c, 36, 50, 9, 7, "rgba(8,8,10,0.7)");
      line(c, [[44, 30], [38, 44], [46, 56]], "#05070d", 1.4);
      orb(c, 36, 50, 9, NEON.yellow);
      orb(c, 24, 80, 7, NEON.orange);
    }
    c.restore();
  }

  function drawPlayer(c, accent, dmg) {
    sym(c, [[47, 32], [6, 74], [3, 92], [28, 86], [44, 68]], lin(c, 30, 92, [[0, "#b4c0d6"], [1, "#27304a"]]));
    symNeon(c, [[47, 32], [6, 74], [3, 92]], accent, 1.8);
    sym(c, [[36, 70], [30, 90], [38, 90], [41, 76]], lin(c, 70, 92, [[0, "#56627e"], [1, "#10162a"]])); // wing roots
    plate(c, [[50, 2], [60, 26], [64, 70], [58, 88], [42, 88], [36, 70], [40, 26]]);
    line(c, [[50, 4], [50, 86]]);
    line(c, [[39, 50], [61, 50]]); line(c, [[38, 64], [62, 64]]); line(c, [[41, 78], [59, 78]]);
    neon(c, [[40, 26], [36, 70]], accent, 1); neon(c, [[60, 26], [64, 70]], accent, 1);
    // glass cockpit with a highlight
    c.beginPath(); c.ellipse(50, 34, 7.5, 13, 0, 0, Math.PI * 2);
    c.fillStyle = stops(c.createLinearGradient(0, 22, 0, 46), [[0, "#bff6ff"], [0.5, "#1b8fb3"], [1, "#06243a"]]);
    c.fill(); c.lineWidth = 1; c.strokeStyle = EDGE; c.stroke();
    c.beginPath(); c.ellipse(47.5, 28, 2.2, 5.5, -0.2, 0, Math.PI * 2);
    c.fillStyle = "rgba(255,255,255,0.8)"; c.fill();
    // twin nozzles that feed the plume
    for (const x of [41, 59]) {
      plate(c, [[x - 5, 86], [x + 5, 86], [x + 4, 95], [x - 4, 95]], lin(c, 86, 95, [[0, "#59647e"], [1, "#0c1020"]]));
      orb(c, x, 94, 5, NEON.orange);
    }
    damageMarks(c, dmg);
  }

  function drawDrone(c, a) {
    sym(c, [[10, 48], [0, 66], [16, 62], [24, 54]], lin(c, 48, 66));
    disc(c, 50, 50, 44, 30, lin(c, 20, 80), EDGE);
    c.save(); c.shadowColor = a; c.shadowBlur = 6;
    c.beginPath(); c.ellipse(50, 50, 40, 26, 0, 0, Math.PI * 2); c.strokeStyle = a; c.lineWidth = 1.6; c.stroke();
    c.restore();
    disc(c, 50, 46, 20, 16, lin(c, 30, 62, [[0, "#3a4566"], [1, "#0b1020"]]), EDGE);
    orb(c, 50, 52, 13, a);
    for (const x of [28, 50, 72]) orb(c, x, 70, 3.5, a);
  }

  function drawWasp(c, a) {
    sym(c, [[45, 30], [2, 14], [8, 34], [44, 54]], lin(c, 14, 54, [[0, "#9aa7be"], [1, "#2a3452"]]));
    symNeon(c, [[45, 30], [2, 14], [8, 34]], a, 1.6);
    plate(c, [[39, 3], [61, 3], [59, 40], [41, 40]]);
    for (const y of [12, 22, 32]) neon(c, [[40.5, y], [59.5, y]], a, 1.2);
    plate(c, [[37, 38], [63, 38], [58, 70], [50, 90], [42, 70]]);
    line(c, [[50, 40], [50, 86]]);
    orb(c, 43, 68, 5, a); orb(c, 57, 68, 5, a);
    plate(c, [[47, 88], [53, 88], [50, 100]], "#d6dcea");
  }

  function drawViper(c, a) {
    plate(c, [[50, 96], [97, 18], [72, 34], [50, 22], [28, 34], [3, 18]]);
    neon(c, [[97, 18], [50, 96], [3, 18]], a, 1.8);
    plate(c, [[50, 88], [62, 38], [38, 38]], lin(c, 38, 88, [[0, "#3b4560"], [1, "#0a0f1e"]]));
    sym(c, [[38, 62], [30, 86], [46, 72]], "#d6dcea"); // fangs
    line(c, [[28, 34], [50, 44], [72, 34]]);
    orb(c, 50, 42, 9, a);
  }

  function drawDiver(c, a) {
    sym(c, [[40, 34], [8, 10], [12, 40], [40, 58]], lin(c, 10, 58, [[0, "#9aa7be"], [1, "#27304a"]]));
    symNeon(c, [[40, 34], [8, 10], [12, 40]], a, 1.6);
    plate(c, [[50, 100], [62, 42], [57, 4], [43, 4], [38, 42]]);
    neon(c, [[50, 8], [50, 94]], a, 1.4);
    line(c, [[40, 26], [60, 26]]); line(c, [[39, 40], [61, 40]]);
    c.beginPath(); c.ellipse(50, 56, 6, 11, 0, 0, Math.PI * 2);
    c.fillStyle = stops(c.createLinearGradient(0, 45, 0, 67), [[0, "#e6ffd8"], [1, "#0b4a12"]]); c.fill();
    orb(c, 50, 56, 7, a);
  }

  function drawSplitter(c, a) {
    sym(c, [[4, 40], [28, 8], [48, 22], [48, 80], [30, 94], [4, 66]]);
    sym(c, [[12, 44], [28, 22], [40, 32], [40, 70], [28, 80], [12, 62]], lin(c, 20, 80, [[0, "#4d5a78"], [1, "#10162a"]]));
    neon(c, [[50, 12], [50, 90]], a, 2.6);
    orb(c, 26, 52, 10, a); orb(c, 74, 52, 10, a);
    symNeon(c, [[4, 40], [28, 8], [48, 22]], a, 1.1);
  }

  function drawMiniBoss(c, a) { // wide armoured hull, an energy ring and a glowing core
    sym(c, [[10, 8], [0, 32], [16, 46], [24, 20]], lin(c, 8, 46));
    sym(c, [[26, 40], [22, 62], [32, 62], [35, 46]], lin(c, 40, 62, [[0, "#59647e"], [1, "#10162a"]]));
    plate(c, [[50, 62], [82, 36], [86, 8], [14, 8], [18, 36]]);
    line(c, [[24, 20], [76, 20]]); line(c, [[30, 46], [70, 46]]);
    plate(c, [[30, 12], [70, 12], [62, 24], [38, 24]], lin(c, 12, 24, [[0, "#6d7a96"], [1, "#222a42"]]));
    c.save(); c.shadowColor = a; c.shadowBlur = 8;
    c.beginPath(); c.ellipse(50, 34, 40, 13, 0, 0, Math.PI * 2); c.strokeStyle = a; c.lineWidth = 1.8; c.stroke();
    c.restore();
    disc(c, 50, 34, 15, 15, "#0a0f1e", EDGE);
    orb(c, 50, 34, 15, a);
    orb(c, 50, 34, 6, NEON.yellow);
  }

  function drawBoss(c, a) { // bigger: swept armour wings, cannons, a core with a hot centre
    sym(c, [[46, 10], [0, 4], [4, 24], [30, 52], [46, 46]], lin(c, 4, 52, [[0, "#a2aec4"], [1, "#27304a"]]));
    symNeon(c, [[46, 10], [0, 4], [4, 24], [30, 52]], a, 1.8);
    sym(c, [[20, 14], [8, 12], [10, 24], [22, 30]], lin(c, 12, 30, [[0, "#6d7a96"], [1, "#222a42"]])); // wing armour
    sym(c, [[30, 40], [26, 62], [36, 62], [38, 44]], lin(c, 40, 62, [[0, "#59647e"], [1, "#10162a"]])); // cannons
    plate(c, [[50, 64], [66, 42], [62, 8], [38, 8], [34, 42]]);
    sym(c, [[44, 10], [34, 14], [38, 30], [46, 24]], lin(c, 10, 30, [[0, "#7b88a4"], [1, "#2a3350"]])); // chest plates
    line(c, [[50, 8], [50, 62]]);
    disc(c, 50, 34, 12, 12, "#0a0f1e", EDGE);
    orb(c, 50, 34, 14, a);
    orb(c, 50, 34, 6, NEON.yellow);
    orb(c, 10, 18, 4, a); orb(c, 90, 18, 4, a);
  }

  // aspect: height / width of the sprite; accent: its neon colour. Splitlings reuse the splitter shape.
  const SHIP_ART = {
    player: { aspect: 1, accent: NEON.cyan, draw: drawPlayer },
    drone: { aspect: 1, accent: NEON.magenta, draw: drawDrone },
    wasp: { aspect: 1, accent: NEON.cyan, draw: drawWasp },
    viper: { aspect: 1, accent: NEON.orange, draw: drawViper },
    diver: { aspect: 1, accent: NEON.lime, draw: drawDiver },
    splitter: { aspect: 1, accent: NEON.yellow, draw: drawSplitter },
    splitling: { aspect: 1, accent: NEON.orange, draw: drawSplitter },
    orbiter: { aspect: 0.65, accent: NEON.cyan, draw: drawMiniBoss },
    dasher: { aspect: 0.62, accent: NEON.magenta, draw: drawBoss },
  };

  // makeCanvas(w, h) -> canvas-like with getContext("2d"), or null when the platform has none (then ships
  // are drawn straight onto the target each frame).
  function createShipArt(makeCanvas) {
    const cache = new Map();
    const stats = { renders: 0, hits: 0 };
    function render(art, px, accent, dmg) {
      const canvas = makeCanvas ? makeCanvas(px, Math.ceil(px * art.aspect)) : null;
      const cc = canvas && canvas.getContext && canvas.getContext("2d");
      if (!cc) return null;
      cc.scale(px / 100, px / 100);
      art.draw(cc, accent, dmg);
      stats.renders++;
      return canvas;
    }
    // type: SHIP_ART key; w: drawn width in game pixels; opts.accent / opts.dmg override the defaults
    function draw(ctx, type, cx, cy, w, opts) {
      const art = SHIP_ART[type] || SHIP_ART.drone;
      const accent = (opts && opts.accent) || art.accent, dmg = (opts && opts.dmg) || 0;
      const h = w * art.aspect, px = Math.ceil(w * SHIP_SS), key = type + "|" + accent + "|" + dmg + "|" + px;
      let canvas = cache.get(key);
      if (canvas) stats.hits++;
      else if ((canvas = render(art, px, accent, dmg))) cache.set(key, canvas);
      if (canvas) { ctx.drawImage(canvas, cx - w / 2, cy - h / 2, w, h); return; }
      ctx.save();
      ctx.transform(w / 100, 0, 0, w / 100, cx - w / 2, cy - h / 2); // translate + scale in one call
      art.draw(ctx, accent, dmg);
      ctx.restore();
    }
    return { draw, stats };
  }

  root.BBAssets = { MANIFEST, DIR, urlOf, createAssets, createShipArt, SHIP_ART, NEON };
})(globalThis);
