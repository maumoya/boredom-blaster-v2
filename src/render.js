// Boredom Blaster drawing: sprites with plain-shape fallbacks, glow bullets, particle explosions,
// parallax stars and meteors, shield ring, hit flash, boss HP bar, framed HUD and the menu screens.
// Plain script; main.js calls BBRender.createRenderer(ctx, assets). Tests drive it with a stub canvas.
(function (root) {
  const UI = root.BBUI, N = UI.NEON; // shared neon palette and type
  const W = 480, H = 640;
  const HUD_H = 64; // two-row top bar
  const CONTROLS_ALPHA = 0.7; // the floating buttons are see-through
  const NEBULA = [ // drifting colour clouds: x, y, radius, colour, drift speed
    { x: 0.2, y: 0.25, r: 190, c: "90,60,200", v: 6 }, { x: 0.8, y: 0.55, r: 220, c: "30,120,200", v: 4 },
    { x: 0.5, y: 0.9, r: 200, c: "190,50,140", v: 5 },
  ];
  const SHOCK = { life: 0.45, radius: 46, bigRadius: 110 };
  const RANK_COLOR = { bronze: "#c8843c", silver: "#cfd6e0", gold: "#ffd23c" };
  const RANK_SPRITE = { bronze: "capsuleBronze", silver: "capsuleSilver", gold: "capsuleGold", rainbow: "capsuleRainbow" };
  const SPECIES_COLOR = {
    drone: "#f5a", wasp: "#5df", viper: "#f66", diver: "#6e6", splitter: "#c8f",
    splitling: "#e88", orbiter: "#7af", dasher: "#f84",
  };
  const SPRITE_SCALE = 1.35; // sprites are drawn a bit larger than their hitbox
  const FLASH_TIME = 0.35;
  const BLINK_HZ = 3; // blinks per second for a new high-score row
  // the two tabs on the high-scores screen, in canvas pixels
  const SCORE_TABS = {
    global: { x: 70, y: 160, w: 160, h: 28, label: "GLOBAL" },
    device: { x: 250, y: 160, w: 160, h: 28, label: "THIS DEVICE" },
  };
  const MAX_PARTICLES = 400;
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
    ];
  }
  const HOW_TO_ROWS = howToRows(root.BBKeys.createKeys(null));
  const HOW_TO = HOW_TO_ROWS.map((r) => r.text);
  const SHAKE = { time: 0.25, mag: 6 }; // screen shake after a lost life
  const PULSE = { depth: 0.06, speed: 4 }; // gentle breathing of the title and the replay prompt
  const GOAL_ICON = { miniboss: "escort", kaboom: "boom", weapon: "weapon" };

  // opts.reducedMotion: no pulses, no background drift, no screen shake
  function createRenderer(ctx, assets, opts) {
    let reducedMotion = !!(opts && opts.reducedMotion);
    const shake = { time: 0 };
    const particles = [];
    const rings = []; // explosion shockwaves
    const ui = root.BBUI.createUI(ctx);
    const flash = { time: 0 };
    let prev = { drones: [], lives: null, wave: null };
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

    // ---- effects state ----
    function explode(x, y, big) {
      const n = big ? 64 : 22;
      rings.push({ x, y, life: SHOCK.life, max: SHOCK.life, radius: big ? SHOCK.bigRadius : SHOCK.radius });
      for (let i = 0; i < n && particles.length < MAX_PARTICLES; i++) {
        const a = (i / n) * Math.PI * 2 + i * 0.7, v = (big ? 220 : 140) * (0.4 + ((i * 37) % 10) / 10);
        const life = 0.5 + ((i * 13) % 5) * 0.08;
        particles.push({
          x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life,
          color: i % 3 === 0 ? "#fff" : i % 3 === 1 ? N.yellow : "#f74", size: (big ? 6 : 4) + (i % 3),
        });
      }
    }

    // Reads the game each frame: vanished enemies explode, a lost life flashes the screen.
    function update(dt, game) {
      if (!reducedMotion) scroll += dt; // drift
      const alive = new Set(game.drones);
      for (const d of prev.drones) {
        if (!alive.has(d)) explode(d.x + d.w / 2, d.y + d.h / 2, !!d.boss);
      }
      if (prev.lives !== null && game.lives < prev.lives) {
        flash.time = FLASH_TIME;
        if (!reducedMotion) shake.time = SHAKE.time;
      }
      prev = { drones: game.drones.slice(), lives: game.lives, wave: game.wave };
      flash.time = Math.max(0, flash.time - dt);
      shake.time = Math.max(0, shake.time - dt);
      for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
      for (let i = particles.length - 1; i >= 0; i--) if (particles[i].life <= 0) particles.splice(i, 1);
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
        const g = ctx.createRadialGradient(x, y, 0, x, y, n.r);
        if (g && typeof g.addColorStop === "function") {
          g.addColorStop(0, "rgba(" + n.c + ",0.42)");
          g.addColorStop(1, "rgba(" + n.c + ",0)");
          ctx.fillStyle = g;
          ctx.fillRect(x - n.r, y - n.r, n.r * 2, n.r * 2);
        } else circle(x, y, n.r * 0.7, "rgba(" + n.c + ",0.18)");
      });
      ctx.restore();
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
      const layers = ultra ? [[8, 28, "rgba(255,40,20,0.85)"], [4, 16, "rgba(255,150,60,0.95)"]]
        : [[7, 22, "rgba(255,120,30,0.8)"], [4, 14, "rgba(255,230,120,0.95)"]];
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
    function drawBackground() {
      ctx.fillStyle = "#050514";
      ctx.fillRect(0, 0, W, H);
      drawNebula();
      stars.forEach((layer, li) => {
        const L = STAR_LAYERS[li];
        for (const s of layer) {
          const y = (s.y + scroll * L.speed) % H;
          if (L.sprite) sprite(L.sprite, s.x, y, L.size, () => { ctx.fillStyle = "#fff"; ctx.fillRect(s.x, y, 3, 3); });
          else { ctx.fillStyle = li ? "#cde" : "#789"; ctx.fillRect(s.x, y, L.size, L.size); }
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
      const color = SPECIES_COLOR[e.species] || SPECIES_COLOR.drone;
      sprite(e.species || "drone", cx, cy, w, () => {
        ctx.fillStyle = color;
        ctx.fillRect(e.x + 2, e.y + 2, e.w - 4, e.h - 4);
      });
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
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      sprite(name, b.x + b.w / 2, b.y + b.h / 2, b.w * 2.2, () => {
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
      const shipFallback = () => {
        ctx.fillStyle = N.cyan;
        ctx.beginPath();
        ctx.moveTo(cx, s.y); ctx.lineTo(s.x + s.w, s.y + s.h); ctx.lineTo(cx, s.y + s.h - 6); ctx.lineTo(s.x, s.y + s.h);
        ctx.closePath(); ctx.fill();
      };
      sprite("ship", cx, cy, s.w * 1.6, shipFallback);
      const dmg = Math.min(3, 3 - game.lives);
      if (dmg > 0) sprite("shipDamage" + dmg, cx, cy, s.w * 1.6, null);
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
      sprite("ship", cx, cy, r.w * 1.6, () => {
        ctx.fillStyle = "#8ff";
        ctx.beginPath();
        ctx.moveTo(cx, r.y); ctx.lineTo(r.x + r.w, r.y + r.h); ctx.lineTo(cx, r.y + r.h - 6); ctx.lineTo(r.x, r.y + r.h);
        ctx.closePath(); ctx.fill();
      });
      ctx.globalAlpha = 1;
    }

    function drawEscort(e) {
      const [cx, cy] = center(e);
      sprite("escort", cx, cy, e.w * 1.5, () => { ctx.fillStyle = "#8ff"; ctx.fillRect(e.x + 3, e.y, e.w - 6, e.h); });
    }

    function drawParticles() {
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
    // an icon followed by a row of pips, filled up to `filled`
    function iconBar(icon, x, y, max, filled, color) {
      ui.icon(icon, x + 7, y, 16, color);
      for (let i = 0; i < max; i++) circle(x + 22 + i * 10, y, 4, i < filled ? color : "rgba(255,255,255,0.2)");
    }

    function drawBossBar(game) {
      const boss = game.drones.find((d) => d.boss && !d.entry && !(d.delay > 0));
      if (!boss) return;
      const x = 60, y = HUD_H + 8, w = W - 120, h = 10, frac = Math.max(0, boss.hp / boss.maxHp);
      panel(x - 2, y - 2, w + 4, h + 4, "rgba(0,0,0,0.6)", "#f66");
      ctx.fillStyle = frac > 0.3 ? "#e44" : "#fa3";
      ctx.fillRect(x, y, w * frac, h);
      text("BOSS", 12, y + 9, 11, "#f88");
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

    // HUD second row: owned skill families as small icons with tier pips
    function drawSkillRow(game) {
      const S = root.BBSkills;
      S.owned(game).forEach((f, i) => {
        const x = 112 + i * 35, tier = S.tier(game, f.id);
        const c = tier >= S.ULTRA ? N.red : tier >= S.MASTERED ? RANK_COLOR.gold : N.cyan;
        ui.icon(f.icon, x + 12, 42, 11, c);
        pips(x + 2, 55, tier, 5, 1.6, N.cyan);
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
        const selected = game.picker.cursor === i;
        ctx.save();
        if (maxed) ctx.globalAlpha = 0.35; // ULTRA-MAD families are greyed out
        ui.panel(r.x, r.y, r.w, r.h, { stroke: selected && !maxed ? N.yellow : N.violet });
        ui.icon(f.icon, r.x + 20, r.y + 24, 14, maxed ? "#999" : N.cyan);
        text((i + 1) + "  " + f.name, r.x + 40, r.y + 29, 14, "#fff");
        pips(r.x + 16, r.y + 50, tier, 11, 4, N.cyan);
        const badge = S.tierName(tier);
        if (badge) text(badge, r.x + r.w - 8, r.y + 54, 11, tier >= S.ULTRA ? N.red : RANK_COLOR.gold, "right");
        text(maxed ? "ULTRA-MAD" : "Next: " + S.nextText(f.id, tier), r.x + 12, r.y + 80, 11, maxed ? "#999" : N.dim);
        ctx.restore();
      });
    }

    function drawHud(view) {
      const { game } = view, t = view.time || 0;
      const R = root.BB.R(), IN = root.BBInput, P = IN.PAUSE_BUTTON;
      ui.panel(0, 0, W, HUD_H, { radius: 0, stroke: N.violet });
      // row 1: lives, wave, best, pause
      ui.icon("heart", 18, 15, 20, N.red);
      text("×" + Math.max(0, game.lives), 32, 21, 16, "#fff");
      text("WAVE " + game.wave, 130, 21, 15, "#fff", "center");
      text("BEST " + (view.best || 0), 260, 21, 13, N.yellow, "center");
      const paused = view.menu && view.menu.screen === "pause";
      ui.button(P.x, P.y, P.w, P.h, "", paused ? "pressed" : "idle");
      ui.icon("pause", P.x + P.w / 2, P.y + P.h / 2 + (paused ? 2 : 0), 16, "#fff");
      drawSpeaker(!!view.muted);
      // row 2: score counter and the weapon / shield / escort bars
      text("SCORE", 10, 43, 9, N.dim);
      text(String(game.score).padStart(6, "0"), 10, 58, 18, "#fff");
      drawSkillRow(game);
      iconBar("shield", 362, 48, R.SHIELD.max, game.shield, RANK_COLOR.silver);
      if (game.superStar > 0) { // rainbow timer along the bottom edge of the bar
        ctx.fillStyle = rainbow(t);
        ctx.fillRect(6, HUD_H - 6, (W - 12) * Math.min(1, game.superStar / R.SUPER_STAR.duration), 3);
      }
      drawBossBar(game);
    }

    function drawControls(view) {
      const touch = view.touch, game = view.game, BB = root.BB, IN = root.BBInput;
      const B = touch ? touch.buttons() : IN.buttonsFor(!!(view.menu && view.menu.leftHanded));
      const layout = touch && touch.layout ? touch.layout() : null;
      const held = (name) => !!touch && touch.isHeld(name);
      if (layout && layout.zoneH) { // the controls zone under the playfield
        ctx.fillStyle = "#070b1e";
        ctx.fillRect(0, H, W, layout.zoneH);
        ctx.fillStyle = "rgba(77,221,255,0.5)";
        ctx.fillRect(0, H, W, 2);
      }
      if (view.padConnected) return; // a physical controller replaces the touch buttons
      const t = view.time || 0, glowing = !reducedMotion;
      ctx.save();
      ctx.globalAlpha = layout && layout.zoneH ? 1 : CONTROLS_ALPHA; // in the overlay the rings float see-through

      const firing = held("fire") || !!view.firing;
      ui.ringButton(B.fire.x, B.fire.y, B.fire.r, "fire", { state: firing ? "pressed" : "idle", color: "#ff7a5a", ready: glowing, time: t });

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
      ctx.fillRect(0, 0, W, H);
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
      const L = root.BBInput.MENU_LAYOUT, icons = ["play", "weapon", "escort", "boom"];
      menu.items().forEach((label, i) => menuButton(L, i, label, icons[i], i === menu.cursor));
    }

    function drawTitle(view) {
      const menu = view.menu, t = view.time || 0, L = root.BBInput.TITLE_LAYOUT;
      dim(0.45);
      pulsed(W / 2, 150, t, () => {
        ui.title("BOREDOM", W / 2, 150, 54);
        ui.title("BLASTER", W / 2, 215, 54, N.yellow);
      });
      sprite("ship", W / 2, 268, 60, null);
      const icons = ["play", "star", "weapon"];
      menu.titleItems().forEach((label, i) => menuButton(L, i, label, icons[i], i === menu.cursor));
      text("BEST " + (view.best || 0), W / 2, 500, 16, N.yellow, "center");
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
      const L = root.BBInput.SETTINGS_LAYOUT;
      dim(0.85);
      ui.title("SETTINGS", W / 2, 90, 28);
      menu.settingsRows().forEach((row, i) => {
        const y = L.y + i * (L.h + L.gap), hot = i === menu.cursor;
        ui.button(L.x, y, L.w, L.h, "", hot ? "hot" : "idle");
        const ink = hot ? "#1a1000" : "#fff";
        const base = y + L.h / 2 + 5;
        text(row.label, L.x + 14, base, 14, ink);
        if (row.value) text(row.value, L.x + L.w - 14, base, 14, menu.capturing && hot ? N.red : ink, "right");
      });
      text("Arrows and Esc always work. Esc or P: back", W / 2, 626, 12, N.yellow, "center");
    }

    function drawHowTo(menu) {
      dim(0.82);
      ui.panel(40, 90, W - 80, 440, { stroke: N.cyan });
      ui.title("HOW TO PLAY", W / 2, 140, 28);
      (menu && menu.keys ? howToRows(menu.keys) : HOW_TO_ROWS).forEach((row, i) => {
        const y = 195 + i * 40;
        ui.icon(row.icon, 76, y - 5, 24, N.cyan);
        text(row.text, 98, y, 14, "#fff");
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
      text("WAVE " + res.wave + "   BEST " + (view.best || 0), W / 2, 170, 14, N.yellow, "center");
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
    function draw(view) {
      const game = view.game, t = view.time || 0;
      ctx.save();
      if (shake.time > 0) { // wobble that fades out
        const k = shake.time / SHAKE.time;
        ctx.translate(Math.sin(shake.time * 90) * SHAKE.mag * k, Math.cos(shake.time * 70) * SHAKE.mag * k);
      }
      drawBackground();
      for (const d of game.drones) drawEnemy(d);
      for (const c of game.capsules) drawCapsule(c, t);
      for (const e of game.escorts) drawEscort(e);
      for (const b of game.bullets) drawBullet(b);
      for (const b of game.enemyBullets) glowRect(b, "enemyBullet", N.red);
      drawLaser(game, t);
      drawShip(game, t);
      drawTwin(game, t);
      drawMoons(game, t);
      drawShockwaves();
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
      ctx.restore();
      drawHud(view);
      drawControls(view);
      if (game.picker && game.status === "playing") drawPicker(game, t);
      const screen = view.menu && view.menu.screen;
      if (screen === "initials") drawInitials(view);
      else if (game.status === "over" || screen === "results") drawResults(view);
      else if (screen === "title") { drawTitle(view); drawGear(view.menu); }
      else if (screen === "scores") drawScores(view);
      else if (screen === "pause") { drawPause(view.menu); drawGear(view.menu); }
      else if (screen === "settings") drawSettings(view.menu);
      else if (screen === "howto") drawHowTo(view.menu);
    }

    return {
      update, draw, explode, particles, pulse,
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
