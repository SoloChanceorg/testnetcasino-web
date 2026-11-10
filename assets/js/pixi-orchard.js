/*
 * TestnetCasino.com: Fruit Orchard on the PixiJS engine (pixi-machine.js).
 *
 * A wooden fruit stand: a striped awning with string lights, the Apple Tree beside the reels (it
 * turns green leaf by leaf as players fill it), a chalkboard display, and a wooden counter with the
 * WIN and BALANCE slates, the round SPIN key (an apple), price tags for the bet and a − / + stepper.
 * The Harvest Pick bonus (baskets) and the Golden Apples jackpot.
 */
(function () {
  "use strict";
  if (!window.TNC_PixiMachine) return;
  var PIXI = window.PIXI;

  var theme = {
    title: "FRUIT ORCHARD", spin: "SPIN", bet: "PRICE TAGS", lower: "Pick a lower price tag", fsShort: "Free spins",
    neon: "#ffd166", neon2: "#ff9f43", text: "#fff1d6", accent: "#ffd166", featY: 266,
    burst: ["🍒", "🍋", "🍊", "🍇", "🍉", "🍃", "🌸"],
    quips: ["No fruit this time.", "The orchard is quiet… spin again!", "Not ripe yet!", "A gentle breeze, nothing more."],
    welcome: "Welcome to the orchard! Pick a price tag and press SPIN", twist: "STICKY WILDS",
    jp: { major: ["#5a2a0a", "#2e1504", "#ff9f43", "#ffd6a8", "#ffe6c8"], minor: ["#1f4a14", "#10260a", "#7ddc5a", "#c8ffb0", "#dcffd0"] },
    feat: { fill: "rgba(43,22,6,.55)", stroke: "rgba(255,214,102,.6)", text: "#fff1d6", hot: ["#fff1c4", "#ffd166"], hotStroke: "#fff6dc", hotText: "#3b2109" },
    reel: { strip: ["#e2d2ae", "#f4ead2", "#fffaf0"], shade: "70,36,8", divider: ["#2b1606", "#b07a40", "#f3e2b8", "#7a4a22"],
      inner: "rgba(40,18,4,.9)", rim: "rgba(255,214,140,.6)", symShadow: "rgba(90,45,10,.3)", fixed: 0xfff4d6 },
    lcd: { text: "#f6f3e8", glow: "rgba(255,255,255,.45)", hot: "#c8ffb0", sub: "#ffd166", font: "Poppins, sans-serif",
      frame: function (g, w, h) {   // a chalkboard in a wooden frame
        g.beginPath(); g.roundRect(0, 0, w, h, 8);
        var wd = g.createLinearGradient(0, 0, 0, h); wd.addColorStop(0, "#a8743a"); wd.addColorStop(1, "#6e421c"); g.fillStyle = wd; g.fill();
        g.beginPath(); g.roundRect(7, 7, w - 14, h - 14, 4);
        var bd = g.createRadialGradient(w * 0.35, h * 0.3, 10, w / 2, h / 2, w * 0.6); bd.addColorStop(0, "#35503f"); bd.addColorStop(1, "#1b2b21");
        g.fillStyle = bd; g.fill();
        g.save(); g.clip(); g.globalAlpha = 0.06; g.strokeStyle = "#fff"; g.lineWidth = 6;   // chalk smudges
        for (var i = 0; i < 5; i++) { g.beginPath(); g.moveTo(40 + i * 130, h * 0.7); g.quadraticCurveTo(90 + i * 130, h * 0.2, 150 + i * 130, h * 0.6); g.stroke(); }
        g.restore();
        g.lineWidth = 1.5; g.strokeStyle = "rgba(0,0,0,.45)"; g.beginPath(); g.roundRect(7, 7, w - 14, h - 14, 4); g.stroke();
      } },
    hint: "#ffe2b0",
    recess: { glass: "#1d2e23", lip: "rgba(255,230,180,.22)", glow: "rgba(255,214,102,.25)", rim: "#a8743a" },
    readout: { label: "#ffd166", value: "#f6f3e8", glow: "rgba(255,255,255,.35)", unit: "#e9d6b0" },
    bannerBg: 0x2b1606, collectGlow: "#b8ff8a",
    stage: { glow: "#ffd166", bg: ["#3f6e2a", "#13240c"], stroke: "#ffd166", sub: "#fff6dc", button: ["#ff6b6b", "#b0102a", "#ffe79a"] }
  };
  var T = theme;

  // Deterministic wood grain (the same planks on every load)
  function seeded(seed) { return function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
  function planks(g, w, h, size, tones, seed, vertical) {
    var r = seeded(seed || 7), n = Math.ceil((vertical ? w : h) / size);
    for (var i = 0; i < n; i++) {
      g.fillStyle = tones[i % tones.length];
      if (vertical) g.fillRect(i * size, 0, size, h); else g.fillRect(0, i * size, w, size);
      g.globalAlpha = 0.18; g.strokeStyle = "#2b1606"; g.lineWidth = 1;
      for (var j = 0; j < 4; j++) {   // grain
        var o = (j + 1) * size / 5 + (r() - 0.5) * 3;
        g.beginPath();
        if (vertical) { g.moveTo(i * size + o, 0); g.bezierCurveTo(i * size + o + 3, h * 0.3, i * size + o - 3, h * 0.7, i * size + o, h); }
        else { g.moveTo(0, i * size + o); g.bezierCurveTo(w * 0.3, i * size + o + 2.5 * (r() - 0.5) * 2, w * 0.7, i * size + o - 2, w, i * size + o); }
        g.stroke();
      }
      g.globalAlpha = 0.25; g.fillStyle = "#000";                       // the gap between two planks
      if (vertical) g.fillRect(i * size, 0, 2, h); else g.fillRect(0, i * size, w, 2);
      g.globalAlpha = 0.12; g.fillStyle = "#fff";
      if (vertical) g.fillRect(i * size + 2, 0, 1, h); else g.fillRect(0, i * size + 2, w, 1);
      g.globalAlpha = 1;
    }
  }
  var WOOD = ["#8a5527", "#7a4a22", "#80502a", "#74461f"];

  /* ═══ Cabinet: the stand, its awning and the title board ═══ */
  function cabinet(k) {
    var W = k.W, FY = k.FY, rr = k.rr;
    // The stand's upper body: wooden boards, a warm gold edge, open at the bottom (the counter follows)
    k.L.cabinet.addChild(k.paint(W - 20, FY - 140 + 2, function (g, w, h) {
      function outline() { g.beginPath(); g.moveTo(6, h); g.lineTo(6, 24); g.quadraticCurveTo(6, 6, 24, 6); g.lineTo(w - 24, 6); g.quadraticCurveTo(w - 6, 6, w - 6, 24); g.lineTo(w - 6, h); }
      outline(); g.closePath(); g.shadowColor = "rgba(255,190,90,.55)"; g.shadowBlur = 24; g.fillStyle = "#7a4a22"; g.fill(); g.shadowBlur = 0;
      g.save(); g.clip(); planks(g, w, h, 36, WOOD, 11, true);
      var sh = g.createLinearGradient(0, 0, w, 0); sh.addColorStop(0, "rgba(0,0,0,.35)"); sh.addColorStop(0.12, "rgba(0,0,0,0)"); sh.addColorStop(0.88, "rgba(0,0,0,0)"); sh.addColorStop(1, "rgba(0,0,0,.35)");
      g.fillStyle = sh; g.fillRect(0, 0, w, h);
      g.restore();
      outline(); g.lineWidth = 3; g.strokeStyle = "#f5c56b"; g.stroke();
    })).position.set(10, 140);
    // The awning: red and cream stripes with a scalloped edge, on a beam with string lights
    var AW = W - 8, STR = 38, n = Math.ceil(AW / STR);
    k.L.cabinet.addChild(k.paint(AW, 74, function (g, w) {
      g.shadowColor = "rgba(0,0,0,.45)"; g.shadowBlur = 10; g.shadowOffsetY = 6;
      g.beginPath(); g.moveTo(0, 12); g.lineTo(w, 12); g.lineTo(w, 46);
      for (var i = n - 1; i >= 0; i--) { var x0 = i * STR; g.arc(x0 + STR / 2, 46, STR / 2, 0, Math.PI); }
      g.closePath(); g.fillStyle = "#fff1d6"; g.fill(); g.shadowBlur = 0; g.shadowOffsetY = 0;
      g.save(); g.clip();
      for (var j = 0; j < n; j += 2) { g.fillStyle = "#d7263d"; g.fillRect(j * STR, 0, STR, 74); }
      var sh = g.createLinearGradient(0, 12, 0, 66); sh.addColorStop(0, "rgba(0,0,0,.28)"); sh.addColorStop(0.35, "rgba(255,255,255,.08)"); sh.addColorStop(1, "rgba(0,0,0,.18)");
      g.fillStyle = sh; g.fillRect(0, 0, w, 74);
      g.restore();
      g.fillStyle = "#4a2a10"; rr(g, 0, 2, w, 14, 4); g.fill();                  // the beam
      g.fillStyle = "rgba(255,255,255,.18)"; g.fillRect(4, 4, w - 8, 2);
    })).position.set(4, 128);
    // String lights along the beam, blinking in two groups (faster while a win plays)
    var bulbs = new PIXI.Container(); k.L.cabinet.addChild(bulbs);
    var BN = 18, onTex = k.texOf(16, 16, function (g) { var rg = g.createRadialGradient(8, 8, 1, 8, 8, 8); rg.addColorStop(0, "#fffbe0"); rg.addColorStop(0.45, "#ffd166"); rg.addColorStop(1, "rgba(255,180,60,0)"); g.fillStyle = rg; g.fillRect(0, 0, 16, 16); });
    var lights = [];
    for (var b = 0; b < BN; b++) {
      var s = new PIXI.Sprite(onTex); s.anchor.set(0.5); s.position.set(20 + b * (W - 40) / (BN - 1), 137); bulbs.addChild(s); lights.push(s);
    }
    var tt = 0;
    k.app.ticker.add(function (tk) {
      tt += tk.deltaMS;
      var fast = k.busy() && k.feature(), per = fast ? 260 : 900, on = Math.floor(tt / per) % 2;
      lights.forEach(function (s, i) { s.alpha = (i % 2) === on ? 1 : 0.35; });
    });
    // The title, painted on a board hanging under the awning
    var title = k.txt(T.title, { fontSize: 44, fill: "#fff6dc", letterSpacing: 3,
      dropShadow: { color: "#ffb347", blur: 14, distance: 0, alpha: 0.9 }, stroke: { color: "#4a2a10", width: 6 } });
    title.position.set(W / 2, 220);
    var cherry = new PIXI.Sprite(k.emojiTex("🍒", 40)); cherry.anchor.set(0.5); cherry.position.set(W / 2 - title.width / 2 - 30, 218);
    var apple = new PIXI.Sprite(k.emojiTex("🍎", 40)); apple.anchor.set(0.5); apple.position.set(W / 2 + title.width / 2 + 30, 218);
    k.L.cabinet.addChild(title, cherry, apple);
    // The reel window: a dark wooden frame with a gold lip
    k.L.cabinet.addChild(k.paint(k.RW + 24, k.RH + 24, function (g, w, h) {
      g.shadowColor = "rgba(0,0,0,.6)"; g.shadowBlur = 14; g.shadowOffsetY = 4; rr(g, 2, 2, w - 4, h - 4, 14);
      g.fillStyle = k.grad(g, 0, h, ["#5b3412", "#3b2109"]); g.fill(); g.shadowBlur = 0; g.shadowOffsetY = 0;
      g.lineWidth = 2; g.strokeStyle = "#ffd166"; rr(g, 9, 9, w - 18, h - 18, 11); g.stroke();
      g.lineWidth = 1.5; g.strokeStyle = "rgba(255,230,180,.35)"; rr(g, 2.5, 2.5, w - 5, h - 5, 14); g.stroke();
    })).position.set(k.RX - 12, k.RY - 12);
  }

  /* ═══ The collector: the Apple Tree (its leaves fill in from the bottom of the crown up) ═══ */
  function collector(k, tank) {
    var TW = k.TW, TH = k.TH, rr = k.rr, COL = k.COL, TANK = k.TANK;
    var panel = k.paint(TW, TH, function (g, w, h) {
      g.shadowColor = "rgba(0,0,0,.6)"; g.shadowBlur = 12; g.shadowOffsetY = 4; rr(g, 2, 2, w - 4, h - 4, 12);
      g.fillStyle = k.grad(g, 0, h, ["#6e421c", "#4a2a10"]); g.fill(); g.shadowBlur = 0; g.shadowOffsetY = 0;
      rr(g, 9, 40, w - 18, h - 84, 8); g.fillStyle = k.grad(g, 40, h - 44, ["#8fd3ff", "#d8f1ff", "#e8f7d0"]); g.fill();
      g.lineWidth = 2; g.strokeStyle = "#ffd166"; g.stroke();
      g.lineWidth = 1.5; g.strokeStyle = "rgba(255,230,180,.35)"; rr(g, 2.5, 2.5, w - 5, h - 5, 12); g.stroke();
    });
    tank.addChild(panel);
    var name = k.txt(COL ? COL.name.toUpperCase() : "", { fontSize: 13, fill: "#ffd166", letterSpacing: 1.5 }); name.position.set(TW / 2, 22); tank.addChild(name);
    var SKY = { x: 9, y: 40, w: TW - 18, h: TH - 84 };
    // The tree: grass, trunk, then the crown (bare outline under, full green over, revealed by the level)
    var cx = TW / 2, crownTop = SKY.y + 14, crownBot = SKY.y + SKY.h * 0.66, trunkBot = SKY.y + SKY.h - 10;
    var blobs = [[0, 0.30, 0.36], [-0.27, 0.45, 0.27], [0.27, 0.45, 0.27], [-0.17, 0.18, 0.25], [0.17, 0.18, 0.25], [0, 0.60, 0.30], [-0.3, 0.68, 0.2], [0.3, 0.68, 0.2]];
    // The crown's own top and bottom: the level fills it from its lowest leaf to its highest.
    var CH0 = crownBot - crownTop, CW0 = SKY.w * 0.92, cMin = Infinity, cMax = -Infinity;
    blobs.forEach(function (b) { var y = crownTop + b[1] * CH0, r = b[2] * CW0 * 0.62; cMin = Math.min(cMin, y - r); cMax = Math.max(cMax, y + r); });
    function crown(g, fill) {
      var ch = crownBot - crownTop, cw = SKY.w * 0.92;
      blobs.forEach(function (b) { g.beginPath(); g.arc(cx + b[0] * cw, crownTop + b[1] * ch, b[2] * cw * 0.62, 0, Math.PI * 2); fill(g, b); });
    }
    tank.addChild(k.paint(TW, TH, function (g, w, h) {
      g.save(); rr(g, SKY.x, SKY.y, SKY.w, SKY.h, 8); g.clip();
      g.fillStyle = "#6fbf4a"; g.beginPath(); g.ellipse(cx, trunkBot + 18, SKY.w * 0.75, 26, 0, 0, Math.PI * 2); g.fill();   // grass
      g.fillStyle = "#5aa83a"; g.beginPath(); g.ellipse(cx - 30, trunkBot + 22, 40, 18, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(cx - 10, trunkBot); g.lineTo(cx - 6, crownBot - 30); g.lineTo(cx - 22, crownBot - 52); g.lineTo(cx - 16, crownBot - 56);   // trunk and two branches
      g.lineTo(cx - 1, crownBot - 36); g.lineTo(cx + 14, crownBot - 60); g.lineTo(cx + 20, crownBot - 56); g.lineTo(cx + 6, crownBot - 30); g.lineTo(cx + 10, trunkBot); g.closePath();
      g.fillStyle = k.hgrad(g, cx - 12, cx + 12, ["#4a2a10", "#7a4a22", "#3b2109"]); g.fill();
      crown(g, function (g) { g.fillStyle = "rgba(255,255,255,.35)"; g.fill(); g.lineWidth = 1.5; g.setLineDash([4, 4]); g.strokeStyle = "rgba(60,120,40,.55)"; g.stroke(); g.setLineDash([]); });
      g.restore();
    }));
    var leaves = k.paint(TW, TH, function (g) {
      crown(g, function (g, b) {
        var rg = g.createRadialGradient(cx + b[0] * SKY.w - 8, crownTop + b[1] * (crownBot - crownTop) - 10, 2, cx + b[0] * SKY.w, crownTop + b[1] * (crownBot - crownTop), b[2] * SKY.w * 0.7);
        rg.addColorStop(0, "#9be36a"); rg.addColorStop(0.6, "#4fae35"); rg.addColorStop(1, "#2f7d22"); g.fillStyle = rg; g.fill();
      });
      var r = seeded(5); g.fillStyle = "rgba(220,255,180,.5)";                                  // leaf highlights
      for (var i = 0; i < 40; i++) { var a = r() * Math.PI * 2, d = r() * (crownBot - crownTop) * 0.45; g.beginPath(); g.ellipse(cx + Math.cos(a) * d, (crownTop + crownBot) / 2 + Math.sin(a) * d * 0.8, 4, 2, a, 0, Math.PI * 2); g.fill(); }
    });
    tank.addChild(leaves);
    var leafMask = new PIXI.Graphics(); tank.addChild(leafMask); leaves.mask = leafMask;
    // Apples on a full tree
    var apples = [[-0.22, 0.35], [0.2, 0.3], [0, 0.55], [-0.28, 0.62], [0.28, 0.6], [0.05, 0.18]].map(function (p) {
      var s = new PIXI.Sprite(k.emojiTex("🍎", 30)); s.anchor.set(0.5); s.position.set(cx + p[0] * SKY.w, crownTop + p[1] * (crownBot - crownTop)); s.visible = false; tank.addChild(s); return s;
    });
    var icon = new PIXI.Sprite(k.emojiTex(COL ? COL.emoji : "🍃", 22)); icon.anchor.set(0.5); icon.position.set(24, TH - 22); tank.addChild(icon);
    var count = k.txt("", { fontFamily: k.MONO, fontWeight: "700", fontSize: 14, fill: "#fff6dc" }); count.position.set(TW / 2 + 8, TH - 22); tank.addChild(count);
    var full = k.txt("FULL!", { fontSize: 26, fill: "#ffe79a", dropShadow: { color: "#ff9f43", blur: 12, distance: 0, alpha: 1 }, stroke: { color: "#4a2a10", width: 4 } });
    full.position.set(TW / 2, crownBot + 30); full.visible = false; tank.addChild(full);
    var wave = 0, shown = -1;
    k.app.ticker.add(function (tk) {
      wave += tk.deltaMS / 400;
      var lvl = TANK.level;
      if (Math.abs(lvl - shown) > 0.0005) {
        shown = lvl;
        var top = cMax - (cMax - cMin) * lvl;
        leafMask.clear().rect(0, top, TW, cMax + 4 - top).fill(0xffffff);
      }
      apples.forEach(function (s, i) { s.visible = TANK.full; if (TANK.full) s.scale.set(1 + Math.sin(wave * 3 + i) * 0.08); });
      if (TANK.full) full.scale.set(1 + Math.sin(wave * 3) * 0.06);
    });
    return {
      count: function (filled, size) { count.text = k.fmt(filled) + " / " + k.fmt(size); },
      flash: function (on) { full.visible = on; panel.tint = on ? 0xfff0c0 : 0xffffff; },
      target: function () { return { x: k.TX + cx, y: k.TY + (crownTop + crownBot) / 2 }; }
    };
  }

  /* ═══ The counter ═══ */
  function base(k, g) {
    var Q = k.Q, BASE_H = k.BASE_H;
    g.beginPath(); g.moveTo(Q[6], 0); g.lineTo(Q[4], 0); g.lineTo(Q[4] - 10, BASE_H); g.lineTo(Q[6] + 10, BASE_H); g.closePath();
    g.fillStyle = k.grad(g, 0, BASE_H, ["#6e421c", "#3b2109"]); g.fill();
    g.lineWidth = 3; g.strokeStyle = "#f5c56b"; g.shadowColor = "rgba(255,190,90,.7)"; g.shadowBlur = 12;
    g.beginPath(); g.moveTo(Q[6], 0); g.lineTo(Q[6] + 10, BASE_H); g.lineTo(Q[4] - 10, BASE_H); g.lineTo(Q[4], 0); g.stroke();
    g.shadowBlur = 0; g.strokeStyle = "rgba(255,240,200,.35)"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(Q[6] + 4, 1.5); g.lineTo(Q[4] - 4, 1.5); g.stroke();
  }
  // The counter top: boards running across, lit where it faces up, the fold's crease, a gold edge.
  function surface(k, g, w, h) {
    g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0); g.lineTo(w, h - 16); g.quadraticCurveTo(w, h, w - 16, h); g.lineTo(16, h); g.quadraticCurveTo(0, h, 0, h - 16); g.closePath();
    g.fillStyle = "#8a5527"; g.fill();
    g.save(); g.clip();
    planks(g, w, h, 42, ["#9a6430", "#8f5a2a", "#a06a34", "#94602d"], 3, false);
    var lit = g.createLinearGradient(0, 0, 0, h); lit.addColorStop(0, "rgba(0,0,0,.05)"); lit.addColorStop(1, "rgba(0,0,0,.3)"); g.fillStyle = lit; g.fillRect(0, 0, w, h);
    var fold = g.createLinearGradient(0, 0, 0, 22);
    fold.addColorStop(0, "rgba(255,230,180,.35)"); fold.addColorStop(0.12, "rgba(255,230,180,.08)"); fold.addColorStop(0.25, "rgba(0,0,0,.35)"); fold.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = fold; g.fillRect(0, 0, w, 22);
    g.restore();
    g.beginPath(); g.moveTo(1.5, 0); g.lineTo(1.5, h - 16); g.quadraticCurveTo(1.5, h - 1.5, 16, h - 1.5); g.lineTo(w - 16, h - 1.5); g.quadraticCurveTo(w - 1.5, h - 1.5, w - 1.5, h - 16); g.lineTo(w - 1.5, 0);
    g.lineWidth = 3; g.strokeStyle = "#f5c56b"; g.stroke();
  }

  // The controls: WIN and BALANCE slates, the SPIN apple, price tags and the − / + stepper.
  function deck(k, deck) {
    var paint = k.paint, rr = k.rr, txt = k.txt, LADDER = k.LADDER, reduce = k.reduce;
    var win = k.readout("WIN", 22, 22), bal = k.readout("BALANCE", 22, 156);

    // SPIN: a big red apple of a key, with a stem and a leaf; it sinks when pressed.
    var DEPTH = 18, KR = 72, KX = 380, KY = 132;
    var key = new PIXI.Container(); key.position.set(KX, KY); deck.addChild(key);
    function circle(g, cx, cy, r) { g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); }
    var well = paint(260, 260, function (g) {
      circle(g, 130, 130 + DEPTH, KR + 14); g.fillStyle = "#2b1606"; g.fill();
      g.lineWidth = 3; g.strokeStyle = "rgba(255,209,102,.7)"; g.shadowColor = "#ffb347"; g.shadowBlur = 20; g.stroke();
    });
    well.anchor.set(0.5); key.addChild(well);
    var walls = paint(260, 260, function (g) {
      for (var d = DEPTH; d >= 0; d--) { circle(g, 130, 130 + d, KR); g.fillStyle = d > DEPTH * 0.55 ? "#5a0a12" : "#8a1020"; g.fill(); }
    });
    walls.anchor.set(0.5); key.addChild(walls);
    var top = new PIXI.Container(); key.addChild(top);
    var cap = paint(240, 240, function (g) {
      circle(g, 120, 120, KR);
      var rg = g.createRadialGradient(100, 86, 8, 120, 120, 108); rg.addColorStop(0, "#ffb3b3"); rg.addColorStop(0.45, "#e8333f"); rg.addColorStop(1, "#7a0d17");
      g.fillStyle = rg; g.fill(); g.lineWidth = 4; g.strokeStyle = "#ffd6d6"; g.stroke();
      g.save(); circle(g, 120, 120, KR); g.clip(); g.globalAlpha = 0.35; g.beginPath(); g.ellipse(104, 74, 44, 20, -0.3, 0, Math.PI * 2); g.fillStyle = "#fff"; g.fill(); g.restore();
      g.lineCap = "round"; g.lineWidth = 6; g.strokeStyle = "#5b3412"; g.beginPath(); g.moveTo(120, 52); g.quadraticCurveTo(122, 40, 130, 32); g.stroke();   // stem
      g.beginPath(); g.ellipse(146, 36, 17, 8, -0.5, 0, Math.PI * 2); g.fillStyle = k.grad(g, 28, 44, ["#9be36a", "#2f7d22"]); g.fill();   // leaf
      g.lineWidth = 1.2; g.strokeStyle = "#1f5a16"; g.beginPath(); g.moveTo(132, 42); g.lineTo(160, 31); g.stroke();
    });
    cap.anchor.set(0.5); top.addChild(cap);
    var label = txt(T.spin, { fontSize: 30, fill: "#fff", letterSpacing: 2, dropShadow: { color: "#5a0a12", blur: 0, distance: 3, angle: Math.PI / 2, alpha: 1 } });
    label.y = -4;
    var sub = txt("", { fontSize: 12, fill: "#ffe6e6", letterSpacing: 1.5 }); sub.y = 26;
    top.addChild(label, sub);
    var capMask = paint(240, 240, function (g) { circle(g, 120, 120, KR - 3); g.fillStyle = "#fff"; g.fill(); });
    capMask.anchor.set(0.5); top.addChild(capMask);
    var shine = new PIXI.Graphics().poly([-14, -KR - 20, 22, -KR - 20, 14, KR + 20, -22, KR + 20]).fill({ color: 0xffffff, alpha: 0.5 });
    shine.mask = capMask; top.addChildAt(shine, top.getChildIndex(label));
    var glow = paint(240, 240, function (g) { circle(g, 120, 120, KR - 2); g.fillStyle = "#ffffff"; g.fill(); });
    glow.anchor.set(0.5); glow.blendMode = "add"; glow.alpha = 0; top.addChildAt(glow, 1);
    k.app.ticker.add(function (tk) {
      var dt = Math.min(40, tk.deltaMS);
      top.y = k.keySpring(DEPTH, dt);
      var s = k.keyState(), busy = s.busy, off = s.off, t = s.t;
      glow.alpha = busy && !reduce ? 0.08 + 0.1 * (0.5 + 0.5 * Math.sin(t / 140)) : busy ? 0.1 : 0;
      top.tint = off ? 0x8c8c99 : 0xffffff;
      key.alpha = off ? 0.8 : 1;
      well.alpha = off ? 0.35 : busy ? 0.9 + 0.1 * Math.sin(t / 140) : 0.75 + Math.sin(t / 600) * 0.25;
      var sp = (t % 3600) / 3600;
      shine.visible = !off && !busy && !reduce && sp > 0.55 && sp < 0.85;
      shine.x = -KR * 1.4 + KR * 2.8 * Math.max(0, Math.min(1, (sp - 0.55) / 0.3));
    });
    k.deckHit(KX - KR, KY - KR - 20, KR * 2, KR * 2 + DEPTH + 20, key, function () { k.press(); });

    // Price tags: the bet ladder on ten paper tags hanging from two rows of nails.
    var BX = 500, TGW = 34, TGH = 50, TGAP = 5;
    var head = txt(T.bet, { fontSize: 14, fill: "#ffd166", letterSpacing: 2, dropShadow: { color: "#2b1606", blur: 0, distance: 2, angle: Math.PI / 2, alpha: 1 } });
    head.position.set(BX + 95, 16); deck.addChild(head);
    function tagTex(active) {
      return k.texOf(TGW + 6, TGH + 14, function (g) {
        g.strokeStyle = "#3b2109"; g.lineWidth = 1.2; g.beginPath(); g.moveTo(TGW / 2 + 3, 0); g.lineTo(TGW / 2 + 3, 14); g.stroke();   // the string
        g.shadowColor = "rgba(0,0,0,.5)"; g.shadowBlur = 5; g.shadowOffsetY = 3;
        g.beginPath(); g.moveTo(3 + 8, 10); g.lineTo(3 + TGW - 8, 10); g.lineTo(3 + TGW, 18); g.lineTo(3 + TGW, 10 + TGH - 4); g.quadraticCurveTo(3 + TGW, 10 + TGH, 3 + TGW - 4, 10 + TGH);
        g.lineTo(7, 10 + TGH); g.quadraticCurveTo(3, 10 + TGH, 3, 10 + TGH - 4); g.lineTo(3, 18); g.closePath();
        g.fillStyle = active ? k.grad(g, 10, 10 + TGH, ["#ffe79a", "#f5c542"]) : k.grad(g, 10, 10 + TGH, ["#fff8e6", "#efdcb4"]); g.fill();
        g.shadowBlur = 0; g.shadowOffsetY = 0; g.lineWidth = 1.5; g.strokeStyle = active ? "#a85d00" : "#a8743a"; g.stroke();
        g.beginPath(); g.arc(TGW / 2 + 3, 18, 2.5, 0, Math.PI * 2); g.fillStyle = "#4a2a10"; g.fill();               // the hole
      });
    }
    var TAG = tagTex(false), TAG_ON = tagTex(true);
    var nails = new PIXI.Graphics();
    var tags = LADDER.map(function (v, i) {
      var row = Math.floor(i / 5), col = i % 5, x = BX + col * (TGW + TGAP), y = 36 + row * 82;
      if (col === 0) nails.roundRect(BX - 4, y - 3, 5 * (TGW + TGAP) + 3, 5, 2).fill({ color: 0x3b2109, alpha: 0.65 });
      nails.circle(x + TGW / 2, y, 2.6).fill(0xd9c08a);
      var t = new PIXI.Container(); t.position.set(x + TGW / 2, y); t.pivot.set(TGW / 2 + 3, 0);
      var s = new PIXI.Sprite(TAG); t.addChild(s);
      var l = txt(String(v), { fontFamily: k.MONO, fontWeight: "800", fontSize: v >= 1000 ? 11 : 13, fill: "#7a0d17" }); l.position.set(TGW / 2 + 3, 10 + TGH / 2 + 5); t.addChild(l);
      t.rotation = (i % 2 ? 1 : -1) * 0.06;
      deck.addChild(t);
      k.deckHit(x - 2, y - 4, TGW + 4, TGH + 14, null, function () { k.setBet(v); });
      return { c: t, s: s, v: v, rest: t.rotation };
    });
    deck.addChildAt(nails, deck.getChildIndex(tags[0].c));
    // The − / + stepper around a chalk slate with the bet
    var SY = 252;
    var cap2 = txt("YOUR BET · tSATS", { fontSize: 11, fill: "#e9d6b0", letterSpacing: 1 }); cap2.position.set(BX + 95, SY - 40); deck.addChild(cap2);
    var slate = k.recess(92, 44, 8); slate.position.set(BX + 95 - 50, SY - 26); deck.addChild(slate);
    var betVal = txt("", { fontFamily: k.MONO, fontWeight: "700", fontSize: 21, fill: "#f6f3e8", dropShadow: { color: "rgba(255,255,255,.35)", blur: 6, distance: 0, alpha: 1 } });
    betVal.position.set(BX + 95, SY - 2); deck.addChild(betVal);
    function crateKey(label, x) {
      var kk = new PIXI.Container(); kk.position.set(x, SY);
      var art = k.keyArt(40, 34, 7, 7, ["#c98a4b", "#8a5527"], ["#5b3412", "#3b2109"]); art.anchor.set(0.5, 0.4); kk.addChild(art);
      var tp = new PIXI.Container(); var t = txt(label, { fontSize: 22, fill: "#fff6dc", dropShadow: { color: "#3b2109", blur: 0, distance: 2, angle: Math.PI / 2, alpha: 1 } }); t.y = -2; tp.addChild(t); kk.addChild(tp);
      kk._sink = function () { k.sinkKey(function (v) { art.y = v; tp.y = v; }, 5); };
      deck.addChild(kk);
      return kk;
    }
    var down = crateKey("−", BX + 12), up = crateKey("+", BX + 178);
    k.deckHit(BX - 12, SY - 22, 48, 44, down, function () { down._sink(); k.stepBet(-1); });
    k.deckHit(BX + 154, SY - 22, 48, 44, up, function () { up._sink(); k.stepBet(1); });

    return {
      win: win, bal: bal, key: key,
      setBet: function (bet, i) {
        tags.forEach(function (t) {
          var on = t.v === bet;
          t.s.texture = on ? TAG_ON : TAG;
          k.animate(k.R(200), (function (t, on, r0) { return function (p) { t.c.rotation = r0 + ((on ? 0 : t.rest) - r0) * p; t.c.scale.set(on ? 1 + 0.08 * p : 1); }; })(t, on, t.c.rotation));
        });
        betVal.text = String(bet);
      },
      update: function (s) {
        sub.text = s.sub;
        [up, down].forEach(function (b) { k.setOff(b, s.busy); });
        tags.forEach(function (t) { t.c.alpha = s.busy ? 0.6 : 1; });
      },
      points: function () { return { spin: [KX, KY], betUp: [BX + 178, SY] }; }
    };
  }

  /* ═══ Bonus: Harvest Pick (baskets; a 🐛 ends the harvest) ═══ */
  function bonus(k, st) {
    var order = st.order || [], picks = st.picks || order.length, n = order.length, total = 0;
    var ui = k.openStage("🧺 HARVEST PICK", "Pick a basket! Find a 🐛 and the harvest ends.");
    var stage = ui.root;
    var totalTxt = k.txt("0×", { fontFamily: k.MONO, fontWeight: "800", fontSize: 30, fill: "#ffe79a", dropShadow: { color: "#2b1606", blur: 6, distance: 0, alpha: 1 } });
    totalTxt.position.set(k.W / 2, 870); stage.addChild(totalTxt);
    function rawSats(v) { return k.amt(Math.floor(k.playBet() * v * k.S)); }
    function fruit(v) { return v >= 15 ? "🍉" : v >= 10 ? "🍇" : v >= 5 ? "🍊" : v >= 2 ? "🍋" : "🍒"; }
    var tile = k.texOf(124, 116, function (g, w, h) {
      g.shadowColor = "rgba(0,0,0,.55)"; g.shadowBlur = 10; g.shadowOffsetY = 5;
      k.rr(g, 4, 4, w - 8, h - 10, 14); g.fillStyle = "#7a4a22"; g.fill(); g.shadowBlur = 0; g.shadowOffsetY = 0;
      g.save(); k.rr(g, 4, 4, w - 8, h - 10, 14); g.clip(); planks(g, w, h, 28, WOOD, 9, false); g.restore();
      k.rr(g, 4, 4, w - 8, h - 10, 14); g.lineWidth = 3; g.strokeStyle = "#ffd166"; g.stroke();
    });
    var opened = k.texOf(124, 116, function (g, w, h) {
      k.rr(g, 4, 4, w - 8, h - 10, 14); g.fillStyle = k.grad(g, 4, h, ["#fff8e6", "#efdcb4"]); g.fill(); g.lineWidth = 3; g.strokeStyle = "#a8743a"; g.stroke();
    });
    var cols = n > 12 ? 5 : 4, dx = cols === 5 ? 130 : 150, dy = 136;
    k.picksShown = 0;
    return k.pick({
      n: n, cols: cols, dx: dx, dy: dy, x0: k.W / 2 - (cols - 1) / 2 * dx, y0: 380,
      outcomes: order.slice(0, picks), auto: "AUTO PICK", autoY: 960,
      closed: function () {
        var c = new PIXI.Container();
        var bg = new PIXI.Sprite(tile); bg.anchor.set(0.5); c.addChild(bg);
        var b = new PIXI.Sprite(k.emojiTex("🧺", 76)); b.anchor.set(0.5); b.y = -4; c.addChild(b);
        c._bg = bg; c._b = b;
        return c;
      },
      open: function (c, v, kk, last) {
        var ghost = kk < 0;
        if (ghost) v = order[picks + (-1 - kk)];
        k.animate(k.R(160), function (p) { c.scale.x = 1 - p; }).then(function () {
          c._bg.texture = opened; c.removeChild(c._b);
          var e = new PIXI.Sprite(k.emojiTex(v === 0 ? "🐛" : fruit(v), 60)); e.anchor.set(0.5); e.y = -14; c.addChild(e);
          var t = k.txt(v === 0 ? (ghost ? "WORM" : "COLLECT") : (ghost ? "" : "+") + k.fmtMult(v) + "×", { fontSize: 18, fill: v === 0 ? "#b0102a" : "#2f7d22" }); t.y = 32; c.addChild(t);
          if (ghost) c.alpha = 0.5;
          return k.animate(k.R(180), function (p) { c.scale.x = p; }, k.ease.back);
        });
        if (ghost) return;
        k.picksShown++;
        if (v === 0) { k.sfx.collect(); ui.sub.text = "A worm! The harvest is in: " + k.fmtMult(total) + "× your bet."; return; }
        total += v;
        totalTxt.text = k.fmtMult(total) + "× ≈ " + rawSats(total);
        k.sfx.reveal(v);
        k.emit(8, c.x, c.y - 20, { emoji: true, power: 7, cone: 2.4 });
        ui.sub.text = last ? "The harvest is in: " + k.fmtMult(total) + "× your bet." : "+" + k.fmtMult(v) + "× (≈" + rawSats(v) + "). Keep picking!";
      }
    });
  }

  /* ═══ A jackpot won in the game: the golden apples (3 MINOR, 4 MAJOR, 5 GRAND) ═══ */
  async function jackpot(k, st) {
    var n = st.cells.length, sprites = k.jpSprites || [];
    k.setLcd(n + " " + k.JPC.emoji + " " + k.JPC.name + ": the " + k.TIER_NAMES[st.tier] + " JACKPOT!", true);
    await k.sleep(k.R(500 + n * 260));
    // The apples ripen one after another: a hop, a golden glow and a few apples flying off each.
    for (var i = 0; i < sprites.length; i++) {
      var s = sprites[i], s0 = s.scale.x, y0 = s.y;
      k.sfx.reveal(3 + i * 3);
      k.emit(6, s.x, s.y, { emoji: true, power: 8, cone: 2.6 });
      await k.animate(k.R(260), (function (s, s0, y0) { return function (p) { s.scale.set(s0 * (1 + 0.35 * Math.sin(p * Math.PI))); s.y = y0 - 18 * Math.sin(p * Math.PI); }; })(s, s0, y0));
    }
    await k.sleep(k.R(700));
  }

  window.TNC_PixiMachine.skin("orchard", {
    theme: theme, cabinet: cabinet, collector: collector, base: base, surface: surface, deck: deck, bonus: bonus, jackpot: jackpot
  });
})();
