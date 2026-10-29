// Boredom Blaster sound: an original chiptune theme (title, play and boss loops), a sound for every shot and
// event, the volume and preset settings, and hit feedback (vibration, iPhone haptic tap). Plain script like
// game.js; the tests read globalThis.BBAudio with a fake AudioContext. Nothing here throws where Web Audio,
// vibrate or the DOM is missing, and no sound starts before unlock() runs from a user gesture.
(function (root) {
  const VOICE_CAP = 12; // sound effects playing at once
  const STEP = 10, VOLUME_DEFAULTS = { musicVolume: 70, effectsVolume: 80 };
  const SHAKE_MS = 250, VIBRATE_MS = 80;

  // ---- sound effects: one definition per shot type and event, all different ----
  // wave: oscillator shape; f0 -> f1: pitch sweep in Hz; dur: seconds; vol: 0..1; tail: second voice (Hz ratio)
  const SOUNDS = {
    shot: { wave: "square", f0: 880, f1: 440, dur: 0.07, vol: 0.18 },
    special: { wave: "sawtooth", f0: 220, f1: 1100, dur: 0.28, vol: 0.28, ratio: 1.5 },
    kaboom: { wave: "sawtooth", f0: 180, f1: 30, dur: 0.7, vol: 0.45, ratio: 0.5 },
    explode: { wave: "sawtooth", f0: 260, f1: 50, dur: 0.22, vol: 0.28 },
    bossExplode: { wave: "square", f0: 200, f1: 25, dur: 0.9, vol: 0.45, ratio: 0.51 },
    hit: { wave: "square", f0: 440, f1: 70, dur: 0.4, vol: 0.4, ratio: 1.06 },
    shieldHit: { wave: "triangle", f0: 1200, f1: 600, dur: 0.18, vol: 0.3 },
    pickup: { wave: "square", f0: 660, f1: 1320, dur: 0.16, vol: 0.22, ratio: 2 },
    extraLife: { wave: "triangle", f0: 523, f1: 1568, dur: 0.5, vol: 0.32, ratio: 1.25 },
    waveClear: { wave: "triangle", f0: 392, f1: 784, dur: 0.6, vol: 0.3, ratio: 1.5 },
    gameOver: { wave: "sawtooth", f0: 300, f1: 40, dur: 1.4, vol: 0.4, ratio: 0.75 },
    click: { wave: "square", f0: 1000, f1: 1000, dur: 0.03, vol: 0.12 },
  };
  const SOUND_IDS = Object.keys(SOUNDS);

  // ---- music: 16 bars per loop, 8 eighth notes per bar (semitones above the bar's chord root, null = rest) ----
  // Motifs stay on the minor pentatonic scale, so they sound right over every chord root.
  const MOTIFS = {
    A: [12, null, 15, 17, 19, null, 17, 15],
    B: [16 + 3, null, 19, 22, 24, null, 22, 19],
    C: [17, 15, 12, 15, 17, 19, 22, 19],
    D: [19, null, 17, 15, 12, null, null, null],
    E: [24, 22, 19, 22, 24, 27, 24, 22],
    F: [12, 12, null, 15, 12, null, 17, 15],
    G: [19, 19, 22, 19, 17, 17, 15, 12],
  };
  const THEME_SPECS = {
    title: { step: 0.17, root: 57, lead: "triangle", bassWave: "square", bassEvery: 2, chords: [0, -4, 3, -2], form: "ABACABCDABACBBCD" },
    play: { step: 0.115, root: 52, lead: "square", bassWave: "triangle", bassEvery: 1, chords: [0, 0, -4, -2], form: "FGFEFGCEFGFEBGDE" },
    boss: { step: 0.095, root: 45, lead: "sawtooth", bassWave: "square", bassEvery: 1, chords: [0, 1, 0, -2], form: "EFEGEFGEEFEGCGEE" },
  };
  function buildTheme(spec) {
    const bars = [];
    for (let i = 0; i < 16; i++) {
      bars.push({ bass: spec.chords[i % 4], lead: MOTIFS[spec.form[i]].slice() });
    }
    return { step: spec.step, root: spec.root, lead: spec.lead, bassWave: spec.bassWave, bassEvery: spec.bassEvery, bars };
  }
  const THEMES = {};
  for (const k of Object.keys(THEME_SPECS)) THEMES[k] = buildTheme(THEME_SPECS[k]);
  // each world (5 waves) lifts the whole loop by these semitones, then the table repeats
  const WORLD_SHIFT = [0, 2, 4, -3, 5, 7, -1, 3];
  const WAVES_PER_WORLD = 5;
  const worldOf = (wave) => Math.floor((Math.max(1, wave) - 1) / WAVES_PER_WORLD) + 1;
  const transposeFor = (world) => WORLD_SHIFT[(Math.max(1, world) - 1) % WORLD_SHIFT.length];
  const midiHz = (n) => 440 * Math.pow(2, (n - 69) / 12);

  // ---- presets: switches plus volumes ----
  const PRESETS = {
    "All on": { music: true, sounds: true, musicVolume: 70, effectsVolume: 80 },
    "Music only": { music: true, sounds: false, musicVolume: 70, effectsVolume: 80 },
    "Effects only": { music: false, sounds: true, musicVolume: 70, effectsVolume: 80 },
    "Quiet": { music: true, sounds: true, musicVolume: 30, effectsVolume: 30 },
    "Silent": { music: false, sounds: false, musicVolume: 70, effectsVolume: 80 },
  };
  const PRESET_NAMES = Object.keys(PRESETS);

  const clampVolume = (v) => Math.max(0, Math.min(100, Math.round(Number(v) / STEP) * STEP || 0));
  const readJson = (storage, key) => {
    try { const v = JSON.parse(storage.getItem(key)); return v && typeof v === "object" && !Array.isArray(v) ? v : null; } catch (e) { return null; }
  };

  // opts: { settings (BBKeys.createSettings), storage, context: () => AudioContext (default: the browser's) }
  function createAudio(opts) {
    opts = opts || {};
    const settings = opts.settings, storage = opts.storage || null;
    const factory = opts.context !== undefined ? opts.context : () => {
      const C = root.AudioContext || root.webkitAudioContext;
      return C ? new C() : null;
    };
    const stored = (storage && readJson(storage, "bb.settings")) || {};
    const vol = {
      musicVolume: Number.isFinite(stored.musicVolume) ? clampVolume(stored.musicVolume) : VOLUME_DEFAULTS.musicVolume,
      effectsVolume: Number.isFinite(stored.effectsVolume) ? clampVolume(stored.effectsVolume) : VOLUME_DEFAULTS.effectsVolume,
    };
    const on = (name) => (settings ? settings.get(name) : true);
    let ctx = null, master = null, musicGain = null, sfxGain = null, failed = false;
    let voices = []; // end times of the effects still sounding
    const music = { theme: "title", world: 1, bar: 0, step: 0, next: 0, playing: false };

    // the settings object only saves its own switches: write them together with the volumes
    function persist() {
      if (!storage) return;
      try { storage.setItem("bb.settings", JSON.stringify({ ...(settings ? settings.all() : {}), ...vol })); } catch (e) { /* blocked */ }
    }
    if (settings && typeof settings.set === "function") {
      const original = settings.set.bind(settings);
      settings.set = (name, value) => { const ok = original(name, value); if (ok) { persist(); refresh(); } return ok; };
    }

    function refresh() {
      if (!ctx) return;
      const set = (node, v) => { try { node.gain.value = v; } catch (e) { /* ignore */ } };
      set(master, 1);
      set(musicGain, on("music") ? vol.musicVolume / 100 : 0);
      set(sfxGain, on("sounds") ? vol.effectsVolume / 100 : 0);
    }

    // call from a click, key press or touch: the browser only allows audio after one
    function unlock() {
      if (failed) return false;
      try {
        if (!ctx) {
          ctx = factory ? factory() : null;
          if (!ctx) { failed = true; return false; }
          master = ctx.createGain(); musicGain = ctx.createGain(); sfxGain = ctx.createGain();
          musicGain.connect(master); sfxGain.connect(master); master.connect(ctx.destination);
          refresh();
        }
        if (ctx.state === "suspended" && typeof ctx.resume === "function") { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); }
        return true;
      } catch (e) { ctx = null; failed = true; return false; }
    }

    function tone(dest, wave, f0, f1, start, dur, level) {
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = wave;
      osc.frequency.setValueAtTime(f0, start);
      if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), start + dur);
      g.gain.setValueAtTime(level, start);
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.connect(g); g.connect(dest);
      osc.start(start); osc.stop(start + dur + 0.02);
    }

    // plays a sound effect; false when it was skipped (no audio yet, unknown id, switched off, voice cap)
    function play(id) {
      const def = SOUNDS[id];
      if (!def || !ctx || !on("sounds") || vol.effectsVolume === 0) return false;
      try {
        const now = ctx.currentTime || 0;
        voices = voices.filter((end) => end > now);
        if (voices.length >= VOICE_CAP) return false;
        tone(sfxGain, def.wave, def.f0, def.f1, now, def.dur, def.vol);
        if (def.ratio) tone(sfxGain, def.wave, def.f0 * def.ratio, def.f1 * def.ratio, now, def.dur, def.vol * 0.6);
        voices.push(now + def.dur + 0.02);
        return true;
      } catch (e) { return false; }
    }

    // ---- music ----
    function setTheme(name, wave) {
      const world = worldOf(wave || 1);
      if (!THEMES[name]) return false;
      if (music.theme === name && music.world === world) return true;
      music.theme = name; music.world = world; music.bar = 0; music.step = 0; music.next = 0;
      return true;
    }
    // schedules the notes due in the next quarter second; call it every frame
    function tick() {
      if (!ctx || !on("music") || vol.musicVolume === 0) return 0;
      let n = 0;
      try {
        const now = ctx.currentTime || 0, theme = THEMES[music.theme], shift = transposeFor(music.world);
        if (!music.playing || music.next < now) { music.next = now + 0.05; music.playing = true; }
        while (music.next < now + 0.25) {
          const bar = theme.bars[music.bar], t = music.next, len = theme.step;
          const lead = bar.lead[music.step];
          if (lead !== null) { tone(musicGain, theme.lead, midiHz(theme.root + 12 + shift + bar.bass + lead), midiHz(theme.root + 12 + shift + bar.bass + lead), t, len * 0.9, 0.12); n++; }
          if (music.step % theme.bassEvery === 0) { tone(musicGain, theme.bassWave, midiHz(theme.root - 12 + shift + bar.bass), midiHz(theme.root - 12 + shift + bar.bass), t, len * 1.6, 0.16); n++; }
          music.next += len;
          if (++music.step >= 8) { music.step = 0; music.bar = (music.bar + 1) % theme.bars.length; }
        }
      } catch (e) { /* keep the game running without music */ }
      return n;
    }

    // ---- settings: volumes, presets ----
    function setVolume(kind, value) {
      const key = kind === "music" ? "musicVolume" : kind === "effects" ? "effectsVolume" : null;
      if (!key) return false;
      vol[key] = clampVolume(value);
      persist(); refresh();
      return true;
    }
    const stepVolume = (kind, dir) => setVolume(kind, (kind === "music" ? vol.musicVolume : vol.effectsVolume) + dir * STEP);
    const volume = (kind) => (kind === "music" ? vol.musicVolume : vol.effectsVolume);
    function applyPreset(name) {
      const p = PRESETS[name];
      if (!p) return false;
      vol.musicVolume = p.musicVolume; vol.effectsVolume = p.effectsVolume;
      if (settings) { settings.set("music", p.music); settings.set("sounds", p.sounds); }
      persist(); refresh();
      return true;
    }
    function preset() {
      for (const name of PRESET_NAMES) {
        const p = PRESETS[name];
        if (on("music") === p.music && on("sounds") === p.sounds && vol.musicVolume === p.musicVolume && vol.effectsVolume === p.effectsVolume) return name;
      }
      return "Custom";
    }
    const nextPreset = () => { const i = PRESET_NAMES.indexOf(preset()); return applyPreset(PRESET_NAMES[(i + 1) % PRESET_NAMES.length]); };
    const muted = () => !on("music") && !on("sounds");
    function toggleMute() { // M or the speaker icon: everything off, or back on
      const next = muted();
      if (settings) { settings.set("music", next); settings.set("sounds", next); }
      refresh();
      return !next;
    }

    // ---- game events: compares the game with the last frame and plays what happened ----
    let prev = null;
    function observe(game) {
      if (!game) return [];
      const now = {
        game, bullets: new Set(game.bullets), drones: new Set(game.drones), capsules: new Set(game.capsules || []),
        lives: game.lives, wave: game.wave, status: game.status, shield: game.shield || 0, charges: game.kaboomCharges || 0,
      };
      const heard = [];
      if (prev && prev.game === game) {
        const fresh = game.bullets.filter((b) => !prev.bullets.has(b));
        if (fresh.some((b) => !b.pierce)) heard.push("shot");
        if (fresh.some((b) => b.pierce)) heard.push("special");
        const gone = [...prev.drones].filter((d) => !now.drones.has(d));
        if (now.charges < prev.charges) heard.push("kaboom");
        else if (gone.some((d) => d.boss)) heard.push("bossExplode");
        else if (gone.length) heard.push("explode");
        if (now.lives < prev.lives) heard.push("hit");
        else if (now.shield < prev.shield) heard.push("shieldHit");
        if (now.lives > prev.lives) heard.push("extraLife");
        if (now.wave > prev.wave) heard.push("waveClear");
        if ([...prev.capsules].some((c) => !now.capsules.has(c) && c.caught)) heard.push("pickup");
        if (now.status === "over" && prev.status !== "over") heard.push("gameOver");
      }
      prev = now;
      for (const id of heard) play(id);
      return heard;
    }

    return {
      unlock, play, tick, setTheme, observe, refresh, setVolume, stepVolume, volume, applyPreset, nextPreset, preset, muted, toggleMute,
      get started() { return !!ctx; },
      get theme() { return music.theme; },
      get world() { return music.world; },
      voices: () => { const now = ctx ? ctx.currentTime || 0 : 0; return voices.filter((end) => end > now).length; },
    };
  }

  // ---- hit feedback ----
  // env: { navigator, document, setTimeout }; settings.get("vibration") gates the buzz and the iPhone tap.
  // Android: navigator.vibrate. iPhone Safari has no vibrate, but toggling a hidden <input type=checkbox switch>
  // through its label gives a haptic tick, so a hidden switch is clicked instead. Always safe to call.
  function createHaptics(opts) {
    opts = opts || {};
    const settings = opts.settings;
    const nav = opts.navigator !== undefined ? opts.navigator : root.navigator;
    const doc = opts.document !== undefined ? opts.document : root.document;
    let label = null;
    const enabled = () => !settings || settings.get("vibration");

    function iosTap() {
      try {
        if (!doc || typeof doc.createElement !== "function" || !doc.body) return false;
        if (!label) {
          const input = doc.createElement("input");
          input.type = "checkbox"; input.id = "bb-haptic"; input.setAttribute("switch", "");
          label = doc.createElement("label");
          label.setAttribute("for", "bb-haptic"); label.setAttribute("aria-hidden", "true");
          label.style.cssText = "position:fixed;left:-100px;top:-100px;width:1px;height:1px;opacity:0;pointer-events:none";
          label.appendChild(input);
          doc.body.appendChild(label);
        }
        label.click();
        return true;
      } catch (e) { return false; }
    }
    // returns "vibrate" | "haptic" | null (off or unsupported)
    function hit() {
      if (!enabled()) return null;
      try {
        if (nav && typeof nav.vibrate === "function") { nav.vibrate(VIBRATE_MS); return "vibrate"; }
      } catch (e) { /* ignore */ }
      return iosTap() ? "haptic" : null;
    }
    return { hit };
  }

  const SPEAKER = { x: 396, y: 16, r: 14 }; // the speaker icon in the top bar, left of the pause button
  const speakerHit = (x, y) => Math.hypot(x - SPEAKER.x, y - SPEAKER.y) <= SPEAKER.r + 4;

  root.BBAudio = {
    SPEAKER, speakerHit, VOICE_CAP, STEP, VOLUME_DEFAULTS, SHAKE_MS, SOUNDS, SOUND_IDS, THEMES, MOTIFS, WORLD_SHIFT, WAVES_PER_WORLD, PRESETS, PRESET_NAMES,
    worldOf, transposeFor, midiHz, createAudio, createHaptics,
  };
})(globalThis);
