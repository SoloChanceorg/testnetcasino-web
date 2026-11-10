/*
 * TestnetCasino.com: the coin and amount formatting.
 *
 * Two coins (D46), which never mix: tBTC (Bitcoin Testnet4, id "btc") and tBCH (Bitcoin Cash Testnet4,
 * id "bch"). All amounts from the API are integer sats of one coin (1 coin = 100,000,000 sats).
 *
 * The selected coin (TNC_Coin): the header's switch sets it, every page plays and shows that coin.
 *   TNC_Coin.get()            "btc" | "bch"  (localStorage "tnc.coin"; default tBTC, the primary network)
 *   TNC_Coin.set(c)           remembers it and reloads the page (every page reads it once, at load)
 *   TNC_Coin.list             ["btc", "bch"]  (tBTC first wherever both are listed)
 *   TNC_Coin.info(c)          { id, ticker, name, maxBet, maxChip, maxPerRound, bonus, signup, minWithdrawal,
 *                               maxWithdrawal, dailyWithdrawal, explorerTx(txid), explorer }
 *   TNC_Coin.ticker(c)        "tBTC" | "tBCH"
 * <html data-coin="btc|bch"> lets CSS colour the coin (tBTC orange, tBCH mint).
 *
 * Amounts are shown in sats, written "tBTC sats" / "tBCH sats" (brand kit). `coin` is optional
 * everywhere and defaults to the selected coin. Only the faucet bar shows whole coins.
 *   format(sats, coin)  "12,340 tBCH sats"   balances, bonuses, bets, wins, jackpots, withdrawals
 *   short(sats, coin)   the same
 *   unit(coin)          "tBCH sats"
 *   int(sats)           "12,340"             table cells (the column header names the unit)
 *   coins(sats, coin)   "0.00012340 tBCH"    whole coins, all 8 decimals (faucet bar)
 *   bch(sats)           "0.00012340"         the same without the ticker
 *   round2(sats, coin)  "101.00 tBCH"        rounded to 2 decimals (faucet totals)
 *   round4(sats, coin)  "1.0201 tBCH"        rounded to 4 decimals
 *   parse(text)         "12,340" → 12340     (sats input, whole numbers; null if invalid)
 *
 * The games show sats only (no whole-coin switch):
 *   game.format(sats)  "1,234 tBTC sats"
 *   game.value(sats)   "1,234"  (meters, unit shown apart)
 *   game.unit()        "tBTC sats"
 *
 * The Return to Player rate in running text: pages write the current numbers and mark them, and they are replaced from a game
 * config (GET /games/{id}/config, public; every machine has the same rate and parts):
 *   <span data-rtp>101%</span>                    rtp
 *   <span data-rtp-part="headStarts">8.5%</span>  rtpParts.game / collector / jackpots / headStarts
 *   <span data-jp-share="minor">3.36%</span>       jackpot.minor / major / grand .contribution
 */
(function () {
  "use strict";


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

  /* ═══════════════ The coin ═══════════════ */
  var COINS = {
    btc: { id: "btc", ticker: "tBTC", name: "Bitcoin Testnet4", maxBet: 100, maxChip: 100, maxPerRound: 1000,
           bonus: 100, signup: 1000, minWithdrawal: 1000, maxWithdrawal: 100000, dailyWithdrawal: 100000,
           explorer: "https://mempool.space/testnet4/", tx: "https://mempool.space/testnet4/tx/" },
    bch: { id: "bch", ticker: "tBCH", name: "Bitcoin Cash Testnet4", maxBet: 1000, maxChip: 1000, maxPerRound: 10000,
           bonus: 1000, signup: 10000, minWithdrawal: 1000, maxWithdrawal: 10000000, dailyWithdrawal: 100000000,
           explorer: "https://bchexplorer.cash/testnet4/", tx: "https://bchexplorer.cash/testnet4/tx/" }
  };
  var COIN_KEY = "tnc.coin", coin = "btc";
  try { var saved = localStorage.getItem(COIN_KEY); if (COINS[saved]) coin = saved; } catch (e) {}
  document.documentElement.setAttribute("data-coin", coin);
  function cid(c) { return COINS[c] ? c : coin; }
  window.TNC_Coin = {
    list: ["btc", "bch"],
    get: function () { return coin; },
    set: function (c) {
      if (!COINS[c] || c === coin) return;
      try { localStorage.setItem(COIN_KEY, c); } catch (e) {}
      coin = c;
      document.documentElement.setAttribute("data-coin", c);
      location.reload();
    },
    // Used when the server has a coin off: show the other one without remembering it.
    fallback: function (c) { if (COINS[c]) { coin = c; document.documentElement.setAttribute("data-coin", c); } },
    info: function (c) {
      var i = COINS[cid(c)];
      return Object.assign({ explorerTx: function (txid) { return i.tx + encodeURIComponent(txid); } }, i);
    },
    ticker: function (c) { return COINS[cid(c)].ticker; },
    is: function (c) { return !!COINS[c]; }
  };

  function unit(c) { return COINS[cid(c)].ticker + " sats"; }

  // Page text that names the selected coin: [data-coin-name] "tBTC", [data-coin-name-long]
  // "Bitcoin Testnet4", [data-coin-unit] "tBTC sats"; [data-coin-show="btc"] shows only for that coin.
  function fillCoin() {
    var i = COINS[coin];
    document.querySelectorAll("[data-coin-name]").forEach(function (n) { n.textContent = i.ticker; });
    document.querySelectorAll("[data-coin-name-long]").forEach(function (n) { n.textContent = i.name; });
    document.querySelectorAll("[data-coin-unit]").forEach(function (n) { n.textContent = unit(); });
    document.querySelectorAll("[data-coin-show]").forEach(function (n) { n.hidden = n.getAttribute("data-coin-show") !== coin; });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fillCoin); else fillCoin();
  function sats(n, c) { return ok(n) ? int(Math.round(n)) + " " + unit(c) : "n/a"; }
  function sats_(n) { return sats(n); }
  window.TNC_Units = {
    unit: unit,
    bch: function (sats) { return ok(sats) ? bch(sats) : "n/a"; },
    coins: function (sats, c) { return ok(sats) ? bch(sats) + " " + COINS[cid(c)].ticker : "n/a"; },
    int: function (n) { return ok(n) ? int(Math.round(n)) : "n/a"; },
    format: sats,
    short: sats,
    round4: function (sats, c) {
      if (!ok(sats)) return "n/a";
      var u = Math.round(sats / 10000), neg = u < 0, s = String(Math.abs(u));   // 1 unit = 0.0001 coin
      while (s.length < 5) s = "0" + s;
      return (neg ? "-" : "") + int(s.slice(0, -4)) + "." + s.slice(-4) + " " + COINS[cid(c)].ticker;
    },
    round2: function (sats, c) {
      if (!ok(sats)) return "n/a";
      var cents = Math.round(sats / 1000000), neg = cents < 0, s = String(Math.abs(cents));   // 1 cent = 0.01 coin
      while (s.length < 3) s = "0" + s;
      return (neg ? "-" : "") + int(s.slice(0, -2)) + "." + s.slice(-2) + " " + COINS[cid(c)].ticker;
    },
    parse: function (text) {
      var m = /^\s*(\d{1,16})\s*$/.exec(String(text).replace(/[,\s_]/g, ""));
      if (!m) return null;
      var n = parseInt(m[1], 10);
      return n > 2100000000000000 ? null : n;
    },
    game: {
      unit: function () { return unit(); },
      value: function (sats) { return ok(sats) ? int(sats) : "n/a"; },
      format: function (sats) { return sats_(sats); }
    }
  };
})();
