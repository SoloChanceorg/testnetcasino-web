/*
 * TestnetCasino.com: amount formatting. All amounts from the API are integer
 * sats (1 tBCH = 100,000,000 sats).
 *
 * Amounts are shown in sats, written "tBCH sats" (brand kit). Only the faucet bar at the top
 * shows whole coins.
 *   format(sats)  "12,340 tBCH sats"   balances, bonuses, bets, wins, jackpots, withdrawals
 *   short(sats)   the same (kept for the callers that used the short tBCH form)
 *   int(sats)     "12,340"             table cells (the column header names the unit)
 *   coins(sats)   "0.00012340 tBCH"    whole coins, all 8 decimals (faucet bar)
 *   bch(sats)     "0.00012340"         the same without the ticker
 *   round2(sats)  "101.00 tBCH"        rounded to 2 decimals (faucet totals)
 *   round4(sats)  "1.0201 tBCH"        rounded to 4 decimals
 *   parse(text)   "12,340" → 12340     (sats input, whole numbers; null if invalid)
 *   UNIT          "tBCH sats"
 *
 * Inside a game machine the credit can be shown in tBCH sats (default) or tBCH,
 * with a switch on the machine:
 *   game.get() / set(u) / toggle() / onChange(fn)    u = "sat" | "bch"
 *   game.format(sats)  "1,234 tBCH sats" or "0.00001234 tBCH"
 *   game.value(sats)   "1,234" or "0.00001234"  (meters, unit shown apart)
 *   game.unit()        "tBCH sats" or "tBCH"
 * The preference is a display setting only (localStorage "tnc.gameUnit").
 *
 * RTP in running text: pages write the current numbers and mark them, and they are replaced from a game
 * config (GET /games/{id}/config, public; every machine has the same RTP and parts):
 *   <span data-rtp>101%</span>                    rtp
 *   <span data-rtp-part="headStarts">8.5%</span>  rtpParts.game / collector / jackpots / headStarts
 *   <span data-jp-share="minor">3.36%</span>       jackpot.minor / major / grand .contribution
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

  function pct(x) { return String(+(x * 100).toFixed(2)) + "%"; }
  function fillRtp() {
    var nodes = document.querySelectorAll("[data-rtp], [data-rtp-part], [data-jp-share]");
    if (!nodes.length || !window.TNC_API || !window.TNC_API.gameConfig) return;
    window.TNC_API.gameConfig("fruit-orchard").then(function (r) {
      var c = r && r.status === 200 && r.data;
      if (!c || typeof c.rtp !== "number") return;
      nodes.forEach(function (n) {
        var part = n.getAttribute("data-rtp-part"), tier = n.getAttribute("data-jp-share"), v = null;
        if (n.hasAttribute("data-rtp")) v = c.rtp;
        else if (part) v = c.rtpParts && c.rtpParts[part];
        else if (tier) v = c.jackpot && c.jackpot[tier] && c.jackpot[tier].contribution;
        if (typeof v === "number") n.textContent = pct(v);
      });
    }).catch(function () {});
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fillRtp); else fillRtp();

  var UNIT = "tBCH sats";
  function sats(n) { return ok(n) ? int(Math.round(n)) + " " + UNIT : "n/a"; }
  window.TNC_Units = {
    UNIT: UNIT,
    bch: function (sats) { return ok(sats) ? bch(sats) : "n/a"; },
    coins: function (sats) { return ok(sats) ? bch(sats) + " tBCH" : "n/a"; },
    int: function (n) { return ok(n) ? int(Math.round(n)) : "n/a"; },
    format: sats,
    short: sats,
    round4: function (sats) {
      if (!ok(sats)) return "n/a";
      var u = Math.round(sats / 10000), neg = u < 0, s = String(Math.abs(u));   // 1 unit = 0.0001 tBCH
      while (s.length < 5) s = "0" + s;
      return (neg ? "-" : "") + int(s.slice(0, -4)) + "." + s.slice(-4) + " tBCH";
    },
    round2: function (sats) {
      if (!ok(sats)) return "n/a";
      var cents = Math.round(sats / 1000000), neg = cents < 0, s = String(Math.abs(cents));   // 1 cent = 0.01 tBCH
      while (s.length < 3) s = "0" + s;
      return (neg ? "-" : "") + int(s.slice(0, -2)) + "." + s.slice(-2) + " tBCH";
    },
    parse: function (text) {
      var m = /^\s*(\d{1,16})\s*$/.exec(String(text).replace(/[,\s_]/g, ""));
      if (!m) return null;
      var n = parseInt(m[1], 10);
      return n > 2100000000000000 ? null : n;
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
      unit: function () { return gameUnit === "bch" ? "tBCH" : UNIT; },
      value: function (sats) { return !ok(sats) ? "n/a" : gameUnit === "bch" ? bch(sats) : int(sats); },
      format: function (sats) { return this.value(sats) + " " + this.unit(); }
    }
  };
})();
