/*
 * TestnetCasino.com: the slot machine pages (5 reels × 3 rows, 10 paylines).
 *
 * Loads the game's config (GET /games/{id}/config), then PixiJS, the machine engine
 * (pixi-machine.js) and the game's skin (pixi-<theme>.js), which draw and play the whole
 * machine in a canvas. Every outcome comes from POST /spins as `steps[]`; the machine only
 * animates them. This file also builds the paytable and rules (TNC_Slot.paytableSection),
 * shown under the machine and used by the engine.
 *
 * Playing requires signing in: signed-out visitors see the machine with "SIGN IN" on its key.
 *
 * Depends on: api.js (TNC_API); the machine also uses auth.js, units.js, jackpots.js, audio.js.
 */
(function () {
  "use strict";

  var api = window.TNC_API;
  var LINE_COLORS = ["#ffd166", "#06d6a0", "#ef476f", "#4cc9f0", "#f78c6b",
                     "#c86bff", "#83e377", "#ff99c8", "#f9c74f", "#90e0ef"];   // the paylines (same as the machine's)

  // Symbol indexes by role. Regular symbols are listed common → rare, so the last one is the top symbol.
  function kinds(game) {
    var k = { wild: -1, scatter: -1, bonus: -1, top: -1 };
    game.symbols.forEach(function (s, i) { if (s.kind) k[s.kind] = i; else k.top = i; });
    return k;
  }

  /* ---------- Helpers ---------- */

  function fmt(n) { return n.toLocaleString("en-US"); }
  function fmtMult(m) { return (m % 1 ? m.toFixed(1).replace(/\.0$/, "") : String(m)); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  /* ---------- Paytable & rules ---------- */
  function paytableSection(game) {
    return '<section class="panel" aria-labelledby="pt-title"><h2 class="panel-label" id="pt-title">PAYTABLE &amp; RULES</h2>' + paytableHtml(game) + '</section>';
  }
  function paytableHtml(game) {
    var syms = game.symbols, K = kinds(game);
    var WILD = K.wild, SCAT = K.scatter, BONUS = K.bonus, TOP = K.top;
    var FS = game.freeSpins, BON = game.bonus, JPC = game.jackpot || null, COL = game.collector || null;
    var PAYLINES = game.engine.paylines, REELS = game.engine.reels || 5, ROWS = game.engine.rows || 3, MAX_FREE_SPINS = game.engine.maxFreeSpins || 100;
    function pct(x) { return String(+(x * 100).toFixed(2)) + "%"; }
    var RTP = pct(game.rtp || game.stats.rtp), PARTS = game.rtpParts || null;
    function cellHtml(i) {
      var s = syms[i];
      return '<div class="symbol' + (s.kind ? " " + s.kind : "") + '"><span class="g">' + s.emoji + '</span></div>';
    }
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

    return buildPaytable();
  }
  window.TNC_Slot = { paytableSection: paytableSection };

  /* ---------- The machine (PixiJS) ---------- */
  var HERE = (document.currentScript && document.currentScript.src) || "";
  function loadScript(src) {
    return new Promise(function (ok, fail) {
      var s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = function () { fail(new Error("Could not load " + src)); };
      document.head.appendChild(s);
    });
  }
  // PixiJS, the engine (pixi-machine.js), then the game's skin (pixi-<theme>.js).
  function loadPixi(theme) {
    var base = HERE.replace(/slot\.js(\?.*)?$/, ""), v = (HERE.match(/\?v=[^&]+/) || [""])[0];
    return (window.PIXI ? Promise.resolve() : loadScript(base + "../vendor/pixi-8.22.0.min.js"))
      .then(function () { return window.TNC_PixiMachine ? null : loadScript(base + "pixi-machine.js" + v); })
      .then(function () { return loadScript(base + "pixi-" + theme + ".js" + v); });
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
          loadPixi(r.data.theme).then(function () {
            if (!window.TNC_PixiMachine || !TNC_PixiMachine.supports(r.data)) throw new Error("This machine is not available.");
            return TNC_PixiMachine.build(root, id, r.data);
          }).then(frameMachine, function (e) {
            if (window.console) console.error(e);
            root.innerHTML = '<p class="panel m-loading" id="m-loading" role="status"></p>';
            msg = document.getElementById("m-loading");
            msg.innerHTML = "This machine could not be loaded. " + (window.WebGLRenderingContext ? "" : "Your browser needs WebGL. ") +
              '<button type="button" class="btn-gold" id="m-retry">Try again</button>';
            document.getElementById("m-retry").addEventListener("click", function () { location.reload(); });
          });
          return;
        }
        if (attempt < 2 && (r.status === 0 || r.status >= 500)) { setTimeout(function () { load(attempt + 1); }, 1500 * (attempt + 1)); return; }
        msg.innerHTML = esc(api.errorText(r, "This machine could not be loaded.")) + ' <button type="button" class="btn-gold" id="m-retry">Try again</button>';
        document.getElementById("m-retry").addEventListener("click", function () { msg.textContent = "Loading the machine…"; load(0); });
      });
    }(0));
  }

  /*
   * On load, show the reels and the spin key together. The site header sits above the
   * machine, so without this the spin key starts below the fold. Skipped when the page was
   * opened at an anchor, restored to a scroll position, or the player already scrolled,
   * clicked or pressed a key. (The reels start at 27% of the canvas, its base ends at 97%.)
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
      var c = document.querySelector("#px-canvas canvas");
      if (!c) return;
      var H = window.innerHeight, y = window.scrollY, b = c.getBoundingClientRect();
      var mTop = b.top + y, rTop = mTop + b.height * 0.27, sBot = mTop + b.height * 0.97;
      if (sBot <= H - 8) return;                       // already fits
      var top = sBot - mTop + 16 <= H ? mTop - 8       // the whole machine fits
              : Math.min(rTop - 8, sBot - H + 16);     // otherwise the reels first, the spin key in view
      window.scrollTo({ top: Math.max(0, top), behavior: "instant" });
    }
    requestAnimationFrame(go);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { requestAnimationFrame(go); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
