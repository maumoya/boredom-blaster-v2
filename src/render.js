// Boredom Blaster drawing: sprites with plain-shape fallbacks, glow bullets, particle explosions,
// parallax stars and meteors, shield ring, hit flash, boss HP bar, framed HUD and the menu screens.
// Plain script; main.js calls BBRender.createRenderer(ctx, assets). Tests drive it with a stub canvas.
(function (root) {
  const UI = root.BBUI, N = UI.NEON; // shared neon palette and type
  const W = 480, H = root.BB_FIELD_H || 640; // index.html sets the full-screen height; 640 in tests
  const HUD_H = 60; // the floating top panel: lives, score, mute, pause; then wave, skills, shield, BOOM
  const CONTROLS_ALPHA = 0.4; // the floating buttons are see-through (0.65 while pressed)
  const NEBULA = [ // drifting colour clouds: x, y, radius, colour, drift speed
    { x: 0.2, y: 0.25, r: 190, c: "90,60,200", v: 6 }, { x: 0.8, y: 0.55, r: 220, c: "30,120,200", v: 4 },
    { x: 0.5, y: 0.9, r: 200, c: "190,50,140", v: 5 },
  ];
  const SHOCK = { life: 0.45, radius: 46, bigRadius: 110 };
  const RANK_COLOR = { bronze: "#c8843c", silver: "#cfd6e0", gold: "#ffd23c" };
  const RANK_SPRITE = { bronze: "capsuleBronze", silver: "capsuleSilver", gold: "capsuleGold", rainbow: "capsuleRainbow" };
  const SPRITE_SCALE = 1.35; // sprites are drawn a bit larger than their hitbox
  const FLASH_TIME = 0.35;
  const BLINK_HZ = 3; // blinks per second for a new high-score row
  // the two tabs on the high-scores screen, in canvas pixels
  const SCORE_TABS = {
    global: { x: 70, y: 160, w: 160, h: 28, label: "GLOBAL" },
    device: { x: 250, y: 160, w: 160, h: 28, label: "THIS DEVICE" },
  };
  const MAX_PARTICLES = 400;
  const HIT_FLASH_TIME = 0.06; // seconds an enemy stays white after a hit
  const SLOW_FRAME = 0.02; // a frame longer than this steps the effects down
  const FX_RECOVER = 1.5; // seconds of quick frames before the effects step back up
  const BLOOM_LIFE = 0.5;
  const DEFAULT_HALO = "120,90,255";
  const STAR_LAYERS = [
    { count: 30, speed: 18, size: 1, sprite: null },
    { count: 18, speed: 40, size: 2, sprite: null },
    { count: 8, speed: 70, size: 12, sprite: "star1" },
  ];
  const METEORS = [
    { sprite: "meteorBig1", size: 56, speed: 26 }, { sprite: "meteorMed", size: 34, speed: 34 },
    { sprite: "meteorBig2", size: 48, speed: 22 }, { sprite: "meteorSmall", size: 22, speed: 48 },
    { sprite: "meteorTiny", size: 14, speed: 60 },
  ];
  // the how-to-play rows, showing the keys currently bound (keys: a BBKeys.createKeys() object)
  function howToRows(keys) {
    const k = (a) => keys.label(a);
    return [
      { icon: "heart", text: "Steer: drag left half / arrows / " + [k("up"), k("left"), k("down"), k("right")].join("") },
      { icon: "fire", text: "Fire: hold " + k("fire") + " or the FIRE button" },
      { icon: "spec", text: "Special (" + k("special") + "): piercing shot" },
      { icon: "boom", text: "Kaboom (" + k("kaboom") + "): blasts nearby enemies" },
      { icon: "weapon", text: "Capsules: pick a skill (1-7, arrows + Enter)" },
      { icon: "shield", text: "Silver: +shield, gold: 2 picks, heart: life" },
      { icon: "pause", text: "Pause: " + k("pause") + " or Esc" },
      { icon: "star", text: "iPhone: Share › Add to Home Screen for full screen" },
    ];
  }
  const HOW_TO_ROWS = howToRows(root.BBKeys.createKeys(null));
  const HOW_TO = HOW_TO_ROWS.map((r) => r.text);
  const SHAKE = { time: 0.25, mag: 6 }; // screen shake after a lost life
  const NUKE_SHAKE = { time: 0.4, mag: 12 }; // ...and after the Kaboom blast
  const NUKE_FLASH = { time: 0.22, dimmed: 0.35 }; // the white flash; a share of it with reduced motion
  const CARD_TIME = 2.8; // seconds a world title card stays up
  const STAGE_COLOR = { ice: "200,235,255", crystals: "90,255,210" };
  const PULSE = { depth: 0.06, speed: 4 }; // gentle breathing of the title and the replay prompt
  const GOAL_ICON = { miniboss: "escort", kaboom: "boom", weapon: "weapon" };

  // an offscreen canvas for the ship cache; null in Node, where ships draw straight to the target
  function defaultMakeCanvas(w, h) {
    const doc = root.document;
    if (doc && typeof doc.createElement === "function") {
      const c = doc.createElement("canvas");
      c.width = w; c.height = h;
      return c;
    }
    return typeof root.OffscreenCanvas === "function" ? new root.OffscreenCanvas(w, h) : null;
  }

  // opts.reducedMotion: no pulses, no background drift, no screen shake
  // opts.makeCanvas(w, h): offscreen canvas factory for the ship cache (default: document or OffscreenCanvas)
  function createRenderer(ctx, assets, opts) {
    let reducedMotion = !!(opts && opts.reducedMotion);
    const shake = { time: 0, max: SHAKE.time, mag: SHAKE.mag };
    let card = null; // the world title card: { text, life }
    let info = null; // the world of the current wave (src/worlds.js), set each frame
    const particles = [];
    const rings = []; // explosion shockwaves
    const blooms = []; // explosion bloom: layered radial gradients
    const hitFlash = new WeakMap(); // enemy -> seconds of white flash left
    const lastHp = new WeakMap(); // enemy -> hp seen last frame
    const fx = { full: true, calm: 0 }; // full effects, or stepped down after a slow frame
    const ui = root.BBUI.createUI(ctx);
    // without the assets script loaded (some tests) the ships are simply skipped
    const shipArt = root.BBAssets
      ? root.BBAssets.createShipArt((opts && opts.makeCanvas) || defaultMakeCanvas) : { draw() {} };
    const flash = { time: 0 };
    let prev = { drones: [], lives: null, wave: null, nukes: 0 };
    let scroll = 0;
    // fixed pseudo-random layout so the background is stable between frames
    const frac = (i, k) => ((i * k) % 1000) / 1000;
    const stars = STAR_LAYERS.map((layer, li) => Array.from({ length: layer.count }, (_, i) => ({
      x: frac(i + 1, 137.5 + li * 31) * W, y: frac(i + 1, 71.3 + li * 17) * H,
    })));
    const meteors = METEORS.map((m, i) => ({ ...m, x: frac(i + 1, 211) * W, y: frac(i + 3, 97) * H }));

    // ---- helpers ----
    function sprite(name, cx, cy, w, fallback, rotation) {
      const img = assets && assets.get(name);
      if (!img) { if (fallback) fallback(); return; }
      const aspect = (img.height && img.width) ? img.height / img.width : 1;
      const h = w * aspect;
      if (rotation) {
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(rotation);
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
        ctx.restore();
      } else ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
    }
    function circle(x, y, r, fill, stroke, lineWidth) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth || 3; ctx.stroke(); }
    }
    function text(str, x, y, size, color, align) {
      ctx.fillStyle = color;
      ctx.font = UI.font(size);
      ctx.textAlign = align || "left";
      ctx.fillText(str, x, y);
    }
    function panel(x, y, w, h, fill, stroke) {
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    }
    const rainbow = (t) => "hsl(" + (Math.floor(t * 250) % 360) + ",90%,60%)";
    const rankColor = (rank, t) => (rank === "rainbow" ? rainbow(t) : rank === "heart" ? N.red : RANK_COLOR[rank] || "#fff");
    const center = (e) => [e.x + e.w / 2, e.y + e.h / 2];

    // "#rgb" / "#rrggbb" -> "r,g,b" for rgba() strings
    function rgbOf(hex) {
      const h = String(hex).replace("#", "");
      const f = h.length === 3 ? h.replace(/./g, "$&$&") : h;
      return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) || 0).join(",");
    }

    // ---- effects state ----
    function emit(p) { // every particle goes through here, so the cap holds
      if (particles.length < MAX_PARTICLES) particles.push({ ...p, max: p.life });
    }
    function explode(x, y, big) {
      const n = (big ? 64 : 22) >> (fx.full ? 0 : 1);
      rings.push({ x, y, life: SHOCK.life, max: SHOCK.life, radius: big ? SHOCK.bigRadius : SHOCK.radius });
      if (fx.full) blooms.push({ x, y, life: BLOOM_LIFE, max: BLOOM_LIFE, radius: big ? 130 : 52 });
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + i * 0.7, v = (big ? 220 : 140) * (0.4 + ((i * 37) % 10) / 10);
        emit({
          x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + ((i * 13) % 5) * 0.08,
          color: i % 3 === 0 ? "#fff" : i % 3 === 1 ? N.yellow : "#f74", size: (big ? 6 : 4) + (i % 3),
        });
      }
      const chunks = fx.full ? (big ? 12 : 6) : 0; // larger debris that lingers
      for (let i = 0; i < chunks; i++) {
        const a = (i / chunks) * Math.PI * 2 + 0.5, v = (big ? 120 : 80) * (0.5 + ((i * 29) % 7) / 7);
        emit({
          x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.7 + ((i * 11) % 4) * 0.08,
          color: i % 2 ? "#c86" : "#999", size: (big ? 10 : 8) + (i % 3) * 2, debris: true,
        });
      }
    }
    // a few quick sparks where an enemy was hit
    function sparks(x, y) {
      const n = fx.full ? 6 : 2;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + x * 0.13, v = 150 + ((i * 41) % 5) * 30;
        emit({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.25, color: i % 2 ? "#fff" : N.yellow, size: 2 });
      }
    }
    // enemies whose hp dropped flash white for a moment and throw sparks
    function trackHits(drones, dt) {
      for (const d of drones) {
        const left = hitFlash.get(d);
        if (left > 0) hitFlash.set(d, left - dt);
        if (typeof d.hp !== "number") continue;
        const was = lastHp.get(d);
        if (was !== undefined && d.hp < was) {
          hitFlash.set(d, HIT_FLASH_TIME);
          sparks(d.x + d.w / 2, d.y + d.h / 2);
        }
        lastHp.set(d, d.hp);
      }
    }
    // a slow frame steps the effects down; a second and a half of quick frames brings them back
    function stepEffects(dt) {
      if (dt > SLOW_FRAME) { fx.full = false; fx.calm = 0; return; }
      fx.calm += dt;
      if (fx.calm >= FX_RECOVER) fx.full = true;
    }

    // Reads the game each frame: vanished enemies explode, a lost life flashes the screen.
    function update(dt, game) {
      if (!reducedMotion) scroll += dt; // drift
      stepEffects(dt);
      trackHits(game.drones, dt);
      const alive = new Set(game.drones);
      for (const d of prev.drones) {
        if (!alive.has(d)) explode(d.x + d.w / 2, d.y + d.h / 2, !!d.boss);
      }
      if (prev.lives !== null && game.lives < prev.lives) {
        flash.time = FLASH_TIME;
        if (!reducedMotion) Object.assign(shake, { time: SHAKE.time, max: SHAKE.time, mag: SHAKE.mag });
      }
      if ((game.nukes || 0) > prev.nukes && !reducedMotion) Object.assign(shake, { time: NUKE_SHAKE.time, max: NUKE_SHAKE.time, mag: NUKE_SHAKE.mag });
      const worlds = root.BBWorlds;
      // during the warp the old world stays behind until the ship has flown out
      const warpP = game.warp && root.BB.warpPhase ? root.BB.warpPhase(game.warp.t).name : null;
      info = worlds ? worlds.infoFor(warpP === "stamp" || warpP === "fly" ? game.wave - 1 : game.wave) : null;
      const cardText = worlds && worlds.titleCard(prev.wave, game.wave);
      if (cardText) card = { text: cardText, life: CARD_TIME };
      prev = { drones: game.drones.slice(), lives: game.lives, wave: game.warp ? prev.wave : game.wave, nukes: game.nukes || 0 }; // the world card waits for the warp
      flash.time = Math.max(0, flash.time - dt);
      shake.time = Math.max(0, shake.time - dt);
      if (card) { card.life -= dt; if (card.life <= 0) card = null; }
      for (const p of particles) {
        p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
        if (p.debris) { p.vx *= 0.97; p.vy = p.vy * 0.97 + 60 * dt; }
      }
      for (let i = particles.length - 1; i >= 0; i--) if (particles[i].life <= 0) particles.splice(i, 1);
      for (const b of blooms) b.life -= dt;
      for (let i = blooms.length - 1; i >= 0; i--) if (blooms[i].life <= 0) blooms.splice(i, 1);
      for (const r of rings) r.life -= dt;
      for (let i = rings.length - 1; i >= 0; i--) if (rings[i].life <= 0) rings.splice(i, 1);
    }

    // ---- scene ----
    // soft colour clouds that drift down and sway; flat translucent discs when gradients are missing
    function drawNebula() {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      NEBULA.forEach((n, i) => {
        const x = n.x * W + Math.sin(scroll * 0.15 + i * 2) * 40;
        const y = ((n.y * H + scroll * n.v) % (H + 2 * n.r)) - n.r;
        const tone = (a) => (info ? "hsla(" + root.BBWorlds.cloudColor(info, i) + "," + a + ")" : "rgba(" + n.c + "," + a + ")");
        const g = ctx.createRadialGradient(x, y, 0, x, y, n.r);
        if (g && typeof g.addColorStop === "function") {
          g.addColorStop(0, tone(0.42));
          g.addColorStop(1, tone(0));
          ctx.fillStyle = g;
          ctx.fillRect(x - n.r, y - n.r, n.r * 2, n.r * 2);
        } else circle(x, y, n.r * 0.7, tone(0.18));
      });
      ctx.restore();
    }

    // a soft glow: a radial gradient, or a flat disc when gradients are missing
    function glow(x, y, r, rgb, alpha) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      if (g && typeof g.addColorStop === "function") {
        g.addColorStop(0, "rgba(" + rgb + "," + alpha + ")");
        g.addColorStop(1, "rgba(" + rgb + ",0)");
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      } else circle(x, y, r * 0.6, "rgba(" + rgb + "," + alpha * 0.5 + ")");
    }
    const drift = (speed, span) => (scroll * speed) % span;
    const BLACK_HOLE = { x: W * 0.72, y: H * 0.3, r: 34, lens: 170 };

    // each world's big feature, drawn behind the stars
    function drawFeature() {
      const kind = info.feature;
      ctx.save();
      if (kind === "ice") { // pale ice asteroids tumbling past
        for (let i = 0; i < 7; i++) {
          const x = frac(i + 2, 173) * W, y = (frac(i + 5, 89) * H + drift(14 + i * 3, H + 160)) % (H + 160) - 80, r = 18 + (i % 4) * 9;
          ctx.fillStyle = "rgba(" + STAGE_COLOR.ice + ",0.28)";
          ctx.strokeStyle = "rgba(255,255,255,0.5)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * Math.PI * 2 + i, rr = r * (0.75 + 0.25 * ((k * 5 + i) % 3) / 2);
            if (k) ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); else ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
          }
          ctx.closePath(); ctx.fill(); ctx.stroke();
        }
      } else if (kind === "sun") { // a red giant on the horizon with an orange haze above it
        glow(W / 2, H + 40, 420, "255,110,30", 0.4);
        glow(W / 2, H + 60, 230, "255,50,20", 0.85);
        circle(W / 2, H + 70, 170, "rgba(210,40,20,0.9)");
      } else if (kind === "crystals") { // green and cyan crystal shards
        for (let i = 0; i < 9; i++) {
          const x = frac(i + 1, 151) * W, y = (frac(i + 4, 67) * H + drift(10 + i * 2, H + 120)) % (H + 120) - 60, s = 14 + (i % 3) * 10;
          const hue = i % 2 ? "70,255,170" : "70,220,255";
          ctx.fillStyle = "rgba(" + hue + ",0.3)";
          ctx.strokeStyle = "rgba(" + hue + ",0.8)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x, y - s * 1.6); ctx.lineTo(x + s * 0.6, y); ctx.lineTo(x, y + s * 1.6); ctx.lineTo(x - s * 0.6, y);
          ctx.closePath(); ctx.fill(); ctx.stroke();
        }
      } else if (kind === "blackhole") { // a black hole with an accretion ring
        const b = BLACK_HOLE;
        glow(b.x, b.y, 120, "255,150,60", 0.3);
        for (let k = 0; k < 4; k++) {
          ctx.strokeStyle = "rgba(255," + (190 - k * 35) + "," + (90 - k * 15) + "," + (0.8 - k * 0.15) + ")";
          ctx.lineWidth = 5 - k;
          ctx.beginPath();
          ctx.ellipse(b.x, b.y, b.r * (1.9 + k * 0.45), b.r * (0.55 + k * 0.12), -0.35, 0, Math.PI * 2);
          ctx.stroke();
        }
        circle(b.x, b.y, b.r, "#000");
      }
      ctx.restore();
    }

    // new layers of distant objects: one more every 10 waves of the world
    function drawDistant() {
      for (let layer = 0; layer < info.layers; layer++) {
        for (let i = 0; i < 3; i++) {
          const x = frac(layer * 3 + i + 1, 193) * W, y = (frac(layer * 3 + i + 7, 59) * H + drift(3 + layer, H + 20)) % (H + 20);
          circle(x, y, 1.5 + ((layer + i) % 3), "hsla(" + root.BBWorlds.cloudColor(info, layer + i) + ",0.55)");
        }
      }
    }

    // where a star shows up: near the black hole the light bends outward around it
    function bent(x, y) {
      if (!info || info.feature !== "blackhole") return [x, y];
      const b = BLACK_HOLE, dx = x - b.x, dy = y - b.y, d = Math.hypot(dx, dy);
      if (d >= b.lens || d < 1) return [x, y];
      const f = 1 + (1 - d / b.lens) * 0.9;
      return [b.x + dx * f, b.y + dy * f];
    }

    function drawShockwaves() {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const r of rings) {
        const k = 1 - r.life / r.max;
        ctx.globalAlpha = Math.max(0, 1 - k);
        circle(r.x, r.y, r.radius * k, null, "#fff", 3 * (1 - k) + 1);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // layered engine flame: outer orange teardrop, inner white-yellow core, flickering with time
    function drawEngineFlame(cx, baseY, t, ultra) {
      const f = 0.8 + 0.2 * Math.sin(t * 40) + 0.1 * Math.sin(t * 23);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      glow(cx, baseY + 12, ultra ? 34 : 28, ultra ? "255,50,20" : "255,140,50", 0.45 * f); // soft halo behind the flame
      glow(cx, baseY + 4, 14, "255,240,200", 0.5 * f);
      const layers = ultra ? [[8, 28, "rgba(255,40,20,0.85)"], [4, 16, "rgba(255,150,60,0.95)"], [2, 9, "rgba(255,255,255,0.95)"]]
        : [[7, 22, "rgba(255,120,30,0.8)"], [4, 14, "rgba(255,230,120,0.95)"], [2, 8, "rgba(255,255,255,0.95)"]];
      for (const [w, len, color] of layers) {
        ctx.beginPath();
        ctx.moveTo(cx - w, baseY);
        ctx.quadraticCurveTo(cx, baseY + len * 1.4 * f, cx + w, baseY);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
      }
      ctx.restore();
    }
    // a tumbling rock: an uneven polygon with a hot orange edge
    function drawDebris(d) {
      const r = d.w / 2, cx = d.x + r, cy = d.y + r;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(d.spin || 0);
      ctx.beginPath();
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2, k = 0.78 + 0.22 * Math.sin(i * 2.7 + r);
        ctx[i ? "lineTo" : "moveTo"](Math.cos(a) * r * k, Math.sin(a) * r * k);
      }
      ctx.closePath();
      ctx.fillStyle = "#5a4232";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,170,90,0.9)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }

    function drawBackground() {
      ctx.fillStyle = info ? info.sky : "#050514";
      ctx.fillRect(0, 0, W, H);
      drawNebula();
      if (info) { drawFeature(); drawDistant(); }
      stars.forEach((layer, li) => {
        const L = STAR_LAYERS[li];
        for (const s of layer) {
          const [x, y] = bent(s.x, (s.y + scroll * L.speed) % H);
          if (L.sprite) sprite(L.sprite, x, y, L.size, () => { ctx.fillStyle = "#fff"; ctx.fillRect(x, y, 3, 3); });
          else { ctx.fillStyle = li ? "#cde" : "#789"; ctx.fillRect(x, y, L.size, L.size); }
        }
      });
      ctx.globalAlpha = 0.55;
      meteors.forEach((m, i) => {
        const y = (m.y + scroll * m.speed) % (H + 120) - 60;
        sprite(m.sprite, m.x, y, m.size, () => circle(m.x, y, m.size / 2, "#556"), scroll * 0.3 * (i % 2 ? 1 : -1));
      });
      ctx.globalAlpha = 1;
    }

    function drawEnemy(e) {
      const [cx, cy] = center(e);
      const w = e.w * (e.boss ? 1.1 : SPRITE_SCALE);
      const tinted = info && (info.world > 1 || info.loop > 0);
      const halo = info ? info.tint.halo : DEFAULT_HALO;
      ctx.save(); // glow outline in the world tint
      ctx.globalCompositeOperation = "lighter";
      glow(cx, cy, w * 0.85, halo, 0.22);
      circle(cx, cy, w * 0.46, null, "rgba(" + halo + ",0.55)", 2);
      ctx.restore();
      if (tinted) { // each world tints its enemies: a halo everywhere, a hue shift where the canvas has filters
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        glow(cx, cy, w * 0.9, info.tint.halo, 0.3);
        ctx.restore();
        ctx.save();
        if (typeof ctx.filter === "string") ctx.filter = "hue-rotate(" + (info.tint.hue + 25 * info.loop) + "deg)";
      }
      shipArt.draw(ctx, e.species || "drone", cx, cy, w);
      if (tinted) ctx.restore();
      if (hitFlash.get(e) > 0) { // white hit flash
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        glow(cx, cy, w * 0.75, "255,255,255", 0.9);
        circle(cx, cy, w * 0.3, "rgba(255,255,255,0.6)");
        ctx.restore();
      }
    }

    // MASTERED projectiles glow gold, ULTRA-MAD ones red-hot; ULTRA-MAD faster shots leave a trail
    const PROJECTILE = { 6: "#ffd23c", 7: "#ff4b1f" };
    function drawBullet(b) {
      if (b.pierce) { glowRect(b, "special", N.magenta); return; }
      const color = PROJECTILE[b.tier] || N.cyan;
      if (b.trail) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = color;
        ctx.fillRect(b.x, b.dir > 0 ? b.y - 18 : b.y + b.h, b.w, 18);
        ctx.restore();
      }
      glowRect(b, "bullet", color);
    }

    // The highest skill tier sets the ship aura: MASTERED pulsing gold with flame spikes and sparkles,
    // ULTRA-MAD flickering red-orange flames and embers. Reduced motion keeps it static.
    function drawAura(game, cx, cy, t) {
      const tierNow = root.BBSkills.highestTier(game);
      if (tierNow < root.BBSkills.MASTERED) return;
      const ultra = tierNow >= root.BBSkills.ULTRA, k = reducedMotion ? 0 : 1, ph = t * k;
      const rgb = ultra ? "255,70,20" : "255,210,60";
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const r = 26 + (ultra ? 0 : 3 * Math.sin(ph * 4));
      circle(cx, cy, r, "rgba(" + rgb + ",0.18)", "rgba(" + rgb + ",0.8)", 2);
      const spikes = ultra ? 12 : 8;
      ctx.fillStyle = "rgba(" + rgb + ",0.7)";
      for (let i = 0; i < spikes; i++) {
        const a = (i / spikes) * Math.PI * 2 + ph * 0.8;
        const len = 10 + (ultra ? 6 * Math.sin(ph * 25 + i * 2.1) : 4 * Math.sin(ph * 6 + i));
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a - 0.12) * r, cy + Math.sin(a - 0.12) * r);
        ctx.lineTo(cx + Math.cos(a) * (r + len), cy + Math.sin(a) * (r + len));
        ctx.lineTo(cx + Math.cos(a + 0.12) * r, cy + Math.sin(a + 0.12) * r);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = ultra ? "rgba(255,160,60,0.9)" : "rgba(255,255,200,0.9)"; // embers / sparkles
      for (let i = 0; i < 6; i++) {
        const a = i * 1.05 + ph * 1.5, rr = r + 8 + ((ph * (ultra ? 40 : 10) + i * 9) % 14);
        ctx.fillRect(cx + Math.cos(a) * rr - 1, cy + Math.sin(a) * rr - 1, 2, 2);
      }
      ctx.restore();
    }

    function glowRect(b, name, color) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2; // gradient glow, no costly blur
      glow(cx, cy, Math.max(b.w, b.h) * 1.6 + 6, rgbOf(color), 0.55);
      sprite(name, cx, cy, b.w * 2.2, () => {
        ctx.fillStyle = color;
        ctx.fillRect(b.x, b.y, b.w, b.h);
      });
      ctx.restore();
    }

    function drawCapsule(c, t) {
      const [cx, cy] = center(c);
      ctx.save();
      ctx.shadowColor = rankColor(c.rank, t);
      ctx.shadowBlur = 10;
      if (c.rank === "heart") { // no sprite for the heart capsule: a red heart badge
        ui.icon("heart", cx, cy, c.h * 1.5, N.red);
        ctx.restore();
        return;
      }
      sprite(RANK_SPRITE[c.rank] || "capsuleBronze", cx, cy, c.w, () => {
        ctx.fillStyle = rankColor(c.rank, t);
        ctx.fillRect(c.x + 4, c.y, c.w - 8, c.h);
      });
      ctx.restore();
    }

    function drawShip(game, t) {
      const s = game.ship, [cx, cy] = center(s);
      const blink = game.invuln > 0 && Math.floor(game.invuln * 10) % 2 === 0;
      if (game.status !== "playing" || blink) return;
      const flicker = 0.8 + 0.2 * Math.sin(t * 40);
      drawAura(game, cx, cy, t);
      drawEngineFlame(cx, s.y + s.h - 2, t, root.BBSkills.highestTier(game) >= root.BBSkills.ULTRA);
      sprite("flame", cx, s.y + s.h + 6, 9 * flicker, null);
      const dmg = Math.max(0, Math.min(3, 3 - game.lives));
      shipArt.draw(ctx, "player", cx, cy, s.w * 1.6, { dmg });
      ctx.save(); // rim light around the hull
      ctx.globalCompositeOperation = "lighter";
      glow(cx, cy, s.w * 0.95, "47,243,255", 0.18);
      circle(cx, cy - 2, s.w * 0.78, null, "rgba(190,250,255,0.5)", 1.5);
      ctx.restore();
      if (game.superStar > 0) circle(cx, cy, 26, null, rainbow(t), 3);
      if (game.shield > 0) { // shield ring, fainter as it is used up
        ctx.globalAlpha = 0.4 + 0.2 * game.shield;
        sprite("shield", cx, cy - 2, 62, () => circle(cx, cy, 28, null, "#7df", 2));
        ctx.globalAlpha = 1;
      }
    }

    // Laser beams go straight up: cyan, MASTERED gold, ULTRA-MAD red. A limited beam stops at its last enemy.
    function drawLaser(game, t) {
      const beam = game.laserBeam;
      if (!beam) return;
      const tier = root.BBSkills.tier(game, "laser"), color = tier >= 7 ? "#ff4b1f" : tier >= 6 ? "#ffd23c" : N.cyan;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      beam.cols.forEach((cx, i) => {
        const top = beam.reach[i] || 0, w = 10 + 2 * Math.sin(t * 60);
        ctx.fillStyle = color; ctx.globalAlpha = 0.35;
        ctx.fillRect(cx - w, top, w * 2, game.ship.y - top);
        ctx.globalAlpha = 0.95; ctx.fillStyle = "#fff";
        ctx.fillRect(cx - 2, top, 4, game.ship.y - top);
      });
      ctx.restore();
    }

    // Moons orbit the ship: cracks grow as they take damage; MASTERED gold, ULTRA-MAD red with a fire trail.
    function drawMoons(game, t) {
      const B = root.BB, tier = root.BBSkills.tier(game, "moons");
      if (game.status !== "playing" || !game.moons) return;
      const color = tier >= 7 ? "#ff4b1f" : tier >= 6 ? "#ffd23c" : "#cfd8ff";
      game.moons.forEach((m, i) => {
        if (m.hp <= 0) return;
        const p = B.moonPos(game, i), [cx, cy] = center(p), r = p.w / 2;
        if (tier >= 7) { // fire trail behind the orbit
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          for (let k = 1; k <= 3; k++) {
            const a = game.moonAngle + (i * Math.PI * 2) / game.moons.length - k * 0.22;
            const ox = game.ship.x + game.ship.w / 2 + Math.cos(a) * B.MOON.orbit, oy = game.ship.y + game.ship.h / 2 + Math.sin(a) * B.MOON.orbit;
            ctx.globalAlpha = 0.45 - k * 0.12; ctx.fillStyle = "#ff8a2a";
            ctx.beginPath(); ctx.arc(ox, oy, r - k, 0, Math.PI * 2); ctx.fill();
          }
          ctx.restore();
        }
        circle(cx, cy, r, color, "#fff", 1);
        const cracks = Math.min(5, Math.floor((1 - m.hp / m.max) * 6)); // more lines as the hits run out
        ctx.strokeStyle = "#222"; ctx.lineWidth = 1.5;
        for (let k = 0; k < cracks; k++) {
          const a = k * 1.3 + 0.4;
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); ctx.stroke();
        }
      });
    }

    function drawTwin(game, t) {
      const B = root.BB;
      if (game.twinFlash) {
        const f = game.twinFlash, [cx, cy] = center(f);
        ctx.globalAlpha = Math.max(0, f.life / 0.3);
        circle(cx, cy, 10 + (0.3 - f.life) * 120, "#fff", null, 0);
        ctx.globalAlpha = 1;
      }
      if (!game.twin || game.status !== "playing") return;
      const r = B.twinRect(game), [cx, cy] = center(r);
      ctx.globalAlpha = game.twin.life < 3 && Math.floor(t * 8) % 2 === 0 ? 0.4 : 0.85; // blinks before it leaves
      shipArt.draw(ctx, "player", cx, cy, r.w * 1.6);
      ctx.globalAlpha = 1;
    }

    function drawEscort(e) {
      const [cx, cy] = center(e);
      sprite("escort", cx, cy, e.w * 1.5, () => { ctx.fillStyle = "#8ff"; ctx.fillRect(e.x + 3, e.y, e.w - 6, e.h); });
    }

    // the Kaboom missile, drawn in code: grey body, red nose, fins, a flame and a smoke trail behind it
    function drawMissile(m, t) {
      const angle = Math.atan2(m.ty - m.sy, m.tx - m.sx) + Math.PI / 2;
      for (let i = 1; i <= 12; i++) { // smoke puffs, older ones bigger and fainter
        const k = Math.max(0, m.t / m.dur - i * 0.04), px = m.sx + (m.tx - m.sx) * k, py = m.sy + (m.ty - m.sy) * k;
        circle(px, py, 2 + i * 0.7, "rgba(200,200,210," + (0.5 - i * 0.04) + ")");
      }
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(angle);
      ctx.fillStyle = "rgba(255,170,60,0.9)"; // flame
      ctx.beginPath(); ctx.moveTo(-3, 9); ctx.lineTo(0, 17 + 5 * Math.sin(t * 60)); ctx.lineTo(3, 9); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#c9ced8"; ctx.fillRect(-3, -8, 6, 17); // body
      ctx.fillStyle = "#e33"; // nose
      ctx.beginPath(); ctx.moveTo(-3, -8); ctx.lineTo(0, -15); ctx.lineTo(3, -8); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#8a93a6"; // fins
      ctx.beginPath(); ctx.moveTo(-3, 4); ctx.lineTo(-7, 11); ctx.lineTo(-3, 9); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(3, 4); ctx.lineTo(7, 11); ctx.lineTo(3, 9); ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    // the nuke: fireball, shockwave ring (0 to the blast radius over its time), rising mushroom cloud and debris
    function drawNuke(nuke) {
      const k = Math.min(1, nuke.t / nuke.dur), fade = 1 - k;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      glow(nuke.x, nuke.y, nuke.radius * (0.35 + 0.45 * k), "255,170,60", 0.9 * fade + 0.1);
      glow(nuke.x, nuke.y, nuke.radius * 0.3 * (1 - k * 0.5), "255,255,220", 0.9 * fade);
      ctx.globalAlpha = Math.max(0, fade);
      circle(nuke.x, nuke.y, nuke.radius * k, null, "#fff", 4 * fade + 1); // shockwave
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - k * 0.7);
      const capY = nuke.y - 20 - 70 * k, capR = 26 + 34 * k; // mushroom cloud: a stem and a cap that rise
      ctx.fillStyle = "rgba(120,80,60,0.85)";
      ctx.fillRect(nuke.x - 8 - 6 * k, capY, 16 + 12 * k, nuke.y - capY + 6);
      circle(nuke.x, capY, capR, "rgba(255,140,50,0.8)");
      circle(nuke.x - capR * 0.5, capY + capR * 0.35, capR * 0.55, "rgba(190,90,40,0.8)");
      circle(nuke.x + capR * 0.5, capY + capR * 0.35, capR * 0.55, "rgba(190,90,40,0.8)");
      for (let i = 0; i < 14; i++) { // debris
        const a = (i / 14) * Math.PI * 2 + i * 0.4, d = nuke.radius * k * (0.5 + ((i * 7) % 5) / 8);
        ctx.fillStyle = i % 2 ? "#fc6" : "#a64";
        ctx.fillRect(nuke.x + Math.cos(a) * d - 2, nuke.y + Math.sin(a) * d + 60 * k * k - 2, 4, 4); // debris falls a little
      }
      ctx.restore();
    }

    // the white flash of the blast (dimmed with reduced motion)
    function drawNukeFlash(nuke) {
      const life = nuke.t / NUKE_FLASH.time;
      if (life >= 1) return;
      ctx.fillStyle = "rgba(255,255,255," + (0.9 * (1 - life) * (reducedMotion ? NUKE_FLASH.dimmed : 1)) + ")";
      ctx.fillRect(0, 0, W, H);
    }

    // between worlds: a red X stamp and WORLD CLEAR on the beaten boss, then the route map to the next world
    function drawWarp(game, t) {
      const w = game.warp, p = root.BB.warpPhase(w.t), worlds = root.BBWorlds;
      if (p.name === "stamp" || p.name === "fly") {
        const k = p.name === "stamp" ? p.k : 1, alpha = p.name === "fly" ? 1 - p.k : Math.min(1, k * 4);
        const size = 70 * (1 + Math.max(0, 1 - k * 3) * 1.5); // slams down from 2.5x
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(w.x, w.y);
        ctx.rotate(-0.12);
        ctx.strokeStyle = "#ff2a3a";
        ctx.lineCap = "round";
        ctx.shadowColor = "#ff2a3a";
        ctx.shadowBlur = 18;
        ctx.lineWidth = size * 0.22;
        ctx.beginPath();
        ctx.moveTo(-size / 2, -size / 2); ctx.lineTo(size / 2, size / 2);
        ctx.moveTo(size / 2, -size / 2); ctx.lineTo(-size / 2, size / 2);
        ctx.stroke();
        ctx.restore();
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = "rgba(0,0,10,0.6)";
        ctx.fillRect(0, 300, W, 64);
        text("WORLD CLEAR", W / 2, 344, 30, "#ffe27a", "center");
        ctx.restore();
        return;
      }
      if (p.name !== "map" && p.name !== "fade") return;
      const n = worlds ? worlds.WORLDS.length : 5, from = ((w.from % n) + n) % n, to = w.to % n;
      const alpha = p.name === "fade" ? 1 - p.k : Math.min(1, p.k * 5);
      const info = (i) => (worlds ? worlds.WORLDS[i] : { name: "World " + (i + 1), tint: { halo: "200,200,255" }, feature: "nebula" });
      const cy = H / 2 - 10, spread = Math.min(1.4, Math.max(1, (H - 260) / 520)); // taller phones get a longer trip
      // the trip climbs the screen: one planet per world, bottom to top
      const planets = [[110, 205, 38], [365, 95, 32], [125, -20, 44], [372, -135, 34], [205, -250, 40]]
        .slice(0, n).map(([x, y, r]) => ({ x, y: cy + y * spread, r }));
      const leg = (i) => { // quadratic curve from planet i to i + 1, bowed toward the middle
        const a = planets[i], b = planets[i + 1];
        return { a, b, c: { x: (a.x + b.x) / 2 + (i % 2 ? 120 : -120), y: (a.y + b.y) / 2 + 40 } };
      };
      const at = (L, k) => ({
        x: (1 - k) * (1 - k) * L.a.x + 2 * (1 - k) * k * L.c.x + k * k * L.b.x,
        y: (1 - k) * (1 - k) * L.a.y + 2 * (1 - k) * k * L.c.y + k * k * L.b.y,
      });
      ctx.save();
      ctx.globalAlpha = alpha;
      // deep space: dark sky, a soft nebula behind the destination, drifting stars
      ctx.fillStyle = "#020310";
      ctx.fillRect(0, 0, W, H);
      const dest = planets[to] || planets[0];
      const neb = ctx.createRadialGradient(dest.x, dest.y, 10, dest.x, dest.y, 300);
      neb.addColorStop(0, "rgba(" + info(to).tint.halo + ",0.28)");
      neb.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = neb;
      ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 110; i++) {
        const sx = frac(i + 1, 337) * W, sy = (frac(i + 1, 733) * H + w.t * (6 + 14 * frac(i, 91))) % H;
        ctx.fillStyle = "rgba(255,255,255," + (0.25 + 0.6 * frac(i, 577)) + ")";
        ctx.fillRect(sx, sy, i % 9 ? 1.5 : 2.5, i % 9 ? 1.5 : 2.5);
      }
      // the route: dotted ahead, glowing where the ship has flown
      for (let i = 0; i < n - 1; i++) {
        const L = leg(i), flown = i < from;
        ctx.save();
        ctx.setLineDash(flown ? [] : [3, 9]);
        ctx.lineCap = "round";
        ctx.strokeStyle = flown ? "rgba(120,230,255,0.75)" : "rgba(200,220,255,0.35)";
        ctx.lineWidth = flown ? 3 : 2;
        if (flown) { ctx.shadowColor = "#3df2ff"; ctx.shadowBlur = 10; }
        ctx.beginPath();
        ctx.moveTo(L.a.x, L.a.y);
        ctx.quadraticCurveTo(L.c.x, L.c.y, L.b.x, L.b.y);
        ctx.stroke();
        ctx.restore();
      }
      planets.forEach((pl, i) => drawPlanet(pl, info(i), i, t, i < to, i === to));
      // the ship flies the leg from the cleared world to the next, leaving an engine trail
      const k = p.name === "fade" ? 1 : Math.min(1, p.k * 1.25), e = k * k * (3 - 2 * k);
      if (to === from + 1) {
        const L = leg(from);
        for (let j = 12; j >= 1; j--) {
          const q = at(L, Math.max(0, e - j * 0.018));
          circle(q.x, q.y, 1 + (12 - j) * 0.35, "rgba(255," + (150 + j * 8) + ",80," + (0.5 - j * 0.035) + ")");
        }
        const m = at(L, e), m2 = at(L, Math.min(1, e + 0.01));
        ctx.save();
        ctx.translate(m.x, m.y);
        ctx.rotate(Math.atan2(m2.y - m.y, m2.x - m.x) + Math.PI / 2);
        ctx.shadowColor = "#3df2ff";
        ctx.shadowBlur = 14;
        shipArt.draw(ctx, "player", 0, 0, 34);
        ctx.restore();
      }
      text("WORLD " + (from + 1) + "  >  WORLD " + (to + 1), W / 2, 70, 15, "rgba(160,215,255,0.85)", "center");
      text("NEXT STOP", W / 2, H - 110, 14, "rgba(255,255,255,0.6)", "center");
      text(info(to).name.toUpperCase(), W / 2, H - 78, 28, "#ffe27a", "center");
      ctx.restore();
    }

    // one planet per world, drawn from its theme: gas giant, ringed ice, burning sun, crystal, black hole
    function drawPlanet(pl, info, i, t, done, next) {
      const { x, y, r } = pl, halo = info.tint.halo;
      ctx.save();
      if (next) { // the destination pulses
        ctx.strokeStyle = "rgba(" + halo + "," + (0.5 + 0.3 * Math.sin(t * 5)) + ")";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, r + 12 + 3 * Math.sin(t * 5), 0, Math.PI * 2); ctx.stroke();
      }
      const glow = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 1.9);
      glow.addColorStop(0, "rgba(" + halo + ",0.35)");
      glow.addColorStop(1, "rgba(" + halo + ",0)");
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(x, y, r * 1.9, 0, Math.PI * 2); ctx.fill();
      const ring = (tilt, color, width) => {
        ctx.save(); ctx.translate(x, y); ctx.rotate(tilt); ctx.scale(1, 0.28);
        ctx.strokeStyle = color; ctx.lineWidth = width;
        ctx.beginPath(); ctx.arc(0, 0, r * 1.6, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      };
      if (info.feature === "blackhole") {
        ring(-0.25, "rgba(255,170,80,0.85)", 5);
        circle(x, y, r * 0.8, "#000", "rgba(255,200,120,0.9)", 2);
      } else {
        if (info.feature === "ice") ring(-0.35, "rgba(200,235,255,0.6)", 4);
        const body = ctx.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.1, x, y, r);
        const lit = { nebula: "#c7a4ff", ice: "#e6f6ff", sun: "#fff1a8", crystals: "#a6ffe3" }[info.feature] || "#ddd";
        const mid = { nebula: "#6b3fd0", ice: "#5aa8e0", sun: "#ff7a1a", crystals: "#1fae8c" }[info.feature] || "#888";
        const dark = { nebula: "#1e0f4a", ice: "#0e2c52", sun: "#a3200a", crystals: "#063a32" }[info.feature] || "#222";
        body.addColorStop(0, lit); body.addColorStop(0.55, mid); body.addColorStop(1, dark);
        ctx.fillStyle = body;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
        if (info.feature === "nebula") { // gas bands
          ctx.fillStyle = "rgba(255,255,255,0.12)";
          for (let b = -2; b <= 2; b++) ctx.fillRect(x - r, y + b * r * 0.38 - 3, r * 2, 6);
        } else if (info.feature === "crystals") { // facets
          ctx.strokeStyle = "rgba(220,255,245,0.35)"; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(x - r, y - r * 0.2); ctx.lineTo(x + r * 0.2, y - r); ctx.moveTo(x - r * 0.3, y + r); ctx.lineTo(x + r, y - r * 0.1);
          ctx.moveTo(x - r * 0.6, y - r * 0.6); ctx.lineTo(x + r * 0.5, y + r * 0.7); ctx.stroke();
        } else if (info.feature === "sun") { // flares
          ctx.fillStyle = "rgba(255,240,180,0.25)";
          for (let s = 0; s < 4; s++) { ctx.beginPath(); ctx.arc(x + Math.cos(s * 1.7 + t) * r * 0.5, y + Math.sin(s * 2.3 + t) * r * 0.5, r * 0.22, 0, Math.PI * 2); ctx.fill(); }
        }
        ctx.restore();
        if (info.feature === "ice") { // front half of the ring over the planet
          ctx.save(); ctx.translate(x, y); ctx.rotate(-0.35); ctx.scale(1, 0.28);
          ctx.strokeStyle = "rgba(220,245,255,0.75)"; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.arc(0, 0, r * 1.6, 0.1, Math.PI - 0.1); ctx.stroke(); ctx.restore();
        }
        if (info.feature === "crystals") circle(x + Math.cos(t * 1.4) * r * 1.5, y + Math.sin(t * 1.4) * r * 0.5, 5, "#c9fff0");
      }
      if (done) { // cleared: a red X stamped on it
        ctx.save(); ctx.translate(x, y); ctx.rotate(-0.12);
        ctx.strokeStyle = "#ff2a3a"; ctx.lineCap = "round"; ctx.lineWidth = r * 0.22;
        ctx.shadowColor = "#ff2a3a"; ctx.shadowBlur = 10;
        const s2 = r * 0.55;
        ctx.beginPath(); ctx.moveTo(-s2, -s2); ctx.lineTo(s2, s2); ctx.moveTo(s2, -s2); ctx.lineTo(-s2, s2); ctx.stroke();
        ctx.restore();
      }
      const right = x < W / 2;
      text(info.name.toUpperCase(), x + (right ? r + 16 : -r - 16), y + 5, 13, next ? "#fff" : done ? "rgba(255,140,140,0.8)" : "rgba(255,255,255,0.5)", right ? "left" : "right");
      ctx.restore();
    }

    // "WORLD 2: FROST BELT" fading in and out
    function drawCard() {
      const age = CARD_TIME - card.life, alpha = Math.max(0, Math.min(1, age / 0.4, card.life / 0.6));
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "rgba(0,0,10,0.55)";
      ctx.fillRect(0, 232, W, 70);
      text(card.text, W / 2, 278, 26, "#fff", "center");
      ctx.restore();
    }

    // explosion bloom: white core, yellow body and orange fringe as three radial gradients
    function drawBlooms() {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const b of blooms) {
        const k = 1 - b.life / b.max, fade = 1 - k, r = b.radius * (0.5 + 0.7 * k);
        glow(b.x, b.y, r, "255,110,30", 0.55 * fade);
        glow(b.x, b.y, r * 0.65, "255,220,90", 0.7 * fade);
        glow(b.x, b.y, r * 0.3, "255,255,255", 0.9 * fade);
      }
      ctx.restore();
    }

    function drawParticles() {
      drawBlooms();
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const p of particles) {
        ctx.globalAlpha = Math.max(0, p.life / p.max);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // ---- HUD ----
    // boss fight: the boss's life on the right half, the player's ship life and shield on the left half
    function drawBossBar(game) {
      const boss = game.drones.find((d) => d.boss && !d.entry && !(d.delay > 0));
      if (!boss) return;
      const y = HUD_H + 8, h = 10, frac = Math.max(0, boss.hp / boss.maxHp);
      const bx = W / 2 + 4, bw = W - 12 - bx;
      ctx.fillStyle = "rgba(4,6,20,0.72)";
      ctx.fillRect(bx - 2, y - 2, bw + 4, h + 4);
      ctx.fillStyle = frac > 0.3 ? "#e44" : "#fa3";
      ctx.fillRect(bx + bw * (1 - frac), y, bw * frac, h); // drains toward the centre
      text(game.drones.some((d) => d.worldBoss) ? "WORLD BOSS" : "BOSS", W - 12, y + h + 13, 11, "#f88", "right");
      // player: one segment per life (9 at most), and a silver shield that lights up when it saves the ship
      const lives = Math.max(0, game.lives), segs = Math.min(9, Math.max(lives, 1)), lx = 30, lw = W / 2 - 4 - lx, gap = 2;
      const sw = (lw - gap * (segs - 1)) / segs;
      ctx.fillStyle = "rgba(4,6,20,0.72)";
      ctx.fillRect(lx - 2, y - 2, lw + 4, h + 4);
      for (let i = 0; i < segs; i++) {
        ctx.fillStyle = i < lives ? N.cyan : "rgba(255,255,255,0.12)";
        ctx.fillRect(lx + i * (sw + gap), y, sw, h);
      }
      if (lives > 9) text("×" + lives, lx + lw, y + h + 13, 11, N.cyan, "right");
      const flash = Math.max(0, Math.min(1, (game.shieldFlash || 0) / 0.5));
      ctx.save();
      if (flash > 0 && !reducedMotion) { ctx.shadowColor = "#fff"; ctx.shadowBlur = 16 * flash; }
      ui.icon("shield", 16, y + h / 2, 13, flash > 0 ? "#ffffff" : game.shield > 0 ? RANK_COLOR.silver : "rgba(200,200,210,0.35)");
      ctx.restore();
      text("YOU", lx, y + h + 13, 11, N.cyan);
    }

    // speaker icon left of the pause button; a cross over it while everything is muted
    function drawSpeaker(muted) {
      const S = root.BBAudio ? root.BBAudio.SPEAKER : { x: 396, y: 16 }, color = muted ? N.red : "#fff";
      ctx.save();
      ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(S.x - 8, S.y - 3); ctx.lineTo(S.x - 4, S.y - 3); ctx.lineTo(S.x + 1, S.y - 8);
      ctx.lineTo(S.x + 1, S.y + 8); ctx.lineTo(S.x - 4, S.y + 3); ctx.lineTo(S.x - 8, S.y + 3);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      if (muted) { ctx.moveTo(S.x + 5, S.y - 5); ctx.lineTo(S.x + 12, S.y + 5); ctx.moveTo(S.x + 12, S.y - 5); ctx.lineTo(S.x + 5, S.y + 5); }
      else { ctx.arc(S.x + 2, S.y, 5, -0.9, 0.9); ctx.moveTo(S.x + 2 + 9 * Math.cos(0.9), S.y + 9 * Math.sin(0.9)); ctx.arc(S.x + 2, S.y, 9, 0.9, -0.9, true); }
      ctx.stroke();
      ctx.restore();
    }

    // tier pips: normal tiers fill pips in the family colour, MASTERED all gold, ULTRA-MAD all red
    function pips(x, y, tier, gap, r, color) {
      const S = root.BBSkills, full = tier >= S.MASTERED;
      const c = tier >= S.ULTRA ? N.red : full ? RANK_COLOR.gold : color;
      for (let i = 0; i < 5; i++) circle(x + i * gap, y, r, full || i < tier ? c : "rgba(255,255,255,0.2)");
    }

    // bottom HUD line: owned skill families as small icons with tier pips
    function drawSkillRow(game, y) {
      const S = root.BBSkills;
      S.owned(game).forEach((f, i) => {
        const x = 62 + i * 33, tier = S.tier(game, f.id);
        const c = tier >= S.ULTRA ? N.red : tier >= S.MASTERED ? RANK_COLOR.gold : N.cyan;
        ui.icon(f.icon, x + 5, y, 10, c);
        pips(x + 13, y, tier, 3.6, 1.4, N.cyan);
      });
    }

    // the skill picker: seven cards, the game keeps running at 15 % behind it
    function drawPicker(game, t) {
      const S = root.BBSkills;
      dim(0.55);
      ui.title("CHOOSE A SKILL", W / 2, 90, 26, N.yellow);
      text(game.picks > 1 ? game.picks + " picks left" : "1 pick", W / 2, 118, 13, N.dim, "center");
      S.FAMILIES.forEach((f, i) => {
        const r = S.cardRect(i), tier = S.tier(game, f.id), maxed = tier >= S.MAX_TIER;
        const locked = !game.picker.offered.includes(f.id), selected = game.picker.cursor === i && !locked;
        ctx.save();
        if (maxed || locked) ctx.globalAlpha = 0.35; // ULTRA-MAD and not-offered families are greyed out
        ui.panel(r.x, r.y, r.w, r.h, { stroke: selected && !maxed ? N.yellow : N.violet });
        ui.icon(f.icon, r.x + 20, r.y + 24, 14, maxed ? "#999" : N.cyan);
        text((i + 1) + "  " + f.name, r.x + 40, r.y + 29, 14, "#fff");
        pips(r.x + 16, r.y + 50, tier, 11, 4, N.cyan);
        const badge = S.tierName(tier);
        if (badge) text(badge, r.x + r.w - 8, r.y + 54, 11, tier >= S.ULTRA ? N.red : RANK_COLOR.gold, "right");
        text(maxed ? "ULTRA-MAD" : "Next: " + S.nextText(f.id, tier), r.x + 12, r.y + 80, 11, maxed ? "#999" : N.dim);
        ctx.restore();
        if (locked) text("LOCKED", r.x + r.w / 2, r.y + r.h / 2 + 5, 16, "#fff", "center");
      });
    }

    // the floating top panel: darker see-through fill, a faint border, no divider lines
    function hudPanel(x, y, w, h, r) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
      ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 12;
      ctx.fillStyle = "rgba(4,6,20,0.72)";
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1; ctx.strokeStyle = "rgba(140,200,255,0.18)";
      ctx.stroke();
      ctx.restore();
    }
    function drawHud(view) {
      const { game } = view, t = view.time || 0;
      const R = root.BB.R(), IN = root.BBInput, P = IN.PAUSE_BUTTON;
      hudPanel(4, 2, W - 8, HUD_H - 4, 12);
      // row 1: lives left, big score in the middle, mute and pause right
      ui.icon("heart", 18, 18, 20, N.red);
      text("×" + Math.max(0, game.lives), 32, 24, 16, "#fff");
      text(String(game.score).padStart(6, "0"), W / 2, 27, 24, "#fff", "center");
      const paused = view.menu && view.menu.screen === "pause";
      ui.button(P.x, P.y, P.w, P.h, "", paused ? "pressed" : "idle");
      ui.icon("pause", P.x + P.w / 2, P.y + P.h / 2 + (paused ? 2 : 0), 16, "#fff");
      drawSpeaker(!!view.muted);
      // row 2: wave, skill families, shield pips and BOOM charges
      const y = 44;
      text("WAVE " + (root.BBEnemies && root.BBEnemies.waveInWorld ? root.BBEnemies.waveInWorld(game.wave) : game.wave), 12, y + 4, 12, "#fff"); // the wave inside its world
      drawSkillRow(game, y);
      ui.icon("shield", 306, y, 12, game.shieldFlash > 0 ? "#ffffff" : RANK_COLOR.silver);
      for (let i = 0; i < R.SHIELD.max; i++) circle(318 + i * 8, y, 2.6, i < game.shield ? RANK_COLOR.silver : "rgba(255,255,255,0.2)");
      ui.icon("boom", 400, y, 12, N.yellow);
      for (let i = 0; i < root.BB.KABOOM.maxCharges; i++) circle(414 + i * 9, y, 3, i < game.kaboomCharges ? N.yellow : "rgba(255,255,255,0.2)");
      if (game.superStar > 0) { // rainbow timer along the bottom edge of the panel
        ctx.fillStyle = rainbow(t);
        ctx.fillRect(14, HUD_H - 6, (W - 28) * Math.min(1, game.superStar / R.SUPER_STAR.duration), 2);
      }
      drawBossBar(game);
    }

    function drawControls(view) {
      const touch = view.touch, game = view.game, BB = root.BB, IN = root.BBInput;
      const B = touch ? touch.buttons() : IN.buttonsFor(!!(view.menu && view.menu.leftHanded));
      const layout = touch && touch.layout ? touch.layout() : null;
      const held = (name) => !!touch && touch.isHeld(name);
      if (layout && layout.zoneH) { // the controls zone under the playfield
        const zoneH = Math.max(layout.zoneH, logicalHeight(layout) - H); // down to the very bottom of the stretched canvas
        const zg = ctx.createLinearGradient(0, H, 0, H + zoneH); // no flat dark block under the buttons
        if (zg && typeof zg.addColorStop === "function") {
          zg.addColorStop(0, "#070b1e"); zg.addColorStop(0.6, "#0b1236"); zg.addColorStop(1, "#14104a");
          ctx.fillStyle = zg;
        } else ctx.fillStyle = "#0b1236";
        ctx.fillRect(0, H, W, zoneH);
        glow(W / 2, H + zoneH / 2, Math.min(W * 0.6, zoneH / 2), "100,70,255", 0.25); // stays inside the filled zone
        ctx.fillStyle = "rgba(77,221,255,0.5)";
        ctx.fillRect(0, H, W, 2);
      }
      if (view.padConnected) return; // a physical controller replaces the touch buttons
      const t = view.time || 0, glowing = !reducedMotion;
      ctx.save();
      ctx.globalAlpha = CONTROLS_ALPHA; // the rings float see-through over the game

      const firing = held("fire") || !!view.firing;
      ctx.globalAlpha = firing ? 0.65 : CONTROLS_ALPHA;
      ui.ringButton(B.fire.x, B.fire.y, B.fire.r, "fire", { state: firing ? "pressed" : "idle", color: "#ff7a5a", ready: glowing, time: t });
      ctx.globalAlpha = CONTROLS_ALPHA;

      const progress = Math.max(0, Math.min(1, 1 - game.specialCooldown / BB.SPECIAL.cooldown));
      const justFired = game.specialCooldown > BB.SPECIAL.cooldown - 0.15;
      ui.ringButton(B.special.x, B.special.y, B.special.r, "spec", {
        state: held("special") || justFired ? "pressed" : "idle", color: N.cyan, cooldown: progress, ready: glowing && progress >= 1, time: t,
      });

      ui.ringButton(B.kaboom.x, B.kaboom.y, B.kaboom.r, "boom", {
        state: game.kaboomCharges <= 0 ? "disabled" : held("kaboom") ? "pressed" : "idle", color: N.yellow,
        segments: { count: game.kaboomCharges, total: BB.KABOOM.maxCharges }, ready: glowing && game.kaboomCharges > 0, time: t,
      });
      if (touch && touch.setOwned) { // LASER and TWIN appear only when owned
        const S = root.BBSkills;
        touch.setOwned({ laser: S.tier(game, "laser") > 0, twin: game.twinCharges > 0 || !!game.twin });
        const X = touch.extraButtons();
        if (X.laser) {
          const p = Math.max(0, Math.min(1, 1 - game.laserCooldown / BB.LASER.cooldown));
          ui.ringButton(X.laser.x, X.laser.y, X.laser.r, "star", {
            state: game.laserBeam ? "pressed" : "idle", color: N.red || "#ff4b6e", cooldown: p, ready: glowing && p >= 1, time: t,
          });
        }
        if (X.twin) {
          ui.ringButton(X.twin.x, X.twin.y, X.twin.r, "weapon", {
            state: game.twin || game.twinCharges <= 0 ? "disabled" : "idle", color: N.cyan,
            segments: { count: game.twinCharges, total: root.BBRewards.TWIN.maxCharges }, ready: glowing && !game.twin && game.twinCharges > 0, time: t,
          });
        }
      }
      if (layout && layout.dpad) ui.dpad(layout.dpad.x, layout.dpad.y, layout.dpad.r, touch.axes(), N.cyan);
      ctx.restore();
      drawStick(touch, !!(layout && layout.dpad));
    }

    // floating stick: dark base ring and a glossy knob
    function drawStick(touch, hidden) {
      if (!touch || hidden) return;
      const st = touch.stick.state;
      if (!st.active) return;
      circle(st.cx, st.cy, root.BBInput.STICK.max, "rgba(20,40,90,0.35)", "rgba(160,200,255,0.5)", 3);
      circle(st.cx, st.cy, root.BBInput.STICK.max * 0.55, null, "rgba(160,200,255,0.2)", 1);
      circle(st.kx, st.ky + 2, 24, "rgba(0,0,20,0.4)");
      circle(st.kx, st.ky, 24, "rgba(77,200,255,0.75)", "#bfeaff", 2);
      circle(st.kx - 6, st.ky - 8, 8, "rgba(255,255,255,0.35)");
    }

    // ---- screens ----
    function dim(alpha) {
      ctx.fillStyle = "rgba(0,0,10," + alpha + ")";
      ctx.fillRect(0, -H, W, H * 3); // covers the whole screen, also under the menus' centring shift
    }

    // 1 when motion is reduced, otherwise a slow breathing scale around 1
    const pulse = (t) => (reducedMotion ? 1 : 1 + PULSE.depth * Math.sin(t * PULSE.speed));
    function pulsed(cx, cy, t, drawFn) {
      const k = pulse(t);
      ctx.save();
      ctx.translate(cx, cy); ctx.scale(k, k); ctx.translate(-cx, -cy);
      drawFn();
      ctx.restore();
    }

    // glossy menu button with a real icon on its left; the highlighted one is gold
    function menuButton(L, i, label, icon, hot) {
      const y = L.y + i * (L.h + L.gap);
      ui.button(L.x, y, L.w, L.h, label, hot ? "hot" : "idle");
      ui.icon(icon, L.x + 22, y + L.h / 2, 20, hot ? "#1a1000" : "#fff");
    }

    function drawPause(menu) {
      dim(0.65);
      ui.title("PAUSED", W / 2, 230, 36);
      const L = root.BBInput.MENU_LAYOUT, icons = ["play", "weapon", "escort", "boom", "star"];
      menu.items().forEach((label, i) => menuButton(L, i, label, icons[i], i === menu.cursor));
    }

    function drawTitle(view) {
      const menu = view.menu, t = view.time || 0, L = root.BBInput.TITLE_LAYOUT;
      dim(0.45);
      pulsed(W / 2, 150, t, () => {
        ui.title("BOREDOM", W / 2, 150, 54);
        ui.title("BLASTER", W / 2, 215, 54, N.yellow);
      });
      shipArt.draw(ctx, "player", W / 2, 268, 60);
      const icons = ["play", "star", "weapon"];
      menu.titleItems().forEach((label, i) => menuButton(L, i, label, icons[i], i === menu.cursor));
      text("BEST " + (view.best || 0), W / 2, 500, 16, N.yellow, "center");
      const playedLine = globalThis.BBPlayStats ? BBPlayStats.line(view.played) : "";
      if (playedLine) text(playedLine, W / 2, 522, 11, "rgba(255,255,255,0.6)", "center");
    }

    // top-10 table: rank, initials, score, wave; the freshly added row blinks until view.highlight.until
    function drawTable(view, top, rowH, size) {
      const list = view.scores || [], hl = view.highlight, t = view.time || 0;
      list.forEach((s, i) => {
        const y = top + i * rowH, isNew = !!hl && hl.index === i && t < hl.until;
        if (isNew && !reducedMotion && Math.floor(t * BLINK_HZ * 2) % 2) return; // blink off phase
        const color = isNew ? N.cyan : i === 0 ? N.yellow : "#fff";
        text(String(i + 1) + ".", 90, y, size, N.dim);
        text(s.initials || "AAA", 140, y, size, color);
        text(String(s.score).padStart(6, "0"), 230, y, size, color);
        text("W" + s.wave, 390, y, size - 3, N.dim, "right");
      });
    }

    // GLOBAL and THIS DEVICE tabs; view.tab is "global" or "device", view.net is { status, list }
    function drawScores(view) {
      const net = view.net || { status: "offline", list: [] };
      const global = view.tab === "global", shown = global && net.status === "ok";
      dim(0.82);
      ui.panel(40, 90, W - 80, 440, { stroke: N.yellow });
      ui.title("HIGH SCORES", W / 2, 140, 28, N.yellow);
      for (const name of ["global", "device"]) {
        const b = SCORE_TABS[name], on = name === (global ? "global" : "device");
        panel(b.x, b.y, b.w, b.h, on ? "#16306a" : "#0a1030", on ? N.yellow : "#456");
        text(b.label, b.x + b.w / 2, b.y + 19, 14, on ? N.yellow : N.dim, "center");
      }
      const list = shown ? net.list : view.scores || [];
      const note = !global ? "" : net.status === "loading" ? "Loading..." : net.status === "offline" ? "OFFLINE - showing this device"
        : net.status === "error" ? "Can't reach the server - showing this device" : "";
      if (note) text(note, W / 2, 245, 13, "#f90", "center");
      else if (!list.length) text("No scores yet. Go blast something!", W / 2, 300, 15, N.dim, "center");
      drawTable({ ...view, scores: global && net.status === "loading" ? [] : list, highlight: shown ? null : view.highlight }, 270, 25, 19);
      text("Left/Right or tap a tab. Enter, P or tap to go back", W / 2, 515, 12, N.yellow, "center");
    }

    // new record: three letter slots with up/down boxes and an OK button
    function drawInitials(view) {
      const L = root.BBInput.INITIALS_LAYOUT, picker = view.picker;
      dim(0.82);
      ui.panel(40, 90, W - 80, 440, { stroke: N.cyan });
      ui.title("NEW RECORD!", W / 2, 150, 32, N.yellow);
      text("SCORE " + (view.results ? view.results.score : view.game.score), W / 2, 185, 18, "#fff", "center");
      for (let i = 0; i < 3; i++) {
        const x = L.slotX[i], hot = !!picker && picker.slot === i;
        text("▲", x, L.upY + 8, 24, hot ? N.yellow : N.dim, "center");
        text(picker ? picker.value()[i] : "A", x, L.letterY, 44, hot ? N.yellow : "#fff", "center");
        text("▼", x, L.downY + 8, 24, hot ? N.yellow : N.dim, "center");
      }
      ui.button(L.ok.x, L.ok.y, L.ok.w, L.ok.h, "OK", "hot");
      text("Arrows: letters and slots, Enter: OK", W / 2, 490, 13, N.dim, "center");
    }

    // settings gear in the corner of the title and pause screens
    function drawGear(menu) {
      const G = root.BBInput.GEAR;
      ui.iconButton(G.x, G.y, G.r, "gear", { state: menu.screen === "settings" ? "pressed" : "idle" });
    }

    // SETTINGS: every action with its key (click or Enter, then press the new key), the switches, Reset, Back
    function drawSettings(menu) {
      const L = menu.settingsLayout();
      const size = L.h > 40 ? 20 : 14;
      dim(0.85);
      ui.title(menu.sectionTitle(), W / 2, 90, menu.section ? 22 : 28);
      menu.settingsRows().forEach((row, i) => {
        const y = L.y + i * (L.h + L.gap), hot = i === menu.cursor;
        const base = y + L.h / 2 + size / 3;
        if (row.type === "info") { // read-only list: plain text, no button
          text(row.label, L.x + 14, base, size, N.cyan);
          if (row.value) text(row.value, L.x + L.w - 14, base, size, "#fff", "right");
          return;
        }
        ui.button(L.x, y, L.w, L.h, "", hot ? "hot" : "idle");
        const ink = hot ? "#1a1000" : "#fff";
        text(row.label, L.x + 14, base, size, ink);
        if (row.value) text(row.value, L.x + L.w - 14, base, size, menu.capturing && hot ? N.red : ink, "right");
      });
      text("Arrows and Esc always work. Esc or P: back", W / 2, 626, 12, N.yellow, "center");
    }

    function drawHowTo(menu) {
      dim(0.82);
      ui.panel(40, 90, W - 80, 440, { stroke: N.cyan });
      ui.title("HOW TO PLAY", W / 2, 140, 28);
      (menu && menu.keys ? howToRows(menu.keys) : HOW_TO_ROWS).forEach((row, i) => {
        const y = 195 + i * 36;
        ui.icon(row.icon, 76, y - 5, 24, N.cyan);
        text(row.text, 98, y, 13, "#fff");
      });
      text("Press Enter, P or tap to continue", W / 2, 500, 14, N.yellow, "center");
    }

    // results replace the old game over: score, wave, stars and the goals checklist
    function drawResults(view) {
      const game = view.game, t = view.time || 0;
      const res = view.results || { score: game.score, wave: game.wave, stars: 0, goals: [] };
      dim(0.7);
      ui.panel(50, 20, W - 100, 600, { stroke: N.red });
      ui.title("RESULTS", W / 2, 70, 32, N.red);
      ui.stars(W / 2, 100, res.stars, 3, 13);
      text("SCORE " + res.score, W / 2, 145, 22, "#fff", "center");
      if (res.line) text(res.line, W / 2, 168, 16, N.cyan, "center"); // "12,400 / 15,000 — 83 %"
      text("WAVE " + res.wave + "   BEST " + (view.best || 0), W / 2, 188, 13, N.yellow, "center");
      res.goals.forEach((g, i) => {
        const y = 205 + i * 24;
        ui.icon(GOAL_ICON[g.id] || "star", 100, y - 5, 18, g.done ? "#ffd23c" : "rgba(255,255,255,0.3)");
        text(g.label, 124, y, 14, g.done ? "#fff" : "#789");
        text(g.done ? "DONE" : "-", 380, y, 13, g.done ? N.green : "#789", "right");
      });
      text("TOP 10", W / 2, 305, 13, N.dim, "center");
      drawTable(view, 335, 21, 16);
      pulsed(W / 2, 580, t, () => text("Press Enter to replay", W / 2, 580, 18, N.cyan, "center"));
    }

    // view: { game, menu, best, touch, touchSeen, time, scores, results }
    // game units tall the canvas box really is: on a phone it is stretched taller than H + zoneH (rect.height * W / rect.width)
    function logicalHeight(layout) {
      const rect = ctx.canvas && typeof ctx.canvas.getBoundingClientRect === "function" ? ctx.canvas.getBoundingClientRect() : null;
      const boxH = rect && rect.width > 0 ? (rect.height * W) / rect.width : 0;
      return Math.max(boxH, H + (layout && layout.zoneH ? layout.zoneH : 0));
    }

    function draw(view) {
      const game = view.game, t = view.time || 0;
      const touchLayout = view.touch && view.touch.layout ? view.touch.layout() : null;
      ctx.clearRect(0, 0, W, logicalHeight(touchLayout)); // the whole canvas first, so no glow ever stacks between frames
      ctx.save();
      if (shake.time > 0) { // wobble that fades out
        const k = shake.time / shake.max;
        ctx.translate(Math.sin(shake.time * 90) * shake.mag * k, Math.cos(shake.time * 70) * shake.mag * k);
      }
      drawBackground();
      for (const d of game.drones) drawEnemy(d);
      for (const c of game.capsules) drawCapsule(c, t);
      for (const e of game.escorts) drawEscort(e);
      for (const b of game.bullets) drawBullet(b);
      for (const b of game.enemyBullets) glowRect(b, "enemyBullet", N.red);
      for (const d of game.debris || []) drawDebris(d);
      drawLaser(game, t);
      drawShip(game, t);
      drawTwin(game, t);
      drawMoons(game, t);
      for (const m of game.missiles || []) drawMissile(m, t);
      drawShockwaves();
      if (game.nuke) drawNuke(game.nuke);
      drawParticles();
      for (const p of game.pops || []) { // ULTRA-MAD Score per hit: red floating points
        ctx.globalAlpha = Math.max(0, p.life / p.max);
        text(p.text, p.x, p.y, 14, "#ff3b2f", "center");
      }
      ctx.globalAlpha = 1;
      if (flash.time > 0) {
        ctx.fillStyle = "rgba(255,60,60," + (0.4 * flash.time / FLASH_TIME) + ")";
        ctx.fillRect(0, 0, W, H);
      }
      if (game.nuke) drawNukeFlash(game.nuke);
      ctx.restore();
      drawHud(view);
      drawControls(view);
      if (game.warp) drawWarp(game, t);
      if (card && game.status === "playing" && !game.warp) drawCard();
      if (game.picker && game.status === "playing") drawPicker(game, t);
      const screen = view.menu && view.menu.screen;
      ctx.save();
      if (root.BBInput.MENU_DY) ctx.translate(0, root.BBInput.MENU_DY); // menu screens are laid out 640 tall, centred on a tall screen
      if (screen === "initials") drawInitials(view);
      else if (game.status === "over" || screen === "results") drawResults(view);
      else if (screen === "title") { drawTitle(view); drawGear(view.menu); }
      else if (screen === "scores") drawScores(view);
      else if (screen === "pause") { drawPause(view.menu); drawGear(view.menu); }
      else if (screen === "settings") drawSettings(view.menu);
      else if (screen === "howto") drawHowTo(view.menu);
      ctx.restore();
    }

    return {
      update, draw, explode, particles, pulse,
      fullEffects: () => fx.full, bloomCount: () => blooms.length,
      setReducedMotion(on) { reducedMotion = !!on; if (reducedMotion) shake.time = 0; },
      isReducedMotion: () => reducedMotion,
    };
  }

  // which tab (if any) a click at x, y on the high-scores screen hits: "global" | "device" | null
  function scoreTabHit(x, y) {
    for (const name of ["global", "device"]) {
      const b = SCORE_TABS[name];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return name;
    }
    return null;
  }

  root.BBRender = { createRenderer, HOW_TO, HOW_TO_ROWS, howToRows, SCORE_TABS, scoreTabHit };
})(globalThis);
