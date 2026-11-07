/*
 * TestnetCasino.com: CashAddr decoding and validation (no dependencies).
 *
 * Implements the CashAddr format (BCH spec "cashaddr.md"):
 *   prefix ":" payload, payload in base32 with a 40-bit BCH checksum (polymod).
 * The payload decodes to a version byte + hash:
 *   version >> 3 = type: 0 P2PKH, 1 P2SH, 2 P2PKH with tokens, 3 P2SH with tokens
 *   version & 7  = hash size (0 = 160 bits)
 *
 * TNC_CashAddr.checkTestnetLogin(input) is what the sign-in form uses: it
 * normalizes the input and only accepts Testnet4 P2PKH ("bchtest:q...")
 * addresses, because only those can sign messages.
 */
(function (root) {
  "use strict";

  var CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  var GEN = [0x98f2bc8e61n, 0x79b76d99e2n, 0xf33e5fb3c4n, 0xae2eabe2a8n, 0x1e4f43e470n];
  var TYPES = { 0: "p2pkh", 1: "p2sh", 2: "p2pkh-token", 3: "p2sh-token" };
  var SIZES = [20, 24, 28, 32, 40, 48, 56, 64];

  function polymod(values) {
    var c = 1n;
    for (var i = 0; i < values.length; i++) {
      var c0 = c >> 35n;
      c = ((c & 0x07ffffffffn) << 5n) ^ BigInt(values[i]);
      for (var j = 0; j < 5; j++) if ((c0 >> BigInt(j)) & 1n) c ^= GEN[j];
    }
    return c ^ 1n;
  }
  function prefixData(prefix) {
    var out = [];
    for (var i = 0; i < prefix.length; i++) out.push(prefix.charCodeAt(i) & 31);
    out.push(0);
    return out;
  }
  function convertBits(data, from, to, pad) {
    var acc = 0, bits = 0, out = [], maxv = (1 << to) - 1;
    for (var i = 0; i < data.length; i++) {
      acc = (acc << from) | data[i];
      bits += from;
      while (bits >= to) { bits -= to; out.push((acc >> bits) & maxv); }
    }
    if (pad) { if (bits > 0) out.push((acc << (to - bits)) & maxv); }
    else if (bits >= from || ((acc << (to - bits)) & maxv)) return null;
    return out;
  }

  function fail(code) { var e = new Error(code); e.code = code; throw e; }

  /** Decode "prefix:payload". Throws an Error with .code on any problem. */
  function decode(addr) {
    if (typeof addr !== "string" || addr.indexOf(":") === -1) fail("no_prefix");
    if (addr !== addr.toLowerCase() && addr !== addr.toUpperCase()) fail("mixed_case");
    addr = addr.toLowerCase();
    var parts = addr.split(":");
    if (parts.length !== 2 || !parts[0] || !parts[1]) fail("format");
    var prefix = parts[0], payload = parts[1], data = [];
    for (var i = 0; i < payload.length; i++) {
      var v = CHARSET.indexOf(payload[i]);
      if (v === -1) fail("bad_char");
      data.push(v);
    }
    if (data.length < 9) fail("format");
    if (polymod(prefixData(prefix).concat(data)) !== 0n) fail("checksum");
    var bytes = convertBits(data.slice(0, -8), 5, 8, false);
    if (!bytes || !bytes.length) fail("format");
    var version = bytes[0], hash = bytes.slice(1);
    if (version & 0x80) fail("format");
    var type = TYPES[(version >> 3) & 0x0f];
    if (!type || hash.length !== SIZES[version & 7]) fail("format");
    return { prefix: prefix, version: version, type: type, hash: new Uint8Array(hash), address: prefix + ":" + payload };
  }

  /** Encode (used by tests and the mock API). */
  function encode(prefix, version, hash) {
    var payload = convertBits([version].concat(Array.from(hash)), 8, 5, true);
    var mod = polymod(prefixData(prefix).concat(payload, [0, 0, 0, 0, 0, 0, 0, 0]));
    var checksum = [];
    for (var i = 0; i < 8; i++) checksum.push(Number((mod >> BigInt(5 * (7 - i))) & 31n));
    return prefix + ":" + payload.concat(checksum).map(function (d) { return CHARSET[d]; }).join("");
  }

  function isValid(addr) { try { decode(addr); return true; } catch (e) { return false; } }

  var MESSAGES = {
    mainnet: "That is a mainnet address. Use a Testnet4 address (bchtest:q...).",
    script: "Script addresses cannot sign messages. Use a bchtest:q... address.",
    token: "Use the regular bchtest:q... address of the same wallet.",
    checksum: "This address has a typo. Copy it again from your wallet.",
    legacy: "That is a legacy address. Use the CashAddr format of your wallet (bchtest:q...).",
    other_network: "That address is not for Testnet4. Use a bchtest:q... address.",
    empty: "Enter your Testnet4 address.",
    invalid: "That is not a valid Testnet4 address. It starts with bchtest:q..."
  };

  /**
   * Normalize and validate a sign-in address.
   * Returns { ok: true, address } or { ok: false, code, message }.
   */
  function checkTestnetLogin(input) {
    var s = String(input || "").trim().toLowerCase().replace(/\s+/g, "");
    function no(code) { return { ok: false, code: code, message: MESSAGES[code] }; }
    if (!s) return no("empty");
    if (/^bitcoincash:/.test(s)) return no("mainnet");
    if (/^[123mn][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(String(input).trim())) return no("legacy");   // Base58 legacy
    if (s.indexOf(":") !== -1 && s.indexOf("bchtest:") !== 0) return no("other_network");
    var full = s.indexOf("bchtest:") === 0 ? s : "bchtest:" + s;
    var dec;
    try {
      dec = decode(full);
    } catch (e) {
      // A prefix-less mainnet address fails the bchtest checksum but passes with "bitcoincash".
      if (s.indexOf(":") === -1 && isValid("bitcoincash:" + s)) return no("mainnet");
      if (e.code === "checksum") return no("checksum");
      return no("invalid");
    }
    if (dec.type === "p2sh" || dec.type === "p2sh-token") return no("script");
    if (dec.type === "p2pkh-token") return no("token");
    return { ok: true, address: dec.address };
  }

  /** "bchtest:qz8f...4k2m" */
  function short(addr) {
    var p = String(addr).split(":"), body = p[p.length - 1];
    return (p.length > 1 ? p[0] + ":" : "") + body.slice(0, 4) + "..." + body.slice(-4);
  }

  var api = { decode: decode, encode: encode, isValid: isValid, checkTestnetLogin: checkTestnetLogin, short: short, MESSAGES: MESSAGES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TNC_CashAddr = api;
})(typeof window !== "undefined" ? window : this);
