#!/usr/bin/env node
/*
 * TestnetCasino.com site tool (Node 18+, no dependencies). The site itself has no
 * build step: this only rewrites the shared parts of the static HTML pages.
 *
 *   node tools/site.mjs build      write the shared blocks (head, warning strip, faucet bar,
 *                                  site header with the nav, footer) into every page from the
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

// id: used for aria-current; games: the page shows machines or cards drawn in the game sign font (Bungee).
const PAGES = [
  { file: "index.html", id: "lobby", games: true },
  { file: "login.html", id: "login" },
  { file: "account.html", id: "account" },
  { file: "fairness.html", id: "fairness" },
  { file: "leaderboards.html", id: "leaderboards" },
  { file: "jackpots.html", id: "jackpots" },
  { file: "withdrawals.html", id: "withdrawals" },
  { file: "games/fruit-orchard.html", id: "fruit-orchard", games: true },
  { file: "games/deep-sea.html", id: "deep-sea", games: true },
  { file: "games/cosmic-voyage.html", id: "cosmic-voyage", games: true },
  { file: "games/roulette.html", id: "roulette", games: true }
];

// Nav chips, in order. `to` is the target relative to the site root.
const NAV = [
  { id: "lobby", to: "./", label: "Lobby" },
  { id: "fruit-orchard", to: "games/fruit-orchard.html", label: "Fruit Orchard" },
  { id: "deep-sea", to: "games/deep-sea.html", label: "Deep Sea" },
  { id: "cosmic-voyage", to: "games/cosmic-voyage.html", label: "Cosmic Voyage" },
  { id: "roulette", to: "games/roulette.html", label: "Roulette" },
  { id: "fairness", to: "fairness.html", label: "Fairness" },
  { id: "leaderboards", to: "leaderboards.html", label: "Leaderboards" },
  { id: "jackpots", to: "jackpots.html", label: "Jackpots" },
  { id: "withdrawals", to: "withdrawals.html", label: "Withdrawals" }
];

// A root-relative target as seen from the page's folder.
function rel(page, to) {
  const inGames = page.file.startsWith("games/");
  if (!inGames) return to;
  if (to === "./") return "../";
  if (to.startsWith("games/")) return to.slice("games/".length);
  return "../" + to;
}

const FONTS = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Poppins:wght@500;700&display=swap";
const FONTS_GAMES = FONTS.replace("family=Inter", "family=Bungee&family=Inter");

const BLOCKS = {
  // Icons, theme colour, share card and fonts (testnetcasino-brand). The game pages also load
  // Bungee, the sign font the machines and the lobby cards are drawn in.
  head(page) {
    const r = (to) => rel(page, to);
    return [
      `  <meta name="theme-color" content="#052a19">`,
      `  <link rel="icon" href="${r("favicon.ico")}" sizes="48x48">`,
      `  <link rel="icon" href="${r("assets/img/favicon.svg")}" type="image/svg+xml">`,
      `  <link rel="apple-touch-icon" href="${r("assets/img/apple-touch-icon.png")}">`,
      `  <link rel="manifest" href="${r("site.webmanifest")}">`,
      `  <meta property="og:site_name" content="TestnetCasino.com">`,
      `  <meta property="og:image" content="https://testnetcasino.com/assets/img/og-image.png">`,
      `  <meta property="og:image:width" content="1200">`,
      `  <meta property="og:image:height" content="630">`,
      `  <meta name="twitter:card" content="summary_large_image">`,
      `  <link rel="preconnect" href="https://fonts.googleapis.com">`,
      `  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`,
      `  <link href="${page.games ? FONTS_GAMES : FONTS}" rel="stylesheet">`
    ];
  },
  warning(page) {
    return [
      `  <div class="warning-strip" role="note">`,
      `    <span>NOT A REAL CASINO</span><span class="ws-sep" aria-hidden="true">♦</span><span>NO WAY TO DEPOSIT OR LOSE FIAT, CRYPTO OR MONEY OF ANY KIND</span><span class="ws-sep" aria-hidden="true">♦</span><span>PLAY FOR FUN, WIN BY LUCK, WITHDRAW tBCH TESTNET4 COINS WITH NO MONETARY VALUE</span>`,
      `    <a href="${page.id === "lobby" ? "#notice" : rel(page, "./") + "#notice"}">HOUSE NOTICE</a>`,
      `  </div>`
    ];
  },
  faucet() {
    return [`  <section class="faucet-bar" id="faucet-bar" aria-label="Faucet status"></section>`];
  },
  // The site header: the logo, then the links; on phones the links fold into a menu (auth.js).
  nav(page) {
    const lines = [
      `  <header class="site-head">`,
      `    <div class="sh-inner">`,
      `      <a class="sh-logo" href="${rel(page, "./")}"${page.id === "lobby" ? ` aria-current="page"` : ""}><img src="${rel(page, "assets/img/logo-horizontal.svg")}" alt="TestnetCasino.com" width="230" height="28"></a>`,
      `      <button type="button" class="sh-menu" id="sh-menu" aria-expanded="false" aria-controls="site-nav" aria-label="Menu"><span></span><span></span><span></span></button>`,
      `      <div class="sh-drawer" id="site-nav">`,
      `        <nav class="nav-bar" aria-label="Site">`
    ];
    for (const n of NAV) {
      const cur = n.id === page.id ? ` aria-current="page"` : "";
      lines.push(`          <a class="nav-link" href="${rel(page, n.to)}"${cur}>${n.label}</a>`);
    }
    lines.push(`        </nav>`);
    // auth.js replaces this with the account chips once it knows who is signed in.
    const signCur = page.id === "login" ? ` aria-current="page"` : "";
    lines.push(`        <span class="auth-nav" id="auth-nav"><a class="chip-link auth-pill" href="${rel(page, "login.html")}"${signCur}>Sign in</a></span>`);
    lines.push(`      </div>`, `    </div>`, `  </header>`);
    return lines;
  },
  footer(page) {
    const r = (to) => rel(page, to);
    const notice = page.id === "lobby" ? "#notice" : r("index.html") + "#notice";
    return [
      `    <footer class="casino-footer">`,
      `      <div class="cf-links">`,
      `        <a href="${r("fairness.html")}">Provably fair</a>`,
      `        <a href="${r("leaderboards.html")}">Leaderboards</a>`,
      `        <a href="${r("jackpots.html")}">Jackpots</a>`,
      `        <a href="${r("withdrawals.html")}">Withdrawals</a>`,
      `        <a href="${r("account.html")}">Your account</a>`,
      `        <a href="${notice}">House notice</a>`,
      `        <a href="${r("legal/terms-of-service.pdf")}" type="application/pdf">Terms<span class="sr-only"> of Service (PDF)</span></a>`,
      `        <a href="${r("legal/privacy-policy.pdf")}" type="application/pdf">Privacy<span class="sr-only"> Policy (PDF)</span></a>`,
      `      </div>`,
      `      <div class="cf-networks">`,
      `        <div>Bitcoin Cash Testnet4 coins mined by: <a href="https://test.bch.ee" rel="noopener">test.bch.ee</a> · <a href="https://test.bitcoincash.ee" rel="noopener">test.bitcoincash.ee</a></div>`,
      `        <div>Bitcoin Cash Testnet4 explorer: <a href="https://bchexplorer.cash/testnet4/" rel="noopener">bchexplorer.cash/testnet4</a></div>`,
      `      </div>`,
      `      <div class="cf-bottom">`,
      `        <div>© 2026 TestnetCasino.com · a <a class="cf-solochance" href="https://solochance.org" rel="noopener">SoloChance.org</a> project</div>`,
      `        <div>Built in 🇪🇪 Estonia · Hosted in 🇳🇱 Netherlands</div>`,
      `        <div class="cf-disclaimer"><span class="cf-pip" aria-hidden="true"></span> Not a real casino. Bitcoin Cash Testnet4 coins only. No deposits, no real money.</div>`,
      `      </div>`,
      `    </footer>`
    ];
  }
};

// Which blocks each page must have.
function blocksFor() {
  return ["head", "warning", "faucet", "nav", "footer"];
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
