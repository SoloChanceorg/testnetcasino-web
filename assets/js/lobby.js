/*
 * TestnetCasino.com: the lobby's Roulette card. The last five numbers (GET /roulette/rounds, public; a golden-ball
 * round gets a gold ring)
 * and how many players are at the table (GET /roulette/state), read again every 30 s while the page
 * is visible. Without an answer the card keeps its own text and sample numbers.
 *
 * Depends on: api.js.
 */
(function () {
  "use strict";
  var api = window.TNC_API, last = document.querySelector("[data-rl-last]"), live = document.querySelector("[data-rl-live]");
  if (!api || !last) return;
  var RED = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];

  function pockets(rounds) {
    last.textContent = "";
    rounds.forEach(function (x) {
      var n = x.number, s = document.createElement("span");
      s.className = (n === 0 ? "pk-g" : RED.indexOf(n) !== -1 ? "pk-r" : "pk-b") + (x.golden === true ? " pk-gold" : "");
      s.textContent = String(n);
      if (x.golden === true) s.title = "Golden ball: every win ×10";
      last.appendChild(s);
    });
    last.setAttribute("aria-label", "Last numbers, newest first: " + rounds.map(function (x) { return x.number + (x.golden === true ? " (golden ball)" : ""); }).join(", "));
  }

  function load() {
    if (document.hidden) return;
    api.rouletteRounds().then(function (r) {
      var items = r && r.status === 200 && r.data && r.data.items || [];
      var done = items.filter(function (x) { return typeof x.number === "number" && x.status === "settled"; }).slice(0, 5);
      if (done.length) pockets(done);
    }).catch(function () {});
    if (!live || !api.rouletteState) return;
    api.rouletteState().then(function (r) {
      var p = r && r.status === 200 && r.data && r.data.players;
      if (!Array.isArray(p)) return;
      live.textContent = p.length ? "LIVE · " + p.length + (p.length === 1 ? " player" : " players") + " at the table" : "LIVE TABLE · a round every minute";
    }).catch(function () {});
  }

  load();
  setInterval(load, 30000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) load(); });
})();
