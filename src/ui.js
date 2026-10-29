// Boredom Blaster style kit: glossy bevelled panels, buttons, titles, stars and the icon set.
// Plain script; render.js calls BBUI.createUI(ctx). Everything is drawn with canvas paths, no images,
// and works on a stub canvas (gradients may come back empty: flat colours are used then).
(function (root) {
  const TAU = Math.PI * 2;
  const ICONS = ["heart", "pause", "fire", "spec", "boom", "weapon", "shield", "escort", "star", "play", "gear"];
  const PALETTE = {
    idle: { top: "#5a7cc0", bottom: "#243a74", edge: "#9fc0ff", shadow: "#0a1230" },
    hot: { top: "#ffe27a", bottom: "#d8861c", edge: "#fff2b0", shadow: "#4a2a04" },
    pressed: { top: "#1c2d5c", bottom: "#3a5a9e", edge: "#6f8fd0", shadow: "#050a1c" },
    disabled: { top: "#4a4f5c", bottom: "#2a2e38", edge: "#6a7080", shadow: "#0c0e14" },
  };
  const PRESS_DROP = 2; // px a pressed button sinks

  function createUI(ctx) {
    // a gradient, or null when the canvas cannot make one
    function gradient(g, stops) {
      if (!g || typeof g.addColorStop !== "function") return null;
      for (const [at, color] of stops) g.addColorStop(at, color);
      return g;
    }
    function vertical(y0, y1, top, bottom, fallback) {
      return gradient(ctx.createLinearGradient(0, y0, 0, y1), [[0, top], [1, bottom]]) || fallback;
    }
    function roundPath(x, y, w, h, r) {
      r = Math.max(0, Math.min(r, w / 2, h / 2));
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    // framed panel: dark fill, light inner edge, coloured outer frame
    function panel(x, y, w, h, opts) {
      const o = opts || {}, r = o.radius === undefined ? 8 : o.radius;
      ctx.save();
      roundPath(x, y, w, h, r);
      ctx.fillStyle = vertical(y, y + h, o.top || "rgba(18,30,70,0.92)", o.bottom || "rgba(6,10,30,0.92)", o.fill || "rgba(10,18,50,0.92)");
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = o.stroke || "#3a64a8";
      ctx.stroke();
      roundPath(x + 3, y + 3, w - 6, h - 6, Math.max(0, r - 2));
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(160,200,255,0.25)";
      ctx.stroke();
      ctx.restore();
    }

    // glossy body shared by the rectangular and round buttons (path already set)
    function glossFill(y, h, pal) {
      ctx.fillStyle = vertical(y, y + h, pal.top, pal.bottom, pal.bottom);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = pal.edge;
      ctx.stroke();
    }

    function button(x, y, w, h, label, state) {
      const pal = PALETTE[state] || PALETTE.idle, drop = state === "pressed" ? PRESS_DROP : 0;
      ctx.save();
      roundPath(x, y + 3, w, h, 9); // the bevel's bottom shadow
      ctx.fillStyle = pal.shadow;
      ctx.fill();
      roundPath(x, y + drop, w, h, 9);
      glossFill(y + drop, h, pal);
      if (state !== "pressed") { // gloss highlight on the upper half
        roundPath(x + 4, y + drop + 3, w - 8, h * 0.42, 6);
        ctx.fillStyle = "rgba(255,255,255,0.22)";
        ctx.fill();
      }
      if (label) {
        ctx.font = "bold 15px monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = state === "hot" ? "#1a1000" : state === "disabled" ? "#8a90a0" : "#fff";
        ctx.fillText(label, x + w / 2, y + drop + h / 2 + 5);
      }
      ctx.restore();
    }

    // round icon button; opts: { state, color (icon colour), label }
    function iconButton(cx, cy, r, icon, opts) {
      const o = opts || {}, state = o.state || "idle";
      const pal = PALETTE[state] || PALETTE.idle, drop = state === "pressed" ? PRESS_DROP : 0;
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy + 3, r, 0, TAU);
      ctx.fillStyle = pal.shadow; ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy + drop, r, 0, TAU);
      glossFill(cy + drop - r, r * 2, pal);
      if (state !== "pressed") {
        ctx.beginPath(); ctx.ellipse(cx, cy + drop - r * 0.45, r * 0.7, r * 0.38, 0, 0, TAU);
        ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.fill();
      }
      icon_(icon, cx, cy + drop, r * 1.0, state === "disabled" ? "#7a8090" : o.color || "#fff");
      if (o.label) {
        ctx.font = "bold 10px monospace"; ctx.textAlign = "center";
        ctx.fillStyle = state === "disabled" ? "#7a8090" : "#dfe8ff";
        ctx.fillText(o.label, cx, cy + drop + r * 0.78);
      }
      ctx.restore();
    }

    function title(str, cx, y, size, color) {
      ctx.save();
      ctx.font = "bold " + size + "px monospace";
      ctx.textAlign = "center";
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(3, size / 6);
      ctx.strokeStyle = "#0a1030";
      ctx.strokeText(str, cx, y + 3);
      ctx.fillStyle = "#16306a";
      ctx.fillText(str, cx, y + 3);
      ctx.strokeText(str, cx, y);
      ctx.fillStyle = vertical(y - size, y, "#ffffff", color || "#4df", color || "#4df");
      ctx.fillText(str, cx, y);
      ctx.restore();
    }

    function starShape(cx, cy, r, fill, stroke) {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
        if (i) ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); else ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fillStyle = fill; ctx.fill();
      if (stroke) { ctx.lineWidth = 1.5; ctx.strokeStyle = stroke; ctx.stroke(); }
    }

    // a row of `total` stars, `count` of them lit, centred on cx
    function stars(cx, cy, count, total, size) {
      const gap = size * 2.4, x0 = cx - ((total - 1) * gap) / 2;
      for (let i = 0; i < total; i++) {
        if (i < count) starShape(x0 + i * gap, cy, size, "#ffd23c", "#fff3a8");
        else starShape(x0 + i * gap, cy, size, "rgba(255,255,255,0.12)", "rgba(255,255,255,0.3)");
      }
    }

    function icon_(name, cx, cy, size, color) {
      const s = size * 0.5;
      ctx.save();
      ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = Math.max(2, size / 8);
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.beginPath();
      switch (name) {
        case "heart":
          ctx.moveTo(cx, cy + s * 0.85);
          ctx.bezierCurveTo(cx - s * 1.5, cy - s * 0.2, cx - s * 0.7, cy - s * 1.1, cx, cy - s * 0.35);
          ctx.bezierCurveTo(cx + s * 0.7, cy - s * 1.1, cx + s * 1.5, cy - s * 0.2, cx, cy + s * 0.85);
          ctx.fill(); break;
        case "pause":
          ctx.fillRect(cx - s * 0.7, cy - s * 0.8, s * 0.5, s * 1.6);
          ctx.fillRect(cx + s * 0.2, cy - s * 0.8, s * 0.5, s * 1.6); break;
        case "play":
          ctx.moveTo(cx - s * 0.6, cy - s * 0.8); ctx.lineTo(cx + s * 0.8, cy); ctx.lineTo(cx - s * 0.6, cy + s * 0.8);
          ctx.closePath(); ctx.fill(); break;
        case "fire": // flame
          ctx.moveTo(cx, cy - s * 0.95);
          ctx.quadraticCurveTo(cx + s * 0.95, cy - s * 0.05, cx + s * 0.5, cy + s * 0.6);
          ctx.quadraticCurveTo(cx, cy + s * 1.0, cx - s * 0.5, cy + s * 0.6);
          ctx.quadraticCurveTo(cx - s * 0.95, cy - s * 0.05, cx, cy - s * 0.95);
          ctx.fill(); break;
        case "spec": // piercing arrow
          ctx.moveTo(cx, cy - s); ctx.lineTo(cx + s * 0.7, cy + s * 0.1); ctx.lineTo(cx + s * 0.25, cy + s * 0.1);
          ctx.lineTo(cx + s * 0.25, cy + s); ctx.lineTo(cx - s * 0.25, cy + s); ctx.lineTo(cx - s * 0.25, cy + s * 0.1);
          ctx.lineTo(cx - s * 0.7, cy + s * 0.1); ctx.closePath(); ctx.fill(); break;
        case "boom": // spiky burst
          for (let i = 0; i < 16; i++) {
            const a = (i * TAU) / 16, rr = i % 2 ? s * 0.5 : s;
            if (i) ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); else ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
          }
          ctx.closePath(); ctx.fill(); break;
        case "weapon": // bolt
          ctx.moveTo(cx + s * 0.2, cy - s); ctx.lineTo(cx - s * 0.6, cy + s * 0.1); ctx.lineTo(cx - s * 0.05, cy + s * 0.1);
          ctx.lineTo(cx - s * 0.25, cy + s); ctx.lineTo(cx + s * 0.6, cy - s * 0.15); ctx.lineTo(cx + s * 0.05, cy - s * 0.15);
          ctx.closePath(); ctx.fill(); break;
        case "shield":
          ctx.moveTo(cx - s * 0.8, cy - s * 0.8); ctx.lineTo(cx + s * 0.8, cy - s * 0.8); ctx.lineTo(cx + s * 0.8, cy);
          ctx.quadraticCurveTo(cx + s * 0.8, cy + s * 0.7, cx, cy + s); ctx.quadraticCurveTo(cx - s * 0.8, cy + s * 0.7, cx - s * 0.8, cy);
          ctx.closePath(); ctx.fill(); break;
        case "escort": // little wingman ship
          ctx.moveTo(cx, cy - s); ctx.lineTo(cx + s * 0.8, cy + s * 0.8); ctx.lineTo(cx, cy + s * 0.4); ctx.lineTo(cx - s * 0.8, cy + s * 0.8);
          ctx.closePath(); ctx.fill(); break;
        case "star":
          starShape(cx, cy, s, color); break;
        case "gear": // toothed wheel with a hole
          for (let i = 0; i < 16; i++) {
            const a0 = (i * TAU) / 16, rr = i % 2 ? s * 0.78 : s;
            ctx.lineTo(cx + Math.cos(a0) * rr, cy + Math.sin(a0) * rr);
          }
          ctx.closePath();
          ctx.moveTo(cx + s * 0.32, cy); ctx.arc(cx, cy, s * 0.32, 0, TAU);
          ctx.fill("evenodd"); break;
        default:
          ctx.arc(cx, cy, s * 0.6, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }

    return { panel, button, iconButton, title, stars, icon: icon_, roundPath };
  }

  root.BBUI = { createUI, ICONS, PALETTE };
})(globalThis);
