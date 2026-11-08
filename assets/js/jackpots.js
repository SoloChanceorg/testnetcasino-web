/*
 * TestnetCasino.com: jackpot meters (lobby, games and the jackpots page).
 *
 * GET /jackpots (public): { grand: { fill, cycle, seedHash },
 *   games: { gameId: { minor: { fill, cycle, seedHash }, major: { ... } } },
 *   recentWins: [ { pool, tier, gameId, player, amount, wonAt,
 *                   cycle, seed, seedHash, minSats, maxSats, target, displayScale } ], updatedAt }
 *
 * The jackpots are meters (D40), a gift from the faucet on top of the games' RTP: every bet
 * fills the game's Minor and Major and the shared Grand, and each meter pays out at a hidden
 * target, always before it is full. Only the fill level is public: `fill` is a percentage
 * (0 to 99.9). Amounts are never shown for a running meter, and the fill is never predicted.
 *
 * Every element with data-meter="grand", "major:<gameId>" or "minor:<gameId>" becomes a
 * filling tube (role="meter") that moves smoothly to each new level. When a meter's `cycle`
 * goes up between two readings, someone won it: the tube fills to the top, shows "WON!", and
 * then drops to its new (low) level.
 *
 * Reads the meters when the page opens, every 12 s while the tab is visible, and on refresh().
 * The game page calls hold() while a spin plays, so a meter never gives away a win before the
 * reels have stopped, and release() when it ends (which reads the meters at once).
 *
 * On the jackpots page, the table body with id "jp-wins-body" gets the recent wins, each with
 * a "Verify" button (wins with a seed; checked in the browser by fairness-engine.js).
 *
 * Depends on: api.js, units.js; fairness-engine.js for the Verify buttons.
 * Exposed as window.TNC_Jackpots { refresh, render, hold, release, data }.
 */
