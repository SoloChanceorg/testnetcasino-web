/*
 * TestnetCasino.com: jackpot displays (lobby, games and the jackpots page).
 *
 * GET /jackpots (public, D40 + D41):
 *   { grand: { amount, maxAmount, cycle, seedHash },
 *     games: { gameId: { major: { amount, maxAmount, cycle, seedHash }, minor: { fill, cycle, seedHash } } },
 *     recentWins: [ { pool, tier, gameId, player, amount, wonAt,
 *                     cycle, seed, seedHash, minSats, maxSats, target, displayScale, startSats } ], updatedAt }
 *
 * The jackpots are a gift from the faucet, on top of the games' RTP. Every bet grows the game's
 * Minor and Major and the shared Grand; each is won at a hidden target. When is a surprise: the
 * limits (`maxAmount`, the target ranges) are never shown.
 *
 *   - GRAND and MAJOR are prize amounts: every [data-jackpot="grand" | "major:<gameId>"] shows
 *     `amount`, counting up smoothly to each new reading. Units: data-jackpot-units="bch8" is
 *     tBCH with 8 decimals (lobby, jackpots page); "game" follows the machine's tSats / tBCH
 *     switch.
 *   - MINOR is a coin pot that fills up, never an amount: every [data-meter="minor:<gameId>"]
 *     becomes a pot (role="meter") whose coins rise to `fill`%.
 *   - When a `cycle` goes up between two readings, someone won it: a short "WON!" (the pot
 *     bursts), then the new state (a smaller amount, or a nearly empty pot).
 * Values are only ever what the server sent: nothing is predicted between readings.
 *
 * Reads GET /jackpots when the page opens, every 12 s while the tab is visible, and on
 * refresh(). The game page calls hold() while a spin plays, so a display never gives away a
 * win before the reels stop, and release() when it ends (which reads them again at once).
 * burst(key) bursts a pot (the player's own Minor win).
 *
 * On the jackpots page: the recent wins (#jp-wins-body) with a Verify button for wins with a
 * seed (checked in the browser by fairness-engine.js), and the seed hashes now (#jp-hashes).
 *
 * Depends on: api.js, units.js; fairness-engine.js for the Verify buttons.
 * Exposed as window.TNC_Jackpots { refresh, render, hold, release, burst, data }.
 */
