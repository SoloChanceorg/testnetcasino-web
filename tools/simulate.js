#!/usr/bin/env node
/*
 * Monte Carlo RTP simulator for TestnetCasino.com games.
 * Uses the same engine + game definitions as the website, including each
 * game's unique feature, free-spin twist and bonus game.
 *
 *   node tools/simulate.js [spinsPerWorker] [game] [--workers N] [--target 1.0001]
 *
 *   node tools/simulate.js                         # 2M spins × 1 worker, all games
 *   node tools/simulate.js 20000000 cosmic-voyage --workers 12
 *
 * Every payout in a game is multiplied by game.payScale, so RTP is exactly
 * proportional to it. The simulator measures the UNSCALED RTP (payScale = 1),
 * then prints the payScale that hits --target (default 1.0001 = 100.01%)
 * together with the 95% confidence interval of the measurement.
 * Paste `payScale` and `stats` into assets/js/games.js.
 */
"use strict";
const path = require("path");
const crypto = require("crypto");
const { fork } = require("child_process");
const E = require(path.join(__dirname, "../assets/js/engine.js"));
const GAMES = require(path.join(__dirname, "../assets/js/games.js"));

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(name); return i === -1 ? def : args.splice(i, 2)[1]; };
const WORKERS = parseInt(flag("--workers", "1"), 10);
const TARGET = parseFloat(flag("--target", "1.0001"));
const N = parseInt(args[0], 10) || 2000000;
const only = args[1];

// xoshiro128** seeded from crypto (fast, good enough for simulation).
const seed = crypto.randomBytes(16);
let s0 = seed.readUInt32LE(0) | 1, s1 = seed.readUInt32LE(4) | 1, s2 = seed.readUInt32LE(8) | 1, s3 = seed.readUInt32LE(12) | 1;
function rotl(x, k) { return (x << k) | (x >>> (32 - k)); }
function rnd() {
  const r = Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0;
  const t = s1 << 9;
  s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3; s2 ^= t; s3 = rotl(s3, 11);
  return r / 4294967296;
}
function randInt(n) { return Math.floor(rnd() * n); }

/** Raw sums for N paid spins at payScale = 1. */
function run(id, n) {
  const game = Object.assign({}, GAMES[id], { payScale: 1, _k: null });
  const pickers = E.makePickers(game, randInt);
  const s = { n, paid: 0, sq: 0, hits: 0, base: 0, fs: 0, bonus: 0, features: 0, bonuses: 0, max: 0 };
  for (let i = 0; i < n; i++) {
    const r = E.round(game, pickers, randInt, null);
    let win = r.mult;
    s.base += r.mult;
    if (r.bonus) { s.bonuses++; const b = E.bonusGame(game, randInt).mult; win += b; s.bonus += b; }
    if (r.freeSpins) {
      s.features++;
      const feat = E.newFeature(game, r.freeSpins);
      while (feat.left > 0 && feat.played < E.MAX_FREE_SPINS) {
        feat.left--; feat.played++;
        const f = E.round(game, pickers, randInt, feat);
        let w = f.mult;
        if (f.bonus) { s.bonuses++; const b = E.bonusGame(game, randInt).mult; w += b; s.bonus += b; }
        win += w; s.fs += f.mult;
        E.afterFreeSpin(game, feat, f.mult);
        if (f.freeSpins) feat.left += Math.min(f.freeSpins, E.MAX_FREE_SPINS - feat.played - feat.left);
      }
    }
    if (win > 0) s.hits++;
    if (win > s.max) s.max = win;
    s.paid += win;
    s.sq += win * win;
  }
  return s;
}

function report(id, s) {
  const game = GAMES[id];
  const rtp = s.paid / s.n;
  const sd = Math.sqrt(s.sq / s.n - rtp * rtp);
  const se = sd / Math.sqrt(s.n);
  const scale = TARGET / rtp;
  const pct = (x) => (100 * x).toFixed(3) + "%";
  console.log(`\n${game.name} (${id}) — ${s.n.toLocaleString("en-US")} spins`);
  console.log(`  unscaled RTP ${pct(rtp)} ± ${pct(1.96 * se)} (95%)  = base ${pct(s.base / s.n)} + free spins ${pct(s.fs / s.n)} + bonus ${pct(s.bonus / s.n)}`);
  console.log(`  hit ${pct(s.hits / s.n)} · free spins 1 in ${Math.round(s.n / s.features)} · bonus 1 in ${Math.round(s.n / s.bonuses)} · σ ${sd.toFixed(2)}× · max ${s.max.toFixed(0)}×`);
  console.log(`  current payScale ${game.payScale || 1} → RTP ${pct(rtp * (game.payScale || 1))}`);
  console.log(`  payScale for ${pct(TARGET)}: ${scale.toFixed(6)}  (RTP 95% range ${pct(TARGET * (1 - 1.96 * se / rtp))} – ${pct(TARGET * (1 + 1.96 * se / rtp))})`);
  console.log(`  payScale: ${scale.toFixed(6)},`);
  console.log(`  stats: { rtp: ${TARGET}, hit: ${(s.hits / s.n).toFixed(3)}, featureEvery: ${Math.round(s.n / s.features)}, bonusEvery: ${Math.round(s.n / s.bonuses)} }`);
}

function merge(a, b) {
  const o = Object.assign({}, a);
  for (const k of Object.keys(b)) o[k] = k === "max" ? Math.max(a[k], b[k]) : a[k] + b[k];
  return o;
}

if (process.env.TNC_WORKER) {
  process.on("message", (m) => { process.send(run(m.id, m.n)); process.exit(0); });
} else {
  const ids = Object.keys(GAMES).filter((id) => !only || only === id);
  (async () => {
    for (const id of ids) {
      if (WORKERS <= 1) { report(id, run(id, N)); continue; }
      const parts = await Promise.all(Array.from({ length: WORKERS }, () => new Promise((resolve, reject) => {
        const w = fork(__filename, [], { env: Object.assign({}, process.env, { TNC_WORKER: "1" }) });
        w.on("message", resolve);
        w.on("error", reject);
        w.send({ id, n: N });
      })));
      report(id, parts.reduce(merge));
    }
  })();
}
