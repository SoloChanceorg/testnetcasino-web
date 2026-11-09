#!/usr/bin/env node
/*
 * Smoke tests for TestnetCasino.com: every page in headless Chrome against a fake API.
 *
 *   node tools/check/smoke.mjs
 *
 * Needs Node 22+ (built-in WebSocket) and Google Chrome or Chromium (set CHROME=/path/to/chrome
 * if it is not found). No live API and no CORS settings are needed: the script serves the site
 * itself and answers every https://api.testnetcasino.com request from fixtures (real game
 * configs and real spin results from the backend's test vectors, in tools/check/fixtures).
 *
 * Checks: shared blocks in sync (tools/site.mjs check), every local link resolves, every page
 * loads without errors or sideways scroll (signed in on desktop, signed out on a phone), a spin
 * in each game, the full-screen fit after a spin, reels stopping one by one (and STOP), the withdrawals total, the leaderboards
 * "jump to my position", the account withdraw lock, the fairness verifier and the progressive
 * jackpots (machines, jackpots won by someone else, a jackpot spin, the lobby, the jackpots page
 * with Verify, the jackpot checker on the fairness page).
 * Exit code 0 = all passed.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const FIX = path.join(HERE, "fixtures");
const GAMES = ["fruit-orchard", "deep-sea", "cosmic-voyage"];
const PAGES = ["index.html", "login.html", "account.html", "fairness.html", "leaderboards.html", "jackpots.html", "withdrawals.html",
  ...GAMES.map((g) => `games/${g}.html`)];
const CONFIGS = Object.fromEntries(GAMES.map((g) => [g, fs.readFileSync(path.join(FIX, `config-${g}.json`), "utf8")]));
const SPINS = JSON.parse(fs.readFileSync(path.join(FIX, "spins.json"), "utf8"));
const METERS = JSON.parse(fs.readFileSync(path.join(FIX, "meters.json"), "utf8"));   // backend meter vectors
const ADDR = "bchtest:qphp0rfnp6uyjfh5p235r8lwykv6knknfqqw5ghdxy";

if (typeof WebSocket === "undefined") { console.error("Needs Node 22 or newer (built-in WebSocket)."); process.exit(2); }

/* ═══════════════ Results ═══════════════ */
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
}

