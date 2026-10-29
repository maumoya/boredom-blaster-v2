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
  const BEST_KEY = "bb.best", LEFT_KEY = "bb.leftHanded", SCORES_KEY = "bb.scores", MAX_SCORES = 5;
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
      loadScores() { // [{ score, wave }], best first, at most MAX_SCORES
        let list;
        try { list = JSON.parse(read(SCORES_KEY)); } catch (e) { return []; }
        if (!Array.isArray(list)) return [];
        return list
          .filter((s) => s && Number.isFinite(s.score) && s.score > 0)
          .map((s) => ({ score: Math.floor(s.score), wave: Math.max(1, Math.floor(s.wave) || 1) }))
          .sort((a, b) => b.score - a.score).slice(0, MAX_SCORES);
      },
      addScore(score, wave) { // returns the table now stored
        const list = this.loadScores();
        if (!Number.isFinite(score) || score <= 0) return list;
        const next = [...list, { score: Math.floor(score), wave }].sort((a, b) => b.score - a.score).slice(0, MAX_SCORES);
        write(SCORES_KEY, JSON.stringify(next));
        return this.loadScores();
      },
    };
  }

  // Screens: "title", "scores", "howto", "playing", "pause", "results". Title and pause items are
  // picked by key or click; "howto" and "scores" go back to where they were opened from.
  const MENU_LAYOUT = { x: 140, y: 270, w: 200, h: 38, gap: 12 };
  const TITLE_LAYOUT = { x: 140, y: 330, w: 200, h: 42, gap: 14 };
  const MENU_ACTIONS = ["resume", "howto", "swap", "restart"];
  const TITLE_ACTIONS = ["start", "scores", "howto"];
  const TITLE_ITEMS = ["START", "HIGH SCORES", "HOW TO PLAY"];
  function createMenu(opts) {
    opts = opts || {};
    const m = { screen: opts.screen || "howto", cursor: 0, leftHanded: !!opts.leftHanded, after: "playing" };
    m.items = () => ["Resume", "How to play", "Left-hand: " + (m.leftHanded ? "ON" : "OFF"), "Restart"];
    m.titleItems = () => TITLE_ITEMS.slice();
    const listFor = () => (m.screen === "title" ? TITLE_ACTIONS : m.screen === "pause" ? MENU_ACTIONS : null);
    const leaveHowTo = () => { m.screen = m.after; m.after = "playing"; m.cursor = 0; };
    m.toggle = () => { // P / Esc: pause, resume, or dismiss how-to-play / high scores
      if (m.screen === "playing") { m.screen = "pause"; m.cursor = 0; }
      else if (m.screen === "pause") m.screen = "playing";
      else if (m.screen === "howto" || m.screen === "scores") leaveHowTo();
      return m.screen;
    };
    m.finish = () => { m.screen = "results"; m.cursor = 0; }; // the run is over
    m.toTitle = () => { m.screen = "title"; m.cursor = 0; m.after = "playing"; };
    m.move = (d) => {
      const list = listFor();
      if (list) m.cursor = (m.cursor + d + list.length) % list.length;
    };
    m.itemAt = (x, y) => {
      const list = listFor();
      if (!list) return -1;
      const L = m.screen === "title" ? TITLE_LAYOUT : MENU_LAYOUT;
      for (let i = 0; i < list.length; i++) {
        const top = L.y + i * (L.h + L.gap);
        if (x >= L.x && x <= L.x + L.w && y >= top && y <= top + L.h) return i;
      }
      return -1;
    };
    // returns "start" | "scores" | "resume" | "howto" | "swap" | "restart" | null
    m.activate = (index) => {
      if (m.screen === "howto") { leaveHowTo(); return "resume"; }
      if (m.screen === "scores") { leaveHowTo(); return "back"; }
      if (m.screen === "results") return "restart"; // Enter = replay; the caller starts the new run
      if (m.screen === "title") {
        const action = TITLE_ACTIONS[index === undefined ? m.cursor : index];
        if (!action) return null;
        if (action === "start") m.screen = "playing";
        else { m.after = "title"; m.screen = action; }
        return action;
      }
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

  // ---- initials picker for a new record: three letter slots, up/down change a letter, OK confirms ----
  const INITIALS_LAYOUT = { slotX: [160, 240, 320], slotW: 60, upY: 230, downY: 340, boxH: 40, letterY: 305, ok: { x: 190, y: 410, w: 100, h: 44 } };
  function createInitialsPicker() {
    const L = INITIALS_LAYOUT, p = { letters: [0, 0, 0], slot: 0 };
    p.value = () => p.letters.map((n) => String.fromCharCode(65 + n)).join("");
    p.up = () => { p.letters[p.slot] = (p.letters[p.slot] + 1) % 26; };
    p.down = () => { p.letters[p.slot] = (p.letters[p.slot] + 25) % 26; };
    p.left = () => { p.slot = (p.slot + 2) % 3; };
    p.right = () => { p.slot = (p.slot + 1) % 3; };
    // what a point on the canvas hits: { type: "up"|"down"|"slot", slot } | { type: "ok" } | null
    p.hit = (x, y) => {
      const o = L.ok;
      if (x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h) return { type: "ok" };
      for (let i = 0; i < 3; i++) {
        if (Math.abs(x - L.slotX[i]) > L.slotW / 2) continue;
        if (y >= L.upY - L.boxH / 2 && y <= L.upY + L.boxH / 2) return { type: "up", slot: i };
        if (y >= L.downY - L.boxH / 2 && y <= L.downY + L.boxH / 2) return { type: "down", slot: i };
        if (y > L.upY + L.boxH / 2 && y < L.downY - L.boxH / 2) return { type: "slot", slot: i };
      }
      return null;
    };
    // applies a touch or click; returns "ok" when OK was hit
    p.tap = (x, y) => {
      const h = p.hit(x, y);
      if (!h) return null;
      if (h.type === "ok") return "ok";
      p.slot = h.slot;
      if (h.type === "up") p.up(); else if (h.type === "down") p.down();
      return null;
    };
    return p;
  }

  // ---- run results: stars and the goals checklist ----
  // 1 star at wave 5, 2 at wave 10, 3 at wave 15, and the third needs a clean boss wave (no life lost on one).
  const STAR_WAVES = [5, 10, 15];
  function starsFor(wave, bossLifeLost) {
    let n = STAR_WAVES.filter((w) => wave >= w).length;
    if (n === 3 && bossLifeLost) n = 2;
    return n;
  }

  // Watches one run: call observe(game) every frame and kaboomUsed() when a Kaboom fires.
  function createRunStats() {
    const s = { miniBossBeaten: false, kaboom: false, weaponMax: false, bossLifeLost: false };
    let prev = null;
    return {
      state: s,
      kaboomUsed() { s.kaboom = true; },
      observe(game) {
        const E = root.BBEnemies, maxLevel = root.BBRewards.WEAPON.maxLevel;
        if (game.weaponLevel >= maxLevel) s.weaponMax = true;
        if (prev) {
          const alive = new Set(game.drones);
          if (prev.drones.some((d) => d.boss && !alive.has(d))) s.miniBossBeaten = true;
          if (game.lives < prev.lives && E.waveScript(prev.wave).boss) s.bossLifeLost = true;
        }
        prev = { drones: game.drones.slice(), lives: game.lives, wave: game.wave };
      },
      result(game) {
        return {
          score: game.score, wave: game.wave, stars: starsFor(game.wave, s.bossLifeLost),
          goals: [
            { id: "miniboss", label: "Beat a mini-boss", done: s.miniBossBeaten },
            { id: "kaboom", label: "Use Kaboom", done: s.kaboom },
            { id: "weapon", label: "Weapon at MAX", done: s.weaponMax },
          ],
        };
      },
    };
  }

  root.BBInput = {
    STAR_WAVES, starsFor, createRunStats, TITLE_LAYOUT, TITLE_ACTIONS, MAX_SCORES,
    STICK, BUTTONS, TRAY_H, PLAY_H, PAUSE_BUTTON, pauseHit, MENU_LAYOUT, createJoystick, createTouch, createMouse, createKeyboard,
    createStore, createMenu, createInitialsPicker, INITIALS_LAYOUT, buttonAt, buttonsFor, mirrorButtons,
  };
})(globalThis);
