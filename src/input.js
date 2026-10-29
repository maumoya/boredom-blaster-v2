// Boredom Blaster input logic: floating joystick, touch buttons, keyboard. Plain script like game.js;
// the tests load it in Node and read globalThis.BBInput. No DOM access here.
(function (root) {
  const W = 480, H = 640;
  const STICK = { max: 60, dead: 8 }; // px, in canvas coordinates
  const BUTTONS = {
    fire: { x: 400, y: 570, r: 42 },
    special: { x: 320, y: 595, r: 30 },
    kaboom: { x: 415, y: 480, r: 30 },
  };
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

  function buttonAt(x, y) {
    for (const name of Object.keys(BUTTONS)) {
      const b = BUTTONS[name];
      if (Math.hypot(x - b.x, y - b.y) <= b.r + HIT_PAD) return name;
    }
    return null;
  }

  // Touch: left half steers, right half presses buttons. Pointers are tracked by id so thumbs stay separate.
  function createTouch() {
    const stick = createJoystick();
    const held = new Map(); // pointer id -> button name
    const pressed = { special: false, kaboom: false };

    return {
      stick,
      start(id, x, y) {
        if (x < W / 2) { stick.start(id, x, y); return; }
        const name = buttonAt(x, y);
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
      fire() { return [...held.values()].includes("fire"); },
      takePressed() {
        const out = { ...pressed };
        pressed.special = false; pressed.kaboom = false;
        return out;
      },
    };
  }

  const KEYS = {
    ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right",
    ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down",
    Space: "fire",
  };
  const KEY_PRESSES = { KeyX: "special", KeyB: "kaboom", KeyP: "pause" };

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

  root.BBInput = { STICK, BUTTONS, createJoystick, createTouch, createKeyboard, buttonAt };
})(globalThis);
