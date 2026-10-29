// Boredom Blaster browser shell: canvas drawing, keyboard input and the frame loop.
(function () {
  const BB = globalThis.BB;
  const canvas = document.getElementById("screen");
  const ctx = canvas.getContext("2d");
  canvas.width = BB.W;
  canvas.height = BB.H;

  let game; // created once src/rewards.js has loaded (see the end of this file)
  const keyboard = BBInput.createKeyboard();
  const touch = BBInput.createTouch();
  let touchSeen = false; // the on-screen buttons only show once a finger has been used

  // fixed starfield in three sizes
  const stars = Array.from({ length: 90 }, (_, i) => ({
    x: (i * 137.5) % BB.W, y: (i * 71.3) % BB.H, size: 1 + (i % 3),
  }));

  addEventListener("keydown", (e) => {
    if (e.code === "Enter" && game.status === "over") game = BB.restart();
    if (keyboard.keydown(e.code)) e.preventDefault();
  });
  addEventListener("keyup", (e) => keyboard.keyup(e.code));

  // pointer position in canvas coordinates (the canvas is scaled by CSS)
  function canvasPoint(e) {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * (BB.W / r.width), (e.clientY - r.top) * (BB.H / r.height)];
  }
  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    touchSeen = true;
    if (game.status === "over") { game = BB.restart(); return; }
    canvas.setPointerCapture(e.pointerId);
    touch.start(e.pointerId, ...canvasPoint(e));
  });
  canvas.addEventListener("pointermove", (e) => touch.move(e.pointerId, ...canvasPoint(e)));
  for (const type of ["pointerup", "pointercancel"]) {
    canvas.addEventListener(type, (e) => touch.end(e.pointerId));
  }

  // merge keyboard and touch into one input for the game; one-shot actions fire here
  function readInput() {
    const ka = keyboard.axes(), ta = touch.axes();
    const input = {
      mx: ka.x || ta.x, my: ka.y || ta.y,
      fire: keyboard.fire() || touch.fire(),
    };
    const kp = keyboard.takePressed(), tp = touch.takePressed();
    if (kp.pause) BB.togglePause(game);
    if (kp.special || tp.special) BB.special(game);
    if (kp.kaboom || tp.kaboom) BB.kaboom(game);
    return input;
  }

  function drawShip(s) {
    ctx.fillStyle = "#4df";
    ctx.beginPath();
    ctx.moveTo(s.x + s.w / 2, s.y);
    ctx.lineTo(s.x + s.w, s.y + s.h);
    ctx.lineTo(s.x + s.w / 2, s.y + s.h - 6);
    ctx.lineTo(s.x, s.y + s.h);
    ctx.closePath();
    ctx.fill();
  }

  function drawDrone(d) {
    ctx.fillStyle = "#f5a";
    ctx.fillRect(d.x + 4, d.y + 4, d.w - 8, d.h - 8);
    ctx.fillStyle = "#fd4";
    ctx.fillRect(d.x, d.y + 8, d.w, 4);
    ctx.fillRect(d.x + 9, d.y + 8, 3, 3);
    ctx.fillRect(d.x + 16, d.y + 8, 3, 3);
  }

  function center(text, y, size, color) {
    ctx.fillStyle = color;
    ctx.font = "bold " + size + "px monospace";
    ctx.textAlign = "center";
    ctx.fillText(text, BB.W / 2, y);
  }

  function circle(x, y, r, fill, stroke) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 3; ctx.stroke(); }
  }

  function label(text, b) {
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "center";
    ctx.fillText(text, b.x, b.y + 4);
  }

  // semi-transparent floating stick, FIRE, SPECIAL with reload ring, KABOOM with charge pips
  function drawControls() {
    const st = touch.stick.state;
    if (st.active) {
      circle(st.cx, st.cy, BBInput.STICK.max, "rgba(255,255,255,0.08)", "rgba(255,255,255,0.3)");
      circle(st.kx, st.ky, 22, "rgba(77,221,255,0.4)");
    }
    const B = BBInput.BUTTONS;
    ctx.globalAlpha = touchSeen ? 1 : 0.35;
    circle(B.fire.x, B.fire.y, B.fire.r, "rgba(255,80,80,0.3)", "rgba(255,120,120,0.6)");
    label("FIRE", B.fire);
    circle(B.special.x, B.special.y, B.special.r, "rgba(77,221,255,0.25)", "rgba(77,221,255,0.4)");
    const ready = 1 - game.specialCooldown / BB.SPECIAL.cooldown;
    ctx.beginPath();
    ctx.arc(B.special.x, B.special.y, B.special.r, -Math.PI / 2, -Math.PI / 2 + ready * Math.PI * 2);
    ctx.strokeStyle = ready >= 1 ? "#4df" : "rgba(255,255,255,0.7)";
    ctx.lineWidth = 4;
    ctx.stroke();
    label("SPEC", B.special);
    circle(B.kaboom.x, B.kaboom.y, B.kaboom.r, "rgba(255,200,60,0.25)", "rgba(255,200,60,0.5)");
    label("BOOM", B.kaboom);
    for (let i = 0; i < BB.KABOOM.maxCharges; i++) {
      circle(B.kaboom.x - 12 + i * 12, B.kaboom.y + B.kaboom.r + 10, 4,
        i < game.kaboomCharges ? "#fd4" : "rgba(255,255,255,0.2)");
    }
    ctx.globalAlpha = 1;
  }

  const RANK_COLOR = { bronze: "#c8843c", silver: "#cfd6e0", gold: "#ffd23c" };

  function rankColor(rank) {
    if (rank !== "rainbow") return RANK_COLOR[rank];
    return "hsl(" + Math.floor(performance.now() / 4) % 360 + ",90%,60%)";
  }

  // winged capsule: a coloured pill with a small wing on each side
  function drawCapsule(c) {
    const color = rankColor(c.rank), cy = c.y + c.h / 2;
    ctx.fillStyle = color;
    for (const side of [-1, 1]) {
      const ex = side < 0 ? c.x : c.x + c.w;
      ctx.beginPath();
      ctx.moveTo(ex - side * 8, cy);
      ctx.lineTo(ex + side * 4, c.y - 3);
      ctx.lineTo(ex + side * 4, c.y + c.h + 3);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillRect(c.x + 6, c.y, c.w - 12, c.h);
    ctx.fillStyle = "#050514";
    ctx.fillRect(c.x + c.w / 2 - 1, c.y + 3, 2, c.h - 6);
  }

  function drawEscort(e) {
    ctx.fillStyle = "#8ff";
    ctx.fillRect(e.x + 4, e.y, e.w - 8, e.h);
    ctx.fillRect(e.x, e.y + 6, e.w, 4);
  }

  // HUD: weapon level pips, shield hits, escort count and the Super Star timer, under the top row
  function drawRewardHud() {
    const R = BB.R(), y = 44;
    ctx.textAlign = "left";
    ctx.font = "12px monospace";
    ctx.fillStyle = "#fff";
    ctx.fillText("WPN", 12, y);
    for (let i = 0; i < R.WEAPON.maxLevel; i++) {
      circle(52 + i * 11, y - 4, 4, i < game.weaponLevel ? RANK_COLOR.bronze : "rgba(255,255,255,0.2)");
    }
    ctx.fillStyle = "#fff";
    ctx.fillText("SHD", 12, y + 16);
    for (let i = 0; i < R.SHIELD.hits; i++) {
      circle(52 + i * 11, y + 12, 4, i < game.shield ? RANK_COLOR.silver : "rgba(255,255,255,0.2)");
    }
    ctx.fillStyle = "#fff";
    ctx.fillText("ESC", 12, y + 32);
    for (let i = 0; i < R.ESCORT.max; i++) {
      circle(52 + i * 11, y + 28, 4, i < game.escorts.length ? RANK_COLOR.gold : "rgba(255,255,255,0.2)");
    }
    if (game.superStar > 0) {
      ctx.fillStyle = rankColor("rainbow");
      ctx.fillRect(12, y + 40, 100 * (game.superStar / R.SUPER_STAR.duration), 6);
      ctx.fillStyle = "#fff";
      ctx.fillText("SUPER " + game.superStar.toFixed(1) + "s", 118, y + 46);
    }
  }

  function draw() {
    ctx.fillStyle = "#050514";
    ctx.fillRect(0, 0, BB.W, BB.H);
    ctx.fillStyle = "#fff";
    for (const s of stars) ctx.fillRect(s.x, s.y, s.size, s.size);

    for (const d of game.drones) drawDrone(d);
    for (const c of game.capsules) drawCapsule(c);
    for (const e of game.escorts) drawEscort(e);
    ctx.fillStyle = "#ff6";
    for (const b of game.bullets) ctx.fillRect(b.x, b.y, b.w, b.h);
    const blink = game.invuln > 0 && Math.floor(game.invuln * 10) % 2 === 0;
    if (game.status === "playing" && !blink) drawShip(game.ship);

    ctx.font = "16px monospace";
    ctx.fillStyle = "#fff";
    ctx.textAlign = "left";
    ctx.fillText("SCORE " + game.score, 12, 24);
    ctx.textAlign = "center";
    ctx.fillText("WAVE " + game.wave, BB.W / 2, 24);
    ctx.textAlign = "right";
    ctx.fillText("LIVES " + game.lives, BB.W - 12, 24);

    drawRewardHud();
    drawControls();

    if (game.paused) center("PAUSED", BB.H / 2, 40, "#fff");
    if (game.status === "over") {
      center("GAME OVER", BB.H / 2 - 10, 40, "#f55");
      center("Score " + game.score, BB.H / 2 + 26, 20, "#fff");
      center("Press Enter to restart", BB.H / 2 + 60, 18, "#4df");
    }
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    BB.update(game, dt, readInput());
    draw();
    requestAnimationFrame(frame);
  }
  function start() {
    game = BB.createGame();
    last = performance.now();
    requestAnimationFrame(frame);
  }
  // index.html only lists game.js, input.js and main.js, so main.js pulls rewards.js in itself
  if (globalThis.BBRewards) start();
  else {
    const s = document.createElement("script");
    s.src = "src/rewards.js";
    s.onload = start;
    s.onerror = () => console.error("Boredom Blaster: src/rewards.js failed to load");
    document.head.appendChild(s);
  }
  globalThis.__game = () => game; // handy for debugging in the console
})();
