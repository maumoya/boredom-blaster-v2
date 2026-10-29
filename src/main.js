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
  const assets = BBAssets.createAssets(() => new Image());
  const renderer = BBRender.createRenderer(ctx, assets);
  const menu = BBInput.createMenu({ screen: "howto", leftHanded: store.loadLeftHanded() });

  let game; // created once src/rewards.js has loaded (see the end of this file)
  let best = store.loadBest();
  const keyboard = BBInput.createKeyboard();
  const touch = BBInput.createTouch(menu.leftHanded);
  const mouse = BBInput.createMouse(touch);
  let touchSeen = false; // the on-screen buttons only show once a finger has been used

  function restart() {
    game = BB.restart();
    menu.screen = "playing";
  }

  function runMenuAction(action) {
    if (action === "swap") {
      touch.setLeftHanded(menu.leftHanded);
      store.saveLeftHanded(menu.leftHanded);
    } else if (action === "restart") restart();
  }

  addEventListener("keydown", (e) => {
    if (e.code === "Enter") {
      if (game.status === "over") { restart(); return; }
      if (menu.screen !== "playing") { runMenuAction(menu.activate()); e.preventDefault(); return; }
    }
    if (menu.screen === "pause") {
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
    if (game.status === "over") { restart(); return true; }
    if (menu.screen === "howto") { runMenuAction(menu.activate()); return true; }
    if (menu.screen === "pause") {
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
    if (kp.kaboom || tp.kaboom) BB.kaboom(game);
    return input;
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const input = readInput();
    game.paused = menu.screen !== "playing";
    BB.update(game, dt, input);
    if (!game.paused) renderer.update(dt, game);
    if (game.score > best) best = store.saveBest(game.score);
    renderer.draw({ game, menu, best, touch, touchSeen, time: now / 1000 });
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
