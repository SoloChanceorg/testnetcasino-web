/*
 * TestnetCasino.com: the slot machine drawn with PixiJS (preview, Cosmic Voyage first).
 *
 * The whole machine is one canvas: the jackpot rows, the cabinet, the reels, the collector,
 * the display, the readouts, the LAUNCH button and the bet throttle, the banners, the particles
 * and the bonus and jackpot stages. Turned on with ?pixi=1 (slot.js loads PixiJS and this file);
 * without it the HTML machine plays as before.
 *
 * Same contract as slot.js: every outcome comes from POST /spins as `steps[]`, and this file only
 * animates them (paid spin and respins, multiplier wilds, free spins, the Warp Ladder bonus, a
 * jackpot won on the Star Map Wheel, fuel cells into the Fuel Tank, the Hyperdrive reward).
 * Randomness here is cosmetic only (blurred symbols while the reels turn, particles).
 *
 * Static art is painted with Canvas 2D into textures (gradients, glows, rounded panels); PixiJS
 * moves it. The canvas sits in a 3D stage, so the whole machine can tilt (CSS) on MINOR and up.
 * SPACE (or the LAUNCH button) spins, and stops the reels while they turn.
 *
 * Depends on: PixiJS 8 (window.PIXI), api.js, auth.js, units.js, jackpots.js (onRender),
 *             audio.js (TNC_sfx, optional).
 */
