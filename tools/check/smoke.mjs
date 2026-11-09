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
 * "jump to my position", the account withdraw lock, the fairness verifier (a spin, version 2 jackpot
 * draws, version 4 jackpots and rewards, the list with Verify all) and the jackpots and collectors (D43:
 * the machines, jackpots won and collectors filled by someone else, a jackpot won in each game,
 * every collector reward, the lobby, the jackpots page with Verify, the jackpot checker).
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
// The collectors in the fake: 57 of 186 leaves, 40 of 109 coins, 500 of 940 fuel cells.
const COLLECTOR = { "fruit-orchard": { filled: 57, size: 186 }, "deep-sea": { filled: 40, size: 109 }, "cosmic-voyage": { filled: 500, size: 940 } };
function resetApi() {
  Object.assign(api, {
    user: null, balance: 50000, bonus: { available: false, amount: 1000, nextClaimAt: new Date(Date.now() + 3600e3).toISOString() },
    spinQueue: [], payouts: [], leaderboards: null, jackpotCalls: 0,
    history: [],
    jackpots: { grand: { amount: 121994, cycle: 3, seedHash: "a".repeat(64) },
      games: Object.fromEntries(GAMES.map((g, i) => [g, { minor: { amount: 2310 + i, cycle: 12, seedHash: "b".repeat(64) },
        major: { amount: 45678 + i, cycle: 2, seedHash: "c".repeat(64) },
        collector: { filled: COLLECTOR[g].filled, size: COLLECTOR[g].size, cycle: 9 } }])),
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
        // Played like the live server: the jackpot step gets the meter's amount (v.jackpotWin, set by the
        // test), the collect step the collector's state; a `rewards` vector fills it and its reward follows.
        const g = api.jackpots.games[v.gameId], steps = []; let jackpotWin = 0, totalWin = v.totalWin;
        for (const st of v.steps) {
          if (st.type === "jackpot") {
            jackpotWin = v.jackpotWin || 1000;
            steps.push({ ...st, win: jackpotWin });
            const m = st.tier === "grand" ? api.jackpots.grand : g[st.tier];
            m.cycle++; m.amount = 3017;   // a new cycle with its head start
            api.jackpots.recentWins.unshift({ pool: st.tier === "grand" ? "grand" : st.tier + ":" + v.gameId, tier: st.tier, gameId: v.gameId,
              player: "bchtest:qphp...hdxy", amount: jackpotWin, wonAt: new Date().toISOString() });
          } else if (st.type === "collect") {
            const c = g.collector, full = !!v.reward;
            if (full) { steps.push({ ...st, filled: c.size, size: c.size, full: true, bet: v.rewardBet }); c.cycle++; c.filled = 0; }
            else { c.filled += st.cells.length; steps.push({ ...st, filled: c.filled, size: c.size, full: false }); }
          } else steps.push(st);
        }
        if (v.reward) { steps.push(...v.reward.steps); totalWin += v.reward.win; }
        api.balance += totalWin - v.bet + jackpotWin;
        return [200, { spinId: 1, gameId: v.gameId, gameVersion: v.gameVersion, bet: v.bet, nonce: v.nonce, serverSeedHash: v.serverSeedHash,
          clientSeed: v.clientSeed, steps, totalWin, jackpotWin, balance: api.balance }];
      }
      return [200, { items: api.history, nextCursor: null }];
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

  /* ═══ 4b. Jackpots and the collector on the machines; won or filled by someone else ═══ */
  const SIZES = Object.fromEntries(GAMES.map((g) => [g, JSON.parse(CONFIGS[g]).collector.size]));
  for (const g of GAMES) {
    resetApi(); signIn();
    await open(`games/${g}.html`, 1280);
    // At the very top of the machine: GRAND, then MAJOR and MINOR side by side, all amounts in the machine's
    // unit (tSats by default), no limits. Right of the reels, about 1.5 reels wide: the collector screen with
    // "filled / size" (a pile of floor(filled/size of 15) items, the Fuel Tank a level).
    const i = GAMES.indexOf(g), major = (45678 + i).toLocaleString("en-US"), minor = (2310 + i).toLocaleString("en-US"), c = COLLECTOR[g];
    const rows = await until(`(() => { const top = document.getElementById("slot-machine").firstElementChild, rows = top ? top.querySelectorAll(".jp-row") : [];
      const txt = (r, sel) => (r.querySelector(sel) || {}).textContent;
      const cl = document.querySelector('.reel-bay > .collector-screen[data-collector="${g}"]'), rw = document.getElementById("reels-window").getBoundingClientRect();
      const cs = cl && cl.getBoundingClientRect(), ratio = cs && cs.width / (rw.width / 5), pair = top.querySelector(".jp-pair");
      const tank = cl && cl.querySelector(".cl-level"), items = cl ? cl.querySelectorAll(".cl-pile .cl-item").length : -1;
      return top.classList.contains("jp-rows") && rows.length === 3
        && rows[0].matches(".jp-row-grand") && txt(rows[0], '[data-jackpot="grand"]') === "121,994 tSats"
        && pair && rows[1].matches(".jp-row-major") && txt(rows[1], '[data-jackpot="major:${g}"]') === "${major} tSats"
        && rows[2].matches(".jp-row-minor") && txt(rows[2], '[data-jackpot="minor:${g}"]') === "${minor} tSats"
        && Math.abs(rows[1].getBoundingClientRect().top - rows[2].getBoundingClientRect().top) < 2
        && !/Must hit|before it is full|reaches its limit|10,000|50,000|2,500,000/.test(top.textContent + document.querySelector(".paytable").textContent)
        && /RTP110% in all/.test(document.querySelector(".paytable .facts").textContent) && !/faucet boost|gift/i.test(document.querySelector(".paytable").textContent)
        && cl && cl.getAttribute("role") === "meter" && +cl.getAttribute("aria-valuenow") === ${c.filled} && +cl.getAttribute("aria-valuemax") === ${c.size}
        && cl.querySelector(".cl-count").textContent === "${c.filled} / ${c.size}"
        && (tank ? tank.style.getPropertyValue("--fill") === "${(c.filled / c.size * 100).toFixed(2)}%" : items === ${Math.floor(c.filled / c.size * 15)})
        && cs.left >= rw.right && Math.abs(cs.height - rw.height) < 2 && ratio > 1.2 && ratio < 1.8; })()`);
    await ev(`document.getElementById("unit-switch").click()`);
    const bch = await ev(`document.querySelector('.jp-rows [data-jackpot="grand"]').textContent === "0.00121994 tBCH" && document.querySelector('.jp-rows [data-jackpot="minor:${g}"]').textContent === "${(0.0000231 + i * 1e-8).toFixed(8)} tBCH"`);
    await ev(`document.getElementById("unit-switch").click()`);   // back to tSats
    check(`${g}: GRAND, MAJOR and MINOR amounts (tSats / tBCH switch), collector screen right of the reels, RTP 110%, no limits shown`, rows && bch);
  }
  {
    // Someone else wins the Deep Sea Major and fills its Treasure Chest: the cycles go up between two readings.
    resetApi(); signIn();
    await open("games/deep-sea.html", 1280);
    await until(`document.querySelector('[data-jackpot="major:deep-sea"]').textContent === "45,679 tSats"`);
    api.jackpots.games["deep-sea"].major = { amount: 2410, cycle: 3, seedHash: "d".repeat(64) };
    api.jackpots.games["deep-sea"].collector = { filled: 2, size: 109, cycle: 10 };
    await ev(`TNC_Jackpots.refresh()`);
    const flash = await until(`document.querySelector('[data-jackpot="major:deep-sea"]').textContent === "WON!" && document.querySelector('[data-collector="deep-sea"]').classList.contains("cl-is-full")`, 3000);
    const after = await until(`document.querySelector('[data-jackpot="major:deep-sea"]').textContent === "2,410 tSats" && document.querySelector('[data-collector="deep-sea"] .cl-count').textContent === "2 / 109"
      && !document.querySelector('[data-collector="deep-sea"]').classList.contains("cl-is-full") && document.querySelectorAll('[data-collector="deep-sea"] .cl-item').length === 0`, 4000);
    // Phones: the collector screen sits under the reels as a strip; MAJOR and MINOR stack.
    resetApi(); signIn();
    await open("games/deep-sea.html", 375);
    const strip = await until(`(() => { const cl = document.querySelector(".collector-screen").getBoundingClientRect(), rw = document.getElementById("reels-window").getBoundingClientRect();
      const r = document.querySelectorAll(".jp-pair .jp-row");
      return cl.top >= rw.bottom && Math.abs(cl.width - rw.width) < 2 && cl.height < 100 && document.querySelectorAll(".collector-screen .cl-item").length === 5
        && r[1].getBoundingClientRect().top > r[0].getBoundingClientRect().bottom - 1; })()`);
    check("jackpot won and collector filled by someone else: WON! then the new Major, FULL! then from empty; strip on phones", flash && after && strip,
      `flash ${!!flash}, after ${!!after}, strip ${!!strip}`);
  }

  // Plays one queued spin on a game page and records what the machine showed on the way.
  async function playQueued(g, v, opts = {}) {
    await open(`games/${g}.html`, 1280);
    await until(`!!document.getElementById("spin-btn") && !document.getElementById("spin-btn").disabled && document.querySelector('[data-jackpot="major:${g}"]').textContent === "${(45678 + GAMES.indexOf(g)).toLocaleString("en-US")} tSats"`);
    const callsBefore = api.jackpotCalls;
    await ev(`(() => { const R = window.__rec = { jp: 0, col: 0, clams: 0, wheel: null, pearls: 0, sign: [], lcd: [], banner: [], full: false, count: [] };
      const fxl = document.getElementById("cell-fx"), cl = document.querySelector(".collector-screen");
      new MutationObserver(() => {
        R.jp = Math.max(R.jp, fxl.querySelectorAll(".ov-jackpot").length); R.col = Math.max(R.col, fxl.querySelectorAll(".ov-collect").length);
        R.clams = Math.max(R.clams, document.querySelectorAll(".clam").length); R.pearls = Math.max(R.pearls, document.querySelectorAll(".hw-cell.pearl").length);
        const w = document.querySelector(".star-wheel .win-seg"); if (w) R.wheel = +w.getAttribute("data-i");
        const sg = document.getElementById("fs-sign").textContent; if (sg && R.sign[R.sign.length - 1] !== sg) R.sign.push(sg);
        const t = document.getElementById("lcd-main").textContent; if (R.lcd[R.lcd.length - 1] !== t) R.lcd.push(t);
        const bt = document.getElementById("wb-title").textContent + " | " + document.getElementById("wb-amount").textContent; if (document.getElementById("win-banner").classList.contains("show") && R.banner[R.banner.length - 1] !== bt) R.banner.push(bt);
        if (cl) { if (cl.classList.contains("cl-is-full")) R.full = true; const ct = cl.querySelector(".cl-count").textContent; if (R.count[R.count.length - 1] !== ct) R.count.push(ct); }
        // The jackpot stages: open the clams and spin the wheel like a player would.
        const clam = document.querySelector(".clam:not(:disabled)"); if (clam && !R.clicking) { R.clicking = true; setTimeout(() => { R.clicking = false; const c2 = document.querySelector(".clam:not(:disabled)"); if (c2) c2.click(); }, 120); }
        const wb = document.getElementById("wheel-btn"); if (wb && !wb.disabled) wb.click();
      }).observe(document.getElementById("slot-machine"), { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "style"] });
      const b = document.getElementById("bet-input"); b.value = ${v.bet}; b.dispatchEvent(new Event("change")); document.getElementById("spin-btn").click(); })()`);
    let spoiler = null;
    if (opts.spoilerCheck) {
      await sleep(500);
      await ev(`TNC_Jackpots.refresh()`);   // a poll while the reels turn must not give the win away
      await sleep(250);
      spoiler = await ev(`document.querySelector('[data-jackpot="major:${g}"]').textContent + " / " + document.querySelector('[data-jackpot="minor:${g}"]').textContent`);
    }
    const done = await until(`document.getElementById("spin-btn").getAttribute("aria-busy") === "false"`, opts.timeout || 90000);
    await sleep(300);
    const st = await ev(`({ rec: window.__rec, header: TNC_Auth.balance, history: [...document.querySelectorAll("#history li")].map(l => l.textContent),
      count: (document.querySelector(".collector-screen .cl-count") || {}).textContent })`);
    return { done, spoiler, ...st, calls: api.jackpotCalls - callsBefore };
  }
  const SIGN = { orchard: "fruit-orchard", deepsea: "deep-sea", cosmic: "cosmic-voyage" };
  for (const g of GAMES) {
    // A jackpot won in the game: its own show (golden apples, the oyster's clam pick, the Star Map Wheel),
    // then the celebration in tBCH; nothing on the jackpots gives it away while the reels turn.
    resetApi(); signIn(500000);
    const v = { ...SPINS["jackpot-" + g], jackpotWin: 3290 }, jst = v.steps.find((x) => x.type === "jackpot"), tier = jst.tier.toUpperCase();
    api.spinQueue.push(v);
    const r = await playQueued(g, v, { spoilerCheck: true });
    const problems = [];
    const i = GAMES.indexOf(g);
    if (r.spoiler !== `${(45678 + i).toLocaleString("en-US")} tSats / ${(2310 + i).toLocaleString("en-US")} tSats`) problems.push(`jackpots showed ${r.spoiler} while the reels turned`);
    if (r.rec.jp !== jst.cells.length) problems.push(`${r.rec.jp} jackpot symbols drawn, expected ${jst.cells.length}`);
    if (g === "deep-sea" && r.rec.clams !== 7) problems.push(`${r.rec.clams} clams`);
    if (g === "cosmic-voyage" && r.rec.wheel !== jst.slice) problems.push(`wheel stopped on ${r.rec.wheel}, expected ${jst.slice}`);
    if (!r.rec.banner.some((b) => b === `${tier} JACKPOT! | 0.00003290 tBCH`)) problems.push("banners: " + JSON.stringify(r.rec.banner));
    if (!r.done) problems.push("spin did not finish");
    if (r.header !== api.balance) problems.push(`balance ${r.header} != server ${api.balance}`);
    if (!r.history.some((h) => new RegExp(jst.tier + " jackpot", "i").test(h))) problems.push("history: " + JSON.stringify(r.history.slice(0, 3)));
    if (r.calls < 1) problems.push("jackpots not read after the spin");
    const collect = v.steps.find((x) => x.type === "collect");
    if (collect && (r.rec.col !== collect.cells.length || !r.rec.count.includes(`${COLLECTOR[g].filled + collect.cells.length} / ${COLLECTOR[g].size}`))) problems.push(`collect: ${r.rec.col} symbols, counts ${JSON.stringify(r.rec.count)}`);
    if (pageErrors.length) problems.push("errors: " + pageErrors.slice(0, 2).join(" | "));
    check(`${g}: ${jst.tier} jackpot won in the game (${{ apples: "golden apples", clams: "clam pick", wheel: "Star Map Wheel" }[JSON.parse(CONFIGS[g]).jackpot.type]}), celebration in tBCH, no spoiler`, !problems.length, problems.join("; "));
  }
  for (const g of GAMES) {
    // The spin that fills the collector: the symbols fly in, FULL!, the reward at its own bet, then from empty.
    resetApi(); signIn(500000);
    const v = SPINS["reward-" + g], rw = v.reward, cfg = JSON.parse(CONFIGS[g]), R = cfg.collector.reward;
    api.spinQueue.push(v);
    const r = await playQueued(g, v);
    const problems = [];
    if (!r.done) problems.push("spin did not finish");
    if (r.header !== api.balance) problems.push(`balance ${r.header} != server ${api.balance}`);
    if (!r.rec.full) problems.push("the meter never showed FULL!");
    if (!r.rec.banner.some((b) => b.startsWith(cfg.collector.name.toUpperCase() + " FULL!"))) problems.push("banners: " + JSON.stringify(r.rec.banner.slice(0, 4)));
    if (R.type === "freeSpins") {
      if (!r.rec.sign.some((t) => t.includes(R.name.toUpperCase()) && (!R.lockedWild || t.includes("LOCKED")))) problems.push("feature sign: " + JSON.stringify(r.rec.sign.slice(-3)));
    } else {
      const pearls = rw.steps[0].start.length + rw.steps[0].respins.reduce((n, x) => n + x.length, 0);
      if (r.rec.pearls !== pearls) problems.push(`${r.rec.pearls} pearls shown, expected ${pearls}`);
      if (!r.history.some((h) => h.includes(R.name))) problems.push("history: " + JSON.stringify(r.history.slice(0, 2)));
    }
    if (r.count !== `0 / ${COLLECTOR[g].size}`) problems.push(`collector shows ${r.count} after the reward`);
    if (pageErrors.length) problems.push("errors: " + pageErrors.slice(0, 2).join(" | "));
    check(`${g}: filling the ${cfg.collector.name} plays ${R.name} at ${v.rewardBet} tSats, then the meter starts again`, !problems.length, problems.join("; "));
  }
  {
    resetApi();
    await open("index.html", 1280);
    const lobby = await until(`(() => { const hero = document.querySelector("#floor .jp-hero"), cards = [...document.querySelectorAll(".game-card")];
      return hero && hero.querySelector('[data-jackpot="grand"]').textContent === "0.00121994 tBCH" && !/Must hit|before it is full|gift/.test(document.getElementById("floor").textContent)
        && /RTP of 110%/.test(document.getElementById("floor").textContent)
        && cards.length === 3 && cards.every(c => /^0\\.000456(7[89]|80) tBCH$/.test(c.querySelector('.gc-jp .jp-row-major [data-jackpot^="major:"]').textContent)
          && !c.querySelector('.jp-row-minor, [data-meter], [data-collector]'))
        && !!hero.querySelector('a[href="jackpots.html"]'); })()`);
    check("lobby: Grand amount, Major amount on every card, RTP 110%", lobby);

    // Jackpots page: amounts, collectors, seed hashes, and wins: a real one (Verify passes), a tampered one (fails),
    // an older D40 one (its own rules, passes) and one from the first pools (no seed).
    const real = METERS[0], bad = { ...METERS[1], target: METERS[1].target + 1 };
    const d40 = { seed: "90c90c517a8ee64c022b9c615279ea4f8f693dbac41fcc050bdee5d7b97d3a86", seedHash: "15acfa4d9e3a8b81a6d65bb9329b7e11a50c89c61b48e9673907b7ca0a720e41",
      minSats: 500, maxSats: 50000, target: 3215, displayScale: 29153, startSats: 196 };
    api.jackpots.recentWins = [
      { pool: "minor:deep-sea", tier: "minor", gameId: "deep-sea", player: "Passkey 3f9a2c", amount: 3290, wonAt: new Date().toISOString(), cycle: 11, ...real },
      { pool: "major:cosmic-voyage", tier: "major", gameId: "cosmic-voyage", player: "Passkey 77aa01", amount: bad.startSats + 10, wonAt: new Date().toISOString(), cycle: 2, ...bad },
      { pool: "major:fruit-orchard", tier: "major", gameId: "fruit-orchard", player: "Passkey 0c0ffe", amount: d40.target + 5, wonAt: new Date(Date.now() - 3600e3).toISOString(), cycle: 1, ...d40 },
      { pool: "grand", gameId: "deep-sea", player: "bchtest:qphp...hdxy", amount: 102012345, wonAt: new Date(Date.now() - 86400e3).toISOString() }];
    await open("jackpots.html", 1280);
    const page = await until(`(() => { const amounts = document.querySelectorAll(".jpp-pools [data-jackpot]"), pools = document.querySelector(".jpp-pools"),
        cols = [...document.querySelectorAll(".jpp-pools [data-collector]")], rows = document.querySelectorAll("#jp-wins-body tr");
      return amounts.length === 7 && [...amounts].every(a => /^0\\.\\d{8} tBCH$/.test(a.textContent)) && !/Must hit|before it is full|reaches its limit|10,000|50,000|2,500,000|gift/.test(pools.textContent + document.querySelector(".lb-lead").textContent)
        && cols.length === 3 && cols.map(c => c.textContent).join(",") === "${COLLECTOR["fruit-orchard"].filled} / ${COLLECTOR["fruit-orchard"].size},${COLLECTOR["deep-sea"].filled} / ${COLLECTOR["deep-sea"].size},${COLLECTOR["cosmic-voyage"].filled} / ${COLLECTOR["cosmic-voyage"].size}"
        && rows.length === 4 && document.querySelectorAll("#jp-hashes > div").length === 7 && /0\\.00003290 tBCH/.test(rows[0].textContent)
        && rows[0].querySelector(".jpw-verify") && rows[1].querySelector(".jpw-verify") && rows[2].querySelector(".jpw-verify") && !rows[3].querySelector(".jpw-verify") && /Old jackpot/.test(rows[3].textContent); })()`);
    const verifyRow = async (k) => { await ev(`document.querySelectorAll("#jp-wins-body .jpw-verify")[${k}].click()`);
      return until(`(() => { const d = document.querySelectorAll("#jp-wins-body tr.jpw-detail")[${k}]; return d && !/Checking/.test(d.textContent) && d.textContent; })()`, 5000)
        .then(() => ev(`(() => { const d = document.querySelectorAll("#jp-wins-body tr.jpw-detail")[${k}]; return { text: d.textContent, ok: d.querySelectorAll(".jpw-checks .is-ok").length, bad: d.querySelectorAll(".jpw-checks .is-bad").length }; })()`)); };
    const v1 = await verifyRow(0), v2 = await verifyRow(1), v3 = await verifyRow(2);
    const pass = /This win is fair/.test(v1.text) && v1.ok === 3 && /head start/.test(v1.text);
    const fail = /does NOT check out/.test(v2.text) && v2.bad === 1;
    const old = /This win is fair/.test(v3.text) && v3.ok === 3 && /display scale/.test(v3.text);
    resetApi();
    await open("jackpots.html", 375);
    const empty = await until(`!document.getElementById("jp-winners-empty").hidden && document.querySelectorAll("#jp-wins-body tr").length === 0`);
    check("jackpots page: 7 amounts and 3 collectors (no limits shown), seed hashes, wins with Verify (real passes, tampered fails, D40 by its own rules, first pools none), empty state",
      page && pass && fail && old && empty, `page ${!!page}, verify ${pass}, tampered ${fail}, d40 ${old}, empty ${!!empty}`);
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

  /* ═══ 8. Fairness verifier ═══ */
  resetApi();
  await open("fairness.html", 1280);
  const fill = (o) => ev(`(() => { const f = (i, x) => { const e = document.getElementById(i); if (e.type === "checkbox") e.checked = !!x; else e.value = x; };
    ${Object.entries(o).map(([k, x]) => `f(${JSON.stringify(k)}, ${JSON.stringify(x)});`).join(" ")} document.getElementById("vf-submit").click(); })()`);
  const result = () => ev(`document.getElementById("vf-result").textContent`);
  const base = (v) => ({ "vf-game": v.gameId, "vf-version": String(v.gameVersion), "vf-bet": v.bet, "vf-seed": v.serverSeed, "vf-client": v.clientSeed, "vf-nonce": v.nonce, "vf-reward": "", "vf-nojp": false });
  const fv = SPINS["cosmic-voyage"];
  await fill({ ...base(fv), "vf-expect": fv.totalWin });
  check("fairness: the in-browser verifier reproduces a real version 4 spin", await until(`/✓ matches/.test(document.getElementById("vf-result").textContent)`, 10000));
  const jv = SPINS.v2jackpot;
  await fill({ ...base(jv), "vf-expect": jv.totalWin });
  check("fairness: the verifier reproduces an old (version 2) Major jackpot draw", await until(`/Major hit/.test(document.getElementById("vf-result").textContent) && /Grand no hit/.test(document.getElementById("vf-result").textContent)`, 10000));
  const j4 = SPINS["jackpot-deep-sea"];
  await fill({ ...base(j4), "vf-expect": j4.totalWin });
  const j4ok = await until(`(() => { const t = document.getElementById("vf-result").textContent; return /✓ matches/.test(t) && /Major jackpot won \\(Magic Oyster\\)/.test(t) && /clams Major, Major, Major/.test(t); })()`, 10000);
  const rv = SPINS["reward-deep-sea"];
  await fill({ ...base(rv), "vf-expect": rv.totalWin + rv.reward.win, "vf-reward": rv.rewardBet });
  const rvok = await until(`(() => { const t = document.getElementById("vf-result").textContent; return /✓ matches/.test(t) && /Treasure Hold & Win at 3 tSats/.test(t); })()`, 10000);
  check("fairness: the verifier replays a version 4 jackpot (clam pick) and a collector reward at its bet", j4ok && rvok, `jackpot ${!!j4ok}, reward ${!!rvok}: ${(await result()).slice(0, 160)}`);
  const mv = METERS[2];
  await ev(`(() => { const f = (i, x) => document.getElementById(i).value = x; f("mt-tier", "grand"); f("mt-rules", "current"); f("mt-min", ${mv.minSats}); f("mt-max", ${mv.maxSats});
    f("mt-seed", "${mv.seed}"); f("mt-hash", "${mv.seedHash}"); f("mt-amount", ${mv.startSats + 1});
    document.getElementById("mt-submit").click(); })()`);
  const meterOk = await until(`(() => { const t = document.getElementById("mt-result").textContent;
    return /Every check passed/.test(t) && t.includes("${mv.target.toLocaleString("en-US")} tSats") && !/Display scale/.test(t)
      && t.includes("Head start${mv.startSats.toLocaleString("en-US")} tSats") && t.includes("${mv.seedHash}"); })()`, 5000);
  check("fairness: the jackpot checker derives seed hash, target and head start from a seed", meterOk);

  // Your spins: GET /spins has no steps, so the page finds a reward's bet itself; a jackpot must match jackpotWin.
  resetApi(); signIn();
  const item = (v, extra = {}) => ({ id: v.nonce, gameId: v.gameId, gameVersion: v.gameVersion, bet: v.bet, totalWin: v.totalWin + (v.reward ? v.reward.win : 0),
    jackpotWin: 0, nonce: v.nonce, serverSeedHash: v.serverSeedHash, serverSeed: v.serverSeed, clientSeed: v.clientSeed, createdAt: new Date().toISOString(), ...extra });
  api.history = [item(SPINS["reward-fruit-orchard"]), item(SPINS["reward-deep-sea"]), item(SPINS["reward-cosmic-voyage"]),
    item(SPINS["jackpot-cosmic-voyage"], { jackpotWin: 1234 }), item(SPINS["fruit-orchard"]), item(SPINS["jackpot-fruit-orchard"], { jackpotWin: 777 }),
    item(SPINS["jackpot-deep-sea"]),   // a jackpot in the replay, none paid: only if jackpots were off (GET /spins has no flag)
    item(SPINS["deep-sea"], { totalWin: SPINS["deep-sea"].totalWin + 1 })];   // tampered: a mismatch
  await open("fairness.html", 1280);
  await until(`document.querySelectorAll("#sp-body tr").length === 8`);
  await ev(`document.getElementById("sp-verify-all").click()`);
  const listOk = await until(`/1 of 8 spins did NOT match/.test(document.getElementById("sp-status").textContent)`, 30000);
  const notes = await ev(`[...document.querySelectorAll("#sp-body tr")].map(r => r.querySelector(".sp-check").textContent + " | " + ((r.querySelector(".sp-result") || {}).title || ""))`);
  check("fairness: Verify all finds each collector reward's bet and checks jackpots against jackpotWin",
    listOk && notes.slice(0, 3).every((n) => /✓ Verified \| This spin filled the collector; its reward played at 3 tSats/.test(n))
      && notes.slice(3, 6).every((n) => /^✓ Verified/.test(n)) && /^✓ Verified \| Jackpots were off for this spin/.test(notes[6]) && /^✗ Mismatch/.test(notes[7]),
    JSON.stringify(notes).slice(0, 400));

} catch (e) {
  check("test run", false, e.message);
} finally {
  ws.close(); chrome.kill(); server.close();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed.`);
process.exit(failed ? 1 : 0);
