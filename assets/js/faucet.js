/*
 * TestnetCasino.com: live faucet totals at the top of every page.
 *
 * GET {apiBase}/faucet (public): { wallet, house, users, pendingWithdrawals,
 * updatedAt, stale? }, all in sats:
 *   house               what the faucet has left to give away
 *   wallet              the hot wallet's confirmed balance
 *   users               sum of all player balances
 *   pendingWithdrawals  withdrawals requested but not yet sent (not shown)
 *   players             { allTime, withBalance, last24h, last30d } (counts)
 * The server recomputes them at most every 5 minutes; the bar re-reads them
 * every minute while the tab is visible. Amounts are shown in tBCH: the faucet
 * and wallet rounded to 2 decimals (exact value in the tooltip), player
 * balances with all 8 decimals.
 *
 * Depends on: api.js, units.js.
 */
(function () {
  "use strict";

  var bar = document.getElementById("faucet-bar");
  var U = window.TNC_Units;
  if (!bar || !window.TNC_API || !U) return;

  var REFRESH_MS = 60000;
  var SITE = new URL("../", document.currentScript && document.currentScript.src || location.href).href;
  var COIN = new URL("img/bch-testnet4.svg", SITE).href;

  var data = null, failed = false, timer = null;

  bar.innerHTML =
    '<div class="fb-inner">' +
      '<span class="fb-live" aria-hidden="true"><span class="fb-dot"></span><span data-k="live">LIVE</span></span>' +
      '<dl class="fb-stats">' +
        stat("house", "Left in the faucet", "fb-main") +
        stat("wallet", "Hot wallet") +
        stat("users", "Player balances") +
      '</dl>' +
      '<span class="fb-time" data-k="time"></span>' +
      '<dl class="fb-players" data-k="players" hidden>' +
        '<dt><span aria-hidden="true">👥</span> Players</dt>' +
        player("allTime", "all time") + player("last30d", "in 30 days") + player("last24h", "in 24 h") + player("withBalance", "with a balance") +
      '</dl>' +
    '</div>';

  function player(key, label) {
    return '<dd><strong data-p="' + key + '">…</strong> ' + label + '</dd>';
  }

  function stat(key, label, cls) {
    return '<div class="fb-stat' + (cls ? " " + cls : "") + '"><dt>' + label + '</dt><dd>' +
      '<img class="tbch" src="' + COIN + '" alt=""><span data-k="' + key + '">…</span></dd></div>';
  }

  function q(k) { return bar.querySelector('[data-k="' + k + '"]'); }

  function render() {
    var stale = !!(data && data.stale);
    bar.classList.toggle("is-error", failed && !data);
    bar.classList.toggle("is-stale", stale || (failed && !!data));
    q("live").textContent = stale ? "STALE" : "LIVE";
    if (!data) {
      if (failed) {
        ["house", "wallet", "users"].forEach(function (k) { q(k).textContent = "n/a"; });
        q("time").textContent = "Faucet offline";
      }
      return;
    }
    // Faucet totals are rounded to 2 decimals; player balances are small, so they show all 8.
    [["house", data.house, true], ["wallet", data.wallet, true], ["users", data.users, false]].forEach(function (p) {
      var e = q(p[0]);
      e.textContent = p[2] ? U.round2(p[1]) : U.format(p[1]);
      e.parentNode.title = U.format(p[1]);
    });
    var pl = data.players, plEl = q("players");
    plEl.hidden = !pl;
    if (pl) plEl.querySelectorAll("[data-p]").forEach(function (e) {
      var v = pl[e.getAttribute("data-p")];
      e.textContent = typeof v === "number" ? v.toLocaleString("en-US") : "n/a";
    });
    // No update time on the bar; only say so when the latest refresh failed.
    q("time").textContent = failed ? "Offline, showing the last values" : "";
  }

  function load() {
    TNC_API.faucet().then(function (res) {
      if (res.status === 200 && res.data && typeof res.data.house === "number") { data = res.data; failed = false; }
      else failed = true;
      render();
    });
  }

  function schedule() {
    clearInterval(timer);
    if (!document.hidden) timer = setInterval(load, REFRESH_MS);
  }

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) load();
    schedule();
  });

  render();
  load();
  schedule();
})();
