#!/usr/bin/env node
/*
 * TestnetCasino.com site tool (Node 18+, no dependencies). The site itself has no
 * build step: this only rewrites the shared parts of the static HTML pages.
 *
 *   node tools/site.mjs build      write the shared blocks (warning strip, faucet bar,
 *                                  small header, nav, footer) into every page from the
 *                                  templates below, and give every local script and
 *                                  stylesheet link the same ?v= version tag
 *   node tools/site.mjs check      exit 1 if any page is out of date (nothing is written)
 *   node tools/site.mjs version    bump the ?v= tag (YYYYMMDD + letter) everywhere, then build
 *   node tools/site.mjs version X  set the tag to X
 *
 * In the pages, each shared block sits between markers, for example
 *   <!-- site:nav --> ... <!-- /site:nav -->
 * Only the text between the markers is replaced. Edit the templates here, never the
 * copies in the pages. To add a page: add it to PAGES and put the markers in it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// id: used for aria-current; warning: which warning strip the page shows (null = none).
const PAGES = [
  { file: "index.html", id: "lobby", warning: null, header: false },
  { file: "login.html", id: "login", warning: "site", header: true },
  { file: "account.html", id: "account", warning: "site", header: true },
  { file: "fairness.html", id: "fairness", warning: "site", header: true },
  { file: "leaderboards.html", id: "leaderboards", warning: "site", header: true },
  { file: "jackpots.html", id: "jackpots", warning: "site", header: true },
  { file: "withdrawals.html", id: "withdrawals", warning: "site", header: true },
  { file: "games/fruit-orchard.html", id: "fruit-orchard", warning: "game", header: true },
  { file: "games/deep-sea.html", id: "deep-sea", warning: "game", header: true },
  { file: "games/cosmic-voyage.html", id: "cosmic-voyage", warning: "game", header: true }
];

// Nav chips, in order. `to` is the target relative to the site root.
const NAV = [
  { id: "lobby", to: "./", emoji: "🎰", label: "Lobby" },
  { id: "fruit-orchard", to: "games/fruit-orchard.html", emoji: "🍒", label: "Fruit Orchard" },
  { id: "deep-sea", to: "games/deep-sea.html", emoji: "🐚", label: "Deep Sea" },
  { id: "cosmic-voyage", to: "games/cosmic-voyage.html", emoji: "🚀", label: "Cosmic Voyage" },
  { id: "fairness", to: "fairness.html", emoji: "⚖️", label: "Fairness" },
  { id: "leaderboards", to: "leaderboards.html", emoji: "🏆", label: "Leaderboards" },
  { id: "jackpots", to: "jackpots.html", emoji: "💰", label: "Jackpots" },
  { id: "withdrawals", to: "withdrawals.html", emoji: "📤", label: "Withdrawals" }
];

// A root-relative target as seen from the page's folder.
function rel(page, to) {
  const inGames = page.file.startsWith("games/");
  if (!inGames) return to;
  if (to === "./") return "../";
  if (to.startsWith("games/")) return to.slice("games/".length);
  return "../" + to;
}

const BLOCKS = {
  warning(page) {
    const text = page.warning === "game"
      ? "Bitcoin Cash Testnet4 only. Not a real casino: no real money, no mainnet crypto, no deposits."
      : "Not a real casino: no real money, no mainnet crypto, no deposits.";
    return [
      `  <div class="warning-strip" role="note">`,
      `    <span aria-hidden="true">⚠️</span> ${text} <a href="${rel(page, "./")}#notice">House notice</a>`,
      `  </div>`
    ];
  },
  faucet() {
    return [`  <section class="faucet-bar" id="faucet-bar" aria-label="Faucet status"></section>`];
  },
  header(page) {
    return [
      `    <header class="logo-area">`,
      `      <a class="marquee small" id="marquee" href="${rel(page, "./")}" aria-label="TestnetCasino.com lobby">`,
      `        <span class="mq-title">TESTNETCASINO<span class="dot">.COM</span></span>`,
      `        <span class="mq-sub"><span aria-hidden="true">♠ <span class="suit-red">♥</span></span> BCH TESTNET4 FAUCET <span aria-hidden="true">♣ <span class="suit-red">♦</span></span></span>`,
      `      </a>`,
      `    </header>`
    ];
  },
  nav(page) {
    const lines = [`    <nav class="nav-bar" aria-label="Site">`];
    for (const n of NAV) {
      const cur = n.id === page.id ? ` aria-current="page"` : "";
      lines.push(`      <a class="chip-link" href="${rel(page, n.to)}"${cur}><span class="chip-emoji" aria-hidden="true">${n.emoji}</span> ${n.label}</a>`);
    }
    // auth.js replaces this with the account chips once it knows who is signed in.
    const signCur = page.id === "login" ? ` aria-current="page"` : "";
    lines.push(`      <span class="auth-nav" id="auth-nav"><a class="chip-link auth-pill" href="${rel(page, "login.html")}"${signCur}><span class="chip-emoji" aria-hidden="true">🔑</span> Sign in</a></span>`);
    lines.push(`    </nav>`);
    return lines;
  },
  footer(page) {
    const r = (to) => rel(page, to);
    const notice = page.id === "lobby" ? "#notice" : r("index.html") + "#notice";
    return [
      `    <footer class="casino-footer">`,
      `      <div class="cf-links">`,
      `        <a href="${r("fairness.html")}"><span aria-hidden="true">⚖️</span> Provably fair</a>`,
      `        <a href="${r("leaderboards.html")}"><span aria-hidden="true">🏆</span> Leaderboards</a>`,
      `        <a href="${r("jackpots.html")}"><span aria-hidden="true">💰</span> Jackpots</a>`,
      `        <a href="${r("withdrawals.html")}"><span aria-hidden="true">📤</span> Withdrawals</a>`,
      `        <a href="${r("account.html")}"><span aria-hidden="true">👤</span> Your account</a>`,
      `        <a href="${notice}"><span aria-hidden="true">⚠️</span> House notice</a>`,
      `        <a href="${r("legal/terms-of-service.pdf")}" type="application/pdf"><span aria-hidden="true">📄</span> Terms<span class="sr-only"> of Service (PDF)</span></a>`,
      `        <a href="${r("legal/privacy-policy.pdf")}" type="application/pdf"><span aria-hidden="true">🔒</span> Privacy<span class="sr-only"> Policy (PDF)</span></a>`,
      `      </div>`,
      `      <div class="cf-networks">`,
      `        <div>Bitcoin Cash Testnet4 coins mined by: <a href="https://test.bch.ee" rel="noopener">test.bch.ee</a> · <a href="https://test.bitcoincash.ee" rel="noopener">test.bitcoincash.ee</a></div>`,
      `        <div>Bitcoin Cash Testnet4 explorer: <a href="https://bchexplorer.cash/testnet4/" rel="noopener">bchexplorer.cash/testnet4</a></div>`,
      `      </div>`,
      `      <div class="cf-bottom">`,
      `        <div>© 2026 TestnetCasino.com · a <a class="cf-solochance" href="https://solochance.org" rel="noopener">SoloChance.org</a> project</div>`,
      `        <div>Built in 🇪🇪 Estonia · Hosted in 🇳🇱 Netherlands</div>`,
      `        <div class="cf-disclaimer"><span aria-hidden="true">♠</span> Not a real casino. Bitcoin Cash Testnet4 coins only. No deposits, no real money. <span aria-hidden="true">♦</span></div>`,
      `      </div>`,
      `    </footer>`
    ];
  }
};

// Which blocks each page must have.
function blocksFor(page) {
  const list = ["faucet", "nav", "footer"];
  if (page.warning) list.unshift("warning");
  if (page.header) list.push("header");
  return list;
}

const VERSION_RE = /((?:src|href)="(?:\.\.\/)?assets\/(?:js|css)\/[\w.-]+\.(?:js|css))\?v=(\w+)"/g;

function currentVersion() {
  const s = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const m = /assets\/css\/style\.css\?v=(\w+)"/.exec(s);
  if (!m) throw new Error("index.html: no ?v= tag on style.css");
  return m[1];
}

function nextVersion(cur) {
  const d = new Date();
  let today = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  // Never go back to an older tag (a clock behind the last tag's date): browsers may still
  // have files cached under it. Continue from the last tag's date instead.
  const curDate = (/^\d{8}/.exec(cur) || [""])[0];
  if (curDate > today) today = curDate;
  if (!cur.startsWith(today)) return today + "a";
  const suffix = cur.slice(today.length) || "a";
  // a..z, then za..zz, ... (keeps the tags sortable)
  const last = suffix[suffix.length - 1];
  return today + (last === "z" ? suffix + "a" : suffix.slice(0, -1) + String.fromCharCode(last.charCodeAt(0) + 1));
}

// Returns the page text with every block and version tag up to date.
function render(page, text, version) {
  for (const name of blocksFor(page)) {
    const open = `<!-- site:${name} -->`, close = `<!-- /site:${name} -->`;
    const a = text.indexOf(open), b = text.indexOf(close);
    if (a < 0 || b < 0 || b < a) throw new Error(`${page.file}: missing markers for "${name}"`);
    if (text.indexOf(open, a + 1) >= 0) throw new Error(`${page.file}: "${name}" markers appear twice`);
    // Keep the opening marker, replace everything up to the closing marker's line, keep that line.
    const closeLine = text.lastIndexOf("\n", b - 1) + 1;
    text = text.slice(0, a + open.length) + "\n" + BLOCKS[name](page).join("\n") + "\n" + text.slice(closeLine);
  }
  return text.replace(VERSION_RE, (m, link) => `${link}?v=${version}"`);
}

function run(mode, version) {
  let stale = 0;
  for (const page of PAGES) {
    const file = path.join(ROOT, page.file);
    const before = fs.readFileSync(file, "utf8");
    const after = render(page, before, version);
    if (after === before) continue;
    stale++;
    if (mode === "check") console.log(`out of date: ${page.file}`);
    else { fs.writeFileSync(file, after); console.log(`updated: ${page.file}`); }
  }
  // The README names the current tag.
  const readme = path.join(ROOT, "README.md");
  const r = fs.readFileSync(readme, "utf8"), r2 = r.replace(/\?v=\w+/g, `?v=${version}`);
  if (r2 !== r) { stale++; if (mode === "check") console.log("out of date: README.md"); else { fs.writeFileSync(readme, r2); console.log("updated: README.md"); } }
  return stale;
}

const [cmd = "build", arg] = process.argv.slice(2);
if (cmd === "build") {
  const n = run("build", currentVersion());
  console.log(n ? `${n} file(s) updated.` : "All pages are up to date.");
} else if (cmd === "check") {
  const n = run("check", currentVersion());
  console.log(n ? `${n} file(s) out of date: run "node tools/site.mjs build".` : "All pages are up to date.");
  process.exit(n ? 1 : 0);
} else if (cmd === "version") {
  const v = arg || nextVersion(currentVersion());
  if (!/^\w+$/.test(v)) { console.error("The version tag may only contain letters, digits and _."); process.exit(2); }
  run("build", v);
  console.log(`Version tag: ?v=${v}`);
} else {
  console.error(`Unknown command "${cmd}". Use build, check or version.`);
  process.exit(2);
}
