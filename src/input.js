// Boredom Blaster input logic: floating joystick, touch buttons, keyboard. Plain script like game.js;
// the tests load it in Node and read globalThis.BBInput. No DOM access here.
(function (root) {
  const W = 480, H = 640;
  const STICK = { max: 60, dead: 8 }; // px, in canvas coordinates
  const BUTTONS = {
    fire: { x: 418, y: 574, r: 38 },
    special: { x: 338, y: 580, r: 30 },
    kaboom: { x: 280, y: 580, r: 26 },
  };
  const TRAY_H = 120; // the controls tray: the bottom 120 px, off the playfield
  const PLAY_H = H - TRAY_H;
  const PAUSE_BUTTON = { x: W - 44, y: 5, w: 38, h: 22 }; // in the top bar
  const pauseHit = (x, y) => x >= PAUSE_BUTTON.x - 6 && x <= PAUSE_BUTTON.x + PAUSE_BUTTON.w + 6 &&
    y >= PAUSE_BUTTON.y - 4 && y <= PAUSE_BUTTON.y + PAUSE_BUTTON.h + 8;
  const HIT_PAD = 10; // generous thumb target around each button

  // Floating stick: appears where the thumb lands; the center trails a finger dragged past the clamp.
  function createJoystick() {
    const s = { id: null, cx: 0, cy: 0, kx: 0, ky: 0, x: 0, y: 0, active: false };

    function recompute() {
      let dx = s.kx - s.cx, dy = s.ky - s.cy;
      let len = Math.hypot(dx, dy);
      if (len > STICK.max) { // trail: drag the center along so the knob stays on the clamp circle
        const k = STICK.max / len;
        s.cx = s.kx - dx * k;
        s.cy = s.ky - dy * k;
        dx *= k; dy *= k; len = STICK.max;
        s.kx = s.cx + dx; s.ky = s.cy + dy;
      }
      if (len < STICK.dead) { s.x = 0; s.y = 0; return; }
      s.x = dx / STICK.max;
      s.y = dy / STICK.max;
    }

    return {
      state: s,
      start(id, x, y) {
        if (s.active) return false;
        Object.assign(s, { id, cx: x, cy: y, kx: x, ky: y, active: true });
        recompute();
        return true;
      },
      move(id, x, y) {
        if (!s.active || s.id !== id) return;
        s.kx = x; s.ky = y;
        recompute();
      },
      end(id) {
        if (!s.active || s.id !== id) return;
        Object.assign(s, { id: null, active: false, x: 0, y: 0 });
      },
    };
  }

  // Left-hand swap: the buttons move to the left half, the stick to the right.
  function mirrorButtons() {
    const out = {};
    for (const name of Object.keys(BUTTONS)) out[name] = { ...BUTTONS[name], x: W - BUTTONS[name].x };
    return out;
  }
  const MIRRORED = mirrorButtons();
  const buttonsFor = (leftHanded) => (leftHanded ? MIRRORED : BUTTONS);

  function buttonAt(x, y, buttons) {
    buttons = buttons || BUTTONS;
    for (const name of Object.keys(buttons)) {
      const b = buttons[name];
      if (Math.hypot(x - b.x, y - b.y) <= b.r + HIT_PAD) return name;
    }
    return null;
  }

  // Touch: left half steers, right half presses buttons. Pointers are tracked by id so thumbs stay separate.
  function createTouch(leftHanded) {
    let swapped = !!leftHanded;
    const stick = createJoystick();
    const held = new Map(); // pointer id -> button name
    const pressed = { special: false, kaboom: false };

    return {
      stick,
      setLeftHanded(on) {
        swapped = !!on;
        held.clear();
        if (stick.state.active) stick.end(stick.state.id);
      },
      buttons() { return buttonsFor(swapped); },
      start(id, x, y) {
        if ((x < W / 2) !== swapped) { stick.start(id, x, y); return; }
        const name = buttonAt(x, y, buttonsFor(swapped));
        if (!name) return;
        held.set(id, name);
        if (name === "special" || name === "kaboom") pressed[name] = true;
      },
      move(id, x, y) {
        stick.move(id, x, y);
      },
      end(id) {
        stick.end(id);
        held.delete(id);
      },
      axes() { return { x: stick.state.x, y: stick.state.y }; },
      isHeld(name) { return [...held.values()].includes(name); },
      fire() { return [...held.values()].includes("fire"); },
      takePressed() {
        const out = { ...pressed };
        pressed.special = false; pressed.kaboom = false;
        return out;
      },
    };
  }

  // Mouse on the Mac: press-and-drag on the stick half steers like a thumb; the other half works as taps.
  // Uses the fixed pointer id "mouse" so it shares the touch logic.
  const MOUSE_ID = "mouse";
  function createMouse(touch) {
    let down = false;
    return {
      down(x, y, button) {
        if (button !== undefined && button !== 0) return false;
        down = true;
        touch.start(MOUSE_ID, x, y);
        return true;
      },
      move(x, y) { if (down) touch.move(MOUSE_ID, x, y); },
      up() { down = false; touch.end(MOUSE_ID); },
      isDown: () => down,
    };
  }

  const KEYS = {
    ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right",
    ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down",
    Space: "fire",
  };
  const KEY_PRESSES = { KeyX: "special", KeyB: "kaboom", KeyP: "pause", Escape: "pause" };

  function createKeyboard() {
    const down = {};
    const pressed = { special: false, kaboom: false, pause: false };
    return {
      keydown(code) {
        if (KEYS[code]) { down[KEYS[code]] = true; return true; }
        if (KEY_PRESSES[code]) { pressed[KEY_PRESSES[code]] = true; return true; }
        return false;
      },
      keyup(code) {
        if (KEYS[code]) down[KEYS[code]] = false;
      },
      axes() {
        const x = (down.right ? 1 : 0) - (down.left ? 1 : 0);
        const y = (down.down ? 1 : 0) - (down.up ? 1 : 0);
        const len = Math.hypot(x, y);
        return len > 1 ? { x: x / len, y: y / len } : { x, y };
      },
      fire() { return !!down.fire; },
      takePressed() {
        const out = { ...pressed };
        pressed.special = false; pressed.kaboom = false; pressed.pause = false;
        return out;
      },
    };
  }

  // Best score and settings in localStorage-like storage; a missing or broken store never throws.
  const BEST_KEY = "bb.best", LEFT_KEY = "bb.leftHanded";
  function createStore(storage) {
    const read = (k) => { try { return storage ? storage.getItem(k) : null; } catch (e) { return null; } };
    const write = (k, v) => { try { if (storage) storage.setItem(k, String(v)); } catch (e) { /* storage full or blocked */ } };
    return {
      loadBest() {
        const n = Number(read(BEST_KEY));
        return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
      },
      saveBest(score) { // keeps only a higher score; returns the best now stored
        const best = this.loadBest();
        if (Number.isFinite(score) && score > best) { write(BEST_KEY, Math.floor(score)); return Math.floor(score); }
        return best;
      },
      loadLeftHanded: () => read(LEFT_KEY) === "1",
      saveLeftHanded(on) { write(LEFT_KEY, on ? "1" : "0"); },
    };
  }

  // Screens: "howto" (shown at start), "playing", "pause". Pause items are picked by key or click.
  const MENU_LAYOUT = { x: 140, y: 270, w: 200, h: 38, gap: 12 };
  const MENU_ACTIONS = ["resume", "howto", "swap", "restart"];
  function createMenu(opts) {
    opts = opts || {};
    const m = { screen: opts.screen || "howto", cursor: 0, leftHanded: !!opts.leftHanded, after: "playing" };
    m.items = () => ["Resume", "How to play", "Left-hand: " + (m.leftHanded ? "ON" : "OFF"), "Restart"];
    const leaveHowTo = () => { m.screen = m.after; m.after = "playing"; };
    m.toggle = () => { // P / Esc: pause, resume, or dismiss how-to-play
      if (m.screen === "playing") { m.screen = "pause"; m.cursor = 0; }
      else if (m.screen === "pause") m.screen = "playing";
      else leaveHowTo();
      return m.screen;
    };
    m.move = (d) => {
      if (m.screen === "pause") m.cursor = (m.cursor + d + MENU_ACTIONS.length) % MENU_ACTIONS.length;
    };
    m.itemAt = (x, y) => {
      if (m.screen !== "pause") return -1;
      const L = MENU_LAYOUT;
      for (let i = 0; i < MENU_ACTIONS.length; i++) {
        const top = L.y + i * (L.h + L.gap);
        if (x >= L.x && x <= L.x + L.w && y >= top && y <= top + L.h) return i;
      }
      return -1;
    };
    // returns "resume" | "howto" | "swap" | "restart" | null
    m.activate = (index) => {
      if (m.screen === "howto") { leaveHowTo(); return "resume"; }
      if (m.screen !== "pause") return null;
      const i = index === undefined ? m.cursor : index;
      const action = MENU_ACTIONS[i];
      if (!action) return null;
      m.cursor = i;
      if (action === "howto") { m.after = "pause"; m.screen = "howto"; }
      else if (action === "swap") m.leftHanded = !m.leftHanded;
      else m.screen = "playing"; // resume or restart
      return action;
    };
    return m;
  }

  root.BBInput = {
    STICK, BUTTONS, TRAY_H, PLAY_H, PAUSE_BUTTON, pauseHit, MENU_LAYOUT, createJoystick, createTouch, createMouse, createKeyboard,
    createStore, createMenu, buttonAt, buttonsFor, mirrorButtons,
  };
})(globalThis);
