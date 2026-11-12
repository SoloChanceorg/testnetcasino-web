/*
 * TestnetCasino.com: the slot machines drawn with PixiJS (the engine).
 *
 * The whole machine is one canvas: the jackpot rows, the cabinet, the reels, the collector,
 * the display, the readouts, the spin key and the bet control, the banners, the particles
 * and the bonus and jackpot stages. slot.js loads PixiJS, this file and the game's skin.
 *
 * The engine is shared by every game: the reels, the spin and its steps, win lines, banners,
 * particles, the stage, the console in perspective (and taps mapped back to it), full screen,
 * the jackpot rows and the collector's level. Each game has a skin (pixi-<theme>.js) that
 * registers with TNC_PixiMachine.skin(theme, skin): its colours and words, the cabinet, the
 * collector, the controls on the console, the bonus game and the jackpot show.
 * The paytable and rules come from slot.js (TNC_Slot.paytableSection).
 *
 * Same contract as before: every outcome comes from POST /spins as `steps[]`, and this file only
 * animates them (paid spin and respins, expanding and multiplier wilds, sticky and locked wilds,
 * free spins, the bonus, a jackpot won in the game, collect symbols into the collector, its reward).
 * Randomness here is cosmetic only (blurred symbols while the reels turn, particles, closed picks).
 *
 * Static art is painted with Canvas 2D into textures (gradients, glows, rounded panels); PixiJS
 * moves it. The canvas sits in a 3D stage, so the whole machine can tilt (CSS) on MINOR and up.
 * SPACE (or the spin key) spins, and stops the reels while they turn.
 *
 * Depends on: PixiJS 8 (window.PIXI), api.js, auth.js, units.js, jackpots.js (onRender),
 *             audio.js (TNC_sfx, optional).
 */
