// Boredom Blaster key bindings and settings switches. Plain script like game.js; the tests read
// globalThis.BBKeys. No DOM access: storage is passed in, and a missing or broken store never throws.
(function (root) {
  const KEYS_KEY = "bb.keys", SETTINGS_KEY = "bb.settings";
  // action -> default key code, in the order the SETTINGS screen lists them
  const DEFAULTS = {
    up: "KeyW", left: "KeyA", down: "KeyS", right: "KeyD",
    fire: "Space", special: "KeyI", kaboom: "KeyJ", pause: "KeyP", mute: "KeyM",
  };
  const ACTIONS = Object.keys(DEFAULTS);
  const LABELS = {
    up: "Move up", left: "Move left", down: "Move down", right: "Move right",
    fire: "Fire", special: "Special", kaboom: "Kaboom", pause: "Pause", mute: "Mute",
  };
  // always work, whatever is rebound, and cannot be bound to an action
  const FIXED = { ArrowUp: "up", ArrowLeft: "left", ArrowDown: "down", ArrowRight: "right", Escape: "pause" };
  const SWITCHES = ["music", "sounds", "vibration"];
  const SWITCH_LABELS = { music: "Music", sounds: "Sounds", vibration: "Vibration" };
  const SETTINGS_DEFAULTS = { music: true, sounds: true, vibration: true };

  const read = (storage, k) => { try { return storage ? storage.getItem(k) : null; } catch (e) { return null; } };
  const write = (storage, k, v) => { try { if (storage) storage.setItem(k, v); } catch (e) { /* full or blocked */ } };
  const parse = (text) => { try { const v = JSON.parse(text); return v && typeof v === "object" && !Array.isArray(v) ? v : null; } catch (e) { return null; } };

  // "KeyW" -> "W", "Space" -> "SPACE", "Digit5" -> "5"
  function keyName(code) {
    if (!code) return "-";
    return String(code).replace(/^Key|^Digit/, "").replace(/^Numpad/, "NUM ").replace(/^Arrow/, "").toUpperCase();
  }

  function createKeys(storage) {
    const map = { ...DEFAULTS };
    const stored = parse(read(storage, KEYS_KEY));
    if (stored) {
      const loaded = { ...DEFAULTS };
      for (const a of ACTIONS) if (typeof stored[a] === "string" && stored[a]) loaded[a] = stored[a];
      const codes = ACTIONS.map((a) => loaded[a]);
      const clean = new Set(codes).size === codes.length && !codes.some((c) => FIXED[c]);
      if (clean) Object.assign(map, loaded);
    }
    const save = () => write(storage, KEYS_KEY, JSON.stringify(map));

    const api = {
      get: (action) => map[action],
      all: () => ({ ...map }),
      // the action a key code triggers: the arrows and Escape always work
      actionFor(code) {
        if (FIXED[code]) return FIXED[code];
        return ACTIONS.find((a) => map[a] === code) || null;
      },
      // binds a key; a key held by another action is swapped over. Returns false for unknown actions
      // and for the always-on keys (arrows, Escape).
      rebind(action, code) {
        if (!(action in DEFAULTS) || typeof code !== "string" || !code || FIXED[code]) return false;
        const other = ACTIONS.find((a) => a !== action && map[a] === code);
        if (other) map[other] = map[action];
        map[action] = code;
        save();
        return true;
      },
      reset() { Object.assign(map, DEFAULTS); save(); },
      label: (action) => keyName(map[action]),
    };
    return api;
  }

  function createSettings(storage) {
    const s = { ...SETTINGS_DEFAULTS };
    const stored = parse(read(storage, SETTINGS_KEY));
    if (stored) for (const k of SWITCHES) if (typeof stored[k] === "boolean") s[k] = stored[k];
    const save = () => write(storage, SETTINGS_KEY, JSON.stringify(s));
    return {
      get: (name) => !!s[name],
      all: () => ({ ...s }),
      set(name, on) { if (!SWITCHES.includes(name)) return false; s[name] = !!on; save(); return true; },
      toggle(name) { return this.set(name, !s[name]) ? s[name] : null; },
    };
  }

  // ---- touch layout switches (bb.controls): kept apart from the sound switches ----
  const CONTROLS_KEY = "bb.controls";
  const CONTROL_SWITCHES = ["below", "dpad"];
  const CONTROL_LABELS = { below: "Controls below", dpad: "D-pad" };
  const CONTROL_DEFAULTS = { below: true, dpad: false };

  function createControls(storage) {
    const s = { ...CONTROL_DEFAULTS };
    const stored = parse(read(storage, CONTROLS_KEY));
    if (stored) for (const k of CONTROL_SWITCHES) if (typeof stored[k] === "boolean") s[k] = stored[k];
    const save = () => write(storage, CONTROLS_KEY, JSON.stringify(s));
    return {
      get: (name) => !!s[name],
      all: () => ({ ...s }),
      set(name, on) { if (!CONTROL_SWITCHES.includes(name)) return false; s[name] = !!on; save(); return true; },
      toggle(name) { return this.set(name, !s[name]) ? s[name] : null; },
    };
  }

  // ---- physical controller (Gamepad API, "standard" layout) buttons, saved in bb.pad ----
  const PAD_KEY = "bb.pad";
  const PAD_DEFAULTS = { fire: 0, kaboom: 1, special: 2, mute: 3, pause: 9 }; // A, B, X, Y, Menu
  const PAD_ACTIONS = Object.keys(PAD_DEFAULTS);
  const PAD_LABELS = { fire: "Fire (auto)", kaboom: "Kaboom", special: "Special", mute: "Mute", pause: "Pause" };
  const PAD_R1 = 5; // always Special, whatever is remapped
  const PAD_BUTTONS = 17; // the standard mapping has buttons 0-16

  function createPad(storage) {
    const map = { ...PAD_DEFAULTS };
    const stored = parse(read(storage, PAD_KEY));
    if (stored) {
      const loaded = { ...PAD_DEFAULTS };
      for (const a of PAD_ACTIONS) if (Number.isInteger(stored[a]) && stored[a] >= 0 && stored[a] < PAD_BUTTONS) loaded[a] = stored[a];
      const codes = PAD_ACTIONS.map((a) => loaded[a]);
      if (new Set(codes).size === codes.length && !codes.includes(PAD_R1)) Object.assign(map, loaded);
    }
    const save = () => write(storage, PAD_KEY, JSON.stringify(map));
    return {
      get: (action) => map[action],
      all: () => ({ ...map }),
      actionFor(button) { return button === PAD_R1 ? "special" : PAD_ACTIONS.find((a) => map[a] === button) || null; },
      // binds a button index; one held by another action is swapped over. False for unknown actions and bad indexes.
      rebind(action, button) {
        if (!(action in PAD_DEFAULTS) || !Number.isInteger(button) || button < 0 || button >= PAD_BUTTONS || button === PAD_R1) return false;
        const other = PAD_ACTIONS.find((a) => a !== action && map[a] === button);
        if (other) map[other] = map[action];
        map[action] = button;
        save();
        return true;
      },
      reset() { Object.assign(map, PAD_DEFAULTS); save(); },
    };
  }

  root.BBKeys = {
    CONTROLS_KEY, CONTROL_SWITCHES, CONTROL_LABELS, CONTROL_DEFAULTS, createControls,
    PAD_KEY, PAD_DEFAULTS, PAD_ACTIONS, PAD_LABELS, PAD_R1, createPad,
    DEFAULTS, ACTIONS, LABELS, FIXED, SWITCHES, SWITCH_LABELS, SETTINGS_DEFAULTS, KEYS_KEY, SETTINGS_KEY,
    keyName, createKeys, createSettings,
  };
})(globalThis);
