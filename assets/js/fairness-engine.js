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
 *     rounded to whole sats with one draw when there is a remainder;
 *   - game versions: the API serves the current config (version 4 from D43, before
 *     that version 3). Versions 1 and 3 have the same rules; version 2 (2026-11-08 to
 *     2026-11-09) adds two jackpot draws after every other draw: the game's Major,
 *     then the shared Grand (FAIRNESS.md section 4, step 5). Version 4 has version
 *     3's reels with its own payScale, plus the jackpots won in the game and the
 *     collector (section 3, item 6; section 4, items 6 and 7): after the free spins,
 *     the jackpot draws (skipped when the spin said "jackpots": false), the collect
 *     symbols, and, when the spin filled the collector, its reward at the collect
 *     step's bet. configFor() rebuilds an older version from the current config;
 *   - roulette (FAIRNESS.md section 9): roulette() derives a round's number, spin length and payouts;
 *   - jackpots (FAIRNESS.md section 8): meter() derives a cycle's target and head
 *     start from its revealed seed (and the display scale of the D40 / D41 cycles);
 *     verifyMeterWin() checks a win.
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

  /* ═══════════════ Game versions ═══════════════ */
  // Version 2's jackpot draws (the same for all three games; frozen, they never change).
  var V2_JACKPOTS = { major: { oneInSats: 730000 }, grand: { oneInSats: 9300000 } };
  // Versions 1 to 3 paid with these (frozen); version 4 has its own payScale (x 0.96 / 1.0001).
  var V3_PAYSCALE = { "fruit-orchard": 1.039426, "deep-sea": 1.043096, "cosmic-voyage": 1.038924 };
  var V4_ONLY = ["jackpots", "jackpot", "collector", "rtpParts"];
  /** The rules a spin of `version` was played with, built from the current config (version 3 or 4). */
  function configFor(game, version) {
    version = Number(version || game.version);
    var ok = version === game.version || (version >= 1 && version <= 3 && (game.version === 3 || (game.version === 4 && V3_PAYSCALE[game.id])));
    if (!ok) {
      throw new Error("Game version " + version + " cannot be checked with the version " + game.version + " rules the server serves.");
    }
    if (version === game.version && version !== 2) return game;
    var g = {};
    Object.keys(game).forEach(function (k) { if (V4_ONLY.indexOf(k) === -1) g[k] = game[k]; });
    g.version = version;
    if (game.version === 4) { g.payScale = V3_PAYSCALE[game.id]; g.rtp = 1.0001; }
    if (version === 2) g.jackpots = V2_JACKPOTS;
    return g;
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
        // Where the stream is now, and a way back to it (to try the reward at several bets).
        function mark() { return [bi, off]; }
        function reset(m) { bi = m[0]; off = m[1]; }
        return { next32: next32, randInt: randInt, mark: mark, reset: reset };
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
      if (free && feat.locked) fixed[key(feat.locked[0], feat.locked[1])] = WILD;   // version 4: Hyperdrive
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

    /* --- Version 4 (D43): jackpots in the game, the collector and its rewards (section 3, item 6) --- */
    var TIERS = ["minor", "major", "grand"];
    // k distinct cells: each randInt(free.length) over the cells not taken yet (reel by reel, top to bottom).
    function randomCells(randInt, k, taken) {
      var free = [], out = [];
      for (var c = 0; c < REELS; c++) for (var r = 0; r < ROWS; r++) if (!taken[key(c, r)]) free.push([c, r]);
      for (var i = 0; i < k && free.length; i++) {
        var cell = free.splice(randInt(free.length), 1)[0];
        taken[key(cell[0], cell[1])] = true;
        out.push(cell);
      }
      return out;
    }
    // The clam pick: the other tiers 0 to 2 times each, shuffled with two of the won tier; the third one last.
    function clamPick(tier, randInt) {
      var seq = [tier, tier];
      TIERS.forEach(function (t) { if (t !== tier) { var n = randInt(3); for (var i = 0; i < n; i++) seq.push(t); } });
      for (var x = seq.length - 1; x > 0; x--) { var y = randInt(x + 1), t = seq[x]; seq[x] = seq[y]; seq[y] = t; }
      seq.push(tier);
      return seq;
    }
    // Grand, Major, Minor: a hit when randInt(oneInSats) < bet (all three drawn); the highest hit is won.
    function jackpotDraw(bet, randInt, taken) {
      var j = game.jackpot;
      var grand = randInt(j.grand.oneInSats) < bet, major = randInt(j.major.oneInSats) < bet, minor = randInt(j.minor.oneInSats) < bet;
      var tier = grand ? "grand" : major ? "major" : minor ? "minor" : null;
      if (!tier) return null;
      if (j.type === "apples") return { type: "jackpot", tier: tier, cells: randomCells(randInt, 3 + TIERS.indexOf(tier), taken) };
      if (j.type === "clams") {
        var oyster = randomCells(randInt, 1, taken);
        return { type: "jackpot", tier: tier, cells: oyster, picks: clamPick(tier, randInt) };
      }
      var stars = randomCells(randInt, 3, taken), of = [];
      j.slices.forEach(function (s, i) { if (s === tier) of.push(i); });
      return { type: "jackpot", tier: tier, cells: stars, slice: of[randInt(of.length)] };
    }
    function collect(randInt, taken) {
      var n = weighted(randInt, game.collector.weights);
      return n ? randomCells(randInt, n, taken) : [];
    }
    // Treasure Hold & Win; values in tenths of the bet (before payScale).
    function holdAndWin(randInt) {
      var r = game.collector.reward, taken = {}, total = 0;
      var vals = r.values.map(function (v) { return Math.round(v * 10); });
      function value() { return vals[weighted(randInt, r.valueWeights)]; }
      var start = randomCells(randInt, r.pearls, taken).map(function (c) { var v = value(); total += v; return { reel: c[0], row: c[1], value: v }; });
      var count = start.length, left = r.respins, respins = [], land = Math.round(r.land * 1000);
      while (left > 0 && count < REELS * ROWS) {
        left--;
        var landed = [];
        for (var c = 0; c < REELS; c++) for (var row = 0; row < ROWS; row++) {
          if (!taken[key(c, row)] && randInt(1000) < land) {
            taken[key(c, row)] = true;
            var v = value(); total += v;
            landed.push({ reel: c, row: row, value: v });
          }
        }
        respins.push(landed);
        if (landed.length) { count += landed.length; left = r.respins; }
      }
      return { start: start, respins: respins, totalTenths: total };
    }

    return { makePickers: makePickers, round: round, bonusGame: bonusGame, MAX_FREE_SPINS: MAX_FREE_SPINS, WILD: WILD,
             jackpotDraw: jackpotDraw, collect: collect, holdAndWin: holdAndWin };
  }

  /* ═══════════════ Exact wins (FAIRNESS.md section 5) ═══════════════ */
  function exact(game) {
    var scale = BigInt(Math.round(game.payScale * 1e6));
    var scat = game.symbols.findIndex(function (s) { return s.kind === "scatter"; });
    function tenths(sym, count) { return count >= 3 ? BigInt(Math.round(game.symbols[sym].pays[Math.min(count, 5) - 3] * 10)) : 0n; }
    return {
      scale: scale,
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
  // opts.jackpots === false: the version 4 jackpot draws were skipped (the spin said "jackpots": false).
  // opts.rewardBet: the spin filled the collector (its collect step: full, bet); the reward is played at it.
  // Without rewardBet the result has `stream` and `reward(bet)` to play the reward afterwards, from the
  // stream's position after the collect symbols, as often as needed (the fairness page tries bets with it).
  function play(game, bet, randInt, opts, stream) {
    opts = opts || {};
    var spinBet = bet;
    var R = rules(game), X = exact(game), pickers = R.makePickers(randInt);
    var steps = [], total = 0;

    function paid(r, b) {
      var win = 0;
      var phases = r.phases.map(function (ph) {
        var pw = 0;
        ph.res.lines.forEach(function (w) { pw += toSats(b, X.line(w) * BigInt(ph.mult), randInt); });
        if (ph.res.scatter) pw += toSats(b, X.scatter(ph.res.scatter) * BigInt(ph.mult), randInt);
        win += pw;
        return { grid: ph.grid, win: pw };
      });
      return { phases: phases, win: win };
    }
    function bonus(b, out) {
      var x = R.bonusGame(randInt);
      x.type = "bonus";
      x.win = toSats(b, X.prize(x.prize), randInt);
      out.push(x);
      return x.win;
    }
    // The free-spin loop (the paid spin's free spins or a reward's): pushes the steps, returns the win.
    function freeSpins(feat, b, out) {
      var fs = game.freeSpins, featureWin = 0;
      while (feat.left > 0 && feat.played < R.MAX_FREE_SPINS) {
        feat.left--; feat.played++;
        var mult = feat.mult, f = R.round(pickers, randInt, feat), fr = paid(f, b);
        out.push({ type: "spin", free: true, freeSpin: feat.played, multiplier: mult, phases: fr.phases, win: fr.win });
        featureWin += fr.win;
        if (feat.riseStep) feat.mult = Math.min(feat.riseMax, feat.mult + feat.riseStep);   // Hyperdrive: every spin
        else if (fs.progressive && f.pay > 0) feat.mult = Math.min(fs.progressive.max, feat.mult + fs.progressive.step);
        if (f.bonus) featureWin += bonus(b, out);
        if (f.freeSpins) {
          var add = Math.max(0, Math.min(f.freeSpins, R.MAX_FREE_SPINS - feat.played - feat.left));
          if (add) { feat.left += add; out.push({ type: "retrigger", added: add, spinsLeft: feat.left }); }
        }
      }
      out.push({ type: "freeSpinsEnd", played: feat.played, win: featureWin });
      return featureWin;
    }

    var base = R.round(pickers, randInt, null), bs = paid(base, bet);
    steps.push({ type: "spin", free: false, multiplier: 1, phases: bs.phases, win: bs.win });
    total += bs.win;
    if (base.bonus) total += bonus(bet, steps);
    if (base.freeSpins) {
      var fs = game.freeSpins;
      steps.push({ type: "freeSpinsStart", spins: base.freeSpins });
      total += freeSpins({ left: base.freeSpins, played: 0, mult: fs.progressive ? fs.progressive.start : (fs.multiplier || 1), sticky: {} }, bet, steps);
    }
    // Version 4: the jackpot draws (unless off), then the collect symbols (never on a jackpot cell).
    var jackpot = null, collected = [];
    if (game.jackpot || game.collector) {
      var taken = {};
      if (game.jackpot && opts.jackpots !== false) {
        jackpot = R.jackpotDraw(spinBet, randInt, taken);
        if (jackpot) steps.push(jackpot);
      }
      if (game.collector) {
        collected = R.collect(randInt, taken);
        if (collected.length) steps.push({ type: "collect", cells: collected });
      }
    }
    // Version 2 only: the old jackpot draws (FAIRNESS.md section 4), after everything else, Major first, then Grand.
    var jackpotHits = null;
    if (game.jackpots) {
      jackpotHits = {
        major: randInt(game.jackpots.major.oneInSats) < spinBet,
        grand: randInt(game.jackpots.grand.oneInSats) < spinBet
      };
    }
    // The collector's reward, at its own bet, continuing the stream (section 4, item 7).
    function reward(b) {
      var r = game.collector.reward, out = [], win;
      if (r.type === "freeSpins") {
        var rise = r.rise || {};
        out.push({ type: "rewardStart", bet: b, spins: r.spins });
        win = freeSpins({ left: r.spins, played: 0, mult: Math.max(1, r.multiplier || 1), sticky: {},
          riseStep: rise.step || 0, riseMax: rise.max || 0, locked: r.lockedWild || null }, b, out);
      } else {
        var h = R.holdAndWin(randInt);
        win = toSats(b, BigInt(h.totalTenths) * X.scale, randInt);
        var pearls = function (list) { return list.map(function (p) { return { reel: p.reel, row: p.row, value: p.value / 10 }; }); };
        out.push({ type: "holdAndWin", bet: b, start: pearls(h.start), respins: h.respins.map(pearls), prize: h.totalTenths / 10, win: win });
      }
      return { win: win, steps: out };
    }
    var result = { totalWin: total, steps: steps, jackpotHits: jackpotHits, jackpot: jackpot, collected: collected.length };
    if (collected.length && opts.rewardBet) {
      var rw = reward(opts.rewardBet);
      result.rewardBet = opts.rewardBet;
      result.reward = rw;
      result.totalWin += rw.win;
      rw.steps.forEach(function (x) { steps.push(x); });
    } else if (collected.length && stream && stream.mark) {
      var at = stream.mark();
      result.tryReward = function (b) { stream.reset(at); return reward(b); };
    }
    return result;
  }

  /**
   * Replays one spin: { serverSeed, clientSeed, nonce, bet } with the game config; opts as for play()
   * ({ jackpots, rewardBet }), plus matchTotal: a spin's totalWin from GET /spins, which does not say
   * whether the spin filled the collector or at what bet. If the replay has collect symbols and does
   * not reach matchTotal, the reward is tried at every bet from the spin's bet down to 1 (the reward's
   * bet is the spin's bet capped at the cycle's average); a match is kept as rewardBet.
   * Resolves to { totalWin, steps, serverSeedHash, ... }.
   */
  function replay(game, spin, opts) {
    var blocks = 32;
    function attempt() {
      return makeStream(spin.serverSeed, spin.clientSeed, spin.nonce, blocks).then(function (st) {
        try {
          var res = play(game, spin.bet, st.randInt, opts, st), want = opts && opts.matchTotal;
          if (want != null && res.tryReward && res.totalWin < want) {
            for (var b = spin.bet; b >= 1; b--) {
              var rw = res.tryReward(b);
              if (res.totalWin + rw.win === want) {
                res.rewardBet = b; res.reward = rw; res.totalWin += rw.win;
                rw.steps.forEach(function (x) { res.steps.push(x); });
                break;
              }
            }
          }
          return res;
        }
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

  /* ═══════════════ Jackpot meters (FAIRNESS.md section 8) ═══════════════ */
  var TWO96 = 1n << 96n, TWO32 = 1n << 32n, TWO34 = 1n << 34n;
  /**
   * A jackpot cycle from its revealed seed (64 hex) and the tier's range in sats: resolves to
   * { seedHash, target, startSats, legacy: { displayScale, startSats } } (exact BigInt arithmetic).
   * startSats: the head start of a cycle since D43 (25% to 75% of the target, every tier). legacy: what
   * the D40 / D41 cycles used (a display scale; a head start of min x z / 2^32, the Minor none).
   */
  function meter(seedHex, minSats, maxSats) {
    var seed = hexToBytes(seedHex), min = BigInt(minSats), max = BigInt(maxSats);
    if (max < min) return Promise.reject(new Error("The maximum is below the minimum."));
    var msg = new TextEncoder().encode("tnc-jackpot-meter");
    var mac = subtle.importKey("raw", seed, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
      .then(function (key) { return subtle.sign("HMAC", key, msg); });
    return Promise.all([mac, sha256Hex(seedHex)]).then(function (r) {
      var v = new DataView(r[0]);
      var x = BigInt(v.getUint32(0, false)), y = BigInt(v.getUint32(4, false)), z = BigInt(v.getUint32(8, false));
      var target = min + (max - min) * x * x * x / TWO96;
      return { seedHash: r[1], target: Number(target), startSats: Number(target * (TWO32 + 2n * y) / TWO34),
               legacy: { displayScale: Number(target + (max - target) * y / TWO32), startSats: Number(min * z / TWO32) } };
    });
  }
  /**
   * Checks one jackpot win from GET /jackpots recentWins (seed, seedHash, tier or pool, minSats, maxSats,
   * target, startSats, amount; D40 / D41 wins also displayScale). Resolves to { ok, checks: [ { id, ok, text } ], derived }.
   */
  function verifyMeterWin(w) {
    var minor = (w.tier || String(w.pool || "").split(":")[0]) === "minor", old = w.displayScale != null;
    return meter(w.seed, w.minSats, w.maxSats).then(function (d) {
      var hash = { id: "hash", ok: d.seedHash === String(w.seedHash).toLowerCase(),
        text: "SHA-256 of the seed equals the seed hash published when the cycle started" };
      var checks;
      if (old) {   // a D40 / D41 cycle: it paid when it reached its target
        var start = minor ? 0 : d.legacy.startSats;
        checks = [hash,
          { id: "target", ok: d.target === Number(w.target) && d.legacy.displayScale === Number(w.displayScale) && (w.startSats == null || start === Number(w.startSats)),
            text: "The seed gives target " + d.target + ", display scale " + d.legacy.displayScale + " and head start " + start +
              " (the server said " + w.target + ", " + w.displayScale + " and " + (w.startSats == null ? "nothing" : w.startSats) + ")" },
          { id: "amount", ok: Number(w.amount) >= d.target,
            text: "The amount won (" + w.amount + ") is at least the target (" + d.target + ")" }];
      } else {
        checks = [hash,
          { id: "target", ok: d.target === Number(w.target) && d.startSats === Number(w.startSats),
            text: "The seed gives target " + d.target + " and head start " + d.startSats +
              " (the server said " + w.target + " and " + (w.startSats == null ? "nothing" : w.startSats) + ")" },
          { id: "amount", ok: Number(w.amount) >= d.startSats,
            text: "The amount won (" + w.amount + ") is at least the head start (" + d.startSats + ") the cycle began with" }];
      }
      return { ok: checks.every(function (c) { return c.ok; }), checks: checks, derived: d, legacy: old };
    });
  }

  /* ═══════════════ Roulette (FAIRNESS.md section 9) ═══════════════ */
  /**
   * A roulette round from its revealed seed: the stream of section 2 with clientSeed "roulette" and
   * nonce = round id gives the number (randInt(37)), the spin's length (28 + randInt(5)), then, for
   * every chip in bet id order that covers the number, the rounding of its payout (stake × 37 / n,
   * plus 1 sat when randInt(n) < the remainder). bets: [{ amount, numbers }] (chips taken back are not
   * included). Resolves to { seedHash, number, spinSeconds, payouts } (0 for a chip that lost).
   */
  // The numbers a chip covers: its `numbers`, or for an outside bet (red, dozen2, column1, ...) by its type.
  var R_RED = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
  function rouletteCovers(chip) {
    if (chip.numbers && chip.numbers.length) return chip.numbers;
    var all = []; for (var i = 1; i <= 36; i++) all.push(i);
    var t = chip.type, m;
    if (t === "red") return R_RED.slice();
    if (t === "black") return all.filter(function (n) { return R_RED.indexOf(n) === -1; });
    if (t === "odd") return all.filter(function (n) { return n % 2; });
    if (t === "even") return all.filter(function (n) { return !(n % 2); });
    if (t === "low") return all.slice(0, 18);
    if (t === "high") return all.slice(18);
    if ((m = /^dozen([123])$/.exec(t))) return all.slice((m[1] - 1) * 12, m[1] * 12);
    if ((m = /^column([123])$/.exec(t))) return all.filter(function (n) { return (n - 1) % 3 === m[1] - 1; });
    return [];
  }
  function roulette(seedHex, roundId, bets) {
    bets = bets || [];
    var blocks = 4;
    function attempt() {
      return makeStream(seedHex, "roulette", roundId, blocks).then(function (st) {
        try {
          var number = st.randInt(37), spinSeconds = 28 + st.randInt(5);
          var payouts = bets.map(function (b) {
            var nums = rouletteCovers(b);
            if (nums.indexOf(number) === -1) return 0;
            var n = BigInt(nums.length), exact = BigInt(b.amount) * 37n, whole = exact / n, rem = exact % n;
            return Number(whole) + (rem > 0n && BigInt(st.randInt(Number(n))) < rem ? 1 : 0);
          });
          return { number: number, spinSeconds: spinSeconds, payouts: payouts };
        } catch (e) {
          if (e === NEED_MORE && blocks < 4096) { blocks *= 4; return attempt(); }
          throw e;
        }
      });
    }
    return Promise.all([attempt(), sha256Hex(seedHex)]).then(function (r) { r[0].seedHash = r[1]; return r[0]; });
  }

  var api = { sha256Hex: sha256Hex, makeStream: makeStream, play: play, replay: replay,
              configFor: configFor, meter: meter, verifyMeterWin: verifyMeterWin, roulette: roulette, rouletteCovers: rouletteCovers };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TNC_Fair = api;
})(typeof window !== "undefined" ? window : globalThis);
