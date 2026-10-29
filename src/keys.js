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

  root.BBKeys = {
    DEFAULTS, ACTIONS, LABELS, FIXED, SWITCHES, SWITCH_LABELS, SETTINGS_DEFAULTS, KEYS_KEY, SETTINGS_KEY,
    keyName, createKeys, createSettings,
  };
})(globalThis);
