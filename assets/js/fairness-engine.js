/*
 * TestnetCasino.com: in-browser verifier for provably fair spins.
 *
 * An independent implementation of testnetcasino-service docs/FAIRNESS.md,
 * used only to CHECK spins the server already played (it never decides one):
 *   - random stream: HMAC-SHA256(serverSeed, clientSeed:nonce:r), r = 0, 1, ...
 *     read as big-endian uint32 (crypto.subtle);
 *   - randInt(n): rejection sampling (no modulo bias);
 *   - slot rules: the same as the backend's frozen reference engine;
 *   - wins: exact BigInt arithmetic, 1 unit = 10^-7 of the bet, each item
 *     rounded to whole sats with one draw when there is a remainder.
 *
 * No DOM. Works in browsers (window.TNC_Fair) and in Node 20+ (module.exports).
 */
(function (root) {
  "use strict";

  var subtle = (root.crypto || globalThis.crypto).subtle;
  var UNITS_PER_BET = 10000000n;
  var NEED_MORE = { needMoreBlocks: true };

  /* ═══════════════ Bytes and hashes ═══════════════ */
  function hexToBytes(hex) {
    hex = String(hex).trim().toLowerCase();
    if (!/^([0-9a-f]{2})+$/.test(hex)) throw new Error("Not a hex string.");
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }
  function bytesToHex(b) {
    var s = "";
    for (var i = 0; i < b.length; i++) s += ("0" + b[i].toString(16)).slice(-2);
    return s;
  }
  /** SHA-256 of the seed's raw bytes, as hex (this is what serverSeedHash commits to). */
  function sha256Hex(hex) {
    return subtle.digest("SHA-256", hexToBytes(hex)).then(function (d) { return bytesToHex(new Uint8Array(d)); });
  }

  /* ═══════════════ Random stream ═══════════════ */
  // crypto.subtle is async and the rules are not, so the stream precomputes
  // `blocks` HMAC blocks; if a spin needs more, it throws NEED_MORE and the
  // caller runs it again with twice as many.
  function makeStream(serverSeedHex, clientSeed, nonce, blocks) {
    var enc = new TextEncoder();
    return subtle.importKey("raw", hexToBytes(serverSeedHex), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
      .then(function (key) {
        var jobs = [];
        for (var r = 0; r < blocks; r++) jobs.push(subtle.sign("HMAC", key, enc.encode(clientSeed + ":" + nonce + ":" + r)));
        return Promise.all(jobs);
      })
      .then(function (bufs) {
        var views = bufs.map(function (b) { return new DataView(b); });
        var bi = 0, off = 0;
        function next32() {
          if (off === 32) { bi++; off = 0; }
          if (bi >= views.length) throw NEED_MORE;
          var v = views[bi].getUint32(off, false);
          off += 4;
          return v;
        }
        function randInt(n) {
          var limit = Math.floor(4294967296 / n) * n;
          for (;;) { var v = next32(); if (v < limit) return v % n; }
        }
        return { next32: next32, randInt: randInt };
      });
  }

  /* ═══════════════ Slot rules (FAIRNESS.md section 3) ═══════════════ */
  function rules(game) {
    var E = game.engine, REELS = E.reels, ROWS = E.rows, PAYLINES = E.paylines;
    var MAX_RESPINS = E.maxRespins, MAX_FREE_SPINS = E.maxFreeSpins;
    var syms = game.symbols, K = { wild: -1, scatter: -1, bonus: -1 };
    syms.forEach(function (s, i) { if (s.kind) K[s.kind] = i; });
    var WILD = K.wild, SCAT = K.scatter, BONUS = K.bonus;
    function key(c, r) { return c + "," + r; }

    function weighted(randInt, weights) {
      var total = 0, i;
      for (i = 0; i < weights.length; i++) total += weights[i];
      var x = randInt(total);
      for (i = 0; i < weights.length; i++) { x -= weights[i]; if (x < 0) return i; }
      return weights.length - 1;
    }
    function makePickers(randInt) {
      var out = [];
      for (var c = 0; c < REELS; c++) {
        var ids = [], w = [];
        syms.forEach(function (s, i) { if (!s.reels || s.reels.indexOf(c) !== -1) { ids.push(i); w.push(s.weight); } });
        out.push((function (ids, w) { return function () { return ids[weighted(randInt, w)]; }; }(ids, w)));
      }
      return out;
    }
    function spinGrid(pickers, fixed) {
      var grid = [];
      for (var c = 0; c < REELS; c++) {
        var col = [];
        for (var r = 0; r < ROWS; r++) { var k = key(c, r); col.push(fixed[k] != null ? fixed[k] : pickers[c]()); }
        grid.push(col);
      }
      return grid;
    }
    function payFor(sym, count) { return count >= 3 ? (syms[sym].pays[count - 3] || 0) : 0; }

    // Lines, scatter and bonus of one phase. Pays stay paytable values here;
    // sats are computed exactly later.
    function evaluate(lineGrid, countGrid, wm) {
      var cap = (game.wildMult && game.wildMult.cap) || Infinity, lines = [];
      for (var li = 0; li < PAYLINES.length; li++) {
        var pl = PAYLINES[li], seq = [];
        for (var c = 0; c < REELS; c++) seq.push(lineGrid[c][pl[c]]);
        var wildRun = 0;
        while (wildRun < REELS && seq[wildRun] === WILD) wildRun++;
        var wildPay = payFor(WILD, wildRun);
        var base = wildRun < REELS ? seq[wildRun] : -1, symRun = 0, symPay = 0;
        if (base !== -1 && base !== SCAT && base !== BONUS) {
          symRun = wildRun;
          while (symRun < REELS && (seq[symRun] === base || seq[symRun] === WILD)) symRun++;
          symPay = payFor(base, symRun);
        }
        var best = null;
        if (symPay > 0 && symPay >= wildPay) best = { symbol: base, count: symRun };
        else if (wildPay > 0) best = { symbol: WILD, count: wildRun };
        if (best) {
          var wmul = 1;
          for (var k = 0; k < best.count; k++) if (seq[k] === WILD && wm[key(k, pl[k])]) wmul *= wm[key(k, pl[k])];
          best.line = li;
          best.wildMult = Math.min(wmul, cap);
          best.pay = (symPay > 0 && symPay >= wildPay ? symPay : wildPay) * best.wildMult;
          lines.push(best);
        }
      }
      var scat = 0, bonusReels = {};
      for (var c2 = 0; c2 < REELS; c2++) for (var r2 = 0; r2 < ROWS; r2++) {
        if (countGrid[c2][r2] === SCAT) scat++;
        if (countGrid[c2][r2] === BONUS) bonusReels[c2] = true;
      }
      var n = Math.min(scat, 5), scatter = null;
      if (n >= 3) scatter = { count: scat, pay: payFor(SCAT, n), freeSpins: game.freeSpins.awards[n - 3] || 0 };
      var pay = lines.reduce(function (s, l) { return s + l.pay; }, 0) + (scatter ? scatter.pay : 0);
      return { lines: lines, scatter: scatter, bonus: BONUS !== -1 && Object.keys(bonusReels).length >= 3, pay: pay };
    }

    // One round: the paid spin (with Lucky Respins) or one free spin.
    function round(pickers, randInt, feat) {
      var free = !!feat, fsMult = free ? feat.mult : 1, fixed = {};
      if (free && game.freeSpins.sticky) for (var sk in feat.sticky) fixed[sk] = WILD;
      var phases = [], respins = 0, award = 0, bonus = false, total = 0;
      var grid = spinGrid(pickers, fixed);
      for (;;) {
        var display = grid, wm = {};
        if (game.feature === "expand") {
          display = grid.map(function (col) { return col.indexOf(WILD) !== -1 ? [WILD, WILD, WILD] : col; });
        }
        if (game.feature === "multwild") {
          for (var c = 0; c < REELS; c++) for (var r = 0; r < ROWS; r++)
            if (grid[c][r] === WILD) wm[key(c, r)] = game.wildMult.values[weighted(randInt, game.wildMult.weights)];
        }
        var res = evaluate(display, grid, wm);
        phases.push({ grid: grid, res: res, mult: fsMult });
        total += res.pay * fsMult;
        if (res.scatter) award = Math.max(award, res.scatter.freeSpins);
        if (res.bonus) bonus = true;
        if (game.feature === "respin" && !free && respins < MAX_RESPINS) {
          var newWild = false, next = {};
          for (var c3 = 0; c3 < REELS; c3++) for (var r3 = 0; r3 < ROWS; r3++) {
            if (grid[c3][r3] === WILD) { next[key(c3, r3)] = WILD; if (fixed[key(c3, r3)] == null) newWild = true; }
          }
          if (newWild) { fixed = next; respins++; grid = spinGrid(pickers, fixed); continue; }
        }
        break;
      }
      if (free && game.freeSpins.sticky) {
        var last = phases[phases.length - 1].grid;
        for (var c4 = 0; c4 < REELS; c4++) for (var r4 = 0; r4 < ROWS; r4++) if (last[c4][r4] === WILD) feat.sticky[key(c4, r4)] = true;
      }
      return { phases: phases, freeSpins: award, bonus: bonus, pay: total };
    }

    function bonusGame(randInt) {
      var b = game.bonus;
      if (b.type === "pick") {
        var tiles = b.prizes.slice();
        for (var i = 0; i < b.collect; i++) tiles.push(0);
        for (var j = tiles.length - 1; j > 0; j--) { var x = randInt(j + 1), t = tiles[j]; tiles[j] = tiles[x]; tiles[x] = t; }
        var prize = 0, picks = 0;
        for (var p = 0; p < tiles.length; p++) { picks++; if (tiles[p] === 0) break; prize += tiles[p]; }
        return { bonus: "pick", order: tiles, picks: picks, prize: prize };
      }
      if (b.type === "wheel") { var idx = randInt(b.segments.length); return { bonus: "wheel", index: idx, prize: b.segments[idx] }; }
      var level = 0, boosts = [];
      while (level < b.levels.length - 1) {
        var ok = randInt(1000) < b.advance * 1000;
        boosts.push(ok);
        if (!ok) break;
        level++;
      }
      return { bonus: "ladder", level: level, boosts: boosts, prize: b.levels[level] };
    }

    return { makePickers: makePickers, round: round, bonusGame: bonusGame, MAX_FREE_SPINS: MAX_FREE_SPINS, WILD: WILD };
  }

  /* ═══════════════ Exact wins (FAIRNESS.md section 5) ═══════════════ */
  function exact(game) {
    var scale = BigInt(Math.round(game.payScale * 1e6));
    var scat = game.symbols.findIndex(function (s) { return s.kind === "scatter"; });
    function tenths(sym, count) { return count >= 3 ? BigInt(Math.round(game.symbols[sym].pays[Math.min(count, 5) - 3] * 10)) : 0n; }
    return {
      line: function (w) { return tenths(w.symbol, w.count) * scale * BigInt(w.wildMult); },
      scatter: function (s) { return tenths(scat, Math.min(s.count, 5)) * scale; },
      prize: function (p) { return BigInt(Math.round(p * 10)) * scale; }
    };
  }
  function toSats(bet, units, randInt) {
    var e = BigInt(bet) * units;
    var whole = e / UNITS_PER_BET, rem = e % UNITS_PER_BET;
    return Number(whole) + (rem > 0n && BigInt(randInt(Number(UNITS_PER_BET))) < rem ? 1 : 0);
  }

  /* ═══════════════ One paid spin, in the documented draw order ═══════════════ */
  function play(game, bet, randInt) {
    var R = rules(game), X = exact(game), pickers = R.makePickers(randInt);
    var steps = [], total = 0;

    function paid(r) {
      var win = 0;
      var phases = r.phases.map(function (ph) {
        var pw = 0;
        ph.res.lines.forEach(function (w) { pw += toSats(bet, X.line(w) * BigInt(ph.mult), randInt); });
        if (ph.res.scatter) pw += toSats(bet, X.scatter(ph.res.scatter) * BigInt(ph.mult), randInt);
        win += pw;
        return { grid: ph.grid, win: pw };
      });
      return { phases: phases, win: win };
    }
    function bonus() {
      var b = R.bonusGame(randInt);
      b.type = "bonus";
      b.win = toSats(bet, X.prize(b.prize), randInt);
      steps.push(b);
      return b.win;
    }

    var base = R.round(pickers, randInt, null), bs = paid(base);
    steps.push({ type: "spin", free: false, multiplier: 1, phases: bs.phases, win: bs.win });
    total += bs.win;
    if (base.bonus) total += bonus();
    if (base.freeSpins) {
      var fs = game.freeSpins;
      var feat = { left: base.freeSpins, played: 0, mult: fs.progressive ? fs.progressive.start : (fs.multiplier || 1), sticky: {} };
      steps.push({ type: "freeSpinsStart", spins: base.freeSpins });
      var featureWin = 0;
      while (feat.left > 0 && feat.played < R.MAX_FREE_SPINS) {
        feat.left--; feat.played++;
        var mult = feat.mult, f = R.round(pickers, randInt, feat), fr = paid(f);
        steps.push({ type: "spin", free: true, freeSpin: feat.played, multiplier: mult, phases: fr.phases, win: fr.win });
        total += fr.win; featureWin += fr.win;
        if (fs.progressive && f.pay > 0) feat.mult = Math.min(fs.progressive.max, feat.mult + fs.progressive.step);
        if (f.bonus) { var w = bonus(); total += w; featureWin += w; }
        if (f.freeSpins) {
          var add = Math.max(0, Math.min(f.freeSpins, R.MAX_FREE_SPINS - feat.played - feat.left));
          if (add) { feat.left += add; steps.push({ type: "retrigger", added: add, spinsLeft: feat.left }); }
        }
      }
      steps.push({ type: "freeSpinsEnd", played: feat.played, win: featureWin });
    }
    return { totalWin: total, steps: steps };
  }

  /**
   * Replays one spin: { serverSeed, clientSeed, nonce, bet } with the game config.
   * Resolves to { totalWin, steps, serverSeedHash }.
   */
  function replay(game, spin) {
    var blocks = 32;
    function attempt() {
      return makeStream(spin.serverSeed, spin.clientSeed, spin.nonce, blocks).then(function (st) {
        try { return play(game, spin.bet, st.randInt); }
        catch (e) {
          if (e === NEED_MORE && blocks < 65536) { blocks *= 4; return attempt(); }
          throw e;
        }
      });
    }
    return Promise.all([attempt(), sha256Hex(spin.serverSeed)]).then(function (r) {
      r[0].serverSeedHash = r[1];
      return r[0];
    });
  }

  var api = { sha256Hex: sha256Hex, makeStream: makeStream, play: play, replay: replay };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TNC_Fair = api;
})(typeof window !== "undefined" ? window : globalThis);
