// Boredom Blaster drawing: sprites with plain-shape fallbacks, glow bullets, particle explosions,
// parallax stars and meteors, shield ring, hit flash, boss HP bar, framed HUD and the menu screens.
// Plain script; main.js calls BBRender.createRenderer(ctx, assets). Tests drive it with a stub canvas.
(function (root) {
  const W = 480, H = 640;
  const HUD_H = 64; // two-row top bar
  const TRAY_Y = H - 120; // the controls tray starts here
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
  const HOW_TO_ROWS = [
    { icon: "heart", text: "Steer: drag left half / arrows / WASD" },
    { icon: "fire", text: "Fire: hold Space or the FIRE button" },
    { icon: "spec", text: "Special (X): piercing shot" },
    { icon: "boom", text: "Kaboom (B): blasts nearby enemies" },
    { icon: "weapon", text: "Capsules: weapon level up" },
    { icon: "shield", text: "Silver: shield, gold: escort" },
    { icon: "pause", text: "Pause: P or Esc" },
  ];
  const HOW_TO = HOW_TO_ROWS.map((r) => r.text);
  const SHAKE = { time: 0.3, mag: 6 }; // screen shake after a lost life
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
      ctx.font = "bold " + size + "px monospace";
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
    const rankColor = (rank, t) => (rank === "rainbow" ? rainbow(t) : RANK_COLOR[rank] || "#fff");
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
          color: i % 3 === 0 ? "#fff" : i % 3 === 1 ? "#fd4" : "#f74", size: (big ? 6 : 4) + (i % 3),
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
    function drawEngineFlame(cx, baseY, t) {
      const f = 0.8 + 0.2 * Math.sin(t * 40) + 0.1 * Math.sin(t * 23);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const [w, len, color] of [[7, 22, "rgba(255,120,30,0.8)"], [4, 14, "rgba(255,230,120,0.95)"]]) {
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
      drawEngineFlame(cx, s.y + s.h - 2, t);
      sprite("flame", cx, s.y + s.h + 6, 9 * flicker, null);
      const shipFallback = () => {
        ctx.fillStyle = "#4df";
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

    function drawHud(view) {
      const { game } = view, t = view.time || 0;
      const R = root.BB.R(), IN = root.BBInput, P = IN.PAUSE_BUTTON;
      ui.panel(0, 0, W, HUD_H, { radius: 0, stroke: "#2a4a7a" });
      // row 1: lives, wave, best, pause
      ui.icon("heart", 18, 15, 20, "#f45");
      text("×" + Math.max(0, game.lives), 32, 21, 16, "#fff");
      text("WAVE " + game.wave, 130, 21, 15, "#fff", "center");
      text("BEST " + (view.best || 0), 260, 21, 13, "#fd4", "center");
      const paused = view.menu && view.menu.screen === "pause";
      ui.button(P.x, P.y, P.w, P.h, "", paused ? "pressed" : "idle");
      ui.icon("pause", P.x + P.w / 2, P.y + P.h / 2 + (paused ? 2 : 0), 16, "#fff");
      // row 2: score counter and the weapon / shield / escort bars
      text("SCORE", 10, 43, 9, "#9ab");
      text(String(game.score).padStart(6, "0"), 10, 58, 18, "#fff");
      iconBar("weapon", 150, 48, R.WEAPON.maxLevel, game.weaponLevel, RANK_COLOR.bronze);
      iconBar("shield", 252, 48, R.SHIELD.hits, game.shield, RANK_COLOR.silver);
      iconBar("escort", 340, 48, R.ESCORT.max, game.escorts.length, RANK_COLOR.gold);
      if (game.superStar > 0) { // rainbow timer along the bottom edge of the bar
        ctx.fillStyle = rainbow(t);
        ctx.fillRect(6, HUD_H - 6, (W - 12) * Math.min(1, game.superStar / R.SUPER_STAR.duration), 3);
      }
      drawBossBar(game);
    }

    function drawControls(view) {
      const touch = view.touch, game = view.game, BB = root.BB, IN = root.BBInput;
      const B = touch ? touch.buttons() : IN.buttonsFor(!!(view.menu && view.menu.leftHanded));
      const held = (name) => !!touch && touch.isHeld(name);
      ui.panel(0, TRAY_Y, W, H - TRAY_Y, { radius: 0, stroke: "#2a4a7a" });

      const firing = held("fire") || !!view.firing;
      ui.iconButton(B.fire.x, B.fire.y, B.fire.r, "fire", { state: firing ? "pressed" : "idle", color: "#ff7a5a", label: "FIRE" });

      const ready = 1 - game.specialCooldown / BB.SPECIAL.cooldown;
      const justFired = game.specialCooldown > BB.SPECIAL.cooldown - 0.15;
      const specState = held("special") || justFired ? "pressed" : "idle";
      ui.iconButton(B.special.x, B.special.y, B.special.r, "spec", { state: specState, color: "#4df", label: "SPEC" });
      ctx.beginPath(); // cooldown ring, full and bright when ready
      ctx.arc(B.special.x, B.special.y, B.special.r + 5, -Math.PI / 2, -Math.PI / 2 + Math.max(0, Math.min(1, ready)) * Math.PI * 2);
      ctx.strokeStyle = ready >= 1 ? "#4df" : "rgba(255,255,255,0.7)";
      ctx.lineWidth = 4;
      ctx.stroke();

      const empty = game.kaboomCharges <= 0;
      ui.iconButton(B.kaboom.x, B.kaboom.y, B.kaboom.r, "boom", {
        state: empty ? "disabled" : held("kaboom") ? "pressed" : "idle", color: "#fd4", label: "BOOM",
      });
      for (let i = 0; i < BB.KABOOM.maxCharges; i++) {
        circle(B.kaboom.x - 12 + i * 12, B.kaboom.y + B.kaboom.r + 9, 4, i < game.kaboomCharges ? "#fd4" : "rgba(255,255,255,0.2)");
      }
      drawStick(touch);
    }

    // floating stick: dark base ring and a glossy knob
    function drawStick(touch) {
      if (!touch) return;
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
        ui.title("BLASTER", W / 2, 215, 54, "#fd4");
      });
      sprite("ship", W / 2, 268, 60, null);
      const icons = ["play", "star", "weapon"];
      menu.titleItems().forEach((label, i) => menuButton(L, i, label, icons[i], i === menu.cursor));
      text("BEST " + (view.best || 0), W / 2, 500, 16, "#fd4", "center");
    }

    // top-10 table: rank, initials, score, wave; the freshly added row blinks until view.highlight.until
    function drawTable(view, top, rowH, size) {
      const list = view.scores || [], hl = view.highlight, t = view.time || 0;
      list.forEach((s, i) => {
        const y = top + i * rowH, isNew = !!hl && hl.index === i && t < hl.until;
        if (isNew && !reducedMotion && Math.floor(t * BLINK_HZ * 2) % 2) return; // blink off phase
        const color = isNew ? "#4df" : i === 0 ? "#fd4" : "#fff";
        text(String(i + 1) + ".", 90, y, size, "#9ab");
        text(s.initials || "AAA", 140, y, size, color);
        text(String(s.score).padStart(6, "0"), 230, y, size, color);
        text("W" + s.wave, 390, y, size - 3, "#9ab", "right");
      });
    }

    function drawScores(view) {
      dim(0.82);
      ui.panel(40, 90, W - 80, 440, { stroke: "#fd4" });
      ui.title("HIGH SCORES", W / 2, 150, 28, "#fd4");
      if (!(view.scores || []).length) text("No scores yet. Go blast something!", W / 2, 300, 15, "#9ab", "center");
      drawTable(view, 195, 28, 20);
      text("Press Enter, P or tap to go back", W / 2, 500, 14, "#fd4", "center");
    }

    // new record: three letter slots with up/down boxes and an OK button
    function drawInitials(view) {
      const L = root.BBInput.INITIALS_LAYOUT, picker = view.picker;
      dim(0.82);
      ui.panel(40, 90, W - 80, 440, { stroke: "#4df" });
      ui.title("NEW RECORD!", W / 2, 150, 32, "#fd4");
      text("SCORE " + (view.results ? view.results.score : view.game.score), W / 2, 185, 18, "#fff", "center");
      for (let i = 0; i < 3; i++) {
        const x = L.slotX[i], hot = !!picker && picker.slot === i;
        text("▲", x, L.upY + 8, 24, hot ? "#fd4" : "#9ab", "center");
        text(picker ? picker.value()[i] : "A", x, L.letterY, 44, hot ? "#fd4" : "#fff", "center");
        text("▼", x, L.downY + 8, 24, hot ? "#fd4" : "#9ab", "center");
      }
      ui.button(L.ok.x, L.ok.y, L.ok.w, L.ok.h, "OK", "hot");
      text("Arrows: letters and slots, Enter: OK", W / 2, 490, 13, "#9ab", "center");
    }

    function drawHowTo() {
      dim(0.82);
      ui.panel(40, 90, W - 80, 440, { stroke: "#4df" });
      ui.title("HOW TO PLAY", W / 2, 140, 28);
      HOW_TO_ROWS.forEach((row, i) => {
        const y = 195 + i * 40;
        ui.icon(row.icon, 76, y - 5, 24, "#4df");
        text(row.text, 98, y, 14, "#fff");
      });
      text("Press Enter, P or tap to continue", W / 2, 500, 14, "#fd4", "center");
    }

    // results replace the old game over: score, wave, stars and the goals checklist
    function drawResults(view) {
      const game = view.game, t = view.time || 0;
      const res = view.results || { score: game.score, wave: game.wave, stars: 0, goals: [] };
      dim(0.7);
      ui.panel(50, 20, W - 100, 600, { stroke: "#f55" });
      ui.title("RESULTS", W / 2, 70, 32, "#f55");
      ui.stars(W / 2, 100, res.stars, 3, 13);
      text("SCORE " + res.score, W / 2, 145, 22, "#fff", "center");
      text("WAVE " + res.wave + "   BEST " + (view.best || 0), W / 2, 170, 14, "#fd4", "center");
      res.goals.forEach((g, i) => {
        const y = 205 + i * 24;
        ui.icon(GOAL_ICON[g.id] || "star", 100, y - 5, 18, g.done ? "#ffd23c" : "rgba(255,255,255,0.3)");
        text(g.label, 124, y, 14, g.done ? "#fff" : "#789");
        text(g.done ? "DONE" : "-", 380, y, 13, g.done ? "#6e6" : "#789", "right");
      });
      text("TOP 10", W / 2, 305, 13, "#9ab", "center");
      drawTable(view, 335, 21, 16);
      pulsed(W / 2, 580, t, () => text("Press Enter to replay", W / 2, 580, 18, "#4df", "center"));
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
      for (const b of game.bullets) glowRect(b, b.pierce ? "special" : "bullet", b.pierce ? "#8ff" : "#6af");
      for (const b of game.enemyBullets) glowRect(b, "enemyBullet", "#f55");
      drawShip(game, t);
      drawShockwaves();
      drawParticles();
      if (flash.time > 0) {
        ctx.fillStyle = "rgba(255,60,60," + (0.4 * flash.time / FLASH_TIME) + ")";
        ctx.fillRect(0, 0, W, H);
      }
      ctx.restore();
      drawHud(view);
      drawControls(view);
      const screen = view.menu && view.menu.screen;
      if (screen === "initials") drawInitials(view);
      else if (game.status === "over" || screen === "results") drawResults(view);
      else if (screen === "title") drawTitle(view);
      else if (screen === "scores") drawScores(view);
      else if (screen === "pause") drawPause(view.menu);
      else if (screen === "howto") drawHowTo();
    }

    return {
      update, draw, explode, particles, pulse,
      setReducedMotion(on) { reducedMotion = !!on; if (reducedMotion) shake.time = 0; },
      isReducedMotion: () => reducedMotion,
    };
  }

  root.BBRender = { createRenderer, HOW_TO, HOW_TO_ROWS };
})(globalThis);
