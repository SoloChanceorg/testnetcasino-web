/*
 * TestnetCasino.com — slot math engine (no DOM).
 *
 * Shared by the browser UI (assets/js/slot.js) and the RTP simulator
 * (tools/simulate.js), so the numbers shown on the site come from the exact
 * code that runs the game.
 *
 * Grid: 5 reels (columns) × 3 rows. grid[col][row] is a symbol index.
 *
 * Ways to win (all games)
 *   - Line wins:   3, 4 or 5 matching symbols on a payline from the leftmost
 *                  reel. Wilds substitute for regular symbols. Best win per line.
 *   - Scatter:     3+ anywhere pay and award free spins.
 *   - Bonus:       a bonus symbol on reels 1, 3 and 5 starts the bonus game.
 *
 * Unique base-game feature (game.feature)
 *   - "respin"   (Fruit Orchard)  new wilds stick, every other cell respins
 *                                  (up to MAX_RESPINS times); each phase pays.
 *                                  In free spins, wilds stick for the whole feature.
 *   - "expand"   (Deep Sea)       a wild grows to fill its whole reel.
 *   - "multwild" (Cosmic Voyage)  each wild carries a multiplier; wilds on a
 *                                  winning line multiply together (capped).
 *
 * Free-spin multiplier: fixed (freeSpins.multiplier) or progressive
 * (freeSpins.progressive: +step after each winning free spin, up to max).
 *
 * Payout scale (game.payScale): every payout — line, scatter and bonus — is
 * multiplied by it, so RTP is exactly proportional to it. It is set so each
 * game's RTP is 100.01% (a faucet pays out slightly more than it takes in).
 *
 * All multipliers are × TOTAL BET. The UI turns each win into whole sats with
 * unbiased random rounding, so the RTP holds at every bet size.
 */
