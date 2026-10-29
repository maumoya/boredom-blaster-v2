// Boredom Blaster sound: an original chiptune theme (title, play and boss loops), a sound for every shot and
// event, the volume and preset settings, and hit feedback (vibration, iPhone haptic tap). Plain script like
// game.js; the tests read globalThis.BBAudio with a fake AudioContext. Nothing here throws where Web Audio,
// vibrate or the DOM is missing, and no sound starts before unlock() runs from a user gesture.
(function (root) {
  const VOICE_CAP = 12; // sound effects playing at once
  const STEP = 10, VOLUME_DEFAULTS = { musicVolume: 50, effectsVolume: 50 }, VOLUMES_V = 2;
  const SHAKE_MS = 250, VIBRATE_MS = 80;
  const NUKE_SHAKE_MS = 400, NUKE_VIBRATE = [40, 30, 80]; // the Kaboom blast: shake 400 ms, buzz-pause-buzz

  // ---- sound effects: one definition per shot type and event, all different ----
  // wave: oscillator shape; f0 -> f1: pitch sweep in Hz; dur: seconds; vol: 0..1; tail: second voice (Hz ratio)
  const SOUNDS = {
    shot: { wave: "square", f0: 880, f1: 440, dur: 0.07, vol: 0.07 },
    special: { wave: "triangle", f0: 220, f1: 1100, dur: 0.28, vol: 0.28, ratio: 1.5 },
    kaboom: { wave: "triangle", f0: 180, f1: 30, dur: 0.7, vol: 0.45, ratio: 0.5 },
    nuke: { wave: "square", f0: 120, f1: 20, dur: 1.1, vol: 0.5, ratio: 0.37 },
    explode: { wave: "triangle", f0: 260, f1: 50, dur: 0.22, vol: 0.28 },
    bossExplode: { wave: "square", f0: 200, f1: 25, dur: 0.9, vol: 0.45, ratio: 0.51 },
    hit: { wave: "square", f0: 440, f1: 70, dur: 0.4, vol: 0.4, ratio: 1.06 },
    shieldHit: { wave: "triangle", f0: 1200, f1: 600, dur: 0.18, vol: 0.3 },
    pickup: { wave: "square", f0: 660, f1: 1320, dur: 0.16, vol: 0.22, ratio: 2 },
    extraLife: { wave: "triangle", f0: 523, f1: 1568, dur: 0.5, vol: 0.32, ratio: 1.25 },
    waveClear: { wave: "triangle", f0: 392, f1: 784, dur: 0.6, vol: 0.3, ratio: 1.5 },
    gameOver: { wave: "triangle", f0: 300, f1: 40, dur: 1.4, vol: 0.4, ratio: 0.75 },
    click: { wave: "square", f0: 1000, f1: 1000, dur: 0.03, vol: 0.12 },
  };
  const SOUND_IDS = Object.keys(SOUNDS);

  // ---- music: 16 bars per loop, 8 eighth notes per bar ----
  // Every note sits on the key's major or natural-minor scale. A bar has a bass (semitones above the key's tonic)
  // and a lead (semitones above that bass, null = rest). Chord loops are scale degrees: I-V-vi-IV (play),
  // I-vi-IV-V (title), i-VI-III-VII (boss). Motifs are scale-degree steps above the chord root (7 = an octave).
  const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
  const MOTIFS = {
    A: [7, null, 9, 11, 13, null, 11, 9],
    B: [9, null, 11, 13, 14, null, 13, 11],
    C: [11, 9, 7, 9, 11, 13, 14, 13],
    D: [13, null, 11, 9, 7, null, null, null],
    E: [14, 13, 11, 13, 14, 16, 14, 13],
    F: [7, 7, null, 9, 7, null, 11, 9],
    G: [11, 11, 13, 11, 9, 9, 7, 7],
  };
  // step = one eighth note in seconds
  const BOSS_SPEC = { step: 0.095, root: 45, mode: "minor", lead: "triangle", bassWave: "triangle", bassEvery: 1, chords: [0, 5, 2, 6], form: "EFEGEFGEEFEGCGEE" };
  const THEME_SPECS = {
    title: { step: 0.17, root: 57, mode: "major", lead: "triangle", bassWave: "triangle", bassEvery: 2, chords: [0, 5, 3, 4], form: "ABACABCDABACBBCD" },
    play: { step: 0.115, root: 52, mode: "major", lead: "triangle", bassWave: "triangle", bassEvery: 1, chords: [0, 4, 5, 3], form: "FGFEFGCEFGFEBGDE" },
    boss: BOSS_SPEC,
  };
  // the five theme songs of Settings > Sound: Nebula is the original; the boss theme is the same in all of them
  const SONG_SPECS = {
    Nebula: THEME_SPECS,
    Starlight: { // slow and airy, major, about 84 bpm
      title: { step: 0.357, root: 60, mode: "major", lead: "triangle", bassWave: "triangle", bassEvery: 4, chords: [0, 2, 3, 4], form: "DADBDACBDADBCBAD" },
      play: { step: 0.357, root: 55, mode: "major", lead: "triangle", bassWave: "triangle", bassEvery: 4, chords: [0, 3, 4, 5], form: "BADCBAEDBADCABDD" },
      boss: BOSS_SPEC,
    },
    Pulse: { // driving bass, about 128 bpm
      title: { step: 0.234, root: 55, mode: "minor", lead: "triangle", bassWave: "square", bassEvery: 1, chords: [0, 5, 3, 4], form: "FGFEFGFEFGFEBGCE" },
      play: { step: 0.234, root: 50, mode: "minor", lead: "triangle", bassWave: "square", bassEvery: 1, chords: [0, 2, 5, 6], form: "GFGEGFCEGFGEBFDE" },
      boss: BOSS_SPEC,
    },
    Drift: { // calm, minor, about 72 bpm
      title: { step: 0.417, root: 57, mode: "minor", lead: "triangle", bassWave: "triangle", bassEvery: 4, chords: [0, 5, 2, 6], form: "ADBDACDBADBDCBDD" },
      play: { step: 0.417, root: 52, mode: "minor", lead: "triangle", bassWave: "triangle", bassEvery: 2, chords: [0, 3, 5, 4], form: "DBADCBDADBADCADD" },
      boss: BOSS_SPEC,
    },
    Overdrive: { // fast, about 150 bpm
      title: { step: 0.2, root: 59, mode: "major", lead: "triangle", bassWave: "square", bassEvery: 1, chords: [0, 4, 5, 3], form: "EFEGEFGEEFEGCGEE" },
      play: { step: 0.2, root: 53, mode: "major", lead: "triangle", bassWave: "square", bassEvery: 1, chords: [0, 5, 3, 4], form: "EGEFEGCEEGEFBGEE" },
      boss: BOSS_SPEC,
    },
  };
  const SONG_NAMES = Object.keys(SONG_SPECS), DEFAULT_SONG = "Nebula";
  const degreeNote = (scale, d) => scale[d % 7] + 12 * Math.floor(d / 7);
  function buildTheme(spec) {
    const scale = SCALES[spec.mode], bars = [];
    for (let i = 0; i < 16; i++) {
      const chord = spec.chords[i % 4], bass = scale[chord];
      const lead = MOTIFS[spec.form[i]].map((m) => {
        if (m === null) return null;
        let d = chord + m, n = degreeNote(scale, d);
        // never a semitone from the bass sounding under it: step up one scale degree
        while ([1, 11].includes((n - bass) % 12)) n = degreeNote(scale, ++d);
        return n - bass;
      });
      bars.push({ bass, lead });
    }
    return { step: spec.step, root: spec.root, mode: spec.mode, lead: spec.lead, bassWave: spec.bassWave, bassEvery: spec.bassEvery, bars };
  }
  const THEMES = {};
  for (const k of Object.keys(THEME_SPECS)) THEMES[k] = buildTheme(THEME_SPECS[k]);
  // every song's title / play / boss loops; THEMES (above) stays Nebula's
  const SONG_THEMES = {};
  for (const song of SONG_NAMES) {
    SONG_THEMES[song] = {};
    for (const k of Object.keys(THEME_SPECS)) SONG_THEMES[song][k] = song === DEFAULT_SONG || k === "boss" ? THEMES[k] : buildTheme(SONG_SPECS[song][k]);
  }
  // each of the five worlds (100 waves) lifts the whole play loop by these semitones; after world 5 the worlds repeat
  const WORLD_SHIFT = [0, 2, 4, -3, 5, 7, -1, 3];
  const WAVES_PER_WORLD = 100, WORLD_COUNT = 5;
  const worldOf = (wave) => (Math.floor((Math.max(1, wave) - 1) / WAVES_PER_WORLD) % WORLD_COUNT) + 1;
  const transposeFor = (world) => WORLD_SHIFT[(Math.max(1, world) - 1) % WORLD_SHIFT.length];
  const midiHz = (n) => 440 * Math.pow(2, (n - 69) / 12);

  // ---- presets: switches plus volumes ----
  const PRESETS = {
    "All on": { music: true, sounds: true, musicVolume: 50, effectsVolume: 50 },
    "Music only": { music: true, sounds: false, musicVolume: 50, effectsVolume: 50 },
    "Effects only": { music: false, sounds: true, musicVolume: 50, effectsVolume: 50 },
    "Quiet": { music: true, sounds: true, musicVolume: 30, effectsVolume: 30 },
    "Silent": { music: false, sounds: false, musicVolume: 50, effectsVolume: 50 },
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
    // volumes saved before volumesV 2 (the old defaults) reset once to the defaults
    const keep = stored.volumesV === VOLUMES_V;
    const vol = {
      musicVolume: keep && Number.isFinite(stored.musicVolume) ? clampVolume(stored.musicVolume) : VOLUME_DEFAULTS.musicVolume,
      effectsVolume: keep && Number.isFinite(stored.effectsVolume) ? clampVolume(stored.effectsVolume) : VOLUME_DEFAULTS.effectsVolume,
    };
    let song = SONG_NAMES.includes(stored.theme) ? stored.theme : DEFAULT_SONG; // bb.settings.theme
    const on = (name) => (settings ? settings.get(name) : true);
    let ctx = null, master = null, musicGain = null, sfxGain = null, sfxFilter = null, leadFilter = null, failed = false;
    let voices = []; // end times of the effects still sounding
    const music = { theme: "title", world: 1, bar: 0, step: 0, next: 0, playing: false };

    // the settings object only saves its own switches: write them together with the volumes
    function persist() {
      if (!storage) return;
      try { storage.setItem("bb.settings", JSON.stringify({ ...(settings ? settings.all() : {}), ...vol, volumesV: VOLUMES_V, theme: song })); } catch (e) { /* blocked */ }
    }
    if (!keep && Object.keys(stored).length) persist();
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
          const lowpass = (hz) => { const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = hz; return f; };
          const comp = ctx.createDynamicsCompressor(); // gentle master compressor
          comp.threshold.value = -18; comp.knee.value = 24; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.25;
          sfxFilter = lowpass(4000); sfxFilter.connect(sfxGain);
          leadFilter = lowpass(2500); leadFilter.connect(musicGain);
          // short quiet echo on the lead, about 25 % wet
          const delay = ctx.createDelay(1), feedback = ctx.createGain(), wet = ctx.createGain();
          delay.delayTime.value = 0.18; feedback.gain.value = 0.3; wet.gain.value = 0.25;
          leadFilter.connect(delay); delay.connect(feedback); feedback.connect(delay); delay.connect(wet); wet.connect(musicGain);
          musicGain.connect(master); sfxGain.connect(master); master.connect(comp); comp.connect(ctx.destination);
          refresh();
        }
        if (ctx.state === "suspended" && typeof ctx.resume === "function") { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); }
        return true;
      } catch (e) { ctx = null; failed = true; return false; }
    }

    // every voice fades in from 0 over 7 ms, decays, fades out to 0 over 15 ms, and stops only after that: no clicks
    const ATTACK = 0.007, RELEASE = 0.015;
    function tone(dest, wave, f0, f1, start, dur, level, tail) {
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = wave;
      osc.frequency.setValueAtTime(f0, start);
      if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), start + dur);
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(level, start + ATTACK);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0001, level * (tail === undefined ? 0.05 : tail)), start + dur - RELEASE);
      g.gain.linearRampToValueAtTime(0, start + dur);
      osc.connect(g); g.connect(dest);
      osc.start(start); osc.stop(start + dur + 0.005);
    }

    // plays a sound effect; false when it was skipped (no audio yet, unknown id, switched off, voice cap)
    function play(id) {
      const def = SOUNDS[id];
      if (!def || !ctx || !on("sounds") || vol.effectsVolume === 0) return false;
      try {
        const now = ctx.currentTime || 0;
        voices = voices.filter((end) => end > now);
        if (voices.length >= VOICE_CAP) return false;
        tone(sfxFilter, def.wave, def.f0, def.f1, now, def.dur, def.vol);
        if (def.ratio) tone(sfxFilter, def.wave, def.f0 * def.ratio, def.f1 * def.ratio, now, def.dur, def.vol * 0.6);
        voices.push(now + def.dur + 0.005);
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
        const now = ctx.currentTime || 0, theme = SONG_THEMES[song][music.theme], shift = transposeFor(music.world);
        if (!music.playing || music.next < now) { music.next = now + 0.05; music.playing = true; }
        while (music.next < now + 0.25) {
          const bar = theme.bars[music.bar], t = music.next, len = theme.step;
          const lead = bar.lead[music.step];
          const keyNote = theme.root + shift + bar.bass;
          if (lead !== null) { const hz = midiHz(keyNote + 12 + lead); tone(leadFilter, theme.lead, hz, hz, t, len * 0.8, 0.1, 0.6); n++; }
          if (music.step % theme.bassEvery === 0) { const hz = midiHz(keyNote - 12); tone(musicGain, theme.bassWave, hz, hz, t, len * theme.bassEvery * 0.85, 0.14, 0.6); n++; }
          music.next += len;
          if (++music.step >= 8) { music.step = 0; music.bar = (music.bar + 1) % theme.bars.length; }
        }
      } catch (e) { /* keep the game running without music */ }
      return n;
    }

    // ---- settings: theme song, volumes, presets ----
    // picks a song and saves it; a change (not quiet) restarts the loop from bar 1, which is the short preview
    function setSong(name, quiet) {
      if (!SONG_NAMES.includes(name)) return false;
      const changed = name !== song;
      song = name;
      persist();
      if (changed) { music.bar = 0; music.step = 0; music.next = 0; music.playing = false; if (!quiet) tick(); }
      return true;
    }
    const nextSong = () => setSong(SONG_NAMES[(SONG_NAMES.indexOf(song) + 1) % SONG_NAMES.length]);
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
        lives: game.lives, wave: game.wave, status: game.status, shield: game.shield || 0, charges: game.kaboomCharges || 0, nukes: game.nukes || 0,
      };
      const heard = [];
      if (prev && prev.game === game) {
        const fresh = game.bullets.filter((b) => !prev.bullets.has(b));
        if (fresh.some((b) => !b.pierce)) heard.push("shot");
        if (fresh.some((b) => b.pierce)) heard.push("special");
        const gone = [...prev.drones].filter((d) => !now.drones.has(d));
        if (now.charges < prev.charges) heard.push("kaboom");
        if (now.nukes > prev.nukes) heard.push("nuke"); // the blast; its kills add no explosion sounds
        else if (now.charges < prev.charges) { /* the launch frame: just the missile */ }
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
      unlock, play, tick, setTheme, setSong, nextSong, song: () => song, observe, refresh, setVolume, stepVolume, volume, applyPreset, nextPreset, preset, muted, toggleMute,
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
    // the Kaboom blast: [40, 30, 80] on Android, a haptic tick on iPhone; same return values as hit()
    function nuke() {
      if (!enabled()) return null;
      try {
        if (nav && typeof nav.vibrate === "function") { nav.vibrate(NUKE_VIBRATE); return "vibrate"; }
      } catch (e) { /* ignore */ }
      return iosTap() ? "haptic" : null;
    }
    return { hit, nuke };
  }

  const SPEAKER = { x: 396, y: 16, r: 14 }; // the speaker icon in the top bar, left of the pause button
  const speakerHit = (x, y) => Math.hypot(x - SPEAKER.x, y - SPEAKER.y) <= SPEAKER.r + 4;

  root.BBAudio = {
    SPEAKER, speakerHit, VOICE_CAP, STEP, VOLUME_DEFAULTS, SHAKE_MS, NUKE_SHAKE_MS, NUKE_VIBRATE, WORLD_COUNT, SOUNDS, SOUND_IDS, THEMES, SONG_THEMES, SONG_NAMES, DEFAULT_SONG, MOTIFS, SCALES, WORLD_SHIFT, WAVES_PER_WORLD, PRESETS, PRESET_NAMES,
    worldOf, transposeFor, midiHz, createAudio, createHaptics,
  };
})(globalThis);
