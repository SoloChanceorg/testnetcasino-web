#!/usr/bin/env node
/*
 * Checks assets/js/fairness-engine.js (the in-browser verifier) against the
 * backend's fairness test vectors. Every stream and every spin must match
 * before the verifier ships.
 *
 *   node tools/verify-vectors.mjs [path/to/fairness-test-vectors.json]
 *
 * Default vectors: ../testnetcasino-service/docs/fairness-test-vectors.json.
 * Game configs are read from the live API (GET /games/{id}/config), the same
 * source the fairness page uses. When the vectors hold a newer version than the
 * API serves yet (a backend change not deployed), the backend's own config file
 * (src/main/resources/games/<id>.v<N>.json) is used instead. Older spins are
 * replayed with Fair.configFor(). Version 4 spins: the jackpot draws, the collect
 * symbols and (the `rewards` vectors) the collector's reward at `rewardBet`.
 * Also checks every jackpot meter vector (FAIRNESS.md section 8). Needs Node 20+
 * (crypto.subtle, fetch).
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const Fair = createRequire(import.meta.url)(path.join(here, "../assets/js/fairness-engine.js"));
const file = process.argv[2] || path.join(here, "../../testnetcasino-service/docs/fairness-test-vectors.json");
const doc = JSON.parse(fs.readFileSync(file, "utf8"));
const API = "https://api.testnetcasino.com";

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const newest = Math.max(...doc.spins.map((v) => v.gameVersion));
const configs = {};
async function config(id, version) {
  if (!configs[id]) {
    let c = await (await fetch(`${API}/games/${id}/config`)).json();
    const local = path.join(path.dirname(file), `../src/main/resources/games/${id}.v${newest}.json`);
    if (c.version < newest && fs.existsSync(local)) {
      console.log(`${id}: the API serves version ${c.version}, using the backend's version ${newest} file`);
      c = JSON.parse(fs.readFileSync(local, "utf8"));
    }
    configs[id] = c;
  }
  return Fair.configFor(configs[id], version);
}
// The fields of a step that the verifier rebuilds.
function view(s) {
  if (s.type === "spin") return { type: "spin", free: s.free, phases: s.phases.map((p) => ({ grid: p.grid, win: p.win })), win: s.win };
  if (s.type === "bonus") return { type: "bonus", bonus: s.bonus, prize: s.prize, win: s.win };
  if (s.type === "freeSpinsStart") return { type: s.type, spins: s.spins };
  if (s.type === "retrigger") return { type: s.type, added: s.added, spinsLeft: s.spinsLeft };
  if (s.type === "jackpot") return { type: s.type, tier: s.tier, cells: s.cells, picks: s.picks, slice: s.slice };
  if (s.type === "collect") return { type: s.type, cells: s.cells };
  if (s.type === "rewardStart") return { type: s.type, bet: s.bet, spins: s.spins };
  if (s.type === "holdAndWin") return { type: s.type, bet: s.bet, start: s.start, respins: s.respins, prize: s.prize, win: s.win };
  return { type: s.type, played: s.played, win: s.win };
}

let checked = 0, failed = 0;
for (const s of doc.streams) {
  checked++;
  const a = await Fair.makeStream(s.serverSeed, s.clientSeed, s.nonce, 64);
  const u = s.uint32.map(() => a.next32());
  const b = await Fair.makeStream(s.serverSeed, s.clientSeed, s.nonce, 64);
  const ri = s.randInt.map((r) => ({ bound: r.bound, values: r.values.map(() => b.randInt(r.bound)) }));
  const ok = (await Fair.sha256Hex(s.serverSeed)) === s.serverSeedHash && same(u, s.uint32) && same(ri, s.randInt);
  if (!ok) { failed++; console.log("STREAM MISMATCH nonce", s.nonce); }
}
for (const v of doc.spins.concat(doc.rewards || [])) {
  checked++;
  const game = await config(v.gameId, v.gameVersion);
  const got = await Fair.replay(game, v, { jackpots: v.jackpots, rewardBet: v.rewardBet });
  // Everything the verifier rebuilds: grids, wins, every bonus / feature step, jackpots, collect symbols.
  const want = v.steps.concat(v.reward ? v.reward.steps : []).map(view);
  const mine = got.steps.map(view);
  // Free-spin multipliers and bonus details too.
  const extra = v.steps.every((s, i) => {
    const m = got.steps[i];
    if (!m) return false;
    if (s.type === "spin" && s.free) return s.multiplier === m.multiplier && s.freeSpin === m.freeSpin;
    if (s.type === "bonus") return same([s.order, s.picks, s.index, s.level, s.boosts], [m.order, m.picks, m.index, m.level, m.boosts]);
    return true;
  });
  // Version 2 only: the old jackpot draws, Major then Grand, after every other draw.
  const jackpotsOk = same(got.jackpotHits, v.jackpotHits || null);
  const total = v.totalWin + (v.reward ? v.reward.win : 0);
  const ok = got.totalWin === total && got.serverSeedHash === v.serverSeedHash && same(mine, want) && extra && jackpotsOk
    && (!v.reward || got.reward.win === v.reward.win);
  if (!ok) { failed++; console.log("SPIN MISMATCH", v.gameId, "v" + v.gameVersion, "nonce", v.nonce, "expected", total, "got", got.totalWin, jackpotsOk ? "" : "jackpots " + JSON.stringify(got.jackpotHits) + " vs " + JSON.stringify(v.jackpotHits)); }
}
for (const m of doc.meters || []) {
  checked++;
  const got = await Fair.meter(m.seed, m.minSats, m.maxSats);
  const win = await Fair.verifyMeterWin({ ...m, tier: "major", amount: m.target });
  const mine = m.displayScale != null   // a D40 / D41 vector
    ? { seedHash: got.seedHash, target: got.target, displayScale: got.legacy.displayScale, startSats: got.legacy.startSats }
    : { seedHash: got.seedHash, target: got.target, startSats: got.startSats };
  if (!same(mine, { seedHash: m.seedHash, target: m.target, displayScale: m.displayScale, startSats: m.startSats }) || !win.ok) {
    failed++; console.log("METER MISMATCH", m.seed.slice(0, 12), JSON.stringify(got));
  }
}
for (const r of doc.roulette || []) {
  checked++;
  const got = await Fair.roulette(r.seed, r.roundId, r.bets, r.rules || 1);
  if (!same({ seedHash: got.seedHash, number: got.number, spinSeconds: got.spinSeconds, golden: got.golden, payouts: got.payouts },
             { seedHash: r.seedHash, number: r.number, spinSeconds: r.spinSeconds, golden: r.rules === 2 ? r.golden : null, payouts: r.payouts })) {
    failed++; console.log("ROULETTE MISMATCH round", r.roundId, JSON.stringify(got));
  }
}
console.log(`${checked - failed}/${checked} vectors verified` + (failed ? `, ${failed} FAILED` : ""));
process.exit(failed ? 1 : 0);
