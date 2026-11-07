/*
 * TestnetCasino.com: "Recent payouts" on the lobby.
 *
 * GET /faucet/withdrawals?cursor= (public): every withdrawal the faucet has
 * sent, newest first, 50 per page: { items: [ { sentAt, address, amount, txid } ],
 * nextCursor }. Fetched once when the page opens, more with "Load more"; no polling.
 *
 * Depends on: config.js, api.js, units.js.
 */
(function () {
  "use strict";

  var api = window.TNC_API, U = window.TNC_Units;
  var body = document.getElementById("pay-body");
  if (!api || !body) return;

  var EXPLORER_TX = (window.TNC_CONFIG && TNC_CONFIG.explorerTx) || "https://bchexplorer.cash/testnet4/tx/";
  var more = document.getElementById("pay-more"), statusEl = document.getElementById("pay-status");
  var empty = document.getElementById("pay-empty");
  var cursor = null, count = 0;

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

  function load() {
    more.disabled = true;
    statusEl.textContent = cursor ? "Loading more…" : "";
    statusEl.className = "auth-status";
    api.payouts(cursor).then(function (r) {
      more.disabled = false;
      if (r.status !== 200 || !r.data) {
        statusEl.textContent = api.errorText(r, "The payouts could not be loaded.") + " ";
        statusEl.className = "auth-status is-error";
        var b = el("button", "auth-link", "Try again");
        b.type = "button";
        b.addEventListener("click", load);
        statusEl.appendChild(b);
        return;
      }
      statusEl.textContent = "";
      var items = r.data.items || [], frag = document.createDocumentFragment();
      items.forEach(function (w) { frag.appendChild(row(w)); });
      body.appendChild(frag);
      count += items.length;
      cursor = r.data.nextCursor || null;
      more.hidden = !cursor;
      empty.hidden = count > 0;
    });
  }
  more.addEventListener("click", load);

  load();
})();