(function () {
  "use strict";

  var api = window.TNC_API, U = window.TNC_Units;
  if (!api || !U || !api.jackpots) return;

  var POLL_MS = 12000;
  var GAMES = { "fruit-orchard": "Fruit Orchard", "deep-sea": "Deep Sea Treasure", "cosmic-voyage": "Cosmic Voyage" };
  var TIERS = { grand: "Grand", major: "Major", minor: "Minor" };
  var ICONS = { grand: "🏆", major: "⭐", minor: "🪙" };
  var G = U.game;
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var data = null, timer = null, loading = false, held = 0;

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  // "grand", "major:deep-sea", "minor:deep-sea" -> that jackpot's state, or null
  function stateOf(d, key) {
    if (!d) return null;
    if (key === "grand") return d.grand || null;
    var m = /^(minor|major):(.+)$/.exec(key), g = m && d.games && d.games[m[2]];
    return (g && g[m[1]]) || null;
  }
  function tierOf(key) { return key === "grand" ? "grand" : key.split(":")[0]; }
  function label(key) { return TIERS[tierOf(key)] + " jackpot"; }

  /* ═══════════════ GRAND and MAJOR: amounts ═══════════════ */
  function gameUnits(node) { return !!G && node.getAttribute("data-jackpot-units") === "game"; }
  function money(node, sats) { return gameUnits(node) ? { num: G.value(sats), unit: G.unit() } : { num: U.bch(sats), unit: "tBCH" }; }
  // Number and unit in separate spans, so themes can style the number on its own.
  function paintAmount(node, sats) {
    var num = node.querySelector(".jp-num"), unit = node.querySelector(".jp-unit");
    if (!num) {
      node.textContent = "";
      num = el("span", "jp-num"); unit = el("span", "jp-unit");
      node.appendChild(num); node.appendChild(unit);
    }
    var m = money(node, sats);
    num.textContent = m.num;
    unit.textContent = " " + m.unit;
  }
  function describe(node, key, sats) {
    var exact = Number(sats).toLocaleString("en-US") + " tSats";
    node.title = label(key) + ": " + U.format(sats) + " (" + exact + ")";
    node.setAttribute("aria-label", label(key) + " " + (gameUnits(node) ? G.format(sats) : U.format(sats)));
  }
  function countTo(node, from, to) {
    node._jpTarget = to;
    if (reduce || from == null || from === to) { paintAmount(node, to); return; }
    if (to > from) { node.classList.remove("jp-grow"); void node.offsetWidth; node.classList.add("jp-grow"); }
    var t0 = performance.now(), ms = 1100;
    (function step() {
      if (node._jpTarget !== to) return;   // a newer reading took over
      var p = Math.min(1, (performance.now() - t0) / ms), e = 1 - Math.pow(1 - p, 3);
      paintAmount(node, Math.round(from + (to - from) * e));
      if (p < 1) requestAnimationFrame(step);
    }());
  }
  function renderAmounts() {
    document.querySelectorAll("[data-jackpot]").forEach(function (node) {
      var key = node.getAttribute("data-jackpot"), s = stateOf(data, key);
      if (!s || typeof s.amount !== "number") { if (node._jpSats == null) node.textContent = "…"; return; }
      var old = node._jpState;
      node._jpState = s;
      describe(node, key, s.amount);
      if (old && s.cycle > old.cycle) {   // someone won it: a short WON!, then the new, smaller amount
        node._jpTarget = null;
        node.classList.add("jp-won");
        node.textContent = "WON!";
        clearTimeout(node._jpWon);
        node._jpWon = setTimeout(function () { node.classList.remove("jp-won"); node.textContent = ""; paintAmount(node, node._jpState.amount); node._jpSats = node._jpState.amount; }, reduce ? 900 : 2200);
        return;
      }
      if (node.classList.contains("jp-won")) return;   // the WON! ends on the newest amount
      var from = node._jpSats;
      node._jpSats = s.amount;
      countTo(node, from, s.amount);
    });
  }

  /* ═══════════════ MINOR: a coin pot filling up ═══════════════ */
  function buildPot(node) {
    if (node._pot) return node._pot;
    node.textContent = "";
    node.classList.add("pot");
    node.setAttribute("role", "meter");
    node.setAttribute("aria-valuemin", "0");
    node.setAttribute("aria-valuemax", "100");
    node.setAttribute("aria-label", label(node.getAttribute("data-meter")) + ", a coin pot");
    var body = el("span", "pot-body"), coins = el("span", "pot-coins");
    body.appendChild(coins);
    node.appendChild(el("span", "pot-rim"));
    node.appendChild(body);
    var flash = el("span", "pot-won", "WON!");
    flash.setAttribute("aria-hidden", "true");
    node.appendChild(flash);
    node._pot = { coins: coins };
    return node._pot;
  }
  function level(node, fill) { buildPot(node).coins.style.height = Math.max(0, Math.min(100, fill)) + "%"; }
  function paintPot(node, key, s) {
    level(node, s.fill);
    node.setAttribute("aria-valuenow", String(s.fill));
    node.setAttribute("aria-valuetext", Math.floor(s.fill) + "% full");
    node.title = label(key) + ": the pot fills with every bet.";
  }
  // The pot bursts: full, coins flying, "WON!", then nearly empty again.
  function burstPot(node) {
    clearTimeout(node._potWon);
    level(node, 100);
    node.classList.remove("pot-burst"); void node.offsetWidth; node.classList.add("pot-burst");
    node.setAttribute("aria-valuetext", "won, filling again from empty");
    node._potWon = setTimeout(function () {
      node.classList.remove("pot-burst");
      if (node._potState) paintPot(node, node.getAttribute("data-meter"), node._potState);
      else level(node, 0);
    }, reduce ? 900 : 2200);
  }
  function renderPots() {
    document.querySelectorAll("[data-meter]").forEach(function (node) {
      var key = node.getAttribute("data-meter"), s = stateOf(data, key);
      buildPot(node);
      if (!s || typeof s.fill !== "number") return;
      var old = node._potState;
      node._potState = s;
      if (old && s.cycle > old.cycle) {
        if (node._potOwn) { node._potOwn = false; if (!node.classList.contains("pot-burst")) paintPot(node, key, s); return; }   // already burst in the celebration
        burstPot(node); return;
      }
      if (node.classList.contains("pot-burst")) return;   // the burst ends on the newest level
      if (old && s.fill > old.fill && !reduce) { node.classList.remove("pot-grow"); void node.offsetWidth; node.classList.add("pot-grow"); }
      paintPot(node, key, s);
    });
  }
  function burst(key) {
    document.querySelectorAll('[data-meter="' + key + '"]').forEach(function (node) { node._potOwn = true; burstPot(node); });
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
    amt.appendChild(el("span", "jpw-bch", U.format(w.amount)));
    amt.appendChild(el("span", "jpw-sats", Number(w.amount).toLocaleString("en-US") + " tSats"));
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
      note.title = "Won from the jackpot pools that came before the current jackpots: there is no seed to check.";
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
      [["Seed (revealed by the win)", w.seed], ["Seed hash (public while the jackpot was running)", w.seedHash],
       ["Range of the target", Number(w.minSats).toLocaleString("en-US") + " to " + Number(w.maxSats).toLocaleString("en-US") + " tSats"]].forEach(function (p) {
        var div = el("div"); div.appendChild(el("dt", "", p[0])); div.appendChild(el("dd", "auth-mono", p[1])); dl.appendChild(div);
      });
      cell.appendChild(dl);
      cell.appendChild(el("p", "auth-hint", "While the jackpot was running, only the seed hash was public. The target comes from the seed, so it was fixed when this cycle started and could not be changed afterwards."));
    }, function (e) {
      cell.textContent = (e && e.message) || "This win could not be checked.";
    });
  }

  // The jackpots page lists each running jackpot's seed hash (#jp-hashes).
  function renderHashes() {
    var dl = document.getElementById("jp-hashes");
    if (!dl || !data || !data.grand) return;
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

  function render() { renderAmounts(); renderPots(); renderWinners(); renderHashes(); }

  /* ═══════════════ Reading ═══════════════ */
  function refresh() {
    if (held || loading) return Promise.resolve(data);
    loading = true;
    return api.jackpots().then(function (r) {
      loading = false;
      if (r.status === 200 && r.data && r.data.grand && typeof r.data.grand.amount === "number") {
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

  // While a spin plays nothing about the jackpots changes on screen; release() reads them at once.
  function hold() { held++; }
  function release() {
    held = Math.max(0, held - 1);
    return held ? Promise.resolve(data) : refresh();
  }

  // The machine's tSats / tBCH switch: the game displays follow it at once.
  if (G) G.onChange(function () {
    document.querySelectorAll("[data-jackpot]").forEach(function (node) {
      if (!gameUnits(node) || node._jpSats == null || node.classList.contains("jp-won")) return;
      var key = node.getAttribute("data-jackpot");
      node._jpTarget = node._jpSats; paintAmount(node, node._jpSats); describe(node, key, node._jpSats);
    });
  });

  window.TNC_Jackpots = { refresh: refresh, render: render, hold: hold, release: release, burst: burst, get data() { return data; } };
  refresh();
  schedule();
})();
