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
 * jackpots (boards, a jackpot win, the lobby and the winners list).
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
const PAGES = ["index.html", "login.html", "account.html", "fairness.html", "leaderboards.html", "withdrawals.html",
  ...GAMES.map((g) => `games/${g}.html`)];
const CONFIGS = Object.fromEntries(GAMES.map((g) => [g, fs.readFileSync(path.join(FIX, `config-${g}.json`), "utf8")]));
const SPINS = JSON.parse(fs.readFileSync(path.join(FIX, "spins.json"), "utf8"));
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
    jackpots: { grand: 102012345, major: { "fruit-orchard": 10430000, "deep-sea": 10002000, "cosmic-voyage": 10001500 }, recentWins: [], updatedAt: new Date().toISOString() }
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
        // A jackpot hit (from the vector's jackpotHits) is paid like the live server does it:
        // extra "jackpot" steps at the end, jackpotWin, and the balance includes it.
        const steps = v.steps.slice(); let jackpotWin = 0;
        for (const pool of ["major", "grand"]) {
          if (!v.jackpotHits || !v.jackpotHits[pool]) continue;
          const win = pool === "grand" ? api.jackpots.grand : api.jackpots.major[v.gameId];
          steps.push({ type: "jackpot", pool, win }); jackpotWin += win;
          if (pool === "grand") api.jackpots.grand = 100000000; else api.jackpots.major[v.gameId] = 10000000;
          api.jackpots.recentWins.unshift({ pool: pool === "grand" ? "grand" : "major:" + v.gameId, gameId: v.gameId, player: "bchtest:qphp...hdxy", amount: win, wonAt: new Date().toISOString() });
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

  /* ═══ 4b. Progressive jackpots on the machines, and a jackpot win ═══ */
  for (const g of GAMES) {
    resetApi(); signIn();
    await open(`games/${g}.html`, 1280);
    const board = await until(`(() => { const m = document.querySelector('.jp-board [data-jackpot="major:${g}"]'), gr = document.querySelector('.jp-board [data-jackpot="grand"]');
      return m && gr && /^[\\d,]{10,} tSats$/.test(m.textContent) && /^[\\d,]{11,} tSats$/.test(gr.textContent); })()`);
    check(`${g}: Major and Grand shown on the machine (tSats)`, board);
  }
  {
    // The pools follow the unit switch (tBCH = 8 decimals) and grow with the player's own bet at once.
    resetApi(); signIn(500000);
    const v = SPINS["fruit-orchard"], g = v.gameId;
    api.spinQueue.push(v);
    await open(`games/${g}.html`, 1280);
    await until(`!!document.getElementById("spin-btn") && !document.getElementById("spin-btn").disabled && /tSats/.test(document.querySelector(".jp-board .jp-val").textContent)`);
    await ev(`document.getElementById("unit-switch").click()`);
    const read = `[...document.querySelectorAll(".jp-board .jp-val")].map(e => e.textContent)`;
    const before = await ev(read), bet = 1000;   // big enough to move both pools by whole sats
    await ev(`(() => { const b = document.getElementById("bet-input"); b.value = ${bet}; b.dispatchEvent(new Event("change")); document.getElementById("spin-btn").click(); })()`);
    await until(`document.getElementById("spin-btn").getAttribute("aria-busy") === "false"`, 60000);
    await until(`false`, 1200);   // let the count-up finish
    const after = await ev(read);
    await ev(`document.getElementById("unit-switch").click()`);   // back to tSats for the next checks
    const sats = (t) => Math.round(parseFloat(t.replace(/[^\d.]/g, "")) * 1e8);
    const cfg = JSON.parse(fs.readFileSync(path.join(FIX, `config-${g}.json`), "utf8")).jackpots;
    const wantMajor = sats(before[0]) + Math.round(bet * cfg.major.contributionBasisPoints / 10000);
    const problems = [];
    if (!before.every((t) => /^\d+\.\d{8} tBCH$/.test(t))) problems.push(`tBCH view: ${before.join(" | ")}`);
    if (sats(after[0]) !== wantMajor) problems.push(`Major ${after[0]}, expected ${(wantMajor / 1e8).toFixed(8)} tBCH`);
    const wantGrand = sats(before[1]) + Math.round(bet * cfg.grand.contributionBasisPoints / 10000);
    if (sats(after[1]) !== wantGrand) problems.push(`Grand ${after[1]}, expected ${(wantGrand / 1e8).toFixed(8)} tBCH`);
    check(`${g}: pools in tBCH (8 decimals) and grow with every spin`, !problems.length, problems.join("; "));
  }
  {
    resetApi(); signIn(500000);
    const v = SPINS.jackpot, major = api.jackpots.major[v.gameId];
    api.spinQueue.push(v);
    await open(`games/${v.gameId}.html`, 1280);
    await until(`!!document.getElementById("spin-btn") && !document.getElementById("spin-btn").disabled`);
    const callsBefore = api.jackpotCalls;
    await ev(`(() => { const b = document.getElementById("bet-input"); b.value = ${v.bet}; b.dispatchEvent(new Event("change")); document.getElementById("spin-btn").click(); })()`);
    const celebrated = await until(`/MAJOR JACKPOT/.test(document.getElementById("lcd-main").textContent)`, 60000);
    const done = await until(`document.getElementById("spin-btn").getAttribute("aria-busy") === "false"`, 60000);
    const st = await ev(`({ header: TNC_Auth.balance, history: document.querySelector("#history li").textContent,
      major: document.querySelector('.jp-board [data-jackpot="major:${v.gameId}"]').textContent })`);
    const problems = [];
    if (!celebrated) problems.push("no MAJOR JACKPOT celebration");
    if (!done) problems.push("spin did not finish");
    if (st.header !== api.balance) problems.push(`balance ${st.header} != server ${api.balance}`);
    if (!/Major jackpot/.test(st.history)) problems.push("jackpot not in the recent spins");
    if (api.jackpotCalls <= callsBefore) problems.push("pools not refreshed after the win");
    if (st.major !== "10,000,000 tSats") problems.push(`Major shows ${st.major} after the win`);
    if (pageErrors.length) problems.push("errors: " + pageErrors.slice(0, 2).join(" | "));
    check(`jackpot win: celebration, balance, history and pool refresh (${(major / 1e8).toFixed(4)} tBCH)`, !problems.length, problems.join("; "));
  }
  {
    resetApi();
    api.jackpots.recentWins = [{ pool: "grand", gameId: "deep-sea", player: "Passkey 3f9a2c", amount: 102012345, wonAt: new Date().toISOString() },
      { pool: "major:cosmic-voyage", gameId: "cosmic-voyage", player: "bchtest:qphp...hdxy", amount: 10430000, wonAt: new Date().toISOString() }];
    await open("index.html", 1280);
    const lobby = await until(`(() => { const g = document.querySelector('.jp-hero [data-jackpot="grand"]'); const majors = document.querySelectorAll('.game-card [data-jackpot^="major:"]');
      return g && /^1\\.0201\\d{4} tBCH$/.test(g.textContent) && majors.length === 3 && [...majors].every(m => /0\\.1\\d{3}/.test(m.textContent))
        && document.querySelectorAll("#jp-winners li").length === 2 && document.getElementById("jp-winners-empty").hidden; })()`);
    resetApi();
    await open("index.html", 375);
    const empty = await until(`!document.getElementById("jp-winners-empty").hidden && document.querySelectorAll("#jp-winners li").length === 0`);
    check("lobby: Grand, three Majors and the recent winners (and the empty state)", lobby && empty);
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
    f("vf-seed", "${jv.serverSeed}"); f("vf-client", "${jv.clientSeed}"); f("vf-nonce", ${jv.nonce}); f("vf-expect", ${jv.totalWin});
    document.getElementById("vf-submit").click(); })()`);
  const jpDraw = await until(`/Major hit/.test(document.getElementById("vf-result").textContent) && /Grand no hit/.test(document.getElementById("vf-result").textContent)`, 10000);
  check("fairness: the verifier reproduces a Major jackpot draw", jpDraw);
} catch (e) {
  check("test run", false, e.message);
} finally {
  ws.close(); chrome.kill(); server.close();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed.`);
process.exit(failed ? 1 : 0);
