// Boredom Blaster browser shell: input wiring, menus, best score and the frame loop.
// Drawing lives in src/render.js, sprites in src/assets.js.
(function () {
  const BB = globalThis.BB;
  const canvas = document.getElementById("screen");
  const ctx = canvas.getContext("2d");
  canvas.width = BB.W;
  canvas.height = BB.H;

  let storage = null;
  try { storage = globalThis.localStorage; } catch (e) { /* blocked: best score just won't persist */ }
  const store = BBInput.createStore(storage);
  const scoreStore = BBScores.createStore(storage);
  const HIGHLIGHT_SECONDS = 3; // a new high-score row blinks this long
  const assets = BBAssets.createAssets(() => new Image());
  // reduced motion (the OS setting) turns off pulses, background drift and screen shake
  const motionQuery = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  const renderer = BBRender.createRenderer(ctx, assets, { reducedMotion: !!(motionQuery && motionQuery.matches) });
  if (motionQuery && motionQuery.addEventListener) {
    motionQuery.addEventListener("change", (e) => renderer.setReducedMotion(e.matches));
  }
  const menu = BBInput.createMenu({ screen: "title", leftHanded: store.loadLeftHanded() });

  let game; // created once src/rewards.js has loaded (see the end of this file)
  let best = store.loadBest();
  let scores = scoreStore.load();
  const net = BBScoresNet.createClient(); // empty API address = offline: the game only uses the local table
  let netView = { status: net.enabled ? "idle" : "offline", list: [] }; // the GLOBAL tab: offline | idle | loading | ok | error
  let scoresTab = net.enabled ? "global" : "device";
  let netLoad = 0; // counts requests so an old answer never replaces a newer one
  let wasOnScores = false;
  let highlight = null; // { index, until }: the new row blinks until this time (seconds)
  let picker = null; // the initials picker while a new record is being entered
  let runSeconds = 0; // play time of this run, for the score plausibility check
  let stats = BBInput.createRunStats(); // goals and boss-wave lives for the results screen
  let results = null;
  const keyboard = BBInput.createKeyboard();
  const touch = BBInput.createTouch(menu.leftHanded);
  const mouse = BBInput.createMouse(touch);
  let touchSeen = false; // the on-screen buttons only show once a finger has been used

  function refreshGlobal() {
    if (!net.enabled) return;
    const mine = ++netLoad;
    netView = { status: "loading", list: netView.list };
    net.fetchTop().then((r) => {
      if (mine === netLoad) netView = r.ok ? { status: "ok", list: r.list } : { status: "error", list: [] };
    });
  }

  function restart() {
    game = BB.restart();
    stats = BBInput.createRunStats();
    results = null;
    picker = null;
    runSeconds = 0;
    menu.screen = "playing";
  }

  function runMenuAction(action) {
    if (action === "swap") {
      touch.setLeftHanded(menu.leftHanded);
      store.saveLeftHanded(menu.leftHanded);
    } else if (action === "restart" || action === "start") restart();
  }

  // Enter or OK in the picker saves the record and shows the results with the new row blinking
  function confirmInitials() {
    const r = scoreStore.add({ initials: BBScores.cleanInitials(picker.value()), score: game.score, wave: game.wave, date: Date.now() });
    scores = r.list;
    if (net.enabled) net.submit({ initials: BBScores.cleanInitials(picker.value()), score: game.score, wave: game.wave, seconds: Math.round(runSeconds) });
    highlight = r.index >= 0 ? { index: r.index, until: performance.now() / 1000 + HIGHLIGHT_SECONDS } : null;
    picker = null;
    menu.finish();
  }
  const PICKER_KEYS = { ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down", ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right" };

  const SCORE_TAB_KEYS = ["ArrowLeft", "ArrowRight", "KeyA", "KeyD", "Tab"];

  addEventListener("keydown", (e) => {
    if (menu.screen === "initials") {
      if (e.code === "Enter") confirmInitials();
      else if (PICKER_KEYS[e.code]) picker[PICKER_KEYS[e.code]]();
      else return;
      e.preventDefault();
      return;
    }
    if (menu.screen === "scores" && SCORE_TAB_KEYS.includes(e.code)) {
      scoresTab = scoresTab === "global" ? "device" : "global";
      e.preventDefault();
      return;
    }
    if (e.code === "Enter") {
      if (menu.screen !== "playing") { runMenuAction(menu.activate()); e.preventDefault(); return; }
    }
    if (menu.screen === "pause" || menu.screen === "title") {
      if (e.code === "ArrowUp" || e.code === "KeyW") { menu.move(-1); e.preventDefault(); return; }
      if (e.code === "ArrowDown" || e.code === "KeyS") { menu.move(1); e.preventDefault(); return; }
    }
    if (keyboard.keydown(e.code)) e.preventDefault();
  });
  addEventListener("keyup", (e) => keyboard.keyup(e.code));

  // pointer position in canvas coordinates (the canvas is scaled by CSS)
  function canvasPoint(e) {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * (BB.W / r.width), (e.clientY - r.top) * (BB.H / r.height)];
  }
  // returns true when the click was used by a menu or the game-over screen
  function handleScreenClick(x, y) {
    if (menu.screen === "initials") { if (picker.tap(x, y) === "ok") confirmInitials(); return true; }
    if (menu.screen === "results") { restart(); return true; }
    if (menu.screen === "scores") {
      const tab = BBRender.scoreTabHit(x, y);
      if (tab) scoresTab = tab;
      else runMenuAction(menu.activate());
      return true;
    }
    if (menu.screen === "howto") { runMenuAction(menu.activate()); return true; }
    if (menu.screen === "pause" || menu.screen === "title") {
      const i = menu.itemAt(x, y);
      if (i >= 0) runMenuAction(menu.activate(i));
      return true;
    }
    return false;
  }
  canvas.addEventListener("pointerdown", (e) => {
    const [x, y] = canvasPoint(e);
    const isMouse = e.pointerType === "mouse";
    if (!isMouse) touchSeen = true;
    if (handleScreenClick(x, y)) return;
    if (BBInput.pauseHit(x, y)) { menu.toggle(); return; } // the pause icon in the top bar
    canvas.setPointerCapture(e.pointerId);
    if (isMouse) mouse.down(x, y, e.button);
    else touch.start(e.pointerId, x, y);
  });
  canvas.addEventListener("pointermove", (e) => {
    const [x, y] = canvasPoint(e);
    if (e.pointerType === "mouse") mouse.move(x, y);
    else touch.move(e.pointerId, x, y);
  });
  for (const type of ["pointerup", "pointercancel"]) {
    canvas.addEventListener(type, (e) => {
      if (e.pointerType === "mouse") mouse.up();
      else touch.end(e.pointerId);
    });
  }

  // merge keyboard and touch into one input for the game; one-shot actions fire here
  function readInput() {
    const ka = keyboard.axes(), ta = touch.axes();
    const input = {
      mx: ka.x || ta.x, my: ka.y || ta.y,
      fire: keyboard.fire() || touch.fire(),
    };
    const kp = keyboard.takePressed(), tp = touch.takePressed();
    if (kp.pause && game.status === "playing") menu.toggle();
    if (menu.screen !== "playing") return {};
    if (kp.special || tp.special) BB.special(game);
    if ((kp.kaboom || tp.kaboom) && BB.kaboom(game)) stats.kaboomUsed();
    return input;
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const input = readInput();
    game.paused = menu.screen !== "playing";
    BB.update(game, dt, input);
    if (!game.paused) { renderer.update(dt, game); runSeconds += dt; }
    if (!game.paused) stats.observe(game);
    if (game.score > best) best = store.saveBest(game.score);
    if (game.status === "over" && menu.screen === "playing") { // the run just ended: results replace game over
      results = stats.result(game);
      if (BBScores.plausible(game.score, game.wave, runSeconds) && BBScores.qualifies(scores, game.score)) {
        picker = BBInput.createInitialsPicker();
        menu.screen = "initials";
      } else menu.finish();
    }
    const onScores = menu.screen === "scores";
    if (onScores && !wasOnScores) refreshGlobal(); // opening the table asks the server again
    wasOnScores = onScores;
    renderer.draw({ game, menu, best, touch, touchSeen, firing: keyboard.fire(), time: now / 1000, scores, results, highlight, picker, tab: scoresTab, net: netView });
    requestAnimationFrame(frame);
  }
  function start() {
    game = BB.createGame();
    last = performance.now();
    requestAnimationFrame(frame);
  }
  // index.html lists game.js, input.js and main.js; main.js pulls rewards.js in itself
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
