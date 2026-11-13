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
 * draws, version 4 jackpots and rewards, a version 6 spin at 20 lines, the list with Verify all) and the jackpots and collectors (D43:
 * the machines, jackpots won and collectors filled by someone else, a jackpot won in each game,
 * every collector reward, the lobby, the jackpots page with Verify, the jackpot checker), and the lines
 * (D47: the selector, the line bet's max per count, the total, the paytable at the stake, a 20-line spin).
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
  ...GAMES.map((g) => `games/${g}.html`), "games/roulette.html"];
const CONFIGS = Object.fromEntries(GAMES.map((g) => [g, fs.readFileSync(path.join(FIX, `config-${g}.json`), "utf8")]));
const SPINS = JSON.parse(fs.readFileSync(path.join(FIX, "spins.json"), "utf8"));
const METERS = JSON.parse(fs.readFileSync(path.join(FIX, "meters.json"), "utf8"));   // backend meter vectors
const ROULETTE = JSON.parse(fs.readFileSync(path.join(FIX, "roulette.json"), "utf8"));   // backend roulette vectors (rules 2 first, golden round 2117 first of all)
const RULES2 = { version: 2, payoutPockets: 36, goldenOneIn: 236, goldenMultiplier: 10, rtp: "1.01" };
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
    // tBTC (D46): its own balance and daily bonus; every request is logged (method, path, query, body).
    btc: 5000, btcBonus: { available: true, amount: 100 }, log: [], withdrawn: [],
    spinQueue: [], payouts: [], leaderboards: null, jackpotCalls: 0, rt: { chips: [], nextId: 1 },
    history: [],
    jackpots: { grand: { amount: 121994, cycle: 3, seedHash: "a".repeat(64) },
      games: Object.fromEntries(GAMES.map((g, i) => [g, { minor: { amount: 2310 + i, cycle: 12, seedHash: "b".repeat(64) },
        major: { amount: 45678 + i, cycle: 2, seedHash: "c".repeat(64) },
        collector: { filled: COLLECTOR[g].filled, size: COLLECTOR[g].size, cycle: 9 } }])),
      recentWins: [], updatedAt: new Date().toISOString() }
  });
}
resetApi();
function hasCoinGlobal(path, coin) { return api.log.some((x) => x.path === path && new URLSearchParams(x.query).get("coin") === coin); }
function bal(coin) { return coin === "btc" ? api.btc : api.balance; }
function addBal(coin, d) { if (coin === "btc") api.btc += d; else api.balance += d; }
// tBTC jackpots: a tenth of tBCH's (D46).
function btcJackpots() {
  const j = JSON.parse(JSON.stringify(api.jackpots));
  j.coin = "btc"; j.grand.amount = 12199;
  for (const g of GAMES) { j.games[g].major.amount = Math.round(j.games[g].major.amount / 10); j.games[g].minor.amount = Math.round(j.games[g].minor.amount / 10); }
  j.recentWins = []; return j;
}
function handle(method, url, body) {
  const p = url.pathname, qcoin = url.searchParams.get("coin");
  api.log.push({ method, path: p, query: url.search, body: body ? JSON.parse(body) : null });
  const cfg = /^\/games\/([\w-]+)\/config$/.exec(p);
  if (cfg && CONFIGS[cfg[1]]) return [200, CONFIGS[cfg[1]]];
  // Roulette (D44): the REST side; the WebSocket is a fake in the page (see FAKE_WS), driven by the tests.
  if (p === "/roulette/state") return [200, { type: "table", serverTime: new Date().toISOString(), players: [], bets: [], rules: RULES2 }];
  if (p === "/roulette/bets" && method === "POST") {
    const b = JSON.parse(body), rt = api.rt, coin = b.coin || "bch";
    for (const x of b.bets) rt.chips.push({ id: rt.nextId++, player: "bchtest:qphp...hdxy", coin, type: x.type, numbers: x.numbers || null, amount: x.amount });
    const mine = rt.chips.filter((c) => c.coin === coin);
    addBal(coin, -b.bets.reduce((a, c) => a + c.amount, 0));
    return [200, { roundId: b.roundId, coin, bets: mine, total: mine.reduce((a, c) => a + c.amount, 0), balance: bal(coin) }];
  }
  if (p === "/roulette/bets/clear" && method === "POST") {
    const coin = JSON.parse(body).coin || "bch";
    addBal(coin, api.rt.chips.filter((c) => c.coin === coin).reduce((a, c) => a + c.amount, 0)); api.rt.chips = api.rt.chips.filter((c) => c.coin !== coin);
    return [200, { roundId: JSON.parse(body).roundId, coin, bets: [], total: 0, balance: bal(coin) }];
  }
  if (p === "/roulette/rounds") return [200, { items: ROULETTE.slice(0, 5).map((v, i) => ({ id: v.roundId, startsAt: new Date(Date.now() - (i + 1) * 60000).toISOString(),
    status: "settled", rules: v.rules, number: v.number, spinSeconds: v.spinSeconds, ...(v.rules === 2 ? { golden: v.golden } : {}), seedHash: v.seedHash, seed: v.seed })), nextCursor: null }];
  const rr = /^\/roulette\/rounds\/(\d+)$/.exec(p);
  if (rr) {
    const v = ROULETTE.find((x) => x.roundId === +rr[1]);
    if (!v) return [404, { error: "round_not_found", message: "No such round." }];
    return [200, { round: { id: v.roundId, status: "settled", rules: v.rules, number: v.number, spinSeconds: v.spinSeconds, ...(v.rules === 2 ? { golden: v.golden } : {}), seedHash: v.seedHash, seed: v.seed },
      bets: v.bets.map((b, i) => ({ id: i + 1, player: "Passkey 3f9a2c", type: b.type, numbers: b.numbers, amount: b.amount, payout: v.payouts[i] })) }];
  }
  switch (p) {
    case "/faucet": return [200, { wallet: 111044000000, house: 111043000000, users: 97981, pendingWithdrawals: 0,
      players: { allTime: 18, withBalance: 13, last24h: 14, last30d: 17 }, updatedAt: new Date().toISOString(),
      coins: { bch: { wallet: 111044000000, house: 111043000000, users: 97981, pendingWithdrawals: 0, jackpots: 0 },
               btc: { wallet: 5000000, house: 4321000, users: 12345, pendingWithdrawals: 0, jackpots: 0 } } }];
    case "/me": return api.user ? [200, { user: api.user, balance: api.balance, dailyBonus: api.bonus,
      balances: { bch: api.balance, btc: api.btc }, dailyBonuses: { bch: api.bonus, btc: api.btcBonus } }] : [401, { error: "unauthorized", message: "Sign in first." }];
    case "/bonus/daily": {
      const coin = qcoin || "bch", b = coin === "btc" ? api.btcBonus : api.bonus;
      if (!b.available) return [409, { error: "daily_bonus_claimed", message: "Already claimed today." }];
      addBal(coin, b.amount); b.available = false; b.nextClaimAt = new Date(Date.now() + 3600e3).toISOString();
      return [200, { coin, amount: b.amount, balance: bal(coin), nextClaimAt: b.nextClaimAt }];
    }
    case "/auth/logout": api.user = null; return [204, null];
    case "/spins":
      if (method === "POST") {
        // Lines (D47, D48): the request carries { lines, lineBet } (no bet), checked like the live server: lines 5, 10 or 20
        // (a request with only `bet` is refused), the line bet 1 to the coin's max (tBCH 20,000, tBTC 2,000) over the lines.
        // The queued vector's steps play at the request's stake.
        const b = JSON.parse(body), coin = b.coin || "bch";
        const lines = b.lines, maxLine = Math.floor((coin === "btc" ? 2000 : 20000) / lines);
        if (![5, 10, 20].includes(lines)) return [400, { error: "invalid_lines", message: "Lines must be 5, 10 or 20." }];
        const lineBet = b.lineBet, bet = b.bet != null ? b.bet : lineBet * lines;
        if (!Number.isInteger(lineBet) || lineBet < 1 || lineBet > maxLine) return [400, { error: "invalid_bet", message: `The line bet must be 1 to ${maxLine.toLocaleString("en-US")} sats at ${lines} lines.` }];
        if (b.bet != null && b.lineBet != null && b.bet !== lineBet * lines) return [400, { error: "invalid_bet", message: "bet must equal lineBet × lines." }];
        if (api.rejectSpin) { const e = api.rejectSpin; api.rejectSpin = null; return [400, e]; }
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
        addBal(coin, totalWin - bet + jackpotWin);
        return [200, { spinId: 1, gameId: v.gameId, gameVersion: v.gameVersion, coin, bet, lines, lineBet, nonce: v.nonce, serverSeedHash: v.serverSeedHash,
          clientSeed: v.clientSeed, steps, totalWin, jackpotWin, balance: bal(coin) }];
      }
      return [200, { items: api.history, nextCursor: null }];
    case "/fairness/seed": return [200, { serverSeedHash: "ab".repeat(32), clientSeed: "smoke-test", nonce: 0 }];
    case "/withdrawals":
      if (method === "POST") {
        const b = JSON.parse(body), coin = b.coin || "bch";
        addBal(coin, -b.amount);
        const w = { id: api.withdrawn.length + 1, coin, amount: b.amount, address: b.address || "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx", status: "PENDING", txid: null, createdAt: new Date().toISOString(), sentAt: null };
        api.withdrawn.unshift(w); return [200, w];
      }
      return [200, { items: api.withdrawn }];
    case "/ledger": return [200, { items: [], nextCursor: null }];
    case "/faucet/withdrawals": return [200, { items: qcoin ? api.payouts.filter((w) => (w.coin || "bch") === qcoin) : api.payouts, nextCursor: null }];
    case "/jackpots": api.jackpotCalls++; return [200, qcoin === "btc" ? btcJackpots() : api.jackpots];
    case "/leaderboards": return [200, (qcoin === "btc" && api.btcLeaderboards) || api.leaderboards || { balances: [], wins24h: [], wins30d: [], winsAllTime: [], withdrawals24h: [], withdrawals30d: [], withdrawalsAllTime: [], updatedAt: new Date().toISOString() }];
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
// Every DevTools call gets an answer within 30 s, or the run fails with the call that hung (instead of waiting forever).
function send(method, params = {}) {
  return new Promise((r, fail) => {
    const id = ++seq;
    const t = setTimeout(() => { pending.delete(id); fail(new Error(`DevTools did not answer ${method} within 30 s` + (params.expression ? `: ${params.expression.slice(0, 120)}` : ""))); }, 30000);
    pending.set(id, (m) => { clearTimeout(t); r(m); });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
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
// The roulette WebSocket cannot be intercepted like fetch: every page gets a fake one, driven by the tests
// with __emit(message); what the page sends is in __wsLog.
await send("Page.addScriptToEvaluateOnNewDocument", { source: `
  window.__wsLog = [];
  (function () {
    var Real = window.WebSocket;
    function FakeWS(url) { var me = this; this.url = url; this.readyState = 0; window.__wsServer = this;
      setTimeout(function () { me.readyState = 1; if (me.onopen) me.onopen({}); }, 30); }
    FakeWS.prototype.send = function (d) { window.__wsLog.push(JSON.parse(d)); };
    FakeWS.prototype.close = function () { this.readyState = 3; if (this.onclose) this.onclose({}); };
    window.WebSocket = function (url) { return /roulette\\/ws/.test(url) ? new FakeWS(url) : new Real(url); };
    window.__emit = function (m) { if (window.__wsServer && window.__wsServer.onmessage) window.__wsServer.onmessage({ data: JSON.stringify(m) }); };
  })();` });

async function open(page, width, opts = {}) {
  await send("Emulation.setDeviceMetricsOverride", { width, height: opts.height || 900, deviceScaleFactor: 1, mobile: width < 600 });
  await send("Page.navigate", { url: `${ORIGIN}/${page}${opts.hash || ""}` });
  await sleep(300);
  await ev(`try { localStorage.setItem("tnc.music.open", "false"); localStorage.setItem("tnc.coin", "${opts.coin || "bch"}") } catch (e) {}`);
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
  for (const p of PAGES.concat("404.html")) {
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

  /* ═══ 2b. SEO: canonical and share tags, descriptions, robots.txt, the sitemap, the 404 page ═══ */
  {
    const problems = [], SITE = "https://testnetcasino.com/";
    for (const p of PAGES) {
      const html = fs.readFileSync(path.join(ROOT, p), "utf8"), head = html.slice(0, html.indexOf("</head>"));
      const url = SITE + (p === "index.html" ? "" : p), get = (re) => (re.exec(head) || [])[1];
      const title = get(/<title>([^<]*)<\/title>/), desc = get(/<meta name="description" content="([^"]*)">/);
      if (get(/<link rel="canonical" href="([^"]*)">/) !== url || get(/<meta property="og:url" content="([^"]*)">/) !== url) problems.push(p + ": canonical / og:url");
      if (!desc || desc.length > 160) problems.push(`${p}: description ${desc ? desc.length : 0} characters`);
      if (get(/<meta property="og:title" content="([^"]*)">/) !== title || get(/<meta property="og:description" content="([^"]*)">/) !== desc) problems.push(p + ": og:title / og:description");
      if ((head.match(/property="og:title"/g) || []).length !== 1) problems.push(p + ": og:title twice");
      if (/\bRTP\b/.test(head)) problems.push(p + ": RTP in the head");
    }
    const sitemap = fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8"), locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    const indexable = PAGES.filter((p) => !/name="robots" content="noindex"/.test(fs.readFileSync(path.join(ROOT, p), "utf8"))).map((p) => SITE + (p === "index.html" ? "" : p));
    if (JSON.stringify([...locs].sort()) !== JSON.stringify([...indexable].sort())) problems.push("sitemap: " + JSON.stringify(locs.filter((l) => !indexable.includes(l)).concat(indexable.filter((l) => !locs.includes(l)))));
    if (!/Sitemap: https:\/\/testnetcasino\.com\/sitemap\.xml/.test(fs.readFileSync(path.join(ROOT, "robots.txt"), "utf8"))) problems.push("robots.txt");
    const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(fs.readFileSync(path.join(ROOT, "index.html"), "utf8"));
    try { const g = JSON.parse(ld[1])["@graph"]; if (!g.some((x) => x["@type"] === "WebSite") || !g.some((x) => x["@type"] === "Organization")) problems.push("JSON-LD types"); } catch (e) { problems.push("JSON-LD: " + e.message); }
    const nf = fs.readFileSync(path.join(ROOT, "404.html"), "utf8");
    if (!/content="noindex"/.test(nf) || /(?:src|href)="(?!\/|https?:|#)/.test(nf)) problems.push("404.html: noindex and absolute links only");
    check("SEO: canonical URL, share tags and a description of at most 160 characters on every page; robots.txt, the sitemap (indexable pages only), JSON-LD, the 404 page", !problems.length, problems.join("; "));
  }

  /* ═══ 3. Every page loads cleanly ═══ */
  for (const [label, width, signed] of [["desktop, signed in", 1280, true], ["phone, signed out", 375, false]]) {
    for (const p of PAGES) {
      resetApi(); if (signed) signIn();
      await open(p, width);
      const info = await ev(`({ sw: document.documentElement.scrollWidth, iw: innerWidth,
        nav: document.querySelectorAll('.site-head [aria-current="page"]').length, footer: !!document.querySelector(".casino-footer .cf-links"),
        faucet: (document.querySelector('#faucet-bar [data-k="house:bch"]') || {}).textContent || "",
        signedIn: !!document.querySelector(".auth-user"), h1: document.querySelectorAll("h1").length })`);
      const problems = [];
      if (pageErrors.length) problems.push("errors: " + pageErrors.slice(0, 2).join(" | "));
      if (info.sw > info.iw) problems.push(`sideways scroll ${info.sw}px > ${info.iw}px`);
      // The account and sign-in pages have no nav chip of their own: the account chip marks
      // the account page when signed in, the "Sign in" chip marks the sign-in page when signed out.
      const expectCurrent = !((p === "account.html" && !signed) || (p === "login.html" && signed));
      if (expectCurrent && info.nav < 1) problems.push("no current page in the nav");
      if (!info.footer) problems.push("no footer");
      if (info.h1 !== 1) problems.push(`${info.h1} h1 headings`);
      if (!/tBCH/.test(info.faucet)) problems.push("faucet bar not filled");
      if (info.signedIn !== signed) problems.push(signed ? "not shown as signed in" : "shown as signed in");
      check(`${p} loads (${label})`, !problems.length, problems.join("; "));
    }
  }

  /* ═══ 4. The machines (PixiJS): jackpots and the collector in sats, a spin, full screen, phone ═══ */
  // The whole machine is a canvas; TNC_PixiState() reports what it shows, TNC_PixiBet() sets the bet,
  // Space spins (and stops), TNC_PixiGo() presses a stage's button (or Auto) like a player would.
  const THEME = { "fruit-orchard": "orchard", "deep-sea": "deepsea", "cosmic-voyage": "cosmic" };
  const SPIN = { "fruit-orchard": "SPIN", "deep-sea": "DIVE", "cosmic-voyage": "LAUNCH" };   // each skin's word for its spin key (T.spin)
  const CFG = Object.fromEntries(GAMES.map((g) => [g, JSON.parse(CONFIGS[g])]));
  async function openMachine(g, width = 1280, coin = "bch") {
    await open(`games/${g}.html`, width, { coin });
    return until(`typeof TNC_PixiState === "function" && TNC_PixiState().theme === "${THEME[g]}" && !!document.querySelector("#px-canvas canvas")`, 15000);
  }
  const space = `document.body.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true }))`;
  // A point on the machine (canvas coordinates from TNC_PixiState) on the screen, through the tilted canvas's corners.
  const screenPoint = (expr) => ev(`(() => { const p = ${expr}, q = [...document.querySelectorAll(".px-corner")].map((e) => e.getBoundingClientRect()).flatMap((r) => [r.x, r.y]);
    const dx1 = q[2] - q[4], dx2 = q[6] - q[4], dx3 = q[0] - q[2] + q[4] - q[6], dy1 = q[3] - q[5], dy2 = q[7] - q[5], dy3 = q[1] - q[3] + q[5] - q[7];
    const det = dx1 * dy2 - dx2 * dy1, gg = (dx3 * dy2 - dx2 * dy3) / det, hh = (dx1 * dy3 - dx3 * dy1) / det, u = (p.x + 22) / 804, v = (p.y + 10) / 1104;
    const a = q[2] - q[0] + gg * q[2], b = q[6] - q[0] + hh * q[6], d = q[3] - q[1] + gg * q[3], e = q[7] - q[1] + hh * q[7], w = gg * u + hh * v + 1;
    return { x: (a * u + b * v + q[0]) / w, y: (d * u + e * v + q[1]) / w }; })()`);
  const click = async (pt) => { for (const t of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type: t, x: pt.x, y: pt.y, button: "left", clickCount: 1 }); };
  for (const g of GAMES) {
    const problems = [], i = GAMES.indexOf(g), c = COLLECTOR[g];
    const major = (45678 + i).toLocaleString("en-US"), minor = (2310 + i).toLocaleString("en-US");
    resetApi(); signIn();
    if (!(await openMachine(g))) { check(`${g} (PixiJS machine) builds`, false); continue; }
    const idle = await until(`(() => { const s = TNC_PixiState(); return s.jackpots.grand === "121,994 tBCH sats" && s.jackpots.major === "${major} tBCH sats"
      && s.jackpots.minor === "${minor} tBCH sats" && s.tank.filled === ${c.filled} && s.tank.size === ${c.size}; })()
      && /Return to Player101% in all/.test(document.querySelector(".paytable .facts").textContent) && /Jackpot head starts8\\.5%/.test(document.querySelector(".paytable .facts").textContent) && !/Must hit|before it is full|reaches its limit|faucet boost|gift/i.test(document.querySelector(".paytable").textContent)
      && !document.querySelector("#slot-machine .reels-window")`, 8000);
    if (!idle) problems.push("idle: " + JSON.stringify(await ev(`TNC_PixiState()`)));
    // Sats only: no whole-coin switch on the machines.
    if (await ev(`!!document.getElementById("unit-switch")`)) problems.push("a unit switch is still there");
    // Full screen: the canvas fills the screen with 10 px on the side that runs out first.
    await ev(`document.body.classList.add("is-fullscreen"); document.documentElement.classList.add("is-fullscreen"); scrollTo(0, 0); dispatchEvent(new Event("resize"))`);
    await sleep(400);
    const fs = await ev(`(() => { const r = document.querySelector("#px-canvas canvas").getBoundingClientRect(); return { l: r.left, t: r.top, r: innerWidth - r.right, b: innerHeight - r.bottom }; })()`);
    if (!(Math.min(fs.t, fs.b) >= 6 && Math.min(fs.t, fs.b) <= 14 && fs.l >= 6)) problems.push("full screen: " + JSON.stringify(fs));
    // Wide full screen (a 1920 × 1080 screen): the jackpots as three lines at the top left, in step with the canvas's
    // amounts, the canvas without its rows filling the height, with room for the block on its left.
    await send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await ev(`dispatchEvent(new Event("resize"))`); await sleep(400);
    const wd = await ev(`(() => { const r = document.querySelector("#px-canvas canvas").getBoundingClientRect(), s = TNC_PixiState(), side = document.getElementById("px-jp-side");
      return { wide: document.body.classList.contains("px-wide"), shown: !side.hidden && side.getBoundingClientRect().left < 40 && side.getBoundingClientRect().right < r.left, l: r.left, b: innerHeight - r.bottom,
        rows: [...side.querySelectorAll(".px-jp-val")].map((e) => e.textContent), canvas: [s.jackpots.grand, s.jackpots.major, s.jackpots.minor] }; })()`);
    if (!(wd.wide && wd.shown && wd.l >= 340 && wd.b >= 6 && wd.b <= 14 && JSON.stringify(wd.rows) === JSON.stringify(wd.canvas))) problems.push("wide full screen: " + JSON.stringify(wd));
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await ev(`document.body.classList.remove("is-fullscreen"); document.documentElement.classList.remove("is-fullscreen"); dispatchEvent(new Event("resize"))`);
    // A spin (Space), with the bet of the test vector: the wins shown, the balance settled
    const v = SPINS[g];
    resetApi(); signIn(500000); api.spinQueue.push(v);
    await openMachine(g);
    await ev(`window.__px = { wins: 0 }; setInterval(() => { const s = TNC_PixiState(); window.__px.wins = Math.max(window.__px.wins, s.wins); window.__px.dim = Math.max(window.__px.dim || 0, s.dimmed || 0); if (s.stage) TNC_PixiGo(); }, 50);
      TNC_PixiBet(${v.bet}); ${space}`);
    await sleep(300);
    const done = await until(`!TNC_PixiState().busy`, 60000);
    const st = await ev(`({ px: window.__px, bal: TNC_Auth.balance, shown: TNC_PixiState().balance, hist: document.querySelectorAll("#history li").length })`);
    if (!done) problems.push("spin did not finish");
    if (st.bal !== api.balance) problems.push(`balance ${st.bal} != server ${api.balance}`);
    if (st.shown.replace(/\D/g, "") !== String(api.balance)) problems.push(`balance shows ${st.shown}`);
    if (v.totalWin > 0 && !st.px.wins) problems.push("no win shown on the reels");
    if (v.totalWin > 0 && !st.px.dim) problems.push("the symbols outside the win were never shaded");
    if (!st.hist) problems.push("nothing in recent spins");
    if (pageErrors.length) problems.push("errors: " + pageErrors.slice(0, 2).join(" | "));
    resetApi(); signIn();
    if (!(await openMachine(g, 375))) problems.push("phone: not built " + JSON.stringify(await ev(`({ text: document.getElementById("app").textContent.slice(0, 200) })`)) + pageErrors.slice(0, 2).join(" | "));
    else if (!(await until(`document.documentElement.scrollWidth <= innerWidth && document.querySelector("#px-canvas canvas").getBoundingClientRect().width <= innerWidth`, 8000))) problems.push("phone: sideways scroll");
    check(`${g} (PixiJS machine): GRAND, MAJOR, MINOR and the ${CFG[g].collector.name} in sats only, Return to Player 101% with its four parts, a spin settles the balance, full screen (wide: jackpots top left), phone`, !problems.length, problems.join("; "));
  }

  /* ═══ 4a. Reels stop one by one; STOP (Space) lands them early; a win holds the next spin ═══ */
  {
    resetApi(); signIn(500000);
    const v = SPINS["deep-sea"];   // one phase, a line win
    api.spinQueue.push(v, v);
    // Full motion for this page: the suite otherwise forces reduced motion, which shortens every timing.
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
    await openMachine("deep-sea");
    await sleep(300);
    const watch = `window.__t = { ready: 0, start: performance.now() }; clearInterval(window.__iv); window.__iv = setInterval(() => { if (!TNC_PixiState().busy && performance.now() - window.__t.start > 400) { window.__t.ready = performance.now(); clearInterval(window.__iv); } }, 20);`;
    await ev(`TNC_PixiBet(${v.bet}); ${watch} ${space}`);
    await until(`window.__t.ready > 0`, 20000);
    const a = await ev(`({ ...window.__t, land: TNC_PixiState().landed })`);
    const gaps = a.land.slice(1).map((t, i) => Math.round(t - a.land[i]));
    const hold = Math.round(a.ready - Math.max(...a.land));
    check("deep-sea: reels stop one by one", a.land.length === 5 && gaps.every((x) => x >= 300),
      `stops ${Math.round(a.land[0] - a.start)} ms after the press, then ${gaps.join(" / ")} ms apart`);
    check("deep-sea: a win holds the next spin until its animations end", hold >= 1100, `ready ${hold} ms after the last reel`);

    // Second spin: STOP after 300 ms with Space.
    await ev(`${watch} ${space}`);
    await sleep(300);
    const label = await ev(`TNC_PixiState().keySub + " / " + TNC_PixiState().keyOff`);
    await ev(`window.__t.stop = performance.now(); ${space}`);
    await until(`window.__t.ready > 0`, 20000);
    const b = await ev(`({ ...window.__t, land: TNC_PixiState().landed })`);
    const after = Math.round(Math.max(...b.land) - b.stop);
    const bal = await ev(`TNC_Auth.balance`);
    check("deep-sea: STOP lands the reels at once (display only)", label === "STOP / false" && b.land.length === 5 && after < 800 && bal === api.balance,
      `key "${label}", last reel ${after} ms after Space, balance ${bal}`);
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  }

  /* ═══ 4b. A jackpot won and the collector filled by someone else ═══ */
  {
    // Someone else wins the Deep Sea Major and fills its Treasure Chest: the cycles go up between two readings.
    resetApi(); signIn();
    await openMachine("deep-sea");
    await until(`TNC_PixiState().jackpots.major === "45,679 tBCH sats"`);
    api.jackpots.games["deep-sea"].major = { amount: 2410, cycle: 3, seedHash: "d".repeat(64) };
    api.jackpots.games["deep-sea"].collector = { filled: 2, size: 109, cycle: 10 };
    await ev(`TNC_Jackpots.refresh()`);
    const flash = await until(`(() => { const s = TNC_PixiState(); return s.jackpots.major === "WON!" && s.tank.full && s.tank.filled === 109; })()`, 3000);
    const after = await until(`(() => { const s = TNC_PixiState(); return s.jackpots.major === "2,410 tBCH sats" && !s.tank.full && s.tank.filled === 2 && s.tank.size === 109; })()`, 4000);
    check("jackpot won and collector filled by someone else: WON! then the new Major, FULL! then from empty", flash && after, `flash ${!!flash}, after ${!!after}`);
  }

  // Plays one queued spin on a machine and records what it showed on the way (the stages pressed through TNC_PixiGo).
  async function playQueued(g, v, opts = {}) {
    await openMachine(g);
    await until(`TNC_PixiState().jackpots.major === "${(45678 + GAMES.indexOf(g)).toLocaleString("en-US")} tBCH sats"`);
    const callsBefore = api.jackpotCalls;
    await ev(`(() => { const R = window.__rec = { jp: 0, col: 0, picks: 0, pearls: 0, wheel: null, stage: false, sign: [], lcd: [], banner: [], full: false, count: [] };
      setInterval(() => { const s = TNC_PixiState();
        R.jp = Math.max(R.jp, s.jpShown); R.col = Math.max(R.col, s.colShown); R.picks = Math.max(R.picks, s.picks); R.pearls = Math.max(R.pearls, s.pearls);
        if (s.wheel != null) R.wheel = s.wheel; if (s.stage) { R.stage = true; TNC_PixiGo(); }
        if (R.sign[R.sign.length - 1] !== s.featBar) R.sign.push(s.featBar);
        if (R.lcd[R.lcd.length - 1] !== s.lcd) R.lcd.push(s.lcd);
        if (s.banner && R.banner[R.banner.length - 1] !== s.banner) R.banner.push(s.banner);
        if (s.tank.full) R.full = true; const ct = s.tank.filled + " / " + s.tank.size; if (R.count[R.count.length - 1] !== ct) R.count.push(ct);
        if (s.fsMode) R.fs = true; R.weather = Math.max(R.weather || 0, s.weather || 0);
      }, 40);
      TNC_PixiBet(${v.bet}); })()`);
    await ev(space);
    let spoiler = null;
    if (opts.spoilerCheck) {
      await sleep(500);
      await ev(`TNC_Jackpots.refresh()`);   // a poll while the reels turn must not give the win away
      await sleep(250);
      spoiler = await ev(`TNC_PixiState().jackpots.major + " / " + TNC_PixiState().jackpots.minor`);
    }
    await sleep(300);
    const done = await until(`!TNC_PixiState().busy`, opts.timeout || 120000);
    await sleep(300);
    const st = await ev(`({ rec: window.__rec, header: TNC_Auth.balance, history: [...document.querySelectorAll("#history li")].map(l => l.textContent),
      count: TNC_PixiState().tank.filled + " / " + TNC_PixiState().tank.size })`);
    return { done, spoiler, ...st, calls: api.jackpotCalls - callsBefore };
  }
  for (const g of GAMES) {
    // A jackpot won in the game: its own show (golden apples, the oyster's clam pick, the Star Map Wheel),
    // then the celebration in tBCH sats; nothing on the jackpots gives it away while the reels turn.
    resetApi(); signIn(500000);
    const v = { ...SPINS["jackpot-" + g], jackpotWin: 3290 }, jst = v.steps.find((x) => x.type === "jackpot"), tier = jst.tier.toUpperCase();
    api.spinQueue.push(v);
    const r = await playQueued(g, v, { spoilerCheck: true });
    const problems = [];
    const i = GAMES.indexOf(g), type = CFG[g].jackpot.type;
    if (r.spoiler !== `${(45678 + i).toLocaleString("en-US")} tBCH sats / ${(2310 + i).toLocaleString("en-US")} tBCH sats`) problems.push(`jackpots showed ${r.spoiler} while the reels turned`);
    if (r.rec.jp !== jst.cells.length) problems.push(`${r.rec.jp} jackpot symbols drawn, expected ${jst.cells.length}`);
    if (type === "clams" && r.rec.picks !== (jst.picks || []).length) problems.push(`${r.rec.picks} clams opened, expected ${(jst.picks || []).length}`);
    if (type === "wheel" && r.rec.wheel !== jst.slice) problems.push(`wheel stopped on ${r.rec.wheel}, expected ${jst.slice}`);
    if (!r.rec.banner.some((b) => b === `${tier} JACKPOT! | 3,290 tBCH sats`)) problems.push("banners: " + JSON.stringify(r.rec.banner));
    if (!r.done) problems.push("spin did not finish");
    if (r.header !== api.balance) problems.push(`balance ${r.header} != server ${api.balance}`);
    if (!r.history.some((h) => new RegExp(jst.tier + " jackpot", "i").test(h))) problems.push("history: " + JSON.stringify(r.history.slice(0, 3)));
    if (r.calls < 1) problems.push("jackpots not read after the spin");
    const collect = v.steps.find((x) => x.type === "collect");
    if (collect && (r.rec.col !== collect.cells.length || !r.rec.count.includes(`${COLLECTOR[g].filled + collect.cells.length} / ${COLLECTOR[g].size}`))) problems.push(`collect: ${r.rec.col} symbols, counts ${JSON.stringify(r.rec.count)}`);
    if (pageErrors.length) problems.push("errors: " + pageErrors.slice(0, 2).join(" | "));
    check(`${g}: ${jst.tier} jackpot won in the game (${{ apples: "golden apples", clams: "clam pick", wheel: "Star Map Wheel" }[type]}), celebration in tBCH sats, no spoiler`, !problems.length, problems.join("; "));
  }
  for (const g of GAMES) {
    // The spin that fills the collector: the symbols fly in, FULL!, the reward at its own bet, then from empty.
    resetApi(); signIn(500000);
    const v = SPINS["reward-" + g], rw = v.reward, cfg = CFG[g], R = cfg.collector.reward;
    api.spinQueue.push(v);
    const r = await playQueued(g, v);
    const problems = [];
    if (!r.done) problems.push("spin did not finish");
    if (r.header !== api.balance) problems.push(`balance ${r.header} != server ${api.balance}`);
    if (!r.rec.full) problems.push("the collector never showed FULL!");
    if (!r.rec.banner.some((b) => b.startsWith(cfg.collector.name.toUpperCase() + " FULL!"))) problems.push("banners: " + JSON.stringify(r.rec.banner.slice(0, 4)));
    if (R.type === "freeSpins") {
      if (!r.rec.sign.some((t) => t.includes(R.name.toUpperCase()) && (!R.lockedWild || t.includes("LOCKED")))) problems.push("feature sign: " + JSON.stringify(r.rec.sign.slice(-3)));
      if (!r.rec.fs) problems.push("the free-spins frame never showed");   // (the weather stays off under the suite's reduced motion)
    } else {
      const pearls = rw.steps[0].start.length + rw.steps[0].respins.reduce((n, x) => n + x.length, 0);
      if (r.rec.pearls !== pearls) problems.push(`${r.rec.pearls} pearls shown, expected ${pearls}`);
      if (!r.history.some((h) => h.includes(R.name))) problems.push("history: " + JSON.stringify(r.history.slice(0, 2)));
    }
    if (r.count !== `0 / ${COLLECTOR[g].size}`) problems.push(`collector shows ${r.count} after the reward`);
    if (pageErrors.length) problems.push("errors: " + pageErrors.slice(0, 2).join(" | "));
    check(`${g}: filling the ${cfg.collector.name} plays ${R.name} at ${v.rewardBet} tBCH sats (free spins framed), then the collector starts again`, !problems.length, problems.join("; "));
  }
  {
    // The bonus games, from steps the fake server adds to a plain spin: Harvest Pick, Ship's Wheel, Warp Ladder.
    const BONUS = {
      "fruit-orchard": { type: "bonus", order: [2, 5, 10, 0, 1, 3, 0, 2, 15, 1, 5, 0], picks: 4, prize: 17 },
      "deep-sea": { type: "bonus", index: 7, prize: 50 },
      "cosmic-voyage": { type: "bonus", boosts: [true, true, false], prize: CFG["cosmic-voyage"].bonus.levels[2] }
    };
    const problems = [];
    for (const g of GAMES) {
      resetApi(); signIn(500000);
      const base = SPINS[g], b = { ...BONUS[g], win: Math.floor(BONUS[g].prize * base.bet) };
      const v = { ...base, steps: [...base.steps.filter((x) => x.type === "spin"), b], totalWin: base.totalWin + b.win };
      api.spinQueue.push(v);
      const r = await playQueued(g, v);
      if (!r.done) problems.push(`${g}: did not finish`);
      if (r.header !== api.balance) problems.push(`${g}: balance ${r.header} != server ${api.balance}`);
      if (!r.rec.stage) problems.push(`${g}: no bonus stage`);
      if (g === "fruit-orchard" && r.rec.picks !== 4) problems.push(`${g}: ${r.rec.picks} baskets opened`);
      if (g === "deep-sea" && r.rec.wheel !== 7) problems.push(`${g}: wheel stopped on ${r.rec.wheel}`);
      if (!r.rec.lcd.some((t) => t.includes(CFG[g].bonus.name + " paid"))) problems.push(`${g}: lcd ${JSON.stringify(r.rec.lcd.slice(-3))}`);
      if (pageErrors.length) problems.push(`${g}: errors: ` + pageErrors.slice(0, 2).join(" | "));
    }
    check("bonus games on the machines: Harvest Pick, Ship's Wheel, Warp Ladder (the server's outcome, the balance settled)", !problems.length, problems.join("; "));
  }

  /* ═══ 4d. Lines (D47): 5 / 10 / 20 at a line bet; the max line bet per count; the total everywhere; the paylines and the
     paytable follow; a 20-line spin's request and win; the server's word on a wrong stake ═══ */
  for (const g of GAMES) {
    const problems = [], cfg = CFG[g], v = SPINS["lines-" + g];   // a version 6 spin at 20 lines with a win on a line past the tenth
    resetApi(); signIn(500000); api.spinQueue.push(v);
    await openMachine(g);
    // D48: the max line bet is the coin's max (tBCH 20,000) over the lines: 2,000 at 10 lines, 1,000 at 20, 4,000 at 5; the ladder's twelve stops.
    const s = await ev(`(() => { const S = TNC_PixiState; TNC_PixiLines(10); TNC_PixiBet(1500); const a = S(); TNC_PixiLines(20); const b = S(); TNC_PixiLines(5); TNC_PixiBet(9999); const c = S();
      return { opts: a.lineOpts, tabs: a.markerTabs, ladder: a.ladder, max: a.maxBet, a: [a.lines, a.lineBet, a.bet, a.maxLineBet, a.markers, a.keySub], b: [b.lines, b.lineBet, b.bet, b.maxLineBet, b.markers, b.lcdSub],
        c: [c.lines, c.lineBet, c.bet, c.maxLineBet, c.markers], stored: localStorage.getItem("tnc.lines"), scale: c.payScale, keys: c.linesAt.length }; })()`);
    if (JSON.stringify(s.opts) !== "[5,10,20]" || s.tabs !== 40 || s.keys !== 3) problems.push("selector: " + JSON.stringify({ opts: s.opts, tabs: s.tabs, keys: s.keys }));
    if (JSON.stringify(s.ladder) !== "[1,2,5,10,20,50,100,200,500,1000,2000,4000]" || s.max !== 20000) problems.push("ladder: " + JSON.stringify([s.ladder, s.max]));
    if (JSON.stringify(s.a) !== JSON.stringify([10, 1500, 15000, 2000, 10, "BET 15,000"])) problems.push("10 lines: " + JSON.stringify(s.a));
    if (JSON.stringify(s.b) !== JSON.stringify([20, 1000, 20000, 1000, 20, "Line bet 1,000 × 20 lines = 20,000 tBCH sats"])) problems.push("20 lines (the line bet lowered to its max): " + JSON.stringify(s.b));
    if (JSON.stringify(s.c) !== JSON.stringify([5, 4000, 20000, 4000, 5]) || s.stored !== "5" || s.scale !== cfg.payScales["5"]) problems.push("5 lines: " + JSON.stringify([s.c, s.stored, s.scale]));
    // The paytable follows the stake: the top symbol's pays in sats at line bet 4,000, the scatter's × the total of 20,000, 5 of 20 paylines lit, the 5-line hit rate, the limits text.
    const top = cfg.symbols.filter((x) => !x.kind).pop(), scat = cfg.symbols.find((x) => x.kind === "scatter");
    const pt = await ev(`(() => { const d = document.querySelector(".paytable");
      return { top: [...d.querySelectorAll("[data-pays]")].find((e) => e.getAttribute("data-pays") === ${JSON.stringify(top.pays.join(","))}).textContent, scat: d.querySelector('[data-pays][data-of="total bet"]').textContent,
        on: d.querySelectorAll(".lines-grid .pl:not(.is-off)").length, off: d.querySelectorAll(".lines-grid .pl.is-off").length, hit: d.querySelector('[data-stat="hit"]').textContent, head: d.querySelector("[data-lines-h]").textContent, text: d.textContent }; })()`);
    const topSats = top.pays.map((m) => Math.round(m * cfg.payScales["5"] * 4000).toLocaleString("en-US")).join(" / "), scatSats = scat.pays.map((m) => Math.round(m * cfg.payScales["5"] * 20000).toLocaleString("en-US")).join(" / ");
    if (!pt.top.includes(topSats) || !pt.scat.includes(scatSats)) problems.push("paytable sats: " + JSON.stringify([pt.top, topSats, pt.scat, scatSats]));
    if (pt.on !== 5 || pt.off !== 15 || pt.head !== "5 of 20 paylines active" || pt.hit !== Math.round(cfg.statsByLines["5"].hit * 100) + "%") problems.push("paytable lines/stats: " + JSON.stringify([pt.on, pt.off, pt.head, pt.hit]));
    if (!/Choose 5, 10 or 20 lines and a bet per line\. A spin costs line bet × lines\./.test(pt.text) || /\bRTP\b/.test(pt.text) || !/at every line count/.test(pt.text)) problems.push("lines text");
    if (!/from 1 to 4,000 at 5 lines, 2,000 at 10 lines, 1,000 at 20 lines \(a spin costs at most 20,000 tBCH sats\)/.test(pt.text)) problems.push("limits text");
    // A spin at 20 lines with a line bet of 1: the request carries lines and lineBet (no bet), the win on a line past the tenth is drawn, Recent spins says 20 lines.
    await ev(`TNC_PixiLines(20); TNC_PixiBet(1); window.__px = { wins: 0 }; setInterval(() => { const s = TNC_PixiState(); window.__px.wins = Math.max(window.__px.wins, s.wins); if (s.stage) TNC_PixiGo(); }, 50); ${space}`);
    await sleep(300);
    if (!(await until(`!TNC_PixiState().busy`, 60000))) problems.push("spin did not finish");
    const sp = api.log.find((x) => x.method === "POST" && x.path === "/spins");
    if (!sp || sp.body.lines !== 20 || sp.body.lineBet !== 1 || "bet" in sp.body) problems.push("request: " + JSON.stringify(sp && sp.body));
    const after = await ev(`({ wins: window.__px.wins, bal: TNC_Auth.balance, hist: document.querySelector("#history li").textContent, lcd: TNC_PixiState().lcdSub })`);
    if (after.wins < 1) problems.push("no win drawn (lines " + v.steps[0].phases[0].lines.map((l) => l.line + 1).join(", ") + ")");
    if (after.bal !== api.balance) problems.push(`balance ${after.bal} != server ${api.balance}`);
    if (!/bet 20 tBCH sats · 20 lines/.test(after.hist)) problems.push("history: " + after.hist);
    // The server's word on a wrong stake shows on the display.
    api.rejectSpin = { error: "invalid_bet", message: "The line bet must be 1 to 1,000 sats at 20 lines." };
    await ev(space);
    if (!(await until(`TNC_PixiState().lcd === "The line bet must be 1 to 1,000 sats at 20 lines." && !TNC_PixiState().busy`, 8000))) problems.push("invalid_bet message: " + await ev(`TNC_PixiState().lcd`));
    if (pageErrors.length) problems.push("errors: " + pageErrors.slice(0, 2).join(" | "));
    check(`${g}: lines 5 / 10 / 20 at a line bet (the max per count, the total on the key and the display, remembered), the paytable at the stake, a 20-line spin's request and win, the server's invalid_bet message`, !problems.length, problems.join("; "));
  }

  /* ═══ 4e. Free entry (D48): any line bet typed into the entry box, from the Line bet button or a tap on the console's readout;
     the range for the lines chosen, a number above the max lowered to it, the MAX key, Escape ═══ */
  for (const g of GAMES) {
    const problems = [];
    resetApi(); signIn(500000);
    await openMachine(g);
    const typed = async (text) => { await ev(`(() => { const i = document.getElementById("px-entry-in"); i.value = ${JSON.stringify(text)}; document.getElementById("px-entry").requestSubmit(); })()`); await sleep(150); };
    await ev(`TNC_PixiLines(10); TNC_PixiBet(5); document.getElementById("px-bet").click()`); await sleep(150);
    const e1 = await ev(`(() => { const s = TNC_PixiState(), i = document.getElementById("px-entry-in"); return { open: s.entry, hint: s.entryHint, max: s.entryMax, value: i.value, focused: document.activeElement === i, label: document.getElementById("px-entry-label").textContent }; })()`);
    if (!e1.open || e1.value !== "5" || !e1.focused || e1.label !== "LINE BET · tBCH sats" || e1.max !== "MAX 2,000" || !/^1 to 2,000 at 10 lines\. A spin costs line bet × 10: up to 20,000 tBCH sats\.$/.test(e1.hint)) problems.push("opened: " + JSON.stringify(e1));
    await typed("777");
    const e2 = await ev(`(() => { const s = TNC_PixiState(); return [s.entry, s.lineBet, s.bet, s.lcd, s.keySub, sessionStorage.getItem("tnc.lineBet.bch.${g}")]; })()`);
    if (JSON.stringify(e2) !== JSON.stringify([false, 777, 7770, "Line bet 777 × 10 lines = 7,770 tBCH sats. Press " + SPIN[g] + "!", "BET 7,770", "777"])) problems.push("777: " + JSON.stringify(e2));
    // Above the max: lowered to it, and the display says so
    await ev(`document.getElementById("px-bet").click()`); await sleep(100); await typed("5,000");
    const e3 = await ev(`(() => { const s = TNC_PixiState(); return [s.entry, s.lineBet, s.bet, s.lcd]; })()`);
    if (JSON.stringify(e3) !== JSON.stringify([false, 2000, 20000, "The line bet is at most 2,000 tBCH sats at 10 lines. Line bet 2,000 × 10 lines = 20,000 tBCH sats."])) problems.push("5,000: " + JSON.stringify(e3));
    // Nothing typed: the box stays with the current bet; Escape closes it; the MAX key at 20 lines sets 1,000
    await ev(`document.getElementById("px-bet").click()`); await sleep(100); await typed("");
    const e4 = await ev(`(() => { const s = TNC_PixiState(); return [s.entry, document.getElementById("px-entry-in").value, s.lineBet]; })()`);
    if (JSON.stringify(e4) !== JSON.stringify([true, "2000", 2000])) problems.push("empty: " + JSON.stringify(e4));
    await ev(`document.getElementById("px-entry-in").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`); await sleep(100);
    if (await ev(`TNC_PixiState().entry`)) problems.push("Escape did not close the box");
    await ev(`TNC_PixiLines(20); document.getElementById("px-bet").click()`); await sleep(100);
    const e5 = await ev(`(() => { const s = TNC_PixiState(); return [s.entryMax, s.entryHint, s.lineBet]; })()`);
    if (e5[0] !== "MAX 1,000" || !/^1 to 1,000 at 20 lines\./.test(e5[1]) || e5[2] !== 1000) problems.push("20 lines: " + JSON.stringify(e5));
    await ev(`TNC_PixiBet(3); document.getElementById("px-entry-max").click()`); await sleep(150);
    const e6 = await ev(`(() => { const s = TNC_PixiState(); return [s.entry, s.lineBet, s.bet, s.lcd]; })()`);
    if (JSON.stringify(e6) !== JSON.stringify([false, 1000, 20000, "Line bet 1,000 × 20 lines = 20,000 tBCH sats. Press " + SPIN[g] + "!"])) problems.push("MAX: " + JSON.stringify(e6));
    // A real tap on the console's bet readout opens the box too; the ladder's top stop is 4,000 (at 20 lines dark but there)
    await ev(`scrollTo(0, document.getElementById("px-canvas").getBoundingClientRect().bottom + scrollY - innerHeight + 20)`);   // the console in view
    await sleep(100);
    const at = await screenPoint(`TNC_PixiState().betEntryAt`);
    if (!at) problems.push("no readout point"); else { await click(at); await sleep(200); if (!(await ev(`TNC_PixiState().entry`))) problems.push("a tap on the readout did not open the box"); }
    await ev(`document.getElementById("px-entry-cancel").click()`); await sleep(100);
    if (await ev(`TNC_PixiState().entry`)) problems.push("Cancel did not close the box");
    if (pageErrors.length) problems.push("errors: " + pageErrors.slice(0, 2).join(" | "));
    check(`${g}: the bet entry box (the Line bet button and a tap on the readout) takes any line bet, lowers one above the max with a word on the display, MAX, Escape and Cancel`, !problems.length, problems.join("; "));
  }
  {
    resetApi();
    await open("index.html", 1280);
    const lobby = await until(`(() => { const hero = document.querySelector("#slots .jp-hero"), cards = [...document.querySelectorAll(".game-card")];
      return hero && hero.querySelector('[data-jackpot="grand"]').textContent === "121,994 tBCH sats" && !/Must hit|before it is full|gift/.test(document.getElementById("slots").textContent)
        && /Return to Player rate of 101%/.test(document.getElementById("slots").textContent) && !/110%|&gt;100%|>100%/.test(document.body.textContent) && /The casino with a 101% Return to Player rate/.test(document.querySelector(".hero-rtp").textContent) && !/\\bRTP\\b/.test(document.body.textContent + document.querySelector("meta[name=description]").content)
        && [...document.querySelectorAll("[data-rtp]")].every((e) => e.textContent === "101%")
        && cards.length === 4 && cards.slice(0, 3).every(c => /^45,6(7[89]|80) tBCH sats$/.test(c.querySelector('.gc-jp .jp-row-major [data-jackpot^="major:"]').textContent)
          && !c.querySelector('.jp-row-minor, [data-meter], [data-collector]'))
        && !!hero.querySelector('a[href="jackpots.html"]'); })()`);
    check("lobby: Grand amount, Major amount on every machine card, Return to Player 101% from the config, no \"RTP\" anywhere", lobby);
    const rlNums = JSON.stringify(ROULETTE.slice(0, 5).map((v) => String(v.number)));
    const rlCard = await until(`(() => { const c = document.querySelector('#roulette .game-card.theme-roulette[href="games/roulette.html"]');
      return !!c && !document.querySelector("#slots .theme-roulette") && JSON.stringify([...c.querySelectorAll('[data-rl-last] span')].map(s => s.textContent)) === ${JSON.stringify(rlNums)}
        && [...c.querySelectorAll('[data-rl-last] span')].every((s, i) => s.className === (/^pk-[rbg]/.exec(s.className)[0] + (i === 0 ? " pk-gold" : ""))) && /LIVE/.test(c.textContent); })()`);
    check("lobby: Roulette in its own section, apart from the slot machines and the Grand, with the last five numbers from GET /roulette/rounds, the golden round marked", rlCard);

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
      return amounts.length === 7 && [...amounts].every(a => /^[\\d,]+ tBCH sats$/.test(a.textContent)) && !/Must hit|before it is full|reaches its limit|10,000|50,000|2,500,000|gift/.test(pools.textContent + document.querySelector(".lb-lead").textContent)
        && cols.length === 3 && cols.every(c => c.textContent === "" && !/\\d/.test(c.title)) && cols.map(c => c.querySelector(".cl-level").style.getPropertyValue("--fill")).join(",") === "${["fruit-orchard", "deep-sea", "cosmic-voyage"].map(g => (COLLECTOR[g].filled / COLLECTOR[g].size * 100).toFixed(2) + "%").join(",")}"
        && rows.length === 4 && document.querySelectorAll("#jp-hashes > div").length === 7 && /3,290 tBCH sats/.test(rows[0].textContent)
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
    check("jackpots page: 7 amounts and 3 collectors (bars only, no numbers; no limits shown), seed hashes, wins with Verify (real passes, tampered fails, D40 by its own rules, first pools none), empty state",
      page && pass && fail && old && empty, `page ${!!page}, verify ${pass}, tampered ${fail}, d40 ${old}, empty ${!!empty}`);
  }

  /* ═══ 4c. Roulette (D44): one live table over the WebSocket ═══ */
  for (const width of [1280, 390]) {
    resetApi(); signIn(50000);
    await open("games/roulette.html", width, { height: width < 600 ? 860 : 1000 });
    const problems = [];
    if (!(await until(`typeof TNC_RouletteState === "function" && TNC_RouletteState().connected`, 20000))) { check(`roulette (${width}px): connects`, false); continue; }
    const iso = (ms) => new Date(Date.now() + ms).toISOString();
    const round = { id: 801, startsAt: iso(-3000), bettingEndsAt: iso(15000), seedHash: "b".repeat(64), status: "betting", nextRoundAt: iso(57000) };
    await ev(`__emit(${JSON.stringify({ type: "table", serverTime: new Date().toISOString(), round, nextRoundAt: round.nextRoundAt, players: ["bchtest:qphp...hdxy", "Passkey 3f9a2c"],
      bets: [{ id: 9001, player: "Passkey 3f9a2c", type: "red", numbers: null, amount: 100 }], canBet: true, you: "bchtest:qphp...hdxy", rules: RULES2 })}); 0`);
    await sleep(300);
    await ev(`scrollTo(0, document.getElementById("rt-stage").getBoundingClientRect().top + scrollY - 10)`);
    // Real clicks on the felt: every kind of bet lands as the right type and numbers.
    const want = [["straight", [17]], ["split", [17, 20]], ["split", [17, 18]], ["corner", [17, 18, 20, 21]], ["street", [16, 17, 18]], ["line", [13, 14, 15, 16, 17, 18]],
      ["trio", [0, 1, 2]], ["first-four", [0, 1, 2, 3]], ["straight", [0]], ["dozen2"], ["column3"], ["red"], ["odd"], ["high"]];
    for (const [type, numbers] of want) {
      const pt = await ev(`(() => { const c = document.querySelector("#rt-canvas canvas").getBoundingClientRect(), s = TNC_RouletteState().spotPoint(${JSON.stringify(type)}, ${JSON.stringify(numbers || null)}); return { x: c.left + s.x, y: c.top + s.y }; })()`);
      for (const t of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type: t, x: pt.x, y: pt.y, button: "left", clickCount: 1 });
      await sleep(60);
    }
    await until(`TNC_RouletteState().pending === 0 && TNC_RouletteState().myTotal > 0`, 4000);
    // The hover shows what the chip in hand returns (from the rules): the pointer is still on 19 to 36, a 10 chip.
    const tip = await ev(`TNC_RouletteState().hoverTip`);
    if (tip !== "19 to 36 · 1 to 1\n10 wins 20") problems.push("hover preview: " + JSON.stringify(tip));
    const rulesText = await ev(`document.getElementById("rt-rules").textContent`);
    if (!/35 to 136×360×/.test(rulesText) || !/Golden ball: in about 1 round in 236 the ball is golden and every win of the round pays ×10\. It is drawn from the round's seed when betting closes\./.test(rulesText)) problems.push("rules: " + rulesText.slice(0, 200));
    const placed = api.rt.chips.map((c) => c.type + (c.numbers ? ":" + c.numbers.join("-") : ""));
    const expected = want.map(([t, n]) => t + (n ? ":" + n.join("-") : ""));
    if (JSON.stringify(placed) !== JSON.stringify(expected)) problems.push("bets: " + JSON.stringify(placed));
    const st1 = await ev(`TNC_RouletteState()`);
    if (st1.myTotal !== 140 || st1.chips !== 15) problems.push(`table shows ${st1.chips} chips, my total ${st1.myTotal}`);
    // Chat is text, never HTML; joined lines; what we send goes out on the socket.
    await ev(`__emit(${JSON.stringify({ type: "chat", player: "Passkey 3f9a2c", text: "<img src=x onerror=alert(1)><b>hi</b>", at: new Date().toISOString() })}); __emit({ type: "joined", player: "Passkey 0c0ffe" });
      document.getElementById("rt-text").value = "good luck"; document.getElementById("rt-say").requestSubmit(); 0`);
    const chat = await ev(`({ html: document.querySelectorAll("#rt-chat img, #rt-chat b").length, text: document.getElementById("rt-chat").textContent, sent: window.__wsLog })`);
    if (chat.html || !/<b>hi<\/b>/.test(chat.text) || !/Passkey 0c0ffe joined/.test(chat.text) || !chat.sent.some((m) => m.type === "chat" && m.text === "good luck")) problems.push("chat: " + JSON.stringify(chat).slice(0, 200));
    // The spin: the number is known to the page but never shown before resultAt; then the result and our win.
    const bettingText = await ev(`(() => { const s = TNC_RouletteState(); return s.status + " " + s.sub + " " + s.banner + " " + s.golden + " " + document.getElementById("rt-results").textContent; })()`);
    if (/golden|GOLDEN|true/.test(bettingText)) problems.push("golden hinted during betting: " + bettingText);
    const spun = { ...round, status: "spinning", bettingEndsAt: iso(0), number: 17, spinSeconds: 4, golden: false, resultAt: iso(4000) };
    await ev(`__emit(${JSON.stringify({ type: "spin", serverTime: new Date().toISOString(), round: spun })}); 0`);
    await sleep(1500);
    const during = await ev(`(() => { const s = TNC_RouletteState(); return { s: s.status + " " + s.sub, rev: s.revealed, page: document.getElementById("app").innerText }; })()`);
    if (during.rev || /\b17 (BLACK|black)\b/.test(during.s + during.page)) problems.push("number shown during the spin: " + during.s);
    await ev(`__emit(${JSON.stringify({ type: "result", round: { ...spun, status: "settled", seed: "c".repeat(64) }, results: [{ player: "bchtest:qphp...hdxy", bet: 140, win: 370 }, { player: "Passkey 3f9a2c", bet: 100, win: 0 }] })});
      __emit({ type: "settled", roundId: 801, bet: 140, win: 370, balance: 50230 }); 0`);
    const after = await until(`(() => { const s = TNC_RouletteState(); return s.revealed && s.status === "17 BLACK" && /YOU WIN! \| \+370 tBCH sats/.test(s.banner) && s.recent[0] === 17; })()`, 6000);
    if (!after) problems.push("result: " + JSON.stringify(await ev(`TNC_RouletteState()`)).slice(0, 200));
    const res = await ev(`document.getElementById("rt-results").textContent`);
    if (!/\+230 tBCH sats/.test(res) || !/−100 tBCH sats/.test(res)) problems.push("results panel: " + res);
    // The next round clears the felt; joined mid-round: no bets until the next one.
    await ev(`__emit(${JSON.stringify({ type: "round", round: { id: 802, startsAt: iso(0), bettingEndsAt: iso(20000), seedHash: "d".repeat(64), status: "betting", nextRoundAt: iso(60000) } })}); 0`);
    const next = await ev(`TNC_RouletteState()`);
    if (next.chips !== 0 || next.revealed || !/PLACE YOUR BETS/.test(next.status)) problems.push("next round: " + JSON.stringify(next).slice(0, 160));
    await ev(`__emit(${JSON.stringify({ type: "table", serverTime: new Date().toISOString(), round: { id: 803, startsAt: iso(-25000), bettingEndsAt: iso(-5000), seedHash: "e".repeat(64), status: "spinning", number: 5, spinSeconds: 30, resultAt: iso(25000), nextRoundAt: iso(35000) }, nextRoundAt: iso(35000), players: ["bchtest:qphp...hdxy"], bets: [], canBet: false, you: "bchtest:qphp...hdxy" })}); 0`);
    const mid = await ev(`TNC_RouletteState()`);
    if (mid.canBet || !/next round · 0:3\d/.test(mid.sub)) problems.push("mid-round join: " + JSON.stringify({ s: mid.status, sub: mid.sub }));
    // A golden round: nothing during betting; from the spin a gold ball, the banner and the status; ×10 on the wins.
    await ev(`__emit(${JSON.stringify({ type: "table", serverTime: new Date().toISOString(), round: { id: 804, startsAt: iso(-1000), bettingEndsAt: iso(1500), seedHash: "f".repeat(64), status: "betting", nextRoundAt: iso(59000) }, nextRoundAt: iso(59000), players: ["bchtest:qphp...hdxy"], bets: [], canBet: true, you: "bchtest:qphp...hdxy", rules: RULES2 })}); 0`);
    const g0 = await ev(`TNC_RouletteState()`);
    if (g0.golden || /GOLDEN/.test(g0.status)) problems.push("golden before the spin: " + g0.status);
    const gspin = { id: 804, startsAt: iso(-1000), bettingEndsAt: iso(0), seedHash: "f".repeat(64), status: "spinning", number: 13, spinSeconds: 3, golden: true, resultAt: iso(3000), nextRoundAt: iso(59000) };
    await ev(`__emit(${JSON.stringify({ type: "spin", serverTime: new Date().toISOString(), round: gspin })}); 0`);
    await sleep(400);
    const g1 = await ev(`TNC_RouletteState()`);
    if (!g1.golden || g1.status !== "GOLDEN BALL · WINS ×10" || g1.banner !== "GOLDEN BALL! | All wins ×10" || g1.revealed) problems.push("golden spin: " + JSON.stringify({ s: g1.status, b: g1.banner, g: g1.golden }));
    await ev(`__emit(${JSON.stringify({ type: "result", round: { ...gspin, status: "settled", seed: "a".repeat(64) }, results: [{ player: "bchtest:qphp...hdxy", bet: 10, win: 3600 }] })});
      __emit({ type: "settled", roundId: 804, bet: 10, win: 3600, balance: 53820 }); 0`);
    const g2 = await until(`(() => { const s = TNC_RouletteState(); return s.revealed && s.status === "13 BLACK · GOLDEN ×10" && s.banner === "GOLDEN WIN ×10! | +3,600 tBCH sats" && s.recent[0] === 13 && s.recentGolden[0] === true; })()`, 9000);
    const gres = await ev(`document.getElementById("rt-results").textContent`);
    if (!g2 || !/Golden ball: every win of this round pays ×10/.test(gres) || !/×10\+3,590 tBCH sats/.test(gres)) problems.push("golden result: " + JSON.stringify(await ev(`(() => { const s = TNC_RouletteState(); return { status: s.status, banner: s.banner, recent: s.recent, recentGolden: s.recentGolden, revealed: s.revealed }; })()`)) + " | " + gres);
    // Previous rounds: Details checks a real round (backend vector) in the browser.
    if (width === 1280) {
      await until(`document.querySelectorAll("#rt-rounds tr").length === 5`, 4000);
      const marks = await ev(`[...document.querySelectorAll("#rt-rounds tr")].map(r => !!r.querySelector(".rt-gball"))`);
      if (JSON.stringify(marks) !== "[true,false,false,false,false]") problems.push("golden marks in previous rounds: " + JSON.stringify(marks));
      await ev(`document.querySelector("#rt-rounds .rt-verify").click()`);
      const fair = await until(`(() => { const t = (document.querySelector("#rt-rounds tr.rt-detail") || {}).textContent || ""; return /This round is fair/.test(t) && /golden ball \\(every win ×10\\), as played/.test(t) && document.querySelectorAll("#rt-rounds tr.rt-detail .jpw-checks .is-ok").length === 5; })()`, 8000);
      if (!fair) problems.push("round details: " + ((await ev(`(document.querySelector("#rt-rounds tr.rt-detail") || {}).textContent || ""`)) || "").slice(0, 200));
    }
    if (pageErrors.length) problems.push("errors: " + pageErrors.slice(0, 2).join(" | "));
    check(`roulette (${width}px): bets on the felt, chat as text, the number hidden until resultAt, result and win, next round, mid-round join${width === 1280 ? ", round details verified" : ""}, payouts and the golden ball (rules 2)`, !problems.length, problems.join("; "));
  }

  /* ═══ 5. Withdrawals page: whole list and total ═══ */
  resetApi();
  api.payouts = [1000, 2500, 107, 99999].map((a, i) => ({ sentAt: new Date(Date.now() - i * 3600e3).toISOString(), address: ADDR, amount: a, txid: String(i).repeat(64) }));
  await open("withdrawals.html", 1280);
  const total = await ev(`({ rows: document.querySelectorAll("#pay-body tr").length, title: document.getElementById("pay-total").title })`);
  check("withdrawals page lists every withdrawal and the right total", total.rows === 4 && total.title === "103,606 tBCH sats", `${total.rows} rows, ${total.title}`);

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
  check("account: withdraw form locked below 1,000 tBCH sats, open above", locked && unlocked);

  {
    // Roulette: the first player at an empty table (no round yet, canBet false) can bet once the first round opens,
    // without a reload; a player who joined during a round waits for the next one.
    const problems = [];
    resetApi(); signIn(50000);
    await open("games/roulette.html", 1280, { height: 1000 });
    if (!(await until(`typeof TNC_RouletteState === "function" && TNC_RouletteState().connected`, 20000))) problems.push("not connected");
    const iso = (ms) => new Date(Date.now() + ms).toISOString();
    await ev(`__emit(${JSON.stringify({ type: "table", serverTime: new Date().toISOString(), nextRoundAt: iso(2000), players: ["bchtest:qphp...hdxy"], bets: [], canBet: false, you: "bchtest:qphp...hdxy", rules: RULES2 })}); 0`);
    await sleep(200);
    if (await ev(`TNC_RouletteState().canBet`)) problems.push("canBet before any round");
    const r1 = { id: 701, startsAt: iso(500), bettingEndsAt: iso(15000), seedHash: "b".repeat(64), status: "betting", nextRoundAt: iso(60000) };
    await ev(`__emit(${JSON.stringify({ type: "round", round: r1 })}); 0`);
    await sleep(200);
    if (!(await ev(`TNC_RouletteState().canBet`))) problems.push("first round: cannot bet");
    await ev(`scrollTo(0, document.getElementById("rt-stage").getBoundingClientRect().top + scrollY - 10)`);
    const pt = await ev(`(() => { const c = document.querySelector("#rt-canvas canvas").getBoundingClientRect(), s = TNC_RouletteState().spotPoint("red", null); return { x: c.left + s.x, y: c.top + s.y }; })()`);
    for (const t of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type: t, x: pt.x, y: pt.y, button: "left", clickCount: 1 });
    if (!(await until(`TNC_RouletteState().myTotal > 0`, 4000))) problems.push("first round: chip not placed");
    // Joined during a round (table with a betting round that started before we joined): wait for the next round.
    resetApi(); signIn(50000);
    await open("games/roulette.html", 1280, { height: 1000 });
    await until(`typeof TNC_RouletteState === "function" && TNC_RouletteState().connected`, 20000);
    const r2 = { id: 702, startsAt: iso(-5000), bettingEndsAt: iso(15000), seedHash: "b".repeat(64), status: "betting", nextRoundAt: iso(55000) };
    await ev(`__emit(${JSON.stringify({ type: "table", serverTime: new Date().toISOString(), round: r2, nextRoundAt: r2.nextRoundAt, players: ["bchtest:qphp...hdxy"], bets: [], canBet: false, you: "bchtest:qphp...hdxy", rules: RULES2 })}); 0`);
    await sleep(200);
    if (await ev(`TNC_RouletteState().canBet`)) problems.push("mid-round join could bet");
    await ev(`__emit(${JSON.stringify({ type: "round", round: { ...r2, id: 703, startsAt: iso(1000), bettingEndsAt: iso(20000) } })}); 0`);
    await sleep(200);
    if (!(await ev(`TNC_RouletteState().canBet`))) problems.push("next round after a mid-round join: cannot bet");
    check("roulette: the first player at an empty table can bet when the first round opens (no reload); a mid-round join bets from the next round", !problems.length, problems.join("; "));
  }

  /* ═══ 7b. Two coins (D46): the header switch, tBTC everywhere ═══ */
  {
    const problems = [], hasCoin = (path, coin) => api.log.some((x) => x.path === path && new URLSearchParams(x.query).get("coin") === coin);
    // Header and lobby in tBTC: the switch, both balances, both faucets, tBTC jackpots, the daily bonus per coin.
    resetApi(); signIn(50000);
    await open("index.html", 1280, { coin: "btc" });
    await until(`!!document.querySelector(".chip-balance") && /12,199/.test(document.querySelector('[data-jackpot="grand"]').textContent)`, 8000);
    const h = await ev(`({ sel: (document.querySelector('.coin-opt[aria-checked="true"]') || {}).dataset?.coin, bal: document.querySelector(".chip-balance").textContent,
      other: document.querySelector(".chip-balance").title, chip: document.querySelector(".auth-user").textContent, fBtc: document.querySelector('[data-k="house:btc"]').textContent, fBch: document.querySelector('[data-k="house:bch"]').textContent,
      grand: document.querySelector('.jp-hero [data-jackpot="grand"]').textContent, bonus: [...document.querySelectorAll(".db-coin")].map((l) => l.dataset.coin + ":" + l.textContent),
      card: document.querySelector('.game-card [data-jackpot="major:fruit-orchard"]').textContent, coinAttr: document.documentElement.dataset.coin })`);
    if (h.sel !== "btc" || h.coinAttr !== "btc") problems.push("selected coin " + h.sel + "/" + h.coinAttr);
    if (!(await ev(`document.getElementById("quick-coins").hidden`))) problems.push("Just need tBTC or tBCH? shown while signed in");
    if (h.bal !== "5,000 tBTC sats" || h.other !== "Balance 5,000 tBTC sats, 50,000 tBCH sats" || /sats/.test(h.chip)) problems.push("balances: " + h.bal + " / " + h.other + " / chip " + h.chip);
    if (h.fBtc !== "0.04 tBTC" || h.fBch !== "1,110.43 tBCH") problems.push("faucet bar: " + h.fBtc + " / " + h.fBch);
    if (h.grand !== "12,199 tBTC sats" || h.card !== "4,568 tBTC sats" || !hasCoin("/jackpots", "btc")) problems.push("jackpots: " + h.grand + " / " + h.card);
    if (!(h.bonus.length === 2 && /^btc:100 tBTC satsClaim$/.test(h.bonus[0]) && /^bch:1,000 tBCH satsClaimed today$/.test(h.bonus[1]))) problems.push("bonus card: " + JSON.stringify(h.bonus));
    await ev(`document.querySelector('[data-claim="btc"]').click()`);
    if (!(await until(`document.querySelector(".chip-balance").textContent === "5,100 tBTC sats"`, 4000)) || !api.log.some((x) => x.method === "POST" && x.path === "/bonus/daily" && x.query === "?coin=btc")) problems.push("tBTC bonus not claimed");
    // Switching to tBCH reloads the page in tBCH (remembered).
    await ev(`document.querySelector('.coin-opt[data-coin="bch"]').click()`);
    await sleep(800);
    if (!(await until(`document.documentElement.dataset.coin === "bch" && (document.querySelector(".chip-balance") || {}).textContent === "50,000 tBCH sats" && localStorage.getItem("tnc.coin") === "bch"`, 8000))) problems.push("switch to tBCH: " + await ev(`document.documentElement.dataset.coin + " " + ((document.querySelector(".chip-balance") || {}).textContent)`));
    resetApi(); await open("index.html", 1280, { coin: "btc" }); await sleep(500);
    if (await ev(`document.getElementById("quick-coins").hidden`)) problems.push("Just need tBTC or tBCH? hidden while signed out");
    check("coins: the header switch (tBTC first), \"Just need\" only when signed out, both balances, both faucets, tBTC jackpots, a daily bonus per coin, switching reloads in the other coin", !problems.length, problems.join("; "));
  }
  {
    // A slot machine in tBTC: tBTC jackpots, bets up to 100, the spin's coin and the tBTC balance.
    const problems = [], g = "fruit-orchard", v = SPINS[g];
    resetApi(); signIn(500000); api.spinQueue.push(v);
    if (!(await openMachine(g, 1280, "btc"))) problems.push("not built");
    await until(`TNC_PixiState().jackpots.grand === "12,199 tBTC sats"`, 8000);
    const j = await ev(`TNC_PixiState().jackpots`);
    if (j.grand !== "12,199 tBTC sats" || j.major !== "4,568 tBTC sats") problems.push("jackpots " + JSON.stringify(j));
    await ev(`TNC_PixiLines(10); TNC_PixiBet(1000)`);   // D48: the line bet capped at 200 at 10 lines, the total at 2,000; the tBTC ladder's nine stops
    const mx = await ev(`(() => { const s = TNC_PixiState(); return [s.lineBet, s.bet, s.maxLineBet, s.ladder, s.maxBet]; })()`);
    if (JSON.stringify(mx) !== JSON.stringify([200, 2000, 200, [1, 2, 5, 10, 20, 50, 100, 200, 400], 2000])) problems.push("max bet " + JSON.stringify(mx));
    if (!/tBTC sats/.test(await ev(`TNC_PixiState().lcd + " " + TNC_PixiState().jackpots.minor`))) problems.push("unit");
    await ev(`window.__px = {}; setInterval(() => { if (TNC_PixiState().stage) TNC_PixiGo(); }, 50); TNC_PixiLines(10); TNC_PixiBet(${v.bet}); ${space}`);
    await sleep(300);
    if (!(await until(`!TNC_PixiState().busy`, 60000))) problems.push("spin did not finish");
    const sp = api.log.find((x) => x.method === "POST" && x.path === "/spins");
    if (!sp || sp.body.coin !== "btc" || sp.body.lines !== 10 || sp.body.lineBet !== v.bet || "bet" in sp.body) problems.push("spin request " + JSON.stringify(sp && sp.body));
    const after = await ev(`({ bal: TNC_Auth.balance, bch: TNC_Auth.balanceOf("bch"), shown: TNC_PixiState().balance })`);
    if (after.bal !== api.btc || after.bch !== 500000 || after.shown.replace(/\D/g, "") !== String(api.btc)) problems.push("balances " + JSON.stringify(after) + " server " + api.btc);
    check("coins: a slot machine in tBTC (tBTC jackpots, bets up to 100, the spin's coin, the tBTC balance; tBCH untouched)", !problems.length, problems.join("; "));
  }
  {
    // Roulette in tBTC: tBTC chips and limits, chips of both coins on one table, results per coin.
    const problems = [];
    resetApi(); signIn(50000);
    await open("games/roulette.html", 1280, { coin: "btc", height: 1000 });
    if (!(await until(`typeof TNC_RouletteState === "function" && TNC_RouletteState().connected`, 20000))) problems.push("not connected");
    const iso = (ms) => new Date(Date.now() + ms).toISOString();
    const round = { id: 901, startsAt: iso(-3000), bettingEndsAt: iso(15000), seedHash: "b".repeat(64), status: "betting", nextRoundAt: iso(57000) };
    await ev(`__emit(${JSON.stringify({ type: "table", serverTime: new Date().toISOString(), round, nextRoundAt: round.nextRoundAt, players: ["bchtest:qphp...hdxy", "Passkey 3f9a2c"],
      bets: [{ id: 9001, player: "Passkey 3f9a2c", coin: "bch", type: "red", numbers: null, amount: 100 }, { id: 9002, player: "Passkey 3f9a2c", coin: "btc", type: "black", numbers: null, amount: 7 }],
      canBet: true, you: "bchtest:qphp...hdxy", rules: RULES2, limits: { bch: { maxChip: 1000, maxPerRound: 10000 }, btc: { maxChip: 100, maxPerRound: 1000 } } })}); 0`);
    await sleep(300);
    const s0 = await ev(`TNC_RouletteState()`);
    if (s0.coin !== "btc" || JSON.stringify(s0.chipValues) !== "[1,2,5,10,25,50,100]" || s0.limits.btc.maxPerRound !== 1000) problems.push("tBTC rack " + JSON.stringify({ c: s0.coin, v: s0.chipValues }));
    await ev(`scrollTo(0, document.getElementById("rt-stage").getBoundingClientRect().top + scrollY - 10)`);
    const pt = await ev(`(() => { const c = document.querySelector("#rt-canvas canvas").getBoundingClientRect(), s = TNC_RouletteState().spotPoint("straight", [17]); return { x: c.left + s.x, y: c.top + s.y }; })()`);
    for (const t of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type: t, x: pt.x, y: pt.y, button: "left", clickCount: 1 });
    await until(`TNC_RouletteState().pending === 0 && TNC_RouletteState().myTotal > 0`, 4000);
    const bet = api.log.find((x) => x.path === "/roulette/bets");
    const s1 = await ev(`({ my: TNC_RouletteState().myTotal, coins: TNC_RouletteState().chipCoins.sort().join(","), players: document.getElementById("rt-players").textContent, bal: TNC_Auth.balance })`);
    if (!bet || bet.body.coin !== "btc" || s1.my !== 10 || s1.coins !== "bch,btc,btc" || s1.bal !== 4990) problems.push("bet " + JSON.stringify({ b: bet && bet.body, s1 }));
    if (!/100 tBCH sats/.test(s1.players) || !/7 tBTC sats/.test(s1.players)) problems.push("players: " + s1.players);
    const spun = { ...round, status: "spinning", bettingEndsAt: iso(0), number: 17, spinSeconds: 2, golden: false, resultAt: iso(2000) };
    await ev(`__emit(${JSON.stringify({ type: "spin", serverTime: new Date().toISOString(), round: spun })}); 0`);
    await sleep(2300);
    await ev(`__emit(${JSON.stringify({ type: "result", round: { ...spun, status: "settled", seed: "c".repeat(64) }, results: [{ player: "bchtest:qphp...hdxy", coin: "btc", bet: 10, win: 360 }, { player: "Passkey 3f9a2c", coin: "bch", bet: 100, win: 0 }, { player: "Passkey 3f9a2c", coin: "btc", bet: 7, win: 14 }] })});
      __emit({ type: "settled", roundId: 901, coin: "btc", bet: 10, win: 360, balance: 5350 }); 0`);
    const won = await until(`/BIG WIN! \\| \\+360 tBTC sats/.test(TNC_RouletteState().banner) && TNC_Auth.balance === 5350`, 6000);
    const res = await ev(`document.getElementById("rt-results").textContent`);
    if (!won || !/You\+350 tBTC sats/.test(res) || !/−100 tBCH sats/.test(res) || !/\+7 tBTC sats/.test(res)) problems.push("result: " + res + " | banner " + (await ev(`TNC_RouletteState().banner + " | balance " + TNC_Auth.balance`)));
    check("coins: roulette in tBTC (tBTC chips and limits, both coins on one table, results and the win per coin)", !problems.length, problems.join("; "));
  }
  {
    // Leaderboards: the coin toggle loads that coin's boards. Withdrawals page: both coins, each to its explorer.
    const problems = [];
    resetApi(); signIn();
    api.leaderboards = { balances: [{ rank: 1, player: "Passkey aaaaaa", method: "passkey", amount: 99999 }], wins24h: [], wins30d: [], winsAllTime: [], withdrawals24h: [], withdrawals30d: [], withdrawalsAllTime: [], updatedAt: new Date().toISOString() };
    api.btcLeaderboards = { ...api.leaderboards, balances: [{ rank: 1, player: "tb1qw5...jzsx", method: "wallet", amount: 4242 }] };
    await open("leaderboards.html", 1280, { coin: "bch" });
    await until(`/99,999/.test(document.getElementById("lb-panels").textContent)`, 6000);
    await ev(`document.querySelector('.lb-coin-opt[data-coin="btc"]').click()`);
    const lb = await until(`/4,242/.test(document.getElementById("lb-panels").textContent) && /Balance \\(tBTC sats\\)/.test(document.getElementById("lb-panels").textContent)`, 6000);
    if (!lb || !hasCoinGlobal("/leaderboards", "btc")) problems.push("leaderboard toggle");
    api.payouts = [{ coin: "btc", sentAt: new Date().toISOString(), address: "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx", amount: 2000, txid: "d".repeat(64) },
      { coin: "bch", sentAt: new Date().toISOString(), address: ADDR, amount: 150000, txid: "e".repeat(64) }];
    await open("withdrawals.html", 1280);
    await until(`document.querySelectorAll("#pay-body tr").length === 2`, 6000);
    const w = await ev(`({ links: [...document.querySelectorAll("#pay-body a")].map((a) => a.href), total: document.getElementById("pay-total").textContent, title: document.getElementById("pay-total").title })`);
    if (w.links[0] !== "https://mempool.space/testnet4/tx/" + "d".repeat(64) || w.links[1] !== "https://bchexplorer.cash/testnet4/tx/" + "e".repeat(64)) problems.push("explorer links " + JSON.stringify(w.links));
    if (w.title !== "2,000 tBTC sats, 150,000 tBCH sats" || !/0\.00002000 tBTC/.test(w.total)) problems.push("totals " + w.total + " | " + w.title);
    check("coins: the leaderboards coin toggle; the withdrawals page lists both coins, tBTC on mempool.space, tBCH on bchexplorer.cash", !problems.length, problems.join("; "));
  }
  {
    // Account in tBTC: both balances, the tBTC history, address checks by coin, a tBTC withdrawal, saved addresses.
    const problems = [];
    resetApi(); signIn(50000);
    await open("account.html", 1280, { coin: "btc" });
    await until(`!document.getElementById("acct").hidden && document.getElementById("acct-balance").textContent === "5,000 tBTC sats"`, 6000);
    const a = await ev(`({ other: document.getElementById("acct-balances").textContent, saved: [...document.querySelectorAll("#sv-list li")].map((l) => l.dataset.coin + ":" + l.textContent),
      hint: [...document.querySelectorAll("[data-coin-show]")].filter((e) => !e.hidden).map((e) => e.id), ph: document.getElementById("wd-address").placeholder })`);
    if (a.other !== "50,000 tBCH sats" || a.ph !== "tb1..." || a.hint.join() !== "wd-hint-btc") problems.push("account " + JSON.stringify(a));
    if (!(a.saved.length === 2 && /^btc:.*None saved.*Save a tBTC address$/.test(a.saved[0]) && /^bch:.*bchtest:qphp.*Your sign-in address$/.test(a.saved[1]))) problems.push("saved: " + JSON.stringify(a.saved));
    if (!hasCoinGlobal("/ledger", "btc")) problems.push("ledger not in tBTC");
    await ev(`document.getElementById("wd-amount").value = "2000"; document.getElementById("wd-address").value = "${ADDR}"; document.getElementById("wd-form").requestSubmit()`);
    const wrong = await ev(`document.getElementById("wd-address-error").textContent`);
    if (!/That is a Bitcoin Cash Testnet4 address/.test(wrong)) problems.push("wrong coin: " + wrong);
    await ev(`document.getElementById("wd-address").value = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx"; document.getElementById("wd-form").requestSubmit()`);
    await until(`/Withdrawal requested: 2,000 tBTC sats/.test(document.getElementById("wd-status").textContent)`, 5000);
    const wd = api.log.find((x) => x.method === "POST" && x.path === "/withdrawals");
    if (!wd || wd.body.coin !== "btc" || wd.body.address !== "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx" || wd.body.amount !== 2000) problems.push("withdraw " + JSON.stringify(wd && wd.body));
    await ev(`document.getElementById("wd-amount").value = "200000"; document.getElementById("wd-form").requestSubmit()`);
    if (!/The maximum is 100,000 tBTC sats/.test(await ev(`document.getElementById("wd-error").textContent`))) problems.push("tBTC maximum");
    check("coins: the account in tBTC (both balances, tBTC history, the address checked by coin, a tBTC withdrawal, saved addresses per coin)", !problems.length, problems.join("; "));
  }
  {
    // Sign-in with a tBTC wallet: the address decides the coin; mainnet and script addresses are refused early.
    const problems = [];
    resetApi();
    await open("login.html", 1280);
    async function tryAddr(x) { await ev(`document.getElementById("w-address").value = ${JSON.stringify(x)}; document.getElementById("w-step1").requestSubmit()`); await sleep(150); return ev(`document.getElementById("w-address-error").hidden ? "" : document.getElementById("w-address-error").textContent`); }
    if (!/Bitcoin mainnet/.test(await tryAddr("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"))) problems.push("mainnet not refused");
    if (!/cannot sign/.test(await tryAddr("2MzQwSSnBHWHqSAqtTVQ6v47XtaisrJa1Vc"))) problems.push("script not refused");
    if (!/typo/.test(await tryAddr("tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsy"))) problems.push("typo not caught");
    if ((await tryAddr("tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx")) !== "") problems.push("tb1q refused");
    if (!api.log.some((x) => x.path === "/auth/wallet/challenge" && x.body.address === "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx")) problems.push("no challenge for tb1q");
    if ((await tryAddr("mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn")) !== "") problems.push("m... refused");
    check("coins: sign-in takes a tBTC address (tb1q, m...), refuses mainnet, script addresses and typos before asking the server", !problems.length, problems.join("; "));
  }

  /* ═══ 8. Fairness verifier ═══ */
  resetApi();
  await open("fairness.html", 1280);
  const fill = (o) => ev(`(() => { const f = (i, x) => { const e = document.getElementById(i); if (e.type === "checkbox") e.checked = !!x; else e.value = x; };
    ${Object.entries(o).map(([k, x]) => `f(${JSON.stringify(k)}, ${JSON.stringify(x)});`).join(" ")} document.getElementById("vf-submit").click(); })()`);
  const result = () => ev(`document.getElementById("vf-result").textContent`);
  const base = (v) => ({ "vf-game": v.gameId, "vf-version": String(v.gameVersion), "vf-lines": String(v.lines || 10), "vf-bet": v.bet, "vf-seed": v.serverSeed, "vf-client": v.clientSeed, "vf-nonce": v.nonce, "vf-reward": "", "vf-nojp": false });
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
  const rvok = await until(`(() => { const t = document.getElementById("vf-result").textContent; return /✓ matches/.test(t) && /Treasure Hold & Win at 3 sats/.test(t); })()`, 10000);
  check("fairness: the verifier replays a version 4 jackpot (clam pick) and a collector reward at its bet", j4ok && rvok, `jackpot ${!!j4ok}, reward ${!!rvok}: ${(await result()).slice(0, 160)}`);
  const lv = SPINS["lines-cosmic-voyage"];   // version 6 (D47): a spin at 20 lines, its win on line 20
  await fill({ ...base(lv), "vf-expect": lv.totalWin });
  const lvok = await until(`(() => { const t = document.getElementById("vf-result").textContent; return /✓ matches/.test(t) && /20 lines \\(version 6\\)/.test(t); })()`, 10000);
  check("fairness: the verifier replays a version 6 spin at 20 lines (line wins × the line bet, payScale of the line count)", lvok, lvok ? "" : (await result()).slice(0, 160));
  const mv = METERS[2];
  await ev(`(() => { const f = (i, x) => document.getElementById(i).value = x; f("mt-tier", "grand"); f("mt-rules", "current"); f("mt-min", ${mv.minSats}); f("mt-max", ${mv.maxSats});
    f("mt-seed", "${mv.seed}"); f("mt-hash", "${mv.seedHash}"); f("mt-amount", ${mv.startSats + 1});
    document.getElementById("mt-submit").click(); })()`);
  const meterOk = await until(`(() => { const t = document.getElementById("mt-result").textContent;
    return /Every check passed/.test(t) && t.includes("${mv.target.toLocaleString("en-US")} sats") && !/Display scale/.test(t)
      && t.includes("Head start${mv.startSats.toLocaleString("en-US")} sats") && t.includes("${mv.seedHash}"); })()`, 5000);
  check("fairness: the jackpot checker derives seed hash, target and head start from a seed", meterOk);
  const rv0 = ROULETTE[0];
  await ev(`document.getElementById("rl-id").value = ${rv0.roundId}; document.getElementById("rl-load").click(); 0`);
  const rlOk = await until(`(() => { const t = document.getElementById("rl-result").textContent;
    return /every check passed/.test(t) && t.includes("Round ${rv0.roundId}: ${rv0.number}") && /golden ball \\(wins ×10\\)/.test(t) && (t.match(/✓ Passed/g) || []).length === 5; })()`, 8000);
  const rlText = rlOk ? "" : (await ev(`document.getElementById("rl-result").textContent`)).slice(0, 200);
  const rv1 = ROULETTE.find((v) => v.rules === 1);
  await ev(`document.getElementById("rl-id").value = ${rv1.roundId}; document.getElementById("rl-load").click(); 0`);
  const rl1Ok = await until(`(() => { const t = document.getElementById("rl-result").textContent;
    return /every check passed/.test(t) && t.includes("Round ${rv1.roundId}: ${rv1.number}") && !/golden/i.test(t) && document.getElementById("rl-rules").value === "1" && (t.match(/✓ Passed/g) || []).length === 4; })()`, 8000);
  check("fairness: the roulette check recomputes a golden round (rules 2) and an older round (rules 1) from their seeds (backend vectors)", rlOk && rl1Ok,
    rlText + (rl1Ok ? "" : " | rules 1: " + (await ev(`document.getElementById("rl-result").textContent`)).slice(0, 200)));

  // Your spins: GET /spins has no steps, so the page finds a reward's bet itself; a jackpot must match jackpotWin.
  resetApi(); signIn();
  const item = (v, extra = {}) => ({ id: v.nonce, gameId: v.gameId, gameVersion: v.gameVersion, bet: v.bet, lines: v.lines, totalWin: v.totalWin + (v.reward ? v.reward.win : 0),
    jackpotWin: 0, nonce: v.nonce, serverSeedHash: v.serverSeedHash, serverSeed: v.serverSeed, clientSeed: v.clientSeed, createdAt: new Date().toISOString(), ...extra });
  api.history = [item(SPINS["reward-fruit-orchard"]), item(SPINS["reward-deep-sea"]), item(SPINS["reward-cosmic-voyage"]),
    item(SPINS["lines-deep-sea"]),   // version 6 at 20 lines (D47)
    item(SPINS["jackpot-cosmic-voyage"], { jackpotWin: 1234 }), item(SPINS["fruit-orchard"]), item(SPINS["jackpot-fruit-orchard"], { jackpotWin: 777 }),
    item(SPINS["jackpot-deep-sea"]),   // a jackpot in the replay, none paid: only if jackpots were off (GET /spins has no flag)
    item(SPINS["deep-sea"], { totalWin: SPINS["deep-sea"].totalWin + 1 })];   // tampered: a mismatch
  await open("fairness.html", 1280);
  await until(`document.querySelectorAll("#sp-body tr").length === 9`);
  await ev(`document.getElementById("sp-verify-all").click()`);
  const listOk = await until(`/1 of 9 spins did NOT match/.test(document.getElementById("sp-status").textContent)`, 30000);
  const notes = await ev(`[...document.querySelectorAll("#sp-body tr")].map(r => r.querySelector(".sp-check").textContent + " | " + ((r.querySelector(".sp-result") || {}).title || ""))`);
  const linesCol = await ev(`[...document.querySelectorAll("#sp-body tr")].map(r => r.querySelector(".sp-lines").textContent)`);
  check("fairness: Verify all finds each collector reward's bet, replays a 20-line spin and checks jackpots against jackpotWin; the lines next to every bet",
    listOk && notes.slice(0, 3).every((n) => /✓ Verified \| This spin filled the collector; its reward played at 3 sats/.test(n))
      && notes.slice(3, 7).every((n) => /^✓ Verified/.test(n)) && /^✓ Verified \| Jackpots were off for this spin/.test(notes[7]) && /^✗ Mismatch/.test(notes[8])
      && linesCol[3] === "20 lines" && linesCol[4] === "10 lines",
    JSON.stringify(notes).slice(0, 400) + " " + JSON.stringify(linesCol));

} catch (e) {
  check("test run", false, e.message);
} finally {
  ws.close(); chrome.kill(); server.close();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed.`);
process.exit(failed ? 1 : 0);
