/*
 * TestnetCasino.com: live faucet stats bar at the top of every page.
 *
 * Reads GET {apiBase}/faucet through TNC_API.faucet():
 *   { wallet, house, users, pendingWithdrawals, updatedAt }
 * wallet and house are in satoshis. The bar refreshes every minute while the
 * tab is visible.
 *
 * The tBCH / tSats switch is a display preference only. It is kept in
 * localStorage (no token, nothing secret).
 */
(function () {
  "use strict";

  var bar = document.getElementById("faucet-bar");
  if (!bar || !window.TNC_API || !TNC_API.faucet) return;

  var UNIT_KEY = "tnc.unit";
  var REFRESH_MS = 60000;
  var SITE = new URL("../", document.currentScript && document.currentScript.src || location.href).href;
  var COIN = new URL("img/bch-testnet4.svg", SITE).href;

  var unit = "bch";
  try { if (localStorage.getItem(UNIT_KEY) === "sat") unit = "sat"; } catch (e) {}

  var data = null;
  var failed = false;
  var timer = null;

  bar.innerHTML =
    '<div class="fb-inner">' +
      '<span class="fb-live" aria-hidden="true"><span class="fb-dot"></span>LIVE</span>' +
      '<dl class="fb-stats">' +
        stat("wallet", "Faucet wallet", true) +
        stat("house", "House", true) +
        stat("users", "Players", false) +
        stat("pending", "Pending withdrawals", false) +
      '</dl>' +
      '<button type="button" class="fb-unit" role="switch" aria-label="Show amounts in tBCH with decimals">' +
        '<span class="fb-opt" data-u="bch">tBCH</span><span class="fb-opt" data-u="sat">tSats</span>' +
      '</button>' +
      '<span class="fb-time" data-k="time"></span>' +
    '</div>';

  function stat(key, label, coin) {
    return '<div class="fb-stat"><dt>' + label + '</dt><dd>' +
      (coin ? '<img class="tbch" src="' + COIN + '" alt="">' : '') +
      '<span data-k="' + key + '">…</span></dd></div>';
  }

  var sw = bar.querySelector(".fb-unit");
  function q(k) { return bar.querySelector('[data-k="' + k + '"]'); }

  function fmtInt(n) { return Number(n).toLocaleString("en-US"); }

  // Exact formatting from integer satoshis (no floating point).
  function fmtAmount(sats) {
    if (typeof sats !== "number" || !isFinite(sats)) return "n/a";
    if (unit === "sat") return fmtInt(sats) + " tSats";
    var neg = sats < 0, s = String(Math.abs(Math.round(sats)));
    while (s.length < 9) s = "0" + s;
    var whole = s.slice(0, -8), frac = s.slice(-8);
    return (neg ? "-" : "") + fmtInt(whole) + "." + frac + " tBCH";
  }

  function fmtCount(n) { return typeof n === "number" && isFinite(n) ? fmtInt(n) : "n/a"; }

  function fmtTime(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "";
    return "Updated " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function render() {
    sw.setAttribute("aria-checked", unit === "bch" ? "true" : "false");
    sw.title = unit === "bch" ? "Showing tBCH. Switch to tSats." : "Showing tSats. Switch to tBCH.";
    bar.classList.toggle("is-error", failed && !data);
    if (!data) {
      if (failed) { ["wallet", "house", "users", "pending"].forEach(function (k) { q(k).textContent = "n/a"; }); q("time").textContent = "Faucet offline"; }
      return;
    }
    q("wallet").textContent = fmtAmount(data.wallet);
    q("house").textContent = fmtAmount(data.house);
    q("users").textContent = fmtCount(data.users);
    q("pending").textContent = fmtCount(data.pendingWithdrawals);
    var t = fmtTime(data.updatedAt);
    q("time").textContent = failed ? (t ? t + " (offline)" : "Offline") : t;
  }

  function load() {
    TNC_API.faucet().then(function (res) {
      if (res.status === 200 && res.data && typeof res.data.wallet === "number") { data = res.data; failed = false; }
      else failed = true;
      render();
    });
  }

  function schedule() {
    clearInterval(timer);
    if (!document.hidden) timer = setInterval(load, REFRESH_MS);
  }

  sw.addEventListener("click", function () {
    unit = unit === "bch" ? "sat" : "bch";
    try { localStorage.setItem(UNIT_KEY, unit); } catch (e) {}
    render();
  });

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) load();
    schedule();
  });

  render();
  load();
  schedule();
})();
