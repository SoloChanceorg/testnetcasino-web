/*
 * TestnetCasino.com: live faucet totals at the top of every page.
 *
 * GET {apiBase}/faucet (public): { wallet, house, users, pendingWithdrawals,
 * updatedAt, stale? }, all in sats:
 *   house               what the faucet has left to give away
 *   wallet              the hot wallet's confirmed balance
 *   users               sum of all player balances
 *   pendingWithdrawals  withdrawals requested but not yet sent
 * The server recomputes them at most every 5 minutes; the bar re-reads them
 * every minute while the tab is visible.
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
        stat("pending", "Pending withdrawals") +
      '</dl>' +
      '<button type="button" class="fb-unit" role="switch" aria-label="Show amounts in tBCH with decimals">' +
        '<span class="fb-opt" data-u="bch">tBCH</span><span class="fb-opt" data-u="sat">tSats</span>' +
      '</button>' +
      '<span class="fb-time" data-k="time"></span>' +
    '</div>';

  function stat(key, label, cls) {
    return '<div class="fb-stat' + (cls ? " " + cls : "") + '"><dt>' + label + '</dt><dd>' +
      '<img class="tbch" src="' + COIN + '" alt=""><span data-k="' + key + '">…</span></dd></div>';
  }

  var sw = bar.querySelector(".fb-unit");
  function q(k) { return bar.querySelector('[data-k="' + k + '"]'); }

  function fmtTime(iso) {
    var d = new Date(iso);
    return isNaN(d) ? "" : "Updated " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function render() {
    var bch = U.get() === "bch";
    sw.setAttribute("aria-checked", bch ? "true" : "false");
    sw.title = bch ? "Showing tBCH. Switch to tSats." : "Showing tSats. Switch to tBCH.";
    var stale = !!(data && data.stale);
    bar.classList.toggle("is-error", failed && !data);
    bar.classList.toggle("is-stale", stale || (failed && !!data));
    q("live").textContent = stale ? "STALE" : "LIVE";
    if (!data) {
      if (failed) {
        ["house", "wallet", "users", "pending"].forEach(function (k) { q(k).textContent = "n/a"; });
        q("time").textContent = "Faucet offline";
      }
      return;
    }
    q("house").textContent = U.format(data.house);
    q("wallet").textContent = U.format(data.wallet);
    q("users").textContent = U.format(data.users);
    q("pending").textContent = U.format(data.pendingWithdrawals);
    var t = fmtTime(data.updatedAt);
    if (stale) t = (t ? t + ", " : "") + "node unreachable";
    q("time").textContent = failed ? (t ? t + " (offline)" : "Offline") : t;
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

  sw.addEventListener("click", function () { U.toggle(); });
  U.onChange(render);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) load();
    schedule();
  });

  render();
  load();
  schedule();
})();
