/*
 * TestnetCasino.com: live faucet totals at the top of every page.
 *
 * GET {apiBase}/faucet (public): { wallet, house, users, pendingWithdrawals, players, updatedAt, stale?,
 * coins: { btc: { wallet, house, users, pendingWithdrawals, jackpots, updatedAt, stale? }, bch: {...} } }
 * (D46; the top-level amounts are tBCH), all in sats:
 *   house               what the faucet has left to give away
 *   users               sum of all player balances
 *   players             { allTime, withBalance, last24h, last30d } (counts)
 * The bar shows both coins side by side (tBTC first): the faucet rounded to 2 decimals (exact
 * value in the tooltip), player balances with all 8 decimals. It is the only place on the site
 * that shows whole coins. The server recomputes them at most every 5 minutes; the bar re-reads
 * them every minute while the tab is visible.
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
  function icon(c) { return new URL("img/t" + c + ".svg", SITE).href; }
  var COINS = window.TNC_Coin ? window.TNC_Coin.list : ["bch"];

  var data = null, failed = false, timer = null;

  bar.innerHTML =
    '<div class="fb-inner">' +
      '<span class="fb-live" aria-hidden="true"><span class="fb-dot"></span><span data-k="live">LIVE</span></span>' +
      '<dl class="fb-stats">' +
        stat("house", "Left in the faucet", "fb-main") +
        stat("users", "Player balances") +
      '</dl>' +
      '<span class="fb-time" data-k="time"></span>' +
      '<dl class="fb-players" data-k="players" hidden>' +
        '<dt>Players</dt>' +
        player("allTime", "all time") + player("last30d", "in 30 days") + player("last24h", "in 24 h") + player("withBalance", "with a balance") +
      '</dl>' +
    '</div>';

  function player(key, label) {
    return '<dd><strong data-p="' + key + '">…</strong> ' + label + '</dd>';
  }

  // One label, then the amount of every coin (tBTC first).
  function stat(key, label, cls) {
    return '<div class="fb-stat' + (cls ? " " + cls : "") + '"><dt>' + label + '</dt>' + COINS.map(function (c) {
      return '<dd data-coin="' + c + '"><img class="tbch" src="' + icon(c) + '" alt=""><span data-k="' + key + ':' + c + '">…</span></dd>';
    }).join("") + '</div>';
  }

  function q(k) { return bar.querySelector('[data-k="' + k + '"]'); }

  function render() {
    var stale = !!(data && data.stale);
    bar.classList.toggle("is-error", failed && !data);
    bar.classList.toggle("is-stale", stale || (failed && !!data));
    q("live").textContent = stale ? "STALE" : "LIVE";
    if (!data) {
      if (failed) bar.querySelectorAll("[data-k*=':']").forEach(function (e) { e.textContent = "n/a"; });
      if (failed) q("time").textContent = "Faucet offline";
      return;
    }
    // Faucet totals are rounded to 2 decimals; player balances are small, so they show all 8.
    COINS.forEach(function (c) {
      // Before D46 there was no `coins`: the top-level amounts are tBCH.
      var d = data.coins ? data.coins[c] : c === "bch" ? data : null;
      [["house", true], ["users", false]].forEach(function (p) {
        var e = q(p[0] + ":" + c);
        if (!e) return;
        e.parentNode.hidden = !d;
        if (!d) return;
        e.textContent = p[1] ? U.round2(d[p[0]], c) : U.coins(d[p[0]], c);
        e.parentNode.title = U.format(d[p[0]], c);
      });
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
