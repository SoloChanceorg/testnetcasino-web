/*
 * TestnetCasino.com: API client. The ONLY place that knows endpoint paths.
 *
 * Every method resolves to { status, data }:
 *   status  HTTP status (0 = network error, never throws)
 *   data    parsed JSON body, or null (e.g. 204)
 *
 * Real mode: fetch(TNC_CONFIG.apiBase + path) with credentials: "include"
 * (the backend sets an HttpOnly session cookie) and the header
 * "X-Requested-With: tnc". No token is ever stored by the frontend.
 *
 * Mock mode (TNC_CONFIG.mock): answers locally after 300 to 700 ms. See the
 * MOCK section below. It keeps a FAKE session in sessionStorage; this exists
 * only for the mock and must never be used with the real backend.
 */
(function () {
  "use strict";

  var cfg = window.TNC_CONFIG || { apiBase: "", mock: true };

  var PATHS = {
    me: "/me",
    logout: "/auth/logout",
    walletChallenge: "/auth/wallet/challenge",
    walletVerify: "/auth/wallet/verify",
    passkeyRegisterOptions: "/auth/passkey/register/options",
    passkeyRegisterVerify: "/auth/passkey/register/verify",
    passkeyLoginOptions: "/auth/passkey/login/options",
    passkeyLoginVerify: "/auth/passkey/login/verify"
  };

  /* ═══════════════ Real backend ═══════════════ */
  function request(method, path, body) {
    var headers = { "X-Requested-With": "tnc", "Accept": "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    return fetch(cfg.apiBase.replace(/\/$/, "") + path, {
      method: method,
      credentials: "include",
      headers: headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    }).then(function (res) {
      if (res.status === 204) return { status: 204, data: null };
      var type = res.headers.get("Content-Type") || "";
      if (type.indexOf("json") === -1) return { status: res.status, data: null };
      return res.json().then(function (data) { return { status: res.status, data: data }; },
                             function () { return { status: res.status, data: null }; });
    }, function () {
      return { status: 0, data: { error: "network" } };
    });
  }

  /* ═══════════════ MOCK (no backend) ═══════════════ */
  // MOCK ONLY: fake session + issued challenges in sessionStorage. The real
  // backend keeps the session in an HttpOnly cookie the frontend cannot read.
  var MOCK_SESSION = "tnc.mock.session";
  var MOCK_CHALLENGES = "tnc.mock.challenges";

  function mockGet(k, d) { try { var v = sessionStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function mockSet(k, v) { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function delay() { return 300 + Math.floor(Math.random() * 401); }
  function reply(status, data) {
    return new Promise(function (resolve) { setTimeout(function () { resolve({ status: status, data: data }); }, delay()); });
  }
  function randHex(n) {
    var b = new Uint8Array(Math.ceil(n / 2)); crypto.getRandomValues(b);
    return Array.from(b, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("").slice(0, n);
  }
  function randB64url(bytes) {
    var b = new Uint8Array(bytes); crypto.getRandomValues(b);
    return btoa(String.fromCharCode.apply(null, b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function mockUser(extra) { return Object.assign({ id: "mock-" + randHex(8) }, extra); }
  function signIn(user) { mockSet(MOCK_SESSION, user); return reply(200, { user: user }); }

  var mock = {
    me: function () {
      var u = mockGet(MOCK_SESSION, null);
      return u ? reply(200, { user: u }) : reply(401, { error: "unauthorized" });
    },
    logout: function () { mockSet(MOCK_SESSION, null); return reply(204, null); },

    walletChallenge: function (body) {
      var nonce = randHex(10), now = new Date(), exp = new Date(now.getTime() + 5 * 60 * 1000);
      var message = "testnetcasino.com sign-in | " + body.address + " | nonce " + nonce +
        " | issued " + now.toISOString() + " | expires " + exp.toISOString();
      var all = mockGet(MOCK_CHALLENGES, {});
      all[nonce] = { address: body.address, expiresAt: exp.toISOString(), used: false };
      mockSet(MOCK_CHALLENGES, all);
      return reply(200, { message: message, nonce: nonce, expiresAt: exp.toISOString() });
    },
    walletVerify: function (body) {
      var all = mockGet(MOCK_CHALLENGES, {}), ch = all[body.nonce];
      var sig = String(body.signature || "");
      // Mock rules: base64 of 80+ chars passes; anything starting with "bad" fails.
      if (!ch || ch.address !== body.address) return reply(401, { error: "invalid_signature" });
      if (ch.used) return reply(401, { error: "challenge_used" });
      if (Date.now() > Date.parse(ch.expiresAt)) return reply(401, { error: "challenge_expired" });
      if (sig.indexOf("bad") === 0 || sig.length < 80 || !/^[A-Za-z0-9+/]+={0,2}$/.test(sig)) return reply(401, { error: "invalid_signature" });
      ch.used = true;
      mockSet(MOCK_CHALLENGES, all);
      return signIn(mockUser({ method: "wallet", address: body.address }));
    },

    passkeyRegisterOptions: function () {
      return reply(200, {
        challenge: randB64url(32),
        rp: { name: "TestnetCasino.com", id: location.hostname },
        user: { id: randB64url(16), name: "player-" + randHex(6), displayName: "TestnetCasino player" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        timeout: 60000,
        attestation: "none",
        authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
        excludeCredentials: []
      });
    },
    passkeyRegisterVerify: function () { return signIn(mockUser({ method: "passkey" })); },
    passkeyLoginOptions: function () {
      return reply(200, { challenge: randB64url(32), rpId: location.hostname, timeout: 60000, userVerification: "preferred", allowCredentials: [] });
    },
    passkeyLoginVerify: function () { return signIn(mockUser({ method: "passkey" })); }
  };

  /* ═══════════════ Public API ═══════════════ */
  function pick(name, method, path, body) {
    return cfg.mock ? mock[name](body || {}) : request(method, path, body);
  }

  window.TNC_API = {
    isMock: !!cfg.mock,
    me: function () { return pick("me", "GET", PATHS.me); },
    logout: function () { return pick("logout", "POST", PATHS.logout); },
    walletChallenge: function (address) { return pick("walletChallenge", "POST", PATHS.walletChallenge, { address: address }); },
    walletVerify: function (address, nonce, signature) {
      return pick("walletVerify", "POST", PATHS.walletVerify, { address: address, nonce: nonce, signature: signature });
    },
    passkeyRegisterOptions: function () { return pick("passkeyRegisterOptions", "POST", PATHS.passkeyRegisterOptions); },
    passkeyRegisterVerify: function (credential) { return pick("passkeyRegisterVerify", "POST", PATHS.passkeyRegisterVerify, { credential: credential }); },
    passkeyLoginOptions: function () { return pick("passkeyLoginOptions", "POST", PATHS.passkeyLoginOptions); },
    passkeyLoginVerify: function (credential) { return pick("passkeyLoginVerify", "POST", PATHS.passkeyLoginVerify, { credential: credential }); }
  };
})();