(function () {
  "use strict";

  var PIXI = window.PIXI;
  var W = 760, H = 1080;                 // the machine's own coordinates; scaled to the page
  var CW = 100, CH = 100, GAP = 4;       // one reel cell
  var RX = 46, RY = 300;                 // top left of the reels
  var EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  var SIGN = '"Bungee", "Poppins", sans-serif', MONO = '"SF Mono", ui-monospace, Menlo, Consolas, monospace';
  var LADDER = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
  var LINE_COLORS = [0xffd166, 0x06d6a0, 0xef476f, 0x4cc9f0, 0xf78c6b, 0xc86bff, 0x83e377, 0xff99c8, 0xf9c74f, 0x90e0ef];
  var TIER_NAMES = { minor: "MINOR", major: "MAJOR", grand: "GRAND" };
  var SPIN_RETRIES = 3;

  // Per theme: colours and words. Cosmic Voyage only for now.
  var THEMES = {
    cosmic: {
      title: "COSMIC ★ VOYAGE", spin: "LAUNCH", bet: "THRUST",
      bg: ["#1d0c44", "#0c0526"], neon: "#9a6bff", neon2: "#2ec5ff", text: "#e0eaff", accent: "#ffd166",
      card: ["#f6f3ff", "#d9d1f3"], burst: ["⭐", "✨", "🌟", "💫", "🪐"],
      quips: ["Lost signal. Try again!", "Nothing but dark matter.", "Houston, no win.", "Recalibrating the thrusters…"],
      welcome: "Welcome, commander! Set the thrust and press LAUNCH", twist: "ALL WINS ×3"
    }
  };

  var noop = function () {};
  var sfx = window.TNC_sfx || {};
  ["setTheme", "setMuted", "press", "spinStart", "startSpinLoop", "stopSpinLoop", "reelStop", "scatter", "anticipation",
   "lineBlip", "countTick", "noWin", "win", "bigWin", "megaWin", "jackpot", "freeSpins", "feature", "bonusStart",
   "reveal", "collect", "wheelTick", "wheelStop", "ladderUp", "ladderFail", "tilt", "chip"].forEach(function (k) { if (!sfx[k]) sfx[k] = noop; });
  if (!sfx.isMuted) sfx.isMuted = function () { return true; };

  function rnd(n) { return Math.floor(Math.random() * n); }
  function fmt(n) { return Number(n).toLocaleString("en-US"); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function hex(c) { return parseInt(c.slice(1), 16); }
  function newRequestId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16); crypto.getRandomValues(b);
    return Array.from(b, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
  }
  var ease = {
    lin: function (t) { return t; },
    out: function (t) { return 1 - Math.pow(1 - t, 3); },
    inOut: function (t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
    back: function (t) { var c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    in: function (t) { return t * t * t; }
  };

  /* ═══════════════ Painted art (Canvas 2D -> textures) ═══════════════ */
  var RES = Math.min(3, Math.max(2, window.devicePixelRatio || 1));
  function paint(w, h, draw) {
    var c = document.createElement("canvas");
    c.width = Math.ceil(w * RES); c.height = Math.ceil(h * RES);
    var x = c.getContext("2d");
    x.scale(RES, RES);
    draw(x, w, h);
    // A texture at RES pixels per unit: the sprite is w × h at scale 1, so scaling it later stays right.
    return new PIXI.Sprite(new PIXI.Texture({ source: new PIXI.CanvasSource({ resource: c, resolution: RES }) }));
  }
  function texOf(w, h, draw) { return paint(w, h, draw).texture; }
  function grad(x, y0, y1, stops) {
    var g = x.createLinearGradient(0, y0, 0, y1);
    stops.forEach(function (c, i) { g.addColorStop(i / (stops.length - 1), c); });
    return g;
  }
  function rr(x, px, py, w, h, r) { x.beginPath(); x.roundRect(px, py, w, h, r); }

  /* ═══════════════ Build ═══════════════ */
  async function build(root, id, game) {
    var api = window.TNC_API, Auth = window.TNC_Auth, GU = window.TNC_Units && window.TNC_Units.game;
    var T = THEMES[game.theme] || THEMES.cosmic;
    var REELS = game.engine.reels || 5, ROWS = game.engine.rows || 3, PAYLINES = game.engine.paylines;
    var syms = game.symbols, K = { wild: -1, scatter: -1, bonus: -1, top: -1 };
    syms.forEach(function (s, i) { if (s.kind) K[s.kind] = i; else K.top = i; });
    var FS = game.freeSpins, BON = game.bonus, JPC = game.jackpot || null, COL = game.collector || null, S = game.payScale || 1;
    var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    var R = function (ms) { return reduce ? Math.min(ms, Math.max(60, ms * 0.25)) : ms; };
    sfx.setTheme(game.theme);

    function amt(n) { return GU ? GU.format(n) : fmt(n) + " tSats"; }
    function num(n) { return GU ? GU.value(n) : fmt(n); }
    function unit() { return GU ? GU.unit() : "tSats"; }
    function fmtMult(m) { return m % 1 ? m.toFixed(1).replace(/\.0$/, "") : String(m); }
    function signedIn() { return !!(Auth && Auth.user); }
    function currentBalance() { return signedIn() && typeof Auth.balance === "number" ? Auth.balance : 0; }

    /* --- Page: the stage for the canvas, then the parts that stay HTML --- */
    root.innerHTML =
      '<div class="px-stage" id="px-stage"><div class="px-machine" id="slot-machine" role="application" aria-label="' + esc(game.name) + ' slot machine. Press Space to spin and to stop the reels.">' +
        '<div class="px-canvas" id="px-canvas"></div></div></div>' +
      '<p class="sr-only" id="sr-live" role="status" aria-live="polite"></p>' +
      '<section class="panel m-extras" aria-label="Credit unit and account"><div class="m-util">' +
        '<button type="button" class="unit-switch" id="unit-switch" role="switch" aria-label="Show credit in tBCH">' +
          '<span class="us-opt" data-u="sat">tSats</span><span class="us-opt" data-u="bch">tBCH</span></button>' +
        '<button type="button" class="btn-ghost" id="px-sound">🔊 Sound</button>' +
        '<a class="btn-ghost" href="?pixi=0">🎰 Classic machine</a>' +
        '<a class="btn-ghost" href="../fairness.html">⚖️ Verify spins</a></div>' +
        '<p class="px-note">Press ' + esc(T.spin) + ' · or press <b>Space</b> key</p></section>' +
      '<section class="panel" aria-labelledby="hist-title"><h2 class="panel-label" id="hist-title">RECENT SPINS</h2>' +
        '<ol class="history" id="history"><li class="history-empty">No spins yet. The reels are warm.</li></ol></section>';
    var stageEl = document.getElementById("px-stage"), machineEl = document.getElementById("slot-machine");
    var hostEl = document.getElementById("px-canvas"), historyEl = document.getElementById("history");
    var srLive = document.getElementById("sr-live"), unitSw = document.getElementById("unit-switch"), soundBtn = document.getElementById("px-sound");

    if (document.fonts && document.fonts.load) {
      try { await Promise.race([Promise.all([document.fonts.load("40px Bungee"), document.fonts.ready]), sleep(1500)]); } catch (e) {}
    }
    var app = new PIXI.Application();
    await app.init({ width: W, height: H, backgroundAlpha: 0, antialias: true, resolution: Math.min(2, window.devicePixelRatio || 1), autoDensity: true });
    hostEl.appendChild(app.canvas);
    app.canvas.setAttribute("aria-hidden", "true");
    var world = new PIXI.Container();   // everything, shaken as one
    app.stage.addChild(world);
    function fit() {
      var w = Math.min(hostEl.clientWidth || W, W);
      app.renderer.resize(w, Math.round(w * H / W));
      app.stage.scale.set(w / W);
    }
    fit();
    window.addEventListener("resize", fit);

    /* --- Tweens on the ticker --- */
    var tweens = [];
    app.ticker.add(function () {
      var now = performance.now();
      for (var i = tweens.length - 1; i >= 0; i--) {
        var t = tweens[i], p = Math.max(0, Math.min(1, (now - t.t0) / t.ms));
        t.fn(t.ease(p));
        if (p >= 1) { tweens.splice(i, 1); t.res(); }
      }
    });
    function animate(ms, fn, e) {
      return new Promise(function (res) { tweens.push({ t0: performance.now(), ms: Math.max(1, ms), fn: fn, ease: e || ease.out, res: res }); });
    }
    function txt(s, style) {
      var t = new PIXI.Text({ text: s, style: Object.assign({ fontFamily: SIGN, fontSize: 24, fill: T.text }, style || {}) });
      t.anchor.set(0.5);
      return t;
    }
    function button(view, onTap) {
      view.eventMode = "static"; view.cursor = "pointer";
      view.on("pointertap", function (e) { if (!view._off) onTap(e); });
      return view;
    }
    function setOff(view, off) { view._off = off; view.alpha = off ? 0.45 : 1; view.cursor = off ? "default" : "pointer"; }

    /* ═══ Layers ═══ */
    var L = {};
    ["back", "jackpots", "cabinet", "reels", "lines", "fx", "panel", "stage", "banner", "particles"].forEach(function (k) {
      L[k] = new PIXI.Container(); world.addChild(L[k]);
    });

    /* ═══ Jackpot rows: GRAND, then MAJOR and MINOR ═══ */
    var JR = {};
    function jpRow(key, x, y, w, h, label, colors, big) {
      var c = new PIXI.Container(); c.position.set(x, y);
      c.addChild(paint(w, h, function (g) {
        g.shadowColor = colors[2]; g.shadowBlur = 14;
        rr(g, 3, 3, w - 6, h - 6, 12); g.fillStyle = grad(g, 0, h, colors.slice(0, 2)); g.fill();
        g.shadowBlur = 0; g.lineWidth = 2.5; g.strokeStyle = colors[2]; g.stroke();
      }));
      var name = txt(label, { fontSize: big ? 22 : 18, fill: colors[3], letterSpacing: 4 });
      name.anchor.set(0, 0.5); name.position.set(22, h / 2);
      var val = txt("…", { fontFamily: MONO, fontWeight: "700", fontSize: big ? 34 : 24, fill: colors[4],
        dropShadow: { color: colors[2], blur: 10, distance: 0, alpha: 0.9 } });
      val.anchor.set(1, 0.5); val.position.set(w - 22, h / 2);
      c.addChild(name, val);
      L.jackpots.addChild(c);
      JR[key] = { c: c, val: val, sats: null, cycle: null, shown: null, won: false };
    }
    jpRow("grand", 20, 8, 720, 64, "GRAND", ["#3a0a12", "#14040a", "#ff4d5e", "#ffb3bb", "#fff1d0"], true);
    jpRow("major", 20, 80, 356, 50, "MAJOR", ["#2a1260", "#160a36", "#9a6bff", "#e0c3ff", "#e0c3ff"]);
    jpRow("minor", 384, 80, 356, 50, "MINOR", ["#0b2a4a", "#071a30", "#2ec5ff", "#9ff0ff", "#9ff0ff"]);
    function paintJp(r) { if (r.shown != null && !r.won) r.val.text = num(Math.round(r.shown)) + " " + unit(); }
    function jpTo(r, sats, cycle) {
      if (r.cycle != null && cycle > r.cycle) {   // won (by someone, or our own spin): WON!, then the new amount
        r.won = true; r.val.text = "WON!";
        animate(R(2200), function (p) { r.val.alpha = Math.floor(p * 12) % 2 ? 0.35 : 1; }, ease.lin).then(function () {
          r.won = false; r.val.alpha = 1; r.shown = sats; paintJp(r);
        });
      } else if (!r.won) {
        var from = r.shown == null ? sats : r.shown;
        animate(R(1100), function (p) { r.shown = from + (sats - from) * p; paintJp(r); });
      }
      r.sats = sats; r.cycle = cycle;
    }

    /* ═══ Cabinet ═══ */
    L.cabinet.addChild(paint(W - 20, 930, function (g, w, h) {
      g.shadowColor = T.neon; g.shadowBlur = 28;
      g.beginPath(); g.moveTo(40, 6); g.lineTo(w - 40, 6); g.lineTo(w - 6, 40); g.lineTo(w - 6, h - 6); g.lineTo(6, h - 6); g.lineTo(6, 40); g.closePath();
      g.fillStyle = grad(g, 0, h, [T.bg[0], T.bg[1], "#05020f"]); g.fill();
      g.shadowBlur = 0; g.lineWidth = 3; g.strokeStyle = T.neon; g.stroke();
      // grid lines
      g.save(); g.clip(); g.globalAlpha = 0.08; g.strokeStyle = T.neon2; g.lineWidth = 1;
      for (var y = 20; y < h; y += 28) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      for (var x0 = 14; x0 < w; x0 += 28) { g.beginPath(); g.moveTo(x0, 0); g.lineTo(x0, h); g.stroke(); }
      g.restore();
    })).position.set(10, 140);
    var title = txt(T.title, { fontSize: 50, fill: "#f2e6ff", letterSpacing: 3,
      dropShadow: { color: T.neon, blur: 18, distance: 0, alpha: 1 }, stroke: { color: "#2a0f5a", width: 3 } });
    title.position.set(W / 2, 196);
    L.cabinet.addChild(title);
    // The feature bar (or, in free spins, the free-spin sign)
    var featBar = new PIXI.Container(); featBar.position.set(W / 2, 252); L.cabinet.addChild(featBar);
    function setFeatBar(s, hot) {
      featBar.removeChildren();
      var t = txt(s, { fontSize: 15, fill: hot ? "#2a1c02" : "#cfe0ff", letterSpacing: 1.5 });
      var w = Math.min(700, t.width + 40);
      featBar.addChild(paint(w, 34, function (g) {
        rr(g, 1, 1, w - 2, 32, 9); g.fillStyle = hot ? grad(g, 0, 34, ["#fff1c4", "#ffd166"]) : "rgba(46,197,255,.08)"; g.fill();
        g.lineWidth = 1.5; g.strokeStyle = hot ? "#fff6dc" : "rgba(46,197,255,.55)"; g.stroke();
      }));
      featBar.children[0].position.set(-w / 2, -17);
      featBar.addChild(t);
    }
    var FEATURES = syms[K.wild].emoji + " " + game.featureName.toUpperCase() + "   " + syms[K.scatter].emoji + " " + FS.name.toUpperCase() + "   " + syms[K.bonus].emoji + " " + BON.name.toUpperCase();
    setFeatBar(FEATURES);

    // The reel window (frame) and the collector's tank
    var RW = REELS * CW + (REELS - 1) * GAP, RH = ROWS * CH;
    L.cabinet.addChild(paint(RW + 24, RH + 24, function (g, w, h) {
      g.shadowColor = T.neon2; g.shadowBlur = 18; rr(g, 4, 4, w - 8, h - 8, 14); g.fillStyle = "#05030f"; g.fill();
      g.shadowBlur = 0; g.lineWidth = 3; g.strokeStyle = T.neon; g.stroke();
    })).position.set(RX - 12, RY - 12);
    var TX = RX + RW + 26, TW = W - 20 - TX - 6, TY = RY - 12, TH = RH + 24;
    var tank = new PIXI.Container(); tank.position.set(TX, TY); L.cabinet.addChild(tank);

    /* ═══ Symbols (one texture per symbol: a card with its emoji) ═══ */
    var SYMTEX = syms.map(function (s, i) {
      var kind = s.kind;
      return texOf(CW, CH, function (g, w, h) {
        rr(g, 3, 3, w - 6, h - 6, 12);
        g.fillStyle = grad(g, 0, h, kind === "wild" ? ["#fff4d6", "#ffd166"] : kind ? ["#fff8ec", "#efe2ff"] : T.card); g.fill();
        if (kind) { g.lineWidth = 3; g.strokeStyle = kind === "wild" ? "#f7931a" : kind === "scatter" ? "#f5c542" : "#7dff8a"; g.stroke(); }
        g.font = "56px " + EMOJI; g.textAlign = "center"; g.textBaseline = "middle";
        g.shadowColor = "rgba(0,0,0,.25)"; g.shadowBlur = 4; g.shadowOffsetY = 2;
        g.fillText(s.emoji, w / 2, h / 2 + (kind ? -6 : 2));
        if (kind) {
          g.shadowBlur = 0; g.shadowOffsetY = 0;
          var label = kind.toUpperCase();
          g.font = "700 12px " + SIGN.split(",")[0];
          var lw = g.measureText(label).width + 14;
          rr(g, (w - lw) / 2, h - 24, lw, 16, 5);
          g.fillStyle = kind === "wild" ? "#d7263d" : kind === "scatter" ? "#f5c542" : "#2ea84a"; g.fill();
          g.fillStyle = kind === "scatter" ? "#2a1c02" : "#fff"; g.fillText(label, w / 2, h - 15.5);
        }
      });
    });
    function emojiTex(e, size, glow) {
      return texOf(size, size, function (g, w, h) {
        g.font = Math.round(size * 0.78) + "px " + EMOJI; g.textAlign = "center"; g.textBaseline = "middle";
        if (glow) { g.shadowColor = glow; g.shadowBlur = size * 0.2; }
        g.fillText(e, w / 2, h / 2 + size * 0.04);
      });
    }
    // Blurred look while turning: random symbols by their weights
    var pickers = [];
    for (var pc = 0; pc < REELS; pc++) {
      var ids = [], tot = 0;
      syms.forEach(function (s, i) { if (!s.reels || s.reels.indexOf(pc) !== -1) { ids.push([i, s.weight]); tot += s.weight; } });
      pickers.push((function (ids, tot) { return function () { var x = rnd(tot); for (var j = 0; j < ids.length; j++) { if (x < ids[j][1]) return ids[j][0]; x -= ids[j][1]; } return ids[0][0]; }; }(ids, tot)));
    }

    /* ═══ Reels ═══ */
    var reelMask = new PIXI.Graphics().rect(RX, RY, RW, RH).fill(0xffffff);
    L.reels.addChild(reelMask);
    var reelsBox = new PIXI.Container(); reelsBox.mask = reelMask; L.reels.addChild(reelsBox);
    var grid = [];
    function Reel(c) {
      this.c = c; this.box = new PIXI.Container(); this.box.position.set(RX + c * (CW + GAP), RY); reelsBox.addChild(this.box);
      this.sprites = []; this.mode = "idle"; this.offset = 0; this.speed = 0; this.cells = [];
      this.blur = new PIXI.BlurFilter({ strengthX: 0, strengthY: 0, quality: 2 });
      this.box.filters = [this.blur];
    }
    Reel.prototype.setStatic = function (col) {
      this.box.removeChildren(); this.sprites = []; this.cells = [];
      for (var r = 0; r < ROWS; r++) {
        var s = new PIXI.Sprite(SYMTEX[col[r]]); s.anchor.set(0.5); s.position.set(CW / 2, r * CH + CH / 2);
        this.box.addChild(s); this.cells.push(s);
      }
      this.mode = "idle"; this.blur.strengthY = 0;
    };
    Reel.prototype.start = function () {
      this.box.removeChildren(); this.sprites = []; this.cells = [];
      for (var k = 0; k < ROWS + 2; k++) {
        var s = new PIXI.Sprite(SYMTEX[pickers[this.c]()]); s.anchor.set(0.5); s.x = CW / 2;
        this.box.addChild(s); this.sprites.push(s);
      }
      this.offset = 0; this.speed = 0; this.mode = "spin";
      var self = this;
      animate(R(260), function (p) { self.speed = 2.6 * p; self.blur.strengthY = 7 * p; });
    };
    Reel.prototype.tick = function (dt) {
      if (this.mode !== "spin") return;
      this.offset += this.speed * dt;
      while (this.offset >= CH) {
        this.offset -= CH;
        var last = this.sprites.pop(); last.texture = SYMTEX[pickers[this.c]()]; this.sprites.unshift(last);
      }
      for (var k = 0; k < this.sprites.length; k++) this.sprites[k].y = (k - 1) * CH + CH / 2 + this.offset;
    };
    // Land on `col`: the final symbols come down from above and settle with a small bounce.
    Reel.prototype.land = function (col, ms) {
      var self = this, F = 6;
      this.mode = "land";
      this.box.removeChildren(); this.sprites = []; this.cells = [];
      var list = [pickers[this.c]()].concat(col);
      for (var k = 0; k < F; k++) list.push(pickers[this.c]());
      var items = list.map(function (sym, j) {
        var s = new PIXI.Sprite(SYMTEX[sym]); s.anchor.set(0.5); s.x = CW / 2; self.box.addChild(s); return s;
      });
      this.cells = items.slice(1, 1 + ROWS);
      var startShift = -F * CH;
      function place(shift) { items.forEach(function (s, j) { s.y = (j - 1) * CH + CH / 2 + shift; }); }
      place(startShift);
      return animate(ms, function (p) { place(startShift * (1 - p)); self.blur.strengthY = 7 * Math.max(0, 1 - p * 1.6); }, ease.back).then(function () {
        self.blur.strengthY = 0; self.setStatic(col);
      });
    };
    var reels = [];
    for (var ri = 0; ri < REELS; ri++) reels.push(new Reel(ri));
    app.ticker.add(function (tk) { var dt = Math.min(50, tk.deltaMS); reels.forEach(function (r) { r.tick(dt); }); });   // speed: px per ms
    function cellXY(c, r) { return { x: RX + c * (CW + GAP) + CW / 2, y: RY + r * CH + CH / 2 }; }
    for (var gc = 0; gc < REELS; gc++) { var col0 = []; for (var gr = 0; gr < ROWS; gr++) col0.push(pickers[gc]()); grid.push(col0); reels[gc].setStatic(col0); }

    /* ═══ The collector: the Fuel Tank ═══ */
    var TANK = { filled: 0, size: COL ? COL.size : 1, cycle: null, level: 0, full: false };
    var tankGlass = paint(TW, TH, function (g, w, h) {
      g.shadowColor = T.neon; g.shadowBlur = 16; rr(g, 4, 4, w - 8, h - 8, 10); g.fillStyle = "rgba(10,6,30,.92)"; g.fill();
      g.shadowBlur = 0; g.lineWidth = 2.5; g.strokeStyle = T.neon; g.stroke();
    });
    tank.addChild(tankGlass);
    var tankName = txt(COL ? COL.name.toUpperCase() : "", { fontSize: 13, fill: "#9ff0ff", letterSpacing: 1.5 }); tankName.position.set(TW / 2, 22); tank.addChild(tankName);
    var TIN = { x: 28, y: 44, w: TW - 56, h: TH - 92 };
    tank.addChild(paint(TIN.w + 8, TIN.h + 8, function (g, w, h) {
      rr(g, 3, 3, w - 6, h - 6, 18); g.fillStyle = "rgba(0,0,0,.55)"; g.fill(); g.lineWidth = 2; g.strokeStyle = "rgba(46,197,255,.8)"; g.stroke();
    })).position.set(TIN.x - 4, TIN.y - 4);
    var fuel = new PIXI.Graphics(); tank.addChild(fuel);
    var fuelMask = new PIXI.Graphics().roundRect(TIN.x, TIN.y, TIN.w, TIN.h, 15).fill(0xffffff); tank.addChild(fuelMask); fuel.mask = fuelMask;
    var marks = new PIXI.Graphics();
    for (var mk = 1; mk < 10; mk++) marks.moveTo(TIN.x + 4, TIN.y + TIN.h * mk / 10).lineTo(TIN.x + 14, TIN.y + TIN.h * mk / 10);
    marks.stroke({ width: 1.5, color: 0x9ff0ff, alpha: 0.5 }); tank.addChild(marks);
    var tankIcon = new PIXI.Sprite(emojiTex(COL ? COL.emoji : "⛽", 40)); tankIcon.anchor.set(0.5); tankIcon.position.set(TW / 2, TIN.y + 24); tankIcon.alpha = 0.9; tank.addChild(tankIcon);
    var tankCount = txt("", { fontFamily: MONO, fontWeight: "700", fontSize: 15, fill: "#fff6dc" }); tankCount.position.set(TW / 2, TH - 26); tank.addChild(tankCount);
    var tankFull = txt("FULL!", { fontSize: 26, fill: "#ffe79a", dropShadow: { color: "#ffb300", blur: 12, distance: 0, alpha: 1 }, stroke: { color: "#000", width: 3 } });
    tankFull.position.set(TW / 2, TIN.y + TIN.h / 2); tankFull.visible = false; tank.addChild(tankFull);
    var wave = 0;
    app.ticker.add(function (tk) {
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
    function paintTank(filled, size, animateIt) {
      TANK.filled = filled; TANK.size = size;
      tankCount.text = fmt(filled) + " / " + fmt(size);
      var to = size ? Math.min(1, filled / size) : 0, from = TANK.level;
      if (!animateIt || reduce) { TANK.level = to; return; }
      animate(1200, function (p) { TANK.level = from + (to - from) * p; });
    }
    function tankFlash(on) { TANK.full = on; tankFull.visible = on; tankGlass.tint = on ? 0xffe9a8 : 0xffffff; }
    if (!COL) tank.visible = false;

    /* ═══ Display (LCD) ═══ */
    L.cabinet.addChild(paint(668, 84, function (g, w, h) {
      rr(g, 2, 2, w - 4, h - 4, 10); g.fillStyle = "rgba(4,18,30,.92)"; g.fill(); g.lineWidth = 2; g.strokeStyle = "rgba(46,197,255,.6)"; g.stroke();
    })).position.set(46, 632);
    var lcdMain = txt("", { fontFamily: '"Courier New", monospace', fontWeight: "700", fontSize: 21, fill: "#9ff0ff",
      dropShadow: { color: "#2ec5ff", blur: 8, distance: 0, alpha: 0.8 } });
    lcdMain.position.set(W / 2, 662);
    var lcdSub = txt("", { fontFamily: '"Courier New", monospace', fontWeight: "700", fontSize: 14, fill: "#7fb8d6" });
    lcdSub.position.set(W / 2, 698);
    L.cabinet.addChild(lcdMain, lcdSub);
    var srTimer = 0;
    function setLcd(main, hot) {
      lcdMain.text = main;
      lcdMain.style.fill = hot ? "#ffe79a" : "#9ff0ff";
      lcdMain.scale.set(1);
      if (lcdMain.width > 640) lcdMain.scale.set(640 / lcdMain.width);   // one line, shrunk to fit
      renderLcdSub();
      var plain = String(main).replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, "").replace(/\s+/g, " ").trim();
      clearTimeout(srTimer); srLive.textContent = ""; srTimer = setTimeout(function () { srLive.textContent = plain; }, 60);
    }

    /* ═══ Deck: readouts, LAUNCH, throttle, on a console that slopes toward the player ═══
       The deck is drawn flat (DW × DH) into a render texture every frame and shown on a
       PerspectiveMesh: narrower at the back, wider at the front, like a cockpit console. Keys stand
       up from it (their side walls face the player), screens and the lever's slot are sunk into it.
       Taps are mapped back through the same projection to the flat deck. */
    var DW = 700, DH = 290, DX = 30, DY = 742;
    var deck = new PIXI.Container();
    var Q = [DX + 74, DY + 10, DX + DW - 74, DY + 10, DX + DW + 10, DY + DH - 2, DX - 10, DY + DH - 2];   // TL, TR, BR, BL
    // The slab under the console: its front edge, facing the player
    L.panel.addChild(paint(W, 40, function (g) {
      g.beginPath(); g.moveTo(Q[6], 0); g.lineTo(Q[4], 0); g.lineTo(Q[4] - 14, 24); g.lineTo(Q[6] + 14, 24); g.closePath();
      g.fillStyle = grad(g, 0, 24, ["#3a1f7a", "#140834"]); g.fill();
      g.lineWidth = 2; g.strokeStyle = T.neon2; g.shadowColor = T.neon2; g.shadowBlur = 10;
      g.beginPath(); g.moveTo(Q[6] + 14, 23); g.lineTo(Q[4] - 14, 23); g.stroke();
      g.shadowBlur = 0; g.strokeStyle = "rgba(255,255,255,.35)"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(Q[6], 1); g.lineTo(Q[4], 1); g.stroke();
    })).position.set(0, Q[5] - 1);
    // The console surface (painted flat, seen in perspective)
    deck.addChild(paint(DW, DH, function (g, w, h) {
      rr(g, 0, 0, w, h, 18); g.fillStyle = grad(g, 0, h, ["#2b1566", "#1a0b44", "#100628"]); g.fill();
      g.save(); g.clip();
      g.globalAlpha = 0.07; g.strokeStyle = "#ffffff"; g.lineWidth = 1;
      for (var y = 6; y < h; y += 5) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }   // brushed metal
      g.globalAlpha = 1; g.strokeStyle = "rgba(0,0,0,.45)"; g.lineWidth = 2;                         // panel seams
      [252, 528].forEach(function (x) { g.beginPath(); g.moveTo(x, 8); g.lineTo(x, h - 8); g.stroke(); });
      g.strokeStyle = "rgba(179,136,255,.18)"; g.lineWidth = 1;
      [254, 530].forEach(function (x) { g.beginPath(); g.moveTo(x, 8); g.lineTo(x, h - 8); g.stroke(); });
      g.restore();
      [[12, 12], [w - 12, 12], [12, h - 12], [w - 12, h - 12], [253, 12], [529, 12], [253, h - 12], [529, h - 12]].forEach(function (q) {   // rivets
        var rg = g.createRadialGradient(q[0] - 1, q[1] - 1, 0.5, q[0], q[1], 4); rg.addColorStop(0, "#d9ccff"); rg.addColorStop(1, "#3b2a7a");
        g.beginPath(); g.arc(q[0], q[1], 3.5, 0, Math.PI * 2); g.fillStyle = rg; g.fill();
      });
      rr(g, 1.5, 1.5, w - 3, h - 3, 17); g.lineWidth = 3; g.strokeStyle = "rgba(154,107,255,.85)"; g.stroke();
      g.lineWidth = 1; g.strokeStyle = "rgba(255,255,255,.25)"; rr(g, 5, 5, w - 10, h - 10, 14); g.stroke();
    }));
    // A recessed screen: dark glass sunk into the panel, its upper inner wall in shadow, a lit lip below.
    function recess(w, h, r) {
      return paint(w + 8, h + 8, function (g) {
        rr(g, 4, 6, w, h, r); g.fillStyle = "rgba(255,255,255,.18)"; g.fill();                  // lit lower lip
        rr(g, 4, 4, w, h, r); g.fillStyle = "#04020e"; g.fill();
        g.save(); rr(g, 4, 4, w, h, r); g.clip();
        g.shadowColor = "rgba(0,0,0,.95)"; g.shadowBlur = 14; g.shadowOffsetY = 8;               // inner shadow from the top wall
        g.lineWidth = 16; rr(g, -4, -4, w + 16, h + 16, r + 6); g.strokeStyle = "#000"; g.stroke();
        g.shadowColor = "rgba(46,197,255,.35)"; g.shadowBlur = 18; g.shadowOffsetY = 0; g.lineWidth = 2; rr(g, 4, 4, w, h, r); g.stroke();
        g.restore();
        rr(g, 4, 4, w, h, r); g.lineWidth = 1.5; g.strokeStyle = "rgba(154,107,255,.6)"; g.stroke();
      });
    }
    // A raised key: a top face and side walls toward the player (depth px), with a contact shadow.
    function keyArt(w, h, r, depth, top, wall) {
      return paint(w + 12, h + depth + 14, function (g) {
        g.shadowColor = "rgba(0,0,0,.7)"; g.shadowBlur = 10; g.shadowOffsetY = 4;
        rr(g, 6, 6 + depth, w, h, r); g.fillStyle = wall[1]; g.fill(); g.shadowBlur = 0; g.shadowOffsetY = 0;
        for (var d = depth; d > 0; d--) { rr(g, 6, 6 + d, w, h, r); g.fillStyle = d > depth / 2 ? wall[1] : wall[0]; g.fill(); }
        rr(g, 6, 6, w, h, r); g.fillStyle = grad(g, 6, 6 + h, top); g.fill();
        g.lineWidth = 1.5; g.strokeStyle = "rgba(255,255,255,.55)"; g.stroke();
      });
    }

    // Hit areas on the flat deck (the mesh maps taps back to them)
    var deckHits = [];
    function deckHit(x, y, w, h, view, fn) { deckHits.push({ x: x, y: y, w: w, h: h, view: view, fn: fn }); }

    // WIN and BALANCE: recessed screens
    function readout(label, x, y) {
      var c = new PIXI.Container(); c.position.set(x, y);
      var sc = recess(212, 112, 12); sc.position.set(-4, -4); c.addChild(sc);
      var l = txt(label, { fontSize: 14, fill: "#b9a6ff", letterSpacing: 3 }); l.position.set(106, 20);
      var v = txt("0", { fontFamily: MONO, fontWeight: "700", fontSize: 36, fill: "#ffffff", dropShadow: { color: T.neon, blur: 10, distance: 0, alpha: 0.9 } }); v.position.set(106, 60);
      var u = txt(unit(), { fontSize: 12, fill: "#8f86b8" }); u.position.set(106, 94);
      c.addChild(l, v, u); deck.addChild(c);
      return { v: v, u: u };
    }
    var winRO = readout("WIN", 22, 22), balRO = readout("BALANCE", 22, 156);
    var winShown = 0, balShown = currentBalance();

    // LAUNCH: a hexagonal key standing up from the console; it sinks when pressed.
    function hexPath(g, cx, cy, r) { g.beginPath(); for (var i = 0; i < 6; i++) { var a = Math.PI / 6 + i * Math.PI / 3; g.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a)); } g.closePath(); }
    var LDEPTH = 24, LR = 100;
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
    var launchLabel = txt(T.spin, { fontSize: 34, fill: "#fff", letterSpacing: 2, dropShadow: { color: "#5a0a6a", blur: 0, distance: 3, angle: Math.PI / 2, alpha: 1 } });
    launchLabel.y = -8;
    var launchSub = txt("", { fontSize: 15, fill: "#ffe6fb", letterSpacing: 1.5 }); launchSub.y = 30;
    launchTop.addChild(launchLabel, launchSub);
    var launchPulse = 0, launchDown = 0;
    app.ticker.add(function (tk) {
      launchPulse += tk.deltaMS / 600;
      launchTop.y = launchDown;
      launchWell.alpha = launch._off ? 0.5 : 0.75 + Math.sin(launchPulse) * 0.25;
    });
    function sinkKey(set, depth) {   // press: down, then back up
      return animate(R(90), function (p) { set(depth * p); }, ease.out).then(function () { return animate(R(160), function (p) { set(depth * (1 - p)); }, ease.out); });
    }
    function pressLaunch() { sinkKey(function (v) { launchDown = v; }, LDEPTH * 0.7); }
    deckHit(390 - LR, 130 - LR, LR * 2, LR * 2 + LDEPTH, launch, function () { press(); });

    // THRUST: the bet ladder 1 ... 1,000; a lever in a slot sunk into the console, ▲ ▼ keys below.
    var thr = new PIXI.Container(); thr.position.set(556, 12); deck.addChild(thr);
    var thrHead = txt(T.bet, { fontSize: 14, fill: "#b9a6ff", letterSpacing: 2 }); thrHead.position.set(63, 12); thr.addChild(thrHead);
    var slot = recess(18, 196, 9); slot.position.set(72, 24); thr.addChild(slot);
    var slotFill = paint(10, 190, function (g) { rr(g, 0, 0, 10, 190, 5); g.fillStyle = grad(g, 0, 190, ["#ff4fd8", "#6a1fb8"]); g.globalAlpha = 0.85; g.fill(); });
    slotFill.position.set(80, 31); thr.addChild(slotFill);
    var thrMarks = LADDER.map(function (v, i) {
      var y = 214 - i * 20, m = txt(v >= 1000 ? "1K" : String(v), { fontFamily: MONO, fontWeight: "700", fontSize: 13, fill: "#8f86b8" });
      m.anchor.set(1, 0.5); m.position.set(62, y); thr.addChild(m);
      deckHit(556 + 4, 12 + y - 10, 120, 20, null, function () { if (!busy) { sfx.chip(); setBet(v); } });
      return m;
    });
    var thrKnob = keyArt(40, 18, 6, 8, ["#ffffff", "#c7b6ff"], ["#8a73d9", "#4b3a8a"]);
    thrKnob.anchor.set(0.5, 0.42); thrKnob.x = 85; thr.addChild(thrKnob);
    var betVal = txt("", { fontFamily: MONO, fontWeight: "700", fontSize: 17, fill: "#fff" }); betVal.position.set(63, 252); thr.addChild(betVal);
    function smallKey(label, x) {
      var k = new PIXI.Container(); k.position.set(x, 252);
      var art = keyArt(34, 26, 7, 7, ["#8a6cff", "#4b2fa8"], ["#2c1a66", "#160a36"]); art.anchor.set(0.5, 0.4); k.addChild(art);
      var top = new PIXI.Container(); var t = txt(label, { fontSize: 15, fill: "#fff" }); t.y = -1; top.addChild(t); k.addChild(top);
      k._sink = function () { sinkKey(function (v) { art.y = v; top.y = v; }, 5); };
      thr.addChild(k);
      return k;
    }
    var betDown = smallKey("▼", 20), betUp = smallKey("▲", 106);
    deckHit(556 + 2, 12 + 236, 40, 34, betDown, function () { betDown._sink(); stepBet(-1); });
    deckHit(556 + 88, 12 + 236, 40, 34, betUp, function () { betUp._sink(); stepBet(1); });

    // The console in perspective
    var deckRT = PIXI.RenderTexture.create({ width: DW, height: DH, resolution: Math.min(2, (window.devicePixelRatio || 1) * 1.25) });
    var deckMesh = new PIXI.PerspectiveMesh({ texture: deckRT, verticesX: 12, verticesY: 12,
      x0: Q[0], y0: Q[1], x1: Q[2], y1: Q[3], x2: Q[4], y2: Q[5], x3: Q[6], y3: Q[7] });
    L.panel.addChild(deckMesh);
    app.ticker.add(function () { app.renderer.render({ container: deck, target: deckRT, clear: true }); });
    // Square -> quad homography (Heckbert), inverted to map a tap on the console back to the flat deck.
    var HM = (function (q) {
      var x0 = q[0], y0 = q[1], x1 = q[2], y1 = q[3], x2 = q[4], y2 = q[5], x3 = q[6], y3 = q[7];
      var dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
      var det = dx1 * dy2 - dx2 * dy1, gg = (dx3 * dy2 - dx2 * dy3) / det, hh = (dx1 * dy3 - dx3 * dy1) / det;
      var m = [x1 - x0 + gg * x1, x3 - x0 + hh * x3, x0, y1 - y0 + gg * y1, y3 - y0 + hh * y3, y0, gg, hh, 1];
      var A = m[0], B = m[1], C = m[2], D = m[3], E = m[4], F = m[5], G = m[6], Hh = m[7], I = m[8];
      return [E * I - F * Hh, C * Hh - B * I, B * F - C * E, F * G - D * I, A * I - C * G, C * D - A * F, D * Hh - E * G, B * G - A * Hh, A * E - B * D];
    }(Q));
    function toDeck(x, y) {
      var u = HM[0] * x + HM[1] * y + HM[2], v = HM[3] * x + HM[4] * y + HM[5], w = HM[6] * x + HM[7] * y + HM[8];
      return { x: u / w * DW, y: v / w * DH };
    }
    function hitAt(e) {
      var p = e.getLocalPosition(L.panel), d = toDeck(p.x, p.y);
      for (var i = 0; i < deckHits.length; i++) {
        var h = deckHits[i];
        if (d.x >= h.x && d.x <= h.x + h.w && d.y >= h.y && d.y <= h.y + h.h && !(h.view && h.view._off)) return h;
      }
      return null;
    }
    deckMesh.eventMode = "static";
    deckMesh.on("pointertap", function (e) { var h = hitAt(e); if (h) h.fn(); });
    deckMesh.on("pointermove", function (e) { deckMesh.cursor = hitAt(e) ? "pointer" : "default"; });

    // For tests: the panel point where a deck control is drawn.
    function deckPoint(x, y) {   // flat deck -> panel (the forward homography)
      var u = x / DW, v = y / DH, q = Q;
      var dx1 = q[2] - q[4], dx2 = q[6] - q[4], dx3 = q[0] - q[2] + q[4] - q[6], dy1 = q[3] - q[5], dy2 = q[7] - q[5], dy3 = q[1] - q[3] + q[5] - q[7];
      var det = dx1 * dy2 - dx2 * dy1, gg = (dx3 * dy2 - dx2 * dy3) / det, hh = (dx1 * dy3 - dx3 * dy1) / det;
      var a = q[2] - q[0] + gg * q[2], b = q[6] - q[0] + hh * q[6], d = q[3] - q[1] + gg * q[3], e = q[7] - q[1] + hh * q[7], w = gg * u + hh * v + 1;
      return { x: (a * u + b * v + q[0]) / w, y: (d * u + e * v + q[1]) / w };
    }

    /* ═══ State ═══ */
    var busy = false, feature = null, presentToken = 0, settle = 0;
    var reelsTurning = false, stopReq = false, stopWake = null;
    function clampBet(v) { return Math.max(1, Math.min(1000, Math.round(isFinite(v) ? v : 1))); }
    function ladderIndex(v) { var b = 0; for (var i = 1; i < LADDER.length; i++) if (Math.abs(Math.log(LADDER[i] / v)) < Math.abs(Math.log(LADDER[b] / v))) b = i; return b; }
    var bet = clampBet(parseInt((function () { try { return sessionStorage.getItem("tnc.bet." + id); } catch (e) { return null; } })(), 10) || 10);
    var playBet = bet;
    function setBet(v) {
      bet = clampBet(v);
      try { sessionStorage.setItem("tnc.bet." + id, String(bet)); } catch (e) {}
      var i = ladderIndex(bet);
      thrMarks.forEach(function (m, k) { m.style.fill = k === i ? "#ffffff" : "#8f86b8"; });
      animate(R(220), (function (from) { return function (p) { thrKnob.y = from + (214 - i * 20 - from) * p; slotFill.height = Math.max(4, 190 - (thrKnob.y - 31)); slotFill.y = thrKnob.y; }; })(thrKnob.y || 214));
      betVal.text = fmt(bet);
      updateControls();
      if (!busy) { renderLcdSub(); if (cantAfford()) showReady(); }
    }
    function stepBet(dir) {
      if (busy) return;
      var next = bet, i;
      if (dir > 0) { for (i = 0; i < LADDER.length; i++) if (LADDER[i] > bet) { next = LADDER[i]; break; } }
      else { for (i = LADDER.length - 1; i >= 0; i--) if (LADDER[i] < bet) { next = LADDER[i]; break; } }
      if (next !== bet) { sfx.chip(); setBet(next); setLcd("Bet " + fmt(bet) + " tSats. Press " + T.spin + "!"); }
    }
    function cantAfford() { return signedIn() && currentBalance() < bet; }
    var authKnown = !Auth;
    function updateControls() {
      var out = authKnown && !signedIn(), canStop = busy && reelsTurning && !stopReq;
      setOff(launch, (busy && !canStop) || (!busy && cantAfford()));
      launchSub.text = canStop ? "STOP" : busy ? (feature ? "FREE SPINS" : "GOOD LUCK") : out ? "SIGN IN" : "BET " + fmt(bet);
      [betUp, betDown].forEach(function (b) { setOff(b, busy); });
      thrMarks.forEach(function (m) { m.alpha = busy ? 0.55 : 1; });
    }
    function renderLcdSub() {
      lcdSub.text = feature
        ? (feature.reward ? feature.name + " " : "Free spin ") + feature.played + " / " + (feature.played + feature.left) +
          (feature.mult > 1 ? " · wins ×" + feature.mult : "") + (feature.reward ? " · bet " + fmt(playBet) + " tSats" : "") + " · won " + amt(feature.total)
        : "Bet " + fmt(bet) + " tSats · 10 lines";
    }
    function showReady() {
      if (authKnown && !signedIn()) { setLcd("Sign in to play. New accounts get " + amt(10000) + "."); return; }
      if (cantAfford()) { var b = currentBalance(); setLcd(b < 1 ? "Out of credit. Claim your daily bonus to play on." : "Lower your thrust: balance is " + amt(b) + ".", true); }
    }
    function renderFeature() {
      if (!feature) { setFeatBar(FEATURES); return; }
      setFeatBar((feature.reward ? feature.emoji + " " + feature.name.toUpperCase() : syms[K.scatter].emoji + " FREE SPINS") + "   " + feature.left + " LEFT" +
        (feature.mult > 1 ? "   WINS ×" + feature.mult : "") + (feature.locked ? "   " + syms[K.wild].emoji + " LOCKED" : "") + "   WON " + amt(feature.total), true);
    }

    /* ═══ Meters ═══ */
    function countUp(t, from, to, ms, token, tick) {
      return new Promise(function (res) {
        if (reduce || ms <= 0) { t.text = num(to); return res(); }
        var last = 0;
        animate(ms, function (p) {
          if (token != null && token !== presentToken) { if (t === balRO.v) t.text = num(balShown); return; }
          t.text = num(Math.round(from + (to - from) * p));
          var now = performance.now(); if (tick && now - last > 55 && p < 1) { sfx.countTick(); last = now; }
        }).then(res);
      });
    }
    function credit(sats, token, ms) { if (sats <= 0) return; var from = balShown; balShown += sats; countUp(balRO.v, from, balShown, ms, token, false); }
    function syncBalance() { balShown = currentBalance(); balRO.v.text = num(balShown); }
    function renderUnit() {
      var inBch = !!GU && GU.get() === "bch";
      unitSw.setAttribute("aria-checked", inBch ? "true" : "false");
      balRO.u.text = winRO.u.text = unit();
      balRO.v.text = num(balShown); winRO.v.text = num(winShown);
      Object.keys(JR).forEach(function (k) { paintJp(JR[k]); });
      if (!busy) renderLcdSub();
      if (feature) renderFeature();
    }

    /* ═══ Win lines and highlights ═══ */
    var lineG = new PIXI.Graphics(); L.lines.addChild(lineG);
    var lineGlow = new PIXI.Graphics(); lineGlow.filters = [new PIXI.BlurFilter({ strength: 6 })]; L.lines.addChildAt(lineGlow, 0);
    var hits = [], hitFrames = new PIXI.Graphics(); L.lines.addChild(hitFrames);
    var pulse = 0;
    app.ticker.add(function (tk) {
      pulse += tk.deltaMS / 180;
      hits.forEach(function (s) { if (s && !s.destroyed) s.scale.set(1 + Math.max(0, Math.sin(pulse)) * 0.08); });
    });
    function clearWins() {
      hits.forEach(function (s) { if (s && !s.destroyed) s.scale.set(1); });
      hits = []; lineG.clear(); lineGlow.clear(); hitFrames.clear();
    }
    function linePoints(li) {
      var pts = PAYLINES[li].map(function (r, c) { var p = cellXY(c, r); return [p.x, p.y]; });
      pts.unshift([RX - 8, pts[0][1]]); pts.push([RX + RW + 8, pts[pts.length - 1][1]]);
      return pts;
    }
    function drawLines(drawn) {   // drawn: [{ pts, color, p }]
      lineG.clear(); lineGlow.clear();
      drawn.forEach(function (d) {
        var total = 0, seg = [];
        for (var i = 1; i < d.pts.length; i++) { var l = Math.hypot(d.pts[i][0] - d.pts[i - 1][0], d.pts[i][1] - d.pts[i - 1][1]); seg.push(l); total += l; }
        var left = total * d.p;
        [lineGlow, lineG].forEach(function (g, gi) {
          g.moveTo(d.pts[0][0], d.pts[0][1]);
          var rem = left;
          for (var j = 1; j < d.pts.length && rem > 0; j++) {
            var f = Math.min(1, rem / seg[j - 1]);
            g.lineTo(d.pts[j - 1][0] + (d.pts[j][0] - d.pts[j - 1][0]) * f, d.pts[j - 1][1] + (d.pts[j][1] - d.pts[j - 1][1]) * f);
            rem -= seg[j - 1];
          }
          g.stroke(gi ? { width: 5, color: d.color, cap: "round", join: "round" } : { width: 16, color: d.color, alpha: 0.75, cap: "round", join: "round" });
        });
      });
    }
    function highlight(items, token) {
      var drawn = [];
      items.forEach(function (it) {
        (it.w.cells || []).forEach(function (rc) {
          var s = reels[rc[0]].cells[rc[1]];
          if (s && hits.indexOf(s) === -1) {
            hits.push(s);
            var p = cellXY(rc[0], rc[1]);
            hitFrames.roundRect(p.x - CW / 2 + 3, p.y - CH / 2 + 3, CW - 6, CH - 6, 12).stroke({ width: 4, color: 0xffd166 });
          }
        });
      });
      items.filter(function (it) { return it.type === "line"; }).forEach(function (it, k) {
        var d = { pts: linePoints(it.w.line), color: LINE_COLORS[it.w.line], p: reduce ? 1 : 0 };
        drawn.push(d);
        setTimeout(function () {
          if (token !== presentToken) return;
          sfx.lineBlip(k);
          animate(R(450), function (p) { d.p = p; drawLines(drawn); });
        }, reduce ? 0 : k * 220);
      });
      drawLines(drawn);
    }

    /* ═══ Overlays on the cells (fixed wilds, multipliers, jackpot and collect symbols) ═══ */
    var fixedLayer = new PIXI.Container(); L.fx.addChild(fixedLayer);
    var overLayer = new PIXI.Container(); L.fx.addChild(overLayer);
    function showFixed(keys) {
      fixedLayer.removeChildren();
      keys.forEach(function (k) {
        var p = k.split(","), xy = cellXY(+p[0], +p[1]), s = new PIXI.Sprite(SYMTEX[K.wild]);
        s.anchor.set(0.5); s.position.set(xy.x, xy.y); fixedLayer.addChild(s);
        var glow = new PIXI.Graphics().roundRect(xy.x - CW / 2 + 2, xy.y - CH / 2 + 2, CW - 4, CH - 4, 12).stroke({ width: 4, color: 0xffd166 });
        fixedLayer.addChild(glow);
      });
    }
    function badge(c, r, label) {
      var xy = cellXY(c, r), b = new PIXI.Container(); b.position.set(xy.x + 30, xy.y - 30);
      var bg = new PIXI.Graphics().circle(0, 0, 20).fill(0xd7263d).stroke({ width: 3, color: 0xffe79a });
      var t = txt(label, { fontSize: 16, fill: "#fff" });
      b.addChild(bg, t); b.scale.set(0); overLayer.addChild(b);
      animate(R(400), function (p) { b.scale.set(p); }, ease.back);
    }
    function overlayCells(cells, tex, size, stagger, corner) {
      return cells.map(function (rc, k) {
        var xy = cellXY(rc[0], rc[1]), s = new PIXI.Sprite(tex); s.anchor.set(0.5);
        s.position.set(xy.x + (corner ? 28 : 0), xy.y - (corner ? 28 : 0)); s.width = s.height = size; s.scale.set(0); s.rotation = -0.4;
        overLayer.addChild(s);
        var sc = size / tex.width;
        setTimeout(function () { animate(R(450), function (p) { s.scale.set(sc * p); s.rotation = -0.4 * (1 - p); }, ease.back); }, reduce ? 0 : k * stagger);
        return s;
      });
    }

    /* ═══ Particles (coins and emoji), over the whole machine ═══ */
    var coinTex = texOf(40, 40, function (g) {
      var rg = g.createRadialGradient(15, 13, 2, 20, 20, 19); rg.addColorStop(0, "#fff6c8"); rg.addColorStop(0.5, "#ffd166"); rg.addColorStop(1, "#b8860b");
      g.beginPath(); g.arc(20, 20, 18, 0, Math.PI * 2); g.fillStyle = rg; g.fill(); g.lineWidth = 2; g.strokeStyle = "#8a6508"; g.stroke();
      g.font = "700 18px " + SIGN.split(",")[0]; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = "#a87a12"; g.fillText("₿", 20, 21);
    });
    var burstTex = T.burst.map(function (e) { return emojiTex(e, 48); });
    var parts = [];
    app.ticker.add(function (tk) {
      var dt = Math.min(50, tk.deltaMS) / 16.67;
      for (var i = parts.length - 1; i >= 0; i--) {
        var p = parts[i];
        p.vy += p.g * dt; p.vx *= 0.995; p.s.x += p.vx * dt; p.s.y += p.vy * dt; p.s.rotation += p.vr * dt;
        if (p.flip) p.s.scale.x = p.sc * Math.cos(p.life * 0.15);
        p.life += dt;
        if (p.life > p.max - 20) p.s.alpha = Math.max(0, (p.max - p.life) / 20);
        if (p.s.y > H + 60 || p.life > p.max) { p.s.destroy(); parts.splice(i, 1); }
      }
    });
    function emit(n, x, y, opts) {
      if (reduce) n = Math.min(n, 12);
      opts = opts || {};
      for (var i = 0; i < n; i++) {
        var coin = opts.emoji ? Math.random() < 0.35 : true;
        var s = new PIXI.Sprite(coin ? coinTex : burstTex[rnd(burstTex.length)]);
        s.anchor.set(0.5); var sc = (coin ? 0.6 + Math.random() * 0.6 : 0.5 + Math.random() * 0.5); s.scale.set(sc);
        s.position.set(x + (Math.random() - 0.5) * (opts.spread || 60), y + (Math.random() - 0.5) * 20);
        L.particles.addChild(s);
        var a = -Math.PI / 2 + (Math.random() - 0.5) * (opts.cone || 1.9), v = (opts.power || 14) * (0.55 + Math.random() * 0.6);
        parts.push({ s: s, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vr: (Math.random() - 0.5) * 0.3, g: 0.42, life: 0, max: 150 + rnd(60), flip: coin, sc: sc });
      }
    }
    function rain(n, ms) {   // coins falling from the top over the whole machine
      var k = 0, t = setInterval(function () {
        for (var j = 0; j < 4 && k < n; j++, k++) {
          var s = new PIXI.Sprite(coinTex); s.anchor.set(0.5); var sc = 0.5 + Math.random() * 0.7; s.scale.set(sc);
          s.position.set(Math.random() * W, -30); L.particles.addChild(s);
          parts.push({ s: s, vx: (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 4, vr: (Math.random() - 0.5) * 0.2, g: 0.18, life: 0, max: 400, flip: true, sc: sc });
        }
        if (k >= n) clearInterval(t);
      }, Math.max(16, ms / (n / 4)));
    }

    /* ═══ Whole-machine moves: shake (canvas) and tilt (CSS 3D on the canvas) ═══ */
    function shake(ms, power) {
      if (reduce) return;
      animate(ms, function (p) { var a = power * (1 - p); world.x = (Math.random() - 0.5) * a; world.y = (Math.random() - 0.5) * a; }, ease.lin)
        .then(function () { world.x = world.y = 0; });
    }
    function tilt(kind) {
      machineEl.classList.remove("px-tilt-minor", "px-tilt-major", "px-tilt-grand", "px-tilt-big");
      void machineEl.offsetWidth;
      machineEl.classList.add("px-tilt-" + kind);
      clearTimeout(tilt.t);
      tilt.t = setTimeout(function () { machineEl.classList.remove("px-tilt-" + kind); }, 3400);
    }

    /* ═══ Banners ═══ */
    var banner = new PIXI.Container(); banner.position.set(W / 2, RY + RH / 2); banner.visible = false; L.banner.addChild(banner);
    var rays = new PIXI.Graphics();
    for (var rk = 0; rk < 16; rk++) { var a0 = rk * Math.PI / 8, a1 = a0 + Math.PI / 16; rays.moveTo(0, 0).lineTo(Math.cos(a0) * 420, Math.sin(a0) * 420).lineTo(Math.cos(a1) * 420, Math.sin(a1) * 420).closePath(); }
    rays.fill({ color: 0xffd166, alpha: 0.18 });
    var bannerBack = new PIXI.Graphics().roundRect(-300, -110, 600, 220, 26).fill({ color: 0x0a0418, alpha: 0.82 }).stroke({ width: 4, color: 0xffd166 });
    var bannerTitle = txt("", { fontSize: 58, fill: "#ffe79a", stroke: { color: "#7a3d00", width: 6 }, dropShadow: { color: "#ff9d00", blur: 22, distance: 0, alpha: 1 }, letterSpacing: 2 });
    bannerTitle.y = -34;
    var bannerAmt = txt("", { fontFamily: MONO, fontWeight: "800", fontSize: 42, fill: "#ffffff", dropShadow: { color: T.neon2, blur: 14, distance: 0, alpha: 1 } });
    bannerAmt.y = 42;
    banner.addChild(rays, bannerBack, bannerTitle, bannerAmt);
    var bannerSpin = 0;
    app.ticker.add(function (tk) { if (banner.visible) { bannerSpin += tk.deltaMS / 2400; rays.rotation = bannerSpin; } });
    function showBanner(title, amount, color) {
      bannerTitle.text = title; bannerAmt.text = amount || "";
      bannerTitle.style.fill = color || "#ffe79a";
      bannerAmt.visible = !!amount; bannerTitle.y = amount ? -34 : 0;
      bannerTitle.scale.set(1); bannerAmt.scale.set(1);
      var tw = PIXI.CanvasTextMetrics.measureText(title, bannerTitle.style).width, w = Math.max(420, Math.min(700, tw + 80));
      if (tw > w - 50) bannerTitle.scale.set((w - 50) / tw);
      bannerBack.clear().roundRect(-w / 2, -110, w, 220, 26).fill({ color: 0x0a0418, alpha: 0.82 }).stroke({ width: 4, color: 0xffd166 });
      banner.visible = true; banner.alpha = 1; banner.scale.set(0.2);
      animate(R(500), function (p) { banner.scale.set(0.2 + 0.8 * p); }, ease.back);
    }
    function hideBanner() {
      if (!banner.visible) return;
      animate(R(250), function (p) { banner.alpha = 1 - p; }).then(function () { banner.visible = false; banner.alpha = 1; });
    }

    /* ═══ Stage (bonus, jackpot wheel): a panel over the cabinet ═══ */
    var stage = new PIXI.Container(); stage.visible = false; L.stage.addChild(stage);
    function openStage(titleText, subText) {
      stage.removeChildren(); stage.visible = true; stage.alpha = 0;
      stage.addChild(paint(W - 60, 900, function (g, w, h) {
        g.shadowColor = T.neon; g.shadowBlur = 30; rr(g, 6, 6, w - 12, h - 12, 26);
        var rg = g.createRadialGradient(w / 2, 120, 20, w / 2, h / 2, h * 0.7); rg.addColorStop(0, "#2a1260"); rg.addColorStop(1, "#07041a");
        g.fillStyle = rg; g.fill(); g.shadowBlur = 0; g.lineWidth = 3; g.strokeStyle = T.neon2; g.stroke();
      })).position.set(30, 150);
      var t = txt(titleText, { fontSize: 44, fill: "#ffe79a", dropShadow: { color: "#ffb300", blur: 16, distance: 0, alpha: 1 } }); t.position.set(W / 2, 214);
      var s = txt(subText || "", { fontFamily: '"Courier New", monospace', fontWeight: "700", fontSize: 18, fill: "#7dff8a", wordWrap: true, wordWrapWidth: 620, align: "center" }); s.position.set(W / 2, 262);
      stage.addChild(t, s);
      animate(R(350), function (p) { stage.alpha = p; });
      return { sub: s };
    }
    function closeStage() { return animate(R(300), function (p) { stage.alpha = 1 - p; }).then(function () { stage.visible = false; stage.removeChildren(); }); }
    function stageButton(label, y, onTap) {
      var b = new PIXI.Container(); b.position.set(W / 2, y);
      var bg = paint(280, 64, function (g, w, h) { rr(g, 2, 2, w - 4, h - 4, 16); g.fillStyle = grad(g, 0, h, ["#ff6b81", "#b0102a"]); g.fill(); g.lineWidth = 3; g.strokeStyle = "#ffe79a"; g.stroke(); });
      bg.anchor.set(0.5); b.addChild(bg, txt(label, { fontSize: 24, fill: "#fff" }));
      stage.addChild(b);
      return button(b, function () { setOff(b, true); onTap(); });
    }

    /* ═══ Celebration of an amount ═══ */
    var TIERS = { none: 0, win: 700, big: 1400, mega: 2200, jackpot: 3200 };
    var WAIT = { none: 700, win: 1100, big: 2300, mega: 2900, jackpot: 4300 };
    var SETTLE_MS = 500;
    function celebrate(total, tier, token, title) {
      winShown = total;
      countUp(winRO.v, 0, total, R(TIERS[tier]), token, true);
      credit(total, token, R(TIERS[tier]));
      if (tier === "win" || tier === "none") { if (total > 0) { sfx.win(); emit(8 + Math.min(20, Math.round(total / playBet)), RX + RW / 2, RY + RH, { power: 11 }); } return; }
      showBanner(title || { big: "BIG WIN!", mega: "MEGA WIN!", jackpot: "TOP PRIZE!" }[tier], amt(total));
      ({ big: sfx.bigWin, mega: sfx.megaWin, jackpot: sfx.jackpot }[tier]).call(sfx);
      emit({ big: 40, mega: 80, jackpot: 120 }[tier], RX + RW / 2, RY + RH + 20, { emoji: true, power: 18, spread: 300 });
      if (tier !== "big") { shake(R(900), 14); tilt("big"); }
      if (tier === "jackpot") rain(120, 1800);
      setTimeout(function () { if (token === presentToken) hideBanner(); }, { big: 2200, mega: 2800, jackpot: 4200 }[tier]);
    }

    /* ═══ Reel timing ═══ */
    function stoppable(ms) {
      if (stopReq || ms <= 0) return Promise.resolve();
      return new Promise(function (resolve) { var t = setTimeout(done, ms); function done() { clearTimeout(t); stopWake = null; resolve(); } stopWake = done; });
    }
    function requestStop() {
      if (!reelsTurning || stopReq) return;
      stopReq = true; sfx.press();
      if (stopWake) stopWake();
      updateControls();
    }
    function startReels() { reelsTurning = true; stopReq = false; updateControls(); reels.forEach(function (r) { r.start(); }); sfx.startSpinLoop(); }
    async function stopAll(target) {
      var seen = 0, landings = [];
      for (var i = 0; i < REELS; i++) {
        if (seen >= 2 && i >= 2 && !stopReq) {
          sfx.anticipation(R(1300) / 1000);
          var r0 = reels[i]; animate(R(1300), function (p) { r0.speed = 2.6 + 1.6 * p; }, ease.lin);
          await stoppable(R(1300));
        } else if (i > 0) await (stopReq ? sleep(R(70)) : stoppable(R(420)));
        var n = target[i].filter(function (k) { return k === K.scatter; }).length;
        landings.push(reels[i].land(target[i], stopReq ? R(200) : R(560)).then((function (idx, cnt, has) {
          return function () { sfx.reelStop(idx); if (has) sfx.scatter(cnt); };
        }(i, seen + n, n > 0))));
        seen += n;
      }
      reelsTurning = false; stopReq = false; updateControls();
      await Promise.all(landings);
      sfx.stopSpinLoop();
      await sleep(R(200));
    }

    /* ═══ One spin step (the paid spin or a free spin; several phases = respins) ═══ */
    var firstGrid = null;
    function phaseItems(ph) {
      var items = (ph.lines || []).map(function (w) { return { type: "line", w: w, sats: w.win }; });
      if (ph.scatter && ph.scatter.win > 0) items.push({ type: "scatter", w: ph.scatter, sats: ph.scatter.win });
      return { items: items, total: ph.win || 0 };
    }
    function tierOf(ph, total) {
      var jp = (ph.lines || []).filter(function (w) { return w.count === 5 && (w.symbol === K.wild || w.symbol === K.top); })[0];
      if (jp) return { tier: "jackpot", jp: jp };
      if (total >= playBet * 50) return { tier: "mega" };
      if (total >= playBet * 10) return { tier: "big" };
      return { tier: total > 0 ? "win" : "none" };
    }
    function describe(ph, p, t) {
      if (t.tier === "jackpot") return "TOP PRIZE! 5× " + syms[t.jp.symbol].emoji + " on line " + (t.jp.line + 1) + " · " + amt(p.total);
      var lines = ph.lines || [], parts = [];
      if (lines.length === 1) parts.push("Line " + (lines[0].line + 1) + ": " + lines[0].count + "× " + syms[lines[0].symbol].emoji + (lines[0].wildMult > 1 ? " (wild ×" + lines[0].wildMult + ")" : ""));
      else if (lines.length > 1) parts.push(lines.length + " lines win");
      if (ph.scatter && ph.scatter.win > 0) parts.push(ph.scatter.count + "× " + syms[K.scatter].emoji + " scatter");
      return parts.join(" + ") + " · " + amt(p.total);
    }
    async function playSpinStep(st, prespun) {
      var free = !!st.free, token = ++presentToken;
      if (!prespun) { hideBanner(); clearWins(); overLayer.removeChildren(); winRO.v.text = "0"; winShown = 0; }
      if (free) {
        if (feature.played > 0 && st.multiplier > feature.mult) { setLcd((feature.reward ? feature.name : "Hyperspace") + ": wins ×" + st.multiplier + "!", true); sfx.feature(); }
        feature.played = st.freeSpin; feature.left = st.spinsLeft; feature.mult = st.multiplier;
        renderFeature(); setLcd("Free spin " + feature.played + "… good luck!");
      }
      var roundTotal = 0, lastTier = "none", phases = st.phases || [];
      for (var pi = 0; pi < phases.length; pi++) {
        var ph = phases[pi], fixedKeys = (ph.fixed || []).map(function (rc) { return rc[0] + "," + rc[1]; });
        if (pi > 0) { token = ++presentToken; hideBanner(); clearWins(); setLcd("Lucky respin " + pi + "…", true); sfx.feature(); await sleep(R(900)); }
        if (pi === 0) overLayer.removeChildren();
        showFixed(fixedKeys);
        if (!(prespun && pi === 0)) { sfx.spinStart(); startReels(); await stoppable(R(pi ? 600 : 1000)); }
        await stopAll(ph.grid);
        showFixed([]);
        grid = ph.display || ph.grid;
        if (ph.expanded && ph.expanded.length) {
          ph.expanded.forEach(function (c) { reels[c].setStatic([K.wild, K.wild, K.wild]); });
          setLcd(syms[K.wild].emoji + " Expanding " + syms[K.wild].name + "!", true); sfx.feature(); await sleep(R(750));
        }
        if (ph.wildMults && Object.keys(ph.wildMults).length) {
          Object.keys(ph.wildMults).forEach(function (k) { var q = k.split(","); badge(+q[0], +q[1], "×" + ph.wildMults[k]); });
          sfx.feature(); await sleep(R(650));
        }
        var p = phaseItems(ph), t = tierOf(ph, p.total);
        roundTotal += p.total; lastTier = t.tier;
        highlight(p.items, token);
        if (!p.items.length) {
          if (!ph.bonusCells) { setLcd(free ? "No win on this free spin." : T.quips[rnd(T.quips.length)]); sfx.noWin(); }
        } else {
          setLcd(describe(ph, p, t), true);
          celebrate(p.total, t.tier, token);
        }
        settle = p.total > 0 ? Math.max({ none: 0, win: 700, big: 2200, mega: 2800, jackpot: 4200 }[t.tier], p.items.length * 220 + 450) + SETTLE_MS : 0;
        if (pi < phases.length - 1) await sleep(Math.max(R(1100), WAIT[t.tier]));
      }
      if (free) { feature.total += roundTotal; renderFeature(); renderLcdSub(); }
      else firstGrid = phases.length ? phases[0].grid : grid;
      addHistory(free ? "free spin" : "bet " + fmt(bet) + " tSats", free ? roundTotal : roundTotal - bet, roundTotal, lastTier);
      return WAIT[lastTier];
    }

    /* ═══ Bonus: the Warp Ladder (Cosmic Voyage) ═══ */
    async function runBonus(st) {
      var token = ++presentToken;
      await sleep(R(700));
      hideBanner();
      showBanner(BON.name.toUpperCase() + "!", "BONUS GAME");
      setLcd(syms[K.bonus].emoji + " " + BON.name + " bonus!", true); sfx.bonusStart();
      emit(30, W / 2, RY + RH, { emoji: true });
      await sleep(R(2000)); hideBanner(); clearWins();
      if (BON.type === "ladder") await playLadder(st); else await playGenericBonus(st);
      await closeStage();
      token = ++presentToken;
      var won = st.win, tier = won >= playBet * 50 ? "mega" : won >= playBet * 10 ? "big" : won > 0 ? "win" : "none";
      if (won > 0) { setLcd(BON.name + " paid " + fmtMult(st.prize) + "× = " + amt(won), true); celebrate(won, tier === "win" ? "big" : tier, token, "BONUS WIN!"); }
      else { setLcd(BON.name + ": no prize this time."); winRO.v.text = "0"; winShown = 0; sfx.noWin(); }
      if (feature) { feature.total += won; renderFeature(); renderLcdSub(); }
      addHistory("bonus", won, won, tier);
      await sleep(R(2400));
      if (token === presentToken) hideBanner();
      settle = won > 0 ? SETTLE_MS : 0;
    }
    function playLadder(st) {
      return new Promise(function (resolve) {
        var lv = BON.levels, ui = openStage("🛰️ " + BON.name.toUpperCase(), "Ignite the engines and climb!");
        var rows = lv.map(function (v, i) {
          var y = 860 - i * 62, c = new PIXI.Container(); c.position.set(330, y);
          var bg = new PIXI.Graphics(); c.addChild(bg);
          var n = txt(String(i + 1), { fontSize: 18, fill: "#8f86b8" }); n.position.set(-210, 0);
          var t = txt(fmt(v) + "×", { fontSize: 26, fill: "#ffd166" }); t.position.set(-40, 0);
          var s = txt("≈ " + amt(Math.floor(playBet * v * S)), { fontFamily: MONO, fontSize: 15, fill: "#8f86b8" }); s.anchor.set(1, 0.5); s.position.set(220, 0);
          c.addChild(n, t, s); stage.addChild(c);
          return { c: c, bg: bg };
        });
        var rocket = new PIXI.Sprite(emojiTex("🚀", 90)); rocket.anchor.set(0.5); rocket.position.set(640, 860); rocket.rotation = -Math.PI / 4; stage.addChild(rocket);
        var level = 0;
        function mark(fail) {
          rows.forEach(function (r, i) {
            r.bg.clear().roundRect(-230, -26, 460, 52, 12).fill(i === level ? (fail ? 0x7a0d17 : 0x6a2fe0) : i < level ? 0x163a2a : 0x0c0826)
              .stroke({ width: 2, color: i === level ? 0xffffff : 0x4b3a8a });
          });
        }
        mark();
        var started = false;
        var go = stageButton("IGNITE", 960, run);
        async function run() {
          if (started) return; started = true; setOff(go, true);
          var boosts = st.boosts || [];
          for (var k = 0; k < boosts.length; k++) {
            ui.sub.text = "Boosting to level " + (level + 2) + "…";
            await animate(R(700), function (p) { rocket.x = 640 + Math.sin(p * 40) * 3; }, ease.lin);
            if (boosts[k]) {
              level++; mark(); sfx.ladderUp(level);
              var y0 = rocket.y; await animate(R(350), function (p) { rocket.y = y0 - 62 * p; });
              ui.sub.text = "Level " + (level + 1) + ": " + fmt(lv[level]) + "×!";
              emit(10, rocket.x, rocket.y + 30, { power: 8, cone: 3 });
            } else {
              mark(true); sfx.ladderFail(); shake(R(400), 8);
              ui.sub.text = "Engines cut out at level " + (level + 1) + ": " + fmt(lv[level]) + "×";
              await sleep(R(900)); return resolve();
            }
          }
          ui.sub.text = "TOP OF THE LADDER! " + fmt(lv[level]) + "×";
          await sleep(R(900)); resolve();
        }
        setTimeout(function () { if (!started) run(); }, reduce ? 1500 : 12000);
      });
    }
    async function playGenericBonus(st) { openStage(BON.name.toUpperCase(), "Prize: " + fmtMult(st.prize) + "×"); await sleep(R(1800)); }

    /* ═══ Free spins and rewards ═══ */
    async function startFeature(spins) {
      feature = { left: spins, played: 0, total: 0, mult: FS.progressive ? FS.progressive.start : (FS.multiplier || 1) };
      updateControls(); renderFeature();
      var token = ++presentToken; hideBanner(); clearWins();
      showBanner("FREE SPINS!", spins + " SPINS · " + T.twist);
      setLcd(spins + " " + FS.name.toLowerCase() + "!", true); sfx.freeSpins();
      emit(40, W / 2, RY + RH, { emoji: true, spread: 300 });
      await sleep(R(2400)); if (token === presentToken) hideBanner();
    }
    function endFeature(st) {
      var f0 = feature, total = st.win;
      feature = null; renderFeature(); showFixed([]);
      var t2 = ++presentToken; hideBanner(); clearWins();
      showBanner(f0 && f0.reward ? f0.name.toUpperCase() + " OVER" : "FEATURE OVER", st.played + " SPINS WON " + amt(total));
      setLcd((f0 && f0.reward ? f0.name : "Free spins") + " over: " + st.played + " spins won " + amt(total), total > 0);
      winShown = total; winRO.v.text = num(total);
      if (total >= playBet * 10) { sfx.bigWin(); emit(60, W / 2, RY + RH, { emoji: true, spread: 300 }); } else if (total > 0) sfx.win(); else sfx.noWin();
      setTimeout(function () { if (t2 === presentToken) hideBanner(); }, R(2600));
      settle = total > 0 ? R(2600) + SETTLE_MS : 0;
    }
    async function startReward(st) {
      var Rw = COL.reward;
      playBet = st.bet || bet;
      feature = { left: st.spins, played: 0, total: 0, mult: Math.max(1, Rw.multiplier || 1), reward: true, name: Rw.name, emoji: COL.emoji, locked: Rw.lockedWild || null };
      updateControls(); renderFeature();
      var token = ++presentToken; hideBanner(); clearWins();
      showBanner(Rw.name.toUpperCase() + "!", st.spins + " SPINS" + (Rw.rise ? " · RISING ×" : ""));
      setLcd(Rw.name + ": " + st.spins + " free spins at " + fmt(playBet) + " tSats!", true); sfx.freeSpins();
      emit(50, TX + TW / 2, TY + 40, { emoji: true });
      await sleep(R(2400)); if (token === presentToken) hideBanner();
    }
    function rewardDone() { playBet = bet; tankFlash(false); paintTank(0, TANK.size, false); TANK.cycle = (TANK.cycle || 0) + 1; }

    /* ═══ A jackpot won in the game: 3 🌠, the Star Map Wheel, the celebration ═══ */
    var JP = {
      minor: { title: "MINOR JACKPOT!", ms: 3200, coins: 80, shake: 10, color: "#9ff0ff" },
      major: { title: "MAJOR JACKPOT!", ms: 4400, coins: 160, shake: 16, color: "#e0c3ff" },
      grand: { title: "GRAND JACKPOT!", ms: 5600, coins: 260, shake: 22, color: "#ffd166" }
    };
    function backToFirstGrid() {
      if (!firstGrid) return false;
      var same = firstGrid.every(function (col, c) { return col.every(function (v, r) { return grid[c] && grid[c][r] === v; }); });
      if (same) return false;
      for (var c = 0; c < REELS; c++) reels[c].setStatic(firstGrid[c]);
      grid = firstGrid; clearWins(); return true;
    }
    async function showJackpot(st) {
      var token = ++presentToken;
      hideBanner(); clearWins(); overLayer.removeChildren();
      if (backToFirstGrid()) { setLcd("Back to your spin…"); await sleep(R(500)); }
      overlayCells(st.cells, emojiTex(JPC.emoji, 96, "#ffd166"), 90, 260);
      sfx.scatter(st.cells.length);
      setLcd(st.cells.length + " " + JPC.emoji + " shooting stars! The " + JPC.name + " spins.", true);
      await sleep(R(1700));
      await playStarWheel(st);
      await closeStage();
      await celebrateJackpot(st, token);
    }
    function playStarWheel(st) {
      return new Promise(function (resolve) {
        var ui = openStage("🌠 " + JPC.name.toUpperCase(), "Spin the wheel for your jackpot!");
        var slices = JPC.slices, n = slices.length, seg = Math.PI * 2 / n, RAD = 230;
        var cols = { minor: "#1f6fb2", major: "#7b3fe4", grand: "#e0313f" };
        var wheel = paint(RAD * 2 + 20, RAD * 2 + 20, function (g, w) {
          var c = w / 2;
          g.shadowColor = T.neon2; g.shadowBlur = 24; g.beginPath(); g.arc(c, c, RAD, 0, Math.PI * 2); g.fillStyle = "#120a2e"; g.fill(); g.shadowBlur = 0;
          slices.forEach(function (t, i) {
            var a0 = -Math.PI / 2 + i * seg, a1 = a0 + seg;
            g.beginPath(); g.moveTo(c, c); g.arc(c, c, RAD - 8, a0, a1); g.closePath(); g.fillStyle = cols[t]; g.fill();
            g.lineWidth = 2; g.strokeStyle = "#9ff0ff"; g.stroke();
            g.save(); g.translate(c, c); g.rotate(a0 + seg / 2 + Math.PI / 2);
            g.font = "24px " + SIGN.split(",")[0]; g.textAlign = "center"; g.fillStyle = "#fff"; g.fillText(TIER_NAMES[t], 0, -RAD * 0.6); g.restore();
          });
          g.lineWidth = 10; g.strokeStyle = T.neon; g.beginPath(); g.arc(c, c, RAD - 4, 0, Math.PI * 2); g.stroke();
          g.beginPath(); g.arc(c, c, 34, 0, Math.PI * 2); g.fillStyle = "#120a2e"; g.fill(); g.lineWidth = 4; g.strokeStyle = "#9ff0ff"; g.stroke();
        });
        wheel.anchor.set(0.5); wheel.position.set(W / 2, 600); stage.addChild(wheel);
        var hub = new PIXI.Sprite(emojiTex("🌠", 50)); hub.anchor.set(0.5); hub.position.copyFrom(wheel.position); stage.addChild(hub);
        var pointer = new PIXI.Graphics().poly([-22, 0, 22, 0, 0, 40]).fill(0xff4d5e).stroke({ width: 3, color: 0xffffff });
        pointer.position.set(W / 2, 600 - RAD - 26); stage.addChild(pointer);
        var started = false, go = stageButton("SPIN THE WHEEL", 920, spinIt);
        function spinIt() {
          if (started) return; started = true; setOff(go, true);
          ui.sub.text = "The stars are turning…";
          var idx = st.slice != null ? st.slice : slices.indexOf(st.tier);
          var target = Math.PI * 2 * 5 + (Math.PI * 2 - (idx + 0.5) * seg) + (Math.random() - 0.5) * seg * 0.6, last = -1;
          animate(R(4600), function (p) {
            wheel.rotation = target * p;
            var s = Math.floor(wheel.rotation / seg); if (s !== last) { last = s; sfx.wheelTick(); }
          }, function (t) { return 1 - Math.pow(1 - t, 4); }).then(function () {
            sfx.wheelStop();
            ui.sub.text = "The wheel stops on the " + TIER_NAMES[st.tier] + " JACKPOT!";
            emit(40, W / 2, 380, { emoji: true });
            setTimeout(resolve, R(1100));
          });
        }
        setTimeout(function () { if (!started && stage.visible) spinIt(); }, reduce ? 1200 : 9000);
      });
    }
    async function celebrateJackpot(st, token) {
      var tier = st.tier || st.pool, c = JP[tier] || JP.major, win = st.win || 0;
      var bchs = window.TNC_Units ? TNC_Units.format(win) : fmt(win) + " tSats";
      token = ++presentToken;
      clearWins();
      winShown = win; countUp(winRO.v, 0, win, R(2400), token, true); credit(win, token, R(2400));
      showBanner(c.title, bchs, c.color);
      tilt(tier); shake(R(1200), c.shake);
      (tier === "minor" ? sfx.bigWin : tier === "major" ? sfx.megaWin : sfx.jackpot).call(sfx);
      emit(Math.round(c.coins / 2), W / 2, RY + RH, { emoji: true, power: 20, spread: 400 });
      rain(c.coins, R(c.ms * 0.6));
      setLcd(c.title + " " + bchs, true);
      lcdSub.text = "Won with the " + JPC.name + ".";
      addHistory(tier + " jackpot", win, win, "jackpot");
      await sleep(R(c.ms));
      if (token === presentToken) hideBanner();
      overLayer.removeChildren();
      settle = SETTLE_MS;
    }

    /* ═══ Collect symbols: onto their cells, then into the Fuel Tank ═══ */
    async function playCollect(st) {
      if (!COL || !st.cells || !st.cells.length) { if (st.filled != null) paintTank(st.filled, st.size, true); return; }
      if (backToFirstGrid()) await sleep(R(400));
      var tex = emojiTex(COL.emoji, 64, "#9ff0ff");
      var items = overlayCells(st.cells, tex, 52, 140, true);
      sfx.chip();
      await sleep(R(650 + st.cells.length * 140));
      var tx = TX + TW / 2, ty = TY + TIN.y + TIN.h * 0.5;
      await Promise.all(items.map(function (s, k) {
        var x0 = s.x, y0 = s.y, s0 = s.scale.x;
        return sleep(reduce ? 0 : k * 90).then(function () {
          return animate(R(700), function (p) {
            s.x = x0 + (tx - x0) * p; s.y = y0 + (ty - y0) * p - Math.sin(p * Math.PI) * 120; s.scale.set(s0 * (1 - 0.6 * p)); s.rotation = p * 6;
          }, ease.inOut).then(function () { s.destroy(); emit(6, tx, ty, { power: 6, cone: 3 }); });
        });
      }));
      sfx.collect();
      paintTank(st.full ? st.size : st.filled, st.size, true);
      if (!st.full) { lcdSub.text = COL.emoji + " +" + st.cells.length + " · " + COL.name + " " + fmt(st.filled) + " / " + fmt(st.size); return; }
      tankFlash(true);
      var token = ++presentToken; hideBanner(); clearWins();
      showBanner(COL.name.toUpperCase() + " FULL!", COL.reward.name.toUpperCase());
      setLcd(COL.emoji + " You filled the " + COL.name + "! " + COL.reward.name + " at " + fmt(st.bet || bet) + " tSats a spin.", true);
      sfx.freeSpins(); tilt("minor");
      emit(50, tx, ty, { emoji: true, power: 16 });
      await sleep(R(2600)); if (token === presentToken) hideBanner();
    }

    /* ═══ Steps ═══ */
    async function playSteps(steps) {
      var wait = 0, first = true;
      for (var i = 0; i < steps.length; i++) {
        var st = steps[i];
        if (st.type === "spin") {
          if (st.free && i > 0 && steps[i - 1].type !== "freeSpinsStart" && steps[i - 1].type !== "rewardStart") await sleep(Math.max(R(900), wait));
          wait = await playSpinStep(st, first); first = false;
        } else if (st.type === "bonus") { await sleep(Math.max(600, wait)); await runBonus(st); wait = 0; }
        else if (st.type === "freeSpinsStart") { await sleep(Math.max(900, wait)); await startFeature(st.spins); wait = 0; }
        else if (st.type === "retrigger") { if (feature) { feature.left = st.spinsLeft; renderFeature(); renderLcdSub(); } setLcd(syms[K.scatter].emoji + " Retrigger +" + st.added + "!", true); sfx.scatter(5); }
        else if (st.type === "freeSpinsEnd") { var wasReward = !!(feature && feature.reward); await sleep(Math.max(R(900), wait)); endFeature(st); if (wasReward) rewardDone(); wait = 0; }
        else if (st.type === "jackpot") { await sleep(Math.max(R(900), Math.min(wait, 1500))); if (st.cells && JPC) await showJackpot(st); else await celebrateJackpot(st); wait = 0; }
        else if (st.type === "collect") { await sleep(R(Math.min(wait, 600))); await playCollect(st); wait = st.full ? 0 : wait; }
        else if (st.type === "rewardStart") { await sleep(R(700)); await startReward(st); wait = 0; }
      }
    }

    /* ═══ A paid spin ═══ */
    function requestSpin(amount) {
      var rid = newRequestId();
      return (function attempt(n) {
        return api.spin(id, amount, rid).then(function (r) {
          var retry = r.status === 0 || r.status === 502 || r.status === 503 || r.status === 504;
          if (retry && n < SPIN_RETRIES) { if (n === 0) setLcd("Connection hiccup. Retrying your spin…"); return sleep(800 * Math.pow(2, n)).then(function () { return attempt(n + 1); }); }
          return r;
        });
      }(0));
    }
    function press() {
      if (busy) { requestStop(); return; }
      if (!signedIn()) { if (Auth) location.assign(Auth.loginHref()); return; }
      spin();
    }
    async function spin() {
      if (busy) return;
      if (cantAfford()) { var b = currentBalance(); setLcd(b < 1 ? "TILT! Out of credit. Claim your daily bonus to play on." : "TILT! Bet " + fmt(bet) + " tSats is more than your " + amt(b) + ".", true); sfx.tilt(); shake(R(400), 8); return; }
      sfx.press();
      pressLaunch();
      busy = true; playBet = bet; updateControls();
      if (window.TNC_Jackpots) TNC_Jackpots.hold();
      ++presentToken; hideBanner(); clearWins(); overLayer.removeChildren();
      winRO.v.text = "0"; winShown = 0;
      balShown = currentBalance() - bet; balRO.v.text = num(balShown);
      setLcd("Reels spinning… good luck!");
      sfx.spinStart(); startReels();
      var t0 = Date.now();
      var r = await requestSpin(bet);
      if (r.status !== 200 || !r.data || !r.data.steps) { await spinFailed(r); return; }
      await stoppable(R(1000) - (Date.now() - t0));
      try { settle = 0; await playSteps(r.data.steps); if (settle > 0) await sleep(settle); }
      finally {
        if (window.TNC_Jackpots) TNC_Jackpots.release();
        busy = false; feature = null; playBet = bet; tankFlash(false); renderFeature();
        if (Auth) Auth.setBalance(r.data.balance);
        syncBalance(); updateControls(); showReady();
      }
    }
    async function spinFailed(r) {
      if (window.TNC_Jackpots) TNC_Jackpots.release();
      sfx.stopSpinLoop(); reelsTurning = false; stopReq = false;
      for (var c = 0; c < REELS; c++) reels[c].setStatic(grid[c]);
      busy = false;
      if (r.status === 401) { if (Auth) Auth.set(null); setLcd("Your session ended. Sign in to keep playing.", true); }
      else { setLcd(api.errorText(r), true); sfx.tilt(); if ((r.status === 0 || r.status >= 500) && Auth) await Auth.refresh(); }
      syncBalance(); updateControls();
    }

    /* ═══ Recent spins (HTML) ═══ */
    function addHistory(kind, net, win, tier) {
      var empty = historyEl.querySelector(".history-empty"); if (empty) empty.remove();
      var li = document.createElement("li");
      li.className = (win > 0 ? "is-win" : "") + (tier === "big" || tier === "mega" || tier === "jackpot" ? " is-big" : "");
      var line = kind === "bonus" ? syms[K.bonus].emoji + " " + esc(BON.name)
        : /jackpot/.test(kind) ? (/grand/.test(kind) ? "🏆 Grand" : /minor/.test(kind) ? "✨ Minor" : "⭐ Major") + " jackpot"
        : grid.map(function (col) { return syms[col[1]].emoji; }).join("");
      li.innerHTML = '<span class="h-line">' + line + '</span><span class="h-kind">' + esc(kind) + '</span><span class="h-amt" data-sats="' + Math.abs(net) +
        '" data-sign="' + (net >= 0 ? "+" : "−") + '">' + (net >= 0 ? "+" : "−") + amt(Math.abs(net)) + '</span>';
      historyEl.insertBefore(li, historyEl.firstChild);
      while (historyEl.children.length > 12) historyEl.removeChild(historyEl.lastChild);
    }

    /* ═══ Jackpot readings (held while a spin plays, by jackpots.js) ═══ */
    if (window.TNC_Jackpots && TNC_Jackpots.onRender) {
      TNC_Jackpots.onRender(function (d) {
        if (!d || !d.grand) return;
        var g = d.games && d.games[id];
        jpTo(JR.grand, d.grand.amount, d.grand.cycle);
        if (g && g.major) jpTo(JR.major, g.major.amount, g.major.cycle);
        if (g && g.minor) jpTo(JR.minor, g.minor.amount, g.minor.cycle);
        if (g && g.collector && COL) {
          var cl = g.collector;
          if (TANK.cycle != null && cl.cycle > TANK.cycle && !busy) {   // someone else filled it
            paintTank(cl.size, cl.size, true); tankFlash(true);
            setTimeout(function () { tankFlash(false); paintTank(cl.filled, cl.size, true); }, R(2200));
          } else paintTank(cl.filled, cl.size, TANK.cycle != null);
          TANK.cycle = cl.cycle;
        }
      });
    }

    /* ═══ Wiring ═══ */
    document.addEventListener("keydown", function (e) {
      var t = e.target, tag = t && t.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || (t && t.isContentEditable)) return;
      if (!(e.code === "Space" || e.key === " ")) return;
      if (tag === "BUTTON" || tag === "A" || tag === "SUMMARY") return;
      e.preventDefault(); press();
    });
    if (GU) { unitSw.addEventListener("click", function () { sfx.chip(); GU.toggle(); }); GU.onChange(renderUnit); } else unitSw.hidden = true;
    function renderSound() { var m = sfx.isMuted(); soundBtn.textContent = m ? "🔇 Sound off" : "🔊 Sound on"; soundBtn.setAttribute("aria-pressed", m ? "false" : "true"); }
    soundBtn.addEventListener("click", function () { sfx.setMuted(!sfx.isMuted()); renderSound(); if (!sfx.isMuted()) sfx.win(); });
    if (Auth) {
      Auth.onChange(function () { authKnown = true; if (!busy) { syncBalance(); updateControls(); showReady(); } });
      (Auth.ready || Promise.resolve()).then(function () { authKnown = true; if (!busy) { syncBalance(); updateControls(); showReady(); } });
    }

    renderSound(); renderUnit(); setBet(bet); syncBalance();
    setLcd(T.welcome);
    showReady();
    // For tests: what the machine is doing.
    window.TNC_PixiState = function () { var lp = deckPoint(390, 130), up = deckPoint(556 + 106, 12 + 252); return { launchAt: lp, betUpAt: up, busy: busy, feature: feature, tank: { filled: TANK.filled, size: TANK.size }, jackpots: { grand: JR.grand.val.text, major: JR.major.val.text, minor: JR.minor.val.text }, lcd: lcdMain.text, banner: banner.visible ? bannerTitle.text + " | " + bannerAmt.text : "", stage: stage.visible }; };
  }

  window.TNC_PixiMachine = { build: build, supports: function (game) { return !!THEMES[game.theme] && !!PIXI; } };
})();
