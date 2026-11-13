/*
 * TestnetCasino.com: Cosmic Voyage on the PixiJS engine (pixi-machine.js).
 *
 * A neon spaceship cabinet: the Fuel Tank beside the reels, a console with the WIN and BALANCE
 * screens, the hexagonal LAUNCH key and the THRUST lever (an aircraft throttle), the Warp Ladder
 * bonus and the Star Map Wheel for a jackpot won in the game.
 */
(function () {
  "use strict";
  if (!window.TNC_PixiMachine) return;
  var PIXI = window.PIXI;

  var theme = {
    title: "COSMIC ★ VOYAGE", spin: "LAUNCH", bet: "THRUST", lower: "Lower your thrust", fsShort: "Hyperspace",
    bg: ["#1d0c44", "#0c0526"], neon: "#9a6bff", neon2: "#2ec5ff", text: "#e0eaff", accent: "#ffd166",
    burst: ["⭐", "✨", "🌟", "💫", "🪐"],
    quips: ["Lost signal. Try again!", "Nothing but dark matter.", "Houston, no win.", "Recalibrating the thrusters…"],
    welcome: "Welcome, commander! Set the thrust and press LAUNCH", twist: "ALL WINS ×3",
    jp: { major: ["#2a1260", "#160a36", "#9a6bff", "#e0c3ff", "#e0c3ff"], minor: ["#0b2a4a", "#071a30", "#2ec5ff", "#9ff0ff", "#9ff0ff"] },
    feat: { fill: "rgba(46,197,255,.08)", stroke: "rgba(46,197,255,.55)", text: "#cfe0ff", hot: ["#fff1c4", "#ffd166"], hotStroke: "#fff6dc", hotText: "#2a1c02" },
    fs: { color: 0xff4fd8, fill: 0xff4fd8, fillAlpha: 0.1, bulb: 0xffe6ff },   // free spins: hyperspace, magenta frame
    reel: { strip: ["#c9bfec", "#ece7fb", "#fbfaff"], shade: "18,6,48", divider: ["#1a0b3d", "#b9a6ff", "#f3eeff", "#8a73d9"],
      inner: "rgba(8,2,30,.9)", rim: "rgba(190,170,255,.55)", symShadow: "rgba(40,20,90,.3)", fixed: 0xfff4d6 },
    lcd: { bg: "rgba(4,18,30,.92)", border: "rgba(46,197,255,.6)", text: "#9ff0ff", glow: "#2ec5ff", hot: "#ffe79a", sub: "#7fb8d6" },
    hint: "#cbb8ff",
    recess: { glow: "rgba(46,197,255,.35)", rim: "rgba(154,107,255,.6)" },
    readout: { label: "#b9a6ff", value: "#ffffff", glow: "#9a6bff", unit: "#8f86b8" },
    bannerBg: 0x0a0418, collectGlow: "#9ff0ff",
    stage: { glow: "#9a6bff", bg: ["#2a1260", "#07041a"], stroke: "#2ec5ff", sub: "#7dff8a", button: ["#ff6b81", "#b0102a", "#ffe79a"] }
  };
  var T = theme;

  function hexPath(g, cx, cy, r) { g.beginPath(); for (var i = 0; i < 6; i++) { var a = Math.PI / 6 + i * Math.PI / 3; g.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a)); } g.closePath(); }

  /* ═══ Cabinet ═══ */
  // The cabinet's upper body, from its cut top corners down to the fold (FY), where it bends forward
  // into the console: one body, one neon outline.
  function cabinet(k) {
    var W = k.W, FY = k.FY, grad = k.grad, rr = k.rr;
    k.L.cabinet.addChild(k.paint(W - 20, FY - 140 + 2, function (g, w, h) {
      function outline() { g.beginPath(); g.moveTo(6, h); g.lineTo(6, 40); g.lineTo(40, 6); g.lineTo(w - 40, 6); g.lineTo(w - 6, 40); g.lineTo(w - 6, h); }
      outline(); g.closePath(); g.shadowColor = T.neon; g.shadowBlur = 28;
      g.fillStyle = grad(g, 0, h, [T.bg[0], T.bg[1]]); g.fill(); g.shadowBlur = 0;
      g.save(); g.clip(); g.globalAlpha = 0.08; g.strokeStyle = T.neon2; g.lineWidth = 1;   // grid lines
      for (var y = 20; y < h; y += 28) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      for (var x0 = 14; x0 < w; x0 += 28) { g.beginPath(); g.moveTo(x0, 0); g.lineTo(x0, h); g.stroke(); }
      g.restore();
      outline(); g.lineWidth = 3; g.strokeStyle = T.neon; g.stroke();   // open at the bottom
    })).position.set(10, 140);
    var title = k.txt(T.title, { fontSize: 50, fill: "#f2e6ff", letterSpacing: 3,
      dropShadow: { color: T.neon, blur: 18, distance: 0, alpha: 1 }, stroke: { color: "#2a0f5a", width: 3 } });
    title.position.set(W / 2, 196);
    k.L.cabinet.addChild(title);
    // The reel window (frame)
    k.L.cabinet.addChild(k.paint(k.RW + 24, k.RH + 24, function (g, w, h) {
      g.shadowColor = T.neon2; g.shadowBlur = 18; rr(g, 4, 4, w - 8, h - 8, 14); g.fillStyle = "#05030f"; g.fill();
      g.shadowBlur = 0; g.lineWidth = 3; g.strokeStyle = T.neon; g.stroke();
    })).position.set(k.RX - 12, k.RY - 12);
  }

  /* ═══ A cell full of fuel, on the reel strip itself: it rides on some passing symbols while the reels turn and
     on the cells about to be collected, so the fuel arrives with the reel. Painted to match the live fuel cell
     (the collector's overlay) that takes over at the stop. ═══ */
  function cellDeco(k) {
    var w = k.CW - 6, h = k.CH - 6;
    return { chance: 0.07, tex: k.texOf(w, h, function (g) {
      k.rr(g, 0, 0, w, h, 12); g.save(); g.clip();
      g.fillStyle = "rgba(26,163,232,.92)"; g.fillRect(0, 0, w, h);
      g.fillStyle = "rgba(159,240,255,.35)"; g.beginPath(); g.moveTo(0, 8);
      for (var x = 0; x <= w; x += 4) g.lineTo(x, 7 + Math.sin(x / 9) * 1.5); g.lineTo(w, h); g.lineTo(0, h); g.closePath(); g.fill();
      g.fillStyle = "rgba(3,26,46,.35)"; g.fillRect(0, h - 30, w, 30);
      g.strokeStyle = "rgba(230,251,255,.5)"; g.lineWidth = 1; [[14, h - 20], [42, h - 48], [70, h - 32]].forEach(function (b) { g.beginPath(); g.arc(b[0], b[1], 2, 0, Math.PI * 2); g.stroke(); });
      g.restore();
      k.rr(g, 1.25, 1.25, w - 2.5, h - 2.5, 12); g.lineWidth = 2.5; g.strokeStyle = "rgba(159,240,255,.65)"; g.stroke();
    }) };
  }

  /* ═══ The collector: the Fuel Tank. A fuel cell lands on the reels already full of fuel (no badge: the
     cell itself is the fuel), sloshing as the reel stops; at the collect step each cell drains along a stream
     over to the tank's inlet and pours down into the tank: the level rises with a splash and bubbles. Full:
     the tank blazes and the thruster under it lights; when the Hyperdrive is over the fuel drains away. ═══ */
  function collector(k, tank) {
    var TW = k.TW, TH = k.TH, rr = k.rr, COL = k.COL, TANK = k.TANK, PIXI = k.PIXI, L = k.L;
    var cx = TW / 2, TIN = { x: 26, y: 66, w: TW - 52, h: TH - 92 }, INLET_Y = TIN.y - 30;
    var glowBack = k.paint(TW + 80, TH + 80, function (g, w, h) {
      var rg = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w / 2); rg.addColorStop(0, "rgba(159,240,255,.7)"); rg.addColorStop(0.5, "rgba(46,197,255,.3)"); rg.addColorStop(1, "rgba(46,197,255,0)");
      g.fillStyle = rg; g.fillRect(0, 0, w, h);
    });
    glowBack.anchor.set(0.5); glowBack.position.set(cx, TH / 2); glowBack.alpha = 0; tank.addChild(glowBack);
    var tankGlass = k.paint(TW, TH, function (g, w, h) {
      g.shadowColor = T.neon; g.shadowBlur = 16; rr(g, 4, 4, w - 8, h - 8, 10); g.fillStyle = "rgba(10,6,30,.92)"; g.fill();
      g.shadowBlur = 0; g.lineWidth = 2.5; g.strokeStyle = T.neon; g.stroke();
    });
    tank.addChild(tankGlass);
    var tankName = k.txt(COL ? COL.name.toUpperCase() : "", { fontSize: 13, fill: "#9ff0ff", letterSpacing: 1.5 }); tankName.position.set(TW / 2, 22); tank.addChild(tankName);
    // The tank itself: metal caps above and below the glass, the inlet pipe on top, the thruster nozzle underneath
    tank.addChild(k.paint(TW, TH, function (g) {
      function cap(y) { rr(g, TIN.x - 7, y, TIN.w + 14, 20, 8); g.fillStyle = k.grad(g, y, y + 20, ["#9b92c4", "#4a3f7a", "#241a48"]); g.fill(); g.lineWidth = 1.5; g.strokeStyle = "rgba(46,197,255,.6)"; g.stroke(); }
      cap(TIN.y - 14); cap(TIN.y + TIN.h - 6);
      rr(g, cx - 8, INLET_Y, 16, 20, 3); g.fillStyle = k.hgrad(g, cx - 8, cx + 8, ["#2a2050", "#b9a6ff", "#2a2050"]); g.fill(); g.lineWidth = 1.5; g.strokeStyle = "rgba(46,197,255,.6)"; g.stroke();
      g.beginPath(); g.moveTo(cx - 15, INLET_Y - 3); g.lineTo(cx + 15, INLET_Y - 3); g.lineTo(cx + 9, INLET_Y + 5); g.lineTo(cx - 9, INLET_Y + 5); g.closePath();   // the flared mouth
      g.fillStyle = k.grad(g, INLET_Y - 3, INLET_Y + 5, ["#cfc4ff", "#5a4a9a"]); g.fill(); g.stroke();
      g.fillStyle = "#06101c"; g.beginPath(); g.ellipse(cx, INLET_Y - 3, 13, 3.5, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = "rgba(159,240,255,.7)"; g.lineWidth = 1; g.beginPath(); g.ellipse(cx, INLET_Y - 3, 13, 3.5, 0, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(cx - 11, TIN.y + TIN.h + 12); g.lineTo(cx + 11, TIN.y + TIN.h + 12); g.lineTo(cx + 17, TH - 6); g.lineTo(cx - 17, TH - 6); g.closePath();   // the nozzle
      g.fillStyle = k.hgrad(g, cx - 17, cx + 17, ["#241a48", "#6a5aa8", "#241a48"]); g.fill(); g.lineWidth = 1.5; g.strokeStyle = "rgba(46,197,255,.6)"; g.stroke();
      rr(g, TIN.x - 4, TIN.y - 4, TIN.w + 8, TIN.h + 8, 18); g.fillStyle = "rgba(0,0,0,.6)"; g.fill(); g.lineWidth = 2; g.strokeStyle = "rgba(46,197,255,.8)"; g.stroke();   // the glass
    }));
    var glassC = new PIXI.Container(); tank.addChild(glassC);
    var glassMask = new PIXI.Graphics().roundRect(TIN.x, TIN.y, TIN.w, TIN.h, 15).fill(0xffffff); tank.addChild(glassMask); glassC.mask = glassMask;
    var fuel = new PIXI.Graphics(), bubbleG = new PIXI.Graphics(), inner = new PIXI.Graphics(); glassC.addChild(fuel, bubbleG, inner);
    tank.addChild(k.paint(TW, TH, function (g) {                                               // the glass: a highlight, the gauge marks, E and F
      g.fillStyle = "rgba(255,255,255,.1)"; rr(g, TIN.x + 7, TIN.y + 10, 9, TIN.h - 20, 5); g.fill();
      g.strokeStyle = "rgba(159,240,255,.5)"; g.lineWidth = 1.5;
      for (var mk = 0; mk <= 10; mk++) { var y = TIN.y + TIN.h * mk / 10, len = mk % 5 ? 6 : 12; g.beginPath(); g.moveTo(TIN.x + TIN.w - 4 - len, y); g.lineTo(TIN.x + TIN.w - 4, y); g.stroke(); }
      g.font = "700 11px " + k.SIGN.split(",")[0]; g.textAlign = "right"; g.fillStyle = "rgba(159,240,255,.75)";
      g.fillText("F", TIN.x + TIN.w - 17, TIN.y + 12); g.fillText("E", TIN.x + TIN.w - 17, TIN.y + TIN.h - 4);
    }));
    var flame = new PIXI.Graphics(); tank.addChild(flame);
    var tankFull = k.txt("FULL!", { fontSize: 26, fill: "#ffe79a", dropShadow: { color: "#ffb300", blur: 12, distance: 0, alpha: 1 }, stroke: { color: "#000", width: 3 } });
    tankFull.position.set(TW / 2, TIN.y + TIN.h / 2); tankFull.visible = false; tank.addChild(tankFull);
    var SPARK = k.texOf(14, 14, function (g) { g.fillStyle = "#fff3c0"; g.beginPath(); g.moveTo(7, 0); g.lineTo(8.6, 5.4); g.lineTo(14, 7); g.lineTo(8.6, 8.6); g.lineTo(7, 14); g.lineTo(5.4, 8.6); g.lineTo(0, 7); g.lineTo(5.4, 5.4); g.closePath(); g.fill(); });
    // The streams from the reels to the inlet are drawn over the machine
    var fxG = new PIXI.Graphics(); L.fx.addChild(fxG);
    var streams = [], cellsFx = [], bubbles = [];
    // A full fuel cell on a reel cell (once per cell); `slosh` makes the surface heave, as when the reel has just stopped
    function fuelCell(rc, slosh) {
      if (cellsFx.some(function (cf) { return cf.rc[0] === rc[0] && cf.rc[1] === rc[1]; })) return;
      var xy = k.cellXY(rc[0], rc[1]), c = new PIXI.Container(); c.position.set(xy.x, xy.y);
      var m = new PIXI.Graphics().roundRect(-k.CW / 2 + 3, -k.CH / 2 + 3, k.CW - 6, k.CH - 6, 12).fill(0xffffff); c.addChild(m);
      var liq = new PIXI.Graphics(); liq.mask = m; c.addChild(liq); L.fx.addChild(c);
      cellsFx.push({ c: c, liq: liq, rc: rc, level: 1, draining: false, slosh: slosh && !k.reduce ? 1 : 0, x: xy.x, y: xy.y });
      if (slosh) k.sfx.collectItem(0.5);
    }
    var t = 0, disp = 0, pourT = 0, shakeT = 0, glowKick = 0, flameOn = 0;
    function bez(q, u) {
      var v = 1 - u, a = v * v * v, b = 3 * v * v * u, c = 3 * v * u * u, d = u * u * u;
      return { x: a * q[0] + b * q[2] + c * q[4] + d * q[6], y: a * q[1] + b * q[3] + c * q[5] + d * q[7] };
    }
    function liquid(g, x, top, w, bot, amp, phase, color, alpha) {   // a body of fuel with a wavy surface
      g.moveTo(x, bot);
      for (var i = 0; i <= w; i += 4) g.lineTo(x + i, top + Math.sin(phase + i / 9) * amp + Math.sin(phase * 1.7 + i / 5) * amp * 0.4);
      g.lineTo(x + w, bot).closePath().fill({ color: color, alpha: alpha });
    }
    k.app.ticker.add(function (tk) {
      var dt = Math.min(50, tk.deltaMS) / 16.67; t += tk.deltaMS / 1000;
      var lvl = TANK.level, isFull = TANK.full;
      disp = lvl >= disp ? lvl : disp + (lvl - disp) * Math.min(1, 0.07 * dt);   // it drains on its own time
      pourT -= tk.deltaMS; shakeT -= tk.deltaMS; glowKick *= Math.pow(0.94, dt);
      tank.x = k.TX + (shakeT > 0 ? (Math.random() - 0.5) * 5 * Math.min(1, shakeT / 300) : 0);
      glowBack.alpha = Math.min(1, glowKick + (isFull ? 0.45 + Math.sin(t * 6) * 0.25 : 0));
      var pouring = pourT > 0, top = TIN.y + TIN.h * (1 - disp), bot = TIN.y + TIN.h, phase = t * 2.4;
      fuel.clear();
      if (disp > 0) {
        var body = isFull ? 0x5fd8ff : 0x1aa3e8;
        liquid(fuel, TIN.x, top, TIN.w, bot, pouring ? 3.5 : 2, phase, body, 0.92);
        liquid(fuel, TIN.x, top + 7, TIN.w, bot, pouring ? 3 : 1.5, phase + 1.3, 0x9ff0ff, 0.35);
        fuel.rect(TIN.x, bot - 44, TIN.w, 44).fill({ color: 0x031a2e, alpha: 0.35 });
        if (isFull) fuel.rect(TIN.x, TIN.y, TIN.w, TIN.h).fill({ color: 0xffffff, alpha: 0.1 + Math.sin(t * 6) * 0.08 });
      }
      inner.clear();
      if (pouring) {   // the pour inside the tank, from the inlet to the surface, and the splash where it lands
        var ww = 7 + Math.sin(t * 23) * 1.5, end = Math.min(top + 3, bot);
        inner.rect(cx - ww / 2 - 3, TIN.y - 2, ww + 6, end - TIN.y + 2).fill({ color: 0x2ec5ff, alpha: 0.3 });
        inner.rect(cx - ww / 2, TIN.y - 2, ww, end - TIN.y + 2).fill({ color: 0x5fd8ff, alpha: 0.95 });
        inner.rect(cx - 1, TIN.y - 2, 2, end - TIN.y + 2).fill({ color: 0xe6fbff, alpha: 0.8 });
        inner.ellipse(cx, top + 2, 12 + Math.sin(t * 17) * 3, 4).stroke({ width: 2, color: 0xcff6ff, alpha: 0.7 });
        if (Math.random() < 0.6 * dt) bubbles.push({ x: cx + (Math.random() - 0.5) * 26, y: top + 4 + Math.random() * 20, r: 1.5 + Math.random() * 2.5, vy: -(0.5 + Math.random() * 0.8), life: 0 });
        if (Math.random() < 0.5 * dt) k.emit(1, k.TX + cx + (Math.random() - 0.5) * 20, k.TY + top, { tex: SPARK, tint: 0x9ff0ff, power: 2.5, cone: 2.2, g: 0.2, life: 22, spread: 4, spreadY: 2, flip: false, scale: 0.5, spin: 0 });
      } else if (disp > 0.04 && Math.random() < 0.03 * dt) bubbles.push({ x: TIN.x + 10 + Math.random() * (TIN.w - 20), y: bot - 6, r: 1 + Math.random() * 2, vy: -(0.3 + Math.random() * 0.4), life: 0 });
      bubbleG.clear();
      for (var i = bubbles.length - 1; i >= 0; i--) {
        var b = bubbles[i]; b.y += b.vy * dt; b.x += Math.sin(t * 5 + b.r) * 0.2 * dt; b.life += dt;
        if (b.y < top + 2 || b.life > 200) { bubbles.splice(i, 1); continue; }
        bubbleG.circle(b.x, b.y, b.r).stroke({ width: 1, color: 0xe6fbff, alpha: 0.55 }).fill({ color: 0xffffff, alpha: 0.12 });
      }
      cellsFx.forEach(function (cf) {   // fuel inside a reel cell
        var g = cf.liq, w = k.CW - 6, h = k.CH - 6, x = -w / 2, b2 = h / 2; g.clear();
        cf.slosh *= Math.pow(0.97, dt);
        if (cf.level > 0) {
          var tp = b2 - h * cf.level, amp = (cf.draining ? 3 : 1.5) + cf.slosh * 7;
          liquid(g, x, tp, w, b2, amp, phase + cf.x / 50, 0x1aa3e8, 0.92);
          liquid(g, x, tp + 6, w, b2, amp * 0.7, phase + 1.1, 0x9ff0ff, 0.35);
          g.roundRect(x, -b2, w, h, 12).stroke({ width: 2.5, color: 0x9ff0ff, alpha: 0.5 + 0.35 * (0.5 + 0.5 * Math.sin(t * 5 + cf.x / 30)) });   // the cell's rim, lit
          if (cf.level >= 0.98) for (var bi = 0; bi < 3; bi++) g.circle(x + 14 + bi * 28 + Math.sin(t * 2 + bi) * 4, b2 - 12 - ((t * 18 + bi * 23) % 60), 2).stroke({ width: 1, color: 0xe6fbff, alpha: 0.5 });
          if (cf.draining) g.ellipse(w / 2 - 14, b2 - 6, 9, 3).fill({ color: 0x5fd8ff, alpha: 0.9 });   // where it drains out, low on the right
        }
      });
      fxG.clear();
      for (var si = streams.length - 1; si >= 0; si--) {
        var st = streams[si];
        if (st.tail >= 1) { streams.splice(si, 1); continue; }
        var pts = [], n = 28;
        for (var j = 0; j <= n; j++) { var u = st.tail + (st.head - st.tail) * j / n; pts.push(bez(st.q, u)); }
        if (pts.length < 2 || st.head <= st.tail) continue;
        [[16, 0x2ec5ff, 0.22], [8, 0x2ec5ff, 0.95], [2.5, 0xe6fbff, 0.8]].forEach(function (w) {
          fxG.moveTo(pts[0].x, pts[0].y); for (var p = 1; p < pts.length; p++) fxG.lineTo(pts[p].x, pts[p].y);
          fxG.stroke({ width: w[0], color: w[1], alpha: w[2], cap: "round", join: "round" });
        });
        var hd = pts[pts.length - 1]; fxG.circle(hd.x, hd.y, 6 + Math.sin(t * 30) * 1.5).fill({ color: 0xe6fbff, alpha: 0.8 });
      }
      flameOn = isFull ? Math.min(1, flameOn + 0.08 * dt) : Math.max(0, flameOn - 0.06 * dt);
      flame.clear();
      if (flameOn > 0) {
        var fy = TH - 6, fl = flameOn * (26 + Math.sin(t * 31) * 5 + Math.random() * 6);
        [[17, fl, 0x2ec5ff, 0.6], [11, fl * 0.75, 0x9ff0ff, 0.85], [5, fl * 0.45, 0xffffff, 0.95]].forEach(function (f) {
          flame.moveTo(cx - f[0], fy).quadraticCurveTo(cx - f[0] * 0.4, fy + f[1] * 0.7, cx + Math.sin(t * 19) * 2, fy + f[1]).quadraticCurveTo(cx + f[0] * 0.4, fy + f[1] * 0.7, cx + f[0], fy).closePath().fill({ color: f[2], alpha: f[3] * flameOn });
        });
        if (Math.random() < 0.35 * dt) k.emit(1, k.TX + cx, k.TY + fy + 6, { tex: SPARK, tint: 0x9ff0ff, angle: Math.PI / 2, cone: 0.9, power: 5, g: 0.08, life: 30, spread: 10, spreadY: 2, flip: true, scale: 0.6 });
      }
      if (isFull) tankFull.scale.set(1 + Math.sin(t * 7) * 0.06);
    });
    return {
      count: function () {},   // no numbers: the fuel level itself shows how full it is
      flash: function (on) { tankFull.visible = on; tankGlass.tint = on ? 0xffe9a8 : 0xffffff; },
      target: function () { return { x: k.TX + cx, y: k.TY + TIN.y + TIN.h * 0.5 }; },
      badge: false,   // no ⛽ on the cell: the cell itself is the fuel
      // A reel lands: its fuel cells are already full, and slosh with the stop.
      land: function (cells) { cells.forEach(function (rc) { fuelCell(rc, true); }); },
      // The collect step: each cell (full since it landed) drains along a stream to the inlet, and the tank fills.
      collect: async function (items, o) {
        var n = o.cells.length, reduce = k.reduce;
        o.cells.forEach(function (rc) { fuelCell(rc, false); });   // any not shown at the landing (a grid that changed since)
        cellsFx = cellsFx.filter(function (cf) { return o.cells.some(function (rc) { return rc[0] === cf.rc[0] && rc[1] === cf.rc[1]; }); });
        await k.sleep(reduce ? 0 : 250);
        var ix = k.TX + cx, iy = k.TY + INLET_Y - 4;
        k.sfx.pour(0.8 + n * 0.35);
        await Promise.all(cellsFx.slice().map(function (cf, j) {
          return k.sleep(reduce ? 0 : j * 340).then(async function () {
            var s = items[j], s0 = s && !s.destroyed ? s.scale.x : 0;
            var x0 = cf.x + k.CW / 2 - 14, y0 = cf.y + k.CH / 2 - 9;
            var st = { q: [x0, y0, x0 + 120, y0 - 120, ix - 40, iy - 80, ix, iy], head: 0, tail: 0 }; streams.push(st);
            cf.draining = true; k.sfx.collectItem(n > 1 ? j / (n - 1) : 0);
            await k.animate(reduce ? 1 : 480, function (p) { st.head = p; }, k.ease.inOut);
            pourT = Math.max(pourT, 1100); glowKick = Math.max(glowKick, 0.5);
            k.levelTo(o.from + (o.to - o.from) * (j + 1) / n, 850);
            await k.animate(reduce ? 1 : 700, function (p) { st.tail = p; cf.level = 1 - p; pourT = Math.max(pourT, 450); if (s && !s.destroyed) s.scale.set(s0 * (1 - p)); }, k.ease.lin);
            if (s && !s.destroyed) s.destroy(); cellsFx = cellsFx.filter(function (x) { return x !== cf; }); cf.c.destroy({ children: true });
          });
        }));
        cellsFx = [];
        await k.sleep(reduce ? 0 : 400);
      },
      // Full: the tank blazes and shakes, the thruster lights and throws sparks.
      full: function () {
        glowKick = 1.6; shakeT = 800;
        k.emit(26, k.TX + cx, k.TY + TH - 2, { tex: SPARK, tint: 0x9ff0ff, angle: Math.PI / 2, cone: 1.3, power: 8, g: 0.12, life: 55, spread: 24, spreadY: 4, flip: true, scale: 1 });
        k.emit(14, k.TX + cx, k.TY + TIN.y + 30, { tex: SPARK, power: 4, cone: 6.3, g: -0.02, life: 70, spread: 80, spreadY: 200, flip: true, scale: 1.1 });
      },
      // The Hyperdrive starts: the thruster roars.
      reward: function () {
        shakeT = 1100; glowKick = 1.2;
        k.emit(36, k.TX + cx, k.TY + TH - 2, { tex: SPARK, tint: 0xffe79a, angle: Math.PI / 2, cone: 1.1, power: 10, g: 0.1, life: 60, spread: 24, spreadY: 4, flip: true, scale: 1 });
      }
    };
  }

  /* ═══ The console ═══ */
  // The cabinet's base: the console's front edge, facing the player, with the hint printed on it
  function base(k, g) {
    var Q = k.Q, BASE_H = k.BASE_H;
    g.beginPath(); g.moveTo(Q[6], 0); g.lineTo(Q[4], 0); g.lineTo(Q[4] - 10, BASE_H); g.lineTo(Q[6] + 10, BASE_H); g.closePath();
    g.fillStyle = k.grad(g, 0, BASE_H, ["#2a1660", "#0b0522"]); g.fill();
    g.lineWidth = 3; g.strokeStyle = T.neon; g.shadowColor = T.neon; g.shadowBlur = 14;
    g.beginPath(); g.moveTo(Q[6], 0); g.lineTo(Q[6] + 10, BASE_H); g.lineTo(Q[4] - 10, BASE_H); g.lineTo(Q[4], 0); g.stroke();
    g.shadowBlur = 0; g.strokeStyle = "rgba(255,255,255,.3)"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(Q[6] + 4, 1.5); g.lineTo(Q[4] - 4, 1.5); g.stroke();
  }
  // The console surface (painted flat, seen in perspective): the cabinet's material, lit a little more
  // where it faces up, a crease of light along the fold, the outline down its sides and along the front.
  function surface(k, g, w, h) {
    var OX = k.OX;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0); g.lineTo(w, h - 16); g.quadraticCurveTo(w, h, w - 16, h); g.lineTo(16, h); g.quadraticCurveTo(0, h, 0, h - 16); g.closePath();
    g.fillStyle = k.grad(g, 0, h, ["#24104f", "#170a3a", "#0c0526"]); g.fill();
    g.save(); g.clip();
    g.globalAlpha = 0.08; g.strokeStyle = T.neon2; g.lineWidth = 1;                                  // the cabinet's grid
    for (var y = 14; y < h; y += 28) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    for (var x0 = 4; x0 < w; x0 += 28) { g.beginPath(); g.moveTo(x0, 0); g.lineTo(x0, h); g.stroke(); }
    g.globalAlpha = 0.05; g.strokeStyle = "#ffffff";                                                  // brushed metal
    for (var y2 = 6; y2 < h; y2 += 5) { g.beginPath(); g.moveTo(0, y2); g.lineTo(w, y2); g.stroke(); }
    g.globalAlpha = 1;
    var fold = g.createLinearGradient(0, 0, 0, 22);                                                   // the fold: lit edge, then shade
    fold.addColorStop(0, "rgba(220,200,255,.35)"); fold.addColorStop(0.12, "rgba(220,200,255,.08)"); fold.addColorStop(0.25, "rgba(0,0,0,.35)"); fold.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = fold; g.fillRect(0, 0, w, 22);
    g.strokeStyle = "rgba(0,0,0,.4)"; g.lineWidth = 2;                                                // panel seams
    [OX + 252, OX + 528].forEach(function (x) { g.beginPath(); g.moveTo(x, 26); g.lineTo(x, h - 10); g.stroke(); });
    g.strokeStyle = "rgba(179,136,255,.16)"; g.lineWidth = 1;
    [OX + 254, OX + 530].forEach(function (x) { g.beginPath(); g.moveTo(x, 26); g.lineTo(x, h - 10); g.stroke(); });
    g.restore();
    g.beginPath(); g.moveTo(1.5, 0); g.lineTo(1.5, h - 16); g.quadraticCurveTo(1.5, h - 1.5, 16, h - 1.5); g.lineTo(w - 16, h - 1.5); g.quadraticCurveTo(w - 1.5, h - 1.5, w - 1.5, h - 16); g.lineTo(w - 1.5, 0);
    g.lineWidth = 3; g.strokeStyle = T.neon; g.stroke();   // the outline continues: sides and front, open at the fold
  }

  // The controls: WIN and BALANCE, the LAUNCH key, the THRUST lever.
  function deck(k, deck) {
    var paint = k.paint, rr = k.rr, grad = k.grad, txt = k.txt, LADDER = k.LADDER, reduce = k.reduce;
    var win = k.readout("WIN", 22, 22), bal = k.readout("BALANCE", 22, 156);

    // LAUNCH: a hexagonal key standing up from the console; it sinks when pressed.
    var LDEPTH = 18, LR = 74;
    var launch = new PIXI.Container(); launch.position.set(390, 130); deck.addChild(launch);
    var launchWell = paint(260, 260, function (g) {                // the socket in the console
      hexPath(g, 130, 130 + LDEPTH, LR + 14); g.fillStyle = "#07031a"; g.fill();
      g.lineWidth = 3; g.strokeStyle = "rgba(255,79,216,.55)"; g.shadowColor = "#ff4fd8"; g.shadowBlur = 22; g.stroke();
    });
    launchWell.anchor.set(0.5); launch.addChild(launchWell);
    var launchWalls = paint(260, 260, function (g) {               // the key's side walls
      for (var d = LDEPTH; d >= 0; d--) { hexPath(g, 130, 130 + d, LR); g.fillStyle = d > LDEPTH * 0.55 ? "#2a0838" : "#5a1470"; g.fill(); }
      g.lineWidth = 2; g.strokeStyle = "rgba(255,180,240,.35)"; hexPath(g, 130, 130 + LDEPTH, LR); g.stroke();
    });
    launchWalls.anchor.set(0.5); launch.addChild(launchWalls);
    var launchTop = new PIXI.Container(); launch.addChild(launchTop);
    var launchCap = paint(240, 240, function (g) {
      hexPath(g, 120, 120, LR);
      var rg = g.createRadialGradient(120, 80, 8, 120, 120, 112); rg.addColorStop(0, "#ffc4f4"); rg.addColorStop(0.45, "#e040c8"); rg.addColorStop(1, "#6a1fb8");
      g.fillStyle = rg; g.fill(); g.lineWidth = 4; g.strokeStyle = "#ffd6f6"; g.stroke();
      g.save(); hexPath(g, 120, 120, LR); g.clip(); g.globalAlpha = 0.35; g.beginPath(); g.ellipse(120, 62, 70, 26, 0, 0, Math.PI * 2); g.fillStyle = "#fff"; g.fill(); g.restore();
    });
    launchCap.anchor.set(0.5); launchTop.addChild(launchCap);
    var launchLabel = txt(T.spin, { fontSize: 26, fill: "#fff", letterSpacing: 2, dropShadow: { color: "#5a0a6a", blur: 0, distance: 3, angle: Math.PI / 2, alpha: 1 } });
    launchLabel.y = -6;
    var launchSub = txt("", { fontSize: 12, fill: "#ffe6fb", letterSpacing: 1.5 }); launchSub.y = 22;
    launchTop.addChild(launchLabel, launchSub);
    // The key's states: idle (a shine sweeping across the cap, a half press every 4.2 s), pressed (sinks
    // fully, springs back), while the spin plays (half pressed, glowing), off (still and grey).
    // A sprite (alpha) mask: the console is drawn into a texture without a stencil, where shape masks fail.
    var capMask = paint(240, 240, function (g) { hexPath(g, 120, 120, LR - 3); g.fillStyle = "#fff"; g.fill(); });
    capMask.anchor.set(0.5); launchTop.addChild(capMask);
    var capShine = new PIXI.Graphics().poly([-14, -LR - 20, 22, -LR - 20, 14, LR + 20, -22, LR + 20]).fill({ color: 0xffffff, alpha: 0.55 });
    capShine.mask = capMask; launchTop.addChildAt(capShine, launchTop.getChildIndex(launchLabel));
    var capGlow = paint(240, 240, function (g) { hexPath(g, 120, 120, LR - 2); g.fillStyle = "#ffffff"; g.fill(); });
    capGlow.anchor.set(0.5); capGlow.blendMode = "add"; capGlow.alpha = 0; launchTop.addChildAt(capGlow, 1);
    // The socket's neon: a trace runs round its hex rim (slow at rest, a pair racing while the reels turn);
    // a launch sends a hex shockwave out across the console and sparks off the cap.
    var neon = new PIXI.Graphics(); launch.addChildAt(neon, launch.getChildIndex(launchTop));
    var shock = new PIXI.Graphics(); launch.addChildAt(shock, launch.getChildIndex(launchWell) + 1);
    var HEXR = LR + 14, HEXV = [];
    for (var hv = 0; hv < 6; hv++) { var ha = Math.PI / 6 + hv * Math.PI / 3; HEXV.push([Math.cos(ha) * HEXR, LDEPTH + Math.sin(ha) * HEXR]); }
    function hexAt(p) { p = ((p % 1) + 1) % 1; var e = Math.floor(p * 6), q = p * 6 - e, a = HEXV[e], b = HEXV[(e + 1) % 6]; return [a[0] + (b[0] - a[0]) * q, a[1] + (b[1] - a[1]) * q]; }
    var tracePos = 0, waves = [], sparks = [], lastFlash = 0;
    var SPARK = k.texOf(6, 6, function (g) { g.fillStyle = "#fff"; g.beginPath(); g.arc(3, 3, 2.6, 0, Math.PI * 2); g.fill(); });
    k.app.ticker.add(function (tk) {
      var dt = Math.min(40, tk.deltaMS);
      launchTop.y = k.keySpring(LDEPTH, dt);
      var s = k.keyState(), busy = s.busy, off = s.off, keyT = s.t;
      capGlow.alpha = busy && !reduce ? 0.10 + 0.12 * (0.5 + 0.5 * Math.sin(keyT / 140)) : busy ? 0.12 : 0;
      launchTop.tint = off ? 0x8c8c99 : 0xffffff;
      launch.alpha = off ? 0.8 : 1;
      launchWell.alpha = off ? 0.35 : busy ? 0.9 + 0.1 * Math.sin(keyT / 140) : 0.75 + Math.sin(keyT / 600) * 0.25;
      var f = s.flash;
      capGlow.alpha = Math.max(capGlow.alpha, f * 0.8); launchLabel.scale.set(1 + f * 0.1);
      if (f > lastFlash) { waves.push({ r: 1, a: 1 }); waves.push({ r: 0.86, a: 0.8 }); if (!reduce) for (var si = 0; si < 10; si++) { var sa = Math.random() * Math.PI * 2, sp = new PIXI.Sprite(SPARK); sp.anchor.set(0.5); sp.position.set(Math.cos(sa) * LR * 0.8, Math.sin(sa) * LR * 0.8); sp.tint = si % 2 ? 0x9ff0ff : 0xffffff; launch.addChild(sp); sparks.push({ s: sp, vx: Math.cos(sa) * 4, vy: Math.sin(sa) * 4 - 0.5, life: 1 }); } }
      lastFlash = f;
      for (var sj = sparks.length - 1; sj >= 0; sj--) { var sk = sparks[sj]; sk.s.x += sk.vx * dt / 16; sk.s.y += sk.vy * dt / 16; sk.vy += 0.1 * dt / 16; sk.life -= dt / 420; sk.s.alpha = Math.max(0, sk.life); sk.s.scale.set(0.5 + sk.life); if (sk.life <= 0) { sk.s.destroy(); sparks.splice(sj, 1); } }
      shock.clear();
      for (var wi = waves.length - 1; wi >= 0; wi--) {
        var wv = waves[wi]; wv.r += dt * 0.0035; wv.a -= dt / 520;
        if (wv.a <= 0) { waves.splice(wi, 1); continue; }
        var pts = []; for (var wk = 0; wk < 6; wk++) pts.push(HEXV[wk][0] * wv.r, LDEPTH + (HEXV[wk][1] - LDEPTH) * wv.r);
        shock.poly(pts).stroke({ width: 3, color: 0xff4fd8, alpha: wv.a * 0.9 });
      }
      neon.clear();
      if (!off) {
        tracePos += dt * (busy ? 0.0011 : 0.00022);
        var runs = busy && !reduce ? [0, 0.5] : [0];
        runs.forEach(function (o) {
          var head = hexAt(tracePos + o), tail = hexAt(tracePos + o - 0.11), mid = hexAt(tracePos + o - 0.055);
          neon.moveTo(tail[0], tail[1]).lineTo(mid[0], mid[1]).stroke({ width: 3, color: 0xff4fd8, alpha: 0.35 });
          neon.moveTo(mid[0], mid[1]).lineTo(head[0], head[1]).stroke({ width: 3, color: 0xff8fe8, alpha: 0.85 });
          neon.circle(head[0], head[1], 4).fill({ color: 0xffffff, alpha: 0.95 });
        });
        if (busy && !reduce) for (var vk = 0; vk < 6; vk++) neon.circle(HEXV[vk][0], HEXV[vk][1], 3).fill({ color: 0x9ff0ff, alpha: 0.3 + 0.5 * (0.5 + 0.5 * Math.sin(keyT / 120 + vk)) });
      }
      var sp = (keyT % 3600) / 3600;
      capShine.visible = !off && !busy && !reduce && sp > 0.55 && sp < 0.85;
      capShine.x = -LR * 1.4 + LR * 2.8 * Math.max(0, Math.min(1, (sp - 0.55) / 0.3));
    });
    k.deckHit(390 - LR, 130 - LR, LR * 2, LR * 2 + LDEPTH, launch, function () { k.press(); });

    // THRUST: the coin's line bets (D49: seven, however many) as an aircraft throttle: a T-handle on a shaft rising
    // from a gate slot sunk into the console, a detent notch at every option; ▲ ▼ keys below round the readout.
    // Pulled back (low thrust) the handle leans toward the player, pushed forward it stands up over the slot.
    var SLX = 93, N = LADDER.length - 1, STEP = 180 / N;   // the slot's centre line; the detents from y 214 up to 34, however many
    var thr = new PIXI.Container(); thr.position.set(556, 12); deck.addChild(thr);
    var thrHead = txt(k.HAS_LINES ? T.bet + " · PER LINE" : T.bet, { fontSize: k.HAS_LINES ? 12 : 14, fill: "#b9a6ff", letterSpacing: 2 }); thrHead.position.set(66, 12); thr.addChild(thrHead);
    var slot = k.recess(12, 200, 6); slot.position.set(SLX - 10, 22); thr.addChild(slot);
    var slotFill = paint(6, 190, function (g) { rr(g, 0, 0, 6, 190, 3); g.fillStyle = grad(g, 0, 190, ["#ff4fd8", "#6a1fb8"]); g.globalAlpha = 0.9; g.fill(); });
    slotFill.position.set(SLX - 3, 31); thr.addChild(slotFill);
    var detents = new PIXI.Graphics();
    LADDER.forEach(function (v, i) { var y = 214 - i * STEP; detents.moveTo(SLX + 10, y).lineTo(SLX + 18, y).moveTo(SLX - 18, y).lineTo(SLX - 10, y); });
    detents.stroke({ width: 2, color: 0x9a86e0, alpha: 0.7 }); thr.addChild(detents);
    var thrMarks = LADDER.map(function (v, i) {
      var y = 214 - i * STEP, m = txt(String(v), { fontFamily: k.MONO, fontWeight: "700", fontSize: STEP < 20 ? 12 : 13, fill: "#8f86b8" });
      m.anchor.set(1, 0.5); m.position.set(SLX - 24, y); thr.addChild(m);
      k.deckHit(556 + 4, 12 + y - STEP / 2, 120, STEP, null, function () { k.setBet(v); });
      return m;
    });
    // The lever: a collar in the slot, a shaft, and the T-handle (a ribbed grip with glowing end caps).
    var thrKnob = new PIXI.Container(); thrKnob.x = SLX; thr.addChild(thrKnob);
    var leverShadow = new PIXI.Graphics(), leverShaft = new PIXI.Graphics(); thrKnob.addChild(leverShadow, leverShaft);
    var collar = paint(26, 14, function (g) { g.beginPath(); g.ellipse(13, 7, 11, 5.5, 0, 0, Math.PI * 2); g.fillStyle = grad(g, 2, 12, ["#cdbcff", "#4b3a8a"]); g.fill(); });
    collar.anchor.set(0.5); thrKnob.addChild(collar);
    var grip = paint(60, 30, function (g) {
      g.shadowColor = "rgba(0,0,0,.6)"; g.shadowBlur = 6; g.shadowOffsetY = 4;
      rr(g, 7, 6, 46, 16, 8); g.fillStyle = grad(g, 6, 22, ["#f4efff", "#b9a6ff", "#5a3fb0"]); g.fill(); g.shadowBlur = 0; g.shadowOffsetY = 0;
      g.strokeStyle = "rgba(60,30,120,.45)"; g.lineWidth = 1.2;                                   // ribs
      for (var x = 17; x <= 43; x += 4) { g.beginPath(); g.moveTo(x, 8); g.lineTo(x, 20); g.stroke(); }
      [[7, "#ff4fd8"], [47, "#ff4fd8"]].forEach(function (c) {                                    // glowing end caps
        rr(g, c[0], 6, 6, 16, 3); g.fillStyle = c[1]; g.shadowColor = c[1]; g.shadowBlur = 8; g.fill(); g.shadowBlur = 0;
      });
      g.strokeStyle = "rgba(255,255,255,.7)"; g.lineWidth = 1; g.beginPath(); g.moveTo(14, 8.5); g.lineTo(46, 8.5); g.stroke();   // highlight
    });
    grip.anchor.set(0.5, 0.47); thrKnob.addChild(grip);
    function drawLever(i) {   // i: 0 (1 sat, pulled back) .. N (the top stop, pushed forward)
      var reach = 24 - 14 * (i / N);   // how far the handle leans toward the player
      leverShadow.clear().roundRect(-3, 2, 6, reach + 4, 3).fill({ color: 0x000000, alpha: 0.35 });
      leverShaft.clear().roundRect(-3, 0, 6, reach, 3).fill(0xbfb3e6).roundRect(-3, 0, 2, reach, 1).fill({ color: 0xffffff, alpha: 0.6 });
      grip.y = reach; grip.scale.y = 0.85 + 0.15 * (1 - i / N);
    }
    drawLever(3);
    var betVal = txt("", { fontFamily: k.MONO, fontWeight: "700", fontSize: 17, fill: "#fff" }); betVal.position.set(70, 270); thr.addChild(betVal);
    function smallKey(label, x) {
      var kk = new PIXI.Container(); kk.position.set(x, 270);
      var art = k.keyArt(34, 26, 7, 7, ["#8a6cff", "#4b2fa8"], ["#2c1a66", "#160a36"]); art.anchor.set(0.5, 0.4); kk.addChild(art);
      var top = new PIXI.Container(); var t = txt(label, { fontSize: 15, fill: "#fff" }); t.y = -1; top.addChild(t); kk.addChild(top);
      kk._sink = function () { k.sinkKey(function (v) { art.y = v; top.y = v; }, 5); };
      thr.addChild(kk);
      return kk;
    }
    var betDown = smallKey("▼", 16), betUp = smallKey("▲", 124);
    // Drag the lever: it follows the hand along the slot, clicking into each detent (the bet changes there), and
    // settles on the nearest one when let go.
    function leverAt(fi) { thrKnob.y = 214 - fi * STEP; thrKnob._fi = fi; drawLever(fi); slotFill.height = Math.max(4, 221 - thrKnob.y); slotFill.y = thrKnob.y; }
    var dragging = false;
    k.deckDrag(556 + SLX - 46, 12 + 18, 92, 214, {
      start: function () { dragging = true; },
      move: function (d) {
        if (!dragging) return;
        var fi = Math.max(0, Math.min(N, (214 - (d.y - 12)) / STEP)), i = Math.round(fi);
        leverAt(fi);
        if (i !== thrKnob._i) k.setBet(LADDER[i]);
      },
      end: function () { dragging = false; if (thrKnob._i != null) k.setBet(LADDER[thrKnob._i]); }
    });
    k.deckHit(556 - 2, 12 + 254, 40, 34, betDown, function () { betDown._sink(); k.stepBet(-1); });
    k.deckHit(556 + 106, 12 + 254, 40, 34, betUp, function () { betUp._sink(); k.stepBet(1); });
    // LINES: three console keys under the LAUNCH hex, the chosen one in the cap's magenta
    k.linesKeys(390, 274, { labelFill: "#b9a6ff", off: [["#8a6cff", "#4b2fa8"], ["#2c1a66", "#160a36"], "#ffffff"], on: [["#ffc4f4", "#e040c8"], ["#7a1a8a", "#3a0848"], "#ffffff"] });

    return {
      win: win, bal: bal, key: launch,
      setBet: function (bet, i) {
        thrMarks.forEach(function (m, j) { m.style.fill = j === i ? "#ffffff" : "#8f86b8"; });
        if (dragging) { thrKnob._i = i; betVal.text = String(bet); return; }
        k.animate(k.R(220), (function (from, fromI) { return function (p) {
          thrKnob.y = from + (214 - i * STEP - from) * p; drawLever(fromI + (i - fromI) * p);
          slotFill.height = Math.max(4, 221 - thrKnob.y); slotFill.y = thrKnob.y;
        }; })(thrKnob.y || 214, thrKnob._fi != null ? thrKnob._fi : thrKnob._i == null ? i : thrKnob._i));
        thrKnob._i = i; thrKnob._fi = null;
        betVal.text = String(bet);   // like the lever marks: 1000, not 1,000
        betVal.scale.set(betVal.width > 60 ? 60 / betVal.width * betVal.scale.x : 1);
      },
      update: function (s) {
        launchSub.text = s.sub;
        [betUp, betDown].forEach(function (b) { k.setOff(b, s.busy); });
        thrMarks.forEach(function (m) { m.alpha = s.busy ? 0.55 : 1; });
      },
      points: function () { return { spin: [390, 130], betUp: [556 + 124, 12 + 270], dragFrom: [556 + SLX, 12 + 214 - 2 * STEP], dragTo: [556 + SLX, 12 + 214 - 5 * STEP] }; }   // the lever at the 3rd detent, dragged to the 6th
    };
  }

  /* ═══ Bonus: the Warp Ladder ═══ */
  function bonus(k, st) {
    var BON = k.BON, PIXI_ = PIXI, txt = k.txt;
    return new Promise(function (resolve) {
      var lv = BON.levels, ui = k.openStage("🛰️ " + BON.name.toUpperCase(), "Ignite the engines and climb!");
      var stage = ui.root;
      var rows = lv.map(function (v, i) {
        var y = 860 - i * 62, c = new PIXI_.Container(); c.position.set(330, y);
        var bg = new PIXI_.Graphics(); c.addChild(bg);
        var n = txt(String(i + 1), { fontSize: 18, fill: "#8f86b8" }); n.position.set(-210, 0);
        var t = txt(k.fmt(v) + "×", { fontSize: 26, fill: "#ffd166" }); t.position.set(-40, 0);
        var s = txt("≈ " + k.amt(Math.floor(k.playBet() * v * k.S)), { fontFamily: k.MONO, fontSize: 15, fill: "#8f86b8" }); s.anchor.set(1, 0.5); s.position.set(220, 0);
        c.addChild(n, t, s); stage.addChild(c);
        return { c: c, bg: bg };
      });
      var rocket = new PIXI_.Sprite(k.emojiTex("🚀", 90)); rocket.anchor.set(0.5); rocket.position.set(640, 860); rocket.rotation = -Math.PI / 4; stage.addChild(rocket);
      var level = 0;
      function mark(fail) {
        rows.forEach(function (r, i) {
          r.bg.clear().roundRect(-230, -26, 460, 52, 12).fill(i === level ? (fail ? 0x7a0d17 : 0x6a2fe0) : i < level ? 0x163a2a : 0x0c0826)
            .stroke({ width: 2, color: i === level ? 0xffffff : 0x4b3a8a });
        });
      }
      mark();
      var started = false;
      var go = k.stageButton("IGNITE", 960, run);
      k._stageGo = run;
      async function run() {
        if (started) return; started = true; k.setOff(go, true); k._stageGo = null;
        var boosts = st.boosts || [];
        for (var j = 0; j < boosts.length; j++) {
          ui.sub.text = "Boosting to level " + (level + 2) + "…";
          await k.animate(k.R(700), function (p) { rocket.x = 640 + Math.sin(p * 40) * 3; }, k.ease.lin);
          if (boosts[j]) {
            level++; mark(); k.sfx.ladderUp(level);
            var y0 = rocket.y; await k.animate(k.R(350), function (p) { rocket.y = y0 - 62 * p; });
            ui.sub.text = "Level " + (level + 1) + ": " + k.fmt(lv[level]) + "×!";
            k.emit(10, rocket.x, rocket.y + 30, { power: 8, cone: 3 });
          } else {
            mark(true); k.sfx.ladderFail(); k.shake(k.R(400), 8);
            ui.sub.text = "Engines cut out at level " + (level + 1) + ": " + k.fmt(lv[level]) + "×";
            await k.sleep(k.R(900)); return resolve();
          }
        }
        ui.sub.text = "TOP OF THE LADDER! " + k.fmt(lv[level]) + "×";
        await k.sleep(k.R(900)); resolve();
      }
      setTimeout(function () { if (!started) run(); }, k.reduce ? 1500 : 12000);
    });
  }

  /* ═══ A jackpot won in the game: 3 🌠, then the Star Map Wheel ═══ */
  async function jackpot(k, st) {
    var JPC = k.JPC;
    k.setLcd(st.cells.length + " " + JPC.emoji + " shooting stars! The " + JPC.name + " spins.", true);
    await k.sleep(k.R(1700));
    var ui = k.openStage("🌠 " + JPC.name.toUpperCase(), "Spin the wheel for your jackpot!");
    var cols = { minor: "#1f6fb2", major: "#7b3fe4", grand: "#e0313f" };
    var idx = st.slice != null ? st.slice : JPC.slices.indexOf(st.tier);
    await k.wheel({
      labels: JPC.slices.map(function (t) { return k.TIER_NAMES[t]; }), fills: JPC.slices.map(function (t) { return cols[t]; }),
      line: "#9ff0ff", rim: T.neon, bg: "#120a2e", glow: T.neon2, hub: "🌠", turning: "The stars are turning…",
      done: function () { return "The wheel stops on the " + k.TIER_NAMES[st.tier] + " JACKPOT!"; }
    }, idx, ui);
  }

  /* ═══ Free spins weather: hyperspace. Stars streak across the reel window, faster the nearer they are ═══ */
  function featureFx(k, layer) {
    var PIXI = k.PIXI, RX = k.RX, RY = k.RY, RW = k.RW, RH = k.RH, ps = [];
    var STREAK = k.texOf(64, 4, function (g) { g.fillStyle = k.hgrad(g, 0, 64, ["rgba(255,255,255,0)", "rgba(230,251,255,.9)", "#ffffff"]); g.fillRect(0, 0, 64, 4); });
    var STAR = k.texOf(8, 8, function (g) { var rg = g.createRadialGradient(4, 4, 0.5, 4, 4, 4); rg.addColorStop(0, "#ffffff"); rg.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = rg; g.fillRect(0, 0, 8, 8); });
    var TINT = [0xffffff, 0x9ff0ff, 0xffe6ff, 0xffd166];
    return {
      tick: function (dt, t, on) {
        if (on && ps.length < 40 && Math.random() < 0.6 * dt) {
          var near = Math.random(), s = new PIXI.Sprite(near > 0.75 ? STREAK : STAR); s.anchor.set(1, 0.5);
          s.position.set(RX + RW + 70, RY + Math.random() * RH); s.tint = TINT[Math.floor(Math.random() * TINT.length)];
          s.scale.set(near > 0.75 ? 0.8 + near : 0.5 + near, near > 0.75 ? 0.8 : 0.5 + near); s.alpha = 0.35 + near * 0.6;
          layer.addChild(s); ps.push({ s: s, vx: 3 + near * 11 });
        }
        for (var i = ps.length - 1; i >= 0; i--) {
          var p = ps[i]; p.s.x -= p.vx * dt;
          if (p.s.x < RX - 10) { p.s.destroy(); ps.splice(i, 1); }
        }
      },
      clear: function () { ps.forEach(function (p) { p.s.destroy(); }); ps = []; }
    };
  }

  window.TNC_PixiMachine.skin("cosmic", {
    theme: theme, cabinet: cabinet, collector: collector, cellDeco: cellDeco, featureFx: featureFx, base: base, surface: surface, deck: deck, bonus: bonus, jackpot: jackpot
  });
})();
