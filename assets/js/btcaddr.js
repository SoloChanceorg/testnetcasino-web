/*
 * TestnetCasino.com: Bitcoin Testnet4 address checks (no dependencies), and one entry point for
 * the addresses of both coins (D46).
 *
 *   tb1q...  bech32,  witness version 0: 20 bytes P2WPKH (can sign), 32 bytes P2WSH (script)
 *   tb1p...  bech32m, witness version 1: 32 bytes taproot (can sign, BIP-322)
 *   m... n.. base58check, version 0x6f: legacy P2PKH (can sign)
 *   2...     base58check, version 0xc4: P2SH (script: cannot sign)
 * Mainnet (bc1..., 1..., 3...) and other networks are refused with a reason.
 *
 * TNC_Address (both coins; the address decides the coin):
 *   check(input, { coin?, login? })  -> { ok: true, coin, address } or { ok: false, code, message }
 *     coin:  only accept that coin's addresses (withdrawals, saved addresses)
 *     login: only addresses that can sign a message (sign-in, saved addresses)
 *   coinOf(address)                  -> "btc" | "bch" | null (a quick look at the format)
 *   short(address)                   -> "tb1qxy...k2m9" / "bchtest:qz8f...4k2m"
 * The server's answer always counts; these checks only catch typos early.
 */
