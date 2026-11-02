import { test } from "node:test";
import assert from "node:assert/strict";
import "../src/skills.js";
import "../src/rewards.js";
import "../src/enemies.js";
import "../src/game.js";
import "../src/keys.js";
import "../src/input.js";
import "../src/assets.js";
import "../src/ui.js";
import "../src/render.js";
import "../src/audio.js";

const A = globalThis.BBAudio, K = globalThis.BBKeys, BB = globalThis.BB, RN = globalThis.BBRender;

function memory(initial) {
  const data = { ...(initial || {}) };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
}

// a fake AudioContext that records every node
function fakeContext() {
  const made = { oscillators: [], gains: [] };
  const param = (log) => ({
    value: 1,
    setValueAtTime(v, t) { log && log.push(["set", v, t]); },
    linearRampToValueAtTime(v, t) { log && log.push(["lin", v, t]); },
    exponentialRampToValueAtTime(v, t) { log && log.push(["exp", v, t]); },
  });
  const ctx = {
    made, state: "suspended", currentTime: 0, destination: {}, resumed: 0,
    resume() { ctx.resumed++; ctx.state = "running"; return Promise.resolve(); },
    createGain() { const g = { events: [], connect(to) { g.to = to; }, kind: "gain" }; g.gain = param(g.events); made.gains.push(g); return g; },
    createOscillator() {
      const o = { frequency: param(), kind: "osc", pitches: [], connect(to) { o.to = to; }, start(t) { o.t0 = t; }, stop(t) { o.t1 = t; } };
      o.frequency.setValueAtTime = (v) => { o.pitches.push(v); };
      made.oscillators.push(o); return o;
    },
    createBiquadFilter() { const f = { kind: "filter", frequency: param(), Q: param(), connect(to) { f.to = to; } }; made.filters = (made.filters || []).concat(f); return f; },
    createDynamicsCompressor() { const c = { kind: "comp", threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(), connect(to) { c.to = to; } }; made.comp = c; return c; },
    createDelay() { const d = { kind: "delay", delayTime: param(), connect() {} }; return d; },
  };
  return ctx;
}
function setup(initial) {
  const storage = memory(initial), settings = K.createSettings(storage), ctx = fakeContext(); let created = 0;
  const audio = A.createAudio({ settings, storage, context: () => { created++; return ctx; } });
  return { storage, settings, ctx, audio, created: () => created };
}
const saved = (s) => JSON.parse(s.storage.data["bb.settings"]);

test("no throw when Web Audio is missing", () => {
  const none = A.createAudio({ settings: K.createSettings(null), context: () => null });
  assert.equal(none.unlock(), false);
  assert.equal(none.play("shot"), false);
  assert.doesNotThrow(() => { none.tick(); none.observe(BB.createGame()); none.toggleMute(); none.setVolume("music", 30); });
  const throwing = A.createAudio({ context: () => { throw new Error("no audio"); } });
  assert.equal(throwing.unlock(), false);
  assert.equal(A.createAudio({}).unlock(), false); // Node has no AudioContext
});

test("audio starts only after a user gesture", () => {
  const s = setup();
  assert.equal(s.created(), 0);
  assert.equal(s.audio.play("shot"), false);
  assert.equal(s.audio.tick(), 0);
  assert.equal(s.ctx.made.oscillators.length, 0);
  assert.equal(s.audio.unlock(), true);
  assert.equal(s.created(), 1);
  assert.equal(s.ctx.resumed, 1);
  s.audio.unlock();
  assert.equal(s.created(), 1);
  assert.equal(s.audio.play("shot"), true);
});

test("mute and the Music and Sounds switches set their gains to 0", () => {
  const s = setup();
  s.audio.unlock();
  const [master, music, sfx] = s.ctx.made.gains;
  assert.equal(music.gain.value, 0.5);
  assert.equal(sfx.gain.value, 0.5);
  s.settings.set("music", false);
  assert.equal(music.gain.value, 0);
  assert.equal(sfx.gain.value, 0.5);
  s.settings.set("sounds", false);
  assert.equal(sfx.gain.value, 0);
  assert.equal(s.audio.play("shot"), false);
  assert.equal(s.audio.muted(), true);
  s.audio.toggleMute(); // M: back on
  assert.equal(music.gain.value, 0.5);
  assert.equal(sfx.gain.value, 0.5);
  s.audio.toggleMute();
  assert.equal(music.gain.value, 0);
  assert.equal(sfx.gain.value, 0);
  assert.equal(master.gain.value, 1);
});

