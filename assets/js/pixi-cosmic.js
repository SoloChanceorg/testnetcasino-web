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

  /* ═══ The collector: the Fuel Tank ═══ */
  function collector(k, tank) {
    var TW = k.TW, TH = k.TH, rr = k.rr, COL = k.COL, TANK = k.TANK;
    var tankGlass = k.paint(TW, TH, function (g, w, h) {
      g.shadowColor = T.neon; g.shadowBlur = 16; rr(g, 4, 4, w - 8, h - 8, 10); g.fillStyle = "rgba(10,6,30,.92)"; g.fill();
      g.shadowBlur = 0; g.lineWidth = 2.5; g.strokeStyle = T.neon; g.stroke();
    });
    tank.addChild(tankGlass);
    var tankName = k.txt(COL ? COL.name.toUpperCase() : "", { fontSize: 13, fill: "#9ff0ff", letterSpacing: 1.5 }); tankName.position.set(TW / 2, 22); tank.addChild(tankName);
    var TIN = { x: 28, y: 44, w: TW - 56, h: TH - 92 };
    tank.addChild(k.paint(TIN.w + 8, TIN.h + 8, function (g, w, h) {
      rr(g, 3, 3, w - 6, h - 6, 18); g.fillStyle = "rgba(0,0,0,.55)"; g.fill(); g.lineWidth = 2; g.strokeStyle = "rgba(46,197,255,.8)"; g.stroke();
    })).position.set(TIN.x - 4, TIN.y - 4);
    var fuel = new PIXI.Graphics(); tank.addChild(fuel);
    var fuelMask = new PIXI.Graphics().roundRect(TIN.x, TIN.y, TIN.w, TIN.h, 15).fill(0xffffff); tank.addChild(fuelMask); fuel.mask = fuelMask;
    var marks = new PIXI.Graphics();
    for (var mk = 1; mk < 10; mk++) marks.moveTo(TIN.x + 4, TIN.y + TIN.h * mk / 10).lineTo(TIN.x + 14, TIN.y + TIN.h * mk / 10);
    marks.stroke({ width: 1.5, color: 0x9ff0ff, alpha: 0.5 }); tank.addChild(marks);
    var tankIcon = new PIXI.Sprite(k.emojiTex(COL ? COL.emoji : "⛽", 40)); tankIcon.anchor.set(0.5); tankIcon.position.set(TW / 2, TIN.y + 24); tankIcon.alpha = 0.9; tank.addChild(tankIcon);
    var tankFull = k.txt("FULL!", { fontSize: 26, fill: "#ffe79a", dropShadow: { color: "#ffb300", blur: 12, distance: 0, alpha: 1 }, stroke: { color: "#000", width: 3 } });
    tankFull.position.set(TW / 2, TIN.y + TIN.h / 2); tankFull.visible = false; tank.addChild(tankFull);
    var wave = 0;
    k.app.ticker.add(function (tk) {
      wave += tk.deltaMS / 400;
      var lvl = TANK.level, top = TIN.y + TIN.h * (1 - lvl);
      fuel.clear();
      if (lvl <= 0) return;
      fuel.moveTo(TIN.x, TIN.y + TIN.h);
      for (var x = 0; x <= TIN.w; x += 4) fuel.lineTo(TIN.x + x, top + Math.sin(wave + x / 9) * 2.5);
      fuel.lineTo(TIN.x + TIN.w, TIN.y + TIN.h).closePath().fill({ color: 0x2ec5ff, alpha: 0.9 });
      fuel.rect(TIN.x, top + 6, TIN.w, 3).fill({ color: 0x9ff0ff, alpha: 0.6 });
      if (TANK.full) tankFull.scale.set(1 + Math.sin(wave * 3) * 0.06);
    });
    return {
      count: function () {},   // no numbers: the fuel level itself shows how full it is
      flash: function (on) { tankFull.visible = on; tankGlass.tint = on ? 0xffe9a8 : 0xffffff; },
      target: function () { return { x: k.TX + TW / 2, y: k.TY + TIN.y + TIN.h * 0.5 }; }
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
    k.app.ticker.add(function (tk) {
      var dt = Math.min(40, tk.deltaMS);
      launchTop.y = k.keySpring(LDEPTH, dt);
      var s = k.keyState(), busy = s.busy, off = s.off, keyT = s.t;
      capGlow.alpha = busy && !reduce ? 0.10 + 0.12 * (0.5 + 0.5 * Math.sin(keyT / 140)) : busy ? 0.12 : 0;
      launchTop.tint = off ? 0x8c8c99 : 0xffffff;
      launch.alpha = off ? 0.8 : 1;
      launchWell.alpha = off ? 0.35 : busy ? 0.9 + 0.1 * Math.sin(keyT / 140) : 0.75 + Math.sin(keyT / 600) * 0.25;
      var sp = (keyT % 3600) / 3600;
      capShine.visible = !off && !busy && !reduce && sp > 0.55 && sp < 0.85;
      capShine.x = -LR * 1.4 + LR * 2.8 * Math.max(0, Math.min(1, (sp - 0.55) / 0.3));
    });
    k.deckHit(390 - LR, 130 - LR, LR * 2, LR * 2 + LDEPTH, launch, function () { k.press(); });

    // THRUST: the bet ladder 1 ... 1,000 as an aircraft throttle: a T-handle on a shaft rising from a gate
    // slot sunk into the console, a detent notch at every step; ▲ ▼ keys below. Pulled back (low thrust) the
    // handle leans toward the player, pushed forward it stands up over the slot.
    var SLX = 93;   // the slot's centre line
    var thr = new PIXI.Container(); thr.position.set(556, 12); deck.addChild(thr);
    var thrHead = txt(T.bet, { fontSize: 14, fill: "#b9a6ff", letterSpacing: 2 }); thrHead.position.set(66, 12); thr.addChild(thrHead);
    var slot = k.recess(12, 200, 6); slot.position.set(SLX - 10, 22); thr.addChild(slot);
    var slotFill = paint(6, 190, function (g) { rr(g, 0, 0, 6, 190, 3); g.fillStyle = grad(g, 0, 190, ["#ff4fd8", "#6a1fb8"]); g.globalAlpha = 0.9; g.fill(); });
    slotFill.position.set(SLX - 3, 31); thr.addChild(slotFill);
    var detents = new PIXI.Graphics();
    LADDER.forEach(function (v, i) { var y = 214 - i * 20; detents.moveTo(SLX + 10, y).lineTo(SLX + 18, y).moveTo(SLX - 18, y).lineTo(SLX - 10, y); });
    detents.stroke({ width: 2, color: 0x9a86e0, alpha: 0.7 }); thr.addChild(detents);
    var thrMarks = LADDER.map(function (v, i) {
      var y = 214 - i * 20, m = txt(String(v), { fontFamily: k.MONO, fontWeight: "700", fontSize: 13, fill: "#8f86b8" });
      m.anchor.set(1, 0.5); m.position.set(SLX - 24, y); thr.addChild(m);
      k.deckHit(556 + 4, 12 + y - 10, 120, 20, null, function () { k.setBet(v); });
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
    function drawLever(i) {   // i: 0 (1 tSat, pulled back) .. 9 (1000, pushed forward)
      var reach = 24 - 14 * (i / (LADDER.length - 1));   // how far the handle leans toward the player
      leverShadow.clear().roundRect(-3, 2, 6, reach + 4, 3).fill({ color: 0x000000, alpha: 0.35 });
      leverShaft.clear().roundRect(-3, 0, 6, reach, 3).fill(0xbfb3e6).roundRect(-3, 0, 2, reach, 1).fill({ color: 0xffffff, alpha: 0.6 });
      grip.y = reach; grip.scale.y = 0.85 + 0.15 * (1 - i / (LADDER.length - 1));
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
    k.deckHit(556 - 2, 12 + 254, 40, 34, betDown, function () { betDown._sink(); k.stepBet(-1); });
    k.deckHit(556 + 106, 12 + 254, 40, 34, betUp, function () { betUp._sink(); k.stepBet(1); });

    return {
      win: win, bal: bal, key: launch,
      setBet: function (bet, i) {
        thrMarks.forEach(function (m, j) { m.style.fill = j === i ? "#ffffff" : "#8f86b8"; });
        k.animate(k.R(220), (function (from, fromI) { return function (p) {
          thrKnob.y = from + (214 - i * 20 - from) * p; drawLever(fromI + (i - fromI) * p);
          slotFill.height = Math.max(4, 221 - thrKnob.y); slotFill.y = thrKnob.y;
        }; })(thrKnob.y || 214, thrKnob._i == null ? i : thrKnob._i));
        thrKnob._i = i;
        betVal.text = String(bet);   // like the lever marks: 1000, not 1,000
      },
      update: function (s) {
        launchSub.text = s.sub;
        [betUp, betDown].forEach(function (b) { k.setOff(b, s.busy); });
        thrMarks.forEach(function (m) { m.alpha = s.busy ? 0.55 : 1; });
      },
      points: function () { return { spin: [390, 130], betUp: [556 + 124, 12 + 270] }; }
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

  window.TNC_PixiMachine.skin("cosmic", {
    theme: theme, cabinet: cabinet, collector: collector, base: base, surface: surface, deck: deck, bonus: bonus, jackpot: jackpot
  });
})();