(function (root) {
  "use strict";

  /* ═══ bech32 / bech32m (BIP-173, BIP-350) ═══ */
  var CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  var GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  var BECH32 = 1, BECH32M = 0x2bc830a3;
  function polymod(values) {
    var chk = 1;
    for (var i = 0; i < values.length; i++) {
      var top = chk >>> 25;
      chk = ((chk & 0x1ffffff) << 5) ^ values[i];
      for (var j = 0; j < 5; j++) if ((top >>> j) & 1) chk ^= GEN[j];
    }
    return chk >>> 0;
  }
  function hrpExpand(hrp) {
    var out = [], i;
    for (i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >> 5);
    out.push(0);
    for (i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
    return out;
  }
  function bechDecode(str) {
    if (str !== str.toLowerCase() && str !== str.toUpperCase()) return { error: "mixed_case" };
    str = str.toLowerCase();
    var pos = str.lastIndexOf("1");
    if (pos < 1 || pos + 7 > str.length || str.length > 90) return { error: "invalid" };
    var hrp = str.slice(0, pos), data = [];
    for (var i = pos + 1; i < str.length; i++) {
      var d = CHARSET.indexOf(str[i]);
      if (d === -1) return { error: "invalid" };
      data.push(d);
    }
    var c = polymod(hrpExpand(hrp).concat(data));
    var enc = c === BECH32 ? BECH32 : c === BECH32M ? BECH32M : 0;
    if (!enc) return { error: "checksum", hrp: hrp };
    return { hrp: hrp, data: data.slice(0, -6), enc: enc, str: str };
  }
  function convertBits(data, from, to) {
    var acc = 0, bits = 0, out = [], maxv = (1 << to) - 1;
    for (var i = 0; i < data.length; i++) {
      acc = (acc << from) | data[i]; bits += from;
      while (bits >= to) { bits -= to; out.push((acc >> bits) & maxv); }
    }
    if (bits >= from || ((acc << (to - bits)) & maxv)) return null;
    return out;
  }
  // Segwit address -> { version, program } or { error }
  function segwit(str) {
    var d = bechDecode(str);
    if (d.error) return d;
    if (!d.data.length) return { error: "invalid", hrp: d.hrp };
    var ver = d.data[0], prog = convertBits(d.data.slice(1), 5, 8);
    if (!prog || prog.length < 2 || prog.length > 40 || ver > 16) return { error: "invalid", hrp: d.hrp };
    if (ver === 0 && prog.length !== 20 && prog.length !== 32) return { error: "invalid", hrp: d.hrp };
    if ((ver === 0) !== (d.enc === BECH32)) return { error: "checksum", hrp: d.hrp };
    return { hrp: d.hrp, version: ver, program: prog, address: d.str };
  }

  /* ═══ base58check ═══ */
  var B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  function b58decode(s) {
    var bytes = [0];
    for (var i = 0; i < s.length; i++) {
      var v = B58.indexOf(s[i]);
      if (v < 0) return null;
      for (var j = 0; j < bytes.length; j++) { v += bytes[j] * 58; bytes[j] = v & 0xff; v >>= 8; }
      while (v) { bytes.push(v & 0xff); v >>= 8; }
    }
    for (var k = 0; k < s.length && s[k] === "1"; k++) bytes.push(0);
    return bytes.reverse();
  }
  // SHA-256 (synchronous, for the base58 checksum only)
  var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
    0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
    0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70,
    0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  function sha256(msg) {
    var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var l = msg.length, m = msg.slice(), i;
    m.push(0x80);
    while (m.length % 64 !== 56) m.push(0);
    var bits = l * 8;
    for (i = 7; i >= 0; i--) m.push(i >= 4 ? 0 : (bits >>> (i * 8)) & 0xff);
    var w = new Array(64);
    for (var o = 0; o < m.length; o += 64) {
      for (i = 0; i < 16; i++) w[i] = (m[o + 4 * i] << 24) | (m[o + 4 * i + 1] << 16) | (m[o + 4 * i + 2] << 8) | m[o + 4 * i + 3];
      for (i = 16; i < 64; i++) {
        var a = w[i - 15], b = w[i - 2];
        var s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
        var s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var A = h[0], B = h[1], C = h[2], D = h[3], E = h[4], F = h[5], G = h[6], H = h[7];
      for (i = 0; i < 64; i++) {
        var S1 = ((E >>> 6) | (E << 26)) ^ ((E >>> 11) | (E << 21)) ^ ((E >>> 25) | (E << 7));
        var t1 = (H + S1 + ((E & F) ^ (~E & G)) + K[i] + w[i]) | 0;
        var S0 = ((A >>> 2) | (A << 30)) ^ ((A >>> 13) | (A << 19)) ^ ((A >>> 22) | (A << 10));
        var t2 = (S0 + ((A & B) ^ (A & C) ^ (B & C))) | 0;
        H = G; G = F; F = E; E = (D + t1) | 0; D = C; C = B; B = A; A = (t1 + t2) | 0;
      }
      h = [h[0] + A, h[1] + B, h[2] + C, h[3] + D, h[4] + E, h[5] + F, h[6] + G, h[7] + H].map(function (x) { return x | 0; });
    }
    var out = [];
    h.forEach(function (x) { out.push((x >>> 24) & 0xff, (x >>> 16) & 0xff, (x >>> 8) & 0xff, x & 0xff); });
    return out;
  }
  // -> { version, hash } or null
  function base58check(s) {
    var b = b58decode(s);
    if (!b || b.length !== 25) return null;
    var body = b.slice(0, 21), sum = sha256(sha256(body)).slice(0, 4);
    for (var i = 0; i < 4; i++) if (sum[i] !== b[21 + i]) return { error: "checksum" };
    return { version: body[0] };
  }

  /* ═══ Bitcoin Testnet4 ═══ */
  var MESSAGES = {
    empty: "Enter your Testnet4 address: bchtest:q... (Bitcoin Cash) or tb1... (Bitcoin).",
    btc_mainnet: "That is a Bitcoin mainnet address. Use a Bitcoin Testnet4 address (tb1..., m..., n...).",
    btc_checksum: "This address has a typo. Copy it again from your wallet.",
    btc_script: "Script addresses (2..., or a tb1q... of 62 characters) cannot sign messages. Use a tb1q..., tb1p..., m... or n... address.",
    btc_invalid: "That is not a valid Bitcoin Testnet4 address. It starts with tb1, m, n or 2.",
    btc_other_network: "That address is not for Bitcoin Testnet4. Use a tb1... address.",
    btc_unsupported: "That kind of Bitcoin address is not supported. Use a tb1q..., tb1p..., m... or n... address.",
    wrong_coin_bch: "That is a Bitcoin Testnet4 address. Enter a Bitcoin Cash Testnet4 address (bchtest:q...).",
    wrong_coin_btc: "That is a Bitcoin Cash Testnet4 address. Enter a Bitcoin Testnet4 address (tb1..., m..., n..., 2...)."
  };
  function no(code) { return { ok: false, code: code, message: MESSAGES[code] }; }

  // A Bitcoin-looking input (bech32 with a "bc"/"tb"/"bcrt" prefix, or base58 starting 1, 3, m, n or 2).
  function looksBtc(s) { return /^(tb|bc|bcrt)1/i.test(s) || /^[13mn2][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(s); }

  function checkBtc(input, login) {
    var s = String(input || "").trim().replace(/\s+/g, "");
    if (!s) return no("empty");
    if (/^(tb|bc|bcrt)1/i.test(s)) {
      var sw = segwit(s);
      if (sw.error) {
        if (sw.hrp === "bc") return no("btc_mainnet");
        if (sw.hrp && sw.hrp !== "tb") return no("btc_other_network");
        return no(sw.error === "checksum" || sw.error === "mixed_case" ? "btc_checksum" : "btc_invalid");
      }
      if (sw.hrp === "bc") return no("btc_mainnet");
      if (sw.hrp !== "tb") return no("btc_other_network");
      if (sw.version === 0 && sw.program.length === 32 && login) return no("btc_script");
      if (sw.version > 1 || (sw.version === 1 && sw.program.length !== 32)) return no("btc_unsupported");
      return { ok: true, coin: "btc", address: sw.address };
    }
    var b = base58check(s);
    if (!b) return no("btc_invalid");
    if (b.error) return no("btc_checksum");
    if (b.version === 0x00 || b.version === 0x05) return no("btc_mainnet");
    if (b.version === 0xc4) return login ? no("btc_script") : { ok: true, coin: "btc", address: s };
    if (b.version === 0x6f) return { ok: true, coin: "btc", address: s };
    return no("btc_other_network");
  }

  /* ═══ Both coins ═══ */
  function coinOf(addr) {
    var s = String(addr || "").trim();
    if (!s) return null;
    if (looksBtc(s)) return "btc";
    return "bch";
  }
  function check(input, opts) {
    opts = opts || {};
    var s = String(input || "").trim().replace(/\s+/g, "");
    if (!s) return { ok: false, code: "empty", message: opts.coin === "bch" ? "Enter a Bitcoin Cash Testnet4 address (bchtest:q...)."
      : opts.coin === "btc" ? "Enter a Bitcoin Testnet4 address (tb1..., m..., n...)." : MESSAGES.empty };
    var c = coinOf(s);
    if (opts.coin && c !== opts.coin) {
      // A legacy-looking input with coin bch is a BCH legacy address: let CashAddr explain it.
      if (opts.coin === "bch" && /^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(s)) c = "bch";
      else return no(opts.coin === "bch" ? "wrong_coin_bch" : "wrong_coin_btc");
    }
    if (c === "btc") return checkBtc(s, opts.login);
    var CA = root.TNC_CashAddr;
    if (!CA) return { ok: true, coin: "bch", address: s.toLowerCase() };
    var r = CA.checkTestnetLogin(s);
    return r.ok ? { ok: true, coin: "bch", address: r.address } : r;
  }
  function short(addr) {
    var p = String(addr).split(":"), body = p[p.length - 1];
    return (p.length > 1 ? p[0] + ":" : "") + body.slice(0, p.length > 1 ? 4 : 6) + "..." + body.slice(-4);
  }

  var api = { check: check, checkBtc: checkBtc, coinOf: coinOf, short: short, MESSAGES: MESSAGES, sha256: sha256 };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TNC_Address = api;
})(typeof window !== "undefined" ? window : this);
