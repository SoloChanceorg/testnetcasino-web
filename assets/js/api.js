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
    rouletteSocket: "/roulette/ws"
  };

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
    claimDailyBonus: function () { return post(PATHS.bonusDaily); },

    /* Public */
    faucet: function () { return get(PATHS.faucet, { public: true }); },
    // Public, but sent with the session cookie so the player's own rows come back with `me: true`.
    leaderboards: function () { return get(PATHS.leaderboards); },
    // Jackpot meters: { grand: { fill, cycle, seedHash }, games: { gameId: { minor, major } }, recentWins, updatedAt } (public).
    jackpots: function () { return get(PATHS.jackpots, { public: true }); },
    // Every withdrawal the faucet has sent (public, 50 per page, newest first).
    faucetWithdrawals: function (cursor) { return get(withCursor(PATHS.faucetWithdrawals, cursor), { public: true }); },
    gameConfig: function (id) { return get(PATHS.gameConfig + encodeURIComponent(id) + "/config", { public: true }); },

    /* Games and fairness */
    fairnessSeed: function () { return get(PATHS.fairnessSeed); },
    setClientSeed: function (clientSeed) { return post(PATHS.fairnessClientSeed, { clientSeed: clientSeed }); },
    rotateSeed: function () { return post(PATHS.fairnessRotate); },
    spin: function (gameId, bet, requestId) { return post(PATHS.spins, { gameId: gameId, bet: bet, requestId: requestId }); },
    spinHistory: function (cursor) { return get(withCursor(PATHS.spins, cursor)); },
    ledger: function (cursor) { return get(withCursor(PATHS.ledger, cursor)); },

    /* Roulette (D44): one global table; live updates over the WebSocket at rouletteSocketUrl() */
    // The table as the "table" message: with the session also canBet and you.
    rouletteState: function () { return get(PATHS.rouletteState); },
    // bets: [{ type, numbers?, amount }]; requestId: unique per placement (repeating it places nothing more).
    rouletteBet: function (roundId, requestId, bets) { return post(PATHS.rouletteBets, { roundId: roundId, requestId: requestId, bets: bets }); },
    rouletteClear: function (roundId) { return post(PATHS.rouletteClear, { roundId: roundId }); },
    rouletteRounds: function (cursor) { return get(withCursor(PATHS.rouletteRounds, cursor), { public: true }); },
    rouletteRound: function (id) { return get(PATHS.rouletteRounds + "/" + encodeURIComponent(id), { public: true }); },
    rouletteSocketUrl: function () { return BASE.replace(/^http/, "ws") + PATHS.rouletteSocket; },

    /* Withdrawals */
    // address: any Bitcoin Cash Testnet4 address; omitted = the account's default (wallet: sign-in address).
    withdraw: function (amount, address) {
      var body = { amount: amount };
      if (address) body.address = address;
      return post(PATHS.withdrawals, body);
    },
    withdrawals: function () { return get(PATHS.withdrawals); }
  };
})();