test("volume sliders: 0 to 100 % in 10 % steps, defaults 50 and 50, scaling the gain nodes and saved", () => {
  const s = setup();
  assert.equal(s.audio.volume("music"), 50);
  assert.equal(s.audio.volume("effects"), 50);
  s.audio.unlock();
  const [, music, sfx] = s.ctx.made.gains;
  s.audio.stepVolume("music", 1);
  assert.equal(s.audio.volume("music"), 60);
  assert.equal(music.gain.value, 0.6);
  s.audio.setVolume("effects", 33);
  assert.equal(s.audio.volume("effects"), 30);
  assert.equal(sfx.gain.value, 0.3);
  s.audio.setVolume("music", 500);
  assert.equal(s.audio.volume("music"), 100);
  for (let i = 0; i < 20; i++) s.audio.stepVolume("music", -1);
  assert.equal(s.audio.volume("music"), 0);
  assert.equal(music.gain.value, 0);
  assert.equal(s.audio.setVolume("bogus", 10), false);
  assert.equal(saved(s).musicVolume, 0);
  assert.equal(saved(s).effectsVolume, 30);
  const again = A.createAudio({ settings: K.createSettings(s.storage), storage: s.storage, context: () => fakeContext() });
  assert.equal(again.volume("effects"), 30);
});

test("switch changes keep the saved volumes in bb.settings", () => {
  const s = setup();
  s.audio.setVolume("music", 60);
  s.settings.set("vibration", false);
  s.settings.toggle("sounds");
  const out = saved(s);
  assert.equal(out.musicVolume, 60);
  assert.equal(out.vibration, false);
  assert.equal(out.sounds, false);
});

test("presets: All on, Music only, Effects only, Quiet, Silent, saved in bb.settings", () => {
  assert.deepEqual(A.PRESET_NAMES, ["All on", "Music only", "Effects only", "Quiet", "Silent"]);
  const s = setup();
  s.audio.unlock();
  const [, music, sfx] = s.ctx.made.gains;
  assert.equal(s.audio.preset(), "All on");
  s.audio.applyPreset("Music only");
  assert.equal(music.gain.value, 0.5); assert.equal(sfx.gain.value, 0);
  assert.equal(s.audio.preset(), "Music only");
  s.audio.applyPreset("Effects only");
  assert.equal(music.gain.value, 0); assert.equal(sfx.gain.value, 0.5);
  s.audio.applyPreset("Quiet");
  assert.equal(music.gain.value, 0.3); assert.equal(sfx.gain.value, 0.3);
  assert.deepEqual([saved(s).music, saved(s).sounds, saved(s).musicVolume, saved(s).effectsVolume], [true, true, 30, 30]);
  s.audio.applyPreset("Silent");
  assert.equal(music.gain.value, 0); assert.equal(sfx.gain.value, 0);
  assert.deepEqual([saved(s).music, saved(s).sounds], [false, false]);
  assert.equal(s.audio.applyPreset("Loud"), false);
  s.audio.setVolume("music", 60);
  s.audio.applyPreset("All on");
  s.audio.setVolume("music", 60);
  assert.equal(s.audio.preset(), "Custom");
  s.audio.applyPreset("Silent");
  assert.equal(s.audio.nextPreset(), true); // cycles on to All on
  assert.equal(s.audio.preset(), "All on");
});

test("voice cap of 12", () => {
  const s = setup();
  s.audio.unlock();
  let played = 0;
  for (let i = 0; i < 30; i++) if (s.audio.play("explode")) played++;
  assert.equal(played, A.VOICE_CAP);
  assert.equal(A.VOICE_CAP, 12);
  assert.equal(s.audio.voices(), 12);
  s.ctx.currentTime = 5; // the old ones have ended
  assert.equal(s.audio.play("explode"), true);
});