(function () {
  "use strict";

  var api = window.TNC_API, U = window.TNC_Units;
  if (!api || !U || !api.jackpots) return;

  var POLL_MS = 12000;
  var GAMES = { "fruit-orchard": "Fruit Orchard", "deep-sea": "Deep Sea Treasure", "cosmic-voyage": "Cosmic Voyage" };
  var TIERS = { grand: "Grand", major: "Major", minor: "Minor" };
  var ICONS = { grand: "🏆", major: "⭐", minor: "✨" };
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var data = null, timer = null, loading = false, held = 0;

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  // "grand", "major:deep-sea", "minor:deep-sea" -> { fill, cycle, seedHash } or null
  function meterOf(d, key) {
    if (!d) return null;
    if (key === "grand") return d.grand && typeof d.grand.fill === "number" ? d.grand : null;
    var m = /^(minor|major):(.+)$/.exec(key), g = m && d.games && d.games[m[2]];
    return g && g[m[1]] && typeof g[m[1]].fill === "number" ? g[m[1]] : null;
  }
  function tierOf(key) { return key === "grand" ? "grand" : key.split(":")[0]; }
  function label(key) { return TIERS[tierOf(key)] + " jackpot"; }
  function pct(fill) { return (Math.floor(Math.max(0, Math.min(99.9, fill)) * 10) / 10).toFixed(1) + "%"; }

  /* ═══════════════ Meters ═══════════════ */
  function build(node) {
    if (node._mt) return node._mt;
    node.textContent = "";
    node.setAttribute("role", "meter");
    node.setAttribute("aria-valuemin", "0");
    node.setAttribute("aria-valuemax", "100");
    node.setAttribute("aria-label", label(node.getAttribute("data-meter")) + " meter");
    var track = el("span", "mt-track"), fill = el("span", "mt-fill"), pctEl = el("span", "mt-pct", "…");
    fill.appendChild(el("span", "mt-shine"));
    track.appendChild(fill);
    node.appendChild(track);
    node.appendChild(pctEl);
    node._mt = { fill: fill, pct: pctEl };
    return node._mt;
  }
  function show(node, level, text) {
    var mt = build(node);
    mt.fill.style.width = level + "%";
    mt.pct.textContent = text;
  }
  function paint(node, key, m) {
    show(node, Math.max(0, Math.min(100, m.fill)), pct(m.fill));
    node.setAttribute("aria-valuenow", String(m.fill));
    node.setAttribute("aria-valuetext", pct(m.fill) + " full");
    node.title = label(key) + ": " + pct(m.fill) + " full. It pays out before it is full.";
  }
  // Someone won this meter: fill to the top, flash "WON!", then drop to the new level.
  function won(node, key, m) {
    clearTimeout(node._mtWon);
    node.classList.remove("mt-grow");
    node.classList.add("mt-won");
    show(node, 100, "WON!");
    node.setAttribute("aria-valuetext", "won, starting again");
    node._mtWon = setTimeout(function () {
      node.classList.remove("mt-won");
      paint(node, key, node._mtData || m);
    }, reduce ? 900 : 2400);
  }

  function renderMeters() {
    document.querySelectorAll("[data-meter]").forEach(function (node) {
      var key = node.getAttribute("data-meter"), m = meterOf(data, key);
      if (!m) { if (!node._mtData) build(node); return; }
      var old = node._mtData;
      node._mtData = m;
      if (old && m.cycle > old.cycle) { won(node, key, m); return; }
      if (node.classList.contains("mt-won")) return;   // the won effect ends on the new level
      if (old && m.fill > old.fill && !reduce) {
        node.classList.remove("mt-grow"); void node.offsetWidth; node.classList.add("mt-grow");
      }
      paint(node, key, m);
    });
  }

  /* ═══════════════ Recent wins (jackpots page) ═══════════════ */
  var verified = {};   // win key -> result of TNC_Fair.verifyMeterWin
  var shownWins = null;
  function winKey(w) { return [w.pool, w.cycle, w.wonAt, w.amount].join("|"); }
  function winTier(w) { return w.tier || (/^grand/.test(w.pool || "") ? "grand" : /^minor/.test(w.pool || "") ? "minor" : "major"); }

  function renderWinners() {
    var body = document.getElementById("jp-wins-body");
    if (!body || !data) return;
    var wins = Array.isArray(data.recentWins) ? data.recentWins : [];
    var empty = document.getElementById("jp-winners-empty");
    if (empty) empty.hidden = wins.length > 0;
    var sig = wins.map(winKey).join(",");
    if (sig === shownWins) return;   // nothing new: keep any open verification as it is
    shownWins = sig;
    body.textContent = "";
    wins.forEach(function (w) { body.appendChild(winRow(w)); });
  }

  function winRow(w) {
    var tier = winTier(w), tr = el("tr", "is-" + tier);
    var d = new Date(w.wonAt);
    tr.appendChild(el("td", "jpw-when", isNaN(d) ? "" : d.toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })));
    tr.appendChild(el("td", "jpw-tier", ICONS[tier] + " " + TIERS[tier] + (tier === "grand" ? "" : " · " + (GAMES[w.gameId] || w.gameId))));
    tr.appendChild(el("td", "jpw-player", String(w.player || "")));
    var amt = el("td", "num jpw-amount");
    amt.appendChild(el("span", "jpw-sats", Number(w.amount).toLocaleString("en-US") + " tSats"));
    amt.appendChild(el("span", "jpw-bch", U.format(w.amount)));
    tr.appendChild(amt);
    var check = el("td", "jpw-check");
    if (w.seed && window.TNC_Fair) {
      var key = winKey(w), b = el("button", "btn-ghost jpw-verify", "Verify");
      b.type = "button";
      b.setAttribute("aria-label", "Verify this " + TIERS[tier] + " jackpot win");
      b.setAttribute("aria-expanded", "false");
      b.addEventListener("click", function () { toggleVerify(tr, b, w, key); });
      check.appendChild(b);
    } else {
      var note = el("span", "jpw-old", "Old jackpot");
      note.title = "Won from the jackpot pools that came before the meters: there is no meter seed to check.";
      check.appendChild(note);
    }
    tr.appendChild(check);
    return tr;
  }

  function toggleVerify(tr, btn, w, key) {
    var next = tr.nextElementSibling;
    if (next && next.classList.contains("jpw-detail")) { next.remove(); btn.setAttribute("aria-expanded", "false"); return; }
    var row = el("tr", "jpw-detail"), cell = el("td", "", "Checking…");
    cell.colSpan = 5;
    row.appendChild(cell);
    tr.parentNode.insertBefore(row, tr.nextSibling);
    btn.setAttribute("aria-expanded", "true");
    var run = verified[key] ? Promise.resolve(verified[key]) : window.TNC_Fair.verifyMeterWin(w);
    run.then(function (res) {
      verified[key] = res;
      cell.textContent = "";
      cell.appendChild(el("p", "jpw-verdict " + (res.ok ? "is-ok" : "is-bad"), res.ok ? "✓ This win is fair: every check passed." : "✗ This win does NOT check out."));
      var ul = el("ul", "jpw-checks");
      res.checks.forEach(function (c) { ul.appendChild(el("li", c.ok ? "is-ok" : "is-bad", (c.ok ? "✓ Passed: " : "✗ Failed: ") + c.text + ".")); });
      cell.appendChild(ul);
      var dl = el("dl", "seed-list");
      [["Seed (revealed by the win)", w.seed], ["Seed hash (public since the cycle started)", w.seedHash],
       ["Range of the target", Number(w.minSats).toLocaleString("en-US") + " to " + Number(w.maxSats).toLocaleString("en-US") + " tSats"]].forEach(function (p) {
        var div = el("div"); div.appendChild(el("dt", "", p[0])); div.appendChild(el("dd", "auth-mono", p[1])); dl.appendChild(div);
      });
      cell.appendChild(dl);
      cell.appendChild(el("p", "auth-hint", "Before the win, players could only see the seed hash. The target comes from the seed, so it was fixed when this cycle started and could not be changed afterwards."));
    }, function (e) {
      cell.textContent = (e && e.message) || "This win could not be checked.";
    });
  }

  // The jackpots page lists each running meter's seed hash (#jp-hashes).
  function renderHashes() {
    var dl = document.getElementById("jp-hashes");
    if (!dl || !data) return;
    var rows = [["🏆 Grand · cycle " + data.grand.cycle, data.grand.seedHash]];
    Object.keys(GAMES).forEach(function (g) {
      var m = data.games && data.games[g];
      if (!m) return;
      ["major", "minor"].forEach(function (t) {
        if (m[t]) rows.push([ICONS[t] + " " + TIERS[t] + " · " + GAMES[g] + " · cycle " + m[t].cycle, m[t].seedHash]);
      });
    });
    dl.textContent = "";
    rows.forEach(function (r) {
      var div = el("div"); div.appendChild(el("dt", "", r[0])); div.appendChild(el("dd", "auth-mono", r[1] || "")); dl.appendChild(div);
    });
  }

  function render() { renderMeters(); renderWinners(); renderHashes(); }

  /* ═══════════════ Reading ═══════════════ */
  function refresh() {
    if (held || loading) return Promise.resolve(data);
    loading = true;
    return api.jackpots().then(function (r) {
      loading = false;
      if (r.status === 200 && r.data && r.data.grand && typeof r.data.grand.fill === "number") {
        data = r.data;
        if (!held) render();
      }
      return data;
    });
  }
  function schedule() {
    clearInterval(timer);
    if (!document.hidden) timer = setInterval(refresh, POLL_MS);
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); schedule(); });

  // While a spin plays nothing about the meters changes on screen; release() reads them at once.
  function hold() { held++; }
  function release() {
    held = Math.max(0, held - 1);
    return held ? Promise.resolve(data) : refresh();
  }

  window.TNC_Jackpots = { refresh: refresh, render: render, hold: hold, release: release, get data() { return data; } };
  refresh();
  schedule();
})();
