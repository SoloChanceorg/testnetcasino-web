/*
 * TestnetCasino.com: Deep Sea Treasure on the PixiJS engine (pixi-machine.js).
 *
 * A submarine: a riveted hull with a brass nameplate and rising bubbles, the reels behind a bolted
 * porthole, the Treasure Chest beside them (gold coins pile up in it as players fill it), a sonar
 * display, and a diamond-plate console with the BET DIAL (a rotary knob), the DIVE key and the WIN
 * and BALANCE gauges. The Ship's Wheel bonus, the Magic Oyster's clams for a jackpot won in the game
 * and the Treasure Hold & Win.
 */
(function () {
  "use strict";
  if (!window.TNC_PixiMachine) return;
  var PIXI = window.PIXI;
  var BRASS = ["#fff1c4", "#d4a94a", "#8a6a1c"];

  var theme = {
    title: "DEEP SEA TREASURE", spin: "DIVE", bet: "BET DIAL", lower: "Turn the dial down", fsShort: "Rising Tide",
    neon: "#d4a94a", neon2: "#2ec5ff", text: "#d8f3ff", accent: "#ffd166", featY: 258,
    burst: ["💎", "🐚", "🐠", "🦪", "🪙"],
    quips: ["Only seaweed down here…", "The current carried it away.", "Nothing in this net.", "Dive again!"],
    welcome: "Welcome aboard, diver! Turn the dial and press DIVE", twist: "RISING TIDE",
    jp: { major: ["#3a1a4a", "#1c0a26", "#c86bff", "#e8c8ff", "#f0dcff"], minor: ["#06323f", "#031c24", "#2ec5ff", "#a8ecff", "#c8f4ff"] },
    feat: { fill: "rgba(2,24,36,.6)", stroke: "rgba(212,169,74,.65)", text: "#d8f3ff", hot: ["#fff1c4", "#ffd166"], hotStroke: "#fff6dc", hotText: "#2a1c02" },
    fs: { color: 0x3dd9a4, fill: 0x2ec5ff, fillAlpha: 0.13, bulb: 0xcffff0 },   // free spins: the rising tide, sea-green frame
    reel: { strip: ["#b5d9e3", "#e0f3f7", "#f7fdff"], shade: "4,30,48", divider: ["#2a1d05", "#b8902f", "#fff1c4", "#7a5a14"],
      inner: "rgba(2,14,26,.9)", rim: "rgba(255,225,150,.6)", symShadow: "rgba(0,40,60,.3)", fixed: 0xeafcff },
    lcd: { text: "#7dffd8", glow: "#18c9a0", hot: "#ffe79a", sub: "#7fc4b8",
      frame: function (g, w, h) {   // a sonar screen in a brass bezel
        g.beginPath(); g.roundRect(0, 0, w, h, 12);
        var b = g.createLinearGradient(0, 0, 0, h); b.addColorStop(0, BRASS[0]); b.addColorStop(0.4, BRASS[1]); b.addColorStop(1, BRASS[2]); g.fillStyle = b; g.fill();
        g.beginPath(); g.roundRect(6, 6, w - 12, h - 12, 8); g.fillStyle = "#03181e"; g.fill();
        g.save(); g.clip();
        g.strokeStyle = "rgba(24,201,160,.14)"; g.lineWidth = 1;
        for (var r = 30; r < 260; r += 30) { g.beginPath(); g.arc(70, h / 2, r, 0, Math.PI * 2); g.stroke(); }
        for (var x = 20; x < w; x += 40) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
        g.restore();
        [[12, 12], [w - 12, 12], [12, h - 12], [w - 12, h - 12]].forEach(function (p) { g.beginPath(); g.arc(p[0], p[1], 2.5, 0, Math.PI * 2); g.fillStyle = "#5a440f"; g.fill(); });
      } },
    hint: "#bfe9ff",
    recess: { glass: "#021a22", glow: "rgba(46,197,255,.35)", rim: "rgba(212,169,74,.75)" },
    readout: { label: "#ffd98a", value: "#e8fbff", glow: "#2ec5ff", unit: "#8fb8c8" },
    bannerBg: 0x021624, collectGlow: "#ffe79a",
    stage: { glow: "#2ec5ff", bg: ["#0b4a6a", "#021220"], stroke: "#d4a94a", sub: "#9ff0ff", button: ["#ffcf5a", "#c06a00", "#fff1c4"] }
  };
  var T = theme;
  function brass(g, y0, y1) { var b = g.createLinearGradient(0, y0, 0, y1); b.addColorStop(0, BRASS[0]); b.addColorStop(0.45, BRASS[1]); b.addColorStop(1, BRASS[2]); return b; }
  function rivet(g, x, y, r) {
    g.beginPath(); g.arc(x, y + 0.8, r, 0, Math.PI * 2); g.fillStyle = "rgba(0,0,0,.45)"; g.fill();
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); var rg = g.createRadialGradient(x - r / 3, y - r / 3, 0.5, x, y, r); rg.addColorStop(0, "#d8eef5"); rg.addColorStop(1, "#4f7686"); g.fillStyle = rg; g.fill();
  }

  /* ═══ Cabinet: the hull, the nameplate, the porthole, bubbles ═══ */
  function cabinet(k) {
    var W = k.W, FY = k.FY, rr = k.rr;
    k.L.cabinet.addChild(k.paint(W - 20, FY - 140 + 2, function (g, w, h) {
      function outline() { g.beginPath(); g.moveTo(6, h); g.lineTo(6, 70); g.quadraticCurveTo(6, 6, 70, 6); g.lineTo(w - 70, 6); g.quadraticCurveTo(w - 6, 6, w - 6, 70); g.lineTo(w - 6, h); }
      outline(); g.closePath(); g.shadowColor = "rgba(46,197,255,.55)"; g.shadowBlur = 26;
      g.fillStyle = k.grad(g, 0, h, ["#1d5a72", "#0e3a4e", "#07202c"]); g.fill(); g.shadowBlur = 0;
      g.save(); g.clip();
      var sh = g.createLinearGradient(0, 0, w, 0); sh.addColorStop(0, "rgba(0,0,0,.4)"); sh.addColorStop(0.15, "rgba(255,255,255,.04)"); sh.addColorStop(0.5, "rgba(255,255,255,.07)"); sh.addColorStop(0.85, "rgba(255,255,255,.02)"); sh.addColorStop(1, "rgba(0,0,0,.4)");
      g.fillStyle = sh; g.fillRect(0, 0, w, h);
      [120, 300, 470].forEach(function (y) {                                       // plate seams with rivet rows
        g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(0, y, w, 2); g.fillStyle = "rgba(160,220,240,.12)"; g.fillRect(0, y + 2, w, 1);
        for (var x = 22; x < w - 10; x += 34) rivet(g, x, y - 7, 2.6);
      });
      for (var y = 90; y < h; y += 40) { rivet(g, 18, y, 2.6); rivet(g, w - 18, y, 2.6); }
      g.restore();
      outline(); g.lineWidth = 3.5; g.strokeStyle = T.neon; g.stroke();
    })).position.set(10, 140);
    // The brass nameplate with the title, screwed to the hull
    var plate = k.paint(560, 62, function (g, w, h) {
      g.shadowColor = "rgba(0,0,0,.6)"; g.shadowBlur = 10; g.shadowOffsetY = 4; rr(g, 3, 3, w - 6, h - 6, 12); g.fillStyle = brass(g, 0, h); g.fill();
      g.shadowBlur = 0; g.shadowOffsetY = 0; g.lineWidth = 2; g.strokeStyle = "#5a440f"; g.stroke();
      rr(g, 9, 9, w - 18, h - 18, 8); g.lineWidth = 1.2; g.strokeStyle = "rgba(90,68,15,.6)"; g.stroke();
      [[18, h / 2], [w - 18, h / 2]].forEach(function (p) {
        g.beginPath(); g.arc(p[0], p[1], 5, 0, Math.PI * 2); g.fillStyle = k.grad(g, p[1] - 5, p[1] + 5, ["#fff6dc", "#8a6a1c"]); g.fill();
        g.strokeStyle = "#5a440f"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(p[0] - 3.5, p[1] - 3.5); g.lineTo(p[0] + 3.5, p[1] + 3.5); g.stroke();
      });
    });
    plate.anchor.set(0.5); plate.position.set(W / 2, 200); k.L.cabinet.addChild(plate);
    var title = k.txt(T.title, { fontSize: 34, fill: "#2a1d05", letterSpacing: 2, dropShadow: { color: "#fff6dc", blur: 0, distance: 1.5, angle: Math.PI / 2, alpha: 0.9 } });
    title.position.set(W / 2, 201); if (title.width > 500) title.scale.set(500 / title.width);
    k.L.cabinet.addChild(title);
    // The porthole around the reels: a thick brass frame with bolts
    k.L.cabinet.addChild(k.paint(k.RW + 24, k.RH + 24, function (g, w, h) {
      g.shadowColor = "rgba(46,197,255,.5)"; g.shadowBlur = 16; rr(g, 1, 1, w - 2, h - 2, 18); g.fillStyle = brass(g, 0, h); g.fill(); g.shadowBlur = 0;
      rr(g, 10, 10, w - 20, h - 20, 12); g.fillStyle = "#021018"; g.fill();
      g.lineWidth = 1.5; g.strokeStyle = "rgba(90,68,15,.8)"; g.stroke();
      function bolt(x, y) { g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fillStyle = k.grad(g, y - 3, y + 3, ["#fff6dc", "#6a5010"]); g.fill(); }
      for (var x = 30; x < w - 20; x += 56) { bolt(x, 5.5); bolt(x, h - 5.5); }
      for (var y = 40; y < h - 30; y += 56) { bolt(5.5, y); bolt(w - 5.5, y); }
    })).position.set(k.RX - 12, k.RY - 12);
    // Bubbles rising along the hull's sides
    var bubTex = k.texOf(20, 20, function (g) {
      g.beginPath(); g.arc(10, 10, 8, 0, Math.PI * 2); g.fillStyle = "rgba(180,240,255,.18)"; g.fill(); g.lineWidth = 1.2; g.strokeStyle = "rgba(200,245,255,.7)"; g.stroke();
      g.beginPath(); g.arc(7, 7, 2.2, 0, Math.PI * 2); g.fillStyle = "rgba(255,255,255,.85)"; g.fill();
    });
    var bubbles = [];
    for (var i = 0; i < 12; i++) {
      var b = new PIXI.Sprite(bubTex); b.anchor.set(0.5); k.L.cabinet.addChild(b);
      bubbles.push({ s: b, side: i % 2, ph: Math.random() * Math.PI * 2, v: 0.03 + Math.random() * 0.04, sc: 0.4 + Math.random() * 0.7 });
      b.y = 160 + Math.random() * 560; b.scale.set(bubbles[i].sc);
    }
    k.app.ticker.add(function (tk) {
      if (k.reduce) return;
      bubbles.forEach(function (b) {
        b.s.y -= b.v * tk.deltaMS * (k.busy() ? 2 : 1); b.ph += tk.deltaMS / 500;
        if (b.s.y < 170) { b.s.y = 720; b.sc = 0.4 + Math.random() * 0.7; b.s.scale.set(b.sc); }
        b.s.x = (b.side ? W - 26 : 26) + Math.sin(b.ph) * 4;
        b.s.alpha = Math.min(1, (b.s.y - 170) / 60);
      });
    });
  }

  /* ═══ The collector: the Treasure Chest. The coins and pearls that land stack up in front of the open chest
     into a pyramid, row by row from the rim, each one flying in from the reels and landing with a clink and
     a glint. Full: the pyramid shimmers, a wave runs through it, pearls rise. When the treasure is taken
     (the reward over) it all tumbles back into the chest. ═══ */
  function collector(k, tank) {
    var TW = k.TW, TH = k.TH, rr = k.rr, COL = k.COL, TANK = k.TANK, PIXI = k.PIXI;
    var cx = TW / 2, mouth = TH - 70, chestBot = TH - 20, HALF = 54;
    var panel = k.paint(TW, TH, function (g, w, h) {
      g.shadowColor = "rgba(46,197,255,.45)"; g.shadowBlur = 14; rr(g, 2, 2, w - 4, h - 4, 14); g.fillStyle = brass(g, 0, h); g.fill(); g.shadowBlur = 0;
      rr(g, 8, 36, w - 16, h - 44, 9); g.fillStyle = k.grad(g, 36, h - 8, ["#0b4a6a", "#06283c", "#031522"]); g.fill();
      g.save(); g.clip(); g.globalAlpha = 0.18; g.fillStyle = "#9ff0ff";                     // light from above
      g.beginPath(); g.moveTo(20, 36); g.lineTo(44, 36); g.lineTo(70, h); g.lineTo(30, h); g.fill();
      g.beginPath(); g.moveTo(80, 36); g.lineTo(96, 36); g.lineTo(120, h); g.lineTo(96, h); g.fill();
      g.globalAlpha = 0.5; g.fillStyle = "#1d3b46";                                            // the sea floor
      g.beginPath(); g.ellipse(cx, chestBot + 6, 64, 10, 0, 0, Math.PI * 2); g.fill();
      g.restore();
      rr(g, 8, 36, w - 16, h - 44, 9); g.lineWidth = 1.5; g.strokeStyle = "#5a440f"; g.stroke();
    });
    tank.addChild(panel);
    var name = k.txt(COL ? COL.name.toUpperCase() : "", { fontSize: 11, fill: "#2a1d05", letterSpacing: 0.5 }); name.position.set(TW / 2, 20);
    if (name.width > TW - 16) name.scale.set((TW - 16) / name.width);
    tank.addChild(name);
    // The open lid, behind the treasure, and the dark inside of the chest
    tank.addChild(k.paint(TW, TH, function (g) {
      g.beginPath(); g.moveTo(cx - HALF + 4, mouth); g.lineTo(cx - HALF + 10, mouth - 44); g.lineTo(cx + HALF - 10, mouth - 44); g.lineTo(cx + HALF - 4, mouth); g.closePath();
      g.fillStyle = k.grad(g, mouth - 44, mouth, ["#5b3412", "#3b2109"]); g.fill();
      g.lineWidth = 4; g.strokeStyle = "#d4a94a"; g.stroke();
      g.fillStyle = brass(g, mouth - 30, mouth - 18); g.fillRect(cx - HALF + 8, mouth - 30, HALF * 2 - 16, 5);
      g.fillStyle = "#140903"; g.fillRect(cx - HALF + 6, mouth - 9, HALF * 2 - 12, 9);
    }));
    var glow = k.paint(200, 200, function (g) {
      var rg = g.createRadialGradient(100, 100, 6, 100, 100, 100); rg.addColorStop(0, "rgba(255,230,150,.75)"); rg.addColorStop(0.5, "rgba(255,200,80,.25)"); rg.addColorStop(1, "rgba(255,180,40,0)");
      g.fillStyle = rg; g.fillRect(0, 0, 200, 200);
    });
    glow.anchor.set(0.5); glow.position.set(cx, mouth - 60); glow.alpha = 0; tank.addChild(glow);
    var heap = new PIXI.Container(); tank.addChild(heap);
    // What lands: a gold coin, a pearl (white, rose or blue) or a gem
    var COINTEX = k.texOf(18, 14, function (g) {
      g.beginPath(); g.ellipse(9, 9, 8, 4.5, 0, 0, Math.PI * 2); g.fillStyle = "#7a5a14"; g.fill();
      g.beginPath(); g.ellipse(9, 6.5, 8, 4.5, 0, 0, Math.PI * 2); var cg = g.createLinearGradient(1, 2, 17, 11); cg.addColorStop(0, "#fff1c4"); cg.addColorStop(0.5, "#f5c542"); cg.addColorStop(1, "#b8860b"); g.fillStyle = cg; g.fill();
      g.beginPath(); g.ellipse(9, 6.5, 5, 2.6, 0, 0, Math.PI * 2); g.strokeStyle = "rgba(120,80,10,.5)"; g.lineWidth = 1; g.stroke();
    });
    function pearlTex(c0, c1, c2) {
      return k.texOf(14, 14, function (g) {
        var rg = g.createRadialGradient(5, 4.5, 1, 7, 7, 6.5); rg.addColorStop(0, "#ffffff"); rg.addColorStop(0.35, c0); rg.addColorStop(0.8, c1); rg.addColorStop(1, c2);
        g.beginPath(); g.arc(7, 7, 6.3, 0, Math.PI * 2); g.fillStyle = rg; g.fill();
        g.fillStyle = "rgba(255,255,255,.85)"; g.beginPath(); g.ellipse(5, 4.2, 1.8, 1.1, -0.6, 0, Math.PI * 2); g.fill();
      });
    }
    var PEARL = [pearlTex("#fbf7f2", "#e2d6d8", "#a89aa6"), pearlTex("#fff0f4", "#f0c9d8", "#b9899e"), pearlTex("#eef7ff", "#c9dcf2", "#8aa4c4")];
    function gemTex(c0, c1) {
      return k.texOf(14, 14, function (g) {
        g.beginPath(); g.moveTo(7, 1); g.lineTo(13, 6); g.lineTo(7, 13); g.lineTo(1, 6); g.closePath(); g.fillStyle = k.grad(g, 1, 13, [c0, c1]); g.fill();
        g.fillStyle = "rgba(255,255,255,.6)"; g.beginPath(); g.moveTo(7, 1); g.lineTo(10, 5); g.lineTo(4, 5); g.closePath(); g.fill();
      });
    }
    var GEM = [gemTex("#ff8fa3", "#b0102a"), gemTex("#9dffb0", "#0d8a3a"), gemTex("#9ff0ff", "#1a5fb0")];
    var SPARK = k.texOf(14, 14, function (g) { g.fillStyle = "#fff8d0"; g.beginPath(); g.moveTo(7, 0); g.lineTo(8.6, 5.4); g.lineTo(14, 7); g.lineTo(8.6, 8.6); g.lineTo(7, 14); g.lineTo(5.4, 8.6); g.lineTo(0, 7); g.lineTo(5.4, 5.4); g.closePath(); g.fill(); });
    // The pyramid's slots, row by row from the rim, each row filled from its middle outwards
    var r = (function (seed) { return function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; })(23);
    var items = [];
    for (var row = 0; row < 18; row++) {
      var wN = 9 - Math.floor(row / 2), y = mouth - 6 - row * 10.5, xs = [];
      for (var i = 0; i < wN; i++) xs.push(cx + (i - (wN - 1) / 2) * 12 + (r() - 0.5) * 2.5);
      xs.sort(function (a, b) { return Math.abs(a - cx) - Math.abs(b - cx); });
      xs.forEach(function (x) {
        var q = r(), kind = q < 0.3 ? "pearl" : q < 0.37 ? "gem" : "coin";
        var s = new PIXI.Sprite(kind === "pearl" ? PEARL[Math.floor(r() * 3)] : kind === "gem" ? GEM[Math.floor(r() * 3)] : COINTEX);
        s.anchor.set(0.5, 0.6); s.position.set(x, y + (kind === "coin" ? 0 : -1)); s.visible = false; if (kind === "coin") s.rotation = (r() - 0.5) * 0.3;
        heap.addChild(s);
        items.push({ s: s, x0: x, y0: s.y, row: row, kind: kind, cur: 0, v: 0, ph: r() * 6.3, drop: null, rot: s.rotation });
      });
    }
    var N = items.length;
    // The chest's front, over the treasure inside it (what tumbles back in disappears behind it)
    tank.addChild(k.paint(TW, TH, function (g) {
      rr(g, cx - HALF, mouth, HALF * 2, chestBot - mouth, 6); g.fillStyle = k.grad(g, mouth, chestBot, ["#7a4a22", "#4a2a10"]); g.fill();
      g.lineWidth = 3; g.strokeStyle = "#d4a94a"; g.stroke();
      g.fillStyle = brass(g, mouth, chestBot);
      g.fillRect(cx - HALF, mouth + (chestBot - mouth) * 0.45, HALF * 2, 6); g.fillRect(cx - HALF + 16, mouth, 6, chestBot - mouth); g.fillRect(cx + HALF - 22, mouth, 6, chestBot - mouth);
      rr(g, cx - 9, mouth + 10, 18, 22, 4); g.fillStyle = brass(g, mouth + 10, mouth + 32); g.fill();          // the lock
      g.beginPath(); g.arc(cx, mouth + 19, 3, 0, Math.PI * 2); g.fillStyle = "#2b1606"; g.fill(); g.fillRect(cx - 1.2, mouth + 19, 2.4, 7);
      g.fillStyle = "rgba(0,0,0,.35)"; g.beginPath(); g.ellipse(cx, chestBot + 4, 60, 6, 0, 0, Math.PI * 2); g.fill();
    }));
    var full = k.txt("FULL!", { fontSize: 26, fill: "#ffe79a", dropShadow: { color: "#ffb300", blur: 12, distance: 0, alpha: 1 }, stroke: { color: "#2a1d05", width: 4 } });
    full.position.set(TW / 2, mouth + 26); full.visible = false; tank.addChild(full);

    var t = 0, glowKick = 0, waveT = -10;
    function spring(o, target, kick) { o.v += (target - o.cur) * kick; o.v *= 0.66; o.cur += o.v; }
    k.app.ticker.add(function (tk) {
      var dt = Math.min(50, tk.deltaMS) / 16.67; t += tk.deltaMS / 1000;
      var lvl = TANK.level, isFull = TANK.full, count = Math.min(N, Math.floor(lvl * N + 0.5)), now = performance.now();
      glowKick *= Math.pow(0.93, dt);
      glow.alpha = Math.min(1, glowKick + (isFull ? 0.55 + Math.sin(t * 5) * 0.25 : lvl * 0.25));
      glow.scale.set(0.8 + lvl * 0.4 + (isFull ? Math.sin(t * 5) * 0.08 : 0));
      if (isFull) { waveT += dt * 0.22; if (waveT > 14) waveT = -3; }
      for (var i = 0; i < N; i++) {
        var o = items[i], on = i < count, s = o.s;
        if (o.drop) {   // tumbling back into the chest
          if (now < o.drop.at) continue;
          o.drop.vy += 0.45 * dt; s.y += o.drop.vy * dt; s.x += o.drop.vx * dt; s.rotation += o.drop.vx * 0.1 * dt;
          if (s.y > chestBot - 4) { o.drop = null; o.cur = 0; o.v = 0; s.visible = false; s.position.set(o.x0, o.y0); s.rotation = o.rot; s.scale.set(0); }
          continue;
        }
        if (!on && o.cur > 0.3) { o.drop = { vy: -1.5 - Math.random() * 1.5, vx: (Math.random() - 0.5) * 1.6, at: now + (k.reduce ? 0 : (N - i) * 9) }; continue; }
        if (!on && o.cur < 0.01) { s.visible = false; continue; }
        spring(o, on ? 1 : 0, 0.24); s.visible = o.cur > 0.01;
        s.scale.set(Math.max(0, o.cur));
        var lift = isFull ? Math.max(0, Math.sin(waveT - o.row * 0.45)) * 5 : 0;
        s.y = o.y0 - lift - (o.kind === "pearl" && isFull ? Math.sin(t * 4 + o.ph) * 0.8 : 0);
        s.x = o.x0;
      }
      if (isFull) {
        full.scale.set(1 + Math.sin(t * 7) * 0.06);
        if (Math.random() < 0.25 * dt) { var g0 = items[Math.floor(Math.random() * count)]; if (g0 && g0.s.visible) k.emit(1, k.TX + g0.s.x, k.TY + g0.s.y - 3, { tex: SPARK, power: 0.4, cone: 6.3, g: -0.005, life: 28, spread: 2, spreadY: 2, flip: true, scale: 0.9, spin: 0 }); }
      }
    });
    function slotAt(level) { var o = items[Math.max(0, Math.min(N - 1, Math.floor(level * N)))]; return { x: k.TX + o.x0, y: k.TY + o.y0 }; }
    return {
      count: function () {},   // no numbers: the pyramid itself shows how full it is
      flash: function (on) { full.visible = on; panel.tint = on ? 0xfff0c0 : 0xffffff; },
      target: function () { return { x: k.TX + cx, y: k.TY + mouth - 40 }; },
      // Each coin symbol flies to the next free place on the pyramid; it lands with a clink and a glint, and the heap grows.
      collect: function (items0, o) {
        var n = items0.length;
        return k.flyTo(items0, function (j) { return slotAt(o.from + (o.to - o.from) * (j + 0.5) / n); }, function (j, x, y) {
          glowKick = 0.8;
          k.emit(6, x, y, { tex: SPARK, power: 2.2, cone: 6.3, g: -0.01, life: 36, spread: 8, spreadY: 6, flip: true, scale: 0.8, spin: 0 });
          k.sfx.collectItem(n > 1 ? j / (n - 1) : 0);
          k.levelTo(o.from + (o.to - o.from) * (j + 1) / n, 520);
        }, { arc: 100, shrink: 0.55, turns: 4 });
      },
      // Full: the chest blazes, a wave runs up the pyramid (while it stays full), pearls and glints rise from the treasure.
      full: function () {
        glowKick = 1.6; waveT = -1; var x = k.TX + cx, y = k.TY + mouth - 50;
        k.emit(14, x, y, { tex: PEARL, power: 2.2, cone: 1.6, g: -0.04, life: 150, spread: 80, spreadY: 100, flip: false, spin: 0, scale: 1.1 });
        k.emit(22, x, y, { tex: SPARK, power: 3, cone: 6.3, g: -0.01, life: 70, spread: 100, spreadY: 160, flip: true, scale: 1.2 });
      }
    };
  }

  /* ═══ The console: diamond plate ═══ */
  function base(k, g) {
    var Q = k.Q, BASE_H = k.BASE_H;
    g.beginPath(); g.moveTo(Q[6], 0); g.lineTo(Q[4], 0); g.lineTo(Q[4] - 10, BASE_H); g.lineTo(Q[6] + 10, BASE_H); g.closePath();
    g.fillStyle = k.grad(g, 0, BASE_H, ["#123a4a", "#04141c"]); g.fill();
    g.lineWidth = 3; g.strokeStyle = T.neon; g.shadowColor = "rgba(46,197,255,.6)"; g.shadowBlur = 12;
    g.beginPath(); g.moveTo(Q[6], 0); g.lineTo(Q[6] + 10, BASE_H); g.lineTo(Q[4] - 10, BASE_H); g.lineTo(Q[4], 0); g.stroke();
    g.shadowBlur = 0; g.strokeStyle = "rgba(255,240,200,.35)"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(Q[6] + 4, 1.5); g.lineTo(Q[4] - 4, 1.5); g.stroke();
  }
  function surface(k, g, w, h) {
    g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0); g.lineTo(w, h - 16); g.quadraticCurveTo(w, h, w - 16, h); g.lineTo(16, h); g.quadraticCurveTo(0, h, 0, h - 16); g.closePath();
    g.fillStyle = k.grad(g, 0, h, ["#1d4e60", "#123848", "#0a2430"]); g.fill();
    g.save(); g.clip();
    for (var y = 6, row = 0; y < h; y += 14, row++) {                                     // diamond plate
      for (var x = (row % 2 ? 7 : 0); x < w; x += 14) {
        g.save(); g.translate(x, y); g.rotate(row % 2 ? 0.6 : -0.6);
        g.fillStyle = "rgba(160,220,240,.16)"; g.fillRect(-5, -1.3, 10, 2.6);
        g.fillStyle = "rgba(0,0,0,.22)"; g.fillRect(-5, 1.3, 10, 1.2);
        g.restore();
      }
    }
    var fold = g.createLinearGradient(0, 0, 0, 22);
    fold.addColorStop(0, "rgba(200,240,255,.35)"); fold.addColorStop(0.12, "rgba(200,240,255,.08)"); fold.addColorStop(0.25, "rgba(0,0,0,.35)"); fold.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = fold; g.fillRect(0, 0, w, 22);
    for (var rx = 14; rx < w; rx += 46) { rivet(g, rx, h - 10, 2.6); }
    g.restore();
    g.beginPath(); g.moveTo(1.5, 0); g.lineTo(1.5, h - 16); g.quadraticCurveTo(1.5, h - 1.5, 16, h - 1.5); g.lineTo(w - 16, h - 1.5); g.quadraticCurveTo(w - 1.5, h - 1.5, w - 1.5, h - 16); g.lineTo(w - 1.5, 0);
    g.lineWidth = 3.5; g.strokeStyle = T.neon; g.stroke();
  }

  // The controls: the BET DIAL, the DIVE key, the WIN and BALANCE gauges.
  function deck(k, deck) {
    var paint = k.paint, rr = k.rr, txt = k.txt, LADDER = k.LADDER, reduce = k.reduce;
    var win = k.readout("WIN", 484, 22, { w: 206 }), bal = k.readout("BALANCE", 484, 156, { w: 206 });

    // The BET DIAL: ten stops from 1 (lower left) round to 1,000 (lower right); a ridged brass knob
    // turns to the bet, its value on the glass cap in the middle.
    var DX = 122, DY = 124, LR = 104;
    function ang(i) { return (-135 + i * 30) * Math.PI / 180; }   // 0 = up, clockwise
    var dial = new PIXI.Container(); dial.position.set(DX, DY); deck.addChild(dial);
    var face = paint(240, 240, function (g) {
      var c = 120;
      g.shadowColor = "rgba(0,0,0,.6)"; g.shadowBlur = 12; g.shadowOffsetY = 5;
      g.beginPath(); g.arc(c, c, 92, 0, Math.PI * 2); g.fillStyle = brass(g, c - 92, c + 92); g.fill(); g.shadowBlur = 0; g.shadowOffsetY = 0;
      g.beginPath(); g.arc(c, c, 84, 0, Math.PI * 2); g.fillStyle = "#03181e"; g.fill();
      for (var i = 0; i < LADDER.length; i++) {
        var a = ang(i), sx = Math.sin(a), sy = -Math.cos(a);
        g.lineWidth = 3; g.strokeStyle = "#ffe79a"; g.beginPath(); g.moveTo(c + sx * 72, c + sy * 72); g.lineTo(c + sx * 82, c + sy * 82); g.stroke();
      }
      g.beginPath(); g.arc(c, c, 77, ang(0) - Math.PI / 2, ang(LADDER.length - 1) - Math.PI / 2); g.lineWidth = 2; g.strokeStyle = "rgba(46,197,255,.5)"; g.stroke();
    });
    face.anchor.set(0.5); dial.addChild(face);
    var knob = new PIXI.Container(); dial.addChild(knob);
    var knobArt = paint(140, 140, function (g) {
      var c = 70;
      g.shadowColor = "rgba(0,0,0,.65)"; g.shadowBlur = 10; g.shadowOffsetY = 5;
      g.beginPath();
      for (var i = 0; i <= 48; i++) { var a = i / 48 * Math.PI * 2, r = i % 2 ? 60 : 64; g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r); }   // ridges
      g.closePath(); g.fillStyle = brass(g, c - 64, c + 64); g.fill(); g.shadowBlur = 0; g.shadowOffsetY = 0;
      g.lineWidth = 1; g.strokeStyle = "#5a440f"; g.stroke();
      g.beginPath(); g.arc(c, c, 52, 0, Math.PI * 2); g.fillStyle = k.grad(g, c - 52, c + 52, ["#f7e2a8", "#b8902f"]); g.fill();
      g.beginPath(); g.moveTo(c - 7, c - 64); g.lineTo(c + 7, c - 64); g.lineTo(c, c - 50); g.closePath(); g.fillStyle = "#d7263d"; g.fill();   // the pointer
    });
    knobArt.anchor.set(0.5); knob.addChild(knobArt);
    var capGlass = k.recess(62, 62, 31); capGlass.anchor.set(0.5); dial.addChild(capGlass);   // the glass cap with the value
    var betVal = txt("", { fontFamily: k.MONO, fontWeight: "800", fontSize: 18, fill: "#e8fbff", dropShadow: { color: "#2ec5ff", blur: 8, distance: 0, alpha: 0.9 } }); betVal.y = -4;
    var betUnit = txt(k.SATS, { fontFamily: "Poppins, sans-serif", fontWeight: "700", fontSize: 10, fill: "#8fb8c8" }); betUnit.y = 14;
    dial.addChild(betVal, betUnit);
    var labels = LADDER.map(function (v, i) {
      var a = ang(i), x = Math.sin(a) * LR, y = -Math.cos(a) * LR;
      var l = txt(String(v), { fontFamily: k.MONO, fontWeight: "800", fontSize: 13, fill: "#8fb8c8", dropShadow: { color: "#000", blur: 3, distance: 0, alpha: 0.8 } });
      l.position.set(x, y); dial.addChild(l);
      k.deckHit(DX + x - 22, DY + y - 13, 44, 26, null, function () { k.setBet(v); });
      return l;
    });
    function stepKey(label, x) {
      var kk = new PIXI.Container(); kk.position.set(x, 268);
      var art = k.keyArt(40, 30, 8, 7, ["#ffe79a", "#b8902f"], ["#6a5010", "#3a2a08"]); art.anchor.set(0.5, 0.4); kk.addChild(art);
      var tp = new PIXI.Container(); var t = txt(label, { fontSize: 15, fill: "#2a1d05" }); t.y = -1; tp.addChild(t); kk.addChild(tp);
      kk._sink = function () { k.sinkKey(function (v) { art.y = v; tp.y = v; }, 5); };
      deck.addChild(kk);
      return kk;
    }
    var down = stepKey("◀", 34), up = stepKey("▶", 210);
    var dlabel = txt(T.bet, { fontSize: 13, fill: "#ffd98a", letterSpacing: 2 }); dlabel.position.set(DX, 268); deck.addChild(dlabel);
    k.deckHit(8, 250, 54, 40, down, function () { down._sink(); k.stepBet(-1); });
    k.deckHit(184, 250, 54, 40, up, function () { up._sink(); k.stepBet(1); });

    // DIVE: a round key in a brass collar, amber like a hatch light; it sinks when pressed.
    var DEPTH = 18, KR = 72, KX = 360, KY = 134;
    var key = new PIXI.Container(); key.position.set(KX, KY); deck.addChild(key);
    function circle(g, cx, cy, r) { g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); }
    var well = paint(270, 270, function (g) {
      circle(g, 135, 135 + DEPTH, KR + 18); g.fillStyle = brass(g, 135 - KR, 135 + KR + 30); g.fill();
      circle(g, 135, 135 + DEPTH, KR + 8); g.fillStyle = "#021018"; g.fill();
      g.lineWidth = 3; g.strokeStyle = "rgba(46,197,255,.6)"; g.shadowColor = "#2ec5ff"; g.shadowBlur = 18; circle(g, 135, 135 + DEPTH, KR + 18); g.stroke();
      for (var i = 0; i < 8; i++) { var a = i * Math.PI / 4; rivet(g, 135 + Math.cos(a) * (KR + 13), 135 + DEPTH + Math.sin(a) * (KR + 13), 2.6); }
    });
    well.anchor.set(0.5); key.addChild(well);
    var walls = paint(260, 260, function (g) { for (var d = DEPTH; d >= 0; d--) { circle(g, 130, 130 + d, KR); g.fillStyle = d > DEPTH * 0.55 ? "#6a2a00" : "#a04a00"; g.fill(); } });
    walls.anchor.set(0.5); key.addChild(walls);
    var top = new PIXI.Container(); key.addChild(top);
    var cap = paint(240, 240, function (g) {
      circle(g, 120, 120, KR);
      var rg = g.createRadialGradient(104, 88, 8, 120, 120, 108); rg.addColorStop(0, "#fff2b0"); rg.addColorStop(0.45, "#ffa52a"); rg.addColorStop(1, "#a04a00");
      g.fillStyle = rg; g.fill(); g.lineWidth = 4; g.strokeStyle = "#fff1c4"; g.stroke();
      g.save(); circle(g, 120, 120, KR); g.clip(); g.globalAlpha = 0.35; g.beginPath(); g.ellipse(108, 72, 46, 20, -0.25, 0, Math.PI * 2); g.fillStyle = "#fff"; g.fill(); g.restore();
    });
    cap.anchor.set(0.5); top.addChild(cap);
    var label = txt(T.spin, { fontSize: 30, fill: "#fff", letterSpacing: 2, dropShadow: { color: "#6a2a00", blur: 0, distance: 3, angle: Math.PI / 2, alpha: 1 } }); label.y = -4;
    var sub = txt("", { fontSize: 12, fill: "#fff3dc", letterSpacing: 1.5 }); sub.y = 26;
    top.addChild(label, sub);
    var capMask = paint(240, 240, function (g) { circle(g, 120, 120, KR - 3); g.fillStyle = "#fff"; g.fill(); });
    capMask.anchor.set(0.5); top.addChild(capMask);
    var shine = new PIXI.Graphics().poly([-14, -KR - 20, 22, -KR - 20, 14, KR + 20, -22, KR + 20]).fill({ color: 0xffffff, alpha: 0.5 });
    shine.mask = capMask; top.addChildAt(shine, top.getChildIndex(label));
    var glow = paint(240, 240, function (g) { circle(g, 120, 120, KR - 2); g.fillStyle = "#ffffff"; g.fill(); });
    glow.anchor.set(0.5); glow.blendMode = "add"; glow.alpha = 0; top.addChildAt(glow, 1);
    var ring = k.keyRing(key, { r: KR + 13, y: DEPTH, n: 16, color: 0x9ff0ff, core: "#e8fbff", scale: 0.85 }); key.addChildAt(ring.view, key.getChildIndex(top));
    k.app.ticker.add(function (tk) {
      var dt = Math.min(40, tk.deltaMS);
      top.y = k.keySpring(DEPTH, dt);
      var s = k.keyState(), busy = s.busy, off = s.off, t = s.t;
      glow.alpha = busy && !reduce ? 0.08 + 0.1 * (0.5 + 0.5 * Math.sin(t / 140)) : busy ? 0.1 : 0;
      top.tint = off ? 0x8c8c99 : 0xffffff;
      key.alpha = off ? 0.8 : 1;
      well.alpha = off ? 0.5 : 1;
      ring.update(s); glow.alpha = Math.max(glow.alpha, s.flash * 0.6); label.scale.set(1 + s.flash * 0.08);
      var sp = (t % 3600) / 3600;
      shine.visible = !off && !busy && !reduce && sp > 0.55 && sp < 0.85;
      shine.x = -KR * 1.4 + KR * 2.8 * Math.max(0, Math.min(1, (sp - 0.55) / 0.3));
    });
    k.deckHit(KX - KR, KY - KR, KR * 2, KR * 2 + DEPTH, key, function () { k.press(); });

    return {
      win: win, bal: bal, key: key,
      setBet: function (bet, i) {
        labels.forEach(function (l, j) { l.style.fill = j === i ? "#ffe79a" : "#8fb8c8"; l.scale.set(j === i ? 1.15 : 1); });
        var to = ang(i), from = knob._a == null ? to : knob._a;
        k.animate(k.R(260), function (p) { knob.rotation = from + (to - from) * p; }, k.ease.back);
        knob._a = to;
        betVal.text = String(bet);
        betVal.scale.set(betVal.width > 52 ? 52 / betVal.width * betVal.scale.x : 1);
      },
      update: function (s) {
        sub.text = s.sub;
        [up, down].forEach(function (b) { k.setOff(b, s.busy); });
        labels.forEach(function (l) { l.alpha = s.busy ? 0.55 : 1; });
      },
      points: function () { return { spin: [KX, KY], betUp: [210, 268] }; }
    };
  }

  /* ═══ Bonus: the Ship's Wheel ═══ */
  function bonus(k, st) {
    var BON = k.BON, segs = BON.segments, colors = ["#0a3d62", "#1683c9", "#0b5d8c", "#2ec5ff"];
    var ui = k.openStage("🧭 " + BON.name.toUpperCase(), "Spin the wheel for your prize!");
    function rawSats(v) { return k.amt(Math.floor(k.playBet() * v * k.S)); }
    return k.wheel({
      labels: segs.map(function (v) { return v + "×"; }), fills: segs.map(function (v, i) { return v >= 50 ? "#f5c542" : colors[i % colors.length]; }),
      textFills: segs.map(function (v) { return v >= 50 ? "#3a2a08" : "#fff"; }), font: "20px ", labelAt: 0.74,
      line: "#ffe79a", rim: "#a87a12", bg: "#0a1a2e", glow: "#2ec5ff", hub: "⚓", studs: "#ffe79a", pointer: 0xd7263d,
      handles: 8, handleColor: ["#c98a4b", "#6e421c"], radius: 220, y: 600,
      done: function (i) { return "The wheel stops on " + segs[i] + "×: ≈" + rawSats(segs[i]) + "!"; }
    }, st.index, ui);
  }

  /* ═══ A jackpot won in the game: the Magic Oyster's clams (three alike win that jackpot) ═══ */
  var TIER_COLOR = { grand: ["#ffe1e4", "#ff4d5e", "#8a0d1a"], major: ["#f6e6ff", "#c86bff", "#4b1a7a"], minor: ["#e6fbff", "#2ec5ff", "#0b4a6a"] };
  async function jackpot(k, st) {
    var JPC = k.JPC, tier = st.tier, picks = st.picks || [tier, tier, tier], N = 7, count = { minor: 0, major: 0, grand: 0 };
    k.setLcd(JPC.emoji + " " + JPC.name + "! Open the clams until three match.", true);
    await k.sleep(k.R(1500));
    var ui = k.openStage("🦪 " + JPC.name.toUpperCase(), "Open the clams! Three alike win that jackpot.");
    var stage = ui.root, W = k.W;
    // The tally: three pips per tier
    var tally = {};
    ["grand", "major", "minor"].forEach(function (t, j) {
      var c = new PIXI.Container(); c.position.set(W / 2 - 220 + j * 220, 340);
      var bg = new PIXI.Graphics().roundRect(-100, -30, 200, 60, 14).fill({ color: 0x021220, alpha: 0.7 }).stroke({ width: 2, color: parseInt(TIER_COLOR[t][1].slice(1), 16) });
      var l = k.txt(k.TIER_NAMES[t], { fontSize: 18, fill: TIER_COLOR[t][0] }); l.y = -10;
      c.addChild(bg, l);
      var pips = [0, 1, 2].map(function (q) { var p = new PIXI.Graphics().circle(0, 0, 7).fill({ color: 0xffffff, alpha: 0.15 }); p.position.set(-24 + q * 24, 14); c.addChild(p); return p; });
      stage.addChild(c);
      tally[t] = { c: c, bg: bg, pips: pips };
    });
    function mark(t) {
      var p = tally[t].pips[count[t]++];
      if (p) p.clear().circle(0, 0, 8).fill(parseInt(TIER_COLOR[t][1].slice(1), 16)).stroke({ width: 2, color: 0xffffff });
    }
    function pearl(t) {
      return k.texOf(56, 56, function (g) {
        var c = TIER_COLOR[t], rg = g.createRadialGradient(22, 20, 3, 28, 28, 26); rg.addColorStop(0, c[0]); rg.addColorStop(0.55, c[1]); rg.addColorStop(1, c[2]);
        g.shadowColor = c[1]; g.shadowBlur = 12; g.beginPath(); g.arc(28, 28, 22, 0, Math.PI * 2); g.fillStyle = rg; g.fill();
        g.shadowBlur = 0; g.beginPath(); g.ellipse(21, 19, 7, 4, -0.6, 0, Math.PI * 2); g.fillStyle = "rgba(255,255,255,.75)"; g.fill();
      });
    }
    var shell = k.texOf(132, 112, function (g, w, h) {
      g.shadowColor = "rgba(0,0,0,.5)"; g.shadowBlur = 10; g.shadowOffsetY = 5;
      g.beginPath(); g.ellipse(w / 2, h / 2 + 4, 58, 44, 0, 0, Math.PI * 2); g.fillStyle = k.grad(g, 10, h, ["#f2dcc0", "#b08a64"]); g.fill(); g.shadowBlur = 0; g.shadowOffsetY = 0;
      g.strokeStyle = "rgba(120,80,50,.55)"; g.lineWidth = 2;                                    // ribs of the shell
      for (var i = -3; i <= 3; i++) { g.beginPath(); g.moveTo(w / 2, h / 2 + 44); g.quadraticCurveTo(w / 2 + i * 14, h / 2, w / 2 + i * 18, h / 2 - 34); g.stroke(); }
      g.beginPath(); g.ellipse(w / 2, h / 2 + 4, 58, 44, 0, 0, Math.PI * 2); g.lineWidth = 2.5; g.strokeStyle = "#ffe79a"; g.stroke();
    });
    var openShell = k.texOf(132, 112, function (g, w, h) {
      var cx = w / 2, hy = h / 2 + 8;                                                          // the hinge: the back rim of the base
      // The lid, swung up from the hinge: its outside with ribs, then its pearly inside showing at the rim
      g.shadowColor = "rgba(0,0,0,.45)"; g.shadowBlur = 8; g.shadowOffsetY = 3;
      g.beginPath(); g.ellipse(cx, hy, 57, 46, 0, Math.PI, 0); g.closePath(); g.fillStyle = k.grad(g, hy - 46, hy, ["#f2dcc0", "#b08a64"]); g.fill();
      g.shadowBlur = 0; g.shadowOffsetY = 0;
      g.save(); g.clip(); g.strokeStyle = "rgba(120,80,50,.5)"; g.lineWidth = 2;
      for (var i = -3; i <= 3; i++) { g.beginPath(); g.moveTo(cx, hy + 2); g.quadraticCurveTo(cx + i * 12, hy - 20, cx + i * 19, hy - 48); g.stroke(); }
      g.restore();
      g.beginPath(); g.ellipse(cx, hy, 57, 46, 0, Math.PI, 0); g.lineWidth = 2; g.strokeStyle = "#ffe79a"; g.stroke();
      g.beginPath(); g.ellipse(cx, hy, 48, 12, 0, Math.PI, 0); g.closePath(); g.fillStyle = "#e9c9d6"; g.fill();   // the inside of the lid
      // The base: the bowl, its pink inside and a gold rim, joined to the lid at the hinge
      g.beginPath(); g.ellipse(cx, hy + 10, 58, 28, 0, 0, Math.PI * 2); g.fillStyle = k.grad(g, hy, hy + 40, ["#f8ece0", "#c8a07a"]); g.fill();
      g.beginPath(); g.ellipse(cx, hy + 8, 46, 17, 0, 0, Math.PI * 2); g.fillStyle = "#fbe9ef"; g.fill();
      g.beginPath(); g.ellipse(cx, hy + 10, 58, 28, 0, 0, Math.PI * 2); g.lineWidth = 2; g.strokeStyle = "#ffe79a"; g.stroke();
    });
    var fill = null;
    function fillFor() {
      // What the clams left closed held: the other tiers, at most two of each (never a second set of three).
      var f = [];
      ["minor", "major", "grand"].forEach(function (x) { if (x !== tier) for (var q = count[x]; q < 2; q++) f.push(x); });
      for (var j = f.length - 1; j > 0; j--) { var y = k.rnd(j + 1), tmp = f[j]; f[j] = f[y]; f[y] = tmp; }
      return f;
    }
    k.picksShown = 0;
    await k.pick({
      n: N, cols: 4, dx: 150, dy: 160, x0: W / 2 - 225, y0: 520, shift: 75,
      outcomes: picks, auto: "AUTO OPEN", autoY: 960,
      closed: function () {
        var c = new PIXI.Container(); var s = new PIXI.Sprite(shell); s.anchor.set(0.5); c.addChild(s); c._s = s;
        k.app.ticker.add(function () { if (!c._open && !c.destroyed) c.rotation = Math.sin(performance.now() / 400 + c.x) * 0.04; });
        return c;
      },
      open: function (c, t, kk, last) {
        var ghost = kk < 0;
        if (ghost) { if (!fill) fill = fillFor(); t = fill[(-1 - kk) % Math.max(1, fill.length)] || (tier === "minor" ? "major" : "minor"); }
        c.rotation = 0;
        k.animate(k.R(160), function (p) { c.scale.y = 1 - 0.7 * p; }).then(function () {
          c._s.texture = openShell;
          var p = new PIXI.Sprite(pearl(t)); p.anchor.set(0.5); p.y = 8; c.addChild(p);
          var l = k.txt(k.TIER_NAMES[t], { fontSize: 15, fill: TIER_COLOR[t][0], stroke: { color: "#021220", width: 3 } }); l.y = 48; c.addChild(l);
          if (ghost) c.alpha = 0.45;
          return k.animate(k.R(220), function (q) { c.scale.y = 0.3 + 0.7 * q; }, k.ease.back);
        });
        if (ghost) return;
        k.picksShown++;
        mark(t);
        k.sfx.reveal(t === "grand" ? 25 : t === "major" ? 10 : 3);
        if (!last) { ui.sub.text = k.TIER_NAMES[t] + "! Keep opening…"; return; }
        tally[tier].bg.tint = 0xfff3a0; k.animate(k.R(600), function (q) { tally[tier].c.scale.set(1 + 0.15 * Math.sin(q * Math.PI)); });
        ui.sub.text = "Three " + k.TIER_NAMES[tier] + " pearls: the " + k.TIER_NAMES[tier] + " JACKPOT!";
        k.sfx.collect(); k.emit(30, c.x, c.y, { emoji: true, power: 10 });
      }
    });
  }

  /* ═══ The Treasure Hold & Win: pearls lock on a 5 × 3 board; a new pearl resets the respins ═══ */
  function holdAndWin(k, st, b) {
    var Rw = k.COL.reward, W = k.W, REELS = k.REELS, ROWS = k.ROWS;
    var ui = k.openStage("🪙 " + Rw.name.toUpperCase(), "Pearls lock in place. A new pearl resets the respins.");
    var stage = ui.root, left = Rw.respins, sum = 0;
    var info1 = k.txt("RESPINS " + left, { fontSize: 22, fill: "#ffe79a" }); info1.position.set(W / 2 - 150, 330);
    var info2 = k.txt("BET " + k.fmt(b) + " " + k.SATS, { fontFamily: "Poppins, sans-serif", fontWeight: "700", fontSize: 18, fill: "#9ff0ff" }); info2.position.set(W / 2 + 150, 330);
    stage.addChild(info1, info2);
    var CWB = 112, CHB = 96, GB = 8, x0 = W / 2 - (REELS * CWB + (REELS - 1) * GB) / 2 + CWB / 2, y0 = 430;
    var cellTex = k.texOf(CWB, CHB, function (g, w, h) { k.rr(g, 2, 2, w - 4, h - 4, 12); g.fillStyle = "rgba(2,18,32,.85)"; g.fill(); g.lineWidth = 2; g.strokeStyle = "rgba(46,197,255,.55)"; g.stroke(); });
    var pearlTex = k.texOf(60, 60, function (g) {
      var rg = g.createRadialGradient(24, 22, 3, 30, 30, 26); rg.addColorStop(0, "#ffffff"); rg.addColorStop(0.6, "#dfe8f0"); rg.addColorStop(1, "#8aa0b4");
      g.shadowColor = "#bff6ff"; g.shadowBlur = 12; g.beginPath(); g.arc(30, 30, 22, 0, Math.PI * 2); g.fillStyle = rg; g.fill();
      g.shadowBlur = 0; g.beginPath(); g.ellipse(23, 21, 7, 4, -0.6, 0, Math.PI * 2); g.fillStyle = "rgba(255,255,255,.9)"; g.fill();
    });
    var cells = [];
    for (var r = 0; r < ROWS; r++) for (var c = 0; c < REELS; c++) {
      var s = new PIXI.Sprite(cellTex); s.anchor.set(0.5); s.position.set(x0 + c * (CWB + GB), y0 + r * (CHB + GB)); stage.addChild(s); cells.push(s);
    }
    var totalTxt = k.txt("", { fontFamily: k.MONO, fontWeight: "800", fontSize: 30, fill: "#ffe79a" }); totalTxt.position.set(W / 2, 800); stage.addChild(totalTxt);
    k.pearlsShown = 0;
    function place(p, j) {
      var cell = cells[p.row * REELS + p.reel], v = p.value * b, cont = new PIXI.Container(); cont.position.copyFrom(cell.position);
      var pe = new PIXI.Sprite(pearlTex); pe.anchor.set(0.5); pe.y = -10; if (p.value >= 10) pe.tint = 0xffe08a;
      var t = k.txt(k.amt(Math.round(v)), { fontFamily: k.MONO, fontWeight: "700", fontSize: 13, fill: p.value >= 10 ? "#ffe79a" : "#e8fbff" }); t.y = 32;
      if (t.width > CWB - 10) t.scale.set((CWB - 10) / t.width);
      cont.addChild(pe, t); cont.scale.set(0); stage.addChild(cont);
      setTimeout(function () { k.animate(k.R(380), function (q) { cont.scale.set(q); }, k.ease.back); }, k.reduce ? 0 : j * 120);
      cell.tint = 0x9ff0ff;
      sum += v; k.pearlsShown++;
    }
    function showSum() { totalTxt.text = "≈ " + k.amt(Math.round(sum * k.S)); }
    return (async function () {
      (st.start || []).forEach(place);
      showSum(); k.sfx.reveal(5);
      k.setLcd(Rw.name + ": " + (st.start || []).length + " pearls locked!", true);
      await k.sleep(k.R(1300));
      var respins = st.respins || [];
      for (var i = 0; i < respins.length; i++) {
        left--; info1.text = "RESPINS " + left; k.sfx.spinStart();
        var empty = cells.filter(function (x) { return x.tint === 0xffffff; });
        await k.animate(k.R(700), function (q) { empty.forEach(function (x) { x.alpha = 0.6 + 0.4 * Math.abs(Math.cos(q * Math.PI * 3)); }); }, k.ease.lin);
        empty.forEach(function (x) { x.alpha = 1; });
        var landed = respins[i];
        if (landed.length) {
          landed.forEach(place); showSum();
          left = Rw.respins; info1.text = "RESPINS " + left;
          k.animate(k.R(400), function (q) { info1.scale.set(1 + 0.3 * Math.sin(q * Math.PI)); });
          ui.sub.text = "+" + landed.length + " pearl" + (landed.length > 1 ? "s" : "") + "! Respins back to " + Rw.respins + ".";
          k.sfx.reveal(10);
        } else {
          ui.sub.text = left ? "No new pearl. " + left + " respin" + (left > 1 ? "s" : "") + " left…" : "No respins left.";
          k.sfx.reelStop(2);
        }
        await k.sleep(k.R(600));
      }
      totalTxt.text = k.amt(st.win);
      ui.sub.text = Rw.name + " over: " + k.fmtMult(st.prize) + "× your bet = " + k.amt(st.win);
      await k.sleep(k.R(1100));
    }());
  }

  /* ═══ Free spins weather: the rising tide. Bubbles rise through the reel window and shafts of light sweep across it ═══ */
  function featureFx(k, layer) {
    var PIXI = k.PIXI, RX = k.RX, RY = k.RY, RW = k.RW, RH = k.RH, ps = [];
    var BUB = k.texOf(20, 20, function (g) {
      g.beginPath(); g.arc(10, 10, 8.5, 0, Math.PI * 2); g.strokeStyle = "rgba(230,251,255,.85)"; g.lineWidth = 1.5; g.stroke();
      g.fillStyle = "rgba(255,255,255,.14)"; g.fill(); g.fillStyle = "rgba(255,255,255,.8)"; g.beginPath(); g.ellipse(7, 6.5, 2.4, 1.4, -0.7, 0, Math.PI * 2); g.fill();
    });
    var rays = [0, 1].map(function (i) {
      var s = k.paint(90, RH + 80, function (g, w, h) { g.fillStyle = k.hgrad(g, 0, w, ["rgba(159,240,255,0)", "rgba(159,240,255,.22)", "rgba(159,240,255,0)"]); g.fillRect(0, 0, w, h); });
      s.anchor.set(0.5); s.rotation = 0.35; s.position.set(RX + RW * (0.3 + i * 0.45), RY + RH / 2); s.alpha = 0.9; layer.addChild(s); return { s: s, x0: s.x, ph: i * 2.1 };
    });
    return {
      tick: function (dt, t, on) {
        rays.forEach(function (r) { r.s.x = r.x0 + Math.sin(t * 0.35 + r.ph) * 110; r.s.alpha = 0.6 + Math.sin(t * 0.9 + r.ph) * 0.35; r.s.visible = true; });
        if (on && ps.length < 34 && Math.random() < 0.35 * dt) {
          var s = new PIXI.Sprite(BUB); s.anchor.set(0.5); var sc = 0.3 + Math.random() * 0.8;
          s.position.set(RX + Math.random() * RW, RY + RH + 12); s.scale.set(sc); s.alpha = 0.5 + Math.random() * 0.4;
          layer.addChild(s); ps.push({ s: s, vy: 0.6 + sc * 1.1, ph: Math.random() * 6.3, sw: 0.3 + Math.random() * 0.6 });
        }
        for (var i = ps.length - 1; i >= 0; i--) {
          var p = ps[i]; p.s.y -= p.vy * dt; p.s.x += Math.sin(t * 3 + p.ph) * p.sw * dt;
          if (p.s.y < RY - 12) { p.s.destroy(); ps.splice(i, 1); }
        }
      },
      clear: function () { ps.forEach(function (p) { p.s.destroy(); }); ps = []; rays.forEach(function (r) { r.s.visible = false; }); }
    };
  }

  window.TNC_PixiMachine.skin("deepsea", {
    theme: theme, cabinet: cabinet, collector: collector, featureFx: featureFx, base: base, surface: surface, deck: deck, bonus: bonus, jackpot: jackpot, holdAndWin: holdAndWin
  });
})();