test("every shot type and event has its own distinct sound", () => {
  const ids = ["shot", "special", "kaboom", "explode", "bossExplode", "hit", "shieldHit", "pickup", "extraLife", "waveClear", "gameOver"];
  for (const id of ids) assert.ok(A.SOUNDS[id], id);
  const sigs = A.SOUND_IDS.map((id) => JSON.stringify(A.SOUNDS[id]));
  assert.equal(new Set(sigs).size, sigs.length);
  assert.equal(A.createAudio({ context: () => fakeContext() }).play("nope"), false);
});

test("game events play their sounds", () => {
  const s = setup();
  s.audio.unlock();
  const g = BB.createGame();
  assert.deepEqual(s.audio.observe(g), []);
  BB.shoot(g);
  assert.deepEqual(s.audio.observe(g), ["shot"]);
  g.specialCooldown = 0; BB.special(g);
  assert.deepEqual(s.audio.observe(g), ["special"]);
  g.drones.pop();
  assert.deepEqual(s.audio.observe(g), ["explode"]);
  g.lives -= 1;
  assert.deepEqual(s.audio.observe(g), ["hit"]);
  g.lives += 1;
  assert.deepEqual(s.audio.observe(g), ["extraLife"]);
  g.kaboomCharges = 1; s.audio.observe(g);
  g.kaboomCharges = 0; g.drones.pop();
  assert.deepEqual(s.audio.observe(g), ["kaboom"]);
  g.nukes += 1; g.drones.pop(); // the blast lands: one nuke sound instead of explosions
  assert.deepEqual(s.audio.observe(g), ["nuke"]);
  g.status = "over";
  assert.deepEqual(s.audio.observe(g), ["gameOver"]);
  assert.deepEqual(s.audio.observe(BB.createGame()), []); // a new run is not an event
});

test("theme note tables: title, play and boss loops of 16 bars, transposed per world", () => {
  for (const name of ["title", "play", "boss"]) {
    const t = A.THEMES[name];
    assert.equal(t.bars.length, 16, name);
    for (const bar of t.bars) {
      assert.equal(bar.lead.length, 8);
      assert.ok(Number.isInteger(bar.bass));
      assert.ok(bar.lead.every((n) => n === null || Number.isInteger(n)));
    }
  }
  assert.notDeepEqual(A.THEMES.title.bars, A.THEMES.play.bars);
  assert.notDeepEqual(A.THEMES.play.bars, A.THEMES.boss.bars);
  assert.equal(A.worldOf(1), 1); assert.equal(A.worldOf(100), 1); assert.equal(A.worldOf(101), 2);
  assert.equal(A.worldOf(500), 5); assert.equal(A.worldOf(501), 1, "after world 5 the worlds repeat");
  assert.equal(A.transposeFor(1), 0);
  assert.notEqual(A.transposeFor(2), A.transposeFor(1));
  assert.equal(A.transposeFor(1 + A.WORLD_SHIFT.length), 0);
  assert.ok(Math.abs(A.midiHz(69) - 440) < 1e-9);
});

test("music schedules notes, higher in the next world, and stays silent when switched off", () => {
  const pitch = (wave) => {
    const s = setup();
    s.audio.unlock();
    s.audio.setTheme("play", wave);
    assert.ok(s.audio.tick() > 0);
    return s.ctx.made.oscillators.length;
  };
  assert.ok(pitch(1) > 0 && pitch(101) > 0);
  const s = setup();
  s.audio.unlock();
  s.audio.setTheme("title", 1);
  s.settings.set("music", false);
  assert.equal(s.audio.tick(), 0);
  assert.equal(s.audio.setTheme("nope", 1), false);
  assert.equal(s.audio.theme, "title");
});

test("the nuke blast vibrates [40, 30, 80], shakes 400 ms and respects the Vibration switch", () => {
  const calls = [];
  const settings = K.createSettings(memory());
  const h = A.createHaptics({ settings, navigator: { vibrate: (p) => calls.push(p) }, document: null });
  assert.equal(h.nuke(), "vibrate");
  assert.deepEqual(calls, [[40, 30, 80]]);
  assert.equal(A.NUKE_SHAKE_MS, 400);
  settings.set("vibration", false);
  assert.equal(h.nuke(), null);
  assert.equal(calls.length, 1);
});

