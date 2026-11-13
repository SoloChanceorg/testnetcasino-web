/*
 * TestnetCasino.com: the slot machine pages (5 reels × 3 rows; 5, 10 or 20 of 20 paylines at a bet per line, D47).
 *
 * Loads the game's config (GET /games/{id}/config), then PixiJS, the machine engine
 * (pixi-machine.js) and the game's skin (pixi-<theme>.js), which draw and play the whole
 * machine in a canvas. Every outcome comes from POST /spins as `steps[]`; the machine only
 * animates them. This file also builds the paytable and rules (TNC_Slot.paytableSection),
 * shown under the machine and used by the engine; the machine keeps it at the player's stake
 * (TNC_Slot.setStake(lines, lineBet, total): pays in sats, the active paylines, the stats of
 * the line count).
 *
 * Playing requires signing in: signed-out visitors see the machine with "SIGN IN" on its key.
 *
 * Depends on: api.js (TNC_API); the machine also uses auth.js, units.js, jackpots.js, audio.js.
 */
(function () {
  "use strict";

  var api = window.TNC_API;
  var LINE_COLORS = ["#ffd166", "#06d6a0", "#ef476f", "#4cc9f0", "#f78c6b", "#c86bff", "#83e377", "#ff99c8", "#f9c74f", "#90e0ef",
                     "#ff6b6b", "#7bdff2", "#fdffb6", "#caffbf", "#bdb2ff", "#ffc6ff", "#ffb347", "#00f5d4", "#f15bb5", "#fee440"];   // the paylines (same as the machine's)

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
  var current = null;   // the game the paytable on the page was built for (setStake keeps it at the player's stake)
  function paytableSection(game) {
    current = game;
    return '<section class="panel" aria-labelledby="pt-title"><h2 class="panel-label" id="pt-title">PAYTABLE &amp; RULES</h2>' + paytableHtml(game) + '</section>';
  }
  function listOr(a) { return a.length < 2 ? String(a[0]) : a.slice(0, -1).join(", ") + " or " + a[a.length - 1]; }
  function paytableHtml(game) {
    var syms = game.symbols, K = kinds(game);
    var WILD = K.wild, SCAT = K.scatter, BONUS = K.bonus, TOP = K.top;
    var FS = game.freeSpins, BON = game.bonus, JPC = game.jackpot || null, COL = game.collector || null;
    var PAYLINES = game.engine.paylines, REELS = game.engine.reels || 5, ROWS = game.engine.rows || 3, MAX_FREE_SPINS = game.engine.maxFreeSpins || 100;
    // Lines (D47, version 6): the line counts to choose from; line wins are × the line bet, everything else × the total bet.
    var HAS_LINES = !!(game.engine.lines && game.engine.lines.length), LINE_OPTS = HAS_LINES ? game.engine.lines : [PAYLINES.length];
    var UNIT = window.TNC_Units ? TNC_Units.unit() : "sats", MAX_TOTAL = window.TNC_Coin ? TNC_Coin.info().maxBet : 1000;
    function pct(x) { return String(+(x * 100).toFixed(2)) + "%"; }
    var RTP = pct(game.rtp || game.stats.rtp), PARTS = game.rtpParts || null;
    function cellHtml(i) {
      var s = syms[i];
      return '<div class="symbol' + (s.kind ? " " + s.kind : "") + '"><span class="g">' + s.emoji + '</span></div>';
    }
    function buildPaytable() {
      var OF_LINE = HAS_LINES ? "line bet" : "total bet";
      // The multiples, and a slot for the same in sats at the player's stake (filled by setStake).
      function pays(p, of) {
        return '<b>3</b> × ' + fmtMult(p[0]) + ' · <b>4</b> × ' + fmtMult(p[1]) + ' · <b>5</b> × ' + fmtMult(p[2]) +
          (HAS_LINES ? ' <span class="pt-of">× ' + of + '</span>' : '') + '<span class="pt-sats" data-pays="' + p.join(",") + '" data-of="' + of + '"></span>';
      }
      var order = [WILD, SCAT, BONUS];
      for (var i = syms.length - 1; i >= 0; i--) if (!syms[i].kind) order.push(i);
      var items = order.map(function (i) {
        var s = syms[i], body;
        if (i === SCAT) body = pays(s.pays, "total bet") + '<br>anywhere · <span class="jp">' + FS.awards.join(" / ") + ' free spins</span>';
        else if (i === BONUS) body = 'on reels 1, 3 &amp; 5 together<br><span class="jp">starts ' + esc(BON.name) + '</span>';
        else body = pays(s.pays, OF_LINE) + (i === WILD || i === TOP ? '<br><span class="jp">5 on a line = TOP PRIZE</span>' : "");
        return '<div class="pt-item' + (s.kind ? " special" : "") + '"><div class="pt-sym">' + cellHtml(i) + '</div>' +
          '<div class="pt-pays"><span class="nm">' + esc(s.name) + (s.kind ? " · " + s.kind.toUpperCase() : "") + '</span>' + body + '</div></div>';
      }).join("");

      var lines = PAYLINES.map(function (pl, li) {
        var cells = "";
        for (var r = 0; r < ROWS; r++) for (var c = 0; c < REELS; c++) cells += '<i' + (pl[c] === r ? ' class="on"' : "") + '></i>';
        return '<li class="pl" data-line="' + li + '" style="--lc:' + LINE_COLORS[li % LINE_COLORS.length] + '" aria-label="Line ' + (li + 1) + '"><span class="pl-num">' + (li + 1) +
          '</span><span class="pl-grid" aria-hidden="true">' + cells + '</span></li>';
      }).join("");

      var bonusDetail = BON.type === "pick" ? "Prizes: " + BON.prizes.map(function (x) { return x + "×"; }).join(", ") + " and " + BON.collect + " 🐛 worms."
        : BON.type === "wheel" ? "Wheel prizes: " + BON.segments.slice().sort(function (a, b) { return a - b; }).filter(function (x, i, a) { return a.indexOf(x) === i; }).map(function (x) { return x + "×"; }).join(", ") + "."
        : "Levels: " + BON.levels.map(function (x) { return fmt(x) + "×"; }).join(" → ") + ". Each boost succeeds " + Math.round(BON.advance * 100) + "% of the time.";
      if (HAS_LINES) bonusDetail += " Every prize is × your total bet.";

      // Lines and bets (version 6): the choice, the line bet's range per line count, what pays × what.
      var linesRules = !HAS_LINES ? '' : '<div class="pt-section"><div class="pt-h">Lines and bets</div><ul class="rules">' +
          '<li><b>Choose ' + listOr(LINE_OPTS) + ' lines and a bet per line.</b> A spin costs line bet × lines. More lines win more often; fewer lines win less often but pay more per line bet. ' +
            'The Return to Player rate is ' + RTP + ' at every line count, everything included.</li>' +
          '<li><b>Line bet:</b> whole ' + UNIT + ', from 1 to ' + LINE_OPTS.map(function (n) { return fmt(Math.floor(MAX_TOTAL / n)) + " at " + n + " lines"; }).join(", ") +
            ' (a spin costs at most ' + fmt(MAX_TOTAL) + ' ' + UNIT + '). Changing the lines lowers a line bet above the new maximum. Your stake now: <b data-stake>…</b>.</li>' +
          '<li><b>What pays × what:</b> line wins pay × the line bet; the ' + syms[SCAT].emoji + ' scatter, the ' + esc(BON.name) + ' prizes' +
            (COL && COL.reward.type === "holdAndWin" ? ' and the ' + esc(COL.reward.name) + ' pearls' : '') + ' pay × the total bet. ' +
            'Everything that counts your bet counts the total: the jackpot chance' + (COL ? ', the ' + esc(COL.name) : '') + ', the leaderboards.</li>' +
        '</ul></div>';

      return '<details class="paytable"><summary>Show paytable, features &amp; stats</summary>' + linesRules +
        '<div class="pt-section"><div class="pt-h">Features</div><ul class="rules">' +
          '<li><b>' + syms[WILD].emoji + ' ' + esc(game.featureName) + ':</b> ' + esc(game.featureText) + '</li>' +
          '<li><b>' + syms[SCAT].emoji + ' ' + esc(FS.name) + ':</b> 3, 4 or 5 scatters anywhere award ' + FS.awards.join(" / ") + ' free spins. ' + esc(FS.text) + ' Free spins can retrigger (up to ' + MAX_FREE_SPINS + ').</li>' +
          '<li><b>' + syms[BONUS].emoji + ' ' + esc(BON.name) + ' Bonus:</b> land ' + syms[BONUS].emoji + ' on reels 1, 3 and 5 at once. ' + esc(BON.text) + ' ' + esc(bonusDetail) + '</li>' +
        '</ul></div>' + jackpotRules() +
        '<div class="pt-section"><div class="pt-h">' + (HAS_LINES ? 'Symbols · line wins × line bet, scatter × total bet' : 'Symbols · pays × total bet') + '</div>' +
          (HAS_LINES ? '<p class="pt-sub" data-stake-at></p>' : '') + '<div class="pt-grid">' + items + '</div></div>' +
        '<div class="pt-section"><div class="pt-h">How to win</div><ul class="rules">' +
          '<li><b>Line wins:</b> 3, 4 or 5 matching symbols on an active payline, starting from the leftmost reel. Every winning line pays and they add up.</li>' +
          '<li><b>' + syms[WILD].emoji + ' Wild:</b> stands in for every symbol except ' + syms[SCAT].emoji + ' and ' + syms[BONUS].emoji + '.</li>' +
          '<li><b>TOP PRIZE:</b> five ' + syms[WILD].emoji + ' or five ' + syms[TOP].emoji + ' on one line. MEGA WIN ≥ 50× ' + (HAS_LINES ? 'total ' : '') + 'bet, BIG WIN ≥ 10× ' + (HAS_LINES ? 'total ' : '') + 'bet.</li>' +
        '</ul></div>' +
        '<div class="pt-section"><div class="pt-h" data-lines-h>' + PAYLINES.length + ' paylines</div><ol class="lines-grid">' + lines + '</ol></div>' +
        '<div class="pt-section"><div class="pt-h">Machine stats<span data-stat-at></span></div><dl class="facts">' +
          '<div><dt>Return to Player</dt><dd>' + RTP + (PARTS ? ' in all' : '') + '</dd></div>' +
          (PARTS ? '<div><dt>Reels, free spins, bonus</dt><dd>' + pct(PARTS.game) + '</dd></div>' +
            (COL ? '<div><dt>' + esc(COL.name) + '</dt><dd>' + pct(PARTS.collector) + '</dd></div>' : '') +
            '<div><dt>Jackpots</dt><dd>' + pct(PARTS.jackpots) + '</dd></div>' +
            (PARTS.headStarts != null ? '<div><dt>Jackpot head starts</dt><dd>' + pct(PARTS.headStarts) + '</dd></div>' : '') : '') +
          '<div><dt>Hit rate</dt><dd data-stat="hit">' + Math.round(game.stats.hit * 100) + '%</dd></div>' +
          '<div><dt>Free spins</dt><dd data-stat="featureEvery">1 in ' + fmt(game.stats.featureEvery) + '</dd></div>' +
          '<div><dt>Bonus</dt><dd data-stat="bonusEvery">1 in ' + fmt(game.stats.bonusEvery) + '</dd></div>' +
          (COL && game.stats.rewardEvery ? '<div><dt>' + esc(COL.reward.name) + '</dt><dd data-stat="rewardEvery">1 in ' + fmt(game.stats.rewardEvery) + '</dd></div>' : '') +
          '<div><dt>Volatility</dt><dd>' + esc(game.volatility) + '</dd></div>' +
        '</dl><p class="pt-note">This is a faucet, so the machine pays back more than it takes in: a Return to Player rate of ' + RTP +
          (PARTS ? ' with everything included: the reels, free spins and bonus ' + pct(PARTS.game) + (COL ? ', the ' + esc(COL.name) + "'s " + esc(COL.reward.name) + ' ' + pct(PARTS.collector) : '') +
            (PARTS.headStarts != null ? ', the jackpots\' share of every bet ' + pct(PARTS.jackpots) + ' and the jackpot head starts ' + pct(PARTS.headStarts) + '. '
              : ' and the jackpots ' + pct(PARTS.jackpots) + '. ') : '. ') +
          (HAS_LINES ? 'It is the same at ' + listOr(LINE_OPTS) + ' lines; the hit rate and how often the features come depend on the lines (shown for the lines you chose). ' : '') +
          'Wins are rounded to whole sats fairly (2.4 sats pays 3 sats 40% of the time), so the Return to Player rate holds at any bet. ' +
          'Rates were measured over ' + game.stats.spins + ' simulated spins. ' +
          'Every spin is played on the server and is provably fair. Testnet4 coins (tBTC and tBCH) have no monetary value.</p></div>' +
        '</details>';
    }

    // The jackpots and the collector in plain words (D43: inside the Return to Player rate, won in the game).
    function jackpotRules() {
      if (!JPC) return "";
      var out = '<div class="pt-section"><div class="pt-h">Jackpots</div><ul class="rules">' +
        '<li><b>' + JPC.emoji + ' ' + esc(JPC.name) + ':</b> ' + esc(JPC.text) + (HAS_LINES ? ' Your bet is the total: line bet × lines.' : '') + '</li>' +
        '<li>Every bet adds ' + pct(JPC.minor.contribution) + ' of itself to this machine\'s MINOR, ' + pct(JPC.major.contribution) +
          ' to its MAJOR and ' + pct(JPC.grand.contribution) + ' to the GRAND shared by all machines. A win takes everything the jackpot holds.</li>' +
        '<li>After a win the next one starts with a head start from the faucet, so it never shows zero' +
          (PARTS && PARTS.headStarts != null ? ' (the head starts are part of the ' + RTP + ' Return to Player rate too)' : '') + '.</li>' +
        '<li>Provably fair: whether a spin wins a jackpot comes from its seeds, like the rest of the spin. Each jackpot also publishes the SHA-256 hash of a secret seed that fixes its head start; anyone can check a win on the <a href="../jackpots.html">jackpots page</a>.</li>' +
        '</ul></div>';
      if (COL) out += '<div class="pt-section"><div class="pt-h">' + esc(COL.name) + '</div><ul class="rules">' +
        '<li><b>' + COL.emoji + ' ' + esc(COL.symbolName) + ':</b> ' + esc(COL.text) + (HAS_LINES ? ' The bigger your total bet (line bet × lines), the more it counts.' : '') + '</li>' +
        '<li><b>' + esc(COL.reward.name) + ':</b> ' + esc(COL.reward.text) + (HAS_LINES ? ' Played at your total bet and your lines, at most the average bet that filled it.' : ' Played at your bet, at most the average bet that filled it.') + '</li>' +
        '</ul></div>';
      return out;
    }

    return buildPaytable();
  }
  // The paytable at the player's stake: every pay in sats (× line bet or × total bet, × the line count's payScale),
  // the active paylines, the stats of that line count (statsByLines).
  function setStake(lines, lineBet, total) {
    var game = current, root = document.querySelector(".paytable");
    if (!game || !root) return;
    var HAS = !!(game.engine.lines && game.engine.lines.length), S = (HAS && game.payScales && game.payScales[String(lines)]) || game.payScale || 1;
    var unit = window.TNC_Units ? TNC_Units.unit() : "sats";
    root.querySelectorAll("[data-pays]").forEach(function (el) {
      var p = el.getAttribute("data-pays").split(",").map(Number), base = el.getAttribute("data-of") === "line bet" ? lineBet : total;
      el.innerHTML = "= " + p.map(function (m) { return fmt(Math.round(m * S * base)); }).join(" / ") + ' <span class="pt-unit">' + esc(unit) + "</span>";
    });
    root.querySelectorAll(".lines-grid .pl").forEach(function (li) { li.classList.toggle("is-off", parseInt(li.getAttribute("data-line"), 10) >= lines); });
    var lh = root.querySelector("[data-lines-h]");
    if (lh) lh.textContent = HAS ? lines + " of " + game.engine.paylines.length + " paylines active" : game.engine.paylines.length + " paylines";
    var stake = HAS ? "line bet " + fmt(lineBet) + " × " + lines + " lines = " + fmt(total) + " " + unit : fmt(total) + " " + unit;
    root.querySelectorAll("[data-stake]").forEach(function (el) { el.textContent = stake; });
    root.querySelectorAll("[data-stake-at]").forEach(function (el) { el.textContent = "In " + unit + " at your stake: " + stake + "."; });
    var st = HAS && game.statsByLines && game.statsByLines[String(lines)];
    if (st) {
      var hit = root.querySelector('[data-stat="hit"]'); if (hit) hit.textContent = Math.round(st.hit * 100) + "%";
      ["featureEvery", "bonusEvery", "rewardEvery"].forEach(function (k) { var el = root.querySelector('[data-stat="' + k + '"]'); if (el && st[k]) el.textContent = "1 in " + fmt(st[k]); });
      var at = root.querySelector("[data-stat-at]"); if (at) at.textContent = " · at " + lines + " lines";
    }
  }
  window.TNC_Slot = { paytableSection: paytableSection, setStake: setStake };

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
