/*
 * TestnetCasino.com: Fruit Orchard on the PixiJS engine (pixi-machine.js).
 *
 * A wooden fruit stand: a striped awning with string lights, the Apple Tree beside the reels (it
 * turns green leaf by leaf as players fill it), a chalkboard display, and a wooden counter with the
 * BALANCE, TOTAL BET and WIN slates and a button panel: leaf-green line keys, cream bet keys (the
 * chosen ones gold and lit) and the round SPIN key (an apple).
 * The Harvest Pick bonus (baskets) and the Golden Apples jackpot.
 */
(function () {
  "use strict";
  if (!window.TNC_PixiMachine) return;
  var PIXI = window.PIXI;

  var theme = {
    title: "FRUIT ORCHARD", spin: "SPIN", fsShort: "Free spins",
    neon: "#ffd166", neon2: "#ff9f43", text: "#fff1d6", accent: "#ffd166", featY: 266, fsY: 200,
    burst: ["🍒", "🍋", "🍊", "🍇", "🍉", "🍃", "🌸"],
    quips: ["No fruit this time.", "The orchard is quiet… spin again!", "Not ripe yet!", "A gentle breeze, nothing more."],
    welcome: "Welcome to the orchard! Pick your lines and bet, then press SPIN", twist: "STICKY WILDS",
    jp: { major: ["#5a2a0a", "#2e1504", "#ff9f43", "#ffd6a8", "#ffe6c8"], minor: ["#1f4a14", "#10260a", "#7ddc5a", "#c8ffb0", "#dcffd0"] },
    feat: { fill: "rgba(43,22,6,.55)", stroke: "rgba(255,214,102,.6)", text: "#fff1d6", hot: ["#fff1c4", "#ffd166"], hotStroke: "#fff6dc", hotText: "#3b2109" },
    fs: { color: 0xff6fa3, fill: 0xffb3c6, fillAlpha: 0.14, bulb: 0xfff1c4 },   // free spins: blossom pink frame, warm bulbs
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
      var fast = (k.busy() && k.feature()) || (k.hot && k.hot()), per = fast ? 200 : 900, on = Math.floor(tt / per) % 2;
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

  /* ═══ The collector: the Apple Tree. Bare and dry when empty: brown ground, a few dead leaves. As it fills,
     leaves bud all over the branches (in no particular order), the grass greens and the sun comes out; on the
     last stretch apples grow and ripen from green to red. Full: wind in the leaves, a shower of leaves and
     petals; when the Harvest Festival starts the apples drop to the grass. ═══ */
  function collector(k, tank) {
    var TW = k.TW, TH = k.TH, rr = k.rr, COL = k.COL, TANK = k.TANK, PIXI = k.PIXI;
    var SKY = { x: 9, y: 40, w: TW - 18, h: TH - 50 };
    var cx = TW / 2, groundY = SKY.y + SKY.h - 36;
    var panel = k.paint(TW, TH, function (g, w, h) {
      g.shadowColor = "rgba(0,0,0,.6)"; g.shadowBlur = 12; g.shadowOffsetY = 4; rr(g, 2, 2, w - 4, h - 4, 12);
      g.fillStyle = k.grad(g, 0, h, ["#6e421c", "#4a2a10"]); g.fill(); g.shadowBlur = 0; g.shadowOffsetY = 0;
      rr(g, SKY.x, SKY.y, SKY.w, SKY.h, 8); g.fillStyle = k.grad(g, SKY.y, SKY.y + SKY.h, ["#6fb9ff", "#b8e2ff", "#e6f4ff"]); g.fill();
      g.save(); g.clip();
      g.fillStyle = "rgba(255,255,255,.55)";                                                        // a few clouds
      [[26, 70, 16], [40, 66, 11], [92, 104, 13], [104, 108, 9]].forEach(function (c) { g.beginPath(); g.ellipse(c[0], c[1], c[2], c[2] * 0.55, 0, 0, Math.PI * 2); g.fill(); });
      g.fillStyle = k.grad(g, groundY - 8, SKY.y + SKY.h, ["#b08a4a", "#8a6232", "#5c3f1c"]);     // dry ground
      g.beginPath(); g.moveTo(SKY.x, groundY + 4); g.quadraticCurveTo(cx, groundY - 14, SKY.x + SKY.w, groundY + 2); g.lineTo(SKY.x + SKY.w, SKY.y + SKY.h); g.lineTo(SKY.x, SKY.y + SKY.h); g.closePath(); g.fill();
      g.strokeStyle = "rgba(120,80,30,.55)"; g.lineWidth = 1.2;                                   // dry tufts
      var r0 = seeded(3);
      for (var i = 0; i < 26; i++) { var tx = SKY.x + 6 + r0() * (SKY.w - 12), ty = groundY + 2 + r0() * 22; g.beginPath(); g.moveTo(tx, ty); g.lineTo(tx + (r0() - 0.5) * 6, ty - 5 - r0() * 5); g.stroke(); }
      g.restore();
      rr(g, SKY.x, SKY.y, SKY.w, SKY.h, 8); g.lineWidth = 2; g.strokeStyle = "#ffd166"; g.stroke();
      g.lineWidth = 1.5; g.strokeStyle = "rgba(255,230,180,.35)"; rr(g, 2.5, 2.5, w - 5, h - 5, 12); g.stroke();
    });
    tank.addChild(panel);
    var name = k.txt(COL ? COL.name.toUpperCase() : "", { fontSize: 13, fill: "#ffd166", letterSpacing: 1.5 }); name.position.set(TW / 2, 22); tank.addChild(name);
    var scene = new PIXI.Container(); tank.addChild(scene);
    var sceneMask = new PIXI.Graphics().roundRect(SKY.x, SKY.y, SKY.w, SKY.h, 8).fill(0xffffff); tank.addChild(sceneMask); scene.mask = sceneMask;

    // The sun, behind everything: dim through the haze when the tree is dry, bright and raying when it is green
    var rays = k.paint(150, 150, function (g) {
      g.translate(75, 75); g.fillStyle = "rgba(255,236,150,.5)";
      for (var i = 0; i < 12; i++) { g.rotate(Math.PI / 6); g.beginPath(); g.moveTo(0, 0); g.lineTo(-7, -75); g.lineTo(7, -75); g.closePath(); g.fill(); }
    });
    rays.anchor.set(0.5); rays.position.set(SKY.x + SKY.w - 24, SKY.y + 26); rays.alpha = 0; scene.addChild(rays);
    var sun = k.paint(70, 70, function (g) {
      var rg = g.createRadialGradient(35, 35, 4, 35, 35, 35); rg.addColorStop(0, "#fff9d6"); rg.addColorStop(0.42, "#ffe066"); rg.addColorStop(0.5, "rgba(255,210,80,.5)"); rg.addColorStop(1, "rgba(255,200,60,0)");
      g.fillStyle = rg; g.fillRect(0, 0, 70, 70);
    });
    sun.anchor.set(0.5); sun.position.copyFrom(rays.position); scene.addChild(sun);
    var haze = k.paint(SKY.w, SKY.h, function (g, w, h) { g.fillStyle = k.grad(g, 0, h, ["rgba(236,222,190,.9)", "rgba(226,214,180,.6)", "rgba(200,180,140,.3)"]); g.fillRect(0, 0, w, h); });
    haze.position.set(SKY.x, SKY.y); scene.addChild(haze);

    // Green grass over the dry ground (fades in with the level)
    var grass = k.paint(SKY.w, 60, function (g, w, h) {
      g.fillStyle = k.grad(g, 0, h, ["#8fd65f", "#5aa83a", "#3d8a2a"]);
      g.beginPath(); g.moveTo(0, 12); g.quadraticCurveTo(w / 2, -6, w, 10); g.lineTo(w, h); g.lineTo(0, h); g.closePath(); g.fill();
      var r0 = seeded(9); g.strokeStyle = "rgba(220,255,170,.7)"; g.lineWidth = 1.3;
      for (var i = 0; i < 40; i++) { var tx = 4 + r0() * (w - 8), ty = 8 + r0() * 30; g.beginPath(); g.moveTo(tx, ty + 4); g.quadraticCurveTo(tx + 2, ty - 2, tx + (r0() - 0.5) * 8, ty - 8 - r0() * 6); g.stroke(); }
      g.fillStyle = "#fff4a8"; for (var j = 0; j < 7; j++) { g.beginPath(); g.arc(8 + r0() * (w - 16), 14 + r0() * 24, 2, 0, Math.PI * 2); g.fill(); }   // daisies
    });
    grass.position.set(SKY.x, groundY - 8); grass.alpha = 0; scene.addChild(grass);

    // The tree: a trunk that branches (seeded, so it is the same tree every visit); the leaves bud at the branch ends
    var nodes = [], r = seeded(11);
    var wood = k.paint(TW, TH, function (g) {
      g.lineCap = "round"; g.lineJoin = "round";
      function branch(x, y, ang, len, wid, depth) {
        var x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
        g.lineWidth = wid; g.strokeStyle = "#5a3414"; g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
        g.lineWidth = Math.max(1, wid * 0.38); g.strokeStyle = "rgba(170,110,60,.55)"; g.beginPath(); g.moveTo(x - wid * 0.2, y); g.lineTo(x2 - wid * 0.2, y2); g.stroke();
        if (depth > 0) nodes.push({ x: x2, y: y2, d: depth });
        if (depth === 0) { nodes.push({ x: x2, y: y2, d: 0 }); return; }
        var n = depth >= 3 ? 3 : 2;
        for (var i = 0; i < n; i++) {
          var a = ang + (i - (n - 1) / 2) * (0.5 + r() * 0.2) + (r() - 0.5) * 0.25;
          a = Math.max(-Math.PI + 0.25, Math.min(-0.25, a));
          branch(x2, y2, a, len * (0.64 + r() * 0.14), wid * 0.6, depth - 1);
        }
      }
      branch(cx, groundY + 6, -Math.PI / 2 + 0.03, 64, 14, 4);
      g.fillStyle = "rgba(0,0,0,.25)"; g.beginPath(); g.ellipse(cx, groundY + 8, 26, 5, 0, 0, Math.PI * 2); g.fill();   // the trunk's shadow
    });
    scene.addChild(wood);
    nodes = nodes.filter(function (p) { return p.y > SKY.y + 6 && p.x > SKY.x + 4 && p.x < SKY.x + SKY.w - 4; });
    var crown = new PIXI.Container(); crown.position.set(cx, groundY + 6); scene.addChild(crown);   // pivots at the foot of the trunk
    function local(p) { return { x: p.x - cx, y: p.y - groundY - 6 }; }
    // The canopy behind the leaves: a soft green cloud around the branch ends, solid when the tree is full
    var canopy = k.paint(TW, TH, function (g) {
      nodes.forEach(function (p) {
        if (p.d > 2) return;
        var rad = p.d === 0 ? 15 : 20, rg = g.createRadialGradient(p.x - 4, p.y - 4, 2, p.x, p.y, rad);
        rg.addColorStop(0, "rgba(120,200,90,.95)"); rg.addColorStop(0.7, "rgba(70,160,55,.8)"); rg.addColorStop(1, "rgba(40,120,40,0)");
        g.fillStyle = rg; g.beginPath(); g.arc(p.x, p.y, rad, 0, Math.PI * 2); g.fill();
      });
    });
    canopy.position.set(-cx, -groundY - 6); canopy.alpha = 0; crown.addChild(canopy);
    // Leaf textures, three greens and a dead brown
    function leafTex(c0, c1) {
      return k.texOf(20, 12, function (g) {
        g.beginPath(); g.moveTo(1, 6); g.quadraticCurveTo(10, -4, 19, 6); g.quadraticCurveTo(10, 16, 1, 6); g.closePath();
        g.fillStyle = k.hgrad(g, 0, 20, [c0, c1]); g.fill();
        g.strokeStyle = "rgba(255,255,255,.35)"; g.lineWidth = 1; g.beginPath(); g.moveTo(2, 6); g.lineTo(18, 6); g.stroke();
      });
    }
    var LEAF = [leafTex("#a5e86f", "#5db43c"), leafTex("#7fd14f", "#3f9a2c"), leafTex("#c5f08a", "#6fbf4a"), leafTex("#5aa83a", "#2f7d22")], DEAD = leafTex("#c9a05a", "#8a6232");
    // The leaves: one or two at every branch end, in a shuffled order; the level says how many have budded
    var leaves = [], order = [];
    nodes.forEach(function (p) { var n = p.d === 0 ? 3 : p.d === 1 ? 2 : 1; for (var i = 0; i < n; i++) order.push({ x: p.x + (r() - 0.5) * 14, y: p.y + (r() - 0.5) * 12, d: p.d }); });
    for (var i = order.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)), tmp = order[i]; order[i] = order[j]; order[j] = tmp; }
    order.forEach(function (p, i) {
      var s = new PIXI.Sprite(LEAF[i % LEAF.length]); s.anchor.set(0.15, 0.5); var q = local(p); s.position.set(q.x, q.y);
      s.rotation = -Math.PI / 2 + (r() - 0.5) * 2.6; s.visible = false; crown.addChild(s);
      leaves.push({ s: s, base: 0.8 + r() * 0.45, rot: s.rotation, ph: r() * 6.3, cur: 0, v: 0, at: (i + 0.5) / order.length });
    });
    var N = leaves.length;
    // Dead leaves, hanging on while the tree is dry
    var dead = [];
    nodes.filter(function (p, i) { return p.d <= 1 && i % 3 === 0; }).slice(0, 14).forEach(function (p, i) {
      var s = new PIXI.Sprite(DEAD); s.anchor.set(0.15, 0.5); var q = local(p); s.position.set(q.x + (r() - 0.5) * 10, q.y + 2);
      s.rotation = Math.PI / 2 + (r() - 0.5) * 0.9; crown.addChild(s);
      dead.push({ s: s, base: 0.7 + r() * 0.3, rot: s.rotation, ph: r() * 6.3, cur: 1, v: 0 });
    });
    // Apples, on the last stretch: a green one grows, then reddens
    function appleTex(c) {
      return k.texOf(26, 30, function (g) {
        g.strokeStyle = "#5a3414"; g.lineWidth = 2; g.beginPath(); g.moveTo(13, 9); g.quadraticCurveTo(14, 4, 17, 2); g.stroke();
        g.fillStyle = "#6fbf4a"; g.beginPath(); g.ellipse(18, 6, 5, 2.5, -0.6, 0, Math.PI * 2); g.fill();
        var rg = g.createRadialGradient(9, 13, 2, 13, 18, 12); rg.addColorStop(0, c[0]); rg.addColorStop(0.5, c[1]); rg.addColorStop(1, c[2]);
        g.fillStyle = rg; g.beginPath(); g.moveTo(13, 9); g.bezierCurveTo(2, 4, 0, 24, 11, 28); g.lineTo(15, 28); g.bezierCurveTo(26, 24, 24, 4, 13, 9); g.fill();
        g.fillStyle = "rgba(255,255,255,.45)"; g.beginPath(); g.ellipse(8, 14, 3, 1.6, -0.7, 0, Math.PI * 2); g.fill();
      });
    }
    var RED = appleTex(["#ffb3b3", "#e8333f", "#7a0d17"]), GREEN = appleTex(["#e4ffb0", "#8fd65f", "#3d8a2a"]);
    var apples = [], spots = nodes.filter(function (p) { return p.d <= 1; }).sort(function () { return r() - 0.5; });
    spots.forEach(function (p) {
      if (apples.length >= 7) return;
      if (apples.some(function (a) { return Math.abs(a.hx - p.x) < 17 && Math.abs(a.hy - p.y) < 17; })) return;
      var c = new PIXI.Container(), q = local({ x: p.x, y: p.y + 8 }); c.position.set(q.x, q.y);
      var g0 = new PIXI.Sprite(GREEN), r0 = new PIXI.Sprite(RED); g0.anchor.set(0.5, 0.15); r0.anchor.set(0.5, 0.15); r0.alpha = 0; c.addChild(g0, r0); c.scale.set(0); crown.addChild(c);
      apples.push({ c: c, red: r0, hx: p.x, hy: p.y, x0: q.x, y0: q.y, at: 0.52 + apples.length * 0.075, cur: 0, v: 0, ph: r() * 6.3, drop: null });
    });
    var SPARK = k.texOf(14, 14, function (g) { g.fillStyle = "#fff8d0"; g.beginPath(); g.moveTo(7, 0); g.lineTo(8.6, 5.4); g.lineTo(14, 7); g.lineTo(8.6, 8.6); g.lineTo(7, 14); g.lineTo(5.4, 8.6); g.lineTo(0, 7); g.lineTo(5.4, 5.4); g.closePath(); g.fill(); });
    var PETAL = k.texOf(10, 10, function (g) { g.fillStyle = "#ffd6e8"; g.beginPath(); g.ellipse(5, 5, 5, 3, 0.6, 0, Math.PI * 2); g.fill(); });
    var full = k.txt("FULL!", { fontSize: 26, fill: "#ffe79a", dropShadow: { color: "#ff9f43", blur: 12, distance: 0, alpha: 1 }, stroke: { color: "#4a2a10", width: 4 } });
    full.position.set(TW / 2, groundY + 20); full.visible = false; tank.addChild(full);

    var t = 0, gust = 0, shown = 0, harvested = false;
    function spring(o, target, kick) { o.v += (target - o.cur) * (kick || 0.16); o.v *= 0.7; o.cur += o.v; }
    k.app.ticker.add(function (tk) {
      var dt = Math.min(50, tk.deltaMS) / 16.67; t += tk.deltaMS / 1000;
      var lvl = TANK.level, isFull = TANK.full;
      if (lvl < 0.3) harvested = false;
      shown += (lvl - shown) * Math.min(1, 0.08 * dt);
      gust *= Math.pow(0.95, dt);
      var wind = Math.sin(t * 1.4) * (isFull ? 0.05 : 0.02) + Math.sin(t * 17) * 0.025 * gust;
      crown.rotation = wind * 0.6; crown.skew.x = wind * 0.4;
      haze.alpha = 1 - shown * 0.95; grass.alpha = Math.min(1, shown * 1.3); canopy.alpha = Math.min(1, shown * 1.1);
      sun.alpha = 0.3 + shown * 0.7; sun.scale.set(0.8 + shown * 0.25 + (isFull ? Math.sin(t * 4) * 0.05 : 0));
      rays.alpha = Math.max(0, (shown - 0.5) * 1.6) * (isFull ? 0.6 + Math.sin(t * 6) * 0.3 : 0.5); rays.rotation += (isFull ? 0.012 : 0.003) * dt;
      for (var i = 0; i < N; i++) {
        var l = leaves[i], on = l.at <= lvl;
        if (!on && l.cur < 0.01) { l.s.visible = false; continue; }
        spring(l, on ? 1 : 0, 0.18); l.s.visible = l.cur > 0.01;
        l.s.scale.set(l.base * Math.max(0, l.cur)); l.s.rotation = l.rot + Math.sin(t * 2.2 + l.ph) * (0.1 + gust * 0.35) + wind;
      }
      dead.forEach(function (l) {
        var on = lvl < 0.12; spring(l, on ? 1 : 0, 0.1); l.s.visible = l.cur > 0.01;
        l.s.scale.set(l.base * Math.max(0, l.cur)); l.s.rotation = l.rot + Math.sin(t * 1.6 + l.ph) * (0.08 + gust * 0.3);
      });
      apples.forEach(function (a) {
        if (a.drop) {   // the harvest: it falls, bounces on the grass, and is gathered
          a.drop.vy += 0.55 * dt; a.c.y += a.drop.vy * dt; a.c.x += a.drop.vx * dt; a.c.rotation += a.drop.vx * 0.06 * dt;
          var floor = -30;
          if (a.c.y > floor && a.drop.vy > 0) { a.c.y = floor; a.drop.vy *= -0.42; a.drop.vx *= 0.7; a.drop.n++; }
          if (a.drop.n >= 2) { a.c.alpha -= 0.05 * dt; if (a.c.alpha <= 0) { a.drop = null; a.c.alpha = 1; a.c.rotation = 0; a.c.position.set(a.x0, a.y0); a.cur = 0; a.v = 0; a.c.scale.set(0); } }
          return;
        }
        var on = !harvested && lvl >= a.at;
        spring(a, on ? 1 : 0, 0.14);
        var ripe = isFull ? 1 : Math.max(0, Math.min(1, (lvl - a.at) / 0.12));
        a.red.alpha = ripe; a.c.scale.set(Math.max(0, a.cur) * (0.6 + ripe * 0.4) * (isFull ? 1 + Math.sin(t * 5 + a.ph) * 0.06 : 1));
        a.c.rotation = Math.sin(t * 2 + a.ph) * 0.08 + wind * 0.5;
      });
      if (isFull) full.scale.set(1 + Math.sin(t * 7) * 0.06);
    });
    function leafAt(level) { var i = Math.max(0, Math.min(N - 1, Math.floor(level * N))); var l = leaves[i]; return { x: k.TX + cx + l.s.x, y: k.TY + groundY + 6 + l.s.y }; }
    return {
      count: function () {},   // no numbers: the tree itself shows how full it is
      flash: function (on) { full.visible = on; panel.tint = on ? 0xfff0c0 : 0xffffff; },
      target: function () { return { x: k.TX + cx, y: k.TY + groundY - 110 }; },
      // Each leaf symbol flies to the branch where the next leaf buds; it lands in a puff of leaves and the tree grows a step.
      collect: function (items, o) {
        var n = items.length;
        return k.flyTo(items, function (j) { return leafAt(o.from + (o.to - o.from) * (j + 0.5) / n); }, function (j, x, y) {
          gust = Math.min(1.6, gust + 0.8);
          k.emit(8, x, y, { tex: LEAF, power: 3, cone: 6.3, g: 0.05, life: 45, spread: 14, spreadY: 14, scale: 0.9, spin: 0.25 });
          k.sfx.collectItem(n > 1 ? j / (n - 1) : 0);
          k.levelTo(o.from + (o.to - o.from) * (j + 1) / n, 650);
        }, { arc: 90, shrink: 0.45 });
      },
      // Full: a gust through the crown, leaves and petals fly, the sun rays out and the apples glow.
      full: function () {
        gust = 2.2; var x = k.TX + cx, y = k.TY + groundY - 110;
        k.emit(26, x, y, { tex: LEAF.concat([PETAL, PETAL]), power: 8, cone: 6.3, g: 0.1, life: 120, spread: 90, spreadY: 90, scale: 1.1, spin: 0.3 });
        k.emit(16, x, y, { tex: SPARK, power: 3, cone: 6.3, g: -0.02, life: 90, spread: 110, spreadY: 120, flip: true, scale: 1.2 });
      },
      // The Harvest Festival starts: the apples drop to the grass, one after another.
      reward: function () {
        harvested = true; gust = 1.5;
        apples.forEach(function (a, i) { setTimeout(function () { if (a.cur > 0.5) { a.drop = { vy: -1.5, vx: (Math.random() - 0.5) * 1.6, n: 0 }; k.sfx.collectItem(i / 7); } }, k.reduce ? 0 : 140 + i * 130); });
        k.emit(10, k.TX + cx, k.TY + groundY - 110, { tex: LEAF, power: 5, cone: 6.3, g: 0.08, life: 90, spread: 80, spreadY: 80, spin: 0.3 });
      }
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

  // The controls, a button panel like a casino machine's: the BALANCE, TOTAL BET and WIN slates along the fold; on
  // the left the line keys (leaf green) over the bet keys (cream price cards), the chosen one of each gold and lit;
  // on the right the SPIN apple.
  function deck(k, deck) {
    var paint = k.paint, txt = k.txt, reduce = k.reduce, P = k.panel;
    var bal = k.readout("BALANCE", P.meterX[0], P.meterY), bet = k.readout(k.HAS_LINES ? "TOTAL BET" : "BET", P.meterX[1], P.meterY), win = k.readout("WIN", P.meterX[2], P.meterY);

    // The keys stand in sockets cut into the counter, rimmed with gold. The chosen key: a gold tag's colours.
    var SOCKET = { pad: 3, fill: "#2b1606", rim: "rgba(255,209,102,.65)" };
    var GOLD = { top: ["#fff6c9", "#ffd752", "#f0a615"], wall: ["#b9720c", "#6e3f02"], rim: "#fffbe6", inner: "rgba(140,70,0,.4)", text: "#7a0d17", shadow: "rgba(255,250,220,.8)", gloss: 0.3, shade: 0.12 };
    k.linesKeys(Object.assign({}, P.lines, { socket: SOCKET, glow: "#ffc23a", font: k.SIGN, weight: "400", size: 26, word: "LINES", wordSize: 13, on: GOLD,
      off: { top: ["#a9e070", "#62ad3c", "#3f8327"], wall: ["#2f6a1c", "#1a4410"], rim: "rgba(228,255,198,.8)", inner: "rgba(20,70,10,.4)", text: "#fffbe8", shadow: "#1f5212" } }));
    k.legend((k.HAS_LINES ? "BET PER LINE · " : "BET · ") + k.SATS, P.fieldX + 2, P.fieldX + P.fieldW - 2, P.legendY, "#ffe2b0", 0xf5c56b);
    k.betKeys(Object.assign({}, P.bets, { socket: SOCKET, glow: "#ffc23a", size: 21, head: "BET", on: GOLD,
      off: { top: ["#fffdf4", "#f9ebc8", "#e9d2a0"], wall: ["#b58d53", "#7c5626"], rim: "#ffffff", inner: "rgba(168,116,58,.45)", text: "#8a1020", shadow: "rgba(255,255,255,.85)", gloss: 0.45, shade: 0.14 } }));

    // SPIN: a big red apple of a key, with a stem and a leaf; it sinks when pressed.
    var DEPTH = 18, KR = 70, KX = P.spinX, KY = P.spinY;
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
      g.lineCap = "round"; g.lineWidth = 6; g.strokeStyle = "#5b3412"; g.beginPath(); g.moveTo(120, 120 - KR + 2); g.quadraticCurveTo(122, 120 - KR - 10, 130, 120 - KR - 18); g.stroke();   // stem
    });
    cap.anchor.set(0.5); top.addChild(cap);
    // The leaf on its own, so it can flutter: hinged at the stem's tip
    var leaf = new PIXI.Sprite(k.texOf(44, 22, function (g) {
      g.beginPath(); g.ellipse(22, 11, 19, 8.5, 0, 0, Math.PI * 2); g.fillStyle = k.grad(g, 2, 20, ["#9be36a", "#2f7d22"]); g.fill();
      g.lineWidth = 1.2; g.strokeStyle = "#1f5a16"; g.beginPath(); g.moveTo(5, 11); g.lineTo(40, 11); g.stroke();
    }));
    leaf.anchor.set(0.06, 0.5); leaf.position.set(10, -KR - 18); leaf.rotation = -0.5; top.addChild(leaf);
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
    // Daisies round the well: buds at rest, blooming one after another while the reels turn, all at once on a press
    var DAISY = k.texOf(28, 28, function (g) {
      for (var i = 0; i < 8; i++) { g.save(); g.translate(14, 14); g.rotate(i * Math.PI / 4); g.beginPath(); g.ellipse(8, 0, 6, 2.8, 0, 0, Math.PI * 2); g.fillStyle = "#fffaf0"; g.fill(); g.restore(); }
      g.beginPath(); g.arc(14, 14, 4.2, 0, Math.PI * 2); g.fillStyle = "#ffcf3a"; g.fill(); g.lineWidth = 1; g.strokeStyle = "#d9960b"; g.stroke();
    });
    var daisies = [];
    for (var di = 0; di < 12; di++) {
      var da = -Math.PI / 2 + di / 12 * Math.PI * 2, ds = new PIXI.Sprite(DAISY); ds.anchor.set(0.5);
      ds.position.set(Math.cos(da) * (KR + 15), DEPTH + Math.sin(da) * (KR + 15) * 0.94); ds.rotation = da; ds.scale.set(0.45);
      key.addChildAt(ds, key.getChildIndex(top)); daisies.push({ s: ds, bloom: 0, i: di });
    }
    // Leaves that fly off when the apple is pressed
    var LEAFLET = k.texOf(16, 9, function (g) { g.beginPath(); g.moveTo(1, 4.5); g.quadraticCurveTo(8, -3, 15, 4.5); g.quadraticCurveTo(8, 12, 1, 4.5); g.fillStyle = "#6fbf4a"; g.fill(); });
    var puffs = [], lastFlash = 0;
    k.app.ticker.add(function (tk) {
      var dt = Math.min(40, tk.deltaMS);
      top.y = k.keySpring(DEPTH, dt);
      var s = k.keyState(), busy = s.busy, off = s.off, t = s.t;
      glow.alpha = busy && !reduce ? 0.08 + 0.1 * (0.5 + 0.5 * Math.sin(t / 140)) : busy ? 0.1 : 0;
      top.tint = off ? 0x8c8c99 : 0xffffff;
      key.alpha = off ? 0.8 : 1;
      well.alpha = off ? 0.35 : busy ? 0.9 + 0.1 * Math.sin(t / 140) : 0.75 + Math.sin(t / 600) * 0.25;
      var f = s.flash, step = Math.floor(t / 90);
      // the press: the apple squashes like a ripe one and springs back, the leaf flicks, a puff of leaves
      top.scale.set(1 + f * 0.09, 1 - f * 0.11); glow.alpha = Math.max(glow.alpha, f * 0.5);
      if (f > lastFlash && !reduce) for (var pi = 0; pi < 6; pi++) { var ps = new PIXI.Sprite(LEAFLET); ps.anchor.set(0.5); ps.position.set((Math.random() - 0.5) * 60, -KR + 10); var pa = -Math.PI / 2 + (Math.random() - 0.5) * 1.6; key.addChild(ps); puffs.push({ s: ps, vx: Math.cos(pa) * 3, vy: Math.sin(pa) * 3 - 1, life: 1 }); }
      lastFlash = f;
      for (var pj = puffs.length - 1; pj >= 0; pj--) { var pp = puffs[pj]; pp.s.x += pp.vx * dt / 16; pp.s.y += pp.vy * dt / 16; pp.vy += 0.12 * dt / 16; pp.s.rotation += 0.1; pp.life -= dt / 600; pp.s.alpha = Math.max(0, pp.life); if (pp.life <= 0) { pp.s.destroy(); puffs.splice(pj, 1); } }
      // the leaf flutters in the breeze, harder while the reels turn and on the press; the apple rocks while they turn
      leaf.rotation = -0.5 + Math.sin(t / (busy ? 90 : 420)) * (busy ? 0.22 : 0.09) - f * 0.5;
      top.rotation = busy && !reduce ? Math.sin(t / 170) * 0.03 : 0;
      // the daisies
      daisies.forEach(function (d) {
        var want = off ? 0 : f > 0 ? 1 : busy ? (reduce ? 0.8 : ((d.i - step) % 4 + 4) % 4 === 0 ? 1 : 0.12) : 0.12 + 0.12 * (0.5 + 0.5 * Math.sin(t / 900 + d.i));
        d.bloom += (want - d.bloom) * Math.min(1, dt / 90);
        d.s.scale.set(0.42 + d.bloom * 0.6); d.s.alpha = 0.55 + d.bloom * 0.45; d.s.rotation = -Math.PI / 2 + d.i / 12 * Math.PI * 2 + d.bloom * 0.5;
      });
      var sp = (t % 3600) / 3600;
      shine.visible = !off && !busy && !reduce && sp > 0.55 && sp < 0.85;
      shine.x = -KR * 1.4 + KR * 2.8 * Math.max(0, Math.min(1, (sp - 0.55) / 0.3));
    });
    k.spinKey(KX - KR, KY - KR - 20, KR * 2, KR * 2 + DEPTH + 20, key);

    return {
      bal: bal, bet: bet, win: win, key: key,
      update: function (s) { sub.text = s.sub; },
      points: function () { return { spin: [KX, KY] }; }
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

  /* ═══ Free spins weather: blossom petals and small leaves drift down across the reel window ═══ */
  function featureFx(k, layer) {
    var PIXI = k.PIXI, RX = k.RX, RY = k.RY, RW = k.RW, RH = k.RH, ps = [];
    function petal(c0, c1) { return k.texOf(14, 14, function (g) { g.fillStyle = k.grad(g, 0, 14, [c0, c1]); g.beginPath(); g.moveTo(7, 0); g.bezierCurveTo(14, 2, 14, 11, 7, 14); g.bezierCurveTo(0, 11, 0, 2, 7, 0); g.fill(); }); }
    var TEX = [petal("#ffb3c6", "#ff5c8a"), petal("#ff8fb0", "#e8406f"), petal("#ffe0a8", "#ff9f43"), petal("#ffd6e8", "#ff6fa3"),
      k.texOf(16, 10, function (g) { g.beginPath(); g.moveTo(1, 5); g.quadraticCurveTo(8, -3, 15, 5); g.quadraticCurveTo(8, 13, 1, 5); g.fillStyle = k.hgrad(g, 0, 16, ["#a5e86f", "#5db43c"]); g.fill(); })];
    return {
      tick: function (dt, t, on) {
        if (on && ps.length < 30 && Math.random() < 0.3 * dt) {
          var s = new PIXI.Sprite(TEX[Math.floor(Math.random() * TEX.length)]); s.anchor.set(0.5);
          s.position.set(RX + Math.random() * RW, RY - 12); s.alpha = 0.8 + Math.random() * 0.2; s.scale.set(1 + Math.random() * 0.8); s.rotation = Math.random() * 6.3;
          layer.addChild(s); ps.push({ s: s, vy: 0.5 + Math.random() * 0.7, ph: Math.random() * 6.3, vr: (Math.random() - 0.5) * 0.05, sw: 0.5 + Math.random() * 0.9 });
        }
        for (var i = ps.length - 1; i >= 0; i--) {
          var p = ps[i]; p.s.y += p.vy * dt; p.s.x += Math.sin(t * 1.6 + p.ph) * p.sw * dt; p.s.rotation += p.vr * dt;
          if (p.s.y > RY + RH + 12) { p.s.destroy(); ps.splice(i, 1); }
        }
      },
      clear: function () { ps.forEach(function (p) { p.s.destroy(); }); ps = []; }
    };
  }

  window.TNC_PixiMachine.skin("orchard", {
    theme: theme, cabinet: cabinet, collector: collector, featureFx: featureFx, base: base, surface: surface, deck: deck, bonus: bonus, jackpot: jackpot
  });
})();