// ---- hit feedback ----
test("vibrate is called only where it exists and Vibration is on", () => {
  const calls = [];
  const settings = K.createSettings(memory());
  const h = A.createHaptics({ settings, navigator: { vibrate: (ms) => calls.push(ms) }, document: null });
  assert.equal(h.hit(), "vibrate");
  assert.deepEqual(calls, [80]);
  settings.set("vibration", false);
  assert.equal(h.hit(), null);
  assert.equal(calls.length, 1);
  const none = A.createHaptics({ settings: K.createSettings(memory()), navigator: {}, document: null });
  assert.equal(none.hit(), null);
  assert.equal(A.createHaptics({ navigator: null, document: undefined }).hit(), null);
});

test("iPhone: the hidden switch checkbox is toggled through its label, never throwing where unsupported", () => {
  const made = []; let clicks = 0;
  const el = (tag) => {
    const e = { tag, children: [], style: {}, attrs: {}, setAttribute(k, v) { e.attrs[k] = v; }, appendChild(c) { e.children.push(c); }, click() { clicks++; } };
    made.push(e); return e;
  };
  const doc = { body: el("body"), createElement: el };
  const h = A.createHaptics({ settings: K.createSettings(memory()), navigator: {}, document: doc });
  assert.equal(h.hit(), "haptic");
  assert.equal(h.hit(), "haptic");
  assert.equal(clicks, 2);
  const input = made.find((e) => e.tag === "input"), label = made.find((e) => e.tag === "label");
  assert.equal(input.type, "checkbox");
  assert.equal(input.attrs.switch, "");
  assert.equal(label.attrs.for, input.id);
  assert.equal(label.children[0], input);
  assert.equal(made.filter((e) => e.tag === "label").length, 1);
  const broken = { body: {}, createElement() { throw new Error("no DOM"); } };
  assert.doesNotThrow(() => assert.equal(A.createHaptics({ navigator: {}, document: broken }).hit(), null));
  const off = K.createSettings(memory()); off.set("vibration", false);
  assert.equal(A.createHaptics({ settings: off, navigator: {}, document: doc }).hit(), null);
});

function recorder() {
  const log = [];
  const target = { canvas: { width: 480, height: 640 } };
  const ctx = new Proxy(target, {
    get(t, k) { if (k in t) return t[k]; return (...args) => { log.push({ fn: k, args }); }; },
    set(t, k, v) { t[k] = v; return true; },
  });
  return { ctx, log };
}

test("a hit always shakes the screen for 250 ms with a red flash; reduced motion keeps the flash, no shake", () => {
  assert.equal(A.SHAKE_MS, 250);
  const run = (reducedMotion) => {
    const { ctx, log } = recorder();
    const r = RN.createRenderer(ctx, null, { reducedMotion });
    const g = BB.createGame();
    r.update(0.01, g);
    g.lives -= 1;
    r.update(0.01, g);
    const frame = () => {
      log.length = 0;
      r.draw({ game: g, menu: { screen: "playing" }, best: 0, time: 1 });
      return {
        shake: log.some((e) => e.fn === "translate"),
        flash: log.some((e) => e.fn === "fillRect" && e.args.length === 4 && e.args[2] === 480 && e.args[3] === 640),
      };
    };
    const start = frame();
    r.update(0.2, g);
    const mid = frame();
    r.update(0.06, g); // past 250 ms
    return { start, mid, after: frame() };
  };
  const full = run(false), calm = run(true);
  assert.equal(full.start.shake, true);
  assert.equal(full.mid.shake, true);
  assert.equal(full.after.shake, false);
  assert.equal(full.start.flash, true);
  assert.equal(calm.start.shake, false);
  assert.equal(calm.start.flash, true);
});

// ---- sound polish (task 18) ----
const inScale = (tonic, pc) => ["major", "minor"].some((m) => A.SCALES[m].includes((((pc - tonic) % 12) + 12) % 12));

test("polish: quiet defaults, saved values still win", () => {
  assert.deepEqual(A.VOLUME_DEFAULTS, { musicVolume: 50, effectsVolume: 50 });
  for (const n of ["All on", "Music only", "Effects only", "Silent"]) assert.deepEqual([A.PRESETS[n].musicVolume, A.PRESETS[n].effectsVolume], [50, 50]);
  assert.deepEqual([A.PRESETS.Quiet.musicVolume, A.PRESETS.Quiet.effectsVolume], [30, 30]);
  const s = setup({ "bb.settings": JSON.stringify({ musicVolume: 90, effectsVolume: 20, volumesV: 2 }) });
  assert.deepEqual([s.audio.volume("music"), s.audio.volume("effects")], [90, 20]);
});

