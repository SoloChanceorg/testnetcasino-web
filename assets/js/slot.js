/*
 * TestnetCasino.com: slot machine UI (5 reels × 3 rows, 10 paylines).
 *
 * A thin client of testnetcasino-service. Every outcome comes from
 * POST /spins: the server returns the whole spin as `steps[]` (reel stops,
 * respins, free spins, bonus games) and this file only animates them. Win
 * values arrive as whole sats and are shown as they come: in tSats by default,
 * or in tBCH with the machine's unit switch (bets are always tSats). Paytables,
 * symbols and texts come from GET /games/{id}/config. Randomness here is
 * cosmetic only (blurred symbols while the reels turn, confetti, wheel
 * jitter); it never decides a result.
 *
 * Playing requires signing in: signed-out visitors see the machine with a
 * "Sign in to play" button.
 *
 * Depends on: api.js (TNC_API), auth.js (TNC_Auth),
 *             audio.js (TNC_sfx, optional), fx.js (TNC_fx, optional)
 */
(function () {
  "use strict";

  var api = window.TNC_API;
  var MIN_BET = 1;
  var MAX_BET = 1000;
  var SPIN_RETRIES = 3;          // network errors and 5xx: retried with the SAME requestId
  var REELS = 5, ROWS = 3, PAYLINES = [], MAX_FREE_SPINS = 100;   // from the game config
  var LINE_COLORS = ["#ffd166", "#06d6a0", "#ef476f", "#4cc9f0", "#f78c6b",
                     "#c86bff", "#83e377", "#ff99c8", "#f9c74f", "#90e0ef"];
  var NS = "http://www.w3.org/2000/svg";

  // Per-theme flavour: confetti, no-win quips, welcome line, free-spin twist label.
  var FLAVOR = {
    orchard: {
      burst: ["🍒", "🍋", "🍊", "🍇", "🍉", "🍃", "🌸"],
      quips: ["No fruit this time.", "The orchard is quiet… spin again!", "Not ripe yet!", "A gentle breeze, nothing more."],
      welcome: "Welcome to the orchard! Pick a price tag and press SPIN",
      action: "Press SPIN!",
      twist: "STICKY WILDS"
    },
    deepsea: {
      burst: ["💎", "🐚", "🐠", "🦪", "🪙"],
      quips: ["Only seaweed down here…", "The current carried it away.", "Nothing in this net.", "Dive again!"],
      welcome: "Welcome aboard, diver! Turn the dial and press DIVE",
      action: "Press DIVE!",
      twist: "RISING TIDE"
    },
    cosmic: {
      burst: ["⭐", "✨", "🌟", "💫", "🪐"],
      quips: ["Lost signal. Try again!", "Nothing but dark matter.", "Houston, no win.", "Recalibrating the thrusters…"],
      welcome: "Welcome, commander! Set the thrust and press LAUNCH",
      action: "Press LAUNCH!",
      twist: "ALL WINS ×3"
    }
  };

  var noop = function () {};
  var sfx = window.TNC_sfx || {};
  ["setTheme", "setMuted", "press", "spinStart", "startSpinLoop", "stopSpinLoop", "reelStop", "scatter", "anticipation",
   "lineBlip", "countTick", "noWin", "win", "bigWin", "megaWin", "jackpot", "freeSpins", "feature", "bonusStart",
   "reveal", "collect", "wheelTick", "wheelStop", "ladderUp", "ladderFail", "tilt", "chip"].forEach(function (k) { if (!sfx[k]) sfx[k] = noop; });
  if (!sfx.isMuted) sfx.isMuted = function () { return true; };
  var fx = window.TNC_fx || { coinShower: noop, burst: noop };

  /* ---------- Cosmetic randomness (never decides an outcome) ---------- */

  function rnd(n) { return Math.floor(Math.random() * n); }
  function newRequestId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16); crypto.getRandomValues(b);
    return Array.from(b, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
  }
  // Symbol indexes by role. Regular symbols are listed common → rare, so the last one is the top symbol.
  function kinds(game) {
    var k = { wild: -1, scatter: -1, bonus: -1, top: -1 };
    game.symbols.forEach(function (s, i) { if (s.kind) k[s.kind] = i; else k.top = i; });
    return k;
  }
  // Per-reel pickers for the blurred symbols shown while a reel turns.
  function makePickers(game) {
    var out = [];
    for (var c = 0; c < REELS; c++) {
      var ids = [], total = 0;
      game.symbols.forEach(function (s, i) {
        if (!s.reels || s.reels.indexOf(c) !== -1) { ids.push([i, s.weight]); total += s.weight; }
      });
      out.push((function (ids, total) {
        return function () {
          var x = rnd(total);
          for (var j = 0; j < ids.length; j++) { if (x < ids[j][1]) return ids[j][0]; x -= ids[j][1]; }
          return ids[0][0];
        };
      }(ids, total)));
    }
    return out;
  }

  /* ---------- Helpers ---------- */

  function fmt(n) { return n.toLocaleString("en-US"); }
  // Credit and wins in the machine's unit (tSats or tBCH); bets are always tSats.
  var GU = window.TNC_Units && window.TNC_Units.game;
  function amt(n) { return GU ? GU.format(n) : fmt(n) + " tSats"; }
  function num(n) { return GU ? GU.value(n) : fmt(n); }
  function unitLabel() { return GU ? GU.unit() : "tSats"; }
  function fmtMult(m) { return (m % 1 ? m.toFixed(1).replace(/\.0$/, "") : String(m)); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function sessionGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function sessionSet(k, v) { try { sessionStorage.setItem(k, String(v)); } catch (e) {} }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  /* ---------- UI ---------- */

  function init() {
    var root = document.getElementById("app");
    var id = document.body.getAttribute("data-game");
    if (!root || !id || !api) return;
    root.insertAdjacentHTML("afterbegin", '<p class="panel m-loading" id="m-loading" role="status">Loading the machine…</p>');
    var msg = document.getElementById("m-loading");
    (function load(attempt) {
      api.gameConfig(id).then(function (r) {
        if (r.status === 200 && r.data && r.data.symbols && r.data.engine) { build(root, id, r.data); return; }
        if (attempt < 2 && (r.status === 0 || r.status >= 500)) { setTimeout(function () { load(attempt + 1); }, 1500 * (attempt + 1)); return; }
        msg.innerHTML = esc(api.errorText(r, "This machine could not be loaded.")) + ' <button type="button" class="btn-gold" id="m-retry">Try again</button>';
        document.getElementById("m-retry").addEventListener("click", function () { msg.textContent = "Loading the machine…"; load(0); });
      });
    }(0));
  }

  function build(root, id, game) {
    var Auth = window.TNC_Auth;
    REELS = game.engine.reels || 5;
    ROWS = game.engine.rows || 3;
    PAYLINES = game.engine.paylines;
    MAX_FREE_SPINS = game.engine.maxFreeSpins || 100;

    var syms = game.symbols;
    var K = kinds(game);
    var WILD = K.wild, SCAT = K.scatter, BONUS = K.bonus, TOP = K.top;
    var FS = game.freeSpins, BON = game.bonus;
    var S = game.payScale || 1;                         // faucet boost the server applies to every payout
    var RTP = ((game.rtp || game.stats.rtp) * 100).toFixed(2) + "%";
    var BOOST = "+" + ((S - 1) * 100).toFixed(1) + "%";
    function rawSats(x) { return amt(Math.floor(bet * x * S)); }   // preview of a paytable value (display only)
    var flavor = FLAVOR[game.theme] || FLAVOR.orchard;
    var pickers = makePickers(game);
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    sfx.setTheme(game.theme);

    function signedIn() { return !!(Auth && Auth.user); }
    function currentBalance() { return signedIn() && typeof Auth.balance === "number" ? Auth.balance : 0; }
    var authKnown = !Auth;     // false until GET /me answered, so the lock does not flash for players

    var busy = false;          // a spin, feature or bonus is in progress
    var feature = null;        // { left, played, total, mult, sticky } while free spins run
    var presentToken = 0;      // cancels running celebrations when a new step starts
    var bet = clampBet(parseInt(sessionGet("tnc.bet." + id), 10) || 10);
    var balShown = currentBalance();
    var grid = [];
    for (var gc = 0; gc < REELS; gc++) grid.push(picksFor(gc, ROWS));

    /* --- Markup: each game has its own machine (cabinet, spin control, bet control) --- */
    var LADDER = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];   // bet steps for − / + / dial / throttle
    var words = game.name.toUpperCase().split(" ");
    var titleHtml = words.length > 1
      ? esc(words.slice(0, -1).join(" ")) + " <span>★</span> " + esc(words[words.length - 1])
      : esc(words[0]);
    var P = {
      sound: '<div class="m-tools"><button type="button" class="m-tool sound-toggle" id="sound-toggle" aria-pressed="false">🔊</button>' +
        '<button type="button" class="m-tool fs-toggle" id="fs-toggle" aria-pressed="false"></button></div>',
      sign: '<div class="sign-slot"><ul class="feature-bar" aria-label="Machine features">' +
          '<li><span class="e">' + syms[WILD].emoji + '</span>' + esc(game.featureName) + '</li>' +
          '<li><span class="e">' + syms[SCAT].emoji + '</span>' + esc(FS.name) + '</li>' +
          '<li><span class="e">' + syms[BONUS].emoji + '</span>' + esc(BON.name) + ' Bonus</li>' +
        '</ul><div class="fs-sign" id="fs-sign" hidden></div></div>',
      reels: '<div class="reels-window" id="reels-window" role="img" aria-label="Slot reels">' +
          new Array(REELS + 1).join('<div class="reel"><div class="reel-strip"></div></div>') +
          '<div class="sticky-layer" id="sticky-layer" aria-hidden="true"></div>' +
          '<svg class="paylines-svg" id="paylines" aria-hidden="true"></svg>' +
          '<div class="reel-toast" id="reel-toast" aria-hidden="true"></div>' +
          '<div class="win-banner" id="win-banner" aria-hidden="true"><div class="rays"></div>' +
            '<div class="wb-title" id="wb-title"></div><div class="wb-amount" id="wb-amount"></div></div>' +
        '</div>' +
        '<div class="m-lock" id="m-lock" hidden><a class="btn-red m-lock-btn" id="m-lock-btn" href="#">🔑 Sign in to play</a>' +
          '<p>New accounts get 10,000 free tSats (0.0001 tBCH).</p></div>',
      lcd: function (extra) {
        return '<div class="slot-lcd" id="slot-lcd">' + (extra || '') +
          '<div class="lcd-text"><div class="lcd-main" id="lcd-main"></div><div class="lcd-sub" id="lcd-sub"></div></div></div>';
      },
      readout: function (id, label, unit) {
        return '<div class="m-readout"><div class="ro-label">' + label + '</div><div class="ro-value" id="' + id + '">0</div><div class="ro-unit" data-unit>' + unit + '</div></div>';
      },
      input: function (cls) {
        return '<input id="bet-input" class="' + cls + '" type="number" inputmode="numeric" min="' + MIN_BET + '" max="' + MAX_BET + '" step="1" aria-label="Bet in tSats">';
      },
      tail: '<ul class="breakdown" id="breakdown" aria-label="Wins on the last spin"></ul>' +
        '<div class="m-util">' +
          '<button type="button" class="unit-switch" id="unit-switch" role="switch" aria-label="Show credit in tBCH">' +
            '<span class="us-opt" data-u="sat">tSats</span><span class="us-opt" data-u="bch">tBCH</span></button>' +
          '<a class="btn-ghost" href="../account.html#withdraw">📤 Withdraw tBCH</a>' +
          '<a class="btn-ghost" href="../fairness.html">⚖️ Verify spins</a>' +
        '</div>',
      stage: '<div class="bonus-stage" id="bonus-stage" role="dialog" aria-label="Bonus game" hidden></div>'
    };
    function hint(verb) { return '<p class="m-hint">' + verb + ' · or press <b>Space</b>. Testnet coins only: no real money.</p>'; }
    function short(v) { return v >= 1000 ? (v / 1000) + "K" : String(v); }

    function machineOrchard() {
      return '<div class="machine m-orchard" id="slot-machine">' +
        '<div class="or-awning" aria-hidden="true"><span class="or-bulbs"></span></div>' + P.sound +
        '<div class="or-sign"><h1 class="m-title">' + titleHtml + '</h1></div>' +
        '<div class="or-crate">' + P.sign +
          '<div class="or-window">' + P.reels + '</div>' +
          P.lcd() +
          '<div class="or-deck">' +
            '<div class="or-left">' +
              '<div class="or-readouts">' + P.readout("meter-win", "WIN", unitLabel()) + P.readout("meter-bal", "BALANCE", unitLabel()) + '</div>' +
              '<div class="or-betbox">' +
                '<label class="or-label" for="bet-input">Your bet <small>tSats · all 10 lines</small></label>' +
                '<div class="or-stepper"><button type="button" class="or-crate-btn" id="bet-down" aria-label="Lower bet">−</button>' +
                  P.input("or-chalk") +
                  '<button type="button" class="or-crate-btn" id="bet-up" aria-label="Raise bet">+</button></div>' +
                '<div class="or-tags" role="group" aria-label="Quick bets">' + [1, 10, 100, 500, 1000].map(function (v) {
                  return '<button type="button" class="or-tag" data-bet="' + v + '" aria-label="Bet ' + fmt(v) + ' tSats">' + (v === 1000 ? "MAX" : v) + '</button>';
                }).join("") + '</div>' +
              '</div>' +
            '</div>' +
            '<div class="or-spin-wrap spin-wrap b3-wrap" id="spin-wrap">' +
              '<button type="button" class="or-spin btn3d" id="spin-btn" aria-label="Spin the reels">' +
                '<span class="b3-base" aria-hidden="true"></span>' +
                '<span class="b3-cap"><span class="b3-shine" aria-hidden="true"></span><span class="or-leaf" aria-hidden="true"></span>' +
                  '<span class="spin-label">SPIN</span><span class="spin-sub" id="spin-sub"></span></span>' +
              '</button>' +
            '</div>' +
          '</div>' +
          hint("Press SPIN") + P.tail +
        '</div>' + P.stage + '</div>';
    }

    function machineDeepSea() {
      var ticks = LADDER.map(function (v, i) {
        var a = -135 + i * 30;
        return '<button type="button" class="ds-tick" data-bet="' + v + '" style="--a:' + a + 'deg" tabindex="-1" aria-hidden="true"><span>' + short(v) + '</span></button>';
      }).join("");
      return '<div class="machine m-deepsea" id="slot-machine">' +
        '<div class="ds-hull">' + P.sound +
          '<div class="ds-plate"><h1 class="m-title">' + titleHtml + '</h1></div>' +
          P.sign +
          '<div class="ds-porthole"><span class="ds-bolts" aria-hidden="true"></span>' + P.reels + '</div>' +
          P.lcd('<span class="ds-sonar" aria-hidden="true"></span>') +
          '<div class="ds-console">' +
            '<div class="ds-dialbox">' +
              '<div class="ds-dial" id="bet-dial" role="slider" tabindex="0" aria-label="Bet dial: turn to set your bet" aria-valuemin="' + MIN_BET + '" aria-valuemax="' + MAX_BET + '">' +
                ticks + '<span class="ds-knob" aria-hidden="true"></span>' +
                '<div class="ds-dial-center">' + P.input("ds-input") + '<span>tSATS</span></div>' +
              '</div>' +
              '<div class="ds-dial-btns"><button type="button" id="bet-down" aria-label="Lower bet">◀</button><span>BET DIAL</span><button type="button" id="bet-up" aria-label="Raise bet">▶</button></div>' +
            '</div>' +
            '<div class="ds-dive-wrap spin-wrap b3-wrap" id="spin-wrap">' +
              '<button type="button" class="ds-dive btn3d" id="spin-btn" aria-label="Dive: spin the reels">' +
                '<span class="b3-base" aria-hidden="true"></span>' +
                '<span class="b3-cap"><span class="b3-shine" aria-hidden="true"></span>' +
                  '<span class="spin-label">DIVE</span><span class="spin-sub" id="spin-sub"></span></span>' +
              '</button>' +
            '</div>' +
            '<div class="ds-gauges">' + P.readout("meter-win", "WIN", unitLabel()) + P.readout("meter-bal", "BALANCE", unitLabel()) + '</div>' +
          '</div>' +
          hint("Press DIVE") + P.tail +
        '</div>' + P.stage + '</div>';
    }

    function machineCosmic() {
      var scale = LADDER.slice().reverse().map(function (v) {
        return '<button type="button" class="thr-mark" data-bet="' + v + '" tabindex="-1" aria-hidden="true">' + short(v) + '</button>';
      }).join("");
      return '<div class="machine m-cosmic" id="slot-machine">' +
        '<div class="cx-hull">' + P.sound +
          '<div class="cx-head"><h1 class="m-title">' + titleHtml + '</h1></div>' +
          P.sign +
          '<div class="cx-hud"><span class="cx-corners" aria-hidden="true"></span>' + P.reels + '</div>' +
          P.lcd('<span class="cx-cursor" aria-hidden="true"></span>') +
          '<div class="cx-cockpit">' +
            '<div class="cx-readouts">' + P.readout("meter-win", "WIN", unitLabel()) + P.readout("meter-bal", "BALANCE", unitLabel()) + '</div>' +
            '<div class="cx-launch-wrap spin-wrap" id="spin-wrap">' +
              '<span class="cx-lights" aria-hidden="true"></span>' +
              '<button type="button" class="cx-launch btn3d" id="spin-btn" aria-label="Launch: spin the reels">' +
                '<span class="b3-base" aria-hidden="true"></span>' +
                '<span class="b3-cap"><span class="b3-shine" aria-hidden="true"></span>' +
                  '<span class="spin-label">LAUNCH</span><span class="spin-sub" id="spin-sub"></span></span>' +
              '</button>' +
            '</div>' +
            '<div class="cx-throttle">' +
              '<div class="thr-head">THRUST <small>· bet</small></div>' +
              '<div class="thr-body"><div class="thr-scale">' + scale + '</div>' +
                '<div class="thr-rail"><input type="range" id="bet-range" min="0" max="' + (LADDER.length - 1) + '" step="1" aria-label="Bet throttle"></div></div>' +
              '<div class="thr-input"><button type="button" id="bet-down" aria-label="Lower bet">▼</button>' + P.input("cx-input") +
                '<button type="button" id="bet-up" aria-label="Raise bet">▲</button></div>' +
            '</div>' +
          '</div>' +
          hint("Press LAUNCH") + P.tail +
        '</div>' + P.stage + '</div>';
    }

    var builders = { orchard: machineOrchard, deepsea: machineDeepSea, cosmic: machineCosmic };
    root.innerHTML =
      '<div class="machine-stage">' + (builders[game.theme] || machineOrchard)() + '</div>' +
      '<p class="sr-only" id="sr-live" role="status" aria-live="polite"></p>' +
      '<section class="panel" aria-labelledby="pt-title"><h2 class="panel-label" id="pt-title">PAYTABLE &amp; RULES</h2>' + buildPaytable() + '</section>' +
      '<section class="panel" aria-labelledby="hist-title">' +
        '<h2 class="panel-label" id="hist-title">RECENT SPINS</h2>' +
        '<ol class="history" id="history"><li class="history-empty">No spins yet. The reels are warm.</li></ol>' +
        '<p class="history-foot">Every spin is provably fair: <a href="../fairness.html">see your seeds and verify your spins</a>.</p>' +
      '</section>';

    var machine = $("#slot-machine"), reelsWin = $("#reels-window"), svg = $("#paylines");
    machine.parentNode.classList.add("ms-" + game.theme);   // per-theme 3D stage (perspective)
    var strips = Array.prototype.slice.call(reelsWin.querySelectorAll(".reel-strip"));
    var reelEls = strips.map(function (s) { return s.parentNode; });
    var betInput = $("#bet-input"), spinBtn = $("#spin-btn"), spinWrap = $("#spin-wrap");
    var quickBtns = Array.prototype.slice.call(machine.querySelectorAll("[data-bet]"));
    var betRange = $("#bet-range"), betDial = $("#bet-dial");
    var spinSub = $("#spin-sub"), lcd = $("#slot-lcd"), lcdMain = $("#lcd-main"), lcdSub = $("#lcd-sub");
    var meterWin = $("#meter-win"), meterBal = $("#meter-bal"), breakdown = $("#breakdown");
    var banner = $("#win-banner"), fsSign = $("#fs-sign"), historyEl = $("#history");
    var stickyLayer = $("#sticky-layer"), toastEl = $("#reel-toast"), stage = $("#bonus-stage");
    var down = $("#bet-down"), up = $("#bet-up"), soundBtn = $("#sound-toggle");
    var lockEl = $("#m-lock"), lockBtn = $("#m-lock-btn"), unitSw = $("#unit-switch");
    var marquee = document.getElementById("marquee");

    function buildPaytable() {
      function pays(p) { return '<b>3</b> × ' + fmtMult(p[0]) + ' · <b>4</b> × ' + fmtMult(p[1]) + ' · <b>5</b> × ' + fmtMult(p[2]); }
      var order = [WILD, SCAT, BONUS];
      for (var i = syms.length - 1; i >= 0; i--) if (!syms[i].kind) order.push(i);
      var items = order.map(function (i) {
        var s = syms[i], body;
        if (i === SCAT) body = pays(s.pays) + '<br>anywhere · <span class="jp">' + FS.awards.join(" / ") + ' free spins</span>';
        else if (i === BONUS) body = 'on reels 1, 3 &amp; 5 together<br><span class="jp">starts ' + esc(BON.name) + '</span>';
        else body = pays(s.pays) + (i === WILD || i === TOP ? '<br><span class="jp">5 on a line = JACKPOT</span>' : "");
        return '<div class="pt-item' + (s.kind ? " special" : "") + '"><div class="pt-sym">' + cellHtml(i) + '</div>' +
          '<div class="pt-pays"><span class="nm">' + esc(s.name) + (s.kind ? " · " + s.kind.toUpperCase() : "") + '</span>' + body + '</div></div>';
      }).join("");

      var lines = PAYLINES.map(function (pl, li) {
        var cells = "";
        for (var r = 0; r < ROWS; r++) for (var c = 0; c < REELS; c++) cells += '<i' + (pl[c] === r ? ' class="on"' : "") + '></i>';
        return '<li class="pl" style="--lc:' + LINE_COLORS[li] + '" aria-label="Line ' + (li + 1) + '"><span class="pl-num">' + (li + 1) +
          '</span><span class="pl-grid" aria-hidden="true">' + cells + '</span></li>';
      }).join("");

      var bonusDetail = BON.type === "pick" ? "Prizes: " + BON.prizes.map(function (x) { return x + "×"; }).join(", ") + " and " + BON.collect + " 🐛 worms."
        : BON.type === "wheel" ? "Wheel prizes: " + BON.segments.slice().sort(function (a, b) { return a - b; }).filter(function (x, i, a) { return a.indexOf(x) === i; }).map(function (x) { return x + "×"; }).join(", ") + "."
        : "Levels: " + BON.levels.map(function (x) { return fmt(x) + "×"; }).join(" → ") + ". Each boost succeeds " + Math.round(BON.advance * 100) + "% of the time.";

      return '<details class="paytable"><summary>Show paytable, features &amp; stats</summary>' +
        '<div class="pt-section"><div class="pt-h">Features</div><ul class="rules">' +
          '<li><b>' + syms[WILD].emoji + ' ' + esc(game.featureName) + ':</b> ' + esc(game.featureText) + '</li>' +
          '<li><b>' + syms[SCAT].emoji + ' ' + esc(FS.name) + ':</b> 3, 4 or 5 scatters anywhere award ' + FS.awards.join(" / ") + ' free spins. ' + esc(FS.text) + ' Free spins can retrigger (up to ' + MAX_FREE_SPINS + ').</li>' +
          '<li><b>' + syms[BONUS].emoji + ' ' + esc(BON.name) + ' Bonus:</b> land ' + syms[BONUS].emoji + ' on reels 1, 3 and 5 at once. ' + esc(BON.text) + ' ' + esc(bonusDetail) + '</li>' +
        '</ul></div>' +
        '<div class="pt-section"><div class="pt-h">Symbols · pays × total bet, plus the ' + BOOST + ' faucet boost</div><div class="pt-grid">' + items + '</div></div>' +
        '<div class="pt-section"><div class="pt-h">How to win</div><ul class="rules">' +
          '<li><b>Line wins:</b> 3, 4 or 5 matching symbols on a payline, starting from the leftmost reel. Every winning line pays and they add up.</li>' +
          '<li><b>' + syms[WILD].emoji + ' Wild:</b> stands in for every symbol except ' + syms[SCAT].emoji + ' and ' + syms[BONUS].emoji + '.</li>' +
          '<li><b>JACKPOT:</b> five ' + syms[WILD].emoji + ' or five ' + syms[TOP].emoji + ' on one line. MEGA WIN ≥ 50× bet, BIG WIN ≥ 10× bet.</li>' +
        '</ul></div>' +
        '<div class="pt-section"><div class="pt-h">10 paylines</div><ol class="lines-grid">' + lines + '</ol></div>' +
        '<div class="pt-section"><div class="pt-h">Machine stats</div><dl class="facts">' +
          '<div><dt>RTP</dt><dd>' + RTP + '</dd></div>' +
          '<div><dt>Faucet boost</dt><dd>' + BOOST + '</dd></div>' +
          '<div><dt>Hit rate</dt><dd>' + Math.round(game.stats.hit * 100) + '%</dd></div>' +
          '<div><dt>Free spins</dt><dd>1 in ' + game.stats.featureEvery + '</dd></div>' +
          '<div><dt>Bonus</dt><dd>1 in ' + game.stats.bonusEvery + '</dd></div>' +
          '<div><dt>Volatility</dt><dd>' + esc(game.volatility) + '</dd></div>' +
        '</dl><p class="pt-note">This is a faucet, so the machine pays back slightly more than it takes in: every win, including free spins and bonus prizes, gets a ' + BOOST +
          ' faucet boost on top of the paytable, for an RTP of ' + RTP + '. Wins are rounded to whole sats fairly (2.4 sats pays 3 sats 40% of the time), so the RTP holds at any bet. ' +
          'RTP and rates were measured over ' + game.stats.spins + ' simulated spins. ' +
          'Every spin is played on the server and is provably fair. Testnet coins have no monetary value.</p></div>' +
        '</details>';
    }

    function cellHtml(i) {
      var s = syms[i];
      return '<div class="symbol' + (s.kind ? " " + s.kind : "") + '"><span class="g">' + s.emoji + '</span></div>';
    }
    function picksFor(c, n) { var a = []; for (var i = 0; i < n; i++) a.push(pickers[c]()); return a; }

    /* --- Layout helpers --- */
    function placeChrome() {
      reelsWin.querySelectorAll(".chrome").forEach(function (e) { e.remove(); });
      for (var i = 1; i < REELS; i++) {
        var prev = reelEls[i - 1], cur = reelEls[i];
        var d = document.createElement("span");
        d.className = "chrome";
        d.setAttribute("aria-hidden", "true");
        d.style.left = ((prev.offsetLeft + prev.offsetWidth + cur.offsetLeft) / 2) + "px";
        reelsWin.appendChild(d);
      }
    }
    var stickyKeys = [];
    function renderSticky(keys) {
      stickyKeys = keys || [];
      stickyLayer.innerHTML = stickyKeys.map(function (k) {
        var p = k.split(","), c = +p[0], r = +p[1], el = reelEls[c], h = el.offsetHeight / ROWS;
        return '<div class="sticky-cell" style="left:' + el.offsetLeft + 'px;top:' + (el.offsetTop + r * h) + 'px;width:' + el.offsetWidth +
          'px;height:' + h + 'px">' + cellHtml(WILD) + '</div>';
      }).join("");
    }
    function toast(text, kind) {
      toastEl.textContent = text;
      toastEl.className = "reel-toast show" + (kind ? " " + kind : "");
      clearTimeout(toast.t);
      toast.t = setTimeout(function () { toastEl.className = "reel-toast"; }, 1500);
    }

    /* --- Reels --- */
    function setStatic(c, col) {
      var s = strips[c];
      s.classList.remove("spinning", "landing", "bounce");
      s.style.transition = "none";
      s.style.transform = "";
      s.style.animationDelay = "";
      s.innerHTML = [pickers[c]()].concat(col, [pickers[c]()]).map(cellHtml).join("");
    }
    function startReels() {
      strips.forEach(function (s, i) {
        var loop = picksFor(i, 12);
        s.classList.remove("landing", "bounce");
        reelEls[i].classList.remove("expanded");
        s.style.transition = "none";
        s.style.transform = "";
        s.innerHTML = loop.concat(loop).map(cellHtml).join("");
        s.style.animationDelay = (-i * 0.07) + "s";
        s.classList.add("spinning");
      });
      sfx.startSpinLoop();
    }
    function land(i, col, dur) {
      return new Promise(function (resolve) {
        var s = strips[i], F = 14;
        s.classList.remove("spinning");
        s.classList.add("landing");
        s.style.transition = "none";
        s.style.animationDelay = "";
        s.innerHTML = [pickers[i]()].concat(col, picksFor(i, F)).map(cellHtml).join("");
        s.style.transform = "translateY(calc(var(--sym) * -" + (F + 1) + "))";
        void s.offsetHeight;
        s.style.transition = "transform " + dur + "ms cubic-bezier(.15, .7, .3, 1)";
        s.style.transform = "translateY(calc(var(--sym) * -1))";
        setTimeout(function () {
          s.classList.remove("landing");
          s.style.transition = "none";
          s.classList.add("bounce");
          setTimeout(function () { s.classList.remove("bounce"); }, 300);
          resolve();
        }, dur);
      });
    }
    // Stop reels left to right; once 2 scatters show, the remaining reels build suspense.
    async function stopAll(target) {
      var seen = 0, landings = [];
      var gap = reduce ? 80 : 210, landMs = reduce ? 160 : 480, susMs = reduce ? 400 : 1100;
      for (var i = 0; i < REELS; i++) {
        if (seen >= 2 && i >= 2) {
          reelEls[i].classList.add("anticipate");
          sfx.anticipation(susMs / 1000);
          await sleep(susMs);
        } else if (i > 0) {
          await sleep(gap);
        }
        var n = target[i].filter(function (k) { return k === SCAT; }).length;
        landings.push(land(i, target[i], landMs).then((function (idx, countAfter, has) {
          return function () {
            reelEls[idx].classList.remove("anticipate");
            sfx.reelStop(idx);
            if (has) sfx.scatter(countAfter);
          };
        }(i, seen + n, n > 0))));
        seen += n;
      }
      await Promise.all(landings);
      sfx.stopSpinLoop();
      await sleep(reduce ? 60 : 220);
    }
    function cell(c, r) { return strips[c].children[r + 1]; }

    /* --- Unique features: post-landing transformations --- */
    async function expandReels(cols) {
      if (!cols.length) return;
      toast(syms[WILD].emoji + " EXPANDING " + syms[WILD].name.toUpperCase() + "!", "feat");
      sfx.feature();
      cols.forEach(function (c) {
        setStatic(c, [WILD, WILD, WILD]);
        reelEls[c].classList.add("expanded");
        for (var r = 0; r < ROWS; r++) cell(c, r).classList.add("grow");
      });
      await sleep(reduce ? 200 : 750);
    }
    async function showWildMults(wm) {
      var keys = Object.keys(wm);
      if (!keys.length) return;
      keys.forEach(function (k) {
        var p = k.split(","), el = cell(+p[0], +p[1]);
        el.classList.add("has-mult");
        var b = document.createElement("span");
        b.className = "wmult";
        b.textContent = "×" + wm[k];
        el.appendChild(b);
      });
      toast(syms[WILD].emoji + " MULTIPLIER WILD" + (keys.length > 1 ? "S" : "") + " " + keys.map(function (k) { return "×" + wm[k]; }).join(" "), "feat");
      sfx.feature();
      await sleep(reduce ? 200 : 650);
    }

    /* --- Win presentation --- */
    function clearWins() {
      reelsWin.classList.remove("has-win", "has-focus");
      reelsWin.querySelectorAll(".symbol.hit").forEach(function (el) {
        el.classList.remove("hit", "focus");
        el.removeAttribute("data-wins");
        var f = el.querySelector(".frame");
        if (f) f.remove();
      });
      svg.innerHTML = "";
      breakdown.innerHTML = "";
    }
    function hideBanner() {
      banner.className = "win-banner";
      machine.classList.remove("celebrate", "shake");
      if (marquee) marquee.classList.remove("jackpot");
    }
    function showBanner(kind, title, amount) {
      $("#wb-title").textContent = title;
      $("#wb-amount").textContent = amount;
      banner.className = "win-banner " + kind + " show";
    }

    // A phase's wins as display items, straight from the server (whole sats, already rounded).
    function phaseItems(ph) {
      var items = (ph.lines || []).map(function (w) { return { type: "line", w: w, sats: w.win }; });
      if (ph.scatter && ph.scatter.win > 0) items.push({ type: "scatter", w: ph.scatter, sats: ph.scatter.win });
      return { items: items, total: ph.win || 0 };
    }

    function tierOf(ph, total) {
      var jp = (ph.lines || []).filter(function (w) { return w.count === 5 && (w.symbol === WILD || w.symbol === TOP); })[0];
      if (jp) return { tier: "jackpot", jp: jp };
      if (total >= bet * 50) return { tier: "mega" };
      if (total >= bet * 10) return { tier: "big" };
      if (total > 0) return { tier: "win" };
      return { tier: "none" };
    }

    function markCells(cells, key) {
      cells.forEach(function (rc) {
        var el = cell(rc[0], rc[1]);
        if (!el.classList.contains("hit")) {
          el.classList.add("hit");
          var f = document.createElement("span");
          f.className = "frame";
          el.appendChild(f);
        }
        el.setAttribute("data-wins", (el.getAttribute("data-wins") || "") + " " + key);
      });
    }

    function highlight(p, token) {
      if (!p.items.length) return;
      reelsWin.classList.add("has-win");
      p.items.forEach(function (it) { markCells(it.w.cells, it.type === "line" ? "l" + it.w.line : "s"); });
      // Layout coordinates (offset*), not getBoundingClientRect: they stay correct when the
      // machine is tilted in 3D, because the SVG is drawn in the same untransformed space.
      var W = reelsWin.clientWidth, H = reelsWin.clientHeight;
      svg.setAttribute("viewBox", "0 0 " + W + " " + H);
      p.items.filter(function (it) { return it.type === "line"; }).forEach(function (it, k) {
        var li = it.w.line;
        var pts = PAYLINES[li].map(function (r, c) {
          var el = reelEls[c], h = el.offsetHeight / ROWS;
          return [el.offsetLeft + el.offsetWidth / 2, el.offsetTop + (r + 0.5) * h];
        });
        pts.unshift([6, pts[0][1]]);
        pts.push([W - 6, pts[pts.length - 1][1]]);
        var len = 0;
        for (var i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        var pl = document.createElementNS(NS, "polyline");
        pl.setAttribute("points", pts.map(function (q) { return q[0].toFixed(1) + "," + q[1].toFixed(1); }).join(" "));
        pl.setAttribute("data-line", li);
        pl.style.stroke = LINE_COLORS[li];
        pl.style.filter = "drop-shadow(0 0 4px " + LINE_COLORS[li] + ")";
        pl.style.strokeDasharray = len;
        pl.style.strokeDashoffset = reduce ? 0 : len;
        svg.appendChild(pl);
        void pl.getBoundingClientRect();
        setTimeout(function () {
          if (token !== presentToken) return;
          pl.style.transition = "stroke-dashoffset .45s ease-out";
          pl.style.strokeDashoffset = 0;
          sfx.lineBlip(k);
        }, k * 220);
      });
    }

    function renderBreakdown(p, mult) {
      breakdown.innerHTML = p.items.map(function (it) {
        var w = it.w, tag, combo, notes = [], key;
        if (it.type === "line") {
          key = "l" + w.line;
          tag = '<span class="bd-tag" style="--lc:' + LINE_COLORS[w.line] + '">LINE ' + (w.line + 1) + '</span>';
          combo = new Array(w.count + 1).join(syms[w.symbol].emoji);
          if (w.wildMult > 1) notes.push("wild ×" + w.wildMult);
        } else {
          key = "s";
          tag = '<span class="bd-tag">SCATTER</span>';
          combo = syms[SCAT].emoji + " × " + w.count;
          if (w.freeSpins) notes.push("+" + w.freeSpins + " free spins");
        }
        if (mult > 1) notes.push("wins ×" + mult);
        return '<li class="bd-item" tabindex="0" data-key="' + key + '">' + tag + '<span class="bd-combo">' + combo + '</span>' +
          (notes.length ? '<span class="bd-note">' + notes.join(" · ") + '</span>' : "") +
          '<span class="bd-amt" data-sats="' + it.sats + '">' + amt(it.sats) + '</span></li>';
      }).join("");
    }
    function focusWin(key) {
      reelsWin.classList.toggle("has-focus", !!key);
      reelsWin.querySelectorAll(".symbol.hit").forEach(function (el) {
        el.classList.toggle("focus", !!key && (el.getAttribute("data-wins") || "").split(" ").indexOf(key) !== -1);
      });
      svg.querySelectorAll("polyline").forEach(function (pl) {
        pl.classList.toggle("focus", key === "l" + pl.getAttribute("data-line"));
      });
    }
    breakdown.addEventListener("mouseover", function (e) { var li = e.target.closest(".bd-item"); focusWin(li && li.getAttribute("data-key")); });
    breakdown.addEventListener("mouseleave", function () { focusWin(null); });
    breakdown.addEventListener("focusin", function (e) { var li = e.target.closest(".bd-item"); focusWin(li && li.getAttribute("data-key")); });
    breakdown.addEventListener("focusout", function () { focusWin(null); });

    function describe(ph, p, t) {
      var res = { lines: ph.lines || [], scatter: ph.scatter && ph.scatter.win > 0 ? ph.scatter : null };
      if (t.tier === "jackpot") return "JACKPOT! 5× " + syms[t.jp.symbol].emoji + " on line " + (t.jp.line + 1) + " · " + amt(p.total);
      var parts = [];
      if (res.lines.length === 1) {
        var w = res.lines[0];
        parts.push("Line " + (w.line + 1) + ": " + w.count + "× " + syms[w.symbol].emoji + (w.wildMult > 1 ? " (wild ×" + w.wildMult + ")" : ""));
      } else if (res.lines.length > 1) parts.push(res.lines.length + " lines win");
      if (res.scatter) parts.push(res.scatter.count + "× " + syms[SCAT].emoji + " scatter");
      return parts.join(" + ") + " · " + amt(p.total);
    }
    function quip(g) {
      var sc = 0, bn = {};
      for (var c = 0; c < REELS; c++) for (var r = 0; r < ROWS; r++) {
        if (g[c][r] === SCAT) sc++;
        if (g[c][r] === BONUS) bn[c] = 1;
      }
      if (sc === 2) return "So close: two " + syms[SCAT].emoji + "!";
      if (Object.keys(bn).length === 2) return "Almost! Two " + syms[BONUS].emoji + " on the reels.";
      return flavor.quips[Math.floor(Math.random() * flavor.quips.length)];
    }

    /* --- Meters & LCD --- */
    function countUp(el, from, to, ms, token, tick) {
      return new Promise(function (resolve) {
        if (reduce || ms <= 0) { el.textContent = num(to); return resolve(); }
        var t0 = performance.now(), lastTick = 0;
        el.classList.add("counting");
        (function step() {
          if (token !== presentToken) {
            el.classList.remove("counting");
            // A cancelled balance count snaps to the real balance; the win meter is owned by the next step.
            if (el === meterBal) el.textContent = num(balShown);
            return resolve();
          }
          // One clock (performance.now) and a clamp: rAF timestamps can be earlier than t0.
          var now = performance.now();
          var p = Math.max(0, Math.min(1, (now - t0) / ms));
          el.textContent = num(Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3))));
          if (tick && now - lastTick > 55 && p < 1) { sfx.countTick(); lastTick = now; }
          if (p < 1) requestAnimationFrame(step);
          else { el.classList.remove("counting"); resolve(); }
        }());
      });
    }
    function setLcd(main, cls) {
      lcd.className = "slot-lcd" + (cls ? " " + cls : "");
      lcdMain.textContent = main;
      renderLcdSub();
      announce(main);
    }
    // Screen readers get the display text without emoji ("cherry cherry cherry..." is noise).
    var srLive = $("#sr-live"), srTimer = 0;
    function announce(text) {
      var plain = String(text).replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}]/gu, "")
        .replace(/(\d+)×/g, "$1 of a kind").replace(/×\s?(\d)/g, "times $1").replace(/ · /g, ", ").replace(/\s+/g, " ").replace(/\s([.,:!])/g, "$1").trim();
      clearTimeout(srTimer);
      srLive.textContent = "";
      srTimer = setTimeout(function () { srLive.textContent = plain; }, 60);
    }
    function renderLcdSub() {
      if (feature) {
        lcdSub.textContent = "Free spin " + feature.played + " / " + (feature.played + feature.left) +
          (feature.mult > 1 ? " · wins ×" + feature.mult : "") + " · feature won " + amt(feature.total);
      } else {
        lcdSub.textContent = "Bet " + fmt(bet) + " tSats · 10 lines";
      }
    }
    /* --- Credit unit: tSats (default) or tBCH, from the switch under the machine --- */
    var winShown = 0;
    function renderUnit() {
      var inBch = !!GU && GU.get() === "bch";
      unitSw.setAttribute("aria-checked", inBch ? "true" : "false");
      unitSw.title = inBch ? "Credit shown in tBCH. Switch to tSats." : "Credit shown in tSats. Switch to tBCH.";
      machine.classList.toggle("unit-bch", inBch);
      machine.querySelectorAll("[data-unit]").forEach(function (e) { e.textContent = unitLabel(); });
      meterBal.textContent = num(balShown);
      meterWin.textContent = num(winShown);
      // Amounts already on screen (win breakdown, recent spins) follow the switch too.
      root.querySelectorAll("[data-sats]").forEach(function (e) { e.textContent = (e.getAttribute("data-sign") || "") + amt(+e.getAttribute("data-sats")); });
      if (!busy) renderLcdSub();
      if (feature) renderFeature();
    }
    function syncBalance() {
      balShown = currentBalance();
      meterBal.textContent = num(balShown);
    }
    function credit(sats, token, ms) {
      if (sats <= 0) return;
      var from = balShown;
      balShown += sats;
      countUp(meterBal, from, balShown, ms, token, false);
    }
    function renderFeature() {
      if (!feature) { fsSign.hidden = true; return; }
      fsSign.hidden = false;
      var extra = "";
      if (FS.sticky) extra = '<span>' + syms[WILD].emoji + ' STICKY ' + feature.sticky + '</span>';
      fsSign.innerHTML = '<span><span class="e">' + syms[SCAT].emoji + '</span> FREE SPINS</span><span>' + feature.left + ' LEFT</span>' +
        (feature.mult > 1 || FS.progressive ? '<span class="mult">WINS ×' + feature.mult + '</span>' : '') + extra +
        '<span>WON ' + amt(feature.total) + '</span>';
    }

    /* --- Celebrate a win amount (shared by spins, bonus and feature totals) --- */
    function celebrate(total, tier, token, title) {
      var ms = { none: 0, win: 700, big: 1400, mega: 2200, jackpot: 3200 }[tier];
      winShown = total;
      countUp(meterWin, 0, total, ms, token, true);
      credit(total, token, ms);
      if (tier === "win" || tier === "none") { if (total > 0) sfx.win(); return; }
      showBanner(tier, title || { big: "BIG WIN!", mega: "MEGA WIN!", jackpot: "JACKPOT!!!" }[tier], amt(total));
      machine.classList.add("celebrate");
      if (tier !== "big" && !reduce) machine.classList.add("shake");
      if (tier === "jackpot" && marquee) marquee.classList.add("jackpot");
      ({ big: sfx.bigWin, mega: sfx.megaWin, jackpot: sfx.jackpot }[tier]).call(sfx);
      fx.coinShower({ big: 30, mega: 70, jackpot: 140 }[tier]);
      fx.burst(flavor.burst, { big: 20, mega: 40, jackpot: 70 }[tier]);
      setTimeout(function () { if (token === presentToken) hideBanner(); }, { big: 2200, mega: 2800, jackpot: 4200 }[tier]);
    }
    var WAIT = { none: 700, win: 1100, big: 2300, mega: 2900, jackpot: 4300 };

    /* --- Controls --- */
    function clampBet(v) {
      if (!isFinite(v)) v = MIN_BET;
      return Math.max(MIN_BET, Math.min(MAX_BET, Math.round(v)));
    }
    function ladderIndex(v) {
      var best = 0;
      for (var i = 1; i < LADDER.length; i++)
        if (Math.abs(Math.log(LADDER[i] / v)) < Math.abs(Math.log(LADDER[best] / v))) best = i;
      return best;
    }
    function setBet(v) {
      bet = clampBet(v);
      if (document.activeElement !== betInput || +betInput.value !== bet) betInput.value = bet;
      sessionSet("tnc.bet." + id, bet);
      quickBtns.forEach(function (b) { b.classList.toggle("is-active", +b.getAttribute("data-bet") === bet); });
      var idx = ladderIndex(bet);
      if (betRange) { betRange.value = idx; betRange.setAttribute("aria-valuetext", fmt(bet) + " tSats"); machine.style.setProperty("--thr", idx / (LADDER.length - 1)); }
      if (betDial) {
        betDial.setAttribute("aria-valuenow", bet);
        betDial.setAttribute("aria-valuetext", fmt(bet) + " tSats");
        machine.style.setProperty("--dial", (-135 + idx * 30) + "deg");
      }
      updateControls();
      if (!busy) renderLcdSub();
    }
    // − / + move along the bet ladder (1, 2, 5, 10 … 1,000) from wherever the bet is.
    function stepBet(dir) {
      var i, next = bet;
      if (dir > 0) { for (i = 0; i < LADDER.length; i++) if (LADDER[i] > bet) { next = LADDER[i]; break; } }
      else { for (i = LADDER.length - 1; i >= 0; i--) if (LADDER[i] < bet) { next = LADDER[i]; break; } }
      if (next !== bet) { sfx.chip(); setBet(next); betChanged(); }
    }
    function betChanged() {
      if (cantAfford()) showReady(); else setLcd("Bet " + fmt(bet) + " tSats. " + flavor.action, "");
    }
    function cantAfford() { return signedIn() && currentBalance() < bet; }
    function updateControls() {
      var out = authKnown && !signedIn();
      var off = !busy && (cantAfford() || out);
      spinBtn.disabled = busy || off;
      spinBtn.classList.toggle("busy", busy);
      spinBtn.setAttribute("aria-busy", busy ? "true" : "false");
      spinWrap.classList.toggle("busy", busy);
      spinWrap.classList.toggle("off", off);
      spinSub.textContent = busy ? (stage.hidden ? (feature ? "FREE SPINS" : "GOOD LUCK") : "BONUS") : out ? "SIGN IN" : "BET " + fmt(bet);
      [down, up, betInput].forEach(function (x) { x.disabled = busy; });
      quickBtns.forEach(function (b) { b.disabled = busy; });
      if (betRange) betRange.disabled = busy;
      if (betDial) { betDial.setAttribute("aria-disabled", busy ? "true" : "false"); betDial.tabIndex = busy ? -1 : 0; }
      lockEl.hidden = !out || busy;
      if (Auth) lockBtn.href = Auth.loginHref();
    }
    function tilt() {
      var b = currentBalance();
      setLcd(b < MIN_BET ? "TILT! Out of credit. Claim your daily bonus to play on." : "TILT! Bet " + fmt(bet) + " tSats is more than your " + amt(b) + ".", "tilt");
      sfx.tilt();
    }
    function showReady() {
      if (authKnown && !signedIn()) { setLcd("Sign in to play. New accounts get " + amt(10000) + ".", ""); return; }
      if (cantAfford()) {
        var b = currentBalance();
        setLcd(b < MIN_BET ? "Out of credit. Claim your daily bonus to play on." : "Lower your bet: balance is " + amt(b) + ".", "tilt");
      }
    }
    function askSignIn() {
      setLcd("Sign in to play. New accounts get " + amt(10000) + ".", "tilt");
      lockBtn.focus({ preventScroll: false });
    }

    /* --- One `spin` step: the paid spin or one free spin. Several phases = respins. --- */
    // prespun: the reels are already turning (the paid spin starts before the server answers).
    async function playSpinStep(st, prespun) {
      var free = !!st.free;
      var token = ++presentToken;
      if (!prespun) { hideBanner(); clearWins(); meterWin.textContent = "0"; winShown = 0; }
      if (free) {
        if (feature.played > 0 && st.multiplier > feature.mult) { toast("🌊 THE TIDE RISES: WINS ×" + st.multiplier + "!", "feat"); sfx.feature(); }
        feature.played = st.freeSpin;
        feature.left = st.spinsLeft;
        feature.mult = st.multiplier;
        renderFeature();
        setLcd("Free spin " + feature.played + "… good luck!", "");
      }
      var roundTotal = 0, lastTier = "none", phases = st.phases || [];

      for (var pi = 0; pi < phases.length; pi++) {
        var ph = phases[pi];
        var fixedKeys = (ph.fixed || []).map(function (rc) { return rc[0] + "," + rc[1]; });
        if (pi > 0) {
          token = ++presentToken;
          hideBanner();
          clearWins();
          toast(syms[WILD].emoji + " LUCKY RESPIN!", "feat");
          setLcd("Lucky respin " + pi + ": " + fixedKeys.length + " " + syms[WILD].emoji + " stay put…", "win");
          sfx.feature();
          await sleep(reduce ? 300 : 900);
        }
        if (feature && FS.sticky) { feature.sticky = fixedKeys.length; renderFeature(); }
        renderSticky(fixedKeys);
        if (!(prespun && pi === 0)) {
          sfx.spinStart();
          startReels();
          await sleep(reduce ? 200 : (pi ? 450 : 650));
        }
        await stopAll(ph.grid);
        renderSticky([]);
        grid = ph.display || ph.grid;

        if (ph.expanded && ph.expanded.length) await expandReels(ph.expanded);
        if (ph.wildMults) await showWildMults(ph.wildMults);
        reelsWin.setAttribute("aria-label", "Reels: " + [0, 1, 2].map(function (row) {
          return grid.map(function (col) { return syms[col[row]].name; }).join(", ");
        }).join("; "));

        var p = phaseItems(ph);
        var t = tierOf(ph, p.total);
        roundTotal += p.total;
        lastTier = t.tier;
        highlight(p, token);
        if (ph.bonusCells) markCells(ph.bonusCells, "b");
        renderBreakdown(p, st.multiplier);
        if (!p.items.length) {
          if (!ph.bonusCells) { setLcd(free ? "No win on this free spin." : quip(grid), ""); sfx.noWin(); }
        } else {
          setLcd(describe(ph, p, t), "win" + (t.tier === "jackpot" ? " blink" : ""));
          celebrate(p.total, t.tier, token);
        }
        if (pi < phases.length - 1) await sleep(Math.max(reduce ? 400 : 1100, WAIT[t.tier]));
      }

      if (free) {
        feature.total += roundTotal;
        renderFeature();
        renderLcdSub();
      }
      addHistory(free ? "free spin" : "bet " + fmt(bet) + " tSats", free ? roundTotal : roundTotal - bet, roundTotal, lastTier);
      return WAIT[lastTier];
    }

    /* --- Bonus games --- */
    async function runBonus(script) {
      var token = ++presentToken;
      await sleep(reduce ? 300 : 700);
      hideBanner();
      showBanner("free", BON.name.toUpperCase() + "!", "BONUS GAME");
      machine.classList.add("celebrate");
      setLcd(syms[BONUS].emoji + " " + syms[BONUS].emoji + " " + syms[BONUS].emoji + "  " + BON.name + " bonus!", "win blink");
      sfx.bonusStart();
      fx.burst(flavor.burst, 25);
      await sleep(reduce ? 700 : 2000);
      hideBanner();
      clearWins();

      stage.hidden = false;
      stage.className = "bonus-stage bonus-" + BON.type;
      updateControls();
      if (BON.type === "pick") await playPick(script);
      else if (BON.type === "wheel") await playWheel(script);
      else await playLadder(script);

      var won = script.win;
      await sleep(reduce ? 400 : 1300);
      stage.hidden = true;
      stage.innerHTML = "";
      token = ++presentToken;
      var tier = won >= bet * 50 ? "mega" : won >= bet * 10 ? "big" : won > 0 ? "win" : "none";
      if (won > 0) {
        setLcd(BON.name + " paid " + fmtMult(script.prize) + "× = " + amt(won), "win");
        celebrate(won, tier === "win" ? "big" : tier, token, "BONUS WIN!");
      } else {
        setLcd(BON.name + ": no prize this time.", "");
        meterWin.textContent = "0"; winShown = 0;
        sfx.noWin();
      }
      if (feature) { feature.total += won; renderFeature(); renderLcdSub(); }
      addHistory("bonus", won, won, tier);
      updateControls();
      await sleep(reduce ? 800 : 2400);
      if (token === presentToken) hideBanner();
    }

    function stageHead(title, sub) {
      return '<div class="bs-head"><div class="bs-title">' + esc(title) + '</div><div class="bs-sub" id="bs-sub">' + esc(sub) + '</div></div>';
    }

    function playPick(script) {
      return new Promise(function (resolve) {
        var n = script.order.length, revealed = 0, total = 0, done = false, autoTimer = null;
        stage.innerHTML = stageHead("🧺 HARVEST PICK", "Pick a basket! Find a 🐛 and the harvest ends.") +
          '<div class="pick-grid">' + new Array(n + 1).join('<button type="button" class="pick-tile"><span>🧺</span></button>') + '</div>' +
          '<div class="bs-foot"><span class="bs-total" id="bs-total">0×</span><button type="button" class="btn-ghost" id="bs-auto">Auto pick</button></div>';
        var tiles = Array.prototype.slice.call(stage.querySelectorAll(".pick-tile"));
        var sub = $("#bs-sub"), totalEl = $("#bs-total");
        tiles[0].focus({ preventScroll: true });
        function reveal(tile) {
          if (done || tile.disabled) return;
          var v = script.order[revealed++];
          tile.disabled = true;
          tile.classList.add("open");
          if (v === 0) {
            tile.classList.add("worm");
            tile.innerHTML = "<span>🐛</span><small>COLLECT</small>";
            sfx.collect();
          } else {
            total += v;
            tile.innerHTML = "<span>" + pickFruit(v) + "</span><small>+" + v + "×</small>";
            totalEl.textContent = fmtMult(total) + "× ≈ " + rawSats(total);
            sub.textContent = "+" + v + "× (≈" + rawSats(v) + "). Keep picking!";
            sfx.reveal(v);
          }
          if (v !== 0 && revealed < script.picks) return;
          // The server fixed how many baskets open; the harvest ends here.
          done = true;
          clearInterval(autoTimer);
          sub.textContent = (v === 0 ? "A worm! " : "") + "The harvest is in: " + fmtMult(total) + "× your bet.";
          // Show what the other baskets held.
          var rest = script.order.slice(revealed);
          tiles.filter(function (t) { return !t.disabled; }).forEach(function (t, i) {
            var x = rest[i];
            t.disabled = true;
            t.classList.add("open", "ghost");
            t.innerHTML = x === 0 ? "<span>🐛</span>" : "<span>" + pickFruit(x) + "</span><small>" + x + "×</small>";
          });
          setTimeout(resolve, 900);
        }
        function pickFruit(v) { return v >= 15 ? "🍉" : v >= 10 ? "🍇" : v >= 5 ? "🍊" : v >= 2 ? "🍋" : "🍒"; }
        tiles.forEach(function (t) { t.addEventListener("click", function () { reveal(t); }); });
        $("#bs-auto").addEventListener("click", function () {
          this.disabled = true;
          autoTimer = setInterval(function () {
            var left = tiles.filter(function (t) { return !t.disabled; });
            if (!left.length || done) return clearInterval(autoTimer);
            reveal(left[Math.floor(Math.random() * left.length)]);
          }, reduce ? 200 : 600);
        });
      });
    }

    function playWheel(script) {
      return new Promise(function (resolve) {
        var segs = BON.segments, n = segs.length, seg = 360 / n, R = 100;
        var colors = ["#0a3d62", "#1683c9", "#0b5d8c", "#2ec5ff"];
        var paths = segs.map(function (v, i) {
          var a0 = (i * seg - 90) * Math.PI / 180, a1 = ((i + 1) * seg - 90) * Math.PI / 180;
          var x0 = R * Math.cos(a0), y0 = R * Math.sin(a0), x1 = R * Math.cos(a1), y1 = R * Math.sin(a1);
          var am = ((i + 0.5) * seg - 90) * Math.PI / 180, tx = 70 * Math.cos(am), ty = 70 * Math.sin(am);
          var big = v >= 50;
          return '<path d="M0,0 L' + x0.toFixed(2) + ',' + y0.toFixed(2) + ' A' + R + ',' + R + ' 0 0 1 ' + x1.toFixed(2) + ',' + y1.toFixed(2) + ' Z" fill="' +
            (big ? "#f5c542" : colors[i % colors.length]) + '" stroke="#ffe79a" stroke-width="1" data-i="' + i + '"/>' +
            '<text x="' + tx.toFixed(1) + '" y="' + ty.toFixed(1) + '" transform="rotate(' + ((i + 0.5) * seg) + ' ' + tx.toFixed(1) + ' ' + ty.toFixed(1) + ')" ' +
            'class="wheel-txt' + (big ? " big" : "") + '">' + v + '×</text>';
        }).join("");
        stage.innerHTML = stageHead("🧭 SHIP'S WHEEL", "Spin the wheel for your prize!") +
          '<div class="wheel-wrap"><div class="wheel-pointer">▼</div>' +
          '<svg class="wheel" viewBox="-110 -110 220 220" aria-hidden="true"><g id="wheel-g">' + paths +
          '<circle r="16" fill="#5c4410" stroke="#ffe79a" stroke-width="3"/><text class="wheel-hub" y="5">⚓</text></g>' +
          '<circle r="104" fill="none" stroke="#a87a12" stroke-width="7"/></svg>' +
          '<button type="button" class="btn-red wheel-btn" id="wheel-btn">SPIN THE WHEEL</button></div>';
        var g = $("#wheel-g"), btn = $("#wheel-btn"), sub = $("#bs-sub");
        btn.focus({ preventScroll: true });
        var started = false;
        function go() {
          if (started) return;
          started = true;
          btn.disabled = true;
          sub.textContent = "The wheel is turning…";
          var jitter = (Math.random() - 0.5) * seg * 0.6;
          var target = 360 * 5 + (360 - (script.index + 0.5) * seg) + jitter;
          var dur = reduce ? 800 : 4600, t0 = performance.now(), lastSeg = -1;
          (function frame() {
            var p = Math.min(1, (performance.now() - t0) / dur);
            var a = target * (1 - Math.pow(1 - p, 4));
            g.setAttribute("transform", "rotate(" + a.toFixed(2) + ")");
            var s = Math.floor(a / seg);
            if (s !== lastSeg) { lastSeg = s; sfx.wheelTick(); }
            if (p < 1) requestAnimationFrame(frame);
            else {
              var win = g.querySelector('path[data-i="' + script.index + '"]');
              if (win) win.classList.add("win-seg");
              sub.textContent = "The wheel stops on " + BON.segments[script.index] + "×: ≈" + rawSats(BON.segments[script.index]) + "!";
              sfx.wheelStop();
              setTimeout(resolve, 900);
            }
          }());
        }
        btn.addEventListener("click", go);
        setTimeout(function () { if (!started && !stage.hidden) go(); }, 12000); // auto-spin if left idle
      });
    }

    function playLadder(script) {
      return new Promise(function (resolve) {
        var lv = BON.levels;
        stage.innerHTML = stageHead("🛰️ WARP LADDER", "Ignite the engines and climb!") +
          '<div class="ladder-wrap"><ol class="ladder" id="ladder">' + lv.map(function (v, i) {
            return '<li data-i="' + i + '"><span class="lv-n">' + (i + 1) + '</span><span class="lv-v">' + fmt(v) + '×</span><span class="lv-s">≈' + rawSats(v) + '</span></li>';
          }).reverse().join("") + '</ol>' +
          '<div class="ladder-side"><div class="rocket" id="rocket">🚀</div>' +
          '<button type="button" class="btn-red" id="ignite">IGNITE</button></div></div>';
        var ladder = $("#ladder"), btn = $("#ignite"), sub = $("#bs-sub"), rocket = $("#rocket");
        btn.focus({ preventScroll: true });
        var level = 0, started = false;
        function mark() {
          ladder.querySelectorAll("li").forEach(function (li) {
            var i = +li.getAttribute("data-i");
            li.classList.toggle("on", i === level);
            li.classList.toggle("past", i < level);
          });
        }
        mark();
        async function go() {
          if (started) return;
          started = true;
          btn.disabled = true;
          var boosts = script.boosts || [];
          for (var s = 0; s < boosts.length; s++) {
            sub.textContent = "Boosting to level " + (level + 2) + "…";
            rocket.className = "rocket boost";
            await sleep(reduce ? 250 : 850);
            if (boosts[s]) {
              level++;
              mark();
              sfx.ladderUp(level);
              rocket.className = "rocket";
              sub.textContent = "Level " + (level + 1) + ": " + fmt(lv[level]) + "×!";
              await sleep(reduce ? 150 : 400);
            } else {
              rocket.className = "rocket fail";
              ladder.classList.add("fail");
              sfx.ladderFail();
              sub.textContent = "Engines cut out at level " + (level + 1) + ": " + fmt(lv[level]) + "× ≈ " + rawSats(lv[level]);
              await sleep(reduce ? 300 : 900);
              return resolve();
            }
          }
          sub.textContent = "TOP OF THE LADDER! " + fmt(lv[level]) + "× ≈ " + rawSats(lv[level]);
          await sleep(reduce ? 300 : 900);
          resolve();
        }
        btn.addEventListener("click", go);
        setTimeout(function () { if (!started && !stage.hidden) go(); }, 12000);
      });
    }

    /* --- A paid spin: ask the server, then play its steps in order --- */
    async function spin() {
      if (busy) return;
      if (!signedIn()) { askSignIn(); return; }
      setBet(parseInt(betInput.value, 10));
      if (cantAfford()) { tilt(); updateControls(); return; }
      spinBtn.classList.add("pressed");
      setTimeout(function () { spinBtn.classList.remove("pressed"); }, 160);
      sfx.press();
      busy = true;
      updateControls();

      // The reels start at once and keep turning while the server answers.
      ++presentToken;
      hideBanner();
      clearWins();
      meterWin.textContent = "0"; winShown = 0;
      balShown = currentBalance() - bet;
      meterBal.textContent = num(balShown);
      setLcd("Reels spinning… good luck!", "");
      sfx.spinStart();
      startReels();
      var t0 = Date.now();

      var r = await requestSpin(bet);
      if (r.status !== 200 || !r.data || !r.data.steps) { await spinFailed(r); return; }
      await sleep(Math.max(0, (reduce ? 200 : 650) - (Date.now() - t0)));

      try { await playSteps(r.data.steps); }
      finally {
        busy = false;
        feature = null;
        renderFeature();
        if (Auth) Auth.setBalance(r.data.balance);
        syncBalance();
        updateControls();
        showReady();
      }
    }

    // One spin = one requestId. A network error, timeout or 5xx retries with the
    // SAME id: the server then returns the original result and charges nothing extra.
    function requestSpin(amount) {
      var rid = newRequestId();
      return (function attempt(n) {
        return api.spin(id, amount, rid).then(function (r) {
          var retry = r.status === 0 || r.status === 502 || r.status === 503 || r.status === 504;
          if (retry && n < SPIN_RETRIES) {
            if (n === 0) setLcd("Connection hiccup. Retrying your spin…", "");
            return sleep(800 * Math.pow(2, n)).then(function () { return attempt(n + 1); });
          }
          return r;
        });
      }(0));
    }

    async function spinFailed(r) {
      sfx.stopSpinLoop();
      for (var c = 0; c < REELS; c++) setStatic(c, grid[c]);   // back to the last result
      busy = false;
      var code = api.errorCode(r);
      if (r.status === 401) {
        if (Auth) Auth.set(null);
        setLcd("Your session ended. Sign in to keep playing.", "tilt");
      } else if (code === "insufficient_funds") {
        if (Auth) await Auth.refresh();
        syncBalance();
        if (cantAfford()) tilt(); else { setLcd(api.errorText(r), "tilt"); sfx.tilt(); }
      } else {
        setLcd(api.errorText(r), "tilt");
        sfx.tilt();
        // The spin may have been played before the connection dropped: re-read the balance.
        if ((r.status === 0 || r.status >= 500) && Auth) await Auth.refresh();
      }
      syncBalance();
      updateControls();
    }

    async function playSteps(steps) {
      var wait = 0, first = true;
      for (var i = 0; i < steps.length; i++) {
        var st = steps[i];
        if (st.type === "spin") {
          if (st.free && i > 0 && steps[i - 1].type !== "freeSpinsStart") await sleep(Math.max(reduce ? 400 : 900, wait));
          wait = await playSpinStep(st, first);
          first = false;
        } else if (st.type === "bonus") {
          await sleep(Math.max(600, wait));
          await runBonus(st);
          wait = 0;
        } else if (st.type === "freeSpinsStart") {
          await sleep(Math.max(900, wait));
          await startFeature(st.spins);
          wait = 0;
        } else if (st.type === "retrigger") {
          if (feature) { feature.left = st.spinsLeft; renderFeature(); renderLcdSub(); }
          toast(syms[SCAT].emoji + " RETRIGGER +" + st.added + "!", "feat");
          sfx.scatter(5);
        } else if (st.type === "freeSpinsEnd") {
          await sleep(Math.max(reduce ? 400 : 900, wait));
          endFeature(st);
          wait = 0;
        }
      }
    }

    async function startFeature(spins) {
      feature = { left: spins, played: 0, total: 0, sticky: 0,
                  mult: FS.progressive ? FS.progressive.start : (FS.multiplier || 1) };
      updateControls();
      renderFeature();
      var token = ++presentToken;
      hideBanner();
      clearWins();
      showBanner("free", "FREE SPINS!", spins + " SPINS · " + flavor.twist);
      machine.classList.add("celebrate", "in-feature");
      setLcd(spins + " " + FS.name.toLowerCase() + "!", "win blink");
      sfx.freeSpins();
      fx.burst(flavor.burst, 30);
      await sleep(reduce ? 900 : 2400);
      if (token === presentToken) hideBanner();
    }

    function endFeature(st) {
      var total = st.win, played = st.played;
      feature = null;
      renderFeature();
      renderSticky([]);
      machine.classList.remove("in-feature");
      var t2 = ++presentToken;
      hideBanner();
      clearWins();
      showBanner(total >= bet * 10 ? "big" : "free", "FEATURE OVER", played + " SPINS WON " + amt(total));
      setLcd("Free spins over: " + played + " spins won " + amt(total), total ? "win" : "");
      winShown = total;
      meterWin.textContent = num(total);
      if (total >= bet * 10) { sfx.bigWin(); fx.coinShower(50); fx.burst(flavor.burst, 30); machine.classList.add("celebrate"); }
      else if (total > 0) sfx.win(); else sfx.noWin();
      setTimeout(function () { if (t2 === presentToken) hideBanner(); }, 2600);
    }

    function addHistory(kind, net, win, tier) {
      var empty = historyEl.querySelector(".history-empty");
      if (empty) empty.remove();
      var li = document.createElement("li");
      li.className = (win > 0 ? "is-win" : "") + (tier === "big" || tier === "mega" || tier === "jackpot" ? " is-big" : "");
      var line = kind === "bonus" ? syms[BONUS].emoji + " " + esc(BON.name)
        : grid.map(function (col) { return syms[col[1]].emoji; }).join("");
      li.innerHTML = '<span class="h-line">' + line + '</span><span class="h-kind">' + kind +
        '</span><span class="h-amt" data-sats="' + Math.abs(net) + '" data-sign="' + (net >= 0 ? "+" : "−") + '">' + (net >= 0 ? "+" : "−") + amt(Math.abs(net)) + '</span>';
      historyEl.insertBefore(li, historyEl.firstChild);
      while (historyEl.children.length > 12) historyEl.removeChild(historyEl.lastChild);
    }

    /* --- Sound toggle --- */
    function renderSound() {
      var m = sfx.isMuted();
      soundBtn.textContent = m ? "🔇" : "🔊";
      soundBtn.setAttribute("aria-pressed", m ? "true" : "false");
      soundBtn.setAttribute("aria-label", m ? "Unmute sound effects" : "Mute sound effects");
      soundBtn.title = m ? "Unmute sound effects" : "Mute sound effects";
    }
    /* --- Full screen --- */
    // The whole page goes full screen; CSS hides the site chrome and fitMachine()
    // scales the machine (with the `scale` property, so the shake animation's
    // transform still works) to fill the screen.
    var fsBtn = $("#fs-toggle"), docEl = document.documentElement, machineStage = machine.parentNode;
    var FS_ICON = {
      enter: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
      exit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>'
    };
    function fsElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
    function renderFs() {
      var on = !!fsElement();
      fsBtn.innerHTML = on ? FS_ICON.exit : FS_ICON.enter;
      fsBtn.setAttribute("aria-pressed", on ? "true" : "false");
      fsBtn.setAttribute("aria-label", on ? "Exit full screen" : "Full screen");
      fsBtn.title = on ? "Exit full screen (Esc)" : "Full screen";
    }
    function fitMachine() {
      machine.style.scale = ""; machineStage.style.height = "";
      if (!document.body.classList.contains("is-fullscreen")) return;
      var cs = getComputedStyle(document.querySelector(".page"));
      var availH = window.innerHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      var availW = window.innerWidth - 24;
      var h = machine.offsetHeight, w = machine.offsetWidth;
      if (!h || !w) return;
      var k = Math.max(0.4, Math.min(availH / h, availW / w, 1.4));
      machine.style.scale = String(k);
      machineStage.style.height = Math.ceil(h * k) + "px";
    }
    function onFsChange() {
      document.body.classList.toggle("is-fullscreen", !!fsElement());
      renderFs();
      fitMachine();
      if (!fsElement()) machine.scrollIntoView({ block: "nearest" });
    }
    if (!(docEl.requestFullscreen || docEl.webkitRequestFullscreen)) fsBtn.hidden = true;   // e.g. iPhone Safari
    fsBtn.addEventListener("click", function () {
      var p;
      if (fsElement()) p = (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else p = (docEl.requestFullscreen || docEl.webkitRequestFullscreen).call(docEl, { navigationUI: "hide" });
      if (p && p.catch) p.catch(function () {});
    });
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    window.addEventListener("resize", fitMachine);
    if (window.ResizeObserver) new ResizeObserver(function () { fitMachine(); }).observe(machine);
    renderFs();

    if (GU) { unitSw.addEventListener("click", function () { sfx.chip(); GU.toggle(); }); GU.onChange(renderUnit); }
    else unitSw.hidden = true;
    soundBtn.addEventListener("click", function () {
      sfx.setMuted(!sfx.isMuted());
      renderSound();
      if (!sfx.isMuted()) sfx.win();
    });

    /* --- Wiring --- */
    betInput.addEventListener("change", function () { setBet(parseInt(betInput.value, 10)); betChanged(); });
    betInput.addEventListener("focus", function () { betInput.select(); });
    betInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); setBet(parseInt(betInput.value, 10)); spin(); }
    });
    down.addEventListener("click", function () { stepBet(-1); });
    up.addEventListener("click", function () { stepBet(1); });
    quickBtns.forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        if (busy) return;
        sfx.chip();
        setBet(+b.getAttribute("data-bet"));
        betChanged();
      });
    });
    // Cosmic: throttle slider over the bet ladder.
    if (betRange) betRange.addEventListener("input", function () {
      var v = LADDER[+betRange.value];
      if (v !== bet) { sfx.chip(); setBet(v); betChanged(); }
    });
    // Deep Sea: rotary dial: drag, scroll or use the arrow keys.
    if (betDial) {
      betDial.addEventListener("keydown", function (e) {
        if (busy) return;
        var k = e.key;
        if (k === "ArrowRight" || k === "ArrowUp") { e.preventDefault(); stepBet(1); }
        else if (k === "ArrowLeft" || k === "ArrowDown") { e.preventDefault(); stepBet(-1); }
        else if (k === "Home") { e.preventDefault(); sfx.chip(); setBet(LADDER[0]); betChanged(); }
        else if (k === "End") { e.preventDefault(); sfx.chip(); setBet(LADDER[LADDER.length - 1]); betChanged(); }
      });
      var wheelAt = 0;
      betDial.addEventListener("wheel", function (e) {
        if (busy) return;
        e.preventDefault();
        var now = Date.now();
        if (now - wheelAt < 110) return;
        wheelAt = now;
        stepBet(e.deltaY < 0 ? 1 : -1);
      }, { passive: false });
      var dragging = false;
      function dialAt(e) {
        var r = betDial.getBoundingClientRect();
        var dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        var a = Math.atan2(dx, -dy) * 180 / Math.PI;               // 0° at the top, clockwise
        a = Math.max(-135, Math.min(135, a));
        var v = LADDER[Math.round((a + 135) / 30)];
        if (v !== bet) { sfx.chip(); setBet(v); }
      }
      betDial.addEventListener("pointerdown", function (e) {
        if (busy || e.target.closest("input, .ds-tick")) return;
        dragging = true;
        betDial.setPointerCapture(e.pointerId);
        betDial.classList.add("turning");
        dialAt(e);
      });
      betDial.addEventListener("pointermove", function (e) { if (dragging) dialAt(e); });
      ["pointerup", "pointercancel"].forEach(function (t) {
        betDial.addEventListener(t, function () { if (dragging) { dragging = false; betDial.classList.remove("turning"); betChanged(); } });
      });
    }
    spinBtn.addEventListener("click", spin);
    lockBtn.addEventListener("click", function (e) {
      if (Auth) { e.preventDefault(); location.assign(Auth.loginHref()); }
    });
    document.addEventListener("keydown", function (e) {
      var t = e.target, tag = t && t.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || (t && t.isContentEditable)) return;
      var space = e.code === "Space" || e.key === " ";
      if (!space && e.key !== "Enter") return;
      // Let focused buttons, links and summaries handle their own activation.
      if (tag === "BUTTON" || tag === "A" || tag === "SUMMARY" || (t && t.closest && t.closest(".bd-item"))) return;
      e.preventDefault();
      if (busy) return;
      spin();
    });
    // Balance or session changed (sign-out, daily bonus, another tab): follow it between spins.
    if (Auth) {
      Auth.onChange(function () { authKnown = true; if (!busy) { syncBalance(); updateControls(); showReady(); } });
      (Auth.ready || Promise.resolve()).then(function () { authKnown = true; if (!busy) { syncBalance(); updateControls(); showReady(); } });
    }
    window.addEventListener("resize", function () { placeChrome(); if (stickyKeys.length) renderSticky(stickyKeys); });

    /* --- Initial state --- */
    for (var c = 0; c < REELS; c++) setStatic(c, grid[c]);
    placeChrome();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(placeChrome);
    renderSound();
    renderUnit();
    setBet(bet);
    syncBalance();
    setLcd(flavor.welcome, "");
    showReady();
    frameMachine();
  }

  /*
   * On load, show the reels and the spin control together. The site header sits
   * above the machine, so without this the spin button starts below the fold.
   * Skipped when the page was opened at an anchor, restored to a scroll position,
   * or the player already scrolled, clicked or pressed a key.
   */
  function frameMachine() {
    var nav = document.querySelector(".nav-bar"), cur = nav && nav.querySelector('[aria-current="page"]');
    if (nav && cur && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = cur.offsetLeft - (nav.clientWidth - cur.offsetWidth) / 2;

    if (location.hash) return;
    var touched = false;
    function mark() { touched = true; }
    ["wheel", "touchstart", "pointerdown", "keydown"].forEach(function (t) { window.addEventListener(t, mark, { once: true, passive: true }); });
    function go() {
      if (touched || window.scrollY > 0) return;
      var m = document.getElementById("slot-machine"), r = document.getElementById("reels-window"), s = document.getElementById("spin-wrap");
      if (!m || !r || !s) return;
      var H = window.innerHeight, y = window.scrollY;
      var mTop = m.getBoundingClientRect().top + y, rTop = r.getBoundingClientRect().top + y, sBot = s.getBoundingClientRect().bottom + y;
      if (sBot <= H - 8) return;                       // already fits
      var top = sBot - mTop + 16 <= H ? mTop - 8       // whole machine top to spin control fits
              : Math.min(rTop - 8, sBot - H + 16);     // otherwise reels first, spin control in view
      window.scrollTo({ top: Math.max(0, top), behavior: "instant" });
    }
    requestAnimationFrame(go);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { requestAnimationFrame(go); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
