// Boredom Blaster browser shell: input wiring, menus, best score and the frame loop.
// Drawing lives in src/render.js, sprites in src/assets.js.
(function () {
  const BB = globalThis.BB;
  const canvas = document.getElementById("screen");
  const ctx = canvas.getContext("2d");
  let logicalH = BB.H; // game units tall: the playfield plus the controls zone, if any
  // sharp rendering: the backing store is the shown size x devicePixelRatio, drawing stays in 480-wide game units
  const hd = BBInput.createHd(canvas, ctx, {
    css: () => { const r = canvas.getBoundingClientRect(); return { width: r.width || BB.W, height: r.height || BB.H }; },
    ratio: () => globalThis.devicePixelRatio || 1,
  });
  hd.sync();
  ctx.imageSmoothingQuality = "high";

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
  const keys = BBKeys.createKeys(storage); // bb.keys
  const settings = BBKeys.createSettings(storage); // bb.settings: music, sounds, vibration
  const controls = BBKeys.createControls(storage); // bb.controls: controls zone below, D-pad
  const padMap = BBKeys.createPad(storage); // bb.pad: controller buttons
  const menu = BBInput.createMenu({ screen: "title", leftHanded: store.loadLeftHanded(), keys, settings, controls, pad: padMap });
  const gamepad = BBInput.createGamepad({ pad: padMap });

  // sound: starts on the first key, tap or click; volumes and presets live in the Settings screen
  const audio = BBAudio.createAudio({ settings, storage });
  const haptics = BBAudio.createHaptics({ settings });
  const unlockAudio = () => audio.unlock();
  addEventListener("keydown", unlockAudio);
  addEventListener("pointerdown", unlockAudio);
  Object.assign(BBInput.SETTINGS_LAYOUT, { h: 22, gap: 1 }); // three more rows (two volumes, presets) need tighter rows
  const baseRows = menu.settingsRows;
  menu.settingsRows = () => {
    const rows = baseRows();
    const at = rows.findIndex((r) => r.type === "control");
    rows.splice(at, 0,
      { type: "volume", kind: "music", label: "Music volume", value: audio.volume("music") + "%" },
      { type: "volume", kind: "effects", label: "Effects volume", value: audio.volume("effects") + "%" },
      { type: "preset", label: "Sound preset", value: audio.preset() });
    return rows;
  };
  const baseActivate = menu.activate;
  menu.activate = (index) => {
    if (menu.screen !== "settings") return baseActivate(index);
    const i = index === undefined ? menu.cursor : index, row = menu.settingsRows()[i];
    if (!row || (row.type !== "volume" && row.type !== "preset")) return baseActivate(index);
    menu.cursor = i;
    if (row.type === "preset") audio.nextPreset();
    else audio.setVolume(row.kind, (audio.volume(row.kind) + BBAudio.STEP) % (100 + BBAudio.STEP)); // Enter cycles 0..100 %
    audio.play("click");
    return "audio";
  };
  // left / right on a volume row, or a tap on its left / right part, steps the volume by 10 %
  function nudgeVolume(i, dir) {
    const row = menu.settingsRows()[i];
    if (!row || row.type !== "volume") return false;
    menu.cursor = i;
    audio.stepVolume(row.kind, dir);
    audio.play("click");
    return true;
  }

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
  const keyboard = BBInput.createKeyboard(keys);
  const touch = BBInput.createTouch(menu.leftHanded);
  const mouse = BBInput.createMouse(touch);
  let touchSeen = false; // the on-screen buttons only show once a finger has been used

  // On a tall screen the buttons get their own zone under the playfield: the canvas grows taller than 3:4.
  let layoutKey = "";
  function syncLayout() {
    const sw = innerWidth, sh = innerHeight;
    const zone = BBInput.controlsZone(sw, sh, controls.get("below"));
    const zoneH = zone === "below" ? BBInput.zoneHeightFor(sw, sh) : 0;
    const dpad = controls.get("dpad");
    const key = [zone, zoneH, menu.leftHanded, dpad].join("|");
    if (key === layoutKey) return;
    layoutKey = key;
    logicalH = BB.H + zoneH;
    canvas.style.aspectRatio = BB.W + " / " + (BB.H + zoneH);
    touch.setLayout(BBInput.layoutFor({ zone, zoneH, leftHanded: menu.leftHanded, dpad }));
  }

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
    if (menu.screen === "settings" && menu.padCapturing !== null && e.code === "Escape") { // cancel the pad remap
      menu.padCapturing = null;
      e.preventDefault();
      return;
    }
    if (menu.screen === "settings" && menu.capturing) { // the row is waiting for its new key
      if (menu.capture(e.code) === "bound") keyboard.releaseAll();
      e.preventDefault();
      return;
    }
    const action = keys.actionFor(e.code);
    if (e.code === "KeyG" && !action && menu.openSettings()) { e.preventDefault(); return; }
    if (menu.screen === "scores" && SCORE_TAB_KEYS.includes(e.code)) {
      scoresTab = scoresTab === "global" ? "device" : "global";
      e.preventDefault();
      return;
    }
    if (e.code === "Enter") {
      if (menu.screen !== "playing") { runMenuAction(menu.activate()); e.preventDefault(); return; }
    }
    if (menu.screen === "pause" || menu.screen === "title" || menu.screen === "settings") {
      if (action === "up") { menu.move(-1); e.preventDefault(); return; }
      if (action === "down") { menu.move(1); e.preventDefault(); return; }
      if (menu.screen === "settings" && (action === "left" || action === "right") && nudgeVolume(menu.cursor, action === "left" ? -1 : 1)) { e.preventDefault(); return; }
    }
    if (keyboard.keydown(e.code)) e.preventDefault();
  });
  addEventListener("keyup", (e) => keyboard.keyup(e.code));

  // pointer position in canvas coordinates (the canvas is scaled by CSS)
  function canvasPoint(e) {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * (BB.W / r.width), (e.clientY - r.top) * (logicalH / r.height)];
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
    if (menu.gearHit(x, y)) { menu.openSettings(); return true; }
    if (menu.screen === "settings") {
      const i = menu.itemAt(x, y);
      const L = BBInput.SETTINGS_LAYOUT;
      if (i >= 0 && !nudgeVolume(i, x < L.x + L.w * 0.6 ? -1 : 1)) menu.activate(i);
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
    if (BBAudio.speakerHit(x, y)) { audio.toggleMute(); return; } // the speaker icon in the top bar
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
  // the controller in menus: stick or D-pad up/down moves, A picks; while the Settings pad remap waits, the next button binds
  function padMenu() {
    const nav = gamepad.takeNav();
    if (menu.padCapturing !== null) {
      const b = gamepad.newButton();
      if (b !== null) menu.padCapture(b);
      return true;
    }
    if (menu.screen === "playing") return false;
    if (menu.screen === "initials") { if (nav.confirm) confirmInitials(); return true; }
    if (menu.screen === "settings" && menu.capturing) return true;
    if (nav.up) menu.move(-1);
    if (nav.down) menu.move(1);
    if (nav.confirm) runMenuAction(menu.activate());
    return false;
  }

  function readInput() {
    gamepad.poll();
    const padBusy = padMenu(); // a remap or the initials picker owns the pad this frame
    const ka = keyboard.axes(), ta = touch.axes(), pa = gamepad.axes();
    const input = {
      mx: ka.x || ta.x || pa.x, my: ka.y || ta.y || pa.y,
      fire: keyboard.fire() || touch.fire() || gamepad.fire(),
    };
    const kp = keyboard.takePressed(), tp = touch.takePressed();
    const pp = gamepad.takePressed();
    if (padBusy) Object.keys(pp).forEach((a) => { pp[a] = false; });
    if ((kp.pause || pp.pause) && game.status === "playing") menu.toggle();
    if (kp.mute || pp.mute) audio.toggleMute(); // M or the pad's Y: all sound off, or back on
    if (menu.screen !== "playing") return {};
    if (kp.special || tp.special || pp.special) BB.special(game);
    if ((kp.kaboom || tp.kaboom || pp.kaboom) && BB.kaboom(game)) stats.kaboomUsed();
    return input;
  }

  let last = performance.now();
  function frame(now) {
    const rawDt = (now - last) / 1000, dt = Math.min(rawDt, 0.05);
    last = now;
    syncLayout();
    hd.frame(rawDt); // resize / zoom / slow-frame step-down redo the backing store; also resets the scale
    const input = readInput();
    game.paused = menu.screen !== "playing";
    const livesBefore = game.lives;
    BB.update(game, dt, input);
    if (game.lives < livesBefore) haptics.hit(); // Android buzz or iPhone haptic tick; shake and red flash come from the renderer
    audio.observe(game);
    audio.setTheme(menu.screen === "playing" || menu.screen === "pause" ? (game.drones.some((d) => d.boss) ? "boss" : "play") : "title", game.wave);
    audio.tick();
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
    renderer.draw({ game, menu, best, touch, touchSeen, padConnected: gamepad.connected(), firing: keyboard.fire() || gamepad.fire(), time: now / 1000, muted: audio.muted(), scores, results, highlight, picker, tab: scoresTab, net: netView });
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
