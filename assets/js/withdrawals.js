/*
 * TestnetCasino.com: withdrawals page (withdrawals.html).
 *
 * GET /faucet/withdrawals?cursor= (public): every withdrawal the faucet has
 * sent, newest first, 50 per page: { items: [ { sentAt, address, amount, txid } ],
 * nextCursor }. When the page opens, all pages are fetched one after another,
 * then the whole list is shown at once with the total withdrawn on top. No polling.
 *
 * Depends on: config.js, api.js, units.js.
 */
(function () {
  "use strict";

  var api = window.TNC_API, U = window.TNC_Units;
  var body = document.getElementById("pay-body");
  if (!api || !body) return;

  var EXPLORER_TX = (window.TNC_CONFIG && TNC_CONFIG.explorerTx) || "https://bchexplorer.cash/testnet4/tx/";
  var statusEl = document.getElementById("pay-status"), empty = document.getElementById("pay-empty");
  var totalEl = document.getElementById("pay-total"), totalSub = document.getElementById("pay-total-sub");
  var MAX_PAGES = 2000;   // safety stop (100,000 withdrawals)

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function when(iso) {
    var d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  function shortAddr(a) {
    var p = String(a).split(":"), b = p[p.length - 1];
    return (p.length > 1 ? p[0] + ":" : "") + b.slice(0, 4) + "..." + b.slice(-4);
  }

  function copy(text, btn) {
    function done(ok) {
      btn.textContent = ok ? "✓" : "!";
      btn.setAttribute("aria-label", ok ? "Address copied" : "Copy failed");
      setTimeout(function () { btn.textContent = "📋"; btn.setAttribute("aria-label", "Copy the full address"); }, 1600);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    else fallback();
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand("copy"); } catch (e) {}
      ta.remove(); done(ok);
    }
  }

  function row(w) {
    var tr = el("tr");
    tr.appendChild(el("td", "pay-when", when(w.sentAt)));

    // Full address on wide screens, shortened on narrow ones (CSS); full one in the title and copyable.
    var to = el("td", "pay-to");
    var addr = el("span", "pay-addr auth-mono");
    addr.title = w.address;
    addr.appendChild(el("span", "pay-full", w.address));
    var sh = el("span", "pay-short", shortAddr(w.address));
    sh.setAttribute("aria-hidden", "true");
    addr.appendChild(sh);
    to.appendChild(addr);
    var cb = el("button", "pay-copy", "📋");
    cb.type = "button";
    cb.setAttribute("aria-label", "Copy the full address");
    cb.addEventListener("click", function () { copy(w.address, cb); });
    to.appendChild(cb);
    tr.appendChild(to);

    var amt = el("td", "num pay-amount", U ? U.bch(w.amount) : String(w.amount));
    amt.title = Number(w.amount).toLocaleString("en-US") + " sats";
    tr.appendChild(amt);

    var tx = el("td", "pay-tx");
    if (w.txid) {
      var a = el("a", "auth-mono");
      a.href = EXPLORER_TX + encodeURIComponent(w.txid);
      a.target = "_blank"; a.rel = "noopener";
      a.title = w.txid;
      a.appendChild(el("span", "pay-txid", w.txid.slice(0, 6) + "..." + w.txid.slice(-6)));
      a.appendChild(el("span", "pay-view", "View"));
      a.appendChild(el("span", "", " ↗"));
      a.setAttribute("aria-label", "Transaction " + w.txid + " on the Testnet4 explorer (opens in a new tab)");
      tx.appendChild(a);
    }
    tr.appendChild(tx);
    return tr;
  }

  // Fetch every page (following nextCursor), then render the whole list and the total.
  function load() {
    var all = [], pages = 0;
    statusEl.className = "auth-status";
    statusEl.textContent = "Loading the withdrawals…";
    totalEl.textContent = "…";
    totalSub.textContent = "Counting every withdrawal…";
    (function page(cursor) {
      api.faucetWithdrawals(cursor).then(function (r) {
        if (r.status !== 200 || !r.data) { fail(r); return; }
        all = all.concat(r.data.items || []);
        pages++;
        if (r.data.nextCursor && pages < MAX_PAGES) {
          statusEl.textContent = "Loading the withdrawals… " + all.length.toLocaleString("en-US") + " so far";
          page(r.data.nextCursor);
          return;
        }
        show(all);
      });
    }(null));
  }

  function show(items) {
    statusEl.textContent = "";
    body.textContent = "";
    var frag = document.createDocumentFragment(), sum = 0;
    items.forEach(function (w) { frag.appendChild(row(w)); sum += Number(w.amount) || 0; });
    body.appendChild(frag);
    empty.hidden = items.length > 0;
    // Number in the sign font, unit in the body font (the sign font only has capitals).
    totalEl.textContent = U ? U.bch(sum) : String(sum);
    totalEl.appendChild(el("span", "pay-total-unit", U ? " tBCH" : " sats"));
    totalEl.title = sum.toLocaleString("en-US") + " sats";
    totalSub.textContent = items.length
      ? "in " + items.length.toLocaleString("en-US") + " withdrawal" + (items.length === 1 ? "" : "s") + " sent to Testnet4 wallets"
      : "No withdrawals yet.";
  }

  function fail(r) {
    statusEl.textContent = api.errorText(r, "The withdrawals could not be loaded.") + " ";
    statusEl.className = "auth-status is-error";
    totalEl.textContent = "n/a";
    totalSub.textContent = "";
    var b = el("button", "auth-link", "Try again");
    b.type = "button";
    b.addEventListener("click", load);
    statusEl.appendChild(b);
  }

  load();
})();
