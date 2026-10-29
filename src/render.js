// Boredom Blaster drawing: sprites with plain-shape fallbacks, glow bullets, particle explosions,
// parallax stars and meteors, shield ring, hit flash, boss HP bar, framed HUD and the menu screens.
// Plain script; main.js calls BBRender.createRenderer(ctx, assets). Tests drive it with a stub canvas.
(function (root) {
  const W = 480, H = 640;
  const HUD_H = 56;
  const RANK_COLOR = { bronze: "#c8843c", silver: "#cfd6e0", gold: "#ffd23c" };
  const RANK_SPRITE = { bronze: "capsuleBronze", silver: "capsuleSilver", gold: "capsuleGold", rainbow: "capsuleRainbow" };
  const SPECIES_COLOR = {
    drone: "#f5a", wasp: "#5df", viper: "#f66", diver: "#6e6", splitter: "#c8f",
    splitling: "#e88", orbiter: "#7af", dasher: "#f84",
  };
  const SPRITE_SCALE = 1.35; // sprites are drawn a bit larger than their hitbox
  const FLASH_TIME = 0.35;
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
  const HOW_TO = [
    "Steer: drag on the left half,",
    "or arrows / WASD",
    "Fire: hold Space or the FIRE button",
    "Special (X): piercing shot",
    "Kaboom (B): blasts nearby enemies",
    "Catch capsules: weapon, shield,",
    "escort, Super Star",
    "Pause: P or Esc",
  ];

  function createRenderer(ctx, assets) {
    const particles = [];
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
      const n = big ? 36 : 12;
      for (let i = 0; i < n && particles.length < MAX_PARTICLES; i++) {
        const a = (i / n) * Math.PI * 2 + i * 0.7, v = (big ? 140 : 90) * (0.4 + ((i * 37) % 10) / 10);
        particles.push({
          x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.6, max: 0.6,
          color: i % 3 === 0 ? "#fff" : i % 3 === 1 ? "#fd4" : "#f74", size: big ? 4 : 3,
        });
      }
    }

    // Reads the game each frame: vanished enemies explode, a lost life flashes the screen.
    function update(dt, game) {
      scroll += dt;
      const alive = new Set(game.drones);
      for (const d of prev.drones) {
        if (!alive.has(d)) explode(d.x + d.w / 2, d.y + d.h / 2, !!d.boss);
      }
      if (prev.lives !== null && game.lives < prev.lives) flash.time = FLASH_TIME;
      prev = { drones: game.drones.slice(), lives: game.lives, wave: game.wave };
      flash.time = Math.max(0, flash.time - dt);
      for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
      for (let i = particles.length - 1; i >= 0; i--) if (particles[i].life <= 0) particles.splice(i, 1);
    }

    // ---- scene ----
    function drawBackground() {
      ctx.fillStyle = "#050514";
      ctx.fillRect(0, 0, W, H);
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
    function pips(label, x, y, max, filled, color) {
      text(label, x, y, 11, "#9ab");
      for (let i = 0; i < max; i++) circle(x + 36 + i * 11, y - 4, 4, i < filled ? color : "rgba(255,255,255,0.2)");
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
      panel(0, 0, W, HUD_H, "rgba(5,10,30,0.85)", "#2a4a7a");
      text("SCORE", 12, 20, 11, "#9ab");
      text(String(game.score), 12, 44, 22, "#fff");
      text("WAVE " + game.wave, W / 2, 24, 16, "#fff", "center");
      text("BEST " + (view.best || 0), W / 2, 44, 13, "#fd4", "center");
      const R = root.BB.R();
      for (let i = 0; i < game.lives; i++) {
        sprite("lifeIcon", W - 24 - i * 28, 22, 22, () => circle(W - 24 - i * 28, 22, 8, "#4df"));
      }
      const y0 = HUD_H + 36 + (game.drones.some((d) => d.boss) ? 18 : 0); // pushed down under the boss bar
      pips("WPN", 12, y0, R.WEAPON.maxLevel, game.weaponLevel, RANK_COLOR.bronze);
      pips("SHD", 12, y0 + 16, R.SHIELD.hits, game.shield, RANK_COLOR.silver);
      pips("ESC", 12, y0 + 32, R.ESCORT.max, game.escorts.length, RANK_COLOR.gold);
      if (game.superStar > 0) {
        ctx.fillStyle = rainbow(t);
        ctx.fillRect(12, y0 + 40, 100 * (game.superStar / R.SUPER_STAR.duration), 6);
        text("SUPER " + game.superStar.toFixed(1) + "s", 118, y0 + 46, 11, "#fff");
      }
      drawBossBar(game);
    }

    function drawControls(view) {
      const touch = view.touch;
      if (!touch) return;
      const st = touch.stick.state, B = touch.buttons(), game = view.game, BB = root.BB;
      if (st.active) {
        circle(st.cx, st.cy, root.BBInput.STICK.max, "rgba(255,255,255,0.08)", "rgba(255,255,255,0.3)");
        circle(st.kx, st.ky, 22, "rgba(77,221,255,0.4)");
      }
      ctx.globalAlpha = view.touchSeen ? 1 : 0.35;
      const label = (s, b) => text(s, b.x, b.y + 4, 12, "rgba(255,255,255,0.8)", "center");
      circle(B.fire.x, B.fire.y, B.fire.r, "rgba(255,80,80,0.3)", "rgba(255,120,120,0.6)");
      label("FIRE", B.fire);
      circle(B.special.x, B.special.y, B.special.r, "rgba(77,221,255,0.25)", "rgba(77,221,255,0.4)");
      const ready = 1 - game.specialCooldown / BB.SPECIAL.cooldown;
      ctx.beginPath();
      ctx.arc(B.special.x, B.special.y, B.special.r, -Math.PI / 2, -Math.PI / 2 + ready * Math.PI * 2);
      ctx.strokeStyle = ready >= 1 ? "#4df" : "rgba(255,255,255,0.7)";
      ctx.lineWidth = 4;
      ctx.stroke();
      label("SPEC", B.special);
      circle(B.kaboom.x, B.kaboom.y, B.kaboom.r, "rgba(255,200,60,0.25)", "rgba(255,200,60,0.5)");
      label("BOOM", B.kaboom);
      for (let i = 0; i < BB.KABOOM.maxCharges; i++) {
        circle(B.kaboom.x - 12 + i * 12, B.kaboom.y + B.kaboom.r + 10, 4, i < game.kaboomCharges ? "#fd4" : "rgba(255,255,255,0.2)");
      }
      ctx.globalAlpha = 1;
    }

    // ---- screens ----
    function dim(alpha) {
      ctx.fillStyle = "rgba(0,0,10," + alpha + ")";
      ctx.fillRect(0, 0, W, H);
    }

    function drawPause(menu) {
      dim(0.65);
      text("PAUSED", W / 2, 230, 36, "#fff", "center");
      const L = root.BBInput.MENU_LAYOUT;
      menu.items().forEach((label, i) => {
        const y = L.y + i * (L.h + L.gap), hot = i === menu.cursor;
        const img = assets && assets.get(hot ? "buttonHot" : "button");
        if (img) ctx.drawImage(img, L.x, y, L.w, L.h);
        else panel(L.x, y, L.w, L.h, hot ? "#446" : "#223", hot ? "#fd4" : "#68a");
        text(label, W / 2, y + L.h / 2 + 5, 15, hot ? "#000" : "#fff", "center");
      });
    }

    function drawHowTo() {
      dim(0.82);
      panel(40, 90, W - 80, 440, "rgba(10,20,50,0.9)", "#4df");
      text("HOW TO PLAY", W / 2, 140, 28, "#4df", "center");
      HOW_TO.forEach((line, i) => text(line, W / 2, 190 + i * 32, 15, "#fff", "center"));
      text("Press Enter, P or tap to continue", W / 2, 500, 14, "#fd4", "center");
    }

    function drawGameOver(view) {
      const game = view.game;
      dim(0.5);
      text("GAME OVER", W / 2, H / 2 - 10, 40, "#f55", "center");
      text("Score " + game.score, W / 2, H / 2 + 26, 20, "#fff", "center");
      text("Best " + (view.best || 0), W / 2, H / 2 + 52, 16, "#fd4", "center");
      text("Press Enter to restart", W / 2, H / 2 + 84, 18, "#4df", "center");
    }

    // view: { game, menu, best, touch, touchSeen, time }
    function draw(view) {
      const game = view.game, t = view.time || 0;
      drawBackground();
      for (const d of game.drones) drawEnemy(d);
      for (const c of game.capsules) drawCapsule(c, t);
      for (const e of game.escorts) drawEscort(e);
      for (const b of game.bullets) glowRect(b, b.pierce ? "special" : "bullet", b.pierce ? "#8ff" : "#6af");
      for (const b of game.enemyBullets) glowRect(b, "enemyBullet", "#f55");
      drawShip(game, t);
      drawParticles();
      if (flash.time > 0) {
        ctx.fillStyle = "rgba(255,60,60," + (0.4 * flash.time / FLASH_TIME) + ")";
        ctx.fillRect(0, 0, W, H);
      }
      drawHud(view);
      drawControls(view);
      if (game.status === "over") drawGameOver(view);
      else if (view.menu && view.menu.screen === "pause") drawPause(view.menu);
      else if (view.menu && view.menu.screen === "howto") drawHowTo();
    }

    return { update, draw, explode, particles };
  }

  root.BBRender = { createRenderer, HOW_TO };
})(globalThis);
