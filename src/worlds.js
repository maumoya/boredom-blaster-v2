// Boredom Blaster worlds: five of them, 100 waves each, then the loop starts again in a deeper colour.
// Every 10 waves the hue shifts and a new layer of distant objects appears. Also the ?wave=N debug start
// and the results line (score / maximum possible score). Plain script like game.js; read globalThis.BBWorlds.
(function (root) {
  const WAVES_PER_WORLD = 100;
  const WAVES_PER_SHIFT = 10;
  const HUE_PER_SHIFT = 14; // degrees of background hue each 10 waves add
  const DEEPER_PER_LOOP = 7; // lightness points each finished loop takes off the colours
  const MAX_START_WAVE = 9999;
  const STAR_PERCENT = 70; // the 3rd star also needs this share of the maximum possible score

  // sky: base colour; clouds: [hue, saturation %, lightness %] of the nebula discs; tint: enemy hue-rotate
  // degrees and halo colour; feature: the big thing the background draws (see render.js)
  const WORLDS = [
    { id: 1, name: "Nebula Drift", sky: "#050514", clouds: [[262, 60, 45], [178, 65, 40], [320, 55, 42]], tint: { hue: 0, halo: "120,90,255" }, feature: "nebula" },
    { id: 2, name: "Frost Belt", sky: "#04101c", clouds: [[200, 70, 55], [190, 40, 80], [215, 60, 45]], tint: { hue: 150, halo: "150,220,255" }, feature: "ice" },
    { id: 3, name: "Ember Sun", sky: "#140604", clouds: [[14, 85, 45], [28, 90, 50], [0, 70, 35]], tint: { hue: 200, halo: "255,130,50" }, feature: "sun" },
    { id: 4, name: "Crystal Void", sky: "#031210", clouds: [[150, 60, 38], [180, 70, 42], [130, 55, 32]], tint: { hue: 90, halo: "80,255,200" }, feature: "crystals" },
    { id: 5, name: "Event Horizon", sky: "#020207", clouds: [[275, 50, 30], [30, 70, 35], [250, 45, 25]], tint: { hue: 280, halo: "255,170,80" }, feature: "blackhole" },
  ];

  const index = (wave) => Math.floor((Math.max(1, Math.floor(wave) || 1) - 1) / WAVES_PER_WORLD); // 0 = waves 1-100, 5 = the loop's first
  const worldOf = (wave) => (index(wave) % WORLDS.length) + 1;
  const loopOf = (wave) => Math.floor(index(wave) / WORLDS.length);
  const shiftOf = (wave) => Math.floor(((Math.max(1, Math.floor(wave) || 1) - 1) % WAVES_PER_WORLD) / WAVES_PER_SHIFT); // 0..9

  // everything the background needs for a wave: the world, how deep the loop is, hue shift and distant layers
  function infoFor(wave) {
    const world = worldOf(wave), loop = loopOf(wave), shift = shiftOf(wave);
    return { ...WORLDS[world - 1], world, loop, shift, hueShift: shift * HUE_PER_SHIFT, layers: shift };
  }

  // a cloud's colour as "h,s%,l%" with the wave's hue shift and loop depth applied
  function cloudColor(info, i) {
    const [h, s, l] = info.clouds[i % info.clouds.length];
    const light = Math.max(12, l - DEEPER_PER_LOOP * info.loop);
    const sat = Math.min(100, s + 6 * info.loop);
    return Math.round((h + info.hueShift) % 360) + "," + sat + "%," + light + "%";
  }

  const cardText = (wave) => {
    const info = infoFor(wave);
    return "WORLD " + info.world + ": " + info.name.toUpperCase() + (info.loop ? " - LOOP " + (info.loop + 1) : "");
  };
  // the title card text when the wave moves into another world (prev null = a run starting); else null
  function titleCard(prevWave, wave) {
    if (prevWave !== null && prevWave !== undefined && index(prevWave) === index(wave)) return null;
    return cardText(wave);
  }

  // "?wave=40" -> 40 (debug start); anything missing or not a positive whole number -> 1
  function startWave(search) {
    const m = /[?&]wave=([^&#]*)/.exec(String(search || ""));
    if (!m || !/^\d+$/.test(m[1])) return 1;
    const n = Number(m[1]);
    return n >= 1 ? Math.min(n, MAX_START_WAVE) : 1;
  }

  const fmt = (n) => Math.round(n).toLocaleString("en-US");
  // "12,400 / 15,000 - 83 %"
  function scoreLine(score, max) {
    const pct = max > 0 ? Math.round((score / max) * 100) : 0;
    return fmt(score) + " / " + fmt(max) + " — " + pct + " %";
  }
  // the run result plus the maximum possible score and its percentage; the 3rd star needs 70 % of the maximum
  function withMax(res, game) {
    const max = game.maxScore || 0;
    const pct = max > 0 ? Math.round((res.score / max) * 100) : 0;
    const capped = res.stars >= 3 && res.score * 100 < STAR_PERCENT * max;
    return { ...res, max, pct, stars: capped ? 2 : res.stars, line: scoreLine(res.score, max) };
  }

  root.BBWorlds = {
    WAVES_PER_WORLD, WAVES_PER_SHIFT, HUE_PER_SHIFT, STAR_PERCENT, MAX_START_WAVE, WORLDS,
    worldOf, loopOf, shiftOf, infoFor, cloudColor, titleCard, startWave, scoreLine, withMax,
  };
})(globalThis);
