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
 * source the fairness page uses. Needs Node 20+ (crypto.subtle, fetch).
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
const configs = {};
async function config(id, version) {
  if (!configs[id]) configs[id] = await (await fetch(`${API}/games/${id}/config`)).json();
  if (configs[id].version !== version) throw new Error(`${id}: API serves version ${configs[id].version}, vector needs ${version}`);
  return configs[id];
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
for (const v of doc.spins) {
  checked++;
  const game = await config(v.gameId, v.gameVersion);
  const got = await Fair.replay(game, v);
  // Compare everything the verifier rebuilds: grids, wins and every bonus / feature step.
  const want = v.steps.map((s) => s.type === "spin"
    ? { type: "spin", free: s.free, phases: s.phases.map((p) => ({ grid: p.grid, win: p.win })), win: s.win }
    : s.type === "bonus" ? { type: "bonus", bonus: s.bonus, prize: s.prize, win: s.win }
    : s.type === "freeSpinsStart" ? { type: s.type, spins: s.spins }
    : s.type === "retrigger" ? { type: s.type, added: s.added, spinsLeft: s.spinsLeft }
    : { type: s.type, played: s.played, win: s.win });
  const mine = got.steps.map((s) => s.type === "spin"
    ? { type: "spin", free: s.free, phases: s.phases, win: s.win }
    : s.type === "bonus" ? { type: "bonus", bonus: s.bonus, prize: s.prize, win: s.win }
    : s.type === "freeSpinsStart" ? { type: s.type, spins: s.spins }
    : s.type === "retrigger" ? { type: s.type, added: s.added, spinsLeft: s.spinsLeft }
    : { type: s.type, played: s.played, win: s.win });
  // Free-spin multipliers and bonus details too.
  const extra = v.steps.every((s, i) => {
    const m = got.steps[i];
    if (!m) return false;
    if (s.type === "spin" && s.free) return s.multiplier === m.multiplier && s.freeSpin === m.freeSpin;
    if (s.type === "bonus") return same([s.order, s.picks, s.index, s.level, s.boosts], [m.order, m.picks, m.index, m.level, m.boosts]);
    return true;
  });
  const ok = got.totalWin === v.totalWin && got.serverSeedHash === v.serverSeedHash && same(mine, want) && extra;
  if (!ok) { failed++; console.log("SPIN MISMATCH", v.gameId, "nonce", v.nonce, "expected", v.totalWin, "got", got.totalWin); }
}
console.log(`${checked - failed}/${checked} vectors verified` + (failed ? `, ${failed} FAILED` : ""));
process.exit(failed ? 1 : 0);
