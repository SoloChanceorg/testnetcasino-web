/*
 * TestnetCasino.com: fairness page (fairness.html).
 *
 *   Your seeds   GET /fairness/seed, POST /fairness/client-seed, POST /fairness/rotate
 *   Your spins   GET /spins?cursor= (50 per page). A spin can be verified once its
 *                server seed is revealed (`serverSeed` is filled in after a rotation).
 *   Verify       replays any spin in the browser with fairness-engine.js and the
 *                game config from GET /games/{id}/config. Nothing is sent anywhere.
 *
 * Depends on: api.js, auth.js, fairness-engine.js.
 */
(function () {
  "use strict";

  var api = window.TNC_API, Auth = window.TNC_Auth, Fair = window.TNC_Fair, U = window.TNC_Units;
  if (!api || !Auth || !Fair || document.body.getAttribute("data-page") !== "fairness") return;

  var GAMES = { "fruit-orchard": "Fruit Orchard", "deep-sea": "Deep Sea Treasure", "cosmic-voyage": "Cosmic Voyage" };

  function $(id) { return document.getElementById(id); }
  function fmt(n) { return Number(n).toLocaleString("en-US"); }
  function bch(n) { return U.format(n); }   // amounts are shown in tBCH
  function when(iso) {
    var d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  function setStatus(el, msg, kind) { el.textContent = msg || ""; el.className = "auth-status" + (kind ? " is-" + kind : ""); }
  function fieldError(input, el, msg) {
    el.textContent = msg || ""; el.hidden = !msg;
    if (msg) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");
  }
  function busy(btn, on, label) {
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = label; btn.disabled = true; btn.setAttribute("aria-busy", "true"); }
    else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; btn.removeAttribute("aria-busy"); }
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function randomSeed() {
    var b = new Uint8Array(8); crypto.getRandomValues(b);
    return Array.from(b, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
  }

  /* --- Game configs (cached) --- */
  var configs = {};
  function getConfig(id) {
    if (!configs[id]) {
      configs[id] = api.gameConfig(id).then(function (r) {
        if (r.status === 200 && r.data && r.data.engine) return r.data;
        delete configs[id];
        throw new Error(api.errorText(r, "The game rules could not be loaded."));
      });
    }
    return configs[id];
  }

  /* ═══════════════ Seeds ═══════════════ */
  var seed = null, seedStatus = $("seed-status");
  function loadSeed() {
    return api.fairnessSeed().then(function (r) {
      if (r.status === 200 && r.data) { seed = r.data; renderSeed(); }
      else if (r.status === 401) Auth.set(null);
      else setStatus(seedStatus, api.errorText(r), "error");
    });
  }
  function renderSeed() {
    $("seed-hash").textContent = seed.serverSeedHash;
    $("seed-client").textContent = seed.clientSeed;
    $("seed-nonce").textContent = fmt(seed.nonce);
  }

  var csInput = $("cs-input"), csErr = $("cs-error");
  $("cs-random").addEventListener("click", function () { csInput.value = randomSeed(); fieldError(csInput, csErr, ""); csInput.focus(); });
  csInput.addEventListener("input", function () { if (!csErr.hidden) fieldError(csInput, csErr, ""); });
  $("cs-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var v = csInput.value.trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(v)) { fieldError(csInput, csErr, "Use 1 to 64 letters, digits, _ or -."); csInput.focus(); return; }
    fieldError(csInput, csErr, "");
    var btn = $("cs-submit");
    busy(btn, true, "Saving...");
    api.setClientSeed(v).then(function (r) {
      busy(btn, false);
      if (r.status === 200 && r.data) {
        seed = r.data; renderSeed(); csInput.value = "";
        setStatus(seedStatus, "Client seed set. The previous server seed is now revealed in your spins below.", "ok");
        loadSpins(true);
        return;
      }
      if (api.errorCode(r) === "invalid_client_seed") { fieldError(csInput, csErr, api.errorText(r)); csInput.focus(); return; }
      setStatus(seedStatus, api.errorText(r), "error");
    });
  });

  $("rotate-btn").addEventListener("click", function () {
    var btn = this, shown = seed && seed.serverSeedHash;
    busy(btn, true, "Revealing...");
    setStatus(seedStatus, "");
    api.rotateSeed().then(function (r) {
      if (r.status !== 200 || !r.data) { busy(btn, false); setStatus(seedStatus, api.errorText(r), "error"); return; }
      var d = r.data;
      return Fair.sha256Hex(d.revealedServerSeed).then(function (h) {
        busy(btn, false);
        var ok = h === d.revealedHash && (!shown || shown === d.revealedHash);
        var box = $("reveal");
        box.hidden = false;
        box.className = "reveal-box " + (ok ? "is-ok" : "is-bad");
        box.textContent = "";
        box.appendChild(el("p", "rv-title", ok ? "✓ Seed revealed and it matches the hash you were shown." : "✗ The revealed seed does NOT match the hash you were shown."));
        var dl = el("dl", "seed-list");
        [["Revealed server seed", d.revealedServerSeed], ["Its SHA-256 (computed here)", h], ["Hash shown before", shown || d.revealedHash],
         ["Spins played with it", fmt(d.finalNonce)], ["New server seed hash", d.newServerSeedHash]].forEach(function (p) {
          var div = el("div"); div.appendChild(el("dt", "", p[0])); div.appendChild(el("dd", "auth-mono", p[1])); dl.appendChild(div);
        });
        box.appendChild(dl);
        setStatus(seedStatus, d.finalNonce ? "Your spins with that seed can now be verified below." : "", "ok");
        loadSeed();
        return loadSpins(true).then(function () { if (d.finalNonce) verifyAll(); });
      });
    });
  });

  /* ═══════════════ Your spins ═══════════════ */
  var spinCursor = null, rows = [];
  function loadSpins(fresh) {
    var more = $("sp-more");
    if (fresh) { spinCursor = null; rows = []; $("sp-body").textContent = ""; setStatus($("sp-status"), ""); }
    more.disabled = true;
    return api.spinHistory(spinCursor).then(function (r) {
      more.disabled = false;
      if (r.status !== 200 || !r.data) { setStatus($("sp-status"), api.errorText(r), "error"); return; }
      (r.data.items || []).forEach(addRow);
      spinCursor = r.data.nextCursor || null;
      more.hidden = !spinCursor;
      $("sp-empty").hidden = rows.length > 0;
      $("sp-verify-all").disabled = !rows.some(function (x) { return x.spin.serverSeed && !x.done; });
    });
  }
  function addRow(s) {
    var tr = el("tr");
    tr.appendChild(el("td", "", when(s.createdAt)));
    tr.appendChild(el("td", "", GAMES[s.gameId] || s.gameId));
    tr.appendChild(el("td", "num", U.bch(s.bet)));
    var winCell = el("td", "num", U.bch(s.totalWin));
    if (s.jackpotWin > 0) {   // jackpots are paid on top of the game's own result
      var jp = el("span", "sp-jp", " 🏆");
      jp.title = "Plus a jackpot of " + bch(s.jackpotWin);
      winCell.appendChild(jp);
      winCell.appendChild(el("span", "sr-only", ", plus a jackpot of " + bch(s.jackpotWin)));
    }
    tr.appendChild(winCell);
    tr.appendChild(el("td", "num", fmt(s.nonce)));
    var cell = el("td", "sp-check");
    var row = { spin: s, cell: cell, done: false };
    if (s.serverSeed) {
      var b = el("button", "btn-ghost sp-verify", "Verify");
      b.type = "button";
      b.setAttribute("aria-label", "Verify spin " + s.id);
      b.addEventListener("click", function () { verifyRow(row); });
      cell.appendChild(b);
    } else {
      cell.appendChild(el("span", "sp-hidden", "Seed not revealed yet"));
    }
    tr.appendChild(cell);
    $("sp-body").appendChild(tr);
    rows.push(row);
  }
  $("sp-more").addEventListener("click", function () { loadSpins(false); });

  function verifySpin(s) {
    return getConfig(s.gameId).then(function (game) {
      if (game.version !== s.gameVersion) return { ok: null, note: "Played on game version " + s.gameVersion + "; the server now serves version " + game.version + "." };
      return Fair.replay(game, s).then(function (got) {
        var hashOk = got.serverSeedHash === s.serverSeedHash, winOk = got.totalWin === s.totalWin;
        // Jackpot draws (version 2+): a hit in the replay must match a jackpot paid, and no hit no jackpot.
        // The amount is the pool at that moment, so only the hit itself can be checked.
        var hit = !!(got.jackpotHits && (got.jackpotHits.major || got.jackpotHits.grand)), paid = (s.jackpotWin || 0) > 0;
        var jpOk = !got.jackpotHits || hit === paid;
        return { ok: hashOk && winOk && jpOk, got: got,
          note: !hashOk ? "The seed does not match its hash." : !winOk ? "Replay won " + bch(got.totalWin) + ", the server paid " + bch(s.totalWin) + "."
            : !jpOk ? (hit ? "The replay hits a jackpot, but none was paid." : "A jackpot was paid, but the replay does not hit one.") : "" };
      });
    }).catch(function (e) { return { ok: null, note: e && e.message || "Could not verify." }; });
  }
  function verifyRow(row) {
    row.cell.textContent = "Checking…";
    return verifySpin(row.spin).then(function (res) {
      row.done = true;
      row.cell.textContent = "";
      var tag = el("span", "sp-result " + (res.ok ? "is-ok" : res.ok === false ? "is-bad" : "is-na"),
        res.ok ? "✓ Verified" : res.ok === false ? "✗ Mismatch" : "Not checked");
      if (res.note) tag.title = res.note;
      row.cell.appendChild(tag);
      if (res.note && res.ok !== true) row.cell.appendChild(el("small", "sp-note", res.note));
      return res;
    });
  }
  function verifyAll() {
    var todo = rows.filter(function (x) { return x.spin.serverSeed && !x.done; }), st = $("sp-status"), btn = $("sp-verify-all");
    if (!todo.length) return Promise.resolve();
    btn.disabled = true;
    var ok = 0, bad = 0, i = 0;
    function next() {
      if (i >= todo.length) {
        setStatus(st, bad ? bad + " of " + todo.length + " spins did NOT match." : "All " + todo.length + " revealed spins verified. Every result matches.", bad ? "error" : "ok");
        btn.disabled = !rows.some(function (x) { return x.spin.serverSeed && !x.done; });
        return;
      }
      setStatus(st, "Verifying " + (i + 1) + " of " + todo.length + "…");
      return verifyRow(todo[i++]).then(function (r) { if (r.ok) ok++; else if (r.ok === false) bad++; return next(); });
    }
    return next();
  }
  $("sp-verify-all").addEventListener("click", verifyAll);

  /* ═══════════════ Verify any spin ═══════════════ */
  $("vf-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var out = $("vf-result"), btn = $("vf-submit");
    var gameId = $("vf-game").value, bet = parseInt($("vf-bet").value, 10), nonce = parseInt($("vf-nonce").value, 10);
    var seedHex = $("vf-seed").value.trim().toLowerCase(), client = $("vf-client").value.trim();
    var expect = $("vf-expect").value.trim() === "" ? null : parseInt($("vf-expect").value, 10);
    out.textContent = "";
    out.className = "vf-result";
    var problem = !/^[0-9a-f]{64}$/.test(seedHex) ? "The server seed must be 64 hex characters."
      : !/^[A-Za-z0-9_-]{1,64}$/.test(client) ? "The client seed must be 1 to 64 letters, digits, _ or -."
      : !(nonce >= 0) ? "The nonce must be 0 or more."
      : !(bet >= 1 && bet <= 1000) ? "The bet must be 1 to 1,000 tSats." : "";
    if (problem) { out.className = "vf-result is-bad"; out.textContent = problem; return; }
    busy(btn, true, "Replaying...");
    getConfig(gameId).then(function (game) {
      return Fair.replay(game, { serverSeed: seedHex, clientSeed: client, nonce: nonce, bet: bet }).then(function (got) { showReplay(game, got, expect); });
    }).catch(function (err) {
      out.className = "vf-result is-bad";
      out.textContent = err && err.message || "Could not replay this spin.";
    }).then(function () { busy(btn, false); });
  });

  function showReplay(game, got, expect) {
    var out = $("vf-result"), syms = game.symbols;
    var match = expect === null ? null : expect === got.totalWin;
    out.className = "vf-result" + (match === true ? " is-ok" : match === false ? " is-bad" : "");
    out.appendChild(el("p", "rv-title", "Total win: " + bch(got.totalWin) + " (" + fmt(got.totalWin) + " tSats)" +
      (match === true ? " ✓ matches" : match === false ? " ✗ expected " + fmt(expect) + " tSats" : "")));
    var dl = el("dl", "seed-list");
    var d = el("div"); d.appendChild(el("dt", "", "Server seed hash")); d.appendChild(el("dd", "auth-mono", got.serverSeedHash)); dl.appendChild(d);
    out.appendChild(dl);
    // The paid spin's final reels, then one line per step.
    var paid = got.steps[0], last = paid.phases[paid.phases.length - 1].grid;
    var reels = el("div", "vf-reels");
    reels.setAttribute("role", "img");
    reels.setAttribute("aria-label", "Final reels of the paid spin: " + [0, 1, 2].map(function (r) { return last.map(function (c) { return syms[c[r]].name; }).join(", "); }).join("; "));
    for (var r = 0; r < last[0].length; r++) {
      var row = el("div", "vf-row");
      last.forEach(function (col) { row.appendChild(el("span", "", syms[col[r]].emoji)); });
      reels.appendChild(row);
    }
    out.appendChild(reels);
    var ul = el("ul", "vf-steps"), free = 0, freeWin = 0;
    got.steps.forEach(function (s) {
      if (s.type === "spin" && !s.free) ul.appendChild(el("li", "", "Paid spin" + (s.phases.length > 1 ? " with " + (s.phases.length - 1) + " respin" + (s.phases.length > 2 ? "s" : "") : "") + ": " + bch(s.win)));
      else if (s.type === "spin") { free++; freeWin += s.win; }
      else if (s.type === "bonus") ul.appendChild(el("li", "", game.bonus.name + " bonus: " + s.prize + "× = " + bch(s.win)));
      else if (s.type === "freeSpinsStart") ul.appendChild(el("li", "", s.spins + " free spins awarded"));
      else if (s.type === "retrigger") ul.appendChild(el("li", "", "Retrigger: +" + s.added + " free spins"));
      else if (s.type === "freeSpinsEnd") ul.appendChild(el("li", "", "Free spins: " + s.played + " played, " + bch(s.win) + " (spins " + bch(freeWin) + ", bonuses " + bch(s.win - freeWin) + ")"));
    });
    if (got.jackpotHits) {
      var j = got.jackpotHits, yes = "hit (wins the whole pool at that moment)", no = "no hit";
      ul.appendChild(el("li", "jp-draws", "Jackpot draws: Major " + (j.major ? yes : no) + ", Grand " + (j.grand ? yes : no)));
    }
    out.appendChild(ul);
  }

  /* ═══════════════ Start ═══════════════ */
  var loaded = false;
  function render(user) {
    $("seed-out").hidden = !!user;
    $("seed-in").hidden = !user;
    $("sp-out").hidden = !!user;
    $("sp-in").hidden = !user;
    $("fair-login").href = Auth.loginHref();
    if (user && !loaded) { loaded = true; loadSeed(); loadSpins(true); }
    if (!user) loaded = false;
  }
  function start() {
    Auth.onChange(render);
    (Auth.ready || Auth.refresh()).then(function () { render(Auth.user); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
