/*
 * TestnetCasino.com: the global roulette table (D44). Contract: testnetcasino-service docs/API.md
 * "Roulette"; fairness: docs/FAIRNESS.md section 9.
 *
 * One table for everyone, a round every real minute while someone is in the lobby:
 *   :00 to :20  betting (POST /roulette/bets, POST /roulette/bets/clear)
 *   :20         "spin": the number is known; the wheel and ball are animated to land on it exactly at
 *               resultAt (28 to 32 s later). The number is never shown as text before resultAt.
 *   resultAt    "result" for everyone, "settled" to the player; win and lose animations until the next :00.
 *
 * Live over a WebSocket (wss://api.testnetcasino.com/roulette/ws, the session cookie is sent by the
 * browser): the first message is "table"; then "round", "bets", "cleared", "spin", "result",
 * "settled", "joined", "left", "chat", "pong", "error". Pinged every 30 s and reopened after a drop
 * (the server keeps the player's place for 10 s). Every countdown runs on the server's clock
 * (serverTime). Signed-out visitors see the table from GET /roulette/state and a sign-in button.
 *
 * Drawn with PixiJS: the wheel (its own art, the ball on a closed-form path that ends in the pocket),
 * the felt (European single zero, every inside and outside bet as a hit zone), everyone's chips, the
 * chip rack and the status bar. Two layouts: wide (the wheel beside a horizontal felt) and narrow (the
 * wheel above a vertical felt). Chat, players, results, previous rounds and the rules are HTML; chat
 * text is only ever set as text, never as HTML.
 *
 * Rules (D45, "rules" in the table message): a winning bet on n numbers returns stake × 36 / n; the golden ball
 * (round.golden, sent with "spin" when betting closes, never before) makes every win of the round ×10. Rounds
 * from before D45 are rules 1 (stake × 37 / n, no golden field) and are shown as they are.
 *
 * Depends on: PixiJS 8, api.js, auth.js, units.js; fairness-engine.js (Verify); audio.js (optional).
 */
