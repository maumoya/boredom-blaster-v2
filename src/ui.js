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

    // glowing neon ring button, no text. opts: { state: "idle"|"pressed"|"disabled", color, time,
    //   ready (pulses), cooldown (0..1 progress arc, shown while below 1), segments: { count, total } (charge arcs) }
    function ringButton(cx, cy, r, icon, opts) {
      const o = opts || {}, state = o.state || "idle", color = state === "disabled" ? "#5a6070" : o.color || "#4df";
      const lit = state === "pressed", breath = o.ready && !lit ? 0.5 + 0.5 * Math.sin((o.time || 0) * 5) : 0;
      const arcAt = (rad, from, to, style, width) => {
        ctx.beginPath(); ctx.arc(cx, cy, rad, from, to);
        ctx.strokeStyle = style; ctx.lineWidth = width; ctx.stroke();
      };
      ctx.save();
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); // body: dark glass, filled with colour while pressed
      ctx.fillStyle = "rgba(6,10,28,0.7)";
      ctx.fill();
      if (lit) { // pressed: the ring fills with its colour
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU);
        ctx.fillStyle = color; ctx.globalAlpha *= 0.45; ctx.fill(); ctx.globalAlpha /= 0.45;
      }
      ctx.shadowColor = color; // colour bloom
      ctx.shadowBlur = state === "disabled" ? 0 : lit ? 30 : 12 + 12 * breath;
      arcAt(r, 0, TAU, color, lit ? 5 : 3 + breath);
      ctx.shadowBlur = 0;
      const track = r + 8, start = -Math.PI / 2;
      if (o.cooldown !== undefined && o.cooldown !== null && o.cooldown < 1) {
        arcAt(track, 0, TAU, "rgba(255,255,255,0.15)", 4);
        arcAt(track, start, start + Math.max(0, o.cooldown) * TAU, "#fff", 4);
      }
      const seg = o.segments;
      if (seg && seg.total > 0) {
        const span = TAU / seg.total, gap = Math.min(0.3, span * 0.3);
        for (let i = 0; i < seg.total; i++) {
          const on = i < seg.count;
          ctx.shadowColor = color; ctx.shadowBlur = on ? 10 : 0;
          arcAt(track, start + i * span + gap / 2, start + (i + 1) * span - gap / 2, on ? color : "rgba(255,255,255,0.18)", 4);
        }
        ctx.shadowBlur = 0;
      }
      icon_(icon, cx, cy, r * 1.05, state === "disabled" ? "#7a8090" : lit ? "#fff" : color);
      ctx.restore();
    }

    // D-pad: a plus shape with four arrow pads; `dir` is the held direction { x, y } so the pressed arms glow
    function dpad(cx, cy, r, dir, color) {
      const d = dir || { x: 0, y: 0 }, c = color || "#4df", arm = r * 0.62, half = r * 0.3;
      ctx.save();
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(cx - half, cy - r); ctx.lineTo(cx + half, cy - r); ctx.lineTo(cx + half, cy - half); ctx.lineTo(cx + r, cy - half);
      ctx.lineTo(cx + r, cy + half); ctx.lineTo(cx + half, cy + half); ctx.lineTo(cx + half, cy + r); ctx.lineTo(cx - half, cy + r);
      ctx.lineTo(cx - half, cy + half); ctx.lineTo(cx - r, cy + half); ctx.lineTo(cx - r, cy - half); ctx.lineTo(cx - half, cy - half);
      ctx.closePath();
      ctx.fillStyle = "rgba(6,10,28,0.7)"; ctx.fill();
      ctx.shadowColor = c; ctx.shadowBlur = 12;
      ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.stroke();
      ctx.shadowBlur = 0;
      const arrows = [[0, -1, "up"], [0, 1, "down"], [-1, 0, "left"], [1, 0, "right"]];
      for (const [ax, ay] of arrows) {
        const on = (ax && Math.sign(d.x) === ax) || (ay && Math.sign(d.y) === ay);
        const px = cx + ax * arm, py = cy + ay * arm, s = r * 0.16;
        ctx.beginPath();
        ctx.moveTo(px + ax * s, py + ay * s);
        ctx.lineTo(px - ax * s - ay * s, py - ay * s + ax * s);
        ctx.lineTo(px - ax * s + ay * s, py - ay * s - ax * s);
        ctx.closePath();
        ctx.fillStyle = on ? "#fff" : c; ctx.globalAlpha = on ? 1 : 0.6; ctx.fill();
        ctx.globalAlpha = 1;
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

    return { panel, button, iconButton, ringButton, dpad, title, stars, icon: icon_, roundPath };
  }

  root.BBUI = { createUI, ICONS, PALETTE };
})(globalThis);