/* ═══════════════ Static server for the site ═══════════════ */
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".png": "image/png", ".json": "application/json", ".pdf": "application/pdf", ".ico": "image/x-icon", ".txt": "text/plain" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  res.end(req.method === "HEAD" ? undefined : fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

/* ═══════════════ Fake API ═══════════════ */
const api = {};
function resetApi() {
  Object.assign(api, {
    user: null, balance: 50000, bonus: { available: false, amount: 1000, nextClaimAt: new Date(Date.now() + 3600e3).toISOString() },
    spinQueue: [], payouts: [], leaderboards: null, jackpotCalls: 0,
    jackpots: { grand: { amount: 121994, maxAmount: 10000000, cycle: 3, seedHash: "a".repeat(64) },
      games: Object.fromEntries(GAMES.map((g, i) => [g, { minor: { fill: 8.1 + i, cycle: 12, seedHash: "b".repeat(64) },
        major: { amount: 45678 + i, maxAmount: 500000, cycle: 2, seedHash: "c".repeat(64) } }])),
      recentWins: [], updatedAt: new Date().toISOString() }
  });
}
resetApi();
function handle(method, url, body) {
  const p = url.pathname;
  const cfg = /^\/games\/([\w-]+)\/config$/.exec(p);
  if (cfg && CONFIGS[cfg[1]]) return [200, CONFIGS[cfg[1]]];
  switch (p) {
    case "/faucet": return [200, { wallet: 111044000000, house: 111043000000, users: 97981, pendingWithdrawals: 0,
      players: { allTime: 18, withBalance: 13, last24h: 14, last30d: 17 }, updatedAt: new Date().toISOString() }];
    case "/me": return api.user ? [200, { user: api.user, balance: api.balance, dailyBonus: api.bonus }] : [401, { error: "unauthorized", message: "Sign in first." }];
    case "/auth/logout": api.user = null; return [204, null];
    case "/spins":
      if (method === "POST") {
        const v = api.spinQueue.shift();
        if (!v) return [500, { error: "internal_error", message: "No spin queued in the test." }];
        // Meter wins queued by a test are paid like the live server does it: "jackpot" steps at
        // the end (smallest first), jackpotWin, the balance includes them, and the meters move on.
        const steps = v.steps.slice(); let jackpotWin = 0;
        for (const w of v.meterWins || []) {
          steps.push({ type: "jackpot", pool: w.pool, win: w.win }); jackpotWin += w.win;
          const m = w.pool === "grand" ? api.jackpots.grand : api.jackpots.games[v.gameId][w.pool];
          m.cycle++;
          if (w.pool === "minor") m.fill = 0.4; else m.amount = 3017;   // a new cycle: empty pot, or a head start
          api.jackpots.recentWins.unshift({ pool: w.pool === "grand" ? "grand" : w.pool + ":" + v.gameId, tier: w.pool, gameId: v.gameId,
            player: "bchtest:qphp...hdxy", amount: w.win, wonAt: new Date().toISOString() });
        }
        api.balance += v.totalWin - v.bet + jackpotWin;
        return [200, { spinId: 1, gameId: v.gameId, gameVersion: v.gameVersion, bet: v.bet, nonce: v.nonce, serverSeedHash: v.serverSeedHash,
          clientSeed: v.clientSeed, steps, totalWin: v.totalWin, jackpotWin, balance: api.balance }];
      }
      return [200, { items: [], nextCursor: null }];
    case "/fairness/seed": return [200, { serverSeedHash: "ab".repeat(32), clientSeed: "smoke-test", nonce: 0 }];
    case "/withdrawals": return [200, { items: [] }];
    case "/ledger": return [200, { items: [], nextCursor: null }];
    case "/faucet/withdrawals": return [200, { items: api.payouts, nextCursor: null }];
    case "/jackpots": api.jackpotCalls++; return [200, api.jackpots];
    case "/leaderboards": return [200, api.leaderboards || { balances: [], wins24h: [], wins30d: [], winsAllTime: [], withdrawals24h: [], withdrawals30d: [], withdrawalsAllTime: [], updatedAt: new Date().toISOString() }];
    default: return [404, { error: "not_found", message: "Not found." }];
  }
}

/* ═══════════════ Chrome over the DevTools protocol ═══════════════ */
function findChrome() {
  const c = [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].filter(Boolean);
  const hit = c.find((p) => fs.existsSync(p));
  if (!hit) { console.error("Chrome not found. Set CHROME=/path/to/chrome."); process.exit(2); }
  return hit;
}
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "tnc-smoke-"));
const port = await new Promise((r) => { const s = http.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const chrome = spawn(findChrome(), ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--hide-scrollbars",
  "--force-prefers-reduced-motion", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
let targets;
for (let i = 0; i < 100 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { await sleep(150); } }
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0; const pending = new Map(); let pageErrors = [];
const CORS = [{ name: "Access-Control-Allow-Origin", value: ORIGIN }, { name: "Access-Control-Allow-Credentials", value: "true" },
  { name: "Access-Control-Allow-Headers", value: "x-requested-with,content-type,accept" }, { name: "Access-Control-Allow-Methods", value: "GET,POST" }];
function send(method, params = {}) { return new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); }); }
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") pageErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") pageErrors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
  if (m.method === "Fetch.requestPaused") {
    const r = m.params.request, u = new URL(r.url);
    if (r.method === "OPTIONS") return send("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: 204, responseHeaders: CORS, body: "" });
    const [status, body] = handle(r.method, u, r.postData);
    const text = body == null ? "" : typeof body === "string" ? body : JSON.stringify(body);
    send("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: status,
      responseHeaders: CORS.concat(text ? [{ name: "Content-Type", value: "application/json" }] : []), body: Buffer.from(text).toString("base64") });
  }
};
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function ev(expr) {
  const o = (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result;
  if (o.exceptionDetails) throw new Error("evaluate: " + (o.exceptionDetails.exception?.description || o.exceptionDetails.text));
  return o.result?.value;
}
async function until(expr, ms = 8000) { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr)) return true; await sleep(120); } return false; }
await send("Runtime.enable"); await send("Page.enable");
await send("Fetch.enable", { patterns: [{ urlPattern: "https://api.testnetcasino.com/*" }] });