(function () {
  "use strict";

  var api = window.TNC_API, Auth = window.TNC_Auth, PIXI = window.PIXI, Fair = window.TNC_Fair;
  var root = document.getElementById("app");
  if (!root || !api || document.body.getAttribute("data-page") !== "roulette") return;

  /* ═══════════════ The game ═══════════════ */
  var WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
  var RED = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
  function colorOf(n) { return n === 0 ? "green" : RED.indexOf(n) !== -1 ? "red" : "black"; }
  var CHIPS = [1, 5, 10, 25, 100, 500, 1000];
  var CHIP_ART = { 1: ["#f4f4f4", "#9aa0a6"], 5: ["#e5383b", "#7a0d17"], 10: ["#2f80ed", "#123b78"], 25: ["#27ae60", "#0f5130"],
                   100: ["#222", "#000"], 500: ["#9b51e0", "#4a1d78"], 1000: ["#f2c94c", "#8a6508"] };
  var MAX_CHIP = 1000, ROUND_LIMIT = 10000, MAX_PER_REQUEST = 50, PING_MS = 30000;
  var OUTSIDE = {
    red: RED, black: range(1, 36).filter(function (n) { return RED.indexOf(n) === -1; }),
    odd: range(1, 36).filter(function (n) { return n % 2; }), even: range(1, 36).filter(function (n) { return !(n % 2); }),
    low: range(1, 18), high: range(19, 36), dozen1: range(1, 12), dozen2: range(13, 24), dozen3: range(25, 36),
    column1: range(1, 36).filter(function (n) { return n % 3 === 1; }), column2: range(1, 36).filter(function (n) { return n % 3 === 2; }),
    column3: range(1, 36).filter(function (n) { return n % 3 === 0; })
  };
  var TYPE_NAMES = { straight: "Straight", split: "Split", street: "Street", trio: "Trio", corner: "Corner", "first-four": "First four",
    line: "Line", red: "Red", black: "Black", odd: "Odd", even: "Even", low: "1 to 18", high: "19 to 36", dozen1: "1st 12", dozen2: "2nd 12",
    dozen3: "3rd 12", column1: "Column 1", column2: "Column 2", column3: "Column 3" };
  function range(a, b) { var r = []; for (var i = a; i <= b; i++) r.push(i); return r; }
  function covers(chip) { return chip.numbers && chip.numbers.length ? chip.numbers : OUTSIDE[chip.type] || []; }
  // The table's rules ("rules" in the table message, D45): a winning bet on n numbers returns stake × payoutPockets / n,
  // and in about 1 round in goldenOneIn the golden ball makes every win goldenMultiplier times as much.
  var RULES = { version: 2, payoutPockets: 36, goldenOneIn: 236, goldenMultiplier: 10, rtp: "1.01" };
  function returnsX(n) { return RULES.payoutPockets / n; }                       // stake included
  function returnOf(stake, n) { return Math.floor(stake * RULES.payoutPockets / n); }
  function oddsText(n) { var x = RULES.payoutPockets / n - 1; return (x % 1 ? x.toFixed(2) : String(x)) + " to 1"; }
  function rtpText() { return String(+(parseFloat(RULES.rtp) * 100).toFixed(2)) + "%"; }

  /* ═══════════════ Helpers ═══════════════ */
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var sfx = window.TNC_sfx || {};
  ["press", "chip", "reelStop", "wheelTick", "wheelStop", "win", "bigWin", "noWin", "tilt", "setTheme"].forEach(function (k) { if (!sfx[k]) sfx[k] = function () {}; });
  function fmt(n) { return Number(n).toLocaleString("en-US"); }
  function sats(n) { return fmt(n) + " tBCH sats"; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function $(id) { return document.getElementById(id); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function newRequestId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16); crypto.getRandomValues(b);
    return Array.from(b, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
  }
  function hashColor(label) {   // a stable colour per player label
    var h = 0; for (var i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
    var hue = h % 360;
    return "hsl(" + hue + ", 75%, 60%)";
  }
  function hslToHex(c) {
    var m = /hsl\((\d+), (\d+)%, (\d+)%\)/.exec(c); if (!m) return 0xffffff;
    var h = +m[1] / 360, s = +m[2] / 100, l = +m[3] / 100;
    function f(n) { var k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }
    return (Math.round(f(0) * 255) << 16) | (Math.round(f(8) * 255) << 8) | Math.round(f(4) * 255);
  }
  function shortLabel(label) {
    if (!label) return "?";
    if (/^Passkey /.test(label)) return label.slice(8, 12);
    var m = /^bchtest:(\w{3})/.exec(label); return m ? m[1] : label.slice(0, 4);
  }

  /* ═══════════════ State ═══════════════ */
  var S = {
    offset: 0,                // server clock - browser clock (ms)
    round: null, nextRoundAt: null, canBet: false, you: null,
    players: [],              // labels in the lobby
    chips: {},                // chip id -> chip (this round)
    pending: [],              // chips placed here, not yet confirmed
    myTotal: 0, balance: null,
    spin: null,               // { number, startAt, resultAt } while the wheel spins
    revealed: false, results: null, settled: null, lastMine: [],
    connected: false, chipValue: 10
  };
  function now() { return Date.now() + S.offset; }
  // A round is golden only once betting has closed and the server said so (rules 2); never guessed before.
  function isGolden(r) { return !!(r && r.golden === true && r.status !== "betting"); }
  function at(iso) { return iso ? Date.parse(iso) : null; }
  function setServerTime(iso) { var t = at(iso); if (t) S.offset = t - Date.now(); }
  function signedIn() { return !!(Auth && Auth.user); }
  function phase() {
    var r = S.round;
    if (!r) return "waiting";
    if (r.status === "betting" && now() < at(r.bettingEndsAt)) return "betting";
    if (r.status === "settled" || (S.spin && now() >= S.spin.resultAt)) return "result";
    return "spinning";
  }

  /* ═══════════════ Page ═══════════════ */
  root.innerHTML =
    '<h1 class="sr-only">Roulette</h1>' +
    '<div class="rt-stage" id="rt-stage"><div class="rt-canvas" id="rt-canvas"></div>' +
      '<div class="rt-lock" id="rt-lock" hidden><a class="btn-red" id="rt-login" href="../login.html">🔑 Sign in to play</a>' +
        '<p>Sign in to join the table. New accounts get 10,000 free tBCH sats.</p></div></div>' +
    '<p class="sr-only" id="rt-live" role="status" aria-live="polite"></p>' +
    '<div class="rt-panels">' +
      '<section class="panel rt-lobby" aria-labelledby="rt-chat-title"><h2 class="panel-label" id="rt-chat-title">TABLE CHAT</h2>' +
        '<ul class="rt-players" id="rt-players" aria-label="Players at the table"></ul>' +
        '<ol class="rt-chat" id="rt-chat" aria-live="polite" aria-label="Chat"><li class="rt-sys">Chat starts when you join: nothing is kept.</li></ol>' +
        '<form class="rt-say" id="rt-say" autocomplete="off"><input class="auth-input" id="rt-text" maxlength="200" placeholder="Say something to the table…" aria-label="Chat message">' +
          '<button type="submit" class="btn-gold" id="rt-send">Send</button></form>' +
        '<p class="auth-error" id="rt-chat-error" hidden></p></section>' +
      '<section class="panel rt-results-panel" aria-labelledby="rt-res-title"><h2 class="panel-label" id="rt-res-title">THIS ROUND</h2>' +
        '<div id="rt-results"><p class="acct-empty">Bets and results of the current round appear here.</p></div></section>' +
    '</div>' +
    '<section class="panel" aria-labelledby="rt-prev-title"><h2 class="panel-label" id="rt-prev-title">PREVIOUS ROUNDS</h2>' +
      '<div class="tbl-wrap"><table class="acct-table rt-rounds"><caption class="sr-only">Previous rounds, newest first</caption>' +
        '<thead><tr><th scope="col">Round</th><th scope="col">Time</th><th scope="col">Number</th><th scope="col">Check</th></tr></thead><tbody id="rt-rounds"></tbody></table></div>' +
      '<p class="acct-empty" id="rt-rounds-empty" hidden>No rounds yet.</p>' +
      '<button type="button" class="btn-ghost acct-more" id="rt-more" hidden>Load more</button></section>' +
    '<section class="panel" aria-labelledby="rt-rules-title"><h2 class="panel-label" id="rt-rules-title">RULES &amp; PAYOUTS</h2><div id="rt-rules">' + rulesHtml() + '</div></section>';

  function rulesHtml() {
    var rows = [["Straight", "1 number", 1], ["Split", "2 numbers side by side", 2], ["Street", "a row of 3", 3], ["Trio", "0-1-2 or 0-2-3", 3],
      ["Corner", "4 numbers in a square", 4], ["First four", "0-1-2-3", 4], ["Line", "two rows, 6 numbers", 6],
      ["Dozen", "1st, 2nd or 3rd 12", 12], ["Column", "2:1, 12 numbers", 12], ["Red / Black, Odd / Even, 1-18 / 19-36", "18 numbers", 18]];
    var G1 = RULES.goldenOneIn, GX = RULES.goldenMultiplier;
    return '<p>One table for everyone, a European wheel with a single zero. A round every minute while players are at the table: ' +
      '20 seconds to place chips, then the wheel spins for about half a minute. The usual payouts: a winning bet on <i>n</i> numbers returns ' +
      RULES.payoutPockets + ' / <i>n</i> times the stake. <b>RTP ' + rtpText() + '</b> with the golden ball (36/37 × (1 + ' + (GX - 1) + '/' + G1 + ')). Roulette has its own RTP, apart from the slots.</p>' +
      '<p class="rt-golden-rule"><span class="rt-gball" aria-hidden="true"></span><span><b>Golden ball:</b> in about 1 round in ' + G1 + ' the ball is golden and every win of the round pays ×' + GX +
      '. It is drawn from the round\'s seed when betting closes.</span></p>' +
      '<div class="tbl-wrap"><table class="acct-table rt-pay"><thead><tr><th scope="col">Bet</th><th scope="col">Covers</th><th scope="col" class="num">Pays</th>' +
        '<th scope="col" class="num">Returns (incl. stake)</th><th scope="col" class="num">Golden ball</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td class="num">' + oddsText(r[2]) + '</td><td class="num">' + returnsX(r[2]) + '×</td><td class="num">' + returnsX(r[2]) * GX + '×</td></tr>'; }).join("") +
      '</tbody></table></div>' +
      '<ul class="rules"><li>Chips of 1 to 1,000 tBCH sats, at most 10,000 tBCH sats per player per round. The stake leaves your balance when the chip is placed; Clear gives it back while betting is open.</li>' +
      '<li>Wins are whole tBCH sats. Example: 10 tBCH sats on one number returns ' + fmt(returnOf(10, 1)) + ' tBCH sats, or ' + fmt(returnOf(10, 1) * GX) + ' with the golden ball.</li>' +
      '<li>Red numbers: ' + RED.join(", ") + '.</li>' +
      '<li>Provably fair: each round publishes the SHA-256 hash of its secret seed when betting opens; the seed fixes the number, the spin and the golden ball, and is revealed at the result. Check any round below or on the <a href="../fairness.html#roulette">fairness page</a>. Rounds played before the golden ball (rules 1) paid 37 / <i>n</i> times the stake.</li></ul>';
  }

  var stageEl = $("rt-stage"), hostEl = $("rt-canvas"), lockEl = $("rt-lock"), liveEl = $("rt-live");
  var srTimer = 0;
  function announce(t) { clearTimeout(srTimer); liveEl.textContent = ""; srTimer = setTimeout(function () { liveEl.textContent = t; }, 60); }

  /* ═══════════════ PixiJS scene ═══════════════ */
  var EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  var SIGN = '"Bungee", "Poppins", sans-serif', MONO = '"SF Mono", ui-monospace, Menlo, Consolas, monospace';
  var RES = Math.min(3, Math.max(2, window.devicePixelRatio || 1));
  function paint(w, h, draw) {
    var c = document.createElement("canvas"); c.width = Math.ceil(w * RES); c.height = Math.ceil(h * RES);
    var x = c.getContext("2d"); x.scale(RES, RES); draw(x, w, h);
    return new PIXI.Sprite(new PIXI.Texture({ source: new PIXI.CanvasSource({ resource: c, resolution: RES }) }));
  }
  function grad(x, y0, y1, stops) { var g = x.createLinearGradient(0, y0, 0, y1); stops.forEach(function (c, i) { g.addColorStop(i / (stops.length - 1), c); }); return g; }
  function rr(x, px, py, w, h, r) { x.beginPath(); x.roundRect(px, py, w, h, r); }
  function txt(s, style) {
    var t = new PIXI.Text({ text: s, style: Object.assign({ fontFamily: SIGN, fontSize: 20, fill: "#fff6dc" }, style || {}) });
    t.anchor.set(0.5); return t;
  }
  var ease = { out: function (t) { return 1 - Math.pow(1 - t, 3); }, back: function (t) { var c1 = 1.7, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); } };

  var app, L, G = null, tweens = [];
  function animate(ms, fn, e) { return new Promise(function (res) { tweens.push({ t0: performance.now(), ms: Math.max(1, reduce ? ms * 0.3 : ms), fn: fn, ease: e || ease.out, res: res }); }); }

  // Two layouts. (L, a): L along the numbers (0 to 12; -1 is the zero, 12 to 13 the columns), a across
  // them (0 to 3; -1 the dozens, -2 the even-money bets). wide: L runs left to right, a bottom to top;
  // narrow: L runs top to bottom, a left to right.
  var LAYOUTS = {
    wide: { W: 1040, H: 530, wheel: { x: 190, y: 258, r: 168 }, status: { y: 0, h: 66 },
            felt: { X0: 430, YT: 94, CL: 46, CA: 62 }, history: { x: 22, y: 468, w: 340 }, rack: { x: 384, y: 426, w: 646 } },
    narrow: { W: 760, H: 1710, wheel: { x: 380, y: 380, r: 236 }, status: { y: 0, h: 118 },
            felt: { XL: 318, YT: 750, CL: 56, CA: 124 }, history: { x: 70, y: 650, w: 620 }, rack: { x: 30, y: 1502, w: 700 } }
  };
  function LA(Lv, a) {   // felt point
    var f = G.felt;
    if (G.name === "wide") return { x: f.X0 + Lv * f.CL, y: f.YT + (3 - a) * f.CA };
    return { x: f.XL + a * f.CA, y: f.YT + Lv * f.CL };
  }
  function LArect(L0, L1, a0, a1) {
    var p = LA(L0, a0), q = LA(L1, a1);
    return { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(q.x - p.x), h: Math.abs(q.y - p.y) };
  }
  function toLA(x, y) {
    var f = G.felt;
    if (G.name === "wide") return { L: (x - f.X0) / f.CL, a: 3 - (y - f.YT) / f.CA };
    return { L: (y - f.YT) / f.CL, a: (x - f.XL) / f.CA };
  }
  function cellOf(n) { return { L: Math.floor((n - 1) / 3), a: (n - 1) % 3 }; }

  // A bet spot at a felt point (L, a): which bet, which numbers, where its chips sit.
  var EVEN6 = ["low", "even", "red", "black", "odd", "high"];
  function spotAt(Lv, a) {
    var E = 0.22;
    if (a < -2 || a > 3 || Lv < -1 || Lv > 13) return null;
    if (a < -1) { var k = Math.floor(Lv / 2); if (Lv < 0 || k > 5) return null; return { type: EVEN6[k] }; }
    if (a < 0) {
      if (Lv < 0 || Lv >= 12) return null;
      if (a > -E && Lv < 12) {   // the outer edge of the numbers: street or line (first four at the zero)
        var c0 = Math.floor(Lv), f0 = Lv - c0;
        if (Lv < E) return { type: "first-four", numbers: [0, 1, 2, 3] };
        if (f0 < E && c0 > 0) return line(c0 - 1);
        if (f0 > 1 - E && c0 < 11) return line(c0);
        return street(c0);
      }
      return { type: "dozen" + (Math.floor(Lv / 4) + 1) };
    }
    if (Lv >= 12) { if (Lv > 13) return null; return { type: "column" + (Math.min(2, Math.floor(a)) + 1) }; }
    if (Lv < 0) {
      if (Lv > -E) return zeroEdge(a);
      return { type: "straight", numbers: [0] };
    }
    var col = Math.floor(Lv), fl = Lv - col, row = Math.min(2, Math.floor(a)), fa = a - row;
    if (col === 0 && fl < E) return zeroEdge(a);
    var nearL = fl < E ? col : fl > 1 - E && col < 11 ? col + 1 : -1;            // a boundary between two columns
    var nearA = fa < E && row > 0 ? row : fa > 1 - E && row < 2 ? row + 1 : -1;   // a boundary between two rows
    if (fa < E && row === 0) {   // the outer edge: street, line or first four
      if (nearL > 0) return line(nearL - 1);
      return street(col);
    }
    var n = col * 3 + row + 1;
    if (nearL > 0 && nearA > 0) { var m = (nearL - 1) * 3 + nearA; return { type: "corner", numbers: [m, m + 1, m + 3, m + 4] }; }
    if (nearL > 0) { var x = (nearL - 1) * 3 + row + 1; return { type: "split", numbers: [x, x + 3] }; }
    if (nearA > 0) { var y = col * 3 + nearA; return { type: "split", numbers: [y, y + 1] }; }
    return { type: "straight", numbers: [n] };
  }
  function street(c) { return { type: "street", numbers: [c * 3 + 1, c * 3 + 2, c * 3 + 3] }; }
  function line(c) { return { type: "line", numbers: range(c * 3 + 1, c * 3 + 6) }; }
  function zeroEdge(a) {
    var E = 0.22;
    if (a < E) return { type: "first-four", numbers: [0, 1, 2, 3] };
    if (Math.abs(a - 1) < E) return { type: "trio", numbers: [0, 1, 2] };
    if (Math.abs(a - 2) < E) return { type: "trio", numbers: [0, 2, 3] };
    return { type: "split", numbers: [0, Math.min(3, Math.floor(a) + 1)] };
  }
  // Where a bet's chips sit, in (L, a), from its type and numbers (for everyone's chips).
  function anchorOf(type, numbers) {
    var nums = (numbers || []).slice().sort(function (p, q) { return p - q; }), m = nums[0];
    switch (type) {
      case "straight": if (m === 0) return { L: -0.5, a: 1.5 }; var c = cellOf(m); return { L: c.L + 0.5, a: c.a + 0.5 };
      case "split":
        if (m === 0) return { L: 0, a: (nums[1] - 1) + 0.5 };
        if (nums[1] - m === 3) { var s1 = cellOf(m); return { L: s1.L + 1, a: s1.a + 0.5 }; }
        var s2 = cellOf(m); return { L: s2.L + 0.5, a: s2.a + 1 };
      case "street": return { L: cellOf(m).L + 0.5, a: 0 };
      case "line": return { L: cellOf(m).L + 1, a: 0 };
      case "corner": var k = cellOf(m); return { L: k.L + 1, a: k.a + 1 };
      case "trio": return { L: 0, a: nums[1] === 1 ? 1 : 2 };
      case "first-four": return { L: 0, a: 0 };
    }
    if (/^dozen/.test(type)) return { L: (+type.slice(5) - 1) * 4 + 2, a: -0.5 };
    if (/^column/.test(type)) return { L: 12.5, a: +type.slice(6) - 0.5 };
    var e = EVEN6.indexOf(type); if (e !== -1) return { L: e * 2 + 1, a: -1.5 };
    return { L: 0, a: 0 };
  }
  function spotKey(type, numbers) { return type + (numbers && numbers.length ? ":" + numbers.slice().sort(function (p, q) { return p - q; }).join("-") : ""); }

  var wheelSpin, wheelGlow, ball, ballShadow, statusMain, statusSub, statusBar, statusLeft, statusRight, chipLayer, hiLayer, rackLayer,
      bannerC, bannerTitle, bannerAmt, historyLayer, hoverG, hoverTip, hoverTipBg, particles = [], partLayer, coinTex, ballGold, ballGlow;
  var wheelAngle = 0, lastTickPocket = -1;

  function initPixi() {
    app = new PIXI.Application();
    return app.init({ width: 1040, height: 560, backgroundAlpha: 0, antialias: true, resolution: Math.min(2, window.devicePixelRatio || 1), autoDensity: true }).then(function () {
      hostEl.appendChild(app.canvas);
      app.canvas.setAttribute("aria-hidden", "true");
      app.ticker.add(tick);
      buildScene();
      window.addEventListener("resize", function () { var want = layoutName(); if (!G || want !== G.name) buildScene(); else fit(); });
    });
  }
  function layoutName() { return (stageEl.clientWidth || 1040) >= 860 ? "wide" : "narrow"; }
  function fit() {
    var w = Math.min(stageEl.clientWidth || G.W, G.W);
    app.renderer.resize(w, Math.round(w * G.H / G.W));
    app.stage.scale.set(w / G.W);
  }

  function buildScene() {
    var name = layoutName();
    G = Object.assign({ name: name }, LAYOUTS[name]);
    app.stage.removeChildren();
    L = {};
    ["table", "wheel", "felt", "hi", "chips", "hover", "ui", "fx", "banner"].forEach(function (k) { L[k] = new PIXI.Container(); app.stage.addChild(L[k]); });
    fit();
    drawTable(); drawWheel(); drawFelt(); drawStatus(); drawRack(); drawBanner();
    historyLayer = new PIXI.Container(); L.ui.addChild(historyLayer); drawHistory();
    partLayer = L.fx;
    coinTex = paint(36, 36, function (g) {
      var rg = g.createRadialGradient(13, 12, 2, 18, 18, 17); rg.addColorStop(0, "#fff6c8"); rg.addColorStop(0.5, "#ffd166"); rg.addColorStop(1, "#b8860b");
      g.beginPath(); g.arc(18, 18, 16, 0, Math.PI * 2); g.fillStyle = rg; g.fill(); g.lineWidth = 2; g.strokeStyle = "#8a6508"; g.stroke();
    }).texture;
    renderChips(); renderHighlights(); renderStatus(true);
  }

  // The table: green felt with a padded wooden rail
  function drawTable() {
    L.table.addChild(paint(G.W, G.H, function (g, w, h) {
      rr(g, 4, 4, w - 8, h - 8, 26);
      var rg = g.createRadialGradient(w / 2, h * 0.4, 40, w / 2, h / 2, Math.max(w, h) * 0.75);
      rg.addColorStop(0, "#1f7a4a"); rg.addColorStop(0.6, "#125c36"); rg.addColorStop(1, "#073d22");
      g.fillStyle = rg; g.fill();
      g.lineWidth = 10; g.strokeStyle = "#5b3412"; g.stroke();
      g.lineWidth = 3; g.strokeStyle = "#c99a3e"; rr(g, 9, 9, w - 18, h - 18, 22); g.stroke();
      g.globalAlpha = 0.06; for (var i = 0; i < 1400; i++) { g.fillStyle = i % 2 ? "#fff" : "#000"; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }   // felt texture
    }));
  }

  // The wheel: a static bowl (rim, ball track, diamonds) and the turning part (numbers, pockets, cone).
  function drawWheel() {
    var W0 = G.wheel, R = W0.r, wc = new PIXI.Container(); wc.position.set(W0.x, W0.y); L.wheel.addChild(wc);
    var bowl = paint(R * 2 + 20, R * 2 + 20, function (g, w) {
      var c = w / 2;
      g.shadowColor = "rgba(0,0,0,.7)"; g.shadowBlur = 24; g.shadowOffsetY = 8;
      g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2);
      var wood = g.createRadialGradient(c, c, R * 0.7, c, c, R); wood.addColorStop(0, "#7a4a1c"); wood.addColorStop(0.6, "#9c6128"); wood.addColorStop(1, "#4a2a0c");
      g.fillStyle = wood; g.fill(); g.shadowBlur = 0; g.shadowOffsetY = 0;
      g.lineWidth = 3; g.strokeStyle = "#e0b45a"; g.beginPath(); g.arc(c, c, R - 2, 0, Math.PI * 2); g.stroke();
      // the ball track
      g.beginPath(); g.arc(c, c, R * 0.88, 0, Math.PI * 2);
      var tr = g.createRadialGradient(c, c, R * 0.7, c, c, R * 0.88); tr.addColorStop(0, "#2a160a"); tr.addColorStop(0.85, "#5a3818"); tr.addColorStop(1, "#1a0c04");
      g.fillStyle = tr; g.fill();
      // diamonds (deflectors)
      for (var i = 0; i < 8; i++) {
        var a = i * Math.PI / 4 + Math.PI / 8, x = c + Math.cos(a) * R * 0.8, y = c + Math.sin(a) * R * 0.8;
        g.save(); g.translate(x, y); g.rotate(a); g.beginPath(); g.moveTo(-7, 0); g.lineTo(0, -3.5); g.lineTo(7, 0); g.lineTo(0, 3.5); g.closePath();
        g.fillStyle = "#f2d38a"; g.fill(); g.restore();
      }
    });
    bowl.anchor.set(0.5); wc.addChild(bowl);
    wheelSpin = new PIXI.Container(); wc.addChild(wheelSpin);
    var RN = R * 0.72, RP = R * 0.58, RC = R * 0.44, seg = Math.PI * 2 / 37;
    var rotor = paint(R * 1.5, R * 1.5, function (g, w) {
      var c = w / 2;
      WHEEL.forEach(function (n, i) {
        var a0 = -Math.PI / 2 + (i - 0.5) * seg, a1 = a0 + seg;
        g.beginPath(); g.moveTo(c, c); g.arc(c, c, RN, a0, a1); g.closePath();
        g.fillStyle = n === 0 ? "#0c8a3e" : RED.indexOf(n) !== -1 ? "#c0182c" : "#151515"; g.fill();
        g.lineWidth = 1.2; g.strokeStyle = "#e0b45a"; g.stroke();
        g.save(); g.translate(c, c); g.rotate(a0 + seg / 2 + Math.PI / 2);
        g.font = "700 " + Math.round(R * 0.075) + "px " + SIGN.split(",")[0]; g.textAlign = "center"; g.fillStyle = "#fff";
        g.fillText(String(n), 0, -RN + R * 0.095); g.restore();
      });
      // pockets ring
      g.beginPath(); g.arc(c, c, RP, 0, Math.PI * 2);
      var pr = g.createRadialGradient(c, c, RC, c, c, RP); pr.addColorStop(0, "#1a0c04"); pr.addColorStop(1, "#3a2410");
      g.fillStyle = pr; g.fill();
      WHEEL.forEach(function (n, i) {   // frets between the pockets
        var a = -Math.PI / 2 + (i - 0.5) * seg;
        g.beginPath(); g.moveTo(c + Math.cos(a) * RC, c + Math.sin(a) * RC); g.lineTo(c + Math.cos(a) * RN, c + Math.sin(a) * RN);
        g.lineWidth = 2; g.strokeStyle = "#e9c46a"; g.stroke();
      });
      // the cone and the turret
      g.beginPath(); g.arc(c, c, RC, 0, Math.PI * 2);
      var cone = g.createRadialGradient(c - RC * 0.3, c - RC * 0.3, 4, c, c, RC); cone.addColorStop(0, "#c08a44"); cone.addColorStop(1, "#5a3410");
      g.fillStyle = cone; g.fill(); g.lineWidth = 3; g.strokeStyle = "#e0b45a"; g.stroke();
      for (var k = 0; k < 4; k++) {
        var ka = k * Math.PI / 2;
        g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.cos(ka) * RC * 0.8, c + Math.sin(ka) * RC * 0.8);
        g.lineWidth = 7; g.strokeStyle = "#e9c46a"; g.lineCap = "round"; g.stroke();
        g.beginPath(); g.arc(c + Math.cos(ka) * RC * 0.8, c + Math.sin(ka) * RC * 0.8, 6, 0, Math.PI * 2); g.fillStyle = "#f6dd9b"; g.fill();
      }
      g.beginPath(); g.arc(c, c, RC * 0.22, 0, Math.PI * 2);
      var hub = g.createRadialGradient(c - 4, c - 4, 2, c, c, RC * 0.22); hub.addColorStop(0, "#fff6dc"); hub.addColorStop(1, "#a87a12");
      g.fillStyle = hub; g.fill();
    });
    rotor.anchor.set(0.5); wheelSpin.addChild(rotor);
    wheelGlow = new PIXI.Graphics(); wheelSpin.addChild(wheelGlow);
    G.R = { rim: R * 0.83, numbers: RN, pocket: (RP + RC) / 2 + R * 0.02, cone: RC, seg: seg };
    ballShadow = new PIXI.Graphics().circle(0, 0, R * 0.045).fill({ color: 0x000000, alpha: 0.4 });
    ball = paint(R * 0.1, R * 0.1, function (g, w) {
      var c = w / 2, rg = g.createRadialGradient(c * 0.7, c * 0.7, 1, c, c, c);
      rg.addColorStop(0, "#ffffff"); rg.addColorStop(0.6, "#e8e8e8"); rg.addColorStop(1, "#9a9a9a");
      g.beginPath(); g.arc(c, c, c - 1, 0, Math.PI * 2); g.fillStyle = rg; g.fill();
    });
    ball.anchor.set(0.5);
    // The golden ball: the same ball in gold, with a soft glow under it
    ballGold = paint(R * 0.1, R * 0.1, function (g, w) {
      var c = w / 2, rg = g.createRadialGradient(c * 0.7, c * 0.65, 1, c, c, c);
      rg.addColorStop(0, "#fffbe0"); rg.addColorStop(0.35, "#ffd84d"); rg.addColorStop(0.8, "#d99a0b"); rg.addColorStop(1, "#8a5a00");
      g.beginPath(); g.arc(c, c, c - 1, 0, Math.PI * 2); g.fillStyle = rg; g.fill();
    }).texture;
    ball._white = ball.texture;
    ballGlow = paint(R * 0.5, R * 0.5, function (g, w) {
      var c = w / 2, rg = g.createRadialGradient(c, c, 1, c, c, c);
      rg.addColorStop(0, "rgba(255,236,140,1)"); rg.addColorStop(0.18, "rgba(255,210,60,.8)"); rg.addColorStop(0.45, "rgba(255,180,30,.3)"); rg.addColorStop(1, "rgba(255,170,0,0)");
      g.fillStyle = rg; g.fillRect(0, 0, w, w);
    });
    ballGlow.anchor.set(0.5); ballGlow.blendMode = "add";
    wc.addChild(ballShadow, ballGlow, ball);
    ball.visible = ballShadow.visible = ballGlow.visible = false;
    G.wc = wc;
  }
  // The angle (in the wheel's frame) of a number's pocket.
  function pocketAngle(n) { return -Math.PI / 2 + WHEEL.indexOf(n) * G.R.seg; }
  function placeBall(theta, r) {
    var gold = !!(S.spin && S.spin.golden);
    ball.visible = ballShadow.visible = true;
    ball.texture = gold ? ballGold : ball._white;
    ball.position.set(Math.cos(theta) * r, Math.sin(theta) * r);
    ballShadow.position.set(ball.x + 3, ball.y + 4);
    ballGlow.visible = gold;
    if (gold) { ballGlow.position.copyFrom(ball.position); ballGlow.scale.set(0.9 + 0.15 * Math.sin(performance.now() / 180)); }
  }

  // The felt: numbers, zero, columns, dozens and even-money bets, with white lines.
  function drawFelt() {
    var f = G.felt, box = LArect(-1, 13, -2, 3);
    L.felt.addChild(paint(G.W, G.H, function (g) {
      function cell(L0, L1, a0, a1, fill, label, opts) {
        var r = LArect(L0, L1, a0, a1); opts = opts || {};
        g.fillStyle = fill; g.fillRect(r.x, r.y, r.w, r.h);
        g.lineWidth = 2; g.strokeStyle = "rgba(255,255,255,.85)"; g.strokeRect(r.x, r.y, r.w, r.h);
        if (label == null) return;
        g.save(); g.translate(r.x + r.w / 2, r.y + r.h / 2);
        if (opts.rotate) g.rotate(opts.rotate);
        if (opts.diamond) {
          g.beginPath(); g.moveTo(-18, 0); g.lineTo(0, -12); g.lineTo(18, 0); g.lineTo(0, 12); g.closePath();
          g.fillStyle = opts.diamond; g.fill(); g.lineWidth = 1.5; g.strokeStyle = "#fff"; g.stroke();
        } else {
          g.font = (opts.font || "700 18px ") + SIGN.split(",")[0]; g.textAlign = "center"; g.textBaseline = "middle";
          g.fillStyle = opts.color || "#fff"; g.fillText(label, 0, 1);
        }
        g.restore();
      }
      g.fillStyle = "rgba(0,0,0,.18)"; g.fillRect(box.x - 6, box.y - 6, box.w + 12, box.h + 12);
      var vert = G.name !== "wide";
      for (var n = 1; n <= 36; n++) {
        var c = cellOf(n), red = RED.indexOf(n) !== -1;
        cell(c.L, c.L + 1, c.a, c.a + 1, "#0e5a32", null);
        var r = LArect(c.L, c.L + 1, c.a, c.a + 1), cx = r.x + r.w / 2, cy = r.y + r.h / 2, rad = Math.min(r.w, r.h) * 0.36;
        g.beginPath(); g.ellipse(cx, cy, rad * (vert ? 1.15 : 0.95), rad * 0.95, 0, 0, Math.PI * 2); g.fillStyle = red ? "#c0182c" : "#151515"; g.fill();
        g.font = "700 " + Math.round(Math.min(r.w, r.h) * 0.38) + "px " + SIGN.split(",")[0]; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = "#fff";
        g.fillText(String(n), cx, cy + 1);
      }
      // zero: a tall cell (a pointed end on the outside)
      var z = LArect(-1, 0, 0, 3);
      g.fillStyle = "#0c8a3e"; g.beginPath();
      if (!vert) { g.moveTo(z.x + z.w, z.y); g.lineTo(z.x + 14, z.y); g.lineTo(z.x, z.y + z.h / 2); g.lineTo(z.x + 14, z.y + z.h); g.lineTo(z.x + z.w, z.y + z.h); }
      else { g.moveTo(z.x, z.y + z.h); g.lineTo(z.x, z.y + 14); g.lineTo(z.x + z.w / 2, z.y); g.lineTo(z.x + z.w, z.y + 14); g.lineTo(z.x + z.w, z.y + z.h); }
      g.closePath(); g.fill(); g.lineWidth = 2; g.strokeStyle = "rgba(255,255,255,.85)"; g.stroke();
      g.font = "700 22px " + SIGN.split(",")[0]; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = "#fff"; g.fillText("0", z.x + z.w / 2, z.y + z.h / 2 + 1);
      for (var k = 1; k <= 3; k++) cell(12, 13, k - 1, k, "#0e5a32", "2:1", { font: "700 15px ", rotate: vert ? 0 : -Math.PI / 2 * 0 });
      ["1st 12", "2nd 12", "3rd 12"].forEach(function (t, i) { cell(i * 4, i * 4 + 4, -1, 0, "#0e5a32", t, { font: "700 16px ", rotate: vert ? -Math.PI / 2 : 0 }); });
      var ev = [["1-18"], ["EVEN"], [null, "#c0182c"], [null, "#151515"], ["ODD"], ["19-36"]];
      ev.forEach(function (e, i) { cell(i * 2, i * 2 + 2, -2, -1, "#0e5a32", e[0] || "", e[1] ? { diamond: e[1], rotate: vert ? -Math.PI / 2 : 0 } : { font: "700 15px ", rotate: vert ? -Math.PI / 2 : 0 }); });
    }));
    // hit area for the whole felt
    var hit = new PIXI.Graphics().rect(box.x - 6, box.y - 6, box.w + 12, box.h + 12).fill({ color: 0, alpha: 0.001 });
    hit.eventMode = "static"; hit.cursor = "pointer"; L.felt.addChild(hit);
    hoverG = new PIXI.Graphics(); L.hover.addChild(hoverG);
    hoverTipBg = new PIXI.Graphics(); hoverTip = txt("", { fontFamily: MONO, fontWeight: "700", fontSize: G.name === "wide" ? 13 : 20, fill: "#f6dd9b", align: "center" });
    hoverTipBg.visible = hoverTip.visible = false; L.hover.addChild(hoverTipBg, hoverTip);
    hit.on("pointermove", function (e) { var p = e.getLocalPosition(app.stage); hover(spotAt(toLA(p.x, p.y).L, toLA(p.x, p.y).a)); });
    hit.on("pointerleave", function () { hover(null); });
    hit.on("pointertap", function (e) { var p = e.getLocalPosition(app.stage), la = toLA(p.x, p.y), s = spotAt(la.L, la.a); if (s) placeChip(s); });
  }
  // Light up the numbers a spot covers while the pointer is over it.
  function hover(s) {
    hoverG.clear(); if (hoverTip) { hoverTip.visible = false; hoverTipBg.visible = false; }
    if (!s || phase() !== "betting") return;
    covers(s).forEach(function (n) {
      var r = n === 0 ? LArect(-1, 0, 0, 3) : (function () { var c = cellOf(n); return LArect(c.L, c.L + 1, c.a, c.a + 1); }());
      hoverG.rect(r.x + 2, r.y + 2, r.w - 4, r.h - 4).fill({ color: 0xffffff, alpha: 0.22 });
    });
    var an = anchorOf(s.type, s.numbers), p = LA(an.L, an.a);
    hoverG.circle(p.x, p.y, 8).fill({ color: 0xffd166, alpha: 0.9 });
    // What the chip in hand would return if this bet wins (from the table's rules; never a hint of the golden ball)
    var n = covers(s).length, wide = G.name === "wide";
    hoverTip.text = (TYPE_NAMES[s.type] || s.type) + " · " + oddsText(n) + "\n" + fmt(S.chipValue) + " wins " + fmt(returnOf(S.chipValue, n));
    hoverTip.visible = true;
    var tx = Math.max(hoverTip.width / 2 + 8, Math.min(G.W - hoverTip.width / 2 - 8, p.x)), ty = p.y - (wide ? 34 : 50);
    hoverTip.position.set(tx, ty);
    hoverTipBg.clear().roundRect(tx - hoverTip.width / 2 - 8, ty - hoverTip.height / 2 - 4, hoverTip.width + 16, hoverTip.height + 8, 8)
      .fill({ color: 0x04180e, alpha: 0.92 }).stroke({ width: 1.5, color: 0xc99a3e });
    hoverTipBg.visible = true;
  }

  // The status bar: round, phase and countdown, your bets and balance
  function drawStatus() {
    var st = G.status;
    statusBar = new PIXI.Graphics(); L.ui.addChild(statusBar);
    var bg = paint(G.W - 40, st.h - 10, function (g, w, h) { rr(g, 0, 0, w, h, 12); g.fillStyle = "rgba(4,24,14,.85)"; g.fill(); g.lineWidth = 2; g.strokeStyle = "rgba(201,154,62,.8)"; g.stroke(); });
    bg.position.set(20, st.y + 12); L.ui.addChild(bg);
    var big = G.name !== "wide";
    statusLeft = txt("", { fontSize: big ? 22 : 15, fill: "#f6dd9b", letterSpacing: 1 }); statusLeft.anchor.set(0, 0.5); statusLeft.position.set(36, st.y + 12 + (st.h - 10) / 2);
    statusMain = txt("", { fontSize: big ? 38 : 24, fill: "#ffffff", letterSpacing: 1.5, dropShadow: { color: "#000", blur: 6, distance: 0, alpha: 0.8 } });
    statusMain.position.set(G.W / 2, st.y + 12 + (st.h - 10) * 0.36);
    statusSub = txt("", { fontFamily: MONO, fontWeight: "700", fontSize: big ? 20 : 13, fill: "#bfe9cf" }); statusSub.position.set(G.W / 2, st.y + 12 + (st.h - 10) * 0.78);
    statusRight = txt("", { fontFamily: MONO, fontWeight: "700", fontSize: big ? 20 : 14, fill: "#f6dd9b", align: "right" }); statusRight.anchor.set(1, 0.5); statusRight.position.set(G.W - 36, st.y + 12 + (st.h - 10) / 2);
    if (big) {   // narrow: three lines (round and your bets on top, the phase, the hint)
      statusLeft.position.set(40, st.y + 36); statusRight.position.set(G.W - 40, st.y + 36);
      statusMain.position.set(G.W / 2, st.y + 72); statusSub.position.set(G.W / 2, st.y + 102);
    }
    L.ui.addChild(statusBar, statusLeft, statusMain, statusSub, statusRight);
  }
  var lastStatusKey = "";
  function renderStatus(force) {
    if (!statusMain) return;
    var ph = phase(), r = S.round, main, sub = "", bar = 0, t = now();
    if (!r) {
      var nx = at(S.nextRoundAt);
      main = "NEXT ROUND"; sub = nx ? "starts in " + clock(nx - t) : "starts at the next whole minute";
    } else if (ph === "betting") {
      var left = at(r.bettingEndsAt) - t;
      main = S.canBet || !signedIn() ? "PLACE YOUR BETS · " + clock(left) : "JOINED MID-ROUND";
      sub = S.canBet ? "Chips 1 to 1,000 · up to 10,000 a round" : signedIn() ? "You can bet from the next round · " + clock(at(S.nextRoundAt || r.nextRoundAt) - t) : "Sign in to play";
      bar = Math.max(0, Math.min(1, left / 20000));
    } else if (ph === "spinning") {
      main = isGolden(r) ? "GOLDEN BALL · WINS ×" + RULES.goldenMultiplier : "NO MORE BETS"; sub = "The wheel is spinning…";
      if (!S.canBet && signedIn()) sub = "You can bet from the next round · " + clock(at(r.nextRoundAt || S.nextRoundAt) - t);
    } else {
      var n = r.number != null ? r.number : S.spin && S.spin.number;
      main = n != null ? n + " " + colorOf(n).toUpperCase() + (isGolden(r) ? " · GOLDEN ×" + RULES.goldenMultiplier : "") : "RESULT";
      var nxt = at(r.nextRoundAt || S.nextRoundAt);
      sub = nxt ? "Next round in " + clock(nxt - t) : "";
    }
    var left2 = r ? "ROUND " + r.id : "ROULETTE", sep = G.name === "wide" ? "\n" : " · ";
    var right = (signedIn() ? "BET " + fmt(S.myTotal) + (S.balance != null ? sep + "BALANCE " + fmt(S.balance) : "") : "");
    var key = [main, sub, left2, right, Math.round(bar * 200)].join("|");
    if (!force && key === lastStatusKey) return;
    lastStatusKey = key;
    statusMain.text = main; statusSub.text = sub; statusLeft.text = left2; statusRight.text = right;
    statusMain.style.fill = ph === "result" && r && r.number != null ? (colorOf(r.number) === "red" ? "#ff8a96" : colorOf(r.number) === "green" ? "#7dff8a" : "#ffffff") : "#ffffff";
    statusBar.clear();
    if (bar > 0) statusBar.roundRect(30, G.status.y + G.status.h - 4, (G.W - 60) * bar, 4, 2).fill(bar < 0.25 ? 0xff4d5e : 0xffd166);
  }
  function clock(ms) { var s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2); }

  // The chip rack: chip values, Clear and Repeat
  var rackChips = [], btnClear, btnRepeat;
  function chipTex(v, size, ring) {
    var c = CHIP_ART[v] || ["#ddd", "#888"];
    return paint(size, size, function (g, w) {
      var r = w / 2 - 2, cx = w / 2;
      g.shadowColor = "rgba(0,0,0,.5)"; g.shadowBlur = 4; g.shadowOffsetY = 2;
      g.beginPath(); g.arc(cx, cx, r, 0, Math.PI * 2); g.fillStyle = c[0]; g.fill(); g.shadowBlur = 0; g.shadowOffsetY = 0;
      for (var i = 0; i < 6; i++) {   // edge stripes
        g.save(); g.translate(cx, cx); g.rotate(i * Math.PI / 3); g.fillStyle = "rgba(255,255,255,.85)"; g.fillRect(-r * 0.13, -r, r * 0.26, r * 0.22); g.restore();
      }
      g.beginPath(); g.arc(cx, cx, r * 0.66, 0, Math.PI * 2); g.fillStyle = c[1]; g.fill();
      g.lineWidth = Math.max(1.5, r * 0.08); g.strokeStyle = ring || "rgba(255,255,255,.6)"; g.stroke();
    }).texture;
  }
  var CHIPTEX = {};
  function drawRack() {
    var R0 = G.rack, wide = G.name === "wide", size = wide ? 56 : 84, gap = wide ? 10 : (R0.w - 7 * 84) / 6;
    rackLayer = new PIXI.Container(); rackLayer.position.set(R0.x, R0.y); L.ui.addChild(rackLayer);
    rackChips = CHIPS.map(function (v, i) {
      if (!CHIPTEX[v]) CHIPTEX[v] = chipTex(v, 72);
      var c = new PIXI.Container(); c.position.set(size / 2 + i * (size + gap), size / 2 + 6);
      var s = new PIXI.Sprite(CHIPTEX[v]); s.anchor.set(0.5); s.width = s.height = size; c.addChild(s);
      var t = txt(String(v), { fontSize: v >= 1000 ? size * 0.2 : size * 0.26, fill: v === 1 ? "#333" : "#fff" }); c.addChild(t);
      c.eventMode = "static"; c.cursor = "pointer";
      c.on("pointertap", function () { S.chipValue = v; sfx.chip(); renderRack(); });
      rackLayer.addChild(c);
      return { v: v, c: c };
    });
    // wide: the buttons beside the chips; narrow: on a row of their own below them
    var bx = wide ? CHIPS.length * (size + gap) + 6 : 0, by = wide ? 6 : size + 26, bw = wide ? (R0.w - bx - gap) / 2 : (R0.w - 16) / 2, bh = wide ? size : 66;
    if (!wide) gap = 16;
    function button(label, x, fn) {
      var b = new PIXI.Container(); b.position.set(x, by);
      b.addChild(paint(bw, bh, function (g, w, h) { rr(g, 1, 1, w - 2, h - 2, 12); g.fillStyle = grad(g, 0, h, ["#3a2410", "#1a0c04"]); g.fill(); g.lineWidth = 2; g.strokeStyle = "#c99a3e"; g.stroke(); }));
      var t = txt(label, { fontSize: wide ? 15 : 26, fill: "#f6dd9b" }); t.position.set(bw / 2, bh / 2); b.addChild(t);
      b.eventMode = "static"; b.cursor = "pointer"; b.on("pointertap", fn);
      rackLayer.addChild(b); return b;
    }
    btnClear = button("CLEAR", bx, function () { clearBets(); });
    btnRepeat = button("REPEAT", bx + bw + gap, function () { repeatBets(); });
    renderRack();
  }
  function renderRack() {
    if (!rackChips.length) return;
    var can = canPlace();
    rackChips.forEach(function (rc) {
      var on = rc.v === S.chipValue;
      rc.c.y = (G.name === "wide" ? 34 : 48) - (on ? 6 : 0); rc.c.scale.set(on ? 1.08 : 1); rc.c.alpha = can ? 1 : 0.5;
    });
    btnClear.alpha = can && (S.myTotal > 0 || S.pending.length) ? 1 : 0.4;
    btnRepeat.alpha = can && S.lastMine.length ? 1 : 0.4;
  }

  // Last numbers: the latest results as coloured balls
  var recentNumbers = [];
  function drawHistory() {
    if (!historyLayer) return;
    historyLayer.removeChildren();
    var H0 = G.history, size = G.name === "wide" ? 30 : 44, gap = 8, max = Math.floor((H0.w + gap) / (size + gap));
    var label = txt("LAST NUMBERS", { fontSize: G.name === "wide" ? 12 : 18, fill: "#bfe9cf", letterSpacing: 2 }); label.anchor.set(0, 0.5); label.position.set(H0.x, H0.y - 14); historyLayer.addChild(label);
    recentNumbers.slice(0, max).forEach(function (h, i) {
      var n = h.n;
      var c = new PIXI.Graphics().circle(0, 0, size / 2).fill(n === 0 ? 0x0c8a3e : RED.indexOf(n) !== -1 ? 0xc0182c : 0x151515).stroke({ width: 2, color: i === 0 ? 0xffd166 : 0xffffff, alpha: i === 0 ? 1 : 0.6 });
      c.position.set(H0.x + size / 2 + i * (size + gap), H0.y + size / 2);
      var t = txt(String(n), { fontSize: size * 0.42, fill: "#fff" }); t.position.copyFrom(c.position);
      historyLayer.addChild(c, t);
      if (h.golden) {   // a small gold ball on the rim
        var gb = new PIXI.Graphics().circle(0, 0, size * 0.17).fill(0xffc928).stroke({ width: 1.5, color: 0x7a4d00 });
        gb.position.set(c.x + size * 0.36, c.y - size * 0.36); historyLayer.addChild(gb);
      }
    });
  }

  // Everyone's chips: a stack per player and spot (yours on top, with a gold ring), the amount on it
  function renderChips() {
    if (!L || !L.chips) return;
    L.chips.removeChildren();
    var spots = {};
    function add(chip, pending) {
      var key = spotKey(chip.type, chip.numbers), s = spots[key] || (spots[key] = { type: chip.type, numbers: chip.numbers, by: {} });
      var who = pending ? S.you || "you" : chip.player;
      var b = s.by[who] || (s.by[who] = { amount: 0, pending: false, payout: 0, settled: false });
      b.amount += chip.amount; if (pending) b.pending = true;
      if (chip.payout != null) { b.settled = true; b.payout += chip.payout; }
    }
    Object.keys(S.chips).forEach(function (id) { add(S.chips[id], false); });
    S.pending.forEach(function (c) { add(c, true); });
    var size = G.name === "wide" ? 30 : 40, revealedNumber = S.revealed && S.round ? S.round.number : null;
    Object.keys(spots).forEach(function (key) {
      var s = spots[key], an = anchorOf(s.type, s.numbers), p = LA(an.L, an.a);
      var whos = Object.keys(s.by).sort(function (x, y) { return (x === S.you) - (y === S.you); });   // yours last (on top)
      var winning = revealedNumber != null && covers(s).indexOf(revealedNumber) !== -1;
      whos.forEach(function (who, i) {
        var b = s.by[who], mine = who === S.you, off = (whos.length - 1 - i) * 5;
        var c = new PIXI.Container(); c.position.set(p.x - off, p.y - off);
        var v = CHIPS.slice().reverse().find(function (x) { return x <= b.amount; }) || 1;
        var sp = new PIXI.Sprite(CHIPTEX[v] || (CHIPTEX[v] = chipTex(v, 72))); sp.anchor.set(0.5); sp.width = sp.height = size; c.addChild(sp);
        var ring = new PIXI.Graphics().circle(0, 0, size / 2 + 1).stroke({ width: mine ? 3 : 2.5, color: mine ? 0xffd166 : hslToHex(hashColor(who)) });
        c.addChild(ring);
        var t = txt(compact(b.amount), { fontSize: size * 0.3, fill: v === 1 || v === 1000 ? "#222" : "#fff" }); c.addChild(t);
        if (!mine && whos.length < 4) {   // a small label with the player
          var tag = txt(shortLabel(who), { fontFamily: MONO, fontWeight: "700", fontSize: 9, fill: "#000" });
          var tg = new PIXI.Graphics().roundRect(-tag.width / 2 - 3, -6, tag.width + 6, 12, 4).fill(hslToHex(hashColor(who)));
          var tc = new PIXI.Container(); tc.addChild(tg, tag); tc.position.set(0, size / 2 + 6); c.addChild(tc);
        }
        if (b.pending) c.alpha = 0.6;
        if (revealedNumber != null && !winning) c.alpha = 0.35;   // lost: faded (swept at the next round)
        if (winning) { c._win = true; }
        L.chips.addChild(c);
      });
    });
  }
  function compact(n) { return n >= 10000 ? Math.round(n / 1000) + "K" : String(n); }

  // The winning number on the felt and in its pocket
  function renderHighlights() {
    if (!L || !L.hi) return;
    L.hi.removeChildren(); wheelGlow.clear();
    if (!S.revealed || !S.round || S.round.number == null) return;
    var n = S.round.number, r = n === 0 ? LArect(-1, 0, 0, 3) : (function () { var c = cellOf(n); return LArect(c.L, c.L + 1, c.a, c.a + 1); }());
    var g = new PIXI.Graphics().roundRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4, 6).stroke({ width: 5, color: 0xffd166 });
    g._pulse = true; L.hi.addChild(g);
    var a = pocketAngle(n), R = G.R;
    wheelGlow.moveTo(Math.cos(a - R.seg / 2) * R.cone, Math.sin(a - R.seg / 2) * R.cone)
      .arc(0, 0, R.numbers, a - R.seg / 2, a + R.seg / 2).lineTo(Math.cos(a + R.seg / 2) * R.cone, Math.sin(a + R.seg / 2) * R.cone)
      .arc(0, 0, R.cone, a + R.seg / 2, a - R.seg / 2, true).fill({ color: 0xffd166, alpha: 0.35 });
  }

  function drawBanner() {
    bannerC = new PIXI.Container(); bannerC.visible = false; L.banner.addChild(bannerC);
    var cx = G.name === "wide" ? (LA(-1, 0).x + LA(13, 0).x) / 2 : G.W / 2, cy = G.name === "wide" ? (LA(0, 3).y + LA(0, -2).y) / 2 : G.wheel.y;
    bannerC.position.set(cx, cy);
    var back = new PIXI.Graphics().roundRect(-230, -80, 460, 160, 24).fill({ color: 0x041a0e, alpha: 0.88 }).stroke({ width: 4, color: 0xffd166 });
    bannerTitle = txt("", { fontSize: 44, fill: "#ffe79a", stroke: { color: "#7a3d00", width: 5 }, dropShadow: { color: "#ff9d00", blur: 18, distance: 0, alpha: 1 } }); bannerTitle.y = -22;
    bannerAmt = txt("", { fontFamily: MONO, fontWeight: "800", fontSize: 30, fill: "#ffffff" }); bannerAmt.y = 34;
    bannerC.addChild(back, bannerTitle, bannerAmt);
  }
  function showBanner(title, amount, color, ms) {
    if (!bannerC) return;
    bannerTitle.text = title; bannerAmt.text = amount || ""; bannerTitle.style.fill = color || "#ffe79a";
    bannerTitle.scale.set(1); if (bannerTitle.width > 420) bannerTitle.scale.set(420 / bannerTitle.width);
    // Each banner has its own token: the fade-out of an older one (still running) never touches a newer one.
    var token = showBanner.token = (showBanner.token || 0) + 1;
    bannerC.visible = true; bannerC.alpha = 1; bannerC.scale.set(0.3);
    animate(450, function (p) { if (token === showBanner.token) bannerC.scale.set(0.3 + 0.7 * p); }, ease.back);
    clearTimeout(showBanner.t);
    showBanner.t = setTimeout(function () {
      animate(300, function (p) { if (token === showBanner.token) bannerC.alpha = 1 - p; }).then(function () { if (token === showBanner.token) bannerC.visible = false; });
    }, ms || 3800);
  }
  function emit(n, x, y) {
    if (reduce) n = Math.min(n, 10);
    for (var i = 0; i < n; i++) {
      var s = new PIXI.Sprite(coinTex); s.anchor.set(0.5); var sc = 0.5 + Math.random() * 0.6; s.scale.set(sc);
      s.position.set(x + (Math.random() - 0.5) * 80, y); partLayer.addChild(s);
      var a = -Math.PI / 2 + (Math.random() - 0.5) * 2, v = 9 + Math.random() * 8;
      particles.push({ s: s, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, sc: sc });
    }
  }

  /* ═══════════════ Every frame ═══════════════ */
  var pulse = 0;
  function tick(tk) {
    var dt = Math.min(50, tk.deltaMS), nowP = performance.now();
    for (var i = tweens.length - 1; i >= 0; i--) {
      var tw = tweens[i], p = Math.max(0, Math.min(1, (nowP - tw.t0) / tw.ms));
      tw.fn(tw.ease(p)); if (p >= 1) { tweens.splice(i, 1); tw.res(); }
    }
    for (var j = particles.length - 1; j >= 0; j--) {
      var q = particles[j], f = dt / 16.67; q.vy += 0.4 * f; q.s.x += q.vx * f; q.s.y += q.vy * f; q.s.scale.x = q.sc * Math.cos(q.life * 0.15); q.life += f;
      if (q.life > 120 || q.s.y > G.H + 40) { q.s.destroy(); particles.splice(j, 1); }
    }
    pulse += dt / 300;
    if (L && L.hi) L.hi.children.forEach(function (g) { if (g._pulse) g.alpha = 0.6 + 0.4 * Math.sin(pulse); });
    if (L && L.chips && S.revealed) L.chips.children.forEach(function (c) { if (c._win) c.scale.set(1 + 0.08 * Math.max(0, Math.sin(pulse))); });
    animateWheel(dt);
    renderStatus(false);
  }

  // The wheel turns all the time; during a spin the ball follows a closed-form path relative to the
  // wheel that ends exactly in the number's pocket at resultAt: angle = wheel + pocket + rel(p), with
  // rel going from many turns against the wheel to 0, and the radius dropping from the rim into the pockets.
  var REVS = 9;
  function animateWheel(dt) {
    if (!wheelSpin) return;
    var t = now(), sp = S.spin, speed = 0.35;   // rad/s, idle
    if (sp && t < sp.resultAt) { var p0 = Math.max(0, (t - sp.startAt) / (sp.resultAt - sp.startAt)); speed = 0.35 + 1.1 * (1 - p0) * (1 - p0); }
    wheelAngle += speed * dt / 1000;
    wheelSpin.rotation = wheelAngle;
    if (!sp) { ball.visible = ballShadow.visible = ballGlow.visible = false; return; }
    var D = sp.resultAt - sp.startAt, p = Math.max(0, Math.min(1, (t - sp.startAt) / D)), R = G.R, target = pocketAngle(sp.number);
    var rel = -2 * Math.PI * REVS * Math.pow(1 - p, 3), r, jitter = 0;
    if (p < 0.6) r = R.rim;
    else if (p < 0.86) {
      var q = (p - 0.6) / 0.26;
      r = R.rim + (R.pocket - R.rim) * q + Math.abs(Math.sin(q * Math.PI * 4)) * (1 - q) * (R.rim - R.pocket) * 0.35;
      jitter = Math.sin(q * 23) * (1 - q) * 0.12;
    } else r = R.pocket;
    var theta = wheelAngle + target + rel + jitter;
    placeBall(theta, r);
    var pocket = Math.floor(((theta - wheelAngle + Math.PI * 2 * 100) % (Math.PI * 2)) / R.seg);
    if (p < 0.92 && p > 0.55 && pocket !== lastTickPocket) { lastTickPocket = pocket; sfx.wheelTick(); }
    if (p >= 1 && !S.revealed) reveal();
  }

  /* ═══════════════ Messages ═══════════════ */
  function roundChanged(r) {
    var newRound = !S.round || r.id !== S.round.id;
    if (newRound) {
      if (S.round && S.round.number != null && recentNumbers[0] !== S.round.number && S.revealed) { /* already added at reveal */ }
      var mine = Object.keys(S.chips).map(function (id) { return S.chips[id]; }).filter(function (c) { return c.player === S.you; });
      if (mine.length) S.lastMine = mine.map(function (c) { return { type: c.type, numbers: c.numbers, amount: c.amount }; });
      S.chips = {}; S.pending = []; S.myTotal = 0; S.spin = null; S.revealed = false; S.results = null; S.settled = null;
      if (bannerC) bannerC.visible = false;
      if (S.canBet === false && r.status === "betting" && S.joinedRoundId != null && r.id !== S.joinedRoundId) S.canBet = true;
      renderResults();
    }
    S.round = r;
    if (r.nextRoundAt) S.nextRoundAt = r.nextRoundAt;
    if (r.status === "spinning" || (r.number != null && r.resultAt)) startSpin(r);
    if (r.status === "settled" && !S.revealed) { S.spin = null; S.revealed = true; afterReveal(); }
    renderChips(); renderHighlights(); renderRack(); renderStatus(true);
  }
  function startSpin(r) {
    if (r.number == null || !r.resultAt) return;
    if (S.spin && S.spin.roundId === r.id) return;
    var resultAt = at(r.resultAt), startAt = at(r.bettingEndsAt) || resultAt - (r.spinSeconds || 30) * 1000;
    S.spin = { roundId: r.id, number: r.number, startAt: startAt, resultAt: resultAt, golden: r.golden === true };
    lastTickPocket = -1;
    if (now() >= resultAt) { S.revealed = true; afterReveal(); }
    else if (S.spin.golden) {
      announce("No more bets. The golden ball! Every win of this round pays ×" + RULES.goldenMultiplier + ".");
      showBanner("GOLDEN BALL!", "All wins ×" + RULES.goldenMultiplier, "#ffd84d", 3000); sfx.bigWin();
    } else { announce("No more bets. The wheel is spinning."); sfx.press(); }
  }
  // At resultAt: the number appears in text for the first time.
  function reveal() {
    if (S.revealed) return;
    S.revealed = true;
    sfx.wheelStop();
    afterReveal();
  }
  function afterReveal() {
    var r = S.round; if (!r) return;
    var n = r.number != null ? r.number : S.spin && S.spin.number;
    if (n == null) return;
    r.number = n;
    if (recentNumbers._round !== r.id) { recentNumbers.unshift({ n: n, golden: isGolden(r) }); recentNumbers._round = r.id; drawHistory(); }
    announce("The ball lands on " + n + " " + colorOf(n) + ".");
    renderChips(); renderHighlights(); renderStatus(true); renderResults();
    if (S.settled) celebrateMine();
    if (S.spin) placeBall(wheelAngle + pocketAngle(n), G.R.pocket);
  }
  function celebrateMine() {
    var st = S.settled; if (!st || !S.revealed || st._shown) return;
    st._shown = true;
    if (st.win > 0) {
      var gold = isGolden(S.round);
      showBanner(gold ? "GOLDEN WIN ×" + RULES.goldenMultiplier + "!" : st.win >= st.bet * 10 ? "BIG WIN!" : "YOU WIN!", "+" + sats(st.win), gold ? "#ffd84d" : null);
      (st.win >= st.bet * 10 ? sfx.bigWin : sfx.win).call(sfx);
      var p = S.round && S.round.number != null ? (function () { var a = anchorOf("straight", [S.round.number]); return LA(a.L, a.a); }()) : { x: G.W / 2, y: G.H / 2 };
      emit(Math.min(60, 12 + Math.round(st.win / Math.max(1, st.bet)) * 4), p.x, p.y);
    } else if (st.bet > 0) { showBanner("NO WIN", "−" + sats(st.bet), "#cfd8dc"); sfx.noWin(); }
  }

  function handle(m) {
    if (m.serverTime) setServerTime(m.serverTime);
    switch (m.type) {
      case "table":
        S.you = m.you || S.you; S.canBet = !!m.canBet; S.nextRoundAt = m.nextRoundAt || null;
        if (m.rules && m.rules.payoutPockets) { RULES = Object.assign({}, RULES, m.rules); $("rt-rules").innerHTML = rulesHtml(); }
        S.players = (m.players || []).slice();
        S.chips = {}; (m.bets || []).forEach(function (c) { S.chips[c.id] = c; });
        S.myTotal = mineTotal();
        if (m.round) { if (!m.canBet && signedIn()) S.joinedRoundId = m.round.id; roundChanged(m.round); }
        else { S.round = null; renderStatus(true); }
        // re-apply the chips (roundChanged cleared them for a new round)
        S.chips = {}; (m.bets || []).forEach(function (c) { S.chips[c.id] = c; }); S.myTotal = mineTotal();
        renderPlayers(); renderChips(); renderRack(); renderResults();
        break;
      case "round": roundChanged(m.round); break;
      case "bets":
        if (S.round && m.roundId !== S.round.id) break;
        (m.bets || []).forEach(function (c) { c.player = c.player || m.player; S.chips[c.id] = c; });
        if (m.player === S.you) { S.pending = []; S.myTotal = m.total; }
        if (m.player !== S.you) sfx.chip();
        renderChips(); renderPlayers(); renderRack(); renderResults();
        break;
      case "cleared":
        if (S.round && m.roundId !== S.round.id) break;
        Object.keys(S.chips).forEach(function (id) { if (S.chips[id].player === m.player) delete S.chips[id]; });
        if (m.player === S.you) { S.pending = []; S.myTotal = 0; }
        renderChips(); renderPlayers(); renderRack(); renderResults();
        break;
      case "spin": roundChanged(m.round); break;
      case "result":
        S.results = m.results || [];
        if (m.round) { S.round = Object.assign({}, S.round || {}, m.round); }
        if (now() >= (S.spin ? S.spin.resultAt : 0)) reveal();
        renderResults();
        loadRounds(true);
        break;
      case "settled":
        S.settled = { roundId: m.roundId, bet: m.bet, win: m.win, balance: m.balance };
        S.balance = m.balance; if (Auth && Auth.setBalance) Auth.setBalance(m.balance);
        if (S.revealed) celebrateMine();
        renderStatus(true);
        break;
      case "joined":
        if (S.players.indexOf(m.player) === -1) S.players.push(m.player);
        if (m.player !== S.you) sysLine(m.player + " joined the table.");
        renderPlayers(); break;
      case "left":
        S.players = S.players.filter(function (p) { return p !== m.player; });
        sysLine(m.player + " left the table.");
        renderPlayers(); break;
      case "chat": chatLine(m.player, m.text, m.at); break;
      case "error": chatError(m.message || m.error); break;
    }
  }
  function mineTotal() { var t = 0; Object.keys(S.chips).forEach(function (id) { if (S.chips[id].player === S.you) t += S.chips[id].amount; }); return t; }

  /* ═══════════════ Placing chips ═══════════════ */
  function canPlace() { return signedIn() && S.canBet && S.connected && phase() === "betting"; }
  var queue = [], flushTimer = 0, sending = false;
  function placeChip(spot) {
    if (!signedIn()) { lockEl.hidden = false; return; }
    if (!S.canBet) { toast("You joined mid-round: you can bet from the next round."); return; }
    if (phase() !== "betting") { toast("No more bets."); sfx.tilt(); return; }
    var pendingSum = S.pending.reduce(function (a, c) { return a + c.amount; }, 0);
    if (S.myTotal + pendingSum + S.chipValue > ROUND_LIMIT) { toast("At most " + fmt(ROUND_LIMIT) + " tBCH sats a round."); sfx.tilt(); return; }
    if (S.balance != null && S.chipValue > S.balance - pendingSum) { toast("Not enough credit for that chip."); sfx.tilt(); return; }
    var chip = { type: spot.type, numbers: spot.numbers, amount: S.chipValue };
    S.pending.push(chip); queue.push(chip);
    sfx.chip(); renderChips(); renderRack();
    clearTimeout(flushTimer); flushTimer = setTimeout(flush, 250);   // taps close together go in one request
  }
  function flush() {
    if (sending || !queue.length || !S.round) return;
    var batch = queue.splice(0, MAX_PER_REQUEST), roundId = S.round.id;
    sending = true;
    api.rouletteBet(roundId, newRequestId(), batch.map(function (c) { var b = { type: c.type, amount: c.amount }; if (c.numbers) b.numbers = c.numbers; return b; })).then(function (r) {
      sending = false;
      if (r.status === 200 && r.data) {
        (r.data.bets || []).forEach(function (c) { c.player = c.player || S.you; S.chips[c.id] = c; });
        S.pending = S.pending.filter(function (c) { return batch.indexOf(c) === -1; });
        S.myTotal = r.data.total; S.balance = r.data.balance; if (Auth && Auth.setBalance) Auth.setBalance(r.data.balance);
      } else {
        S.pending = S.pending.filter(function (c) { return batch.indexOf(c) === -1; });
        var code = api.errorCode(r);
        if (code === "not_in_round") S.canBet = false;
        toast(api.errorText(r, "Your chips were not placed.")); sfx.tilt();
        if (r.status === 401 && Auth) Auth.set(null);
      }
      renderChips(); renderRack(); renderStatus(true); renderResults();
      if (queue.length) flush();
    });
  }
  function clearBets() {
    if (!canPlace() || !(S.myTotal > 0 || S.pending.length)) return;
    queue = []; S.pending = [];
    api.rouletteClear(S.round.id).then(function (r) {
      if (r.status === 200 && r.data) {
        Object.keys(S.chips).forEach(function (id) { if (S.chips[id].player === S.you) delete S.chips[id]; });
        (r.data.bets || []).forEach(function (c) { c.player = c.player || S.you; S.chips[c.id] = c; });
        S.myTotal = r.data.total; S.balance = r.data.balance; if (Auth && Auth.setBalance) Auth.setBalance(r.data.balance);
        sfx.chip();
      } else toast(api.errorText(r, "Your chips could not be taken back."));
      renderChips(); renderRack(); renderStatus(true); renderResults();
    });
  }
  function repeatBets() {
    if (!canPlace() || !S.lastMine.length) return;
    var sum = S.lastMine.reduce(function (a, c) { return a + c.amount; }, 0);
    if (S.myTotal + sum > ROUND_LIMIT) { toast("Repeating would pass " + fmt(ROUND_LIMIT) + " tBCH sats this round."); return; }
    S.lastMine.forEach(function (c) { var x = { type: c.type, numbers: c.numbers, amount: c.amount }; S.pending.push(x); queue.push(x); });
    sfx.chip(); renderChips(); renderRack(); flush();
  }
  var toastT = 0, toastMsg = "";
  function toast(msg) {
    toastMsg = msg; announce(msg);
    if (statusSub) { statusSub.text = msg; statusSub.style.fill = "#ffb3bb"; }
    clearTimeout(toastT); toastT = setTimeout(function () { toastMsg = ""; if (statusSub) statusSub.style.fill = "#bfe9cf"; renderStatus(true); }, 2600);
    lastStatusKey = "toast";
  }
  var renderStatusBase = renderStatus;
  renderStatus = function (force) { if (toastMsg) return; renderStatusBase(force); };

  /* ═══════════════ The WebSocket ═══════════════ */
  var ws = null, pingT = 0, retry = 0, retryT = 0, closedByUs = false;
  function connect() {
    if (!signedIn() || ws) return;
    closedByUs = false;
    try { ws = new WebSocket(api.rouletteSocketUrl()); } catch (e) { scheduleReconnect(); return; }
    ws.onopen = function () { S.connected = true; retry = 0; clearInterval(pingT); pingT = setInterval(function () { send({ type: "ping" }); }, PING_MS); renderRack(); };
    ws.onmessage = function (e) { var m; try { m = JSON.parse(e.data); } catch (x) { return; } handle(m); };
    ws.onclose = function () { S.connected = false; ws = null; clearInterval(pingT); renderRack(); if (!closedByUs) scheduleReconnect(); };
    ws.onerror = function () {};
  }
  function scheduleReconnect() {
    clearTimeout(retryT);
    if (!signedIn()) return;
    var wait = [500, 1000, 2000, 4000, 8000][Math.min(retry++, 4)];
    sysLine(retry === 1 ? "Connection lost. Reconnecting…" : null);
    retryT = setTimeout(connect, wait);
  }
  function disconnect() { closedByUs = true; clearTimeout(retryT); clearInterval(pingT); if (ws) { try { ws.close(); } catch (e) {} ws = null; } S.connected = false; }
  function send(m) { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(m)); return true; } return false; }

  // Signed out: the table from GET /roulette/state, read again every 10 s
  var stateT = 0;
  function pollState() {
    clearTimeout(stateT);
    if (signedIn()) return;
    api.rouletteState().then(function (r) { if (r.status === 200 && r.data) handle(r.data); stateT = setTimeout(pollState, 10000); });
  }

  /* ═══════════════ Chat, players, results (HTML) ═══════════════ */
  var chatEl = $("rt-chat"), playersEl = $("rt-players"), resultsEl = $("rt-results");
  function trimChat() { while (chatEl.children.length > 150) chatEl.removeChild(chatEl.firstChild); chatEl.scrollTop = chatEl.scrollHeight; }
  function chatLine(player, text, when) {
    var li = el("li", player === S.you ? "rt-msg is-me" : "rt-msg");
    var who = el("span", "rt-who", player === S.you ? "You" : player); who.style.color = hashColor(player || "?");
    var d = new Date(when || Date.now());
    li.appendChild(el("time", "rt-at", isNaN(d) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })));
    li.appendChild(who);
    li.appendChild(el("span", "rt-text", String(text)));   // plain text, never HTML
    chatEl.appendChild(li); trimChat();
  }
  function sysLine(t) { if (!t) return; chatEl.appendChild(el("li", "rt-sys", t)); trimChat(); }
  function chatError(t) { var e = $("rt-chat-error"); e.textContent = t; e.hidden = false; clearTimeout(chatError.t); chatError.t = setTimeout(function () { e.hidden = true; }, 3000); }
  $("rt-say").addEventListener("submit", function (e) {
    e.preventDefault();
    var input = $("rt-text"), text = input.value.trim();
    if (!text) return;
    if (!signedIn()) { chatError("Sign in to chat."); return; }
    if (text.length > 200) { chatError("At most 200 characters."); return; }
    if (!send({ type: "chat", text: text })) { chatError("Not connected. Reconnecting…"); return; }
    input.value = "";
  });
  function renderPlayers() {
    playersEl.textContent = "";
    var totals = {};
    Object.keys(S.chips).forEach(function (id) { var c = S.chips[id]; totals[c.player] = (totals[c.player] || 0) + c.amount; });
    S.players.forEach(function (p) {
      var li = el("li", p === S.you ? "is-me" : "");
      var dot = el("span", "rt-dot"); dot.style.background = hashColor(p); li.appendChild(dot);
      li.appendChild(el("span", "rt-name", p === S.you ? p + " (you)" : p));
      if (totals[p]) li.appendChild(el("span", "rt-bet", sats(totals[p])));
      playersEl.appendChild(li);
    });
    if (!S.players.length) playersEl.appendChild(el("li", "rt-sys", "Nobody at the table yet."));
  }
  function renderResults() {
    resultsEl.textContent = "";
    var r = S.round;
    if (!r) { resultsEl.appendChild(el("p", "acct-empty", "Waiting for the next round.")); return; }
    var head = el("p", "rt-round-head", "Round " + r.id + (S.revealed && r.number != null ? ": " + r.number + " " + colorOf(r.number) : ""));
    resultsEl.appendChild(head);
    if (isGolden(r)) {
      var gl = el("p", "rt-golden-note"); gl.appendChild(el("span", "rt-gball")); gl.appendChild(document.createTextNode(" Golden ball: every win of this round pays ×" + RULES.goldenMultiplier + "."));
      resultsEl.appendChild(gl);
    }
    if (S.revealed && S.results) {
      if (!S.results.length) { resultsEl.appendChild(el("p", "acct-empty", "No bets this round.")); return; }
      var ul = el("ul", "rt-res");
      S.results.forEach(function (x) {
        var net = x.win - x.bet, li = el("li", x.player === S.you ? "is-me" : "");
        var dot = el("span", "rt-dot"); dot.style.background = hashColor(x.player); li.appendChild(dot);
        li.appendChild(el("span", "rt-name", x.player === S.you ? "You" : x.player));
        if (x.win > 0 && isGolden(r)) li.appendChild(el("span", "rt-x10", "×" + RULES.goldenMultiplier));
        li.appendChild(el("span", "rt-amt " + (net > 0 ? "is-win" : net < 0 ? "is-loss" : ""), (net > 0 ? "+" : net < 0 ? "−" : "±") + sats(Math.abs(net))));
        li.title = "Bet " + sats(x.bet) + ", won " + sats(x.win);
        ul.appendChild(li);
      });
      resultsEl.appendChild(ul);
      return;
    }
    var by = {};
    Object.keys(S.chips).forEach(function (id) { var c = S.chips[id]; (by[c.player] = by[c.player] || []).push(c); });
    var players = Object.keys(by);
    if (!players.length) { resultsEl.appendChild(el("p", "acct-empty", phase() === "betting" ? "No chips on the table yet." : "No bets this round.")); return; }
    var list = el("ul", "rt-res");
    players.forEach(function (p) {
      var li = el("li", p === S.you ? "is-me" : ""), sum = by[p].reduce(function (a, c) { return a + c.amount; }, 0);
      var dot = el("span", "rt-dot"); dot.style.background = hashColor(p); li.appendChild(dot);
      li.appendChild(el("span", "rt-name", (p === S.you ? "You" : p) + " · " + by[p].length + " chip" + (by[p].length > 1 ? "s" : "")));
      li.appendChild(el("span", "rt-amt", sats(sum)));
      li.title = by[p].map(function (c) { return (TYPE_NAMES[c.type] || c.type) + (c.numbers && c.numbers.length ? " " + c.numbers.join("-") : "") + ": " + c.amount; }).join("\n");
      list.appendChild(li);
    });
    resultsEl.appendChild(list);
  }

  /* ═══════════════ Previous rounds ═══════════════ */
  var roundsCursor = null, roundsBusy = false;
  function loadRounds(fresh) {
    if (roundsBusy) return;
    roundsBusy = true;
    if (fresh) roundsCursor = null;
    api.rouletteRounds(fresh ? null : roundsCursor).then(function (r) {
      roundsBusy = false;
      if (r.status !== 200 || !r.data) return;
      var body = $("rt-rounds");
      if (fresh) body.textContent = "";
      var items = (r.data.items || []).filter(function (x) { return x.number != null && x.status === "settled"; });
      items.forEach(function (x) { body.appendChild(roundRow(x)); });
      if (fresh) {
        recentNumbers = items.map(function (x) { return { n: x.number, golden: x.golden === true }; });
        if (S.round && S.revealed && S.round.number != null && items[0] && items[0].id !== S.round.id) recentNumbers.unshift({ n: S.round.number, golden: isGolden(S.round) });
        recentNumbers._round = S.round && S.revealed ? S.round.id : null;
        drawHistory();
      }
      roundsCursor = r.data.nextCursor || null;
      $("rt-more").hidden = !roundsCursor;
      $("rt-rounds-empty").hidden = body.children.length > 0;
    });
  }
  function ballHtml(n) { var s = el("span", "rt-ball rt-" + colorOf(n), String(n)); return s; }
  function roundRow(x) {
    var tr = el("tr");
    tr.appendChild(el("td", "", "#" + x.id));
    var d = new Date(x.startsAt);
    tr.appendChild(el("td", "", isNaN(d) ? "" : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })));
    var td = el("td"); td.appendChild(ballHtml(x.number));
    if (x.golden === true) { var gb = el("span", "rt-gball"); gb.title = "Golden ball: every win ×" + RULES.goldenMultiplier; gb.setAttribute("role", "img"); gb.setAttribute("aria-label", "golden ball"); td.appendChild(gb); }
    tr.appendChild(td);
    var ck = el("td"), b = el("button", "btn-ghost rt-verify", "Details");
    b.type = "button"; b.setAttribute("aria-expanded", "false");
    b.addEventListener("click", function () { toggleDetail(tr, b, x.id); });
    ck.appendChild(b); tr.appendChild(ck);
    return tr;
  }
  function toggleDetail(tr, btn, id) {
    var next = tr.nextElementSibling;
    if (next && next.classList.contains("rt-detail")) { next.remove(); btn.setAttribute("aria-expanded", "false"); return; }
    var row = el("tr", "rt-detail"), cell = el("td", "", "Loading…"); cell.colSpan = 4; row.appendChild(cell);
    tr.parentNode.insertBefore(row, tr.nextSibling); btn.setAttribute("aria-expanded", "true");
    api.rouletteRound(id).then(function (r) {
      if (r.status !== 200 || !r.data) { cell.textContent = api.errorText(r, "This round could not be loaded."); return; }
      var rd = r.data.round, bets = r.data.bets || [];
      cell.textContent = "";
      var dl = el("dl", "seed-list");
      var rules = Number(rd.rules || 1);
      [["Number", rd.number + " " + colorOf(rd.number)], ["Spin", (rd.spinSeconds || "?") + " s"]].concat(rules === 2 ? [["Golden ball", rd.golden ? "yes: every win ×" + RULES.goldenMultiplier : "no"]] : [])
        .concat([["Rules", rules === 2 ? "2: stake × 36 / n, golden ball" : "1: stake × 37 / n (before the golden ball)"], ["Seed hash (published when betting opened)", rd.seedHash], ["Seed (revealed)", rd.seed || "not yet"]]).forEach(function (p) {
        var div = el("div"); div.appendChild(el("dt", "", p[0])); div.appendChild(el("dd", "auth-mono", p[1])); dl.appendChild(div);
      });
      cell.appendChild(dl);
      if (bets.length) {
        var t = el("table", "acct-table rt-chips"), hb = el("tbody");
        t.innerHTML = '<thead><tr><th scope="col">Player</th><th scope="col">Bet</th><th scope="col" class="num">Stake</th><th scope="col" class="num">Payout</th></tr></thead>';
        bets.forEach(function (c) {
          var tr2 = el("tr");
          tr2.appendChild(el("td", "", c.player));
          tr2.appendChild(el("td", "", (TYPE_NAMES[c.type] || c.type) + (c.numbers && c.numbers.length && c.type !== "red" ? " " + c.numbers.join("-") : "")));
          tr2.appendChild(el("td", "num", fmt(c.amount)));
          tr2.appendChild(el("td", "num", c.payout != null ? fmt(c.payout) : "…"));
          hb.appendChild(tr2);
        });
        t.appendChild(hb);
        var wrap = el("div", "tbl-wrap"); wrap.appendChild(t); cell.appendChild(wrap);
      } else cell.appendChild(el("p", "acct-empty", "No bets this round."));
      if (rd.seed && Fair && Fair.roulette) {
        var out = el("div", "rt-check", "Checking…"); cell.appendChild(out);
        Fair.roulette(rd.seed, rd.id, bets.map(function (c) { return { amount: c.amount, numbers: covers(c) }; }), rules).then(function (v) {
          var checks = [[v.seedHash === String(rd.seedHash).toLowerCase(), "SHA-256 of the seed equals the seed hash published when betting opened"],
            [v.number === rd.number, "The seed gives number " + v.number + " (the round says " + rd.number + ")"],
            [rd.spinSeconds == null || v.spinSeconds === rd.spinSeconds, "The seed gives a " + v.spinSeconds + " s spin"]].concat(rules === 2 ? [
            [v.golden === !!rd.golden, v.golden ? "The seed gives a golden ball (every win ×" + RULES.goldenMultiplier + "), as played" : "The seed gives no golden ball, as played"]] : []).concat([
            [bets.every(function (c, i) { return c.payout == null || c.payout === v.payouts[i]; }), "Every payout matches (" + bets.length + " chip" + (bets.length === 1 ? "" : "s") + ")"]]);
          var ok = checks.every(function (c) { return c[0]; });
          out.textContent = "";
          out.appendChild(el("p", "jpw-verdict " + (ok ? "is-ok" : "is-bad"), ok ? "✓ This round is fair: every check passed." : "✗ This round does NOT check out."));
          var ul = el("ul", "jpw-checks");
          checks.forEach(function (c) { ul.appendChild(el("li", c[0] ? "is-ok" : "is-bad", (c[0] ? "✓ " : "✗ ") + c[1] + ".")); });
          out.appendChild(ul);
        }, function (e) { out.textContent = (e && e.message) || "Could not check this round."; });
      }
    });
  }
  $("rt-more").addEventListener("click", function () { loadRounds(false); });

  /* ═══════════════ Start ═══════════════ */
  function onAuth() {
    var inn = signedIn();
    lockEl.hidden = inn;
    $("rt-login").href = Auth ? Auth.loginHref() : "../login.html";
    if (inn) { S.balance = typeof Auth.balance === "number" ? Auth.balance : S.balance; clearTimeout(stateT); connect(); }
    else { disconnect(); S.you = null; S.canBet = false; pollState(); }
    renderRack(); renderStatus(true);
  }
  function start() {
    if (!PIXI) { root.insertAdjacentHTML("afterbegin", '<p class="panel">The roulette table needs PixiJS and could not start.</p>'); return; }
    var fontsReady = document.fonts && document.fonts.load ? Promise.race([document.fonts.load("20px Bungee"), sleep(1500)]) : Promise.resolve();
    fontsReady.then(initPixi).then(function () {
      renderPlayers(); renderResults(); loadRounds(true);
      if (Auth) {
        Auth.onChange(function () { if (!signedIn() || !ws) onAuth(); S.balance = signedIn() && typeof Auth.balance === "number" ? Auth.balance : S.balance; renderStatus(true); });
        (Auth.ready || Promise.resolve()).then(onAuth);
      } else pollState();
      document.addEventListener("visibilitychange", function () { if (!document.hidden && signedIn() && !ws) connect(); });
      window.TNC_RouletteState = function () {
        return { phase: phase(), round: S.round && { id: S.round.id, status: S.round.status, number: S.revealed ? S.round.number : undefined }, canBet: S.canBet, you: S.you,
          connected: S.connected, chips: Object.keys(S.chips).length, pending: S.pending.length, myTotal: S.myTotal, revealed: S.revealed,
          status: statusMain && statusMain.text, sub: statusSub && statusSub.text, banner: bannerC && bannerC.visible ? bannerTitle.text + " | " + bannerAmt.text : "",
          layout: G && G.name, recent: recentNumbers.slice(0, 5).map(function (h) { return h.n; }), recentGolden: recentNumbers.slice(0, 5).map(function (h) { return !!h.golden; }),
          golden: !!(S.spin && S.spin.golden), rules: RULES, hoverTip: hoverTip && hoverTip.visible ? hoverTip.text : "",
          spotPoint: function (type, numbers) { var a = anchorOf(type, numbers), p = LA(a.L, a.a), k = app.screen.width / G.W; return { x: p.x * k, y: p.y * k }; } };
      };
    });
  }
  start();
})();
