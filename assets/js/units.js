/*
 * TestnetCasino.com: tBCH / tSats display preference, shared by the faucet
 * bar and the header balance. All amounts from the API are integer sats.
 *
 * The preference is a display setting only (localStorage "tnc.unit"); it is
 * not a token and holds no user data.
 */
(function () {
  "use strict";

  var KEY = "tnc.unit";
  var unit = "bch";
  try { if (localStorage.getItem(KEY) === "sat") unit = "sat"; } catch (e) {}
  var listeners = [];

  function int(n) { return Number(n).toLocaleString("en-US"); }

  // Exact formatting from integer sats (string math, no floating point).
  function bch(sats) {
    var neg = sats < 0, s = String(Math.abs(Math.round(sats)));
    while (s.length < 9) s = "0" + s;
    return (neg ? "-" : "") + int(s.slice(0, -8)) + "." + s.slice(-8);
  }

  window.TNC_Units = {
    get: function () { return unit; },
    set: function (u) {
      unit = u === "sat" ? "sat" : "bch";
      try { localStorage.setItem(KEY, unit); } catch (e) {}
      listeners.forEach(function (fn) { fn(unit); });
    },
    toggle: function () { this.set(unit === "bch" ? "sat" : "bch"); },
    onChange: function (fn) { listeners.push(fn); },
    // "101.00000000 tBCH" or "10,100,000,000 tSats"
    format: function (sats) {
      if (typeof sats !== "number" || !isFinite(sats)) return "n/a";
      return unit === "sat" ? int(sats) + " tSats" : bch(sats) + " tBCH";
    },
    sats: function (n) { return int(n) + " sats"; }
  };
})();
