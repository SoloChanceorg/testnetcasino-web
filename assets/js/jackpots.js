/*
 * TestnetCasino.com: progressive jackpot displays (lobby and game pages).
 *
 * GET /jackpots (public): { grand, major: { gameId: sats }, recentWins: [ { pool, gameId,
 * player, amount, wonAt } ], updatedAt }. The server refreshes it every 10 seconds; this
 * re-reads it every 20 seconds while the tab is visible, and right after a jackpot win.
 *
 * Fills every element with data-jackpot="grand" or data-jackpot="major:<gameId>" with the
 * pool in tBCH (4 decimals), counting up when it grows. The exact amount is in the tooltip,
 * and tapping the value shows it for a few seconds (phones have no hover). An element with
 * id "jp-winners" gets the recent winners list.
 *
 * Depends on: api.js, units.js. Exposed as window.TNC_Jackpots { refresh, render, data }.
 */
(function () {
  "use strict";

  var api = window.TNC_API, U = window.TNC_Units;
  if (!api || !U || !api.jackpots) return;

  var POLL_MS = 20000;
  var GAMES = { "fruit-orchard": "Fruit Orchard", "deep-sea": "Deep Sea Treasure", "cosmic-voyage": "Cosmic Voyage" };
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var data = null, timer = null, loading = false;

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function value(key) {
    if (!data) return null;
    if (key === "grand") return typeof data.grand === "number" ? data.grand : null;
    var m = /^major:(.+)$/.exec(key);
    return m && data.major && typeof data.major[m[1]] === "number" ? data.major[m[1]] : null;
  }
  function label(key) { return key === "grand" ? "Grand jackpot" : "Major jackpot"; }

  // "1.0201" + a separate unit, so themes can style the number on its own.
  function paint(node, sats, exact) {
    var num = node.querySelector(".jp-num"), unit = node.querySelector(".jp-unit");
    if (!num) {
      node.textContent = "";
      num = el("span", "jp-num"); unit = el("span", "jp-unit");
      node.appendChild(num); node.appendChild(unit);
    }
    if (exact) { num.textContent = Number(sats).toLocaleString("en-US"); unit.textContent = " sats"; }
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
      node.title = label(key) + ": " + U.format(v) + " (" + v.toLocaleString("en-US") + " sats)";
      node.setAttribute("aria-label", label(key) + " " + U.round4(v));
      if (!node._jpBound) {
        node._jpBound = true;
        // Tap shows the exact sats for a few seconds (no hover on phones).
        node.addEventListener("click", function () {
          if (node._jpSats == null) return;
          clearTimeout(node._jpExact);
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
      amt.title = Number(w.amount).toLocaleString("en-US") + " sats";
      li.appendChild(amt);
      var d = new Date(w.wonAt);
      li.appendChild(el("span", "jp-win-time", isNaN(d) ? "" : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })));
      list.appendChild(li);
    });
  }

  function refresh() {
    if (loading) return Promise.resolve(data);
    loading = true;
    return api.jackpots().then(function (r) {
      loading = false;
      if (r.status === 200 && r.data && typeof r.data.grand === "number") { data = r.data; render(); }
      return data;
    });
  }

  function schedule() {
    clearInterval(timer);
    if (!document.hidden) timer = setInterval(refresh, POLL_MS);
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); schedule(); });

  window.TNC_Jackpots = { refresh: refresh, render: render, get data() { return data; } };
  refresh();
  schedule();
})();
