/*
 * TestnetCasino.com: progressive jackpot displays (lobby and game pages).
 *
 * GET /jackpots (public): { grand, major: { gameId: sats }, recentWins: [ { pool, gameId,
 * player, amount, wonAt } ], updatedAt }. The server refreshes it every 10 seconds; this
 * re-reads it every 20 seconds while the tab is visible, and right after a jackpot win.
 *
 * Fills every element with data-jackpot="grand" or data-jackpot="major:<gameId>" with the
 * pool, counting up when it grows:
 *   - by default in tBCH with 4 decimals; the exact amount is in the tooltip, and tapping the
 *     value shows it in tSats for a few seconds, a second tap goes back (phones have no hover);
 *   - with data-jackpot-units="bch8" (the lobby's Grand) in tBCH with 8 decimals;
 *   - with data-jackpot-units="game" (the boards on the machines) in the game's unit switch:
 *     exact tSats or tBCH with 8 decimals, so the pool visibly grows with every spin.
 * An element with id "jp-winners" gets the recent winners list.
 *
 * Every paid spin adds bet x contributionBasisPoints / 10,000 to the game's Major and to the
 * Grand. The server's view is cached for up to 10 seconds, so contribute() adds the player's
 * own share at once; it is absorbed again by the next server reading that has grown by it
 * (the shown pool never goes backwards, except when a jackpot is won and the pool restarts).
 *
 * Depends on: api.js, units.js. Exposed as window.TNC_Jackpots { refresh, render, contribute, data }.
 */
