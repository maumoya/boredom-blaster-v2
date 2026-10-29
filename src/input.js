// Boredom Blaster input logic: floating joystick, touch buttons, keyboard. Plain script like game.js;
// the tests load it in Node and read globalThis.BBInput. No DOM access here.
(function (root) {
  const W = 480, H = root.BB_FIELD_H || 640; // index.html sets the full-screen height; 640 in tests
  const STICK = { max: 60, dead: 8 }; // px, in canvas coordinates
  const DY = H - 640; // on a tall screen the floating buttons keep their distance from the bottom edge
  const BUTTONS = {
    fire: { x: 418, y: 574 + DY, r: 38 },
    special: { x: 338, y: 580 + DY, r: 30 },
    kaboom: { x: 280, y: 580 + DY, r: 26 },
  };
  // LASER and TWIN: shown (and tappable) only while owned. They sit beside the classic buttons so that
  // BUTTONS / layoutFor stay as they were. Both inputs queue presses for game.update (see takeActions).
  const EXTRA_BUTTONS = { laser: { x: 418, y: 506 + DY, r: 26 }, twin: { x: 350, y: 516 + DY, r: 22 } };
  const EXTRA_BELOW = { laser: { x: 410, y: -62, r: 22 }, twin: { x: 264, y: -36, r: 20 } }; // y: from the zone centre
  const EXTRA_KEYS = { KeyK: "laser", KeyL: "twin" }; // used while keys.js has no binding for them
  const actionQueue = { laser: false, twin: false };
  function takeActions() {
    const out = { ...actionQueue };
    actionQueue.laser = false; actionQueue.twin = false;
    return out;
  }
  function extraButtons(layout, swapped) {
    const flip = (o) => (swapped ? { ...o, x: W - o.x } : { ...o });
    const out = {};
    for (const name of Object.keys(EXTRA_BUTTONS)) {
      out[name] = layout && layout.zoneH ? flip({ ...EXTRA_BELOW[name], y: H + (layout.zoneH - STRIP_H) / 2 + EXTRA_BELOW[name].y }) : flip(EXTRA_BUTTONS[name]);
    }
    return out;
  }
  const STRIP_H = 18; // the bottom HUD line (wave, skills, shield, BOOM) takes this much of the controls zone
  const TRAY_H = 0; // no tray: the buttons float over the playfield
  const PLAY_H = H;
  const PAUSE_BUTTON = { x: W - 44, y: 5, w: 38, h: 22 }; // in the top bar
  const pauseHit = (x, y) => x >= PAUSE_BUTTON.x - 6 && x <= PAUSE_BUTTON.x + PAUSE_BUTTON.w + 6 &&
    y >= PAUSE_BUTTON.y - 4 && y <= PAUSE_BUTTON.y + PAUSE_BUTTON.h + 8;
  const HIT_SCALE = 1.15; // a hit box is 15 % larger than the drawn button
  const ZONE_MIN_EXTRA = 140; // screen px taller than 3:4 before the controls get their own zone below the playfield
  const ZONE_MIN = 130, ZONE_MAX = 260; // canvas px the zone may take
  const DPAD_DEAD = 0.28; // fraction of the D-pad radius that counts as the centre

  // the controls always float over the full-screen playfield; the old "below" zone is retired
  function controlsZone() {
    return "overlay";
  }
  // canvas px of the zone for a screen: fills the extra height, within limits
  function zoneHeightFor(screenW, screenH) {
    if (!(screenW > 0) || !(screenH > 0)) return ZONE_MIN;
    return Math.max(ZONE_MIN, Math.min(ZONE_MAX, Math.round((W * screenH) / screenW - H)));
  }

  // client px -> game units. The drawing is scaled by width only (createHd: width / W), so both axes use W / rect.width
  function toGamePoint(clientX, clientY, rect) {
    const k = W / rect.width;
    return [(clientX - rect.left) * k, (clientY - rect.top) * k];
  }

  // Where the buttons (and the D-pad, when on) sit. opts: { zone, zoneH, leftHanded, dpad }
  function layoutFor(opts) {
    opts = opts || {};
    const below = opts.zone === "below", zoneH = below ? opts.zoneH || ZONE_MIN : 0;
    const half = (zoneH - STRIP_H) / 2, cy = H + half; // the controls centre above the HUD strip
    const flip = (o) => (opts.leftHanded ? { ...o, x: W - o.x } : { ...o });
    const buttons = {}, base = below
      ? { fire: { x: 410, y: cy + 6, r: 42 }, special: { x: 326, y: cy - 14, r: 34 }, kaboom: { x: 264, y: cy + 20, r: 30 } }
      : BUTTONS;
    for (const name of Object.keys(base)) buttons[name] = flip(base[name]);
    const dpad = !opts.dpad ? null : flip(below ? { x: 100, y: cy, r: Math.min(64, Math.floor(half / HIT_SCALE)) } : { x: 92, y: 530 + DY, r: 56 });
    return { zone: below ? "below" : "overlay", zoneH, leftHanded: !!opts.leftHanded, buttons, dpad };
  }

  // the 8-way direction a point gives on a D-pad: { x, y } in -1..1 (diagonals normalised), or null when outside
  function dpadVector(d, x, y) {
    const dx = x - d.x, dy = y - d.y;
    if (Math.hypot(dx, dy) > d.r * HIT_SCALE) return null;
    const dead = d.r * DPAD_DEAD;
    const vx = Math.abs(dx) < dead ? 0 : Math.sign(dx), vy = Math.abs(dy) < dead ? 0 : Math.sign(dy);
    return vx && vy ? { x: vx * Math.SQRT1_2, y: vy * Math.SQRT1_2 } : { x: vx, y: vy };
  }

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
      if (Math.hypot(x - b.x, y - b.y) <= b.r * HIT_SCALE) return name;
    }
    return null;
  }

  // Touch: left half steers, right half presses buttons. Pointers are tracked by id so thumbs stay separate.
  const STICK_IDLE_MS = 1500; // a stick pointer silent this long with no live touch under its id lets go
  const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  // held pointer ids that are no longer among the screen's active touches: their pointerup never came
  function reconcile(heldIds, activeIds) {
    const active = new Set(activeIds || []);
    return [...(heldIds || [])].filter((id) => !active.has(id));
  }
  function createTouch(leftHanded) {
    let swapped = !!leftHanded;
    let stickAt = 0; // ms of the stick pointer's last down or move
    const stick = createJoystick();
    const held = new Map(); // pointer id -> button name
    const pressed = { special: false, kaboom: false };
    let layout = null; // from layoutFor(): buttons and an optional D-pad; null = the classic overlay
    let pad = { id: null, x: 0, y: 0 }; // the finger on the D-pad
    let owned = { laser: false, twin: false }; // set by the renderer each frame from the game

    const reset = () => {
      held.clear();
      stickAt = 0;
      pad = { id: null, x: 0, y: 0 };
      if (stick.state.active) stick.end(stick.state.id);
    };
    const buttons = () => (layout ? layout.buttons : buttonsFor(swapped));

    return {
      stick,
      setLeftHanded(on) { swapped = !!on; layout = null; reset(); },
      setLayout(l) { layout = l; swapped = !!(l && l.leftHanded); reset(); },
      releaseAll: reset, // every finger and the stick let go; queued one-shot presses stay
      layout: () => layout,
      buttons,
      setOwned(o) { owned = { laser: !!(o && o.laser), twin: !!(o && o.twin) }; },
      // the LASER / TWIN buttons that are owned right now
      extraButtons() {
        const all = extraButtons(layout, layout ? layout.leftHanded : swapped), out = {};
        for (const name of Object.keys(all)) if (owned[name]) out[name] = all[name];
        return out;
      },
      start(id, x, y, t) {
        const S = root.BBSkills;
        if (S && S.picker && S.pickerTap(S.game, x, y)) return; // a tap while the picker is open only picks
        const d = layout && layout.dpad && dpadVector(layout.dpad, x, y);
        if (d && pad.id === null) { pad = { id, x: d.x, y: d.y }; return; }
        if ((x < W / 2) !== swapped) { if (!(layout && layout.dpad) && stick.start(id, x, y)) stickAt = t === undefined ? nowMs() : t; return; } // with a D-pad there is no floating stick
        const extra = buttonAt(x, y, this.extraButtons());
        if (extra) { actionQueue[extra] = true; return; }
        const name = buttonAt(x, y, buttons());
        if (!name) return;
        held.set(id, name);
        if (name === "special" || name === "kaboom") pressed[name] = true;
      },
      move(id, x, y, t) {
        if (stick.state.active && stick.state.id === id) stickAt = t === undefined ? nowMs() : t;
        if (pad.id === id) {
          const d = dpadVector(layout.dpad, x, y);
          pad = { id, x: d ? d.x : 0, y: d ? d.y : 0 }; // sliding off the pad stops; the finger keeps the pad
          return;
        }
        stick.move(id, x, y);
      },
      // ids of every pointer held now: stick, D-pad finger and buttons
      heldIds() {
        const ids = new Set(held.keys());
        if (stick.state.active) ids.add(stick.state.id);
        if (pad.id !== null) ids.add(pad.id);
        return [...ids];
      },
      // called each frame: a stick silent for STICK_IDLE_MS while no finger is on the screen re-centres itself.
      // Pointer ids and Touch.identifier are numbered differently by browsers, so only the finger count is trusted.
      tick(t, fingersDown) {
        const s = stick.state;
        if (s.active && !fingersDown && t - stickAt >= STICK_IDLE_MS) stick.end(s.id);
      },
      end(id) {
        if (pad.id === id) pad = { id: null, x: 0, y: 0 };
        stick.end(id);
        held.delete(id);
      },
      axes() { return pad.id !== null ? { x: pad.x, y: pad.y } : { x: stick.state.x, y: stick.state.y }; },
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

  // Let go of every held input at once (blur, hidden page, screen change, picker opening, new run), so the
  // ship never keeps steering on a pointer whose end event never came. Takes the live input objects.
  function releaseAll(inputs) {
    const { touch, mouse, keyboard } = inputs || {};
    if (touch) touch.releaseAll();
    if (mouse) mouse.up();
    if (keyboard) keyboard.releaseAll();
  }

  const HELD_ACTIONS = ["left", "right", "up", "down", "fire"];
  const PRESS_ACTIONS = ["special", "kaboom", "pause", "mute"];

  // keys: a BBKeys.createKeys() object; without one the default bindings are used
  function createKeyboard(keys) {
    keys = keys || root.BBKeys.createKeys(null);
    const down = {};
    const pressed = { special: false, kaboom: false, pause: false, mute: false };
    return {
      keydown(code) {
        const S = root.BBSkills;
        if (S && S.picker && S.pickerKey(S.game, code)) return true; // the skill picker owns the keys while open
        const action = keys.actionFor(code);
        if (!action && EXTRA_KEYS[code]) { actionQueue[EXTRA_KEYS[code]] = true; return true; }
        if (HELD_ACTIONS.includes(action)) { down[action] = true; return true; }
        if (PRESS_ACTIONS.includes(action)) { pressed[action] = true; return true; }
        return false;
      },
      keyup(code) {
        const action = keys.actionFor(code);
        if (HELD_ACTIONS.includes(action)) down[action] = false;
      },
      releaseAll() { for (const a of HELD_ACTIONS) down[a] = false; },
      axes() {
        const x = (down.right ? 1 : 0) - (down.left ? 1 : 0);
        const y = (down.down ? 1 : 0) - (down.up ? 1 : 0);
        const len = Math.hypot(x, y);
        return len > 1 ? { x: x / len, y: y / len } : { x, y };
      },
      fire() { return !!down.fire; },
      takePressed() {
        const out = { ...pressed };
        for (const a of PRESS_ACTIONS) pressed[a] = false;
        return out;
      },
    };
  }

  // ---- physical controller: standard-mapping Gamepad API. getPads defaults to navigator.getGamepads; a
  // missing or throwing API just means "no pad". pad: a BBKeys.createPad() object (the button map, bb.pad) ----
  const PAD_DEAD = 0.2, PAD_NAV = 0.5;
  const PAD_UP = 12, PAD_DOWN = 13, PAD_LEFT = 14, PAD_RIGHT = 15, PAD_CONFIRM = 0;
  const PAD_PRESS = ["special", "kaboom", "pause", "mute"];
  function createGamepad(opts) {
    opts = opts || {};
    const map = opts.pad || root.BBKeys.createPad(null);
    const getPads = opts.getPads || (() => (typeof navigator !== "undefined" && navigator && typeof navigator.getGamepads === "function" ? navigator.getGamepads() : []));
    const g = { connected: false, ax: 0, ay: 0, fire: false };
    let prev = [], fresh = [], navPrev = { up: false, down: false };
    const pressed = { special: false, kaboom: false, pause: false, mute: false };
    const nav = { up: false, down: false, confirm: false };
    const isDown = (b) => !!b && (typeof b === "object" ? !!b.pressed || b.value > 0.5 : b > 0.5);
    const dead = (v) => (Number.isFinite(v) && Math.abs(v) >= PAD_DEAD ? Math.max(-1, Math.min(1, v)) : 0);
    const clear = () => { Object.assign(g, { connected: false, ax: 0, ay: 0, fire: false }); prev = []; fresh = []; navPrev = { up: false, down: false }; };

    return {
      poll() { // read the pad once per frame; false when none is connected
        let list;
        try { list = getPads(); } catch (e) { list = null; }
        const p = list && Array.prototype.find.call(list, (x) => x && x.connected !== false);
        if (!p) { clear(); return false; }
        const btn = Array.from(p.buttons || [], isDown);
        const axes = p.axes || [];
        const x = Math.max(-1, Math.min(1, dead(axes[0]) + (btn[PAD_RIGHT] ? 1 : 0) - (btn[PAD_LEFT] ? 1 : 0)));
        const y = Math.max(-1, Math.min(1, dead(axes[1]) + (btn[PAD_DOWN] ? 1 : 0) - (btn[PAD_UP] ? 1 : 0)));
        const len = Math.hypot(x, y);
        g.ax = len > 1 ? x / len : x; g.ay = len > 1 ? y / len : y;
        g.connected = true;
        g.fire = !!btn[map.get("fire")];
        fresh = [];
        btn.forEach((on, i) => {
          if (!on || prev[i]) return;
          fresh.push(i);
          const action = map.actionFor(i);
          if (PAD_PRESS.includes(action)) pressed[action] = true;
          if (i === PAD_CONFIRM) nav.confirm = true;
        });
        const up = g.ay < -PAD_NAV, down = g.ay > PAD_NAV;
        if (up && !navPrev.up) nav.up = true;
        if (down && !navPrev.down) nav.down = true;
        navPrev = { up, down };
        prev = btn;
        return true;
      },
      connected: () => g.connected,
      axes: () => ({ x: g.ax, y: g.ay }),
      fire: () => g.fire, // A held = auto-fire
      takePressed() {
        const out = { ...pressed };
        for (const a of PAD_PRESS) pressed[a] = false;
        return out;
      },
      takeNav() { // menu steps: up, down, confirm (A)
        const out = { ...nav };
        nav.up = nav.down = nav.confirm = false;
        return out;
      },
      newButton: () => (fresh.length ? fresh[0] : null), // the first button that went down in the last poll (for remapping)
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
  const SETTINGS_LAYOUT = { x: 60, y: 108, w: 360, h: 26, gap: 2 };
  const SETTINGS_TOP_LAYOUT = { x: 60, y: 150, w: 360, h: 58, gap: 16 }; // the five big rows
  const MENU_DY = Math.round((H - 640) / 2); // menus keep their 640-tall layout, centred on a tall screen
  const GEAR = { x: 436, y: 100, r: 18 }; // the settings gear on the title and pause screens
  const MENU_ACTIONS = ["resume", "howto", "swap", "restart", "recentre"];
  const TITLE_ACTIONS = ["start", "scores", "howto"];
  const TITLE_ITEMS = ["START", "HIGH SCORES", "HOW TO PLAY"];
  function createMenu(opts) {
    opts = opts || {};
    const m = { screen: opts.screen || "howto", cursor: 0, leftHanded: !!opts.leftHanded, after: "playing" };
    m.keys = opts.keys || root.BBKeys.createKeys(null);
    m.settings = opts.settings || root.BBKeys.createSettings(null);
    m.controls = opts.controls || root.BBKeys.createControls(null); // bb.controls: zone below, D-pad
    m.pad = opts.pad || root.BBKeys.createPad(null); // bb.pad
    m.padCapturing = null; // index into PAD_ACTIONS while the pad remap waits for a button
    m.capturing = null; // the action waiting for its new key on the SETTINGS screen
    // SETTINGS is grouped: the top level has five rows; Capsules, Controls and Sound open a section (m.section)
    m.section = null; // null (top level) | "capsules" | "controls" | "sound"
    m.resetArmed = false; // Reset all waits for its second tap
    m.onResetAll = null; // main.js adds what the menu does not own (the volumes)
    const SECTIONS = ["capsules", "controls", "sound"];
    const SECTION_TITLES = { capsules: "CAPSULES", controls: "CONTROLS", sound: "SOUND" };
    const RANK_ROWS = { bronze: ["Bronze", "skill pick"], silver: ["Silver", "skill pick"], gold: ["Gold", "skill pick"], rainbow: ["Rainbow", "Super Star"], heart: ["Heart", "extra life"] };
    m.sectionTitle = () => (m.section ? "SETTINGS › " + SECTION_TITLES[m.section] : "SETTINGS");
    m.settingsRows = () => {
      const K = root.BBKeys, back = { type: "back", label: "Back", value: "" };
      if (m.section === "capsules") {
        const ranks = (root.BBRewards && root.BBRewards.RANKS) || Object.keys(RANK_ROWS);
        const fams = (root.BBSkills && root.BBSkills.FAMILIES) || [];
        return [
          ...ranks.map((r) => ({ type: "info", label: (RANK_ROWS[r] || [r])[0] + " capsule", value: (RANK_ROWS[r] || [r, ""])[1] })),
          ...fams.map((f) => ({ type: "info", label: f.name, value: "skill" })),
          back,
        ];
      }
      if (m.section === "controls") {
        return [
          ...K.ACTIONS.map((action) => ({ type: "key", action, label: K.LABELS[action], value: m.capturing === action ? "press a key" : m.keys.label(action) })),
          ...K.CONTROL_SWITCHES.map((name) => ({ type: "control", name, label: K.CONTROL_LABELS[name], value: m.controls.get(name) ? "ON" : "OFF" })),
          { type: "padmap", label: "Pad buttons", value: m.padCapturing === null ? "remap" : "press " + K.PAD_LABELS[K.PAD_ACTIONS[m.padCapturing]] },
          { type: "reset", label: "Reset keys", value: "" },
          back,
        ];
      }
      if (m.section === "sound") {
        const sw = (name) => ({ type: "switch", name, label: name === "sounds" ? "Sound FX" : K.SWITCH_LABELS[name], value: m.settings.get(name) ? "ON" : "OFF" });
        return [sw("music"), sw("sounds"), sw("vibration"), back];
      }
      return [
        { type: "section", section: "capsules", label: "Capsules", value: "" },
        { type: "section", section: "controls", label: "Controls", value: "" },
        { type: "section", section: "sound", label: "Sound", value: "" },
        { type: "resetall", label: "Reset all", value: m.resetArmed ? "Tap again to reset" : "" },
        back,
      ];
    };
    m.settingsLayout = () => (m.section ? SETTINGS_LAYOUT : SETTINGS_TOP_LAYOUT);
    m.openSettings = () => { // the gear on the title and pause screens
      if (m.screen !== "title" && m.screen !== "pause") return false;
      m.after = m.screen; m.screen = "settings"; m.cursor = 0; m.capturing = null; m.section = null; m.resetArmed = false;
      return true;
    };
    m.gearHit = (x, y) => (m.screen === "title" || m.screen === "pause") && Math.hypot(x - GEAR.x, y - GEAR.y) <= GEAR.r + 8;
    // the next key press while a row waits: Escape cancels, arrows and Escape can't be bound.
    // returns "bound" | "cancel" | "rejected" | null (nothing was waiting)
    m.capture = (code) => {
      if (!m.capturing) return null;
      if (code === "Escape") { m.capturing = null; return "cancel"; }
      if (!m.keys.rebind(m.capturing, code)) return "rejected";
      m.capturing = null;
      return "bound";
    };
    m.items = () => ["Resume", "How to play", "Left-hand: " + (m.leftHanded ? "ON" : "OFF"), "Restart", "Re-centre controls"];
    m.titleItems = () => TITLE_ITEMS.slice();
    const listFor = () => (m.screen === "title" ? TITLE_ACTIONS : m.screen === "pause" ? MENU_ACTIONS : m.screen === "settings" ? m.settingsRows() : null);
    const leaveHowTo = () => { m.screen = m.after; m.after = "playing"; m.cursor = 0; m.capturing = null; m.padCapturing = null; m.section = null; m.resetArmed = false; };
    const leaveSection = () => { // back to the top level, cursor on the section just left
      m.cursor = Math.max(0, SECTIONS.indexOf(m.section)); m.section = null; m.capturing = null; m.padCapturing = null; m.resetArmed = false;
    };
    // the next pad button while the remap waits: binds the action in turn. "bound" | "done" | "rejected" | null
    m.padCapture = (button) => {
      if (m.padCapturing === null) return null;
      const K = root.BBKeys;
      if (!m.pad.rebind(K.PAD_ACTIONS[m.padCapturing], button)) return "rejected";
      m.padCapturing += 1;
      if (m.padCapturing < K.PAD_ACTIONS.length) return "bound";
      m.padCapturing = null;
      return "done";
    };
    m.toggle = () => { // P / Esc: pause, resume, or dismiss how-to-play / high scores / settings
      if (m.screen === "playing") { m.screen = "pause"; m.cursor = 0; }
      else if (m.screen === "pause") m.screen = "playing";
      else if (m.screen === "settings" && m.section) leaveSection();
      else if (m.screen === "howto" || m.screen === "scores" || m.screen === "settings") leaveHowTo();
      return m.screen;
    };
    m.finish = () => { m.screen = "results"; m.cursor = 0; }; // the run is over
    m.toTitle = () => { m.screen = "title"; m.cursor = 0; m.after = "playing"; };
    m.move = (d) => {
      const list = listFor();
      if (list) m.cursor = (m.cursor + d + list.length) % list.length;
      if (m.resetArmed && !(m.screen === "settings" && list[m.cursor].type === "resetall")) m.resetArmed = false;
    };
    m.itemAt = (x, y) => {
      const list = listFor();
      if (!list) return -1;
      const L = m.screen === "title" ? TITLE_LAYOUT : m.screen === "settings" ? m.settingsLayout() : MENU_LAYOUT;
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
      if (m.screen === "settings") {
        const row = m.settingsRows()[index === undefined ? m.cursor : index];
        if (!row) return null;
        if (index !== undefined) m.cursor = index;
        if (row.type !== "resetall") m.resetArmed = false; // any other row cancels the pending reset
        if (row.type === "info") return null;
        if (row.type === "section") { m.section = row.section; m.cursor = 0; return "section"; }
        if (row.type === "resetall") {
          if (!m.resetArmed) { m.resetArmed = true; return "arm"; }
          const K = root.BBKeys;
          m.keys.reset(); m.pad.reset(); m.capturing = null; m.padCapturing = null; m.resetArmed = false;
          for (const n of K.SWITCHES) m.settings.set(n, K.SETTINGS_DEFAULTS[n]);
          for (const n of K.CONTROL_SWITCHES) m.controls.set(n, K.CONTROL_DEFAULTS[n]);
          if (m.onResetAll) m.onResetAll();
          return "resetall";
        }
        if (row.type === "back" && m.section) { leaveSection(); return "back"; }
        if (row.type === "key") { m.capturing = row.action; return "capture"; }
        if (row.type === "switch") { m.settings.toggle(row.name); return "switch"; }
        if (row.type === "control") { m.controls.toggle(row.name); return "control"; }
        if (row.type === "padmap") { m.padCapturing = 0; return "padmap"; }
        if (row.type === "reset") { m.keys.reset(); m.pad.reset(); m.capturing = null; m.padCapturing = null; return "reset"; }
        leaveHowTo();
        return "back";
      }
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
      else if (action === "recentre") m.screen = "pause"; // stays paused; main.js lets go of every input
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

  // ---- HD backing store: the canvas holds CSS size x pixel ratio; game coordinates stay W wide ----
  const HD_MAX_RATIO = 3; // 4x phones draw at 3x
  const HD_STEPS = [HD_MAX_RATIO, 2, 1.5]; // quality caps, tried in order when frames run slow
  const SLOW_FRAME = 1 / 40; // seconds: slower than 40 fps counts as slow
  const SLOW_FRAMES_TO_STEP = 45; // this many slow frames in a row drop one step

  // the render scale for a pixel ratio under a quality cap (never below 1)
  function hdScale(ratio, cap) {
    const r = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
    return Math.max(1, Math.min(r, HD_MAX_RATIO, cap || HD_MAX_RATIO));
  }
  // backing size for a canvas shown cssW x cssH; `factor` maps game units to backing pixels (backing width / W)
  function backingSize(cssW, cssH, ratio, cap) {
    const scale = hdScale(ratio, cap);
    const width = Math.max(1, Math.round(cssW * scale));
    const height = Math.max(1, Math.round(cssH * scale));
    return { scale, width, height, factor: width / W };
  }
  // watches frame times; after a run of slow frames the cap steps down 3 -> 2 -> 1.5 and stays there
  function createQuality() {
    let step = 0, slow = 0;
    return {
      cap: () => HD_STEPS[step],
      frame(dt) {
        if (step >= HD_STEPS.length - 1) return false;
        slow = dt > SLOW_FRAME ? slow + 1 : 0;
        if (slow < SLOW_FRAMES_TO_STEP) return false;
        step++; slow = 0;
        return true; // the cap changed: redo the backing store
      },
    };
  }

  // keeps canvas.width/height at CSS size x ratio and the context scaled so drawing stays in game units.
  // env: { css() -> { width, height } of the shown canvas, ratio() -> devicePixelRatio }. sync() is cheap
  // every frame: it only resizes when the CSS size, the ratio or the quality cap changed (a resize, a zoom,
  // moving to another screen, a slow-frame step-down). Returns true when it did.
  function createHd(canvas, ctx, env, quality) {
    const q = quality || createQuality();
    let key = "", current = null;
    function sync() {
      const css = env.css(), size = backingSize(css.width, css.height, env.ratio(), q.cap());
      const next = [size.width, size.height].join("x");
      if (next === key) return false;
      key = next; current = size;
      canvas.width = size.width;
      canvas.height = size.height;
      if (typeof ctx.setTransform === "function") ctx.setTransform(size.factor, 0, 0, size.factor, 0, 0);
      return true;
    }
    return {
      sync, quality: q, size: () => current,
      // call once per frame with the raw frame time; the context transform is also restored here
      frame(dt) {
        q.frame(dt);
        if (!sync() && current && typeof ctx.setTransform === "function") ctx.setTransform(current.factor, 0, 0, current.factor, 0, 0);
      },
    };
  }

  root.BBInput = {
    createHd, HD_MAX_RATIO, HD_STEPS, hdScale, backingSize, createQuality,
    STAR_WAVES, starsFor, createRunStats, TITLE_LAYOUT, SETTINGS_LAYOUT, SETTINGS_TOP_LAYOUT, GEAR, MENU_DY, TITLE_ACTIONS, MAX_SCORES,
    toGamePoint, EXTRA_BUTTONS, EXTRA_KEYS, takeActions, extraButtons,
    STICK, BUTTONS, TRAY_H, PLAY_H, PAUSE_BUTTON, pauseHit, STRIP_H, MENU_LAYOUT, createJoystick, createTouch, createMouse, createKeyboard, releaseAll, reconcile, STICK_IDLE_MS,
    HIT_SCALE, ZONE_MIN_EXTRA, controlsZone, zoneHeightFor, layoutFor, dpadVector, createGamepad,
    createStore, createMenu, createInitialsPicker, INITIALS_LAYOUT, buttonAt, buttonsFor, mirrorButtons,
  };
})(globalThis);