test("volumes reset once: old saved volumes load as 50/50 and are saved with volumesV 2", () => {
  const s = setup({ "bb.settings": JSON.stringify({ musicVolume: 70, effectsVolume: 80 }) });
  assert.deepEqual([s.audio.volume("music"), s.audio.volume("effects")], [50, 50]);
  assert.equal(saved(s).volumesV, 2);
  assert.deepEqual([saved(s).musicVolume, saved(s).effectsVolume], [50, 50]);
  s.audio.setVolume("music", 90); s.audio.setVolume("effects", 20);
  const again = setup({ "bb.settings": s.storage.data["bb.settings"] });
  assert.deepEqual([again.audio.volume("music"), again.audio.volume("effects")], [90, 20]);
});

test("polish: every voice fades in from 0 over 5-10 ms and out to 0 before it stops", () => {
  const s = setup();
  s.audio.unlock();
  s.audio.setTheme("play", 1);
  s.audio.tick();
  for (const id of A.SOUND_IDS) { s.ctx.currentTime += 5; s.audio.play(id); }
  const voices = s.ctx.made.oscillators;
  assert.ok(voices.length > 20);
  for (const o of voices) {
    const ev = o.to.events;
    assert.deepEqual(ev[0].slice(0, 2), ["set", 0]);
    assert.equal(ev.filter((e) => e[0] === "set").length, 1);
    assert.equal(ev[0][2], o.t0);
    assert.equal(ev[1][0], "lin");
    assert.ok(ev[1][1] > 0);
    const ramp = ev[1][2] - o.t0;
    assert.ok(ramp >= 0.005 - 1e-9 && ramp <= 0.01 + 1e-9, String(ramp));
    const last = ev[ev.length - 1];
    assert.deepEqual(last.slice(0, 2), ["lin", 0]);
    assert.ok(o.t1 >= last[2]);
  }
});

test("polish: the shot blip is the quietest effect", () => {
  const peak = (id) => A.SOUNDS[id].vol;
  for (const id of A.SOUND_IDS) if (id !== "shot") assert.ok(peak("shot") < peak(id), id);
});

test("polish: no sawtooth, lead and effects low-passed, compressor on the master bus", () => {
  const s = setup();
  s.audio.unlock();
  for (const wave of [1, 6]) for (const name of ["title", "play", "boss"]) {
    s.audio.setTheme(name, wave); s.ctx.currentTime += 1; s.audio.tick();
  }
  for (const id of A.SOUND_IDS) s.audio.play(id);
  assert.ok(!s.ctx.made.oscillators.some((o) => o.type === "sawtooth"));
  const hz = s.ctx.made.filters.map((f) => f.frequency.value).sort((a, b) => a - b);
  assert.deepEqual(hz, [2500, 4000]);
  assert.ok(s.ctx.made.filters.every((f) => f.type === "lowpass"));
  assert.equal(s.ctx.made.gains[0].to, s.ctx.made.comp);
  assert.equal(s.ctx.made.comp.to, s.ctx.destination);
});

test("polish: theme notes stay in their key's scale in every world; chord loops from scale degrees", () => {
  for (const name of ["title", "play", "boss"]) {
    const t = A.THEMES[name];
    for (let world = 1; world <= A.WORLD_SHIFT.length; world++) {
      const tonic = t.root + A.transposeFor(world);
      for (const bar of t.bars) {
        assert.ok(A.SCALES[t.mode].includes(bar.bass), `${name} bass`);
        for (const n of bar.lead) if (n !== null) assert.ok(inScale(tonic, tonic + bar.bass + n), `${name} w${world} lead ${n}`);
      }
    }
  }
  const loop = (name) => A.THEMES[name].bars.slice(0, 4).map((b) => b.bass);
  assert.deepEqual(loop("play"), [0, 7, 9, 5]); // I-V-vi-IV
  assert.deepEqual(loop("boss"), [0, 8, 3, 10]); // i-VI-III-VII
});