(function () {
  "use strict";

  var api = window.TNC_API, U = window.TNC_Units;
  if (!api || !U || !api.jackpots) return;

  var POLL_MS = 20000;
  var GAMES = { "fruit-orchard": "Fruit Orchard", "deep-sea": "Deep Sea Treasure", "cosmic-voyage": "Cosmic Voyage" };
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var data = null, timer = null, loading = false, lastFetch = 0;
  var pending = {};   // key -> sats this player added that the server view may not show yet
  var PENDING_MS = 60000;

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function serverValue(d, key) {
    if (!d) return null;
    if (key === "grand") return typeof d.grand === "number" ? d.grand : null;
    var m = /^major:(.+)$/.exec(key);
    return m && d.major && typeof d.major[m[1]] === "number" ? d.major[m[1]] : null;
  }
  function pendingSum(key) {
    var now = Date.now(), list = (pending[key] || []).filter(function (p) { return now - p.t < PENDING_MS; });
    pending[key] = list;
    return list.reduce(function (a, p) { return a + p.sats; }, 0);
  }
  function value(key) {
    var v = serverValue(data, key);
    return v == null ? null : Math.round(v + pendingSum(key));
  }
  // A new server reading: the growth since the last one covers the oldest pending shares first.
  // A smaller pool means it was won and restarted: nothing pending is left in it.
  function absorb(old, next) {
    Object.keys(pending).forEach(function (key) {
      var a = serverValue(old, key), b = serverValue(next, key);
      if (a == null || b == null) return;
      if (b < a) { pending[key] = []; return; }
      var growth = b - a, list = pending[key];
      while (list.length && growth > 0) {
        var take = Math.min(growth, list[0].sats);
        list[0].sats -= take; growth -= take;
        if (list[0].sats <= 1e-9) list.shift();
      }
    });
  }
  function label(key) { return key === "grand" ? "Grand jackpot" : "Major jackpot"; }

  var G = U.game;
  function gameUnits(node) { return !!G && node.getAttribute("data-jackpot-units") === "game"; }

  // "1.0201" + a separate unit, so themes can style the number on its own.
  function paint(node, sats, exact) {
    node._jpShowExact = !!exact;
    var num = node.querySelector(".jp-num"), unit = node.querySelector(".jp-unit");
    if (!num) {
      node.textContent = "";
      num = el("span", "jp-num"); unit = el("span", "jp-unit");
      node.appendChild(num); node.appendChild(unit);
    }
    if (gameUnits(node)) { num.textContent = G.value(sats); unit.textContent = " " + G.unit(); }
    else if (exact) { num.textContent = Number(sats).toLocaleString("en-US"); unit.textContent = " tSats"; }
    else if (node.getAttribute("data-jackpot-units") === "bch8") { num.textContent = U.bch(sats); unit.textContent = " tBCH"; }
    else { num.textContent = U.round4(sats).replace(" tBCH", ""); unit.textContent = " tBCH"; }
  }

  function animate(node, from, to) {
    node._jpTarget = to;
    if (reduce || from === to || from == null) { paint(node, to); return; }
    var t0 = performance.now(), ms = 900;
    node.classList.remove("jp-grow"); void node.offsetWidth;
    if (to > from) node.classList.add("jp-grow");
    (function step() {
      if (node._jpTarget !== to) return;   // a newer value took over
      var p = Math.min(1, (performance.now() - t0) / ms), e = 1 - Math.pow(1 - p, 3);
      paint(node, Math.round(from + (to - from) * e));
      if (p < 1) requestAnimationFrame(step);
    }());
  }

  function render() {
    document.querySelectorAll("[data-jackpot]").forEach(function (node) {
      var key = node.getAttribute("data-jackpot"), v = value(key);
      if (v == null) { if (!node._jpSats) paint(node, NaN); return; }
      var old = node._jpSats;
      node._jpSats = v;
      node.title = label(key) + ": " + U.format(v) + " (" + v.toLocaleString("en-US") + " tSats)";
      node.setAttribute("aria-label", label(key) + " " + (gameUnits(node) ? G.format(v) : node.getAttribute("data-jackpot-units") === "bch8" ? U.format(v) : U.round4(v)));
      if (!node._jpBound && !gameUnits(node)) {
        node._jpBound = true;
        // Tap shows the exact sats for a few seconds (no hover on phones).
        // A second tap goes back to tBCH at once.
        node.addEventListener("click", function () {
          if (node._jpSats == null) return;
          clearTimeout(node._jpExact);
          if (node._jpShowExact) { paint(node, node._jpSats); return; }
          paint(node, node._jpSats, true);
          node._jpExact = setTimeout(function () { paint(node, node._jpSats); }, 3000);
        });
      }
      animate(node, old == null ? null : old, v);
    });
    renderWinners();
  }

  function renderWinners() {
    var list = document.getElementById("jp-winners");
    if (!list || !data) return;
    var wins = Array.isArray(data.recentWins) ? data.recentWins : [];
    list.textContent = "";
    var empty = document.getElementById("jp-winners-empty");
    if (empty) empty.hidden = wins.length > 0;
    wins.forEach(function (w) {
      var grand = /^grand/.test(w.pool || ""), li = el("li", "jp-win" + (grand ? " is-grand" : ""));
      li.appendChild(el("span", "jp-win-pool", grand ? "🏆 Grand" : "⭐ Major · " + (GAMES[w.gameId] || w.gameId)));
      li.appendChild(el("span", "jp-win-player", String(w.player || "")));
      var amt = el("span", "jp-win-amount", U.format(w.amount));
      amt.title = Number(w.amount).toLocaleString("en-US") + " tSats";
      li.appendChild(amt);
      var d = new Date(w.wonAt);
      li.appendChild(el("span", "jp-win-time", isNaN(d) ? "" : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })));
      list.appendChild(li);
    });
  }

  function refresh() {
    if (loading) return Promise.resolve(data);
    loading = true;
    lastFetch = Date.now();
    return api.jackpots().then(function (r) {
      loading = false;
      if (r.status === 200 && r.data && typeof r.data.grand === "number") { absorb(data, r.data); data = r.data; render(); }
      return data;
    });
  }

  function schedule() {
    clearInterval(timer);
    if (!document.hidden) timer = setInterval(refresh, POLL_MS);
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); schedule(); });

  // A paid spin of `bet` sats on gameId just happened (cfg = the game config's jackpots).
  // Pools listed in `won` were just paid out: those come back from the server, not from here.
  function contribute(gameId, bet, cfg, won) {
    if (!cfg || !(bet > 0)) return;
    won = won || [];
    [["major:" + gameId, cfg.major, "major"], ["grand", cfg.grand, "grand"]].forEach(function (x) {
      if (!x[1] || won.indexOf(x[2]) >= 0) return;
      (pending[x[0]] = pending[x[0]] || []).push({ sats: bet * (x[1].contributionBasisPoints || 0) / 10000, t: Date.now() });
    });
    render();
    if (won.length || Date.now() - lastFetch > 10000) refresh();
  }

  // The game boards follow the machine's tSats / tBCH switch.
  if (G) G.onChange(function () {
    document.querySelectorAll("[data-jackpot]").forEach(function (node) {
      if (gameUnits(node) && node._jpSats != null) { node._jpTarget = node._jpSats; paint(node, node._jpSats); node.setAttribute("aria-label", label(node.getAttribute("data-jackpot")) + " " + G.format(node._jpSats)); }
    });
  });

  window.TNC_Jackpots = { refresh: refresh, render: render, contribute: contribute, get data() { return data; } };
  refresh();
  schedule();
})();