(function (root) {
  "use strict";

  var REELS = 5;
  var ROWS = 3;
  var MAX_RESPINS = 3;
  var MAX_FREE_SPINS = 100;

  // Row index (0 = top) on each reel, left to right.
  var PAYLINES = [
    [1, 1, 1, 1, 1],
    [0, 0, 0, 0, 0],
    [2, 2, 2, 2, 2],
    [0, 1, 2, 1, 0],
    [2, 1, 0, 1, 2],
    [0, 0, 1, 2, 2],
    [2, 2, 1, 0, 0],
    [1, 0, 0, 0, 1],
    [1, 2, 2, 2, 1],
    [1, 0, 1, 2, 1]
  ];

  function key(c, r) { return c + "," + r; }

  function kinds(game) {
    if (!game._k) {
      var k = { wild: -1, scatter: -1, bonus: -1, top: -1 };
      game.symbols.forEach(function (s, i) {
        if (s.kind) k[s.kind] = i;
        else k.top = i; // regular symbols are listed common → rare
      });
      game._k = k;
    }
    return game._k;
  }

  function weighted(randInt, weights) {
    var total = 0, i;
    for (i = 0; i < weights.length; i++) total += weights[i];
    var r = randInt(total);
    for (i = 0; i < weights.length; i++) { r -= weights[i]; if (r < 0) return i; }
    return weights.length - 1;
  }

  /** One weighted symbol picker per reel (bonus symbols only on their reels). */
  function makePickers(game, randInt) {
    var pickers = [];
    for (var c = 0; c < REELS; c++) {
      var ids = [], w = [];
      game.symbols.forEach(function (s, i) {
        if (!s.reels || s.reels.indexOf(c) !== -1) { ids.push(i); w.push(s.weight); }
      });
      pickers.push((function (ids, w) {
        return function () { return ids[weighted(randInt, w)]; };
      }(ids, w)));
    }
    return pickers;
  }

  /** Random grid. `fixed` maps "c,r" → symbol index for cells that must not change. */
  function spinGrid(pickers, fixed) {
    var grid = [];
    for (var c = 0; c < REELS; c++) {
      var col = [];
      for (var r = 0; r < ROWS; r++) {
        var k = key(c, r);
        col.push(fixed && fixed[k] != null ? fixed[k] : pickers[c]());
      }
      grid.push(col);
    }
    return grid;
  }

  function payFor(sym, count) { return count >= 3 ? (sym.pays[count - 3] || 0) : 0; }

  /**
   * Evaluate a grid.
   *   lineGrid   grid used for paylines (after expanding wilds, if any)
   *   opts.countGrid  grid used to count scatters / bonus symbols (default lineGrid)
   *   opts.wildMults  { "c,r": multiplier } for multiplier wilds
   */
  function evaluate(game, lineGrid, opts) {
    opts = opts || {};
    var K = kinds(game), syms = game.symbols;
    var WILD = K.wild, SCAT = K.scatter, BONUS = K.bonus;
    var countGrid = opts.countGrid || lineGrid;
    var wm = opts.wildMults || {};
    var cap = (game.wildMult && game.wildMult.cap) || Infinity;
    var S = game.payScale || 1;
    var lines = [], total = 0;

    for (var li = 0; li < PAYLINES.length; li++) {
      var pl = PAYLINES[li], seq = [];
      for (var c = 0; c < REELS; c++) seq.push(lineGrid[c][pl[c]]);

      var wildRun = 0;
      while (wildRun < REELS && seq[wildRun] === WILD) wildRun++;
      var wildPay = payFor(syms[WILD], wildRun);

      var base = wildRun < REELS ? seq[wildRun] : -1;
      var symRun = 0, symPay = 0;
      if (base !== -1 && base !== SCAT && base !== BONUS) {
        symRun = wildRun;
        while (symRun < REELS && (seq[symRun] === base || seq[symRun] === WILD)) symRun++;
        symPay = payFor(syms[base], symRun);
      }

      var best = null;
      if (symPay > 0 && symPay >= wildPay) best = { symbol: base, count: symRun, base: symPay * S };
      else if (wildPay > 0) best = { symbol: WILD, count: wildRun, base: wildPay * S };

      if (best) {
        var cells = [], wmul = 1, withWild = false;
        for (var k = 0; k < best.count; k++) {
          cells.push([k, pl[k]]);
          if (seq[k] === WILD) {
            withWild = true;
            if (wm[key(k, pl[k])]) wmul *= wm[key(k, pl[k])];
          }
        }
        wmul = Math.min(wmul, cap);
        best.line = li;
        best.cells = cells;
        best.withWild = best.symbol !== WILD && withWild;
        best.wildMult = wmul;
        best.mult = best.base * wmul;
        lines.push(best);
        total += best.mult;
      }
    }

    var scatterCells = [], bonusCells = [], bonusReels = {};
    for (var c2 = 0; c2 < REELS; c2++) {
      for (var r2 = 0; r2 < ROWS; r2++) {
        if (countGrid[c2][r2] === SCAT) scatterCells.push([c2, r2]);
        if (countGrid[c2][r2] === BONUS) { bonusCells.push([c2, r2]); bonusReels[c2] = true; }
      }
    }
    var n = Math.min(scatterCells.length, 5), scatter = null;
    if (n >= 3) {
      scatter = {
        symbol: SCAT, count: scatterCells.length, mult: payFor(syms[SCAT], n) * S,
        freeSpins: game.freeSpins.awards[n - 3] || 0, cells: scatterCells
      };
      total += scatter.mult;
    }
    var bonus = null;
    if (BONUS !== -1 && Object.keys(bonusReels).length >= 3) bonus = { symbol: BONUS, cells: bonusCells };

    return { lines: lines, scatter: scatter, bonus: bonus, mult: total };
  }

  /** Free-spins state for a new feature. */
  function newFeature(game, spins) {
    var fs = game.freeSpins;
    return {
      left: spins, played: 0, total: 0,
      mult: fs.progressive ? fs.progressive.start : (fs.multiplier || 1),
      sticky: {}  // "c,r" → wild (sticky-wild free spins)
    };
  }

  /** Update a feature after one free spin that won `won` (× bet, any > 0 counts). */
  function afterFreeSpin(game, feat, won) {
    var p = game.freeSpins.progressive;
    if (p && won > 0) feat.mult = Math.min(p.max, feat.mult + p.step);
  }

  /**
   * Play one spin (paid, or a free spin when `feat` is given).
   * Returns { phases: [...], freeSpins, bonus, mult } where each phase is
   *   { grid, display, fixed, expanded, wildMults, res, mult }
   * `mult` per phase is the free-spin multiplier applied to that phase's wins.
   */
  function round(game, pickers, randInt, feat) {
    var K = kinds(game), WILD = K.wild;
    var free = !!feat;
    var fsMult = free ? feat.mult : 1;
    var fixed = {};
    if (free && game.freeSpins.sticky) for (var sk in feat.sticky) fixed[sk] = WILD;

    var phases = [], respins = 0, award = 0, bonus = null, total = 0;
    var grid = spinGrid(pickers, fixed);

    for (;;) {
      var display = grid, expanded = [], wildMults = {};
      if (game.feature === "expand") {
        display = grid.map(function (col, c) {
          if (col.indexOf(WILD) !== -1) { expanded.push(c); return [WILD, WILD, WILD]; }
          return col;
        });
      }
      if (game.feature === "multwild") {
        for (var c = 0; c < REELS; c++) for (var r = 0; r < ROWS; r++)
          if (grid[c][r] === WILD) wildMults[key(c, r)] = game.wildMult.values[weighted(randInt, game.wildMult.weights)];
      }
      var res = evaluate(game, display, { countGrid: grid, wildMults: wildMults });
      phases.push({ grid: grid, display: display, fixed: fixed, expanded: expanded, wildMults: wildMults, res: res, mult: fsMult });
      total += res.mult * fsMult;
      if (res.scatter) award = Math.max(award, res.scatter.freeSpins);
      if (res.bonus) bonus = res.bonus;

      // Lucky Respin: new wilds stick and the rest of the grid spins again (base game only).
      if (game.feature === "respin" && !free && respins < MAX_RESPINS) {
        var newWild = false, next = {};
        for (var c3 = 0; c3 < REELS; c3++) for (var r3 = 0; r3 < ROWS; r3++) {
          if (grid[c3][r3] === WILD) {
            next[key(c3, r3)] = WILD;
            if (fixed[key(c3, r3)] == null) newWild = true;
          }
        }
        if (newWild) {
          fixed = next;
          respins++;
          grid = spinGrid(pickers, fixed);
          continue;
        }
      }
      break;
    }

    // Sticky-wild free spins: every wild that lands stays for the rest of the feature.
    if (free && game.freeSpins.sticky) {
      var last = phases[phases.length - 1].grid;
      for (var c4 = 0; c4 < REELS; c4++) for (var r4 = 0; r4 < ROWS; r4++)
        if (last[c4][r4] === WILD) feat.sticky[key(c4, r4)] = true;
    }

    return { phases: phases, freeSpins: award, bonus: bonus, mult: total };
  }

  /**
   * Bonus game script (decided up front; the UI only animates it).
   *   pick:   prizes + collect tiles shuffled; reveal until the first collect.
   *   wheel:  one segment chosen uniformly.
   *   ladder: climb while each boost succeeds (advance %), stop at the top.
   * Returns { type, mult, ... } with mult × total bet.
   */
  function bonusGame(game, randInt) {
    var b = game.bonus, S = game.payScale || 1;
    if (b.type === "pick") {
      var tiles = b.prizes.slice();
      for (var i = 0; i < b.collect; i++) tiles.push(0);   // 0 = collect
      for (var j = tiles.length - 1; j > 0; j--) {        // Fisher–Yates
        var x = randInt(j + 1), t = tiles[j]; tiles[j] = tiles[x]; tiles[x] = t;
      }
      var mult = 0, picks = 0;
      for (var p = 0; p < tiles.length; p++) { picks++; if (tiles[p] === 0) break; mult += tiles[p]; }
      return { type: "pick", order: tiles, picks: picks, mult: mult * S, scale: S };
    }
    if (b.type === "wheel") {
      var idx = randInt(b.segments.length);
      return { type: "wheel", index: idx, mult: b.segments[idx] * S, scale: S };
    }
    if (b.type === "ladder") {
      var level = 0, steps = [];
      while (level < b.levels.length - 1) {
        var ok = randInt(1000) < b.advance * 1000;
        steps.push(ok);
        if (!ok) break;
        level++;
      }
      return { type: "ladder", level: level, steps: steps, mult: b.levels[level] * S, scale: S };
    }
    return { type: "none", mult: 0 };
  }

  var api = {
    REELS: REELS, ROWS: ROWS, PAYLINES: PAYLINES, MAX_RESPINS: MAX_RESPINS, MAX_FREE_SPINS: MAX_FREE_SPINS,
    key: key, kinds: kinds, makePickers: makePickers, spinGrid: spinGrid, evaluate: evaluate,
    round: round, newFeature: newFeature, afterFreeSpin: afterFreeSpin, bonusGame: bonusGame
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TNC_Engine = api;
})(typeof window !== "undefined" ? window : this);