test("polish: at most 3 music voices at once, none a semitone apart", () => {
  for (const name of ["title", "play", "boss"]) {
    const s = setup();
    s.audio.unlock();
    s.audio.setTheme(name, 1);
    for (let i = 0; i < 60; i++) { s.ctx.currentTime = i * 0.2; s.audio.tick(); }
    const v = s.ctx.made.oscillators.map((o) => ({ a: o.t0, b: o.t1, midi: 69 + 12 * Math.log2(o.pitches[0] / 440) }));
    assert.ok(v.length > 50);
    for (const x of v) {
      const live = v.filter((y) => y.a < x.b && x.a < y.b);
      assert.ok(live.length <= 3, name);
      for (const y of live) assert.ok(Math.abs(x.midi - y.midi) > 1.5 || Math.abs(x.midi - y.midi) < 0.5, `${name} ${x.midi} ${y.midi}`);
    }
  }
});

test("theme songs: five songs follow the Task 18 rules and keep the boss theme", () => {
  assert.deepEqual(A.SONG_NAMES, ["Nebula", "Starlight", "Pulse", "Drift", "Overdrive"]);
  for (const song of A.SONG_NAMES) {
    for (const name of ["title", "play", "boss"]) {
      const t = A.SONG_THEMES[song][name], tonic = t.root;
      assert.equal(t.bars.length, 16, `${song} ${name}`);
      for (const bar of t.bars) {
        assert.ok(A.SCALES[t.mode].includes(bar.bass));
        for (const n of bar.lead) if (n !== null) assert.ok(inScale(tonic, tonic + bar.bass + n), `${song} ${name} lead ${n}`);
      }
    }
    assert.equal(A.SONG_THEMES[song].boss.bars, A.SONG_THEMES.Nebula.boss.bars, "one boss theme");
    for (const name of ["title", "play", "boss"]) {
      const s = setup();
      s.audio.unlock();
      assert.equal(s.audio.setSong(song, true), true);
      s.audio.setTheme(name, 1);
      for (let i = 0; i < 120; i++) { s.ctx.currentTime = i * 0.2; s.audio.tick(); } // 24 s, so slow songs also pass 50
      const osc = s.ctx.made.oscillators;
      assert.ok(osc.length > 50 && !osc.some((o) => o.type === "sawtooth"), `${song} ${name}`);
      // voices sounding together at each note's start
      for (const x of osc) assert.ok(osc.filter((y) => y.t0 <= x.t0 && x.t0 < y.t1).length <= 3, `${song} ${name}`);
      assert.deepEqual(s.ctx.made.filters.map((f) => f.frequency.value).sort((a, b) => a - b), [2500, 4000]);
      assert.equal(s.ctx.made.comp.to, s.ctx.destination);
    }
  }
  const bpm = (song) => 30 / A.SONG_THEMES[song].play.step;
  assert.ok(bpm("Starlight") > 80 && bpm("Starlight") < 88 && A.SONG_THEMES.Starlight.play.mode === "major");
  assert.ok(bpm("Pulse") > 124 && bpm("Pulse") < 132);
  assert.ok(bpm("Drift") > 68 && bpm("Drift") < 76 && A.SONG_THEMES.Drift.play.mode === "minor");
  assert.ok(bpm("Overdrive") > 145 && bpm("Overdrive") < 155);
});

test("theme songs: default Nebula, cycling saves bb.settings.theme and previews, unknown falls back", () => {
  const s = setup();
  assert.equal(s.audio.song(), "Nebula");
  s.audio.unlock();
  const before = s.ctx.made.oscillators.length;
  assert.equal(s.audio.nextSong(), true);
  assert.equal(s.audio.song(), "Starlight");
  assert.equal(saved(s).theme, "Starlight");
  assert.ok(s.ctx.made.oscillators.length > before, "preview plays");
  for (let i = 0; i < 4; i++) s.audio.nextSong();
  assert.equal(s.audio.song(), "Nebula", "wraps after five");
  assert.equal(s.audio.setSong("Nope"), false);
  assert.equal(setup({ "bb.settings": JSON.stringify({ theme: "Drift" }) }).audio.song(), "Drift");
  assert.equal(setup({ "bb.settings": JSON.stringify({ theme: "Bogus" }) }).audio.song(), "Nebula");
  s.audio.setSong("Pulse");
  s.audio.setSong("Nebula", true); // Reset all
  assert.equal(saved(s).theme, "Nebula");
});
