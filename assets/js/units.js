/*
 * TestnetCasino.com: amount formatting. All amounts from the API are integer
 * sats (1 tBCH = 100,000,000 sats).
 *
 * Everywhere on the site amounts are shown in tBCH:
 *   format(sats)  "0.00012340 tBCH"   balances, tables, totals
 *   short(sats)   "0.0001 tBCH"       running text and buttons (no trailing zeros)
 *   round2(sats)  "101.00 tBCH"       rounded to 2 decimals (faucet totals)
 *   parse(text)   "0.0015" → 150000   (tBCH input to sats, exact; null if invalid)
 *
 * Inside a game machine the credit can be shown in tSats (default) or tBCH,
 * with a switch on the machine:
 *   game.get() / set(u) / toggle() / onChange(fn)    u = "sat" | "bch"
 *   game.format(sats)  "1,234 tSats" or "0.00001234 tBCH"
 *   game.value(sats)   "1,234" or "0.00001234"  (meters, unit shown apart)
 *   game.unit()        "tSats" or "tBCH"
 * The preference is a display setting only (localStorage "tnc.gameUnit").
 */
(function () {
  "use strict";

  var KEY = "tnc.gameUnit";
  var gameUnit = "sat";
  try { if (localStorage.getItem(KEY) === "bch") gameUnit = "bch"; } catch (e) {}
  var listeners = [];

  function int(n) { return Number(n).toLocaleString("en-US"); }
  function ok(n) { return typeof n === "number" && isFinite(n); }

  // Exact decimal string from integer sats (string math, no floating point).
  function bch(sats) {
    var neg = sats < 0, s = String(Math.abs(Math.round(sats)));
    while (s.length < 9) s = "0" + s;
    return (neg ? "-" : "") + int(s.slice(0, -8)) + "." + s.slice(-8);
  }
  function trimmed(sats) {
    var s = bch(sats).replace(/0+$/, "");
    return s.replace(/\.$/, "");
  }

  window.TNC_Units = {
    bch: function (sats) { return ok(sats) ? bch(sats) : "n/a"; },
    format: function (sats) { return ok(sats) ? bch(sats) + " tBCH" : "n/a"; },
    short: function (sats) { return ok(sats) ? trimmed(sats) + " tBCH" : "n/a"; },
    round2: function (sats) {
      if (!ok(sats)) return "n/a";
      var cents = Math.round(sats / 1000000), neg = cents < 0, s = String(Math.abs(cents));   // 1 cent = 0.01 tBCH
      while (s.length < 3) s = "0" + s;
      return (neg ? "-" : "") + int(s.slice(0, -2)) + "." + s.slice(-2) + " tBCH";
    },
    parse: function (text) {
      var m = /^\s*(\d*)(?:\.(\d{0,8}))?\s*$/.exec(String(text).replace(/,/g, ""));
      if (!m || (m[1] === "" && !m[2])) return null;
      var frac = (m[2] || "");
      while (frac.length < 8) frac += "0";
      var whole = m[1] ? parseInt(m[1], 10) : 0;
      if (whole > 20000000) return null;
      return whole * 100000000 + parseInt(frac, 10);
    },
    game: {
      get: function () { return gameUnit; },
      set: function (u) {
        gameUnit = u === "bch" ? "bch" : "sat";
        try { localStorage.setItem(KEY, gameUnit); } catch (e) {}
        listeners.forEach(function (fn) { fn(gameUnit); });
      },
      toggle: function () { this.set(gameUnit === "bch" ? "sat" : "bch"); },
      onChange: function (fn) { listeners.push(fn); },
      unit: function () { return gameUnit === "bch" ? "tBCH" : "tSats"; },
      value: function (sats) { return !ok(sats) ? "n/a" : gameUnit === "bch" ? bch(sats) : int(sats); },
      format: function (sats) { return this.value(sats) + " " + this.unit(); }
    }
  };
})();
