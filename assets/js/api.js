/*
 * TestnetCasino.com: API client. The ONLY place that knows endpoint paths.
 * Contract: testnetcasino-service docs/API.md.
 *
 * Every method resolves to { status, data } and never throws:
 *   status  HTTP status (0 = network error or timeout)
 *   data    parsed JSON body, or null (e.g. 204)
 * Error bodies are { error, message }; TNC_API.errorText(r) gives the text
 * to show the player.
 *
 * Calls use credentials: "include" (the session is the HttpOnly cookie
 * __Host-session) and the header "X-Requested-With: tnc" (required on every
 * POST). No token or user data is ever stored by the frontend.
 *
 * Coins (D46): every call that moves or shows money takes `coin` ("btc" or "bch"); left out it is
 * the coin selected in the header (TNC_Coin). The server treats a missing coin as tBCH.
 */
(function () {
  "use strict";

  var cfg = window.TNC_CONFIG || { apiBase: "" };
  var BASE = cfg.apiBase.replace(/\/$/, "");
  var TIMEOUT_MS = 20000;

  var PATHS = {
    me: "/me",
    logout: "/auth/logout",
    walletChallenge: "/auth/wallet/challenge",
    walletVerify: "/auth/wallet/verify",
    passkeyRegisterOptions: "/auth/passkey/register/options",
    passkeyRegisterVerify: "/auth/passkey/register/verify",
    passkeyLoginOptions: "/auth/passkey/login/options",
    passkeyLoginVerify: "/auth/passkey/login/verify",
    bonusDaily: "/bonus/daily",
    faucet: "/faucet",
    leaderboards: "/leaderboards",
    jackpots: "/jackpots",
    faucetWithdrawals: "/faucet/withdrawals",
    gameConfig: "/games/",          // + id + "/config"
    fairnessSeed: "/fairness/seed",
    fairnessClientSeed: "/fairness/client-seed",
    fairnessRotate: "/fairness/rotate",
    spins: "/spins",
    ledger: "/ledger",
    withdrawals: "/withdrawals",
    rouletteState: "/roulette/state",
    rouletteBets: "/roulette/bets",
    rouletteClear: "/roulette/bets/clear",
    rouletteRounds: "/roulette/rounds",   // + "/" + id for one round
    rouletteSocket: "/roulette/ws",
    withdrawalAddressChallenge: "/account/withdrawal-address/challenge",
    withdrawalAddress: "/account/withdrawal-address"
  };

  function coinOf(c) { return c || (window.TNC_Coin ? window.TNC_Coin.get() : "bch"); }
  function q(path, params) {
    var parts = [];
    Object.keys(params).forEach(function (k) { if (params[k] != null && params[k] !== "") parts.push(k + "=" + encodeURIComponent(params[k])); });
    return parts.length ? path + "?" + parts.join("&") : path;
  }

  function request(method, path, body, opts) {
    opts = opts || {};
    var headers = { "Accept": "application/json" };
    // Public GETs stay "simple" requests (no preflight); everything else
    // carries the CSRF header.
    if (!opts.public) headers["X-Requested-With"] = "tnc";
    if (body !== undefined) headers["Content-Type"] = "application/json";
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, opts.timeout || TIMEOUT_MS) : null;
    return fetch(BASE + path, {
      method: method,
      credentials: opts.public ? "omit" : "include",
      cache: "no-store",
      headers: headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      clearTimeout(timer);
      if (res.status === 204) return { status: 204, data: null };
      var type = res.headers.get("Content-Type") || "";
      if (type.indexOf("json") === -1) return { status: res.status, data: null };
      return res.json().then(function (data) { return { status: res.status, data: data }; },
                             function () { return { status: res.status, data: null }; });
    }, function () {
      clearTimeout(timer);
      return { status: 0, data: { error: "network" } };
    });
  }

  function get(path, opts) { return request("GET", path, undefined, opts); }
  function post(path, body) { return request("POST", path, body); }
  function withCursor(path, cursor) { return cursor ? path + "?cursor=" + encodeURIComponent(cursor) : path; }

  var NETWORK = "Cannot reach the server. Check your connection and try again.";
  var GENERIC = "Something went wrong. Please try again.";

  window.TNC_API = {
    // Text to show for a failed call: the server's message when it sent one.
    errorText: function (r, fallback) {
      if (!r || r.status === 0) return NETWORK;
      if (r.data && typeof r.data.message === "string" && r.data.message) return r.data.message;
      return fallback || GENERIC;
    },
    errorCode: function (r) { return (r && r.data && r.data.error) || null; },

    /* Account */
    me: function () { return get(PATHS.me); },
    logout: function () { return post(PATHS.logout); },
    walletChallenge: function (address) { return post(PATHS.walletChallenge, { address: address }); },
    walletVerify: function (address, nonce, signature) {
      return post(PATHS.walletVerify, { address: address, nonce: nonce, signature: signature });
    },
    passkeyRegisterOptions: function () { return post(PATHS.passkeyRegisterOptions); },
    passkeyRegisterVerify: function (credential) { return post(PATHS.passkeyRegisterVerify, { credential: credential }); },
    passkeyLoginOptions: function () { return post(PATHS.passkeyLoginOptions); },
    passkeyLoginVerify: function (credential) { return post(PATHS.passkeyLoginVerify, { credential: credential }); },
    claimDailyBonus: function (coin) { return post(q(PATHS.bonusDaily, { coin: coinOf(coin) })); },
    // Save a default withdrawal address in a coin (the address decides the coin), with a signed message.
    withdrawalAddressChallenge: function (address) { return post(PATHS.withdrawalAddressChallenge, { address: address }); },
    saveWithdrawalAddress: function (address, nonce, signature) {
      return post(PATHS.withdrawalAddress, { address: address, nonce: nonce, signature: signature });
    },

    /* Public */
    faucet: function () { return get(PATHS.faucet, { public: true }); },
    // Public, but sent with the session cookie so the player's own rows come back with `me: true`.
    leaderboards: function (coin) { return get(q(PATHS.leaderboards, { coin: coinOf(coin) })); },
    // Jackpot meters of a coin: { coin, grand, games: { gameId: { minor, major, collector } }, recentWins, updatedAt } (public).
    jackpots: function (coin) { return get(q(PATHS.jackpots, { coin: coinOf(coin) }), { public: true }); },
    // Every withdrawal the faucet has sent in a coin (public, 50 per page, newest first; coin "all" = every coin).
    faucetWithdrawals: function (cursor, coin) {
      return get(q(PATHS.faucetWithdrawals, { coin: coin === "all" ? null : coinOf(coin), cursor: cursor }), { public: true });
    },
    gameConfig: function (id) { return get(PATHS.gameConfig + encodeURIComponent(id) + "/config", { public: true }); },

    /* Games and fairness */
    fairnessSeed: function () { return get(PATHS.fairnessSeed); },
    setClientSeed: function (clientSeed) { return post(PATHS.fairnessClientSeed, { clientSeed: clientSeed }); },
    rotateSeed: function () { return post(PATHS.fairnessRotate); },
    // stake (D47): { lines, lineBet } (a spin costs lineBet × lines; `bet` is not sent), or a number: the total bet
    // of the API before D47 (played at 10 lines).
    spin: function (gameId, stake, requestId, coin) {
      var body = { gameId: gameId, coin: coinOf(coin), requestId: requestId };
      if (typeof stake === "number") body.bet = stake; else { body.lines = stake.lines; body.lineBet = stake.lineBet; }
      return post(PATHS.spins, body);
    },
    spinHistory: function (cursor) { return get(withCursor(PATHS.spins, cursor)); },
    ledger: function (cursor, coin) { return get(q(PATHS.ledger, { coin: coinOf(coin), cursor: cursor })); },

    /* Roulette (D44): one global table; live updates over the WebSocket at rouletteSocketUrl() */
    // The table as the "table" message: with the session also canBet and you.
    rouletteState: function () { return get(PATHS.rouletteState); },
    // bets: [{ type, numbers?, amount }]; requestId: unique per placement (repeating it places nothing more).
    rouletteBet: function (roundId, requestId, bets, coin) { return post(PATHS.rouletteBets, { roundId: roundId, requestId: requestId, coin: coinOf(coin), bets: bets }); },
    rouletteClear: function (roundId, coin) { return post(PATHS.rouletteClear, { roundId: roundId, coin: coinOf(coin) }); },
    rouletteRounds: function (cursor) { return get(withCursor(PATHS.rouletteRounds, cursor), { public: true }); },
    rouletteRound: function (id) { return get(PATHS.rouletteRounds + "/" + encodeURIComponent(id), { public: true }); },
    rouletteSocketUrl: function () { return BASE.replace(/^http/, "ws") + PATHS.rouletteSocket; },

    /* Withdrawals */
    // address: any Testnet4 address of the coin; omitted = the account's default in that coin.
    withdraw: function (amount, address, coin) {
      var body = { coin: coinOf(coin), amount: amount };
      if (address) body.address = address;
      return post(PATHS.withdrawals, body);
    },
    withdrawals: function () { return get(PATHS.withdrawals); }
  };
})();
