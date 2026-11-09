/*
 * TestnetCasino.com: slot machine UI (5 reels × 3 rows, 10 paylines).
 *
 * A thin client of testnetcasino-service. Every outcome comes from
 * POST /spins: the server returns the whole spin as `steps[]` (reel stops,
 * respins, free spins, bonus games; from game config version 4 also a jackpot
 * won in the game, the collect symbols and the collector's reward) and this
 * file only animates them. Win
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

  /* ---------- PixiJS machine (preview: ?pixi=1) ---------- */
  // The whole machine drawn in a canvas (pixi-machine.js). Loaded only when asked for, and only for
  // the themes it supports; anything that fails falls back to the HTML machine below.
  var HERE = (document.currentScript && document.currentScript.src) || "";
  var WANT_PIXI = /[?&]pixi=1(&|$)/.test(location.search);
  function loadScript(src) {
    return new Promise(function (ok, fail) {
      var s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = function () { fail(new Error("Could not load " + src)); };
      document.head.appendChild(s);
    });
  }
  function loadPixi() {
    var base = HERE.replace(/slot\.js(\?.*)?$/, ""), v = (HERE.match(/\?v=[^&]+/) || [""])[0];
    return (window.PIXI ? Promise.resolve() : loadScript(base + "../vendor/pixi-8.22.0.min.js"))
      .then(function () { return window.TNC_PixiMachine ? null : loadScript(base + "pixi-machine.js" + v); });
  }

  /* ---------- UI ---------- */

  function init() {
    var root = document.getElementById("app");
    var id = document.body.getAttribute("data-game");
    if (!root || !id || !api) return;
    root.insertAdjacentHTML("afterbegin", '<p class="panel m-loading" id="m-loading" role="status">Loading the machine…</p>');
    var msg = document.getElementById("m-loading");
    (function load(attempt) {
      api.gameConfig(id).then(function (r) {
        if (r.status === 200 && r.data && r.data.symbols && r.data.engine) {
          if (!WANT_PIXI) { build(root, id, r.data); return; }
          loadPixi().then(function () {
            if (!window.TNC_PixiMachine || !TNC_PixiMachine.supports(r.data)) throw new Error("not supported");
            return TNC_PixiMachine.build(root, id, r.data);
          }).catch(function (e) {
            if (window.console) console.warn("PixiJS machine unavailable, using the classic one:", e && e.message);
            root.innerHTML = ""; build(root, id, r.data);
          });
          return;
        }
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
    var JPC = game.jackpot || null, COL = game.collector || null;   // version 4: jackpots in the game, the collector
    var S = game.payScale || 1;                         // the server's scale on every paytable value
    function pct(x) { return String(+(x * 100).toFixed(2)) + "%"; }
    var RTP = pct(game.rtp || game.stats.rtp);
    var PARTS = game.rtpParts || null;                   // { game, collector, jackpots }
    function rawSats(x) { return amt(Math.floor(playBet * x * S)); }   // preview of a paytable value (display only)
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
    // Stop: while the reels turn, the spin button or Space lands them at once. Display only:
    // the result is the server's either way, this just skips the wait.
    var reelsTurning = false, stopReq = false, stopWake = null;
    var settle = 0;            // ms the last win's animations still need before the next spin
    var bet = clampBet(parseInt(sessionGet("tnc.bet." + id), 10) || 10);
    var playBet = bet;         // the bet the current step is played at: the spin's, or a collector reward's
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
      // The reels and, beside them (under them on phones), the collector's own screen: the game's
      // shared fill meter (filled by jackpots.js). cell-fx: jackpot and collect symbols drawn over
      // the reels, and the collect symbols flying into the meter.
      reels: '<div class="reel-bay' + (COL ? '' : ' no-collector') + '"><div class="reels-window" id="reels-window" role="img" aria-label="Slot reels">' +
          new Array(REELS + 1).join('<div class="reel"><div class="reel-strip"></div></div>') +
          '<div class="sticky-layer" id="sticky-layer" aria-hidden="true"></div>' +
          '<svg class="paylines-svg" id="paylines" aria-hidden="true"></svg>' +
          '<div class="reel-toast" id="reel-toast" aria-hidden="true"></div>' +
          '<div class="win-banner" id="win-banner" aria-hidden="true"><div class="rays"></div>' +
            '<div class="wb-title" id="wb-title"></div><div class="wb-amount" id="wb-amount"></div></div>' +
        '</div>' +
        (COL ? '<div class="collector-screen cl-' + esc(game.theme) + '" data-collector="' + esc(id) + '" data-collector-name="' + esc(COL.name) + '">' +
          '<span class="cl-sign" aria-hidden="true">' + esc(COL.name.toUpperCase()) + '</span><span class="cl-scene" aria-hidden="true"></span>' +
          (game.theme === "cosmic" ? '<span class="cl-tank" aria-hidden="true"><span class="cl-level"></span></span>' : '<span class="cl-pile" aria-hidden="true"></span>') +
          '<span class="cl-count" aria-hidden="true"></span><span class="cl-full" aria-hidden="true">FULL!</span>' +
        '</div>' : '') +
        '<div class="cell-fx" id="cell-fx" aria-hidden="true"></div></div>' +
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
      // Wins on the last spin: right under the reels, above the info screen.
      wins: '<ul class="breakdown" id="breakdown" aria-label="Wins on the last spin"></ul>',
      // Credit unit and account links: a section of its own under the machine (not in full screen).
      extras: '<section class="panel m-extras" aria-label="Credit unit and account">' +
          '<div class="m-util">' +
            '<button type="button" class="unit-switch" id="unit-switch" role="switch" aria-label="Show credit in tBCH">' +
              '<span class="us-opt" data-u="sat">tSats</span><span class="us-opt" data-u="bch">tBCH</span></button>' +
            '<a class="btn-ghost" href="../account.html#withdraw">📤 Withdraw tBCH</a>' +
            '<a class="btn-ghost" href="../fairness.html">⚖️ Verify spins</a>' +
          '</div>' +
        '</section>',
      stage: '<div class="bonus-stage" id="bonus-stage" role="dialog" aria-label="Bonus game" hidden></div>',
      // Jackpots at the top of the machine (filled by jackpots.js), like real progressive displays:
      // the shared GRAND (one style on every machine, the most prominent), then this game's MAJOR
      // and MINOR side by side, as live prize amounts in the machine's unit.
      jackpots: '<div class="jp-rows" role="group" aria-label="Jackpots">' +
          '<div class="jp-row jp-row-grand"><span class="jp-row-name">GRAND</span>' +
            '<span class="jp-row-val" data-jackpot-units="game" data-jackpot="grand">…</span></div>' +
          '<div class="jp-pair">' +
            '<div class="jp-row jp-row-major"><span class="jp-row-name">MAJOR</span>' +
              '<span class="jp-row-val" data-jackpot-units="game" data-jackpot="major:' + esc(id) + '">…</span></div>' +
            '<div class="jp-row jp-row-minor"><span class="jp-row-name">MINOR</span>' +
              '<span class="jp-row-val" data-jackpot-units="game" data-jackpot="minor:' + esc(id) + '">…</span></div>' +
          '</div>' +
        '</div>'
    };
    function hint(verb) { return '<p class="m-hint">' + verb + ' · or press <b>Space</b> key</p>'; }
    function short(v) { return v >= 1000 ? (v / 1000) + "K" : String(v); }

    function machineOrchard() {
      return '<div class="machine m-orchard" id="slot-machine">' + P.jackpots +
        '<div class="or-stand">' +   // the sound and full-screen buttons are placed from its top
        '<div class="or-awning" aria-hidden="true"><span class="or-bulbs"></span></div>' + P.sound +
        '<div class="or-sign"><h1 class="m-title">' + titleHtml + '</h1></div>' +
        '<div class="or-crate">' + P.sign +
          '<div class="or-window">' + P.reels + '</div>' + P.wins +
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
          hint("Press SPIN") +
        '</div></div>' + P.stage + '</div>';
    }

    function machineDeepSea() {
      var ticks = LADDER.map(function (v, i) {
        var a = -135 + i * 30;
        return '<button type="button" class="ds-tick" data-bet="' + v + '" style="--a:' + a + 'deg" tabindex="-1" aria-hidden="true"><span>' + short(v) + '</span></button>';
      }).join("");
      return '<div class="machine m-deepsea" id="slot-machine">' + P.jackpots +
        '<div class="ds-hull">' + P.sound +
          '<div class="ds-plate"><h1 class="m-title">' + titleHtml + '</h1></div>' +
          P.sign +
          '<div class="ds-porthole"><span class="ds-bolts" aria-hidden="true"></span>' + P.reels + '</div>' + P.wins +
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
          hint("Press DIVE") +
        '</div>' + P.stage + '</div>';
    }

    function machineCosmic() {
      var scale = LADDER.slice().reverse().map(function (v) {
        return '<button type="button" class="thr-mark" data-bet="' + v + '" tabindex="-1" aria-hidden="true">' + short(v) + '</button>';
      }).join("");
      return '<div class="machine m-cosmic" id="slot-machine">' + P.jackpots +
        '<div class="cx-hull">' + P.sound +
          '<div class="cx-head"><h1 class="m-title">' + titleHtml + '</h1></div>' +
          P.sign +
          '<div class="cx-hud"><span class="cx-corners" aria-hidden="true"></span>' + P.reels + '</div>' + P.wins +
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
          hint("Press LAUNCH") +
        '</div>' + P.stage + '</div>';
    }

    var builders = { orchard: machineOrchard, deepsea: machineDeepSea, cosmic: machineCosmic };
    root.innerHTML =
      '<div class="machine-stage">' + (builders[game.theme] || machineOrchard)() + '</div>' +
      '<p class="sr-only" id="sr-live" role="status" aria-live="polite"></p>' +
      P.extras +
      '<section class="panel" aria-labelledby="pt-title"><h2 class="panel-label" id="pt-title">PAYTABLE &amp; RULES</h2>' + buildPaytable() + '</section>' +
      '<section class="panel" aria-labelledby="hist-title">' +
        '<h2 class="panel-label" id="hist-title">RECENT SPINS</h2>' +
        '<ol class="history" id="history"><li class="history-empty">No spins yet. The reels are warm.</li></ol>' +
        '<p class="history-foot">Every spin is provably fair: <a href="../fairness.html">see your seeds and verify your spins</a>.</p>' +
      '</section>';

    var machine = $("#slot-machine"), reelsWin = $("#reels-window"), svg = $("#paylines");
    machine.parentNode.classList.add("ms-" + game.theme);   // per-theme 3D stage (perspective)
    if (window.TNC_Jackpots) window.TNC_Jackpots.render();   // the jackpot displays were just built
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
        else body = pays(s.pays) + (i === WILD || i === TOP ? '<br><span class="jp">5 on a line = TOP PRIZE</span>' : "");
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
        '</ul></div>' + jackpotRules() +
        '<div class="pt-section"><div class="pt-h">Symbols · pays × total bet</div><div class="pt-grid">' + items + '</div></div>' +
        '<div class="pt-section"><div class="pt-h">How to win</div><ul class="rules">' +
          '<li><b>Line wins:</b> 3, 4 or 5 matching symbols on a payline, starting from the leftmost reel. Every winning line pays and they add up.</li>' +
          '<li><b>' + syms[WILD].emoji + ' Wild:</b> stands in for every symbol except ' + syms[SCAT].emoji + ' and ' + syms[BONUS].emoji + '.</li>' +
          '<li><b>TOP PRIZE:</b> five ' + syms[WILD].emoji + ' or five ' + syms[TOP].emoji + ' on one line. MEGA WIN ≥ 50× bet, BIG WIN ≥ 10× bet.</li>' +
        '</ul></div>' +
        '<div class="pt-section"><div class="pt-h">10 paylines</div><ol class="lines-grid">' + lines + '</ol></div>' +
        '<div class="pt-section"><div class="pt-h">Machine stats</div><dl class="facts">' +
          '<div><dt>RTP</dt><dd>' + RTP + (PARTS ? ' in all' : '') + '</dd></div>' +
          (PARTS ? '<div><dt>Reels, free spins, bonus</dt><dd>' + pct(PARTS.game) + '</dd></div>' +
            (COL ? '<div><dt>' + esc(COL.name) + '</dt><dd>' + pct(PARTS.collector) + '</dd></div>' : '') +
            '<div><dt>Jackpots</dt><dd>' + pct(PARTS.jackpots) + '</dd></div>' : '') +
          '<div><dt>Hit rate</dt><dd>' + Math.round(game.stats.hit * 100) + '%</dd></div>' +
          '<div><dt>Free spins</dt><dd>1 in ' + game.stats.featureEvery + '</dd></div>' +
          '<div><dt>Bonus</dt><dd>1 in ' + game.stats.bonusEvery + '</dd></div>' +
          '<div><dt>Volatility</dt><dd>' + esc(game.volatility) + '</dd></div>' +
        '</dl><p class="pt-note">This is a faucet, so the machine pays back more than it takes in: an RTP of ' + RTP +
          (PARTS ? ' with everything included: the reels, free spins and bonus ' + pct(PARTS.game) + (COL ? ', the ' + esc(COL.name) + "'s " + esc(COL.reward.name) + ' ' + pct(PARTS.collector) : '') +
            ' and the jackpots ' + pct(PARTS.jackpots) + '. ' : '. ') +
          'Wins are rounded to whole sats fairly (2.4 sats pays 3 sats 40% of the time), so the RTP holds at any bet. ' +
          'Rates were measured over ' + game.stats.spins + ' simulated spins. ' +
          'Every spin is played on the server and is provably fair. Bitcoin Cash Testnet4 coins have no monetary value.</p></div>' +
        '</details>';
    }

    // The jackpots and the collector in plain words (D43: inside the RTP, won in the game).
    function jackpotRules() {
      if (!JPC) return "";
      var out = '<div class="pt-section"><div class="pt-h">Jackpots</div><ul class="rules">' +
        '<li><b>' + JPC.emoji + ' ' + esc(JPC.name) + ':</b> ' + esc(JPC.text) + '</li>' +
        '<li>Every bet adds ' + pct(JPC.minor.contribution) + ' of itself to this machine\'s MINOR, ' + pct(JPC.major.contribution) +
          ' to its MAJOR and ' + pct(JPC.grand.contribution) + ' to the GRAND shared by all machines. A win takes everything the jackpot holds.</li>' +
        '<li>After a win the next one starts with a head start from the faucet, so it never shows zero.</li>' +
        '<li>Provably fair: whether a spin wins a jackpot comes from its seeds, like the rest of the spin. Each jackpot also publishes the SHA-256 hash of a secret seed that fixes its head start; anyone can check a win on the <a href="../jackpots.html">jackpots page</a>.</li>' +
        '</ul></div>';
      if (COL) out += '<div class="pt-section"><div class="pt-h">' + esc(COL.name) + '</div><ul class="rules">' +
        '<li><b>' + COL.emoji + ' ' + esc(COL.symbolName) + ':</b> ' + esc(COL.text) + '</li>' +
        '<li><b>' + esc(COL.reward.name) + ':</b> ' + esc(COL.reward.text) + ' Played at your bet, at most the average bet that filled it.</li>' +
        '</ul></div>';
      return out;
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
    // A wait that a stop request cuts short.
    function stoppable(ms) {
      if (stopReq || ms <= 0) return Promise.resolve();
      return new Promise(function (resolve) {
        var t = setTimeout(done, ms);
        function done() { clearTimeout(t); stopWake = null; resolve(); }
        stopWake = done;
      });
    }
    function requestStop() {
      if (!reelsTurning || stopReq) return;
      stopReq = true;
      spinBtn.classList.add("pressed");
      setTimeout(function () { spinBtn.classList.remove("pressed"); }, 160);
      sfx.press();
      if (stopWake) stopWake();
      updateControls();
    }
    function startReels() {
      reelsTurning = true;
      stopReq = false;
      updateControls();
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
    // Stop reels one by one, left to right; once 2 scatters show, the remaining reels build
    // suspense. A stop request lands the reels still turning almost at once.
    async function stopAll(target) {
      var seen = 0, landings = [];
      var gap = reduce ? 80 : 420, landMs = reduce ? 160 : 560, susMs = reduce ? 400 : 1300;
      var quickGap = reduce ? 30 : 70, quickMs = reduce ? 100 : 200;
      for (var i = 0; i < REELS; i++) {
        if (seen >= 2 && i >= 2 && !stopReq) {
          reelEls[i].classList.add("anticipate");
          sfx.anticipation(susMs / 1000);
          await stoppable(susMs);
        } else if (i > 0) {
          await (stopReq ? sleep(quickGap) : stoppable(gap));
        }
        var n = target[i].filter(function (k) { return k === SCAT; }).length;
        landings.push(land(i, target[i], stopReq ? quickMs : landMs).then((function (idx, countAfter, has) {
          return function () {
            reelEls[idx].classList.remove("anticipate");
            sfx.reelStop(idx);
            if (has) sfx.scatter(countAfter);
          };
        }(i, seen + n, n > 0))));
        seen += n;
      }
      reelsTurning = false;
      stopReq = false;
      updateControls();
      await Promise.all(landings);
      reelEls.forEach(function (r) { r.classList.remove("anticipate"); });
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
      if (total >= playBet * 50) return { tier: "mega" };
      if (total >= playBet * 10) return { tier: "big" };
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
      if (t.tier === "jackpot") return "TOP PRIZE! 5× " + syms[t.jp.symbol].emoji + " on line " + (t.jp.line + 1) + " · " + amt(p.total);
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
        lcdSub.textContent = (feature.reward ? feature.name + " " : "Free spin ") + feature.played + " / " + (feature.played + feature.left) +
          (feature.mult > 1 ? " · wins ×" + feature.mult : "") + (feature.reward ? " · bet " + fmt(playBet) + " tSats" : "") + " · won " + amt(feature.total);
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
      else if (feature.locked) extra = '<span>' + syms[WILD].emoji + ' LOCKED</span>';
      fsSign.innerHTML = '<span><span class="e">' + (feature.reward ? feature.emoji : syms[SCAT].emoji) + '</span> ' + (feature.reward ? esc(feature.name.toUpperCase()) : 'FREE SPINS') + '</span><span>' + feature.left + ' LEFT</span>' +
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
      showBanner(tier, title || { big: "BIG WIN!", mega: "MEGA WIN!", jackpot: "TOP PRIZE!!!" }[tier], amt(total));
      machine.classList.add("celebrate");
      if (tier !== "big" && !reduce) machine.classList.add("shake");
      if (tier === "jackpot" && marquee) marquee.classList.add("jackpot");
      ({ big: sfx.bigWin, mega: sfx.megaWin, jackpot: sfx.jackpot }[tier]).call(sfx);
      fx.coinShower({ big: 30, mega: 70, jackpot: 140 }[tier]);
      fx.burst(flavor.burst, { big: 20, mega: 40, jackpot: 70 }[tier]);
      setTimeout(function () { if (token === presentToken) hideBanner(); }, { big: 2200, mega: 2800, jackpot: 4200 }[tier]);
    }
    var WAIT = { none: 700, win: 1100, big: 2300, mega: 2900, jackpot: 4300 };
    var SETTLE_MS = 500;   // pause after the last win's animations, before the next spin
    // How long a phase's win animations run: the count-up, the banner (see celebrate) and
    // the paylines drawing one after another (see highlight).
    function winAnimMs(p, tier) {
      var lines = p.items.filter(function (it) { return it.type === "line"; }).length;
      return Math.max({ none: 0, win: 700, big: 2200, mega: 2800, jackpot: 4200 }[tier],
                      lines && !reduce ? (lines - 1) * 220 + 450 : 0);
    }

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
      var canStop = busy && reelsTurning && !stopReq;
      spinBtn.disabled = (busy && !canStop) || off;
      spinBtn.classList.toggle("busy", busy);
      spinBtn.setAttribute("aria-busy", busy ? "true" : "false");
      if (!spinBtn._label) spinBtn._label = spinBtn.getAttribute("aria-label");
      spinBtn.setAttribute("aria-label", canStop ? "Stop the reels" : spinBtn._label);
      spinWrap.classList.toggle("busy", busy);
      spinWrap.classList.toggle("off", off);
      spinWrap.classList.toggle("can-stop", canStop);
      spinSub.textContent = canStop ? "STOP" : busy ? (stage.hidden ? (feature ? "FREE SPINS" : "GOOD LUCK") : "BONUS") : out ? "SIGN IN" : "BET " + fmt(bet);
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
        if (feature.played > 0 && st.multiplier > feature.mult) {
          toast((feature.reward ? feature.emoji + " " + feature.name.toUpperCase() : "🌊 THE TIDE RISES") + ": WINS ×" + st.multiplier + "!", "feat");
          sfx.feature();
        }
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
        if (pi === 0) clearCellFx();
        renderSticky(fixedKeys);
        if (!(prespun && pi === 0)) {
          sfx.spinStart();
          startReels();
          await stoppable(reduce ? 200 : (pi ? 600 : 1000));
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
        settle = p.total > 0 ? winAnimMs(p, t.tier) + SETTLE_MS : 0;
        if (pi < phases.length - 1) await sleep(Math.max(reduce ? 400 : 1100, WAIT[t.tier]));
      }

      if (free) {
        feature.total += roundTotal;
        renderFeature();
        renderLcdSub();
      }
      if (!free) firstGrid = phases.length ? phases[0].grid : grid;
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
      var tier = won >= playBet * 50 ? "mega" : won >= playBet * 10 ? "big" : won > 0 ? "win" : "none";
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
      settle = won > 0 ? SETTLE_MS : 0;
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
      playBet = bet;
      updateControls();
      // The meters stay as they are until the spin has played out (no spoilers), then are read again.
      if (window.TNC_Jackpots) window.TNC_Jackpots.hold();

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
      await stoppable((reduce ? 200 : 1000) - (Date.now() - t0));

      try {
        settle = 0;
        await playSteps(r.data.steps);
        // Let the last win's animations finish (plus half a second) before the next spin.
        if (settle > 0) await sleep(settle);
      }
      finally {
        if (window.TNC_Jackpots) window.TNC_Jackpots.release();
        busy = false;
        feature = null;
        playBet = bet;
        clearCellFx();
        machine.classList.remove("in-feature", "in-reward");
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
      if (window.TNC_Jackpots) window.TNC_Jackpots.release();
      sfx.stopSpinLoop();
      reelsTurning = false;
      stopReq = false;
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
          if (st.free && i > 0 && steps[i - 1].type !== "freeSpinsStart" && steps[i - 1].type !== "rewardStart") await sleep(Math.max(reduce ? 400 : 900, wait));
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
          var wasReward = !!(feature && feature.reward);
          await sleep(Math.max(reduce ? 400 : 900, wait));
          endFeature(st);
          if (wasReward) rewardDone();
          wait = 0;
        } else if (st.type === "jackpot") {
          await sleep(Math.max(reduce ? 400 : 900, Math.min(wait, 1500)));
          if (st.cells) await showJackpot(st); else await celebrateJackpot(st);   // st.cells: won in the game (version 4)
          wait = 0;
        } else if (st.type === "collect") {
          await sleep(reduce ? 150 : Math.min(wait, 600));
          await playCollect(st);
          wait = st.full ? 0 : wait;
        } else if (st.type === "rewardStart") {
          await sleep(reduce ? 300 : 700);
          await startReward(st);
          wait = 0;
        } else if (st.type === "holdAndWin") {
          await sleep(reduce ? 300 : 700);
          await playHoldAndWin(st);
          rewardDone();
          wait = 0;
        }
      }
    }

    /* --- Version 4: symbols over the paid spin's first grid (jackpot and collect symbols) --- */
    // They are drawn on top of the symbols (which still pay as shown). If respins or free spins
    // came in between, the paid spin's first grid is put back first.
    var firstGrid = null, cellFx = $("#cell-fx"), reelBay = reelsWin.parentNode;
    function bayBox(el) {   // an element's layout box relative to the reel bay (untransformed, like the paylines)
      var x = 0, y = 0, e = el;
      while (e && e !== reelBay) { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent; }
      return { x: x, y: y, w: el.offsetWidth, h: el.offsetHeight };
    }
    function cellBox(c, r) {
      var b = bayBox(reelEls[c]), h = b.h / ROWS;
      return { x: b.x, y: b.y + r * h, w: b.w, h: h };
    }
    function clearCellFx() { if (cellFx) cellFx.textContent = ""; reelsWin.classList.remove("has-fx"); }
    function backToFirstGrid() {
      if (!firstGrid) return;
      var same = firstGrid.every(function (col, c) { return col.every(function (v, r) { return grid[c] && grid[c][r] === v; }); });
      if (same) return false;
      renderSticky([]);
      reelEls.forEach(function (r) { r.classList.remove("expanded"); });
      for (var c = 0; c < REELS; c++) setStatic(c, firstGrid[c]);
      grid = firstGrid;
      return true;
    }
    function overlay(cells, emoji, cls, stagger) {
      return cells.map(function (rc, k) {
        var b = cellBox(rc[0], rc[1]), o = document.createElement("div");
        o.className = "ov-sym " + cls;
        o.style.cssText = "left:" + b.x + "px;top:" + b.y + "px;width:" + b.w + "px;height:" + b.h + "px;" +
          (stagger && !reduce ? "animation-delay:" + (k * stagger) + "ms" : "");
        o.innerHTML = '<span class="g">' + emoji + '</span>';
        cellFx.appendChild(o);
        return o;
      });
    }

    /* --- A jackpot won in the game: each game shows it its own way, then the celebration --- */
    var TIER_NAMES = { minor: "MINOR", major: "MAJOR", grand: "GRAND" };
    async function showJackpot(st) {
      var token = ++presentToken, tier = st.tier;
      hideBanner();
      clearWins();
      clearCellFx();
      if (backToFirstGrid()) { setLcd("Back to your spin…", ""); await sleep(reduce ? 200 : 500); }
      reelsWin.classList.add("has-fx");
      var type = JPC.type;
      overlay(st.cells, JPC.emoji, "ov-jackpot ov-" + type, type === "apples" ? 260 : 220);
      sfx.scatter(st.cells.length);
      if (type === "apples") {
        setLcd(st.cells.length + " " + JPC.emoji + " " + JPC.name + ": the " + TIER_NAMES[tier] + " JACKPOT!", "win blink");
        toast(new Array(st.cells.length + 1).join(JPC.emoji) + " " + TIER_NAMES[tier] + "!", "feat");
        await sleep(reduce ? 600 : 1400 + st.cells.length * 260);
      } else if (type === "clams") {
        setLcd(JPC.emoji + " " + JPC.name + "! Open the clams until three match.", "win blink");
        toast(JPC.emoji + " " + JPC.name.toUpperCase() + "!", "feat");
        await sleep(reduce ? 500 : 1500);
        await openStage("jackpot-clams", function (done) { playClams(st, done); });
      } else {
        setLcd("3 " + JPC.emoji + " shooting stars! The " + JPC.name + " spins.", "win blink");
        toast("3 " + JPC.emoji + " " + JPC.name.toUpperCase() + "!", "feat");
        await sleep(reduce ? 500 : 1500);
        await openStage("jackpot-wheel", function (done) { playStarWheel(st, done); });
      }
      await celebrateJackpot(st);
    }
    // The bonus stage, for a jackpot pick or wheel and the Hold & Win.
    function openStage(cls, run) {
      return new Promise(function (resolve) {
        stage.hidden = false;
        stage.className = "bonus-stage " + cls;
        updateControls();
        run(function () {
          setTimeout(function () { stage.hidden = true; stage.innerHTML = ""; updateControls(); resolve(); }, reduce ? 300 : 1100);
        });
      });
    }
    // Deep Sea: 7 clams. The player opens them (or Auto); they reveal `picks` in order, the last one
    // the third of the won tier. The clams left closed get the other tiers, at most two of each, so
    // only the won tier ever shows three.
    function playClams(st, done) {
      var picks = st.picks || [st.tier, st.tier, st.tier], N = 7, opened = 0, count = { minor: 0, major: 0, grand: 0 }, autoTimer = null, finished = false;
      stage.innerHTML = stageHead("🦪 MAGIC OYSTER", "Open the clams! Three alike win that jackpot.") +
        '<div class="clam-tally">' + ["grand", "major", "minor"].map(function (t) {
          return '<span class="ct ct-' + t + '" data-t="' + t + '"><b>' + TIER_NAMES[t] + '</b><i></i><i></i><i></i></span>';
        }).join("") + '</div>' +
        '<div class="clam-bed">' + new Array(N + 1).join('<button type="button" class="clam"><span class="clam-shell">🐚</span></button>') + '</div>' +
        '<div class="bs-foot"><span class="bs-total" id="bs-total"></span><button type="button" class="btn-ghost" id="bs-auto">Auto open</button></div>';
      var clams = Array.prototype.slice.call(stage.querySelectorAll(".clam")), sub = $("#bs-sub");
      clams[0].focus({ preventScroll: true });
      function mark(t) {
        count[t]++;
        var pips = stage.querySelectorAll('.ct-' + t + ' i');
        if (pips[count[t] - 1]) pips[count[t] - 1].classList.add("on");
      }
      function reveal(c) {
        if (finished || c.disabled) return;
        var t = picks[opened++];
        c.disabled = true;
        c.classList.add("open", "t-" + t);
        c.innerHTML = '<span class="clam-pearl"></span><small>' + TIER_NAMES[t] + '</small>';
        mark(t);
        sfx.reveal(t === "grand" ? 25 : t === "major" ? 10 : 3);
        if (opened < picks.length) { sub.textContent = TIER_NAMES[t] + "! Keep opening…"; return; }
        finished = true;
        clearInterval(autoTimer);
        stage.querySelector('.ct-' + st.tier).classList.add("won");
        sub.textContent = "Three " + TIER_NAMES[st.tier] + " pearls: the " + TIER_NAMES[st.tier] + " JACKPOT!";
        sfx.collect();
        // What the closed clams held: the other tiers, up to two of each (never a second set of three).
        var fill = [];
        ["minor", "major", "grand"].forEach(function (x) { if (x !== st.tier) for (var k = count[x]; k < 2; k++) fill.push(x); });
        for (var j = fill.length - 1; j > 0; j--) { var y = rnd(j + 1), tmp = fill[j]; fill[j] = fill[y]; fill[y] = tmp; }
        clams.filter(function (x) { return !x.disabled; }).forEach(function (x, k) {
          var f = fill[k % fill.length] || (st.tier === "minor" ? "major" : "minor");
          x.disabled = true;
          x.classList.add("open", "ghost", "t-" + f);
          x.innerHTML = '<span class="clam-pearl"></span><small>' + TIER_NAMES[f] + '</small>';
        });
        setTimeout(done, reduce ? 500 : 1400);
      }
      clams.forEach(function (c) { c.addEventListener("click", function () { reveal(c); }); });
      function auto() {
        var btn = $("#bs-auto");
        if (btn) btn.disabled = true;
        clearInterval(autoTimer);
        autoTimer = setInterval(function () {
          var left = clams.filter(function (x) { return !x.disabled; });
          if (!left.length || finished) return clearInterval(autoTimer);
          reveal(left[rnd(left.length)]);
        }, reduce ? 200 : 650);
      }
      $("#bs-auto").addEventListener("click", auto);
      setTimeout(function () { if (!finished && !opened && !stage.hidden) auto(); }, 12000);   // opens by itself if left idle
    }
    // Cosmic Voyage: the Star Map Wheel (config jackpot.slices) stops on `slice`.
    function playStarWheel(st, done) {
      var slices = JPC.slices || ["minor", "major", "minor", "grand"], n = slices.length, seg = 360 / n, R = 100;
      var colors = { minor: "#1f6fb2", major: "#7b3fe4", grand: "#e0313f" };
      var paths = slices.map(function (t, i) {
        var a0 = (i * seg - 90) * Math.PI / 180, a1 = ((i + 1) * seg - 90) * Math.PI / 180;
        var x0 = R * Math.cos(a0), y0 = R * Math.sin(a0), x1 = R * Math.cos(a1), y1 = R * Math.sin(a1);
        var am = ((i + 0.5) * seg - 90) * Math.PI / 180, tx = 64 * Math.cos(am), ty = 64 * Math.sin(am);
        return '<path d="M0,0 L' + x0.toFixed(2) + ',' + y0.toFixed(2) + ' A' + R + ',' + R + ' 0 0 1 ' + x1.toFixed(2) + ',' + y1.toFixed(2) + ' Z" fill="' +
          colors[t] + '" stroke="#9ff0ff" stroke-width="1" data-i="' + i + '"/>' +
          '<text x="' + tx.toFixed(1) + '" y="' + ty.toFixed(1) + '" transform="rotate(' + ((i + 0.5) * seg) + ' ' + tx.toFixed(1) + ' ' + ty.toFixed(1) + ')" ' +
          'class="wheel-txt sw-' + t + '">' + TIER_NAMES[t] + '</text>';
      }).join("");
      stage.innerHTML = stageHead("🌠 " + JPC.name.toUpperCase(), "Spin the wheel for your jackpot!") +
        '<div class="wheel-wrap"><div class="wheel-pointer">▼</div>' +
        '<svg class="wheel star-wheel" viewBox="-110 -110 220 220" aria-hidden="true"><g id="wheel-g">' + paths +
        '<circle r="16" fill="#120a2e" stroke="#9ff0ff" stroke-width="3"/><text class="wheel-hub" y="5">🌠</text></g>' +
        '<circle r="104" fill="none" stroke="#8a46f0" stroke-width="7"/></svg>' +
        '<button type="button" class="btn-red wheel-btn" id="wheel-btn">SPIN THE WHEEL</button></div>';
      var g = $("#wheel-g"), btn = $("#wheel-btn"), sub = $("#bs-sub"), started = false;
      btn.focus({ preventScroll: true });
      function go() {
        if (started) return;
        started = true;
        btn.disabled = true;
        sub.textContent = "The stars are turning…";
        var idx = st.slice != null ? st.slice : slices.indexOf(st.tier);
        var jitter = (Math.random() - 0.5) * seg * 0.6;
        var target = 360 * 5 + (360 - (idx + 0.5) * seg) + jitter;
        var dur = reduce ? 800 : 4600, t0 = performance.now(), lastSeg = -1;
        (function frame() {
          var p = Math.min(1, (performance.now() - t0) / dur), a = target * (1 - Math.pow(1 - p, 4));
          g.setAttribute("transform", "rotate(" + a.toFixed(2) + ")");
          var sgi = Math.floor(a / seg);
          if (sgi !== lastSeg) { lastSeg = sgi; sfx.wheelTick(); }
          if (p < 1) requestAnimationFrame(frame);
          else {
            var win = g.querySelector('path[data-i="' + idx + '"]');
            if (win) win.classList.add("win-seg");
            sub.textContent = "The wheel stops on the " + TIER_NAMES[st.tier] + " JACKPOT!";
            sfx.wheelStop();
            setTimeout(done, reduce ? 400 : 900);
          }
        }());
      }
      btn.addEventListener("click", go);
      setTimeout(function () { if (!started && !stage.hidden) go(); }, 9000);   // spins by itself if left idle
    }

    /* --- Collect symbols: onto their cells, then into the meter beside the reels --- */
    async function playCollect(st) {
      if (!COL || !st.cells || !st.cells.length) {
        if (st.filled != null && window.TNC_Jackpots) TNC_Jackpots.collect(id, st.filled, st.size, !!st.full);
        return;
      }
      // The paylines belong to the grid that was on screen; the list of wins under the reels stays.
      if (backToFirstGrid()) { svg.innerHTML = ""; reelsWin.classList.remove("has-win", "has-focus"); await sleep(reduce ? 150 : 400); }
      var items = overlay(st.cells, COL.emoji, "ov-collect", 140);
      sfx.chip();
      await sleep(reduce ? 200 : 650 + st.cells.length * 140);
      var meter = reelBay.querySelector(".collector-screen"), mb = meter && bayBox(meter);
      if (mb && meter.offsetWidth) {
        items.forEach(function (o, k) {
          var x = mb.x + mb.w / 2 - (o.offsetLeft + o.offsetWidth / 2), y = mb.y + mb.h * 0.45 - (o.offsetTop + o.offsetHeight / 2);
          o.style.setProperty("--fx", x + "px");
          o.style.setProperty("--fy", y + "px");
          o.style.animationDelay = (k * 90) + "ms";
          o.classList.add("ov-fly");
        });
        await sleep(reduce ? 150 : 700 + items.length * 90);
      }
      items.forEach(function (o) { o.remove(); });
      if (window.TNC_Jackpots) TNC_Jackpots.collect(id, st.filled, st.size, !!st.full);
      sfx.collect();
      if (st.filled != null && !st.full) {
        lcdSub.textContent = COL.emoji + " +" + st.cells.length + " · " + COL.name + " " + fmt(st.filled) + " / " + fmt(st.size);
      }
      if (st.full) {
        var token = ++presentToken;
        hideBanner();
        clearWins();
        clearCellFx();
        showBanner("free", COL.name.toUpperCase() + " FULL!", COL.reward.name.toUpperCase());
        machine.classList.add("celebrate");
        setLcd(COL.emoji + " You filled the " + COL.name + "! " + COL.reward.name + " at " + fmt(st.bet || bet) + " tSats a spin.", "win blink");
        sfx.freeSpins();
        fx.burst([COL.emoji, "✨"].concat(flavor.burst), 40);
        await sleep(reduce ? 900 : 2600);
        if (token === presentToken) hideBanner();
      }
    }

    /* --- The collector's reward --- */
    // Harvest Festival, Hyperdrive: free spins at the reward's bet (the steps that follow).
    async function startReward(st) {
      var R = COL.reward;
      playBet = st.bet || bet;
      feature = { left: st.spins, played: 0, total: 0, sticky: 0, mult: Math.max(1, R.multiplier || 1),
                  reward: true, name: R.name, emoji: COL.emoji, locked: R.lockedWild || null };
      updateControls();
      renderFeature();
      var token = ++presentToken;
      hideBanner();
      clearWins();
      showBanner("free", R.name.toUpperCase() + "!", st.spins + " SPINS" + (R.multiplier > 1 ? " · WINS ×" + R.multiplier : R.rise ? " · RISING ×" : ""));
      machine.classList.add("celebrate", "in-feature", "in-reward");
      setLcd(R.name + ": " + st.spins + " free spins at " + fmt(playBet) + " tSats!", "win blink");
      sfx.freeSpins();
      fx.burst(flavor.burst, 30);
      await sleep(reduce ? 900 : 2400);
      if (token === presentToken) hideBanner();
    }
    function rewardDone() {
      playBet = bet;
      machine.classList.remove("in-reward");
      if (window.TNC_Jackpots) TNC_Jackpots.collectorDone(id);
    }
    // Treasure Hold & Win: pearls lock on a 5 × 3 board, every respin may add more (and resets the
    // respins to 3); each pearl shows its value × the reward's bet; then the total win.
    function playHoldAndWin(st) {
      var R = COL.reward, b = st.bet || bet;
      playBet = b;
      return openStage("bonus-hold", function (done) {
        var left = R.respins, sum = 0, token = ++presentToken;
        stage.innerHTML = stageHead("🪙 " + R.name.toUpperCase(), "The pearls lock in place. New pearls reset the respins to " + R.respins + ".") +
          '<div class="hw-info"><span>RESPINS <b id="hw-left">' + left + '</b></span><span>BET <b>' + fmt(b) + ' tSats</b></span></div>' +
          '<div class="hw-board" id="hw-board">' + new Array(REELS * ROWS + 1).join('<span class="hw-cell"></span>') + '</div>' +
          '<div class="bs-foot"><span class="bs-total" id="bs-total">0</span></div>';
        var cells = stage.querySelectorAll(".hw-cell"), leftEl = $("#hw-left"), totalEl = $("#bs-total"), sub = $("#bs-sub");
        function place(p, k) {
          var c = cells[p.row * REELS + p.reel], v = p.value * b;
          c.className = "hw-cell pearl" + (p.value >= 10 ? " big" : "");
          c.style.animationDelay = reduce ? "" : (k * 120) + "ms";
          c.innerHTML = '<span class="hw-p"></span><small>' + amt(Math.round(v)) + '</small>';
          sum += v;
        }
        function showSum() { totalEl.textContent = "≈ " + amt(Math.round(sum * S)); }
        (async function () {
          (st.start || []).forEach(place);
          showSum();
          sfx.reveal(5);
          setLcd(R.name + ": " + (st.start || []).length + " pearls locked!", "win");
          await sleep(reduce ? 400 : 1300);
          var respins = st.respins || [];
          for (var i = 0; i < respins.length; i++) {
            stage.querySelector("#hw-board").classList.add("spinning");
            left--;
            leftEl.textContent = left;
            sfx.spinStart();
            await sleep(reduce ? 150 : 700);
            stage.querySelector("#hw-board").classList.remove("spinning");
            var landed = respins[i];
            if (landed.length) {
              landed.forEach(place);
              showSum();
              left = R.respins;
              leftEl.textContent = left;
              leftEl.parentNode.classList.remove("reset"); void leftEl.offsetWidth; leftEl.parentNode.classList.add("reset");
              sub.textContent = "+" + landed.length + " pearl" + (landed.length > 1 ? "s" : "") + "! Respins back to " + R.respins + ".";
              sfx.reveal(10);
            } else {
              sub.textContent = left ? "No new pearl. " + left + " respin" + (left > 1 ? "s" : "") + " left…" : "No respins left.";
              sfx.reelStop(2);
            }
            await sleep(reduce ? 200 : 600);
          }
          totalEl.textContent = amt(st.win);
          sub.textContent = R.name + " over: " + fmtMult(st.prize) + "× your bet = " + amt(st.win);
          await sleep(reduce ? 300 : 900);
          done();
        }());
      }).then(function () {
        var token = ++presentToken, won = st.win || 0;
        var tier = won >= b * 50 ? "mega" : won >= b * 10 ? "big" : won > 0 ? "win" : "none";
        setLcd(R.name + " paid " + fmtMult(st.prize) + "× = " + amt(won), won ? "win" : "");
        if (won > 0) celebrate(won, tier === "win" ? "big" : tier, token, R.name.toUpperCase() + "!");
        addHistory(R.name, won, won, tier);
        settle = won > 0 ? 2800 + SETTLE_MS : 0;
        return sleep(reduce ? 800 : 2600).then(function () { if (token === presentToken) hideBanner(); });
      });
    }

    // A jackpot paid out: its own celebration (the Minor: big; the Major: bigger; the Grand: biggest),
    // with the amount in tBCH. The jackpots are read again when the spin ends.
    var JP = {
      minor: { title: "MINOR JACKPOT!", banner: "big", ms: 3200, coins: 60, burst: 30, shake: false, count: 1600 },
      major: { title: "MAJOR JACKPOT!", banner: "mega", ms: 4400, coins: 140, burst: 60, shake: true, count: 2400 },
      grand: { title: "GRAND JACKPOT!", banner: "jackpot", ms: 5600, coins: 240, burst: 100, shake: true, count: 3200 }
    };
    async function celebrateJackpot(st) {
      var tier = st.tier || st.pool, c = JP[tier] || JP.major, win = st.win || 0;
      var bchs = window.TNC_Units ? TNC_Units.format(win) : fmt(win) + " tSats";
      var token = ++presentToken;
      hideBanner();
      clearWins();
      winShown = win;
      countUp(meterWin, 0, win, reduce ? 0 : c.count, token, true);
      credit(win, token, reduce ? 0 : c.count);
      showBanner(c.banner, c.title, bchs);
      machine.classList.add("celebrate");
      if (c.shake && !reduce) machine.classList.add("shake");
      if (tier === "grand" && marquee) marquee.classList.add("jackpot");
      (tier === "minor" ? sfx.bigWin : tier === "major" ? sfx.megaWin : sfx.jackpot).call(sfx);
      fx.coinShower(c.coins);
      fx.burst(JPC ? [JPC.emoji].concat(flavor.burst) : flavor.burst, c.burst);
      setLcd(c.title + " " + bchs, "win blink");
      lcdSub.textContent = JPC ? "Won with the " + JPC.name + "." : "A jackpot, on top of the game's win.";
      addHistory(tier + " jackpot", win, win, tier === "minor" ? "big" : "jackpot");
      await sleep(reduce ? 1500 : c.ms);
      if (token === presentToken) hideBanner();
      clearCellFx();
      settle = SETTLE_MS;
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
      var total = st.win, played = st.played, feature0 = feature;
      feature = null;
      renderFeature();
      renderSticky([]);
      machine.classList.remove("in-feature");
      var t2 = ++presentToken;
      hideBanner();
      clearWins();
      showBanner(total >= playBet * 10 ? "big" : "free", feature0 && feature0.reward ? feature0.name.toUpperCase() + " OVER" : "FEATURE OVER", played + " SPINS WON " + amt(total));
      setLcd((feature0 && feature0.reward ? feature0.name : "Free spins") + " over: " + played + " spins won " + amt(total), total ? "win" : "");
      winShown = total;
      meterWin.textContent = num(total);
      if (total >= playBet * 10) { sfx.bigWin(); fx.coinShower(50); fx.burst(flavor.burst, 30); machine.classList.add("celebrate"); }
      else if (total > 0) sfx.win(); else sfx.noWin();
      setTimeout(function () { if (t2 === presentToken) hideBanner(); }, 2600);
      settle = total > 0 ? 2600 + SETTLE_MS : 0;
    }

    function addHistory(kind, net, win, tier) {
      var empty = historyEl.querySelector(".history-empty");
      if (empty) empty.remove();
      var li = document.createElement("li");
      li.className = (win > 0 ? "is-win" : "") + (tier === "big" || tier === "mega" || tier === "jackpot" ? " is-big" : "");
      var line = kind === "bonus" ? syms[BONUS].emoji + " " + esc(BON.name)
        : COL && kind === COL.reward.name ? COL.emoji + " " + esc(kind)
        : /jackpot/.test(kind) ? (/grand/.test(kind) ? "🏆 Grand" : /minor/.test(kind) ? "✨ Minor" : "⭐ Major") + " jackpot"
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
    // Full screen: zoom the machine so that, on whichever side runs out first, there are
    // exactly MARGIN pixels to the screen edge, and centre it. The size is measured as drawn
    // (3D tilt, sloped deck and plinths reach beyond the layout box), and re-measured after
    // zooming because the perspective makes the drawn size not quite proportional.
    var MARGIN = 10, PLINTH = 16;   // PLINTH: the cabinet's base plate below the last element
    // Only what can be seen counts: an element that clips its content (overflow other than
    // visible, e.g. each reel, whose strip holds many symbols above and below the window)
    // adds its own box, and nothing inside it is measured.
    function drawnBox() {
      var r = machine.getBoundingClientRect(), b = { top: r.top, left: r.left, right: r.right, bottom: r.bottom };
      (function walk(parent) {
        for (var el = parent.firstElementChild; el; el = el.nextElementSibling) {
          if (el.hidden) continue;
          var cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden") continue;
          var q = el.getBoundingClientRect();
          if (q.width || q.height) {
            b.top = Math.min(b.top, q.top); b.left = Math.min(b.left, q.left);
            b.right = Math.max(b.right, q.right); b.bottom = Math.max(b.bottom, q.bottom);
          }
          if (cs.overflowX === "visible" && cs.overflowY === "visible") walk(el);
        }
      }(machine));
      b.bottom += PLINTH * (parseFloat(machine.style.scale) || 1);
      return { top: b.top, left: b.left, w: b.right - b.left, h: b.bottom - b.top };
    }
    function fitMachine() {
      machine.style.scale = ""; machine.style.translate = ""; document.body.classList.remove("fs-no-jukebox");
      machineStage.style.height = ""; machineStage.style.paddingTop = "";
      if (!document.body.classList.contains("is-fullscreen")) return;
      if (!machine.offsetHeight || !machine.offsetWidth) return;
      var W = window.innerWidth, H = window.innerHeight;
      var d = drawnBox(), k = 1;
      for (var pass = 0; pass < 3; pass++) {
        k = k * Math.min((H - 2 * MARGIN) / d.h, (W - 2 * MARGIN) / d.w);
        k = Math.max(0.2, Math.min(k, 2.5));
        machine.style.scale = String(k);
        d = drawnBox();
      }
      machine.style.translate = Math.round((W - d.w) / 2 - d.left) + "px " + Math.round((H - d.h) / 2 - d.top) + "px";
      // The jukebox button sits in the bottom-right corner. When the machine fills that corner
      // too (portrait phones), hide the button in full screen; the music keeps playing.
      var fab = document.querySelector(".jb-fab");
      document.body.classList.remove("fs-no-jukebox");
      if (fab) {
        var f = fab.getBoundingClientRect(), x = (W - d.w) / 2, y = (H - d.h) / 2;
        var hit = f.width && f.left < x + d.w && f.right > x && f.top < y + d.h && f.bottom > y;
        document.body.classList.toggle("fs-no-jukebox", !!hit);
      }
    }
    function onFsChange() {
      document.body.classList.toggle("is-fullscreen", !!fsElement());
      docEl.classList.toggle("is-fullscreen", !!fsElement());
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
    spinBtn.addEventListener("click", function () { if (busy) requestStop(); else spin(); });
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
      if (busy) { requestStop(); return; }
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