async function open(page, width, opts = {}) {
  await send("Emulation.setDeviceMetricsOverride", { width, height: opts.height || 900, deviceScaleFactor: 1, mobile: width < 600 });
  await send("Page.navigate", { url: `${ORIGIN}/${page}${opts.hash || ""}` });
  await sleep(300);
  await ev(`try { localStorage.setItem("tnc.music.open", "false") } catch (e) {}`);
  pageErrors = [];
  await send("Page.reload");
  await until(`document.readyState === "complete"`);
  await sleep(opts.settle || 900);
}
function signIn(balance = 50000) { api.user = { id: "smoke-user", method: "wallet", address: ADDR }; api.balance = balance; }

try {
  /* ═══ 1. Shared blocks in sync ═══ */
  let inSync = true;
  try { execFileSync(process.execPath, [path.join(ROOT, "tools", "site.mjs"), "check"], { stdio: "pipe" }); } catch { inSync = false; }
  check("shared header, nav and footer are in sync (tools/site.mjs check)", inSync);

  /* ═══ 2. Every local link resolves ═══ */
  const missing = [];
  for (const p of PAGES) {
    const html = fs.readFileSync(path.join(ROOT, p), "utf8");
    for (const m of html.matchAll(/(?:href|src)="([^"#]+)/g)) {
      const ref = m[1];
      if (/^(https?:|mailto:|data:|\/\/)/.test(ref)) continue;
      const u = new URL(ref, `${ORIGIN}/${p}`);
      const r = await fetch(u, { method: "HEAD" });
      if (r.status !== 200) missing.push(`${p} -> ${ref}`);
    }
  }
  check("every local link and asset resolves", !missing.length, missing.slice(0, 5).join(", "));

  /* ═══ 3. Every page loads cleanly ═══ */
  for (const [label, width, signed] of [["desktop, signed in", 1280, true], ["phone, signed out", 375, false]]) {
    for (const p of PAGES) {
      resetApi(); if (signed) signIn();
      await open(p, width);
      const info = await ev(`({ sw: document.documentElement.scrollWidth, iw: innerWidth,
        nav: document.querySelectorAll('.nav-bar [aria-current="page"]').length, footer: !!document.querySelector(".casino-footer .cf-links"),
        faucet: (document.querySelector('#faucet-bar [data-k="house"]') || {}).textContent || "",
        signedIn: !!document.querySelector(".auth-user") })`);
      const problems = [];
      if (pageErrors.length) problems.push("errors: " + pageErrors.slice(0, 2).join(" | "));
      if (info.sw > info.iw) problems.push(`sideways scroll ${info.sw}px > ${info.iw}px`);
      // The account and sign-in pages have no nav chip of their own: the account chip marks
      // the account page when signed in, the "Sign in" chip marks the sign-in page when signed out.
      const expectCurrent = !((p === "account.html" && !signed) || (p === "login.html" && signed));
      if (expectCurrent && info.nav < 1) problems.push("no current page in the nav");
      if (!info.footer) problems.push("no footer");
      if (!/tBCH/.test(info.faucet)) problems.push("faucet bar not filled");
      if (info.signedIn !== signed) problems.push(signed ? "not shown as signed in" : "shown as signed in");
      check(`${p} loads (${label})`, !problems.length, problems.join("; "));
    }
  }

  /* ═══ 4. A spin in each game, then the full-screen fit ═══ */
  for (const g of GAMES) {
    resetApi(); signIn(500000);
    const v = SPINS[g];
    api.spinQueue.push(v);
    await open(`games/${g}.html`, 1280);
    await until(`!!document.getElementById("spin-btn") && !document.getElementById("spin-btn").disabled`);
    const before = await ev(`Math.round(document.getElementById("spin-btn").getBoundingClientRect().top + scrollY)`);
    await ev(`(() => { const b = document.getElementById("bet-input"); b.value = ${v.bet}; b.dispatchEvent(new Event("change")); document.getElementById("spin-btn").click(); })()`);
    await sleep(500);
    const done = await until(`document.getElementById("spin-btn").getAttribute("aria-busy") === "false"`, 60000);
    const after = await ev(`({ spinTop: Math.round(document.getElementById("spin-btn").getBoundingClientRect().top + scrollY),
      meter: document.getElementById("meter-bal").textContent, wins: document.querySelectorAll("#breakdown .bd-item").length,
      header: TNC_Auth.balance })`);
    const problems = [];
    if (!done) problems.push("spin did not finish");
    if (after.header !== api.balance) problems.push(`balance ${after.header} != server ${api.balance}`);
    if (after.meter.replace(/\D/g, "") !== String(api.balance)) problems.push(`meter shows ${after.meter}`);
    if (v.totalWin > 0 && !after.wins) problems.push("no wins listed under the reels");
    if (after.spinTop !== before) problems.push(`spin button moved ${after.spinTop - before}px`);
    if (pageErrors.length) problems.push("errors: " + pageErrors.slice(0, 2).join(" | "));
    check(`${g}: a spin plays and settles the balance`, !problems.length, problems.join("; "));

    await ev(`document.body.classList.add("is-fullscreen"); document.documentElement.classList.add("is-fullscreen"); scrollTo(0, 0); dispatchEvent(new Event("resize"))`);
    await sleep(400);
    const fit = await ev(`(() => { const m = document.getElementById("slot-machine"), r = m.getBoundingClientRect(), b = { t: r.top, l: r.left, r: r.right, b: r.bottom };
      (function w(p) { for (let el = p.firstElementChild; el; el = el.nextElementSibling) { if (el.hidden) continue; const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") continue; const q = el.getBoundingClientRect();
        if (q.width || q.height) { b.t = Math.min(b.t, q.top); b.l = Math.min(b.l, q.left); b.r = Math.max(b.r, q.right); b.b = Math.max(b.b, q.bottom); }
        if (cs.overflowX === "visible" && cs.overflowY === "visible") w(el); } })(m);
      return { top: b.t, left: b.l, right: innerWidth - b.r, bottom: innerHeight - b.b, overflow: getComputedStyle(document.documentElement).overflow }; })()`);
    const tight = Math.min(fit.top, fit.left, fit.right, fit.bottom);
    check(`${g}: full screen fits after a spin`, tight >= 6 && tight <= 14 && fit.overflow === "hidden", `tightest gap ${Math.round(tight)}px`);
    await ev(`document.body.classList.remove("is-fullscreen", "fs-no-jukebox"); document.documentElement.classList.remove("is-fullscreen"); dispatchEvent(new Event("resize"))`);
  }

  /* ═══ 4a. Reels stop one by one; STOP (button or Space) lands them early; a win holds the next spin ═══ */
  {
    resetApi(); signIn(500000);
    const v = SPINS["deep-sea"];   // one phase, a line win
    api.spinQueue.push(v, v);
    // Full motion for this page: the suite otherwise forces reduced motion, which shortens every timing.
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
    await open("games/deep-sea.html", 1280);
    await until(`!!document.getElementById("spin-btn") && !document.getElementById("spin-btn").disabled`);
    // Record when each reel lands (its bounce) and when the machine is ready again.
    await ev(`(() => { window.__t = { land: [], ready: 0 };
      document.querySelectorAll(".reel-strip").forEach((s, i) => new MutationObserver(() => {
        if (s.classList.contains("bounce") && window.__t.land[i] == null) window.__t.land[i] = performance.now(); }).observe(s, { attributes: true, attributeFilter: ["class"] }));
      const b = document.getElementById("spin-btn");
      new MutationObserver(() => { if (b.getAttribute("aria-busy") === "false") window.__t.ready = performance.now(); }).observe(b, { attributes: true, attributeFilter: ["aria-busy"] });
      const i = document.getElementById("bet-input"); i.value = ${v.bet}; i.dispatchEvent(new Event("change"));
      window.__t.start = performance.now(); b.click(); })()`);
    await until(`window.__t.ready > 0`, 20000);
    const a = await ev(`window.__t`);
    const gaps = a.land.slice(1).map((t, i) => Math.round(t - a.land[i]));
    const hold = Math.round(a.ready - Math.max(...a.land));
    check("deep-sea: reels stop one by one", a.land.length === 5 && gaps.every((x) => x >= 300),
      `stops ${Math.round(a.land[0] - a.start)} ms after the press, then ${gaps.join(" / ")} ms apart`);
    check("deep-sea: a win holds the next spin until its animations end", hold >= 1100, `ready ${hold} ms after the last reel`);

    // Second spin: STOP after 300 ms with Space.
    await ev(`(() => { window.__t = { land: [], ready: 0, start: performance.now() }; document.getElementById("spin-btn").click(); })()`);
    await sleep(300);
    const label = await ev(`document.getElementById("spin-sub").textContent + " / " + document.getElementById("spin-btn").disabled`);
    await ev(`(() => { window.__t.stop = performance.now(); document.body.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true })); })()`);
    await until(`window.__t.ready > 0`, 20000);
    const b = await ev(`window.__t`);
    const after = Math.round(Math.max(...b.land) - b.stop);
    const bal = await ev(`TNC_Auth.balance`);
    check("deep-sea: STOP lands the reels at once (display only)", label === "STOP / false" && b.land.length === 5 && after < 800 && bal === api.balance,
      `button "${label}", last reel ${after} ms after Space, balance ${bal}`);    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  }

  /* ═══ 4b. Jackpots on the machines, a jackpot won by someone else, and a jackpot spin ═══ */
  for (const g of GAMES) {
    resetApi(); signIn();
    await open(`games/${g}.html`, 1280);
    // Three rows at the very top of the machine: GRAND and MAJOR as amounts in the machine's unit
    // (tSats by default) with "Must hit by", MINOR as a coin pot (a level, never an amount).
    const major = (45678 + GAMES.indexOf(g)).toLocaleString("en-US"), minorFill = 8.1 + GAMES.indexOf(g);
    const rows = await until(`(() => { const top = document.getElementById("slot-machine").firstElementChild, rows = top ? top.querySelectorAll(".jp-row") : [];
      const txt = (r, sel) => (r.querySelector(sel) || {}).textContent;
      const pot = rows[2] && rows[2].querySelector('[data-meter="minor:${g}"]');
      return top.classList.contains("jp-rows") && rows.length === 3
        && rows[0].matches(".jp-row-grand") && txt(rows[0], '[data-jackpot="grand"]') === "121,994 tSats" && txt(rows[0], '[data-jackpot-max="grand"]') === "Must hit by 10,000,000 tSats"
        && rows[1].matches(".jp-row-major") && txt(rows[1], '[data-jackpot="major:${g}"]') === "${major} tSats" && txt(rows[1], '[data-jackpot-max="major:${g}"]') === "Must hit by 500,000 tSats"
        && rows[2].matches(".jp-row-minor") && pot && pot.getAttribute("role") === "meter" && +pot.getAttribute("aria-valuenow") === ${minorFill}
        && parseFloat(pot.querySelector(".pot-coins").style.height) === ${minorFill} && !/\\d/.test(pot.textContent); })()`);
    await ev(`document.getElementById("unit-switch").click()`);
    const bch = await ev(`document.querySelector('.jp-rows [data-jackpot="grand"]').textContent === "0.00121994 tBCH" && document.querySelector('.jp-rows [data-jackpot-max="grand"]').textContent === "Must hit by 0.10000000 tBCH"`);
    await ev(`document.getElementById("unit-switch").click()`);   // back to tSats
    check(`${g}: GRAND and MAJOR amounts with "Must hit by" (tSats / tBCH switch), MINOR coin pot`, rows && bch);
  }
  {
    // Someone else wins the Deep Sea Major and Minor: their cycles go up between two readings.
    resetApi(); signIn();
    await open("games/deep-sea.html", 1280);
    await until(`document.querySelector('[data-jackpot="major:deep-sea"]').textContent === "45,679 tSats"`);
    api.jackpots.games["deep-sea"].major = { amount: 2410, maxAmount: 500000, cycle: 3, seedHash: "d".repeat(64) };
    api.jackpots.games["deep-sea"].minor = { fill: 0.6, cycle: 13, seedHash: "e".repeat(64) };
    await ev(`TNC_Jackpots.refresh()`);
    const flash = await until(`document.querySelector('[data-jackpot="major:deep-sea"]').textContent === "WON!" && document.querySelector('[data-meter="minor:deep-sea"]').classList.contains("pot-burst")`, 3000);
    const after = await until(`document.querySelector('[data-jackpot="major:deep-sea"]').textContent === "2,410 tSats" && document.querySelector('[data-meter="minor:deep-sea"]').getAttribute("aria-valuenow") === "0.6"`, 4000);
    check("jackpots won by someone else: WON! then the new smaller Major, the pot bursts then starts nearly empty", flash && after);
  }
  {
    // Our own spin wins the Minor and the Major: two celebrations in order (amounts in tBCH, the pot
    // bursts), and nothing on the jackpots gives the win away while the reels turn.
    resetApi(); signIn(500000);
    const v = { ...SPINS.jackpot, meterWins: [{ pool: "minor", win: 3290 }, { pool: "major", win: 41500 }] }, g = v.gameId;
    api.spinQueue.push(v);
    await open(`games/${g}.html`, 1280);
    await until(`!!document.getElementById("spin-btn") && !document.getElementById("spin-btn").disabled && document.querySelector('[data-jackpot="major:${g}"]').textContent === "45,678 tSats"`);
    const callsBefore = api.jackpotCalls;
    await ev(`(() => { window.__lcd = []; new MutationObserver(() => { const t = document.getElementById("lcd-main").textContent; if (/JACKPOT!/.test(t) && window.__lcd[window.__lcd.length - 1] !== t) window.__lcd.push(t); })
      .observe(document.getElementById("lcd-main"), { childList: true, characterData: true, subtree: true });
      const b = document.getElementById("bet-input"); b.value = ${v.bet}; b.dispatchEvent(new Event("change")); document.getElementById("spin-btn").click(); })()`);
    await sleep(600);
    await ev(`TNC_Jackpots.refresh()`);   // a poll while the reels turn must not give the win away
    await sleep(300);
    const spoiler = await ev(`document.querySelector('[data-jackpot="major:${g}"]').textContent + " / " + document.querySelector('[data-meter="minor:${g}"]').getAttribute("aria-valuenow")`);
    const minorShow = await until(`/MINOR JACKPOT/.test(document.getElementById("wb-title").textContent) && document.getElementById("wb-amount").textContent === "0.00003290 tBCH"
      && document.querySelector('[data-meter="minor:${g}"]').classList.contains("pot-burst")`, 30000);
    const majorShow = await until(`/MAJOR JACKPOT/.test(document.getElementById("wb-title").textContent) && document.getElementById("wb-amount").textContent === "0.00041500 tBCH"`, 30000);
    const done = await until(`document.getElementById("spin-btn").getAttribute("aria-busy") === "false"`, 60000);
    const after = await until(`/WON!|3,017 tSats/.test(document.querySelector('[data-jackpot="major:${g}"]').textContent)`, 5000);
    const st = await ev(`({ header: TNC_Auth.balance, lcd: window.__lcd, history: [...document.querySelectorAll("#history li")].slice(0, 2).map(l => l.textContent) })`);
    const problems = [];
    if (spoiler !== "45,678 tSats / 8.1") problems.push(`jackpots showed ${spoiler} while the reels turned`);
    if (!minorShow) problems.push("no MINOR JACKPOT banner in tBCH with the pot bursting");
    if (!majorShow) problems.push("no MAJOR JACKPOT banner in tBCH");
    if (!(st.lcd.length === 2 && /^MINOR/.test(st.lcd[0]) && /^MAJOR/.test(st.lcd[1]))) problems.push("celebrations: " + JSON.stringify(st.lcd));
    if (!done) problems.push("spin did not finish");
    if (st.header !== api.balance) problems.push(`balance ${st.header} != server ${api.balance}`);
    if (!(/Major jackpot/.test(st.history[0]) && /Minor jackpot/.test(st.history[1]))) problems.push("history: " + JSON.stringify(st.history));
    if (api.jackpotCalls <= callsBefore) problems.push("jackpots not read after the spin");
    if (!after) problems.push("the Major did not move on after the spin");
    if (pageErrors.length) problems.push("errors: " + pageErrors.slice(0, 2).join(" | "));
    check("jackpot spin: Minor (pot bursts) then Major celebrations in tBCH, balance, history, jackpots after the spin only", !problems.length, problems.join("; "));
  }
  {
    resetApi();
    await open("index.html", 1280);
    const lobby = await until(`(() => { const hero = document.querySelector("#floor .jp-hero"), cards = [...document.querySelectorAll(".game-card")];
      return hero && hero.querySelector('[data-jackpot="grand"]').textContent === "0.00121994 tBCH" && hero.querySelector('[data-jackpot-max="grand"]').textContent === "Must hit by 0.10000000 tBCH"
        && cards.length === 3 && cards.every(c => /^0\\.000456(7[89]|80) tBCH$/.test(c.querySelector('.gc-jp .jp-row-major [data-jackpot^="major:"]').textContent)
          && c.querySelector('.gc-jp .jp-row-minor [data-meter^="minor:"]').getAttribute("role") === "meter")
        && !!hero.querySelector('a[href="jackpots.html"]'); })()`);
    check("lobby: Grand amount with Must hit by, Major amount and Minor coin pot on every card", lobby);

    // Jackpots page: amounts, pots, seed hashes, and wins: a real one (Verify passes), a tampered one (fails), an old one.
    const real = METERS[0], bad = { ...METERS[1], target: METERS[1].target + 1 };
    api.jackpots.recentWins = [
      { pool: "minor:deep-sea", tier: "minor", gameId: "deep-sea", player: "Passkey 3f9a2c", amount: real.target + 75, wonAt: new Date().toISOString(), cycle: 11, ...real, startSats: 0 },
      { pool: "major:cosmic-voyage", tier: "major", gameId: "cosmic-voyage", player: "Passkey 77aa01", amount: bad.target + 10, wonAt: new Date().toISOString(), cycle: 2, ...bad },
      { pool: "grand", gameId: "deep-sea", player: "bchtest:qphp...hdxy", amount: 102012345, wonAt: new Date(Date.now() - 86400e3).toISOString() }];
    await open("jackpots.html", 1280);
    const page = await until(`(() => { const amounts = document.querySelectorAll(".jpp-pools [data-jackpot]"), maxes = document.querySelectorAll(".jpp-pools [data-jackpot-max]"),
        pots = document.querySelectorAll(".jpp-pools [data-meter]"), rows = document.querySelectorAll("#jp-wins-body tr");
      return amounts.length === 4 && [...amounts].every(a => /^0\\.\\d{8} tBCH$/.test(a.textContent)) && [...maxes].every(m => /^Must hit by /.test(m.textContent)) && pots.length === 3
        && rows.length === 3 && document.querySelectorAll("#jp-hashes > div").length === 7 && /0\\.00003290 tBCH/.test(rows[0].textContent)
        && rows[0].querySelector(".jpw-verify") && rows[1].querySelector(".jpw-verify") && !rows[2].querySelector(".jpw-verify") && /Old jackpot/.test(rows[2].textContent); })()`);
    await ev(`document.querySelectorAll("#jp-wins-body .jpw-verify")[0].click()`);
    const pass = await until(`(() => { const d = document.querySelector("#jp-wins-body tr.jpw-detail"); return d && /This win is fair/.test(d.textContent) && d.querySelectorAll(".jpw-checks .is-ok").length === 3; })()`, 5000);
    await ev(`document.querySelectorAll("#jp-wins-body .jpw-verify")[1].click()`);
    const fail = await until(`(() => { const d = document.querySelectorAll("#jp-wins-body tr.jpw-detail")[1]; return d && /does NOT check out/.test(d.textContent) && d.querySelectorAll(".jpw-checks .is-bad").length === 1; })()`, 5000);
    resetApi();
    await open("jackpots.html", 375);
    const empty = await until(`!document.getElementById("jp-winners-empty").hidden && document.querySelectorAll("#jp-wins-body tr").length === 0`);
    check("jackpots page: amounts, coin pots, seed hashes, wins with Verify (real passes, tampered fails, old has none), empty state", page && pass && fail && empty,
      `page ${!!page}, verify ${!!pass}, tampered ${!!fail}, empty ${!!empty}`);
  }

  /* ═══ 5. Withdrawals page: whole list and total ═══ */
  resetApi();
  api.payouts = [1000, 2500, 107, 99999].map((a, i) => ({ sentAt: new Date(Date.now() - i * 3600e3).toISOString(), address: ADDR, amount: a, txid: String(i).repeat(64) }));
  await open("withdrawals.html", 1280);
  const total = await ev(`({ rows: document.querySelectorAll("#pay-body tr").length, title: document.getElementById("pay-total").title })`);
  check("withdrawals page lists every withdrawal and the right total", total.rows === 4 && total.title === "103,606 sats", `${total.rows} rows, ${total.title}`);

  /* ═══ 6. Leaderboards: jump to my position ═══ */
  resetApi(); signIn();
  const board = Array.from({ length: 400 }, (_, i) => ({ rank: i + 1, player: `Passkey ${(0x100000 + i).toString(16).slice(-6)}`, method: "passkey", amount: 1e6 - i }));
  board[299].me = true;
  api.leaderboards = { balances: board, wins24h: [], wins30d: [], winsAllTime: [], withdrawals24h: [], withdrawals30d: [], withdrawalsAllTime: [], updatedAt: new Date().toISOString() };
  await open("leaderboards.html", 1280);
  const jumpShown = await until(`(() => { const j = document.querySelector("#lb-panel-balances .lb-jump"); return j && !j.hidden && /#300/.test(j.textContent); })()`);
  await ev(`document.querySelector("#lb-panel-balances .lb-jump").click()`);
  const jumped = await until(`document.activeElement && document.activeElement.getAttribute("aria-current") === "true"`, 4000);
  check("leaderboards: jump to my position (#300)", jumpShown && jumped);

  /* ═══ 7. Account: withdraw form locks below the minimum ═══ */
  resetApi(); signIn(500);
  await open("account.html", 1280);
  const locked = await ev(`document.getElementById("wd-fields").disabled && !document.getElementById("wd-locked").hidden`);
  resetApi(); signIn(50000);
  await open("account.html", 1280);
  const unlocked = await ev(`!document.getElementById("wd-fields").disabled && document.getElementById("wd-locked").hidden`);
  check("account: withdraw form locked below 0.00001 tBCH, open above", locked && unlocked);

  /* ═══ 8. Fairness verifier replays a real spin ═══ */
  resetApi();
  await open("fairness.html", 1280);
  const fv = SPINS["cosmic-voyage"];
  await ev(`(() => { const f = (i, x) => document.getElementById(i).value = x; f("vf-game", "${fv.gameId}"); f("vf-bet", ${fv.bet});
    f("vf-seed", "${fv.serverSeed}"); f("vf-client", "${fv.clientSeed}"); f("vf-nonce", ${fv.nonce}); f("vf-expect", ${fv.totalWin});
    document.getElementById("vf-submit").click(); })()`);
  const verified = await until(`/✓ matches/.test(document.getElementById("vf-result").textContent)`, 10000);
  check("fairness: the in-browser verifier reproduces a real spin", verified);
  const jv = SPINS.jackpot;
  await ev(`(() => { const f = (i, x) => document.getElementById(i).value = x; f("vf-game", "${jv.gameId}"); f("vf-bet", ${jv.bet});
    f("vf-version", "${jv.gameVersion}"); f("vf-seed", "${jv.serverSeed}"); f("vf-client", "${jv.clientSeed}"); f("vf-nonce", ${jv.nonce}); f("vf-expect", ${jv.totalWin});
    document.getElementById("vf-submit").click(); })()`);
  const jpDraw = await until(`/Major hit/.test(document.getElementById("vf-result").textContent) && /Grand no hit/.test(document.getElementById("vf-result").textContent)`, 10000);
  check("fairness: the verifier reproduces an old (version 2) Major jackpot draw", jpDraw);
  const mv = METERS[2];
  await ev(`(() => { const f = (i, x) => document.getElementById(i).value = x; f("mt-tier", "grand"); document.getElementById("mt-tier").dispatchEvent(new Event("change"));
    f("mt-seed", "${mv.seed}"); f("mt-hash", "${mv.seedHash}"); f("mt-amount", ${mv.target});
    document.getElementById("mt-submit").click(); })()`);
  const meterOk = await until(`(() => { const t = document.getElementById("mt-result").textContent;
    return /Every check passed/.test(t) && t.includes("${mv.target.toLocaleString("en-US")} tSats") && t.includes("${mv.displayScale.toLocaleString("en-US")} tSats")
      && t.includes("Head start${mv.startSats.toLocaleString("en-US")} tSats") && t.includes("${mv.seedHash}"); })()`, 5000);
  check("fairness: the jackpot checker derives seed hash, target, display scale and head start from a seed", meterOk);
} catch (e) {
  check("test run", false, e.message);
} finally {
  ws.close(); chrome.kill(); server.close();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed.`);
process.exit(failed ? 1 : 0);