(function () {
  "use strict";

  var PIXI = window.PIXI;
  var W = 760, H = 1080;                 // the machine's own coordinates; scaled to the page
  // Room around the machine inside the canvas: the console flares wider than the cabinet at its front
  // edge, and the neon glows; PX/PT/PB keep all of it inside the canvas (nothing cut at the corners).
  var PX = 22, PT = 10, PB = 14, VW = W + 2 * PX, VH = H + PT + PB;
  var CW = 100, CH = 100, GAP = 6;       // one reel cell; GAP: the divider between two reels
  var RX = 46, RY = 300;                 // top left of the reels
  var FY = 736;                          // the fold: the cabinet's upper body above, the console below
  var EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  var SIGN = '"Bungee", "Poppins", sans-serif', MONO = '"SF Mono", ui-monospace, Menlo, Consolas, monospace';
  // The selected coin (D46): tBTC bets 1 to 100 sats, tBCH 1 to 1,000. Every skin draws ten stops.
  var COIN = window.TNC_Coin ? window.TNC_Coin.get() : "bch";
  var TICKER = window.TNC_Coin ? window.TNC_Coin.ticker(COIN) : "tBCH", SATS = TICKER + " sats";
  var LADDER = COIN === "btc" ? [1, 2, 3, 5, 10, 15, 20, 30, 50, 100] : [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
  var MAX_BET = LADDER[LADDER.length - 1];
  var LINE_COLORS = [0xffd166, 0x06d6a0, 0xef476f, 0x4cc9f0, 0xf78c6b, 0xc86bff, 0x83e377, 0xff99c8, 0xf9c74f, 0x90e0ef];
  var TIER_NAMES = { minor: "MINOR", major: "MAJOR", grand: "GRAND" };
  var SPIN_RETRIES = 3;
  var SKINS = {};

  var noop = function () {};
  var sfx = window.TNC_sfx || {};
  ["setTheme", "setMuted", "press", "spinStart", "startSpinLoop", "stopSpinLoop", "reelStop", "scatter", "anticipation",
   "lineBlip", "countTick", "noWin", "win", "bigWin", "megaWin", "jackpot", "freeSpins", "feature", "bonusStart",
   "reveal", "collect", "collectItem", "collectFull", "pour", "wheelTick", "wheelStop", "ladderUp", "ladderFail", "tilt", "chip"].forEach(function (k) { if (!sfx[k]) sfx[k] = noop; });
  if (!sfx.isMuted) sfx.isMuted = function () { return true; };

  function rnd(n) { return Math.floor(Math.random() * n); }
  function fmt(n) { return Number(n).toLocaleString("en-US"); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
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
    in: function (t) { return t * t * t; },
    wheel: function (t) { return 1 - Math.pow(1 - t, 4); }
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
  function hgrad(x, x0, x1, stops) {
    var g = x.createLinearGradient(x0, 0, x1, 0);
    stops.forEach(function (c, i) { g.addColorStop(i / (stops.length - 1), c); });
    return g;
  }
  function rr(x, px, py, w, h, r) { x.beginPath(); x.roundRect(px, py, w, h, r); }
  // The inverse of the homography that maps the unit square to the quad q = [TL, TR, BR, BL] (x, y pairs,
  // Heckbert): apply it to (x, y, 1) and divide by the third value to get (u, v) in 0..1.
  function quadInverse(q) {
    var x0 = q[0], y0 = q[1], x1 = q[2], y1 = q[3], x2 = q[4], y2 = q[5], x3 = q[6], y3 = q[7];
    var dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
    var det = dx1 * dy2 - dx2 * dy1, gg = det ? (dx3 * dy2 - dx2 * dy3) / det : 0, hh = det ? (dx1 * dy3 - dx3 * dy1) / det : 0;
    var A = x1 - x0 + gg * x1, B = x3 - x0 + hh * x3, C = x0, D = y1 - y0 + gg * y1, E = y3 - y0 + hh * y3, F = y0, G = gg, Hh = hh, I = 1;
    return [E * I - F * Hh, C * Hh - B * I, B * F - C * E, F * G - D * I, A * I - C * G, C * D - A * F, D * Hh - E * G, B * G - A * Hh, A * E - B * D];
  }
  function applyInverse(m, x, y) { var w = m[6] * x + m[7] * y + m[8]; return { u: (m[0] * x + m[1] * y + m[2]) / w, v: (m[3] * x + m[4] * y + m[5]) / w }; }
  // The forward homography: (u, v) in the unit square -> the point in the quad q.
  function quadPoint(q, u, v) {
    var dx1 = q[2] - q[4], dx2 = q[6] - q[4], dx3 = q[0] - q[2] + q[4] - q[6], dy1 = q[3] - q[5], dy2 = q[7] - q[5], dy3 = q[1] - q[3] + q[5] - q[7];
    var det = dx1 * dy2 - dx2 * dy1, gg = (dx3 * dy2 - dx2 * dy3) / det, hh = (dx1 * dy3 - dx3 * dy1) / det;
    var a = q[2] - q[0] + gg * q[2], b = q[6] - q[0] + hh * q[6], d = q[3] - q[1] + gg * q[3], e = q[7] - q[1] + hh * q[7], w = gg * u + hh * v + 1;
    return { x: (a * u + b * v + q[0]) / w, y: (d * u + e * v + q[1]) / w };
  }

  /* ═══════════════ Build ═══════════════ */
  async function build(root, id, game) {
    var api = window.TNC_API, Auth = window.TNC_Auth, GU = window.TNC_Units && window.TNC_Units.game;
    var skin = SKINS[game.theme], T = skin.theme;
    var REELS = game.engine.reels || 5, ROWS = game.engine.rows || 3, PAYLINES = game.engine.paylines;
    var syms = game.symbols, K = { wild: -1, scatter: -1, bonus: -1, top: -1 };
    syms.forEach(function (s, i) { if (s.kind) K[s.kind] = i; else K.top = i; });
    var FS = game.freeSpins, BON = game.bonus, JPC = game.jackpot || null, COL = game.collector || null, S = game.payScale || 1;
    var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Every wait and move goes through R: shorter with reduced motion, and 1.2× faster during free spins (`feature`).
    var FS_SPEED = 1.2;
    var R = function (ms) { if (feature) ms = ms / FS_SPEED; return reduce ? Math.min(ms, Math.max(60, ms * 0.25)) : ms; };
    function reelSpeed() { return feature ? 2.6 * FS_SPEED : 2.6; }   // px per ms while a reel turns
    sfx.setTheme(game.theme);

    function amt(n) { return GU ? GU.format(n) : fmt(n) + " " + SATS; }
    function num(n) { return GU ? GU.value(n) : fmt(n); }
    function unit() { return GU ? GU.unit() : SATS; }
    function fmtMult(m) { return m % 1 ? m.toFixed(1).replace(/\.0$/, "") : String(m); }
    function signedIn() { return !!(Auth && Auth.user); }
    function currentBalance() { return signedIn() && typeof Auth.balance === "number" ? Auth.balance : 0; }

    /* --- Page: the stage for the canvas, then the parts that stay HTML --- */
    root.innerHTML =
      '<div class="px-stage" id="px-stage"><div class="px-machine" id="slot-machine" role="application" aria-label="' + esc(game.name) + ' slot machine. Press Space to spin and to stop the reels.">' +
        '<div class="px-canvas" id="px-canvas"><i class="px-corner c0"></i><i class="px-corner c1"></i><i class="px-corner c2"></i><i class="px-corner c3"></i></div><button type="button" class="px-fs" id="fs-toggle" aria-pressed="false"></button></div>' +
        '<div class="px-jp-side" id="px-jp-side" hidden></div></div>' +
      '<p class="sr-only" id="sr-live" role="status" aria-live="polite"></p>' +
      '<section class="panel m-extras" aria-label="Sound and fairness"><div class="m-util">' +
        '<button type="button" class="btn-ghost" id="px-sound">🔊 Sound</button>' +
        '<a class="btn-ghost" href="../fairness.html">⚖️ Verify spins</a></div>' +
        '</section>' +
      (window.TNC_Slot ? TNC_Slot.paytableSection(game) : '') +
      '<section class="panel" aria-labelledby="hist-title"><h2 class="panel-label" id="hist-title">RECENT SPINS</h2>' +
        '<ol class="history" id="history"><li class="history-empty">No spins yet. The reels are warm.</li></ol></section>';
    var stageEl = document.getElementById("px-stage"), machineEl = document.getElementById("slot-machine");
    var hostEl = document.getElementById("px-canvas"), historyEl = document.getElementById("history");
    var srLive = document.getElementById("sr-live"), soundBtn = document.getElementById("px-sound");
    machineEl.classList.add("px-" + game.theme);

    if (document.fonts && document.fonts.load) {
      try { await Promise.race([Promise.all([document.fonts.load("40px Bungee"), document.fonts.ready]), sleep(1500)]); } catch (e) {}
    }
    var app = new PIXI.Application();
    await app.init({ width: VW, height: VH, backgroundAlpha: 0, antialias: true, resolution: Math.min(2, window.devicePixelRatio || 1), autoDensity: true });
    hostEl.appendChild(app.canvas);
    app.canvas.setAttribute("aria-hidden", "true");
    var frame = new PIXI.Container(); frame.position.set(PX, PT);   // the machine, inside the canvas's margin
    var world = new PIXI.Container();   // everything, shaken as one
    frame.addChild(world); app.stage.addChild(frame);
    // Full screen: the page goes full screen, the site around the machine hides, and the canvas grows
    // to fill the screen (MARGIN px on the side that runs out first).
    var fsBtn = document.getElementById("fs-toggle"), docEl = document.documentElement, MARGIN = 10;
    var FS_Y = T.fsY != null ? T.fsY : 171;   // the button's place on the cabinet (a skin can move it off its art)
    function fsElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
    // Wide full screen (landscape, with room to spare at the sides): the jackpot rows leave the canvas for a
    // block at the top left of the screen, and the cabinet alone fills the height, from the top margin down.
    var JP_H = 140, SIDE_W = 340, jpSide = document.getElementById("px-jp-side"), wide = false;
    document.body.appendChild(jpSide);   // fixed to the screen: inside the stage (CSS perspective) it would be fixed to the stage
    function fit() {
      var full = document.body.classList.contains("is-fullscreen");
      wide = full && innerWidth > innerHeight && (innerWidth - Math.min(innerWidth - 2 * MARGIN, (innerHeight - 2 * MARGIN) * VW / (VH - JP_H))) / 2 >= SIDE_W;
      var off = wide ? JP_H : 0, vh = VH - off;
      var w = full ? Math.min(innerWidth - 2 * MARGIN, (innerHeight - 2 * MARGIN) * VW / vh) : Math.min(stageEl.clientWidth || VW, VW);
      app.renderer.resize(w, Math.round(w * vh / VW));
      app.stage.scale.set(w / VW);
      frame.y = PT - off;
      if (L && L.jackpots) L.jackpots.visible = !wide;   // (the layers come after the first fit)
      jpSide.hidden = !wide;
      document.body.classList.toggle("px-wide", wide);
      fsBtn.style.top = ((PT + FS_Y - off) / vh * 100).toFixed(2) + "%";
    }
    // The machine leans and tilts in CSS 3D, so the canvas is not a flat rectangle on screen. Four
    // invisible markers sit on the canvas corners and move with it; a pointer is mapped back to the canvas
    // through the projection their screen positions describe (exact under any lean or tilt).
    // (The canvas box is exactly the canvas's size, and the markers sit on its corners in CSS.)
    var corners = Array.prototype.slice.call(hostEl.querySelectorAll(".px-corner"));
    var events = app.renderer.events;
    events.mapPositionToPoint = function (point, x, y) {
      var q = [];
      corners.forEach(function (el) { var r = el.getBoundingClientRect(); q.push(r.left, r.top); });
      var p = applyInverse(quadInverse(q), x, y);
      point.x = p.u * app.screen.width;
      point.y = p.v * app.screen.height;
    };
    fit();
    window.addEventListener("resize", fit);
    if (window.ResizeObserver) new ResizeObserver(function () { if (Math.abs(Math.min(stageEl.clientWidth, VW) - app.screen.width) > 1 && !document.body.classList.contains("is-fullscreen")) fit(); }).observe(stageEl);
    var FS_ICON = {
      enter: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
      exit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>'
    };
    function renderFs() {
      var on = !!fsElement();
      fsBtn.innerHTML = on ? FS_ICON.exit : FS_ICON.enter;
      fsBtn.setAttribute("aria-pressed", on ? "true" : "false");
      fsBtn.setAttribute("aria-label", on ? "Exit full screen" : "Full screen");
      fsBtn.title = on ? "Exit full screen (Esc)" : "Full screen";
    }
    function onFsChange() {
      document.body.classList.toggle("is-fullscreen", !!fsElement());
      docEl.classList.toggle("is-fullscreen", !!fsElement());
      renderFs(); fit();
      if (!fsElement()) stageEl.scrollIntoView({ block: "nearest" });
    }
    if (!(docEl.requestFullscreen || docEl.webkitRequestFullscreen)) fsBtn.hidden = true;   // e.g. iPhone Safari
    fsBtn.addEventListener("click", function (e) {
      var p = fsElement() ? (document.exitFullscreen || document.webkitExitFullscreen).call(document)
        : (docEl.requestFullscreen || docEl.webkitRequestFullscreen).call(docEl, { navigationUI: "hide" });
      if (p && p.catch) p.catch(function () {});
      // A pointer click leaves the button focused, and the next Space would press it again instead of
      // spinning: drop the focus (a keyboard press, detail 0, keeps it so Tab users stay where they were).
      if (e.detail > 0) fsBtn.blur();
    });
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    renderFs();

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
    function emojiTex(e, size, glow) {
      return texOf(size, size, function (g, w, h) {
        g.font = Math.round(size * 0.78) + "px " + EMOJI; g.textAlign = "center"; g.textBaseline = "middle";
        if (glow) { g.shadowColor = glow; g.shadowBlur = size * 0.2; }
        g.fillText(e, w / 2, h / 2 + size * 0.04);
      });
    }

    /* ═══ Layers ═══ */
    var L = {};
    ["back", "jackpots", "cabinet", "reels", "lines", "fx", "panel", "stage", "banner", "particles"].forEach(function (k) {
      L[k] = new PIXI.Container(); world.addChild(L[k]);
    });

    // The kit: what a skin draws with and reads (filled in as the machine is built).
    var RW = REELS * CW + (REELS - 1) * GAP, RH = ROWS * CH;
    var TX = RX + RW + 26, TW = W - 20 - TX - 6, TY = RY - 12, TH = RH + 24;   // the collector's box, right of the reels
    var kit = {
      W: W, H: H, RX: RX, RY: RY, CW: CW, CH: CH, GAP: GAP, RW: RW, RH: RH, REELS: REELS, ROWS: ROWS, FY: FY,
      TX: TX, TY: TY, TW: TW, TH: TH, LADDER: LADDER, COIN: COIN, SATS: SATS, TIER_NAMES: TIER_NAMES, EMOJI: EMOJI, SIGN: SIGN, MONO: MONO,
      game: game, id: id, syms: syms, K: K, FS: FS, BON: BON, JPC: JPC, COL: COL, S: S, T: T,
      app: app, L: L, PIXI: PIXI, sfx: sfx, reduce: reduce, R: R, ease: ease,
      paint: paint, texOf: texOf, grad: grad, hgrad: hgrad, rr: rr, txt: txt, animate: animate, sleep: sleep, rnd: rnd,
      fmt: fmt, amt: amt, num: num, unit: unit, fmtMult: fmtMult, emojiTex: emojiTex, button: button, setOff: setOff
    };

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
      var el = document.createElement("div");   // the same row in HTML, for the wide full screen block
      el.className = "px-jp-row" + (big ? " px-jp-grand" : "");
      el.style.background = "linear-gradient(" + colors[0] + ", " + colors[1] + ")"; el.style.borderColor = colors[2]; el.style.boxShadow = "0 0 14px " + colors[2];
      el.innerHTML = '<span class="px-jp-name" style="color:' + colors[3] + '">' + label + '</span><span class="px-jp-val" style="color:' + colors[4] + ';text-shadow:0 0 10px ' + colors[2] + '">…</span>';
      jpSide.appendChild(el);
      JR[key] = { c: c, val: val, el: el.lastChild, sats: null, cycle: null, shown: null, won: false, maxW: w - 60 - name.width };
    }
    // The GRAND looks the same on every machine (it is shared); MAJOR and MINOR take the game's colours.
    jpRow("grand", 20, 8, 720, 64, "GRAND", ["#3a0a12", "#14040a", "#ff4d5e", "#ffb3bb", "#fff1d0"], true);
    jpRow("major", 20, 80, 356, 50, "MAJOR", T.jp.major);
    jpRow("minor", 384, 80, 356, 50, "MINOR", T.jp.minor);
    // The amount shrinks to fit beside the name ("tBTC sats" is longer than a ticker).
    function paintJp(r) {
      if (r.shown == null || r.won) return;
      r.val.text = num(Math.round(r.shown)) + " " + unit();
      r.el.textContent = r.val.text;
      r.val.scale.set(1);
      if (r.val.width > r.maxW) r.val.scale.set(r.maxW / r.val.width);
    }
    function jpTo(r, sats, cycle) {
      if (r.cycle != null && cycle > r.cycle) {   // won (by someone, or our own spin): WON!, then the new amount
        r.won = true; r.val.scale.set(1); r.val.text = "WON!"; r.el.textContent = "WON!";
        animate(R(2200), function (p) { r.val.alpha = Math.floor(p * 12) % 2 ? 0.35 : 1; }, ease.lin).then(function () {
          r.won = false; r.val.alpha = 1; r.shown = sats; paintJp(r);
        });
      } else if (!r.won) {
        var from = r.shown == null ? sats : r.shown;
        animate(R(1100), function (p) { r.shown = from + (sats - from) * p; paintJp(r); });
      }
      r.sats = sats; r.cycle = cycle;
    }

    /* ═══ Cabinet: the skin's upper body (from y 140 to the fold), title, reel window frame ═══ */
    skin.cabinet(kit);
    // The feature bar (or, in free spins, the free-spin sign)
    var featBar = new PIXI.Container(); featBar.position.set(W / 2, T.featY || 252); L.cabinet.addChild(featBar);
    function setFeatBar(s, hot) {
      featBar.removeChildren();
      var F = T.feat, t = txt(s, { fontSize: 15, fill: hot ? F.hotText : F.text, letterSpacing: 1.5 });
      var w = Math.min(700, t.width + 40);
      featBar.addChild(paint(w, 34, function (g) {
        rr(g, 1, 1, w - 2, 32, 9); g.fillStyle = hot ? grad(g, 0, 34, F.hot) : F.fill; g.fill();
        g.lineWidth = 1.5; g.strokeStyle = hot ? F.hotStroke : F.stroke; g.stroke();
      }));
      featBar.children[0].position.set(-w / 2, -17);
      if (t.width > 660) t.scale.set(660 / t.width);
      featBar.addChild(t);
    }
    var FEATURES = syms[K.wild].emoji + " " + game.featureName.toUpperCase() + "   " + syms[K.scatter].emoji + " " + FS.name.toUpperCase() + "   " + syms[K.bonus].emoji + " " + BON.name.toUpperCase();
    setFeatBar(FEATURES);

    /* ═══ Symbols: printed straight on the reel strip (no card); specials keep a glow and their ribbon ═══ */
    var GLOWS = { wild: "rgba(255,190,70,.75)", scatter: "rgba(245,197,66,.45)", bonus: "rgba(90,220,120,.4)" };
    var SYMTEX = syms.map(function (s) {
      var kind = s.kind;
      return texOf(CW, CH, function (g, w, h) {
        if (kind) {
          var rg = g.createRadialGradient(w / 2, h / 2 - 6, 4, w / 2, h / 2 - 6, w * 0.5);
          rg.addColorStop(0, GLOWS[kind]); rg.addColorStop(1, "rgba(255,255,255,0)");
          g.fillStyle = rg; g.fillRect(0, 0, w, h);
        }
        g.font = "58px " + EMOJI; g.textAlign = "center"; g.textBaseline = "middle";
        g.shadowColor = T.reel.symShadow; g.shadowBlur = 5; g.shadowOffsetY = 3;
        g.fillText(s.emoji, w / 2, h / 2 + (kind ? -7 : 1));
        if (kind) {
          g.shadowBlur = 0; g.shadowOffsetY = 0;
          var label = kind.toUpperCase();
          g.font = "700 12px " + SIGN.split(",")[0];
          var lw = g.measureText(label).width + 14;
          rr(g, (w - lw) / 2, h - 23, lw, 16, 5);
          g.fillStyle = kind === "wild" ? "#d7263d" : kind === "scatter" ? "#f5c542" : "#2ea84a"; g.fill();
          g.fillStyle = kind === "scatter" ? "#2a1c02" : "#fff"; g.fillText(label, w / 2, h - 14.5);
        }
      });
    });
    kit.SYMTEX = SYMTEX;
    // Blurred look while turning: random symbols by their weights
    var pickers = [];
    for (var pc = 0; pc < REELS; pc++) {
      var ids = [], tot = 0;
      syms.forEach(function (s, i) { if (!s.reels || s.reels.indexOf(pc) !== -1) { ids.push([i, s.weight]); tot += s.weight; } });
      pickers.push((function (ids, tot) { return function () { var x = rnd(tot); for (var j = 0; j < ids.length; j++) { if (x < ids[j][1]) return ids[j][0]; x -= ids[j][1]; } return ids[0][0]; }; }(ids, tot)));
    }

    /* ═══ Reels ═══ */
    var REEL_R = 10;   // the reel area's corners, following the window frame's curve
    var reelMask = new PIXI.Graphics().roundRect(RX, RY, RW, RH, REEL_R).fill(0xffffff);
    L.reels.addChild(reelMask);
    var reelsBox = new PIXI.Container(); reelsBox.mask = reelMask; L.reels.addChild(reelsBox);
    var grid = [];
    // Attract mode: while the machine waits, a soft band of light sweeps across the reels every few seconds.
    var sweepTex = texOf(140, RH, function (g, w, h) { var lg = g.createLinearGradient(0, 0, w, 0); lg.addColorStop(0, "rgba(255,255,255,0)"); lg.addColorStop(0.5, "rgba(255,255,255,0.28)"); lg.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = lg; g.fillRect(0, 0, w, h); });
    var sweep = new PIXI.Sprite(sweepTex); sweep.position.set(RX - 160, RY); sweep.skew.x = -0.35; sweep.visible = false;
    var sweepMask = new PIXI.Graphics().roundRect(RX, RY, RW, RH, REEL_R).fill(0xffffff); L.reels.addChild(sweepMask); sweep.mask = sweepMask; L.reels.addChild(sweep);
    var sweepAt = performance.now() + 2500, sweeping = false;
    app.ticker.add(function () {
      if (reduce || busy || sweeping || performance.now() < sweepAt) return;
      sweeping = true; sweep.visible = true;
      animate(1100, function (p) { sweep.x = RX - 160 + (RW + 320) * p; }, ease.lin).then(function () { sweep.visible = false; sweeping = false; sweepAt = performance.now() + 6500 + Math.random() * 3000; });
    });
    // A reel landing: a flash of light down its column.
    var impactTex = texOf(CW, RH, function (g, w, h) { var lg = g.createLinearGradient(0, 0, 0, h); lg.addColorStop(0, "rgba(255,255,255,0)"); lg.addColorStop(0.5, "rgba(255,255,255,1)"); lg.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = lg; g.fillRect(0, 0, w, h); });
    function reelImpact(c) {
      if (reduce) return;
      var s = new PIXI.Sprite(impactTex); s.position.set(RX + c * (CW + GAP), RY); s.alpha = 0.5; L.fx.addChild(s);
      animate(R(260), function (p) { s.alpha = 0.5 * (1 - p); }, ease.lin).then(function () { s.destroy(); });
    }
    // Anticipation: the reel still turning gets a pulsing gold frame (returns a function that removes it).
    function anticipationGlow(c) {
      var g = new PIXI.Graphics().roundRect(RX + c * (CW + GAP) - 4, RY - 4, CW + 8, RH + 8, 10).stroke({ width: 6, color: 0xffd166 });
      g.filters = [new PIXI.BlurFilter({ strength: 3 })]; L.fx.addChild(g);
      var t = 0, fn = function (tk) { t += tk.deltaMS / 140; g.alpha = 0.45 + 0.45 * Math.max(0, Math.sin(t)); };
      app.ticker.add(fn);
      return function () { app.ticker.remove(fn); g.destroy(); };
    }
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
      var v = reelSpeed(); animate(R(260), function (p) { self.speed = v * p; self.blur.strengthY = 7 * p; });
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
      var items = list.map(function (sym) {
        var s = new PIXI.Sprite(SYMTEX[sym]); s.anchor.set(0.5); s.x = CW / 2; self.box.addChild(s); return s;
      });
      this.cells = items.slice(1, 1 + ROWS);
      var startShift = -F * CH;
      function place(shift) { items.forEach(function (s, j) { s.y = (j - 1) * CH + CH / 2 + shift; }); }
      place(startShift);
      return animate(ms, function (p) { place(startShift * (1 - p)); self.blur.strengthY = 7 * Math.max(0, 1 - p * 1.6); }, ease.back).then(function () {
        self.blur.strengthY = 0; self.setStatic(col); reelImpact(self.c);
      });
    };
    // Each reel: a light strip (under the symbols), drum shading over it, dividers between the reels.
    var RC = T.reel;
    var stripTex = texOf(CW, RH, function (g, w, h) {
      var lg = g.createLinearGradient(0, 0, w, 0);
      lg.addColorStop(0, RC.strip[0]); lg.addColorStop(0.18, RC.strip[1]); lg.addColorStop(0.5, RC.strip[2]); lg.addColorStop(0.82, RC.strip[1]); lg.addColorStop(1, RC.strip[0]);
      g.fillStyle = lg; g.fillRect(0, 0, w, h);
    });
    var drumTex = texOf(CW, RH, function (g, w, h) {
      var vg = g.createLinearGradient(0, 0, 0, h), sh = "rgba(" + RC.shade + ",";
      vg.addColorStop(0, sh + ".62)"); vg.addColorStop(0.2, sh + "0)"); vg.addColorStop(0.46, "rgba(255,255,255,.10)");
      vg.addColorStop(0.54, "rgba(255,255,255,.10)"); vg.addColorStop(0.8, sh + "0)"); vg.addColorStop(1, sh + ".62)");
      g.fillStyle = vg; g.fillRect(0, 0, w, h);
    });
    for (var sb = 0; sb < REELS; sb++) { var strip = new PIXI.Sprite(stripTex); strip.position.set(RX + sb * (CW + GAP), RY); reelsBox.addChild(strip); }
    var reels = [];
    for (var ri = 0; ri < REELS; ri++) reels.push(new Reel(ri));
    for (var sd = 0; sd < REELS; sd++) { var drum = new PIXI.Sprite(drumTex); drum.position.set(RX + sd * (CW + GAP), RY); reelsBox.addChild(drum); }
    var dividerTex = texOf(GAP + 4, RH, function (g, w, h) {
      var D = RC.divider, lg = g.createLinearGradient(0, 0, w, 0);
      lg.addColorStop(0, D[0]); lg.addColorStop(0.35, D[1]); lg.addColorStop(0.5, D[2]); lg.addColorStop(0.65, D[3]); lg.addColorStop(1, D[0]);
      g.fillStyle = lg; g.fillRect(0, 0, w, h);
      var vg = g.createLinearGradient(0, 0, 0, h);
      vg.addColorStop(0, "rgba(0,0,0,.5)"); vg.addColorStop(0.25, "rgba(0,0,0,0)"); vg.addColorStop(0.75, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,.5)");
      g.fillStyle = vg; g.fillRect(0, 0, w, h);
    });
    for (var dv = 1; dv < REELS; dv++) { var div = new PIXI.Sprite(dividerTex); div.position.set(RX + dv * (CW + GAP) - GAP - 2, RY); L.reels.addChild(div); }
    // The window's inner edge: a soft shadow all round and a thin lit rim, so the drums sit inside the frame.
    var bezel = paint(RW + 8, RH + 8, function (g) {
      g.save(); rr(g, 4, 4, RW, RH, REEL_R); g.clip();
      g.shadowColor = RC.inner; g.shadowBlur = 16; g.lineWidth = 14; g.strokeStyle = "#000";
      rr(g, -3, -3, RW + 14, RH + 14, REEL_R + 7); g.stroke();
      g.restore();
      rr(g, 4.5, 4.5, RW - 1, RH - 1, REEL_R); g.lineWidth = 1.5; g.strokeStyle = RC.rim; g.stroke();
    });
    bezel.position.set(RX - 4, RY - 4); L.reels.addChild(bezel);
    app.ticker.add(function (tk) { var dt = Math.min(50, tk.deltaMS); reels.forEach(function (r) { r.tick(dt); }); });   // speed: px per ms
    function cellXY(c, r) { return { x: RX + c * (CW + GAP) + CW / 2, y: RY + r * CH + CH / 2 }; }
    kit.cellXY = cellXY;
    for (var gc = 0; gc < REELS; gc++) { var col0 = []; for (var gr = 0; gr < ROWS; gr++) col0.push(pickers[gc]()); grid.push(col0); reels[gc].setStatic(col0); }

    /* ═══ The collector (the skin draws it; its level is TANK.level, 0..1) ═══ */
    var TANK = { filled: 0, size: COL ? COL.size : 1, cycle: null, level: 0, full: false };
    kit.TANK = TANK;
    var tank = new PIXI.Container(); tank.position.set(TX, TY); L.cabinet.addChild(tank);
    // The skin returns { count(filled, size), flash(on), target(): {x, y} in the machine } and may add
    // collect(items, o) (its own way of taking the symbols in; it moves the level itself through k.levelTo),
    // full() (its show when the collector fills) and reward() (when the reward starts).
    var col = skin.collector(kit, tank);
    var levelTween = null;
    function levelTo(to, ms) {   // the level, 0..1, eased over ms (at once with reduced motion or no ms)
      var from = TANK.level, mine = levelTween = {};
      if (!ms || reduce) { TANK.level = to; return Promise.resolve(); }
      return animate(ms, function (p) { if (levelTween === mine) TANK.level = from + (to - from) * p; });
    }
    kit.levelTo = levelTo;
    function paintTank(filled, size, animateIt) {
      TANK.filled = filled; TANK.size = size;
      col.count(filled, size);
      levelTo(size ? Math.min(1, filled / size) : 0, animateIt ? 1200 : 0);
    }
    function tankFlash(on) { TANK.full = on; col.flash(on); }
    if (!COL) tank.visible = false;

    /* ═══ Display (LCD) ═══ */
    var LC = T.lcd;
    L.cabinet.addChild(paint(668, 84, function (g, w, h) {
      if (LC.frame) LC.frame(g, w, h);
      else { rr(g, 2, 2, w - 4, h - 4, 10); g.fillStyle = LC.bg; g.fill(); g.lineWidth = 2; g.strokeStyle = LC.border; g.stroke(); }
    })).position.set(46, 632);
    var lcdMain = txt("", { fontFamily: LC.font || '"Courier New", monospace', fontWeight: "700", fontSize: 21, fill: LC.text,
      dropShadow: { color: LC.glow, blur: 8, distance: 0, alpha: 0.8 } });
    lcdMain.position.set(W / 2, 662);
    var lcdSub = txt("", { fontFamily: LC.font || '"Courier New", monospace', fontWeight: "700", fontSize: 14, fill: LC.sub });
    lcdSub.position.set(W / 2, 698);
    L.cabinet.addChild(lcdMain, lcdSub);
    var srTimer = 0;
    function setLcd(main, hot) {
      lcdMain.text = main;
      lcdMain.style.fill = hot ? LC.hot : LC.text;
      lcdMain.scale.set(1);
      if (lcdMain.width > 640) lcdMain.scale.set(640 / lcdMain.width);   // one line, shrunk to fit
      renderLcdSub();
      var plain = String(main).replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, "").replace(/\s+/g, " ").trim();
      clearTimeout(srTimer); srLive.textContent = ""; srTimer = setTimeout(function () { srLive.textContent = plain; }, 60);
    }
    kit.setLcd = setLcd;
    kit.setLcdSub = function (s) { lcdSub.text = s; };

    /* ═══ Deck: readouts, the spin key, the bet control, on the cabinet's console sloping toward the player ═══
       The deck is drawn flat into a render texture every frame and shown on a PerspectiveMesh:
       a little wider at the front, like a console. Keys stand up from it (their side walls face the
       player), screens and slots are sunk into it. Taps are mapped back through the same projection. */
    // The console is the cabinet's lower body: from the fold it slopes toward the player across the
    // cabinet's full width, its sides continuing the cabinet's, flaring a little toward the front edge.
    // DW × DH: the controls' area, drawn at OX inside the full console width DWF.
    // The console's side lines start exactly on the cabinet's (cabinet x 10, its outline 6 px in).
    var DW = 700, CX0 = 14.5, DWF = W - 2 * CX0, OX = 20 - (CX0 - 10), DH = 300, FLARE = 22, BASE_H = 28;
    var deckRoot = new PIXI.Container(), deck = new PIXI.Container(); deck.x = OX;
    var Q = [CX0, FY, CX0 + DWF, FY, CX0 + DWF + FLARE, FY + DH, CX0 - FLARE, FY + DH];   // TL, TR, BR, BL
    Object.assign(kit, { DW: DW, DWF: DWF, DH: DH, OX: OX, Q: Q, BASE_H: BASE_H, deck: deck });
    // The cabinet's base: the console's front edge, facing the player, with the hint printed on it
    L.panel.addChild(paint(W, BASE_H + 10, function (g) { skin.base(kit, g); })).position.set(0, Q[5] - 1);
    var touchOnly = window.matchMedia && matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches;
    var hint = txt(touchOnly ? "Tap " + T.spin + " to play" : "Press " + T.spin + " · or press Space key", { fontFamily: "Poppins, sans-serif", fontWeight: "600", fontSize: 13, fill: T.hint, letterSpacing: 0.5 });
    hint.position.set(W / 2, Q[5] - 1 + BASE_H / 2 + 1); L.panel.addChild(hint);
    // The console surface (painted flat, seen in perspective)
    deckRoot.addChild(paint(DWF, DH, function (g, w, h) { skin.surface(kit, g, w, h); }));
    deckRoot.addChild(deck);
    // A recessed screen: dark glass sunk into the panel, its upper inner wall in shadow, a lit lip below.
    kit.recess = function (w, h, r, c) {
      c = c || T.recess;
      return paint(w + 8, h + 8, function (g) {
        rr(g, 4, 6, w, h, r); g.fillStyle = c.lip || "rgba(255,255,255,.18)"; g.fill();                  // lit lower lip
        rr(g, 4, 4, w, h, r); g.fillStyle = c.glass || "#04020e"; g.fill();
        g.save(); rr(g, 4, 4, w, h, r); g.clip();
        g.shadowColor = "rgba(0,0,0,.95)"; g.shadowBlur = 14; g.shadowOffsetY = 8;               // inner shadow from the top wall
        g.lineWidth = 16; rr(g, -4, -4, w + 16, h + 16, r + 6); g.strokeStyle = "#000"; g.stroke();
        g.shadowColor = c.glow; g.shadowBlur = 18; g.shadowOffsetY = 0; g.lineWidth = 2; rr(g, 4, 4, w, h, r); g.stroke();
        g.restore();
        rr(g, 4, 4, w, h, r); g.lineWidth = 1.5; g.strokeStyle = c.rim; g.stroke();
      });
    };
    // A raised key: a top face and side walls toward the player (depth px), with a contact shadow.
    kit.keyArt = function (w, h, r, depth, top, wall) {
      return paint(w + 12, h + depth + 14, function (g) {
        g.shadowColor = "rgba(0,0,0,.7)"; g.shadowBlur = 10; g.shadowOffsetY = 4;
        rr(g, 6, 6 + depth, w, h, r); g.fillStyle = wall[1]; g.fill(); g.shadowBlur = 0; g.shadowOffsetY = 0;
        for (var d = depth; d > 0; d--) { rr(g, 6, 6 + d, w, h, r); g.fillStyle = d > depth / 2 ? wall[1] : wall[0]; g.fill(); }
        rr(g, 6, 6, w, h, r); g.fillStyle = grad(g, 6, 6 + h, top); g.fill();
        g.lineWidth = 1.5; g.strokeStyle = "rgba(255,255,255,.55)"; g.stroke();
      });
    };
    kit.sinkKey = function (set, depth) {   // a small key: down, then back up
      return animate(R(90), function (p) { set(depth * p); }, ease.out).then(function () { return animate(R(160), function (p) { set(depth * (1 - p)); }, ease.out); });
    };
    // A readout: a recessed screen with its label, value and unit.
    kit.readout = function (label, x, y, o) {
      o = o || {};
      var w = o.w || 212, h = o.h || 112, c = new PIXI.Container(); c.position.set(x, y);
      var sc = kit.recess(w, h, o.r || 12); sc.position.set(-4, -4); c.addChild(sc);
      var l = txt(label, { fontSize: 14, fill: T.readout.label, letterSpacing: 3 }); l.position.set(w / 2, 20);
      var v = txt("0", { fontFamily: o.font || MONO, fontWeight: "700", fontSize: o.size || 36, fill: T.readout.value, dropShadow: { color: T.readout.glow, blur: 10, distance: 0, alpha: 0.9 } }); v.position.set(w / 2, h * 0.535);
      // The unit in Poppins: the sign font has capitals only, and the ticker keeps its lowercase t.
      var u = txt(unit(), { fontFamily: "Poppins, sans-serif", fontWeight: "700", fontSize: 13, fill: T.readout.unit }); u.position.set(w / 2, h - 18);
      c.addChild(l, v, u); deck.addChild(c);
      return { v: v, u: u, c: c };
    };

    // Hit areas on the flat deck (the mesh maps taps back to them)
    var deckHits = [];
    kit.deckHit = function (x, y, w, h, view, fn) { deckHits.push({ x: x, y: y, w: w, h: h, view: view, fn: fn }); };
    // The spin key's depth: a spring toward its target (pressed: all the way; while the spin plays: half;
    // idle: a half press now and then, an invitation; off: up). The skin draws the key at that depth.
    var keyT = 0, keyX = 0, keyV = 0, keyPressUntil = 0, keyPressAt = -1e9;
    // flash: 1 right after a press, gone 320 ms later (the cap and its ring flare with it)
    kit.keyState = function () { return { busy: busy, off: !!(ctl && ctl.key && ctl.key._off) && !busy, t: keyT, x: keyX, flash: Math.max(0, 1 - (performance.now() - keyPressAt) / 320) }; };
    kit.keySpring = function (depth, dt) {
      var now = performance.now(), off = !!(ctl && ctl.key && ctl.key._off) && !busy, target;
      dt = Math.min(50, dt); keyT += dt;
      if (now < keyPressUntil) target = depth - 2;
      else if (busy) target = depth * 0.55;
      else if (off || reduce) target = 0;
      else {
        var p = (keyT % 4200) / 4200;
        target = p < 0.7 ? 0 : p < 0.78 ? depth * 0.5 * (p - 0.7) / 0.08 : p < 0.86 ? depth * 0.5 * (1 - (p - 0.78) / 0.08) : 0;
      }
      // The spring (about 15% overshoot), stepped at most 4 ms at a time: one step over a long frame (40 ms and
      // more happen on a heavy win in full screen) blows up and the key shoots up and down.
      for (var h; dt > 0; dt -= h) { h = Math.min(4, dt); keyV += ((target - keyX) * 0.0009 - keyV * 0.032) * h; keyX += keyV * h; }
      if (keyX < -5) { keyX = -5; keyV = 0; } else if (keyX > depth + 3) { keyX = depth + 3; keyV = 0; }
      return keyX;
    };
    function pressKey() { keyPressUntil = performance.now() + 120; keyPressAt = performance.now(); }
    // The lit ring round a key (bulbs on the bezel): they breathe while the key is ready, chase round it while
    // the spin plays, go dim when it is off, and all flare on a press. The skin calls update(keyState) each frame.
    kit.keyRing = function (parent, o) {
      var n = o.n || 16, bulbs = [], c = new PIXI.Container(); c.position.set(0, o.y || 0);
      var tex = texOf(22, 22, function (g) {
        var rg = g.createRadialGradient(11, 11, 1, 11, 11, 11); rg.addColorStop(0, "#ffffff"); rg.addColorStop(0.3, o.core || "#fff6dc"); rg.addColorStop(0.6, "rgba(255,255,255,.4)"); rg.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = rg; g.fillRect(0, 0, 22, 22);
      });
      for (var i = 0; i < n; i++) {
        var a = -Math.PI / 2 + i / n * Math.PI * 2, s = new PIXI.Sprite(tex); s.anchor.set(0.5);
        s.position.set(Math.cos(a) * o.r, Math.sin(a) * o.r); s.tint = o.color == null ? 0xffffff : o.color; c.addChild(s); bulbs.push(s);
      }
      parent.addChild(c);
      return { view: c, update: function (st) {
        var step = reduce ? 0 : Math.floor(st.t / 75);
        for (var i = 0; i < n; i++) {
          var a = st.off ? 0.1 : st.busy ? (reduce ? 0.7 : ((i - step) % 4 + 4) % 4 === 0 ? 1 : 0.16) : reduce ? 0.6 : 0.3 + 0.35 * (0.5 + 0.5 * Math.sin(st.t / 480 + i / n * 6.28));
          a = Math.max(a, st.flash);
          bulbs[i].alpha = a; bulbs[i].scale.set((o.scale || 1) * (0.65 + a * 0.55));
        }
      } };
    };
    kit.press = function () { press(); };
    kit.setBet = function (v) { if (!busy) { sfx.chip(); setBet(v); } };
    kit.stepBet = function (d) { stepBet(d); };
    kit.busy = function () { return busy; };
    kit.bet = function () { return bet; };
    kit.playBet = function () { return playBet; };
    kit.feature = function () { return feature; };

    // The skin's controls: { win, bal (readouts), key (the spin key's view), setBet(bet, index), update(s), points() }
    var ctl = null;
    ctl = skin.deck(kit, deck);
    var winRO = ctl.win, balRO = ctl.bal;
    var winShown = 0, balShown = currentBalance();

    // The console in perspective
    var deckRT = PIXI.RenderTexture.create({ width: DWF, height: DH, resolution: Math.min(2, (window.devicePixelRatio || 1) * 1.25) });
    var deckMesh = new PIXI.PerspectiveMesh({ texture: deckRT, verticesX: 12, verticesY: 12,
      x0: Q[0], y0: Q[1], x1: Q[2], y1: Q[3], x2: Q[4], y2: Q[5], x3: Q[6], y3: Q[7] });
    L.panel.addChild(deckMesh);
    app.ticker.add(function () { app.renderer.render({ container: deckRoot, target: deckRT, clear: true }); });
    // Square -> quad homography (Heckbert), inverted to map a tap on the console back to the flat deck.
    var HM = quadInverse(Q);
    function toDeck(x, y) { var p = applyInverse(HM, x, y); return { x: p.u * DWF - OX, y: p.v * DH }; }
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
    // For tests: the panel point where a deck control is drawn (flat deck -> panel).
    function deckPoint(x, y) { return quadPoint(Q, (x + OX) / DWF, y / DH); }

    /* ═══ State ═══ */
    var busy = false, feature = null, presentToken = 0, settle = 0;
    var reelsTurning = false, stopReq = false, stopWake = null;
    function clampBet(v) { return Math.max(1, Math.min(MAX_BET, Math.round(isFinite(v) ? v : 1))); }
    function ladderIndex(v) { var b = 0; for (var i = 1; i < LADDER.length; i++) if (Math.abs(Math.log(LADDER[i] / v)) < Math.abs(Math.log(LADDER[b] / v))) b = i; return b; }
    var bet = clampBet(parseInt((function () { try { return sessionStorage.getItem("tnc.bet." + COIN + "." + id); } catch (e) { return null; } })(), 10) || 10);
    var playBet = bet;
    function setBet(v) {
      bet = clampBet(v);
      try { sessionStorage.setItem("tnc.bet." + COIN + "." + id, String(bet)); } catch (e) {}
      ctl.setBet(bet, ladderIndex(bet));
      updateControls();
      if (!busy) { renderLcdSub(); if (cantAfford()) showReady(); }
    }
    function stepBet(dir) {
      if (busy) return;
      var next = bet, i;
      if (dir > 0) { for (i = 0; i < LADDER.length; i++) if (LADDER[i] > bet) { next = LADDER[i]; break; } }
      else { for (i = LADDER.length - 1; i >= 0; i--) if (LADDER[i] < bet) { next = LADDER[i]; break; } }
      if (next !== bet) { sfx.chip(); setBet(next); setLcd("Bet " + fmt(bet) + " " + SATS + ". Press " + T.spin + "!"); }
    }
    function cantAfford() { return signedIn() && currentBalance() < bet; }
    var authKnown = !Auth, keySub = "";
    function updateControls() {
      var out = authKnown && !signedIn(), canStop = busy && reelsTurning && !stopReq;
      ctl.key._off = (busy && !canStop) || (!busy && cantAfford());   // its look follows in the key's ticker
      keySub = canStop ? "STOP" : busy ? (feature ? "FREE SPINS" : "GOOD LUCK") : out ? "SIGN IN" : "BET " + fmt(bet);
      ctl.update({ busy: busy, canStop: canStop, out: out, feature: feature, bet: bet, sub: keySub });
    }
    function renderLcdSub() {
      lcdSub.text = feature
        ? (feature.reward ? feature.name + " " : "Free spin ") + feature.played + " / " + (feature.played + feature.left) +
          (feature.mult > 1 ? " · wins ×" + feature.mult : "") + (feature.reward ? " · bet " + fmt(playBet) + " " + SATS : "") + " · won " + amt(feature.total)
        : "Bet " + fmt(bet) + " " + SATS + " · 10 lines";
    }
    function showReady() {
      if (authKnown && !signedIn()) { setLcd("Sign in to play. New accounts get " + amt(window.TNC_Coin ? TNC_Coin.info(COIN).signup : 10000) + "."); return; }
      if (cantAfford()) { var b = currentBalance(); setLcd(b < 1 ? "Out of credit. Claim your daily bonus to play on." : T.lower + ": balance is " + amt(b) + ".", true); }
    }
    function renderFeature() {
      fsMode(!!feature);
      if (!feature) { setFeatBar(FEATURES); return; }
      setFeatBar((feature.reward ? feature.emoji + " " + feature.name.toUpperCase() : syms[K.scatter].emoji + " FREE SPINS") + "   " + feature.left + " LEFT" +
        (feature.mult > 1 ? "   WINS ×" + feature.mult : "") + (feature.locked ? "   " + syms[K.wild].emoji + " LOCKED" : "") +
        (feature.sticky ? "   " + syms[K.wild].emoji + " STICKY " + feature.sticky : "") + "   WON " + fmt(feature.total) + " SATS", true);
    }

    /* ═══ Meters ═══ */
    function countUp(t, from, to, ms, token, tick) {
      return new Promise(function (res) {
        if (reduce || ms <= 0) { t.text = num(to); return res(); }
        var last = 0;
        animate(ms, function (p) {
          if (token != null && token !== presentToken) { if (t === balRO.v) t.text = num(balShown); return; }
          t.text = num(Math.round(from + (to - from) * p));
          var now = performance.now(); if (tick && now - last > 55 && p < 1) { sfx.countTick(p); last = now; }
        }).then(function () { if (tick && to > from && (token == null || token === presentToken)) sfx.countDone(); res(); });
      });
    }
    function credit(sats, token, ms) { if (sats <= 0) return; var from = balShown; balShown += sats; countUp(balRO.v, from, balShown, ms, token, false); }
    function syncBalance() { balShown = currentBalance(); balRO.v.text = num(balShown); }
    function renderUnit() {
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
      var now = performance.now();
      hits.forEach(function (s) {
        if (!s || s.destroyed) return;
        var q = s._pop ? Math.min(1, (now - s._pop) / 380) : 1;   // the pop when it joined a win
        s.scale.set(1 + Math.max(0, Math.sin(pulse)) * 0.08 + Math.sin(q * Math.PI) * 0.3);
      });
    });
    // The symbols outside the win step back behind a shade, so the win stands out (drawn over the reels: the
    // reels' blur filter would swallow the sprites' own alpha).
    var dimG = new PIXI.Graphics(); L.lines.addChildAt(dimG, 0);
    var dimCount = 0;
    function dimOthers(on) {
      dimG.clear(); dimCount = 0;
      if (!on) return;
      reels.forEach(function (r, c) { r.cells.forEach(function (s, row) {
        if (s.destroyed || hits.indexOf(s) !== -1) return;
        var p = cellXY(c, row); dimG.roundRect(p.x - CW / 2 + 2, p.y - CH / 2 + 2, CW - 4, CH - 4, 8).fill({ color: 0x06080f, alpha: 0.5 }); dimCount++;
      }); });
    }
    function clearWins() {
      hits.forEach(function (s) { if (s && !s.destroyed) { s.scale.set(1); s._pop = 0; } });
      hits = []; lineG.clear(); lineGlow.clear(); hitFrames.clear();
      dimOthers(false);
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
            hits.push(s); if (!reduce) s._pop = performance.now();
            var p = cellXY(rc[0], rc[1]);
            hitFrames.roundRect(p.x - CW / 2 + 4, p.y - CH / 2 + 4, CW - 8, CH - 8, 10).stroke({ width: 4, color: 0xffd166 });
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
      if (hits.length) dimOthers(true);
    }

    /* ═══ Overlays on the cells (fixed wilds, multipliers, jackpot and collect symbols) ═══ */
    var fixedLayer = new PIXI.Container(); L.fx.addChild(fixedLayer);
    var overLayer = new PIXI.Container(); L.fx.addChild(overLayer);
    function showFixed(keys) {
      fixedLayer.removeChildren();
      keys.forEach(function (k) {
        var p = k.split(","), xy = cellXY(+p[0], +p[1]), s = new PIXI.Sprite(SYMTEX[K.wild]);
        // a lit patch of strip under it, so the held wild covers the symbols turning beneath
        fixedLayer.addChild(new PIXI.Graphics().rect(xy.x - CW / 2, xy.y - CH / 2, CW, CH).fill(RC.fixed));
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
    kit.overlayCells = overlayCells;

    /* ═══ Free-spins mode: the reels framed in the feature's colour with chase lights running round it, a tinted
       wash over the window and the skin's own weather inside it (petals, bubbles, stars). Fades in and out. ═══ */
    var FSC = T.fs || { color: 0xffd166, fill: 0xffd166, fillAlpha: 0.12, bulb: 0xfff1c4 };
    var fsFill = new PIXI.Graphics().roundRect(RX, RY, RW, RH, 10).fill({ color: FSC.fill, alpha: FSC.fillAlpha == null ? 0.14 : FSC.fillAlpha });
    L.lines.addChildAt(fsFill, 0);
    // The weather is clipped to the window by a sprite mask (an alpha mask, not a stencil one: a stencil mask here
    // is lost under the reel window on some skins)
    var fsWeather = new PIXI.Container(), fsWeatherMask = new PIXI.Sprite(texOf(RW, RH, function (g, w, h) { rr(g, 0, 0, w, h, 10); g.fillStyle = "#fff"; g.fill(); }));
    fsWeatherMask.position.set(RX, RY); L.fx.addChildAt(fsWeatherMask, 0); L.fx.addChildAt(fsWeather, 1); fsWeather.mask = fsWeatherMask;
    var fsFrame = new PIXI.Container(); L.fx.addChild(fsFrame);
    var FX0 = RX - 12, FY0 = RY - 12, FW = RW + 24, FH = RH + 24;
    var frameG = new PIXI.Graphics();
    frameG.roundRect(FX0 - 4, FY0 - 4, FW + 8, FH + 8, 18).stroke({ width: 18, color: FSC.color, alpha: 0.2 });
    frameG.roundRect(FX0, FY0, FW, FH, 14).stroke({ width: 7, color: FSC.color, alpha: 0.95 });
    frameG.roundRect(FX0 + 5, FY0 + 5, FW - 10, FH - 10, 10).stroke({ width: 1.5, color: 0xffffff, alpha: 0.5 });
    fsFrame.addChild(frameG);
    var bulbTex = texOf(18, 18, function (g) { var rg = g.createRadialGradient(9, 9, 1, 9, 9, 9); rg.addColorStop(0, "#ffffff"); rg.addColorStop(0.3, "#fff6dc"); rg.addColorStop(0.55, "rgba(255,246,220,.5)"); rg.addColorStop(1, "rgba(255,246,220,0)"); g.fillStyle = rg; g.fillRect(0, 0, 18, 18); });
    var bulbs = [], per = 28, run = [];   // the bulbs in order round the frame, so the chase runs round it
    for (var bx = FX0 + 16; bx <= FX0 + FW - 16; bx += per) run.push([bx, FY0]);
    for (var by = FY0 + 16 + per / 2; by <= FY0 + FH - 16; by += per) run.push([FX0 + FW, by]);
    for (var bx2 = FX0 + FW - 16; bx2 >= FX0 + 16; bx2 -= per) run.push([bx2, FY0 + FH]);
    for (var by2 = FY0 + FH - 16 - per / 2; by2 >= FY0 + 16; by2 -= per) run.push([FX0, by2]);
    run.forEach(function (p) { var s = new PIXI.Sprite(bulbTex); s.anchor.set(0.5); s.position.set(p[0], p[1]); s.tint = FSC.bulb || 0xffffff; fsFrame.addChild(s); bulbs.push(s); });
    var fsWx = skin.featureFx ? skin.featureFx(kit, fsWeather) : null;
    var fsOn = false, fsA = 0, fsT = 0;
    fsFrame.visible = fsFill.visible = fsWeather.visible = false;
    function fsMode(on) { fsOn = !!on; }
    app.ticker.add(function (tk) {
      var dt = Math.min(50, tk.deltaMS);
      fsA = Math.max(0, Math.min(1, fsA + (fsOn ? dt / 450 : -dt / 600)));
      var vis = fsA > 0; fsFrame.visible = fsFill.visible = fsWeather.visible = vis;
      if (!vis) { if (fsWx && fsWeather.children.length) fsWx.clear(); return; }
      fsT += dt;
      fsFrame.alpha = fsFill.alpha = fsWeather.alpha = fsA;
      var step = reduce ? 0 : Math.floor(fsT / 100);
      for (var i = 0; i < bulbs.length; i++) { var lit = ((i - step) % 3 + 3) % 3 === 0; bulbs[i].alpha = lit ? 1 : 0.28; bulbs[i].scale.set(lit ? 1.2 : 0.75); }
      frameG.alpha = reduce ? 1 : 0.86 + Math.sin(fsT / 170) * 0.14;
      if (fsWx && !reduce) fsWx.tick(dt / 16.67, fsT / 1000, fsOn);
    });

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
        var coin = opts.tex ? false : opts.emoji ? Math.random() < 0.35 : true;
        var tex = opts.tex ? (Array.isArray(opts.tex) ? opts.tex[rnd(opts.tex.length)] : opts.tex) : coin ? coinTex : burstTex[rnd(burstTex.length)];
        var s = new PIXI.Sprite(tex);
        s.anchor.set(0.5); var sc = (opts.scale || 1) * (coin ? 0.6 + Math.random() * 0.6 : 0.5 + Math.random() * 0.5); s.scale.set(sc);
        s.position.set(x + (Math.random() - 0.5) * (opts.spread || 60), y + (Math.random() - 0.5) * (opts.spreadY == null ? 20 : opts.spreadY));
        if (opts.tint != null) s.tint = opts.tint;
        L.particles.addChild(s);
        var a = (opts.angle == null ? -Math.PI / 2 : opts.angle) + (Math.random() - 0.5) * (opts.cone || 1.9), v = (opts.power || 14) * (0.55 + Math.random() * 0.6);
        parts.push({ s: s, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vr: (Math.random() - 0.5) * (opts.spin == null ? 0.3 : opts.spin), g: opts.g == null ? 0.42 : opts.g,
          life: 0, max: (opts.life || 150) + rnd(60), flip: opts.flip == null ? coin : opts.flip, sc: sc });
      }
    }
    // Overlay sprites (from overlayCells) fly in arcs to where `at(k)` says, one after another; `onEach(k)` as each lands.
    function flyTo(items, at, onEach, opts) {
      opts = opts || {};
      return Promise.all(items.map(function (s, k) {
        var x0 = s.x, y0 = s.y, s0 = s.scale.x, tp = at(k), tx = tp.x, ty = tp.y;
        return sleep(reduce ? 0 : k * (opts.stagger || 110)).then(function () {
          return animate(R(opts.ms || 700), function (p) {
            s.x = x0 + (tx - x0) * p; s.y = y0 + (ty - y0) * p - Math.sin(p * Math.PI) * (opts.arc == null ? 120 : opts.arc);
            s.scale.set(s0 * (1 - (opts.shrink == null ? 0.6 : opts.shrink) * p)); s.rotation = p * (opts.turns == null ? 6 : opts.turns);
          }, ease.inOut).then(function () { s.destroy(); if (onEach) onEach(k, tx, ty); });
        });
      }));
    }
    kit.flyTo = flyTo;
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
    kit.emit = emit; kit.rain = rain;

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
    kit.shake = shake; kit.tilt = tilt;

    /* ═══ Banners ═══ */
    var banner = new PIXI.Container(); banner.position.set(W / 2, RY + RH / 2); banner.visible = false; L.banner.addChild(banner);
    var rays = new PIXI.Graphics();
    for (var rk = 0; rk < 16; rk++) { var a0 = rk * Math.PI / 8, a1 = a0 + Math.PI / 16; rays.moveTo(0, 0).lineTo(Math.cos(a0) * 420, Math.sin(a0) * 420).lineTo(Math.cos(a1) * 420, Math.sin(a1) * 420).closePath(); }
    rays.fill({ color: 0xffd166, alpha: 0.18 });
    var bannerBack = new PIXI.Graphics().roundRect(-300, -110, 600, 220, 26).fill({ color: T.bannerBg, alpha: 0.82 }).stroke({ width: 4, color: 0xffd166 });
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
      var aw = amount ? PIXI.CanvasTextMetrics.measureText(amount, bannerAmt.style).width : 0;
      if (aw > w - 50) bannerAmt.scale.set((w - 50) / aw);
      bannerBack.clear().roundRect(-w / 2, -110, w, 220, 26).fill({ color: T.bannerBg, alpha: 0.82 }).stroke({ width: 4, color: 0xffd166 });
      banner.visible = true; banner.alpha = 1; banner.scale.set(0.2);
      animate(R(500), function (p) { banner.scale.set(0.2 + 0.8 * p); }, ease.back);
    }
    function hideBanner() {
      if (!banner.visible) return;
      animate(R(250), function (p) { banner.alpha = 1 - p; }).then(function () { banner.visible = false; banner.alpha = 1; });
    }
    kit.showBanner = showBanner; kit.hideBanner = hideBanner;

    /* ═══ Stage (bonus, jackpot show, Hold & Win): a panel over the cabinet ═══ */
    var stage = new PIXI.Container(); stage.visible = false; L.stage.addChild(stage);
    var ST = T.stage;
    function openStage(titleText, subText) {
      stage.removeChildren(); stage.visible = true; stage.alpha = 0;
      stage.addChild(paint(W - 60, 900, function (g, w, h) {
        g.shadowColor = ST.glow; g.shadowBlur = 30; rr(g, 6, 6, w - 12, h - 12, 26);
        var rg = g.createRadialGradient(w / 2, 120, 20, w / 2, h / 2, h * 0.7); rg.addColorStop(0, ST.bg[0]); rg.addColorStop(1, ST.bg[1]);
        g.fillStyle = rg; g.fill(); g.shadowBlur = 0; g.lineWidth = 3; g.strokeStyle = ST.stroke; g.stroke();
        if (ST.decor) ST.decor(g, w, h);
      })).position.set(30, 150);
      var t = txt(titleText, { fontSize: 44, fill: "#ffe79a", dropShadow: { color: "#ffb300", blur: 16, distance: 0, alpha: 1 } }); t.position.set(W / 2, 214);
      if (t.width > 640) t.scale.set(640 / t.width);
      var s = txt(subText || "", { fontFamily: '"Courier New", monospace', fontWeight: "700", fontSize: 18, fill: ST.sub, wordWrap: true, wordWrapWidth: 660, align: "center" }); s.position.set(W / 2, 262);
      stage.addChild(t, s);
      animate(R(350), function (p) { stage.alpha = p; });
      return { sub: s, root: stage };
    }
    function closeStage() { return animate(R(300), function (p) { stage.alpha = 1 - p; }).then(function () { stage.visible = false; stage.removeChildren(); }); }
    function stageButton(label, y, onTap, x, w) {
      var b = new PIXI.Container(); b.position.set(x || W / 2, y);
      var bw = w || 280, B = ST.button;
      var bg = paint(bw, 64, function (g, w, h) { rr(g, 2, 2, w - 4, h - 4, 16); g.fillStyle = grad(g, 0, h, B.slice(0, 2)); g.fill(); g.lineWidth = 3; g.strokeStyle = B[2]; g.stroke(); });
      bg.anchor.set(0.5); var t = txt(label, { fontSize: 24, fill: "#fff" }); if (t.width > bw - 30) t.scale.set((bw - 30) / t.width);
      b.addChild(bg, t);
      stage.addChild(b);
      return button(b, function () { setOff(b, true); onTap(); });
    }
    kit.openStage = openStage; kit.closeStage = closeStage; kit.stageButton = stageButton;
    kit.stageOpen = function () { return stage.visible; };
    // A prize wheel on the stage, stopping on slice `idx` (the server's): o = { labels, fills, textFills,
    // rim, line, bg, glow, hub (emoji), radius, y, font, labelAt (0..1 of the radius), pointer, button, turning, done(idx) }
    kit.wheel = function (o, idx, ui) {
      return new Promise(function (resolve) {
        var n = o.labels.length, seg = Math.PI * 2 / n, RAD = o.radius || 230, Y = o.y || 600, PAD = o.handles ? 64 : 20;
        var wheel = paint(RAD * 2 + PAD, RAD * 2 + PAD, function (g, w) {
          var c = w / 2;
          if (o.handles) {   // a ship's wheel: spokes through the rim ending in turned handles
            for (var hk = 0; hk < o.handles; hk++) {
              var ha = hk * Math.PI * 2 / o.handles, hx = Math.cos(ha), hy = Math.sin(ha);
              g.lineCap = "round"; g.lineWidth = 12; g.strokeStyle = o.handleColor[1];
              g.beginPath(); g.moveTo(c + hx * (RAD - 6), c + hy * (RAD - 6)); g.lineTo(c + hx * (RAD + 18), c + hy * (RAD + 18)); g.stroke();
              g.beginPath(); g.arc(c + hx * (RAD + 22), c + hy * (RAD + 22), 10, 0, Math.PI * 2); g.fillStyle = o.handleColor[0]; g.fill();
              g.lineWidth = 2; g.strokeStyle = o.handleColor[1]; g.stroke();
            }
          }
          g.shadowColor = o.glow; g.shadowBlur = 24; g.beginPath(); g.arc(c, c, RAD, 0, Math.PI * 2); g.fillStyle = o.bg; g.fill(); g.shadowBlur = 0;
          o.labels.forEach(function (label, i) {
            var a0 = -Math.PI / 2 + i * seg, a1 = a0 + seg;
            g.beginPath(); g.moveTo(c, c); g.arc(c, c, RAD - 8, a0, a1); g.closePath(); g.fillStyle = o.fills[i]; g.fill();
            g.lineWidth = 2; g.strokeStyle = o.line; g.stroke();
            g.save(); g.translate(c, c); g.rotate(a0 + seg / 2 + Math.PI / 2);
            g.font = (o.font || "24px ") + SIGN.split(",")[0]; g.textAlign = "center"; g.fillStyle = o.textFills ? o.textFills[i] : "#fff"; g.fillText(label, 0, -RAD * (o.labelAt || 0.6)); g.restore();
          });
          if (o.studs) for (var k = 0; k < n; k++) { var a = -Math.PI / 2 + k * seg; g.beginPath(); g.arc(c + Math.cos(a) * (RAD - 4), c + Math.sin(a) * (RAD - 4), 5, 0, Math.PI * 2); g.fillStyle = o.studs; g.fill(); }
          g.lineWidth = 10; g.strokeStyle = o.rim; g.beginPath(); g.arc(c, c, RAD - 4, 0, Math.PI * 2); g.stroke();
          g.beginPath(); g.arc(c, c, 34, 0, Math.PI * 2); g.fillStyle = o.bg; g.fill(); g.lineWidth = 4; g.strokeStyle = o.line; g.stroke();
        });
        wheel.anchor.set(0.5); wheel.position.set(W / 2, Y); stage.addChild(wheel);
        var hub = new PIXI.Sprite(emojiTex(o.hub, 50)); hub.anchor.set(0.5); hub.position.copyFrom(wheel.position); stage.addChild(hub);
        var pointer = new PIXI.Graphics().poly([-22, 0, 22, 0, 0, 40]).fill(o.pointer || 0xff4d5e).stroke({ width: 3, color: 0xffffff });
        pointer.position.set(W / 2, Y - RAD - 26); stage.addChild(pointer);
        var started = false, go = stageButton(o.button || "SPIN THE WHEEL", Y + 320, spinIt);
        kit._stageGo = spinIt;
        function spinIt() {
          if (started) return; started = true; setOff(go, true); kit._stageGo = null;
          ui.sub.text = o.turning || "The wheel is turning…";
          var target = Math.PI * 2 * 5 + (Math.PI * 2 - (idx + 0.5) * seg) + (Math.random() - 0.5) * seg * 0.6, last = -1;
          animate(R(4600), function (p) {
            wheel.rotation = target * p;
            var s = Math.floor(wheel.rotation / seg); if (s !== last) { last = s; sfx.wheelTick(); }
          }, ease.wheel).then(function () {
            sfx.wheelStop(); kit.wheelStopped = idx;
            ui.sub.text = o.done(idx);
            emit(40, W / 2, Y - 220, { emoji: true });
            setTimeout(resolve, R(1100));
          });
        }
        setTimeout(function () { if (!started && stage.visible) spinIt(); }, reduce ? 1200 : 9000);
      });
    };
    // A pick on the stage: `n` closed items; each tap (or Auto) opens the next of the server's outcomes.
    // o = { n, cols, x0, y0, dx, dy, closed(i) -> view, open(view, i, k, last) (k: the k-th opened, -1 for the
    // ones left closed), outcomes (array, in order), auto (label), autoMs, onDone }
    kit.pick = function (o) {
      return new Promise(function (resolve) {
        var items = [], opened = 0, done = false, autoTimer = null;
        for (var i = 0; i < o.n; i++) {
          var v = o.closed(i), cx = o.x0 + (i % o.cols) * o.dx + (o.shift && Math.floor(i / o.cols) % 2 ? o.shift : 0), cy = o.y0 + Math.floor(i / o.cols) * o.dy;
          v.position.set(cx, cy); stage.addChild(v);
          (function (v) { button(v, function () { reveal(v); }); })(v);
          items.push(v);
        }
        function reveal(v) {
          if (done || v._open) return;
          v._open = true; v.cursor = "default";
          var k = opened++, last = opened >= o.outcomes.length;
          o.open(v, o.outcomes[k], k, last);
          if (!last) return;
          done = true; clearInterval(autoTimer); kit._stageGo = null;
          var rest = items.filter(function (x) { return !x._open; });
          setTimeout(function () { rest.forEach(function (x, j) { x._open = true; o.open(x, null, -1 - j, false); }); }, R(500));
          setTimeout(resolve, R(1500));
        }
        function auto() {
          if (done || autoTimer) return;   // already opening by itself
          if (autoBtn) setOff(autoBtn, true);
          kit._stageGo = null;
          autoTimer = setInterval(function () {
            var left = items.filter(function (x) { return !x._open; });
            if (!left.length || done) return clearInterval(autoTimer);
            reveal(left[rnd(left.length)]);
          }, reduce ? 200 : (o.autoMs || 600));
        }
        var autoBtn = o.auto ? stageButton(o.auto, o.autoY || 960, auto, o.autoX, 240) : null;
        kit._stageGo = auto;
        setTimeout(function () { if (!done && !opened && stage.visible) auto(); }, reduce ? 1500 : 12000);   // by itself if left idle
      });
    };

    /* ═══ Celebration of an amount ═══ */
    // A flash of light over the whole machine (big wins), and `hot` for the skins' lights while a win plays.
    var flashG = new PIXI.Graphics().rect(0, 0, W, H).fill(0xffffff); flashG.alpha = 0; L.banner.addChildAt(flashG, 0);
    function flash(a) { if (reduce) return; flashG.alpha = a; animate(R(420), function (p) { flashG.alpha = a * (1 - p); }, ease.lin); }
    var hot = false; kit.hot = function () { return hot; };
    var TIERS = { none: 0, win: 700, big: 1400, mega: 2200, jackpot: 3200 };
    var WAIT = { none: 700, win: 1100, big: 2300, mega: 2900, jackpot: 4300 };
    var SETTLE_MS = 500;
    function celebrate(total, tier, token, title) {
      winShown = total;
      countUp(winRO.v, 0, total, R(TIERS[tier]), token, true);
      credit(total, token, R(TIERS[tier]));
      if (tier === "win" || tier === "none") { if (total > 0) { sfx.win(); emit(8 + Math.min(20, Math.round(total / playBet)), RX + RW / 2, RY + RH, { power: 11 }); } return; }
      showBanner(title || { big: "BIG WIN!", mega: "MEGA WIN!", jackpot: "TOP PRIZE!" }[tier], amt(total));
      if (!reduce) animate(R(TIERS[tier]), function (p) { if (token === presentToken) bannerAmt.text = amt(Math.round(total * p)); });
      flash(tier === "big" ? 0.35 : 0.6);
      hot = true; setTimeout(function () { hot = false; }, { big: 2200, mega: 2800, jackpot: 4200 }[tier]);
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
      stopReq = true; sfx.press(); pressKey();
      if (stopWake) stopWake();
      updateControls();
    }
    var landLog = [];   // for tests: when each reel landed
    function startReels() { reelsTurning = true; stopReq = false; landLog = []; updateControls(); reels.forEach(function (r) { r.start(); }); sfx.startSpinLoop(); }
    async function stopAll(target) {
      var seen = 0, landings = [];
      for (var i = 0; i < REELS; i++) {
        var unglow = null;
        if (seen >= 2 && i >= 2 && !stopReq) {
          sfx.anticipation(R(1300) / 1000);
          var r0 = reels[i], v0 = reelSpeed(); animate(R(1300), function (p) { r0.speed = v0 + 1.6 * p; }, ease.lin);
          unglow = anticipationGlow(i);
          await stoppable(R(1300));
        } else if (i > 0) await (stopReq ? sleep(R(70)) : stoppable(R(420)));
        var n = target[i].filter(function (k) { return k === K.scatter; }).length;
        landings.push(reels[i].land(target[i], stopReq ? R(200) : R(560)).then((function (idx, cnt, has, off) {
          return function () { landLog.push(performance.now()); sfx.reelStop(idx); if (has) sfx.scatter(cnt); if (off) off(); if (idx === REELS - 1 && !stopReq) shake(R(160), 3); };
        }(i, seen + n, n > 0, unglow))));
        seen += n;
      }
      reelsTurning = false; stopReq = false; updateControls();
      await Promise.all(landings);
      sfx.stopSpinLoop();
      await sleep(R(200));
    }

    /* ═══ One spin step (the paid spin or a free spin; several phases = respins) ═══ */
    var firstGrid = null, wins = [];
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
        if (feature.played > 0 && st.multiplier > feature.mult) { setLcd((feature.reward ? feature.name : T.fsShort) + ": wins ×" + st.multiplier + "!", true); sfx.feature(); }
        feature.played = st.freeSpin; feature.left = st.spinsLeft; feature.mult = st.multiplier;
        renderFeature(); setLcd("Free spin " + feature.played + "… good luck!");
      }
      var roundTotal = 0, lastTier = "none", phases = st.phases || [];
      for (var pi = 0; pi < phases.length; pi++) {
        var ph = phases[pi], fixedKeys = (ph.fixed || []).map(function (rc) { return rc[0] + "," + rc[1]; });
        if (pi > 0) { token = ++presentToken; hideBanner(); clearWins(); setLcd("Lucky respin " + pi + ": " + fixedKeys.length + " " + syms[K.wild].emoji + " stay put…", true); sfx.feature(); await sleep(R(900)); }
        if (pi === 0) overLayer.removeChildren();
        if (feature && (FS.sticky || feature.sticky)) { feature.sticky = fixedKeys.length; renderFeature(); }
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
        wins = p.items;
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
      addHistory(free ? "free spin" : "bet " + fmt(bet) + " " + SATS, free ? roundTotal : roundTotal - bet, roundTotal, lastTier);
      return WAIT[lastTier];
    }

    /* ═══ Bonus (the skin's game) ═══ */
    async function runBonus(st) {
      var token = ++presentToken;
      await sleep(R(700));
      hideBanner();
      showBanner(BON.name.toUpperCase() + "!", "BONUS GAME");
      setLcd(syms[K.bonus].emoji + " " + BON.name + " bonus!", true); sfx.bonusStart();
      emit(30, W / 2, RY + RH, { emoji: true });
      await sleep(R(2000)); hideBanner(); clearWins();
      await skin.bonus(kit, st);
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

    /* ═══ Free spins and rewards ═══ */
    async function startFeature(spins) {
      feature = { left: spins, played: 0, total: 0, sticky: 0, mult: FS.progressive ? FS.progressive.start : (FS.multiplier || 1) };
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
      feature = { left: st.spins, played: 0, total: 0, sticky: 0, mult: Math.max(1, Rw.multiplier || 1), reward: true, name: Rw.name, emoji: COL.emoji, locked: Rw.lockedWild || null };
      updateControls(); renderFeature();
      var token = ++presentToken; hideBanner(); clearWins();
      showBanner(Rw.name.toUpperCase() + "!", st.spins + " SPINS" + (Rw.multiplier > 1 ? " · WINS ×" + Rw.multiplier : Rw.rise ? " · RISING ×" : ""));
      setLcd(Rw.name + ": " + st.spins + " free spins at " + fmt(playBet) + " " + SATS + "!", true); sfx.freeSpins();
      if (col.reward) col.reward(); else { var tp = col.target(); emit(50, tp.x, tp.y, { emoji: true }); }
      await sleep(R(2400)); if (token === presentToken) hideBanner();
    }
    function rewardDone() {
      playBet = bet; tankFlash(false); paintTank(0, TANK.size, false); TANK.cycle = (TANK.cycle || 0) + 1;
      if (window.TNC_Jackpots && TNC_Jackpots.collectorDone) TNC_Jackpots.collectorDone(id);
    }
    // A Hold & Win reward (the skin's board), then its win.
    async function playHoldAndWin(st) {
      var Rw = COL.reward, b = st.bet || bet;
      playBet = b;
      await skin.holdAndWin(kit, st, b);
      await closeStage();
      var token = ++presentToken, won = st.win || 0;
      var tier = won >= b * 50 ? "mega" : won >= b * 10 ? "big" : won > 0 ? "win" : "none";
      setLcd(Rw.name + " paid " + fmtMult(st.prize) + "× = " + amt(won), won > 0);
      if (won > 0) celebrate(won, tier === "win" ? "big" : tier, token, Rw.name.toUpperCase() + "!");
      addHistory(Rw.name, won, won, tier);
      settle = won > 0 ? 2800 + SETTLE_MS : 0;
      await sleep(R(2600)); if (token === presentToken) hideBanner();
    }

    /* ═══ A jackpot won in the game: the symbols, the skin's show, the celebration ═══ */
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
    var jpShown = 0;   // for tests: jackpot symbols drawn over the cells
    async function showJackpot(st) {
      var token = ++presentToken;
      hideBanner(); clearWins(); overLayer.removeChildren();
      if (backToFirstGrid()) { setLcd("Back to your spin…"); await sleep(R(500)); }
      kit.jpSprites = overlayCells(st.cells, emojiTex(JPC.emoji, 96, "#ffd166"), 90, JPC.type === "apples" ? 260 : 220);
      jpShown = st.cells.length;
      sfx.scatter(st.cells.length);
      await skin.jackpot(kit, st);
      if (stage.visible) await closeStage();
      await celebrateJackpot(st, token);
    }
    async function celebrateJackpot(st, token) {
      var tier = st.tier || st.pool, c = JP[tier] || JP.major, win = st.win || 0;
      var bchs = window.TNC_Units ? TNC_Units.format(win) : fmt(win) + " " + SATS;
      token = ++presentToken;
      clearWins();
      winShown = win; countUp(winRO.v, 0, win, R(2400), token, true); credit(win, token, R(2400));
      showBanner(c.title, bchs, c.color);
      tilt(tier); shake(R(1200), c.shake);
      (tier === "minor" ? sfx.bigWin : tier === "major" ? sfx.megaWin : sfx.jackpot).call(sfx);
      emit(Math.round(c.coins / 2), W / 2, RY + RH, { emoji: true, power: 20, spread: 400 });
      rain(c.coins, R(c.ms * 0.6));
      setLcd(c.title + " " + bchs, true);
      lcdSub.text = JPC ? "Won with the " + JPC.name + "." : "A jackpot, on top of the game's win.";
      addHistory(tier + " jackpot", win, win, "jackpot");
      await sleep(R(c.ms));
      if (token === presentToken) hideBanner();
      overLayer.removeChildren();
      settle = SETTLE_MS;
    }

    /* ═══ Collect symbols: onto their cells, then into the collector ═══ */
    var colShown = 0;   // for tests: collect symbols drawn over the cells
    async function playCollect(st) {
      if (!COL || !st.cells || !st.cells.length) { if (st.filled != null) paintTank(st.filled, st.size, true); return; }
      if (backToFirstGrid()) await sleep(R(400));
      var tex = emojiTex(COL.emoji, 64, T.collectGlow);
      var items = overlayCells(st.cells, tex, 52, 140, true);
      colShown = Math.max(colShown, st.cells.length);
      sfx.chip();
      await sleep(R(650 + st.cells.length * 140));
      var tp = col.target(), tx = tp.x, ty = tp.y;
      var filled = st.full ? st.size : st.filled, to = st.size ? Math.min(1, filled / st.size) : 0;
      if (col.collect) {   // the skin takes them in its own way and raises the level as it goes
        await col.collect(items, { cells: st.cells, from: TANK.level, to: to, filled: filled, size: st.size, full: !!st.full });
        TANK.filled = filled; TANK.size = st.size; col.count(filled, st.size); levelTo(to, 0);
      } else {
        await flyTo(items, function () { return tp; }, function (k) { emit(6, tx, ty, { power: 6, cone: 3 }); sfx.collectItem(items.length > 1 ? k / (items.length - 1) : 0); });
        paintTank(filled, st.size, true);
      }
      sfx.collect();
      if (!st.full) { lcdSub.text = COL.emoji + " +" + st.cells.length + " into the " + COL.name + (st.size && st.filled / st.size >= 0.9 ? " · nearly full!" : ""); return; }
      tankFlash(true);
      var token = ++presentToken; hideBanner(); clearWins();
      showBanner(COL.name.toUpperCase() + " FULL!", COL.reward.name.toUpperCase());
      setLcd(COL.emoji + " You filled the " + COL.name + "! " + COL.reward.name + " at " + fmt(st.bet || bet) + " " + SATS + " a spin.", true);
      sfx.collectFull(); sfx.freeSpins(); tilt("minor");
      if (col.full) col.full(); else emit(50, tx, ty, { emoji: true, power: 16 });
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
        else if (st.type === "holdAndWin") { await sleep(R(700)); await playHoldAndWin(st); rewardDone(); wait = 0; }
      }
    }

    /* ═══ A paid spin ═══ */
    function requestSpin(amount) {
      var rid = newRequestId();
      return (function attempt(n) {
        return api.spin(id, amount, rid, COIN).then(function (r) {
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
      if (cantAfford()) { var b = currentBalance(); setLcd(b < 1 ? "TILT! Out of credit. Claim your daily bonus to play on." : "TILT! Bet " + fmt(bet) + " " + SATS + " is more than your " + amt(b) + ".", true); sfx.tilt(); shake(R(400), 8); return; }
      sfx.press();
      pressKey();
      busy = true; playBet = bet; updateControls();
      if (window.TNC_Jackpots) TNC_Jackpots.hold();
      ++presentToken; hideBanner(); clearWins(); overLayer.removeChildren();
      winRO.v.text = "0"; winShown = 0; wins = [];
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
        : COL && kind === COL.reward.name ? COL.emoji + " " + esc(kind)
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
      if (t && t.closest && t.closest("details, .paytable")) return;
      e.preventDefault(); press();
    });
    function renderSound() { var m = sfx.isMuted(); soundBtn.textContent = m ? "🔇 Sound off" : "🔊 Sound on"; soundBtn.setAttribute("aria-pressed", m ? "false" : "true"); }
    soundBtn.addEventListener("click", function (e) { sfx.setMuted(!sfx.isMuted()); renderSound(); if (!sfx.isMuted()) sfx.win(); if (e.detail > 0) soundBtn.blur(); });
    if (Auth) {
      Auth.onChange(function () { authKnown = true; if (!busy) { syncBalance(); updateControls(); showReady(); } });
      (Auth.ready || Promise.resolve()).then(function () { authKnown = true; if (!busy) { syncBalance(); updateControls(); showReady(); } });
    }

    renderSound(); renderUnit(); setBet(bet); syncBalance();
    setLcd(T.welcome);
    showReady();
    // For tests: what the machine is doing, and a way to press the stage's button (or Auto) at once.
    window.TNC_PixiState = function () {
      var pts = ctl.points();
      return { theme: game.theme, launchAt: deckPoint(pts.spin[0], pts.spin[1]), betUpAt: deckPoint(pts.betUp[0], pts.betUp[1]), keyDepth: Math.round(keyX * 10) / 10, keyOff: !!ctl.key._off,
        busy: busy, bet: bet, feature: feature, featBar: featBar.children[1] ? featBar.children[1].text : "", tank: { filled: TANK.filled, size: TANK.size, full: TANK.full },
        jackpots: { grand: JR.grand.val.text, major: JR.major.val.text, minor: JR.minor.val.text }, lcd: lcdMain.text, win: winRO.v.text, balance: balRO.v.text,
        banner: banner.visible ? bannerTitle.text + " | " + bannerAmt.text : "", stage: stage.visible, wins: wins.length, landed: landLog.slice(), turning: reelsTurning,
        jpShown: jpShown, colShown: colShown, dimmed: dimCount, fsMode: fsA > 0, weather: fsWeather.children.length, wheel: kit.wheelStopped == null ? null : kit.wheelStopped, picks: kit.picksShown || 0, pearls: kit.pearlsShown || 0, keySub: keySub,
        bounds: (function () { var b = world.getLocalBounds(); return [Math.round(b.minX), Math.round(b.minY), Math.round(b.maxX), Math.round(b.maxY)]; })() };
    };
    window.TNC_PixiGo = function () { if (kit._stageGo) { kit._stageGo(); return true; } return false; };
    window.TNC_PixiPress = function () { press(); };
    window.TNC_PixiBet = function (v) { if (!busy) setBet(v); };
  }

  window.TNC_PixiMachine = {
    build: build,
    supports: function (game) { return !!SKINS[game.theme] && !!PIXI; },
    skin: function (theme, s) { SKINS[theme] = s; }
  };
})();
