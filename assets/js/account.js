/*
 * TestnetCasino.com: account page (account.html).
 *
 *   Withdraw            POST /withdrawals { amount, address }: any Testnet4 address,
 *                       no signature. Wallet accounts may leave it empty (sign-in
 *                       address); passkey accounts must give one.
 *   Withdrawals         GET /withdrawals (status, txid linked to an explorer).
 *   Balance history     GET /ledger?cursor= (50 per page, "Load more").
 *
 * Depends on: api.js, units.js, cashaddr.js, auth.js.
 */
(function () {
  "use strict";

  var api = window.TNC_API, Auth = window.TNC_Auth, CA = window.TNC_CashAddr, U = window.TNC_Units;
  if (!api || !Auth || document.body.getAttribute("data-page") !== "account") return;

  var EXPLORER_TX = "https://bchexplorer.cash/testnet4/tx/";   // always bchexplorer.cash
  var MIN_WD = 1000, MAX_WD = 10000000;   // sats per withdrawal (API.md); daily caps are checked by the server
  var POLL_MS = 15000;

  function $(id) { return document.getElementById(id); }
  function fmt(n) { return Number(n).toLocaleString("en-US"); }
  // Amounts are shown in tBCH (the API works in sats).
  function sats(n) { return U.format(n); }
  function bchText(n) { return U.short(n); }
  function when(iso) {
    var d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  function short(a) { return CA ? CA.short(a) : a; }
  function setStatus(el, msg, kind) { el.textContent = msg || ""; el.className = "auth-status" + (kind ? " is-" + kind : ""); }
  function fieldError(input, el, msg) {
    el.textContent = msg || ""; el.hidden = !msg;
    if (msg) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");
  }
  function busy(btn, on, label) {
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = label; btn.disabled = true; btn.setAttribute("aria-busy", "true"); }
    else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; btn.removeAttribute("aria-busy"); }
  }
  function td(text, cls) { var c = document.createElement("td"); c.textContent = text; if (cls) c.className = cls; return c; }

  var started = false;

  function render(user) {
    $("acct-loading").hidden = true;
    $("acct-out").hidden = !!user;
    $("acct").hidden = !user;
    $("acct-login").href = Auth.loginHref();
    if (!user) { started = false; return; }
    $("acct-balance").textContent = U.format(Auth.balance);
    renderDestination();
    if (!started) { started = true; loadWithdrawals(); loadLedger(true); }
  }

  /* ═══════════════ Withdraw ═══════════════ */
  // POST /withdrawals { amount, address }: any Testnet4 address, no ownership proof.
  // Wallet accounts: prefilled with the sign-in address (empty = the server uses it).
  // Passkey accounts: required, prefilled with a saved default if GET /me has one.
  var amountEl = $("wd-amount"), wdErr = $("wd-error"), wdStatus = $("wd-status");
  var addrEl = $("wd-address"), addrErr = $("wd-address-error");
  var addrTouched = false, prefilledFor = null;

  function defaultAddress() {
    var u = Auth.user || {};
    return u.method === "wallet" ? u.address || "" : u.withdrawalAddress || "";
  }
  function renderDestination() {
    var u = Auth.user;
    // Prefill once per account, and never over what the player typed.
    if (!addrTouched && prefilledFor !== u.id) { addrEl.value = defaultAddress(); prefilledFor = u.id; }
    $("wd-address-hint").textContent = u.method === "wallet"
      ? "Your sign-in address, or any other Testnet4 address. Left empty, the coins go to your sign-in address."
      : "Any Testnet4 address you control. The bchtest: prefix is optional.";
  }
  addrEl.addEventListener("input", function () { addrTouched = true; if (!addrErr.hidden) fieldError(addrEl, addrErr, ""); });

  // Early check with cashaddr.js; the server's answer is still the one that counts.
  var ADDR_MESSAGES = {
    empty: "Enter the Testnet4 address to send the coins to.",
    script: "Withdrawals go to a regular bchtest:q... address, not a script address."
  };
  function checkAddress() {
    var raw = addrEl.value.trim();
    if (!raw && Auth.user.method === "wallet") return { ok: true, address: null };   // server uses the sign-in address
    var res = CA ? CA.checkTestnetLogin(raw) : { ok: !!raw, address: raw, code: "empty" };
    if (!res.ok) return { ok: false, message: ADDR_MESSAGES[res.code] || res.message };
    return { ok: true, address: res.address };
  }

  $("wd-max").addEventListener("click", function () {
    // The player's whole balance; the checks below explain any limit it is over.
    amountEl.value = U.bch(Auth.balance || 0).replace(/,/g, "");
    fieldError(amountEl, wdErr, "");
    amountEl.focus();
  });
  amountEl.addEventListener("input", function () { if (!wdErr.hidden) fieldError(amountEl, wdErr, ""); });

  $("wd-form").addEventListener("submit", function (e) {
    e.preventDefault();
    setStatus(wdStatus, "");
    var amount = U.parse(amountEl.value);
    if (amount === null) { fieldError(amountEl, wdErr, "Enter an amount in tBCH, for example 0.0001 (up to 8 decimals)."); amountEl.focus(); return; }
    if (amount < MIN_WD) { fieldError(amountEl, wdErr, "The minimum is " + bchText(MIN_WD) + "."); amountEl.focus(); return; }
    if (amount > MAX_WD) { fieldError(amountEl, wdErr, "The maximum is " + bchText(MAX_WD) + " per withdrawal."); amountEl.focus(); return; }
    if (amount > (Auth.balance || 0)) { fieldError(amountEl, wdErr, "That is more than your balance of " + sats(Auth.balance || 0) + "."); amountEl.focus(); return; }
    fieldError(amountEl, wdErr, "");
    var dest = checkAddress();
    if (!dest.ok) { fieldError(addrEl, addrErr, dest.message); addrEl.focus(); return; }
    fieldError(addrEl, addrErr, "");
    if (dest.address) addrEl.value = dest.address;

    var btn = $("wd-submit");
    busy(btn, true, "Requesting...");
    setStatus(wdStatus, "");
    api.withdraw(amount, dest.address).then(function (r) {
      busy(btn, false);
      if (r.status === 200 && r.data) {
        setStatus(wdStatus, "Withdrawal requested: " + sats(r.data.amount) + " to " + short(r.data.address) + ". It is sent shortly.", "ok");
        amountEl.value = "";
        Auth.refresh();
        loadWithdrawals();
        return;
      }
      if (r.status === 401) { Auth.set(null); return; }
      var code = api.errorCode(r);
      if (code === "amount_too_small" || code === "amount_too_large" || code === "insufficient_funds") { fieldError(amountEl, wdErr, api.errorText(r)); amountEl.focus(); return; }
      if (code === "invalid_address" || code === "address_required") { fieldError(addrEl, addrErr, api.errorText(r)); addrEl.focus(); return; }
      setStatus(wdStatus, api.errorText(r), "error");   // daily_limit, faucet_daily_limit, withdrawals_paused, ...
    });
  });

  /* ═══════════════ Withdrawals list ═══════════════ */
  var STATUS = { PENDING: "Pending", SENDING: "Sending", SENT: "Sent", FAILED: "Failed, returned to your balance" };
  var pollTimer = null;
  function loadWithdrawals() {
    clearTimeout(pollTimer);
    return api.withdrawals().then(function (r) {
      var body = $("wl-body");
      if (r.status !== 200 || !r.data) return;
      var items = r.data.items || [];
      body.textContent = "";
      items.forEach(function (w) {
        var tr = document.createElement("tr");
        tr.appendChild(td(when(w.createdAt)));
        tr.appendChild(td(sats(w.amount), "num"));
        var to = td(short(w.address), "auth-mono"); to.title = w.address; tr.appendChild(to);
        var st = td(STATUS[w.status] || w.status, "wl-status is-" + String(w.status).toLowerCase()); tr.appendChild(st);
        var tx = document.createElement("td");
        if (w.txid) {
          var a = document.createElement("a");
          a.href = EXPLORER_TX + encodeURIComponent(w.txid);
          a.target = "_blank"; a.rel = "noopener";
          a.className = "auth-mono";
          a.textContent = w.txid.slice(0, 8) + "..." + w.txid.slice(-8);
          a.setAttribute("aria-label", "Transaction " + w.txid + " on the Testnet4 explorer (opens in a new tab)");
          tx.appendChild(a);
        } else tx.textContent = w.status === "FAILED" ? "None" : "Not sent yet";
        tr.appendChild(tx);
        body.appendChild(tr);
      });
      $("wl-empty").hidden = items.length > 0;
      // Follow pending withdrawals until they are sent.
      if (items.some(function (w) { return w.status === "PENDING" || w.status === "SENDING"; })) {
        pollTimer = setTimeout(function () { if (!document.hidden && Auth.user) { loadWithdrawals(); Auth.refresh(); } }, POLL_MS);
      }
    });
  }

  /* ═══════════════ Balance history ═══════════════ */
  var KIND = {
    signup_bonus: "🎉 Sign-up bonus", daily_bonus: "🎁 Daily bonus", spin: "🎰 Spin",
    withdrawal: "📤 Withdrawal", withdrawal_reversal: "↩️ Withdrawal returned", admin_adjustment: "🛠️ Adjustment"
  };
  var ledgerCursor = null;
  function loadLedger(fresh) {
    var more = $("lg-more"), st = $("lg-status");
    if (fresh) { ledgerCursor = null; $("lg-body").textContent = ""; }
    more.disabled = true;
    return api.ledger(ledgerCursor).then(function (r) {
      more.disabled = false;
      if (r.status !== 200 || !r.data) { setStatus(st, api.errorText(r), "error"); return; }
      setStatus(st, "");
      var items = r.data.items || [], body = $("lg-body");
      items.forEach(function (it) {
        var tr = document.createElement("tr");
        tr.appendChild(td(when(it.createdAt)));
        var what = td(KIND[it.kind] || it.kind);
        if (it.reference) what.title = "Reference " + it.reference;
        tr.appendChild(what);
        tr.appendChild(td((it.amount > 0 ? "+" : it.amount < 0 ? "−" : "") + U.bch(Math.abs(it.amount)), "num " + (it.amount > 0 ? "is-plus" : it.amount < 0 ? "is-minus" : "")));
        tr.appendChild(td(U.bch(it.balanceAfter), "num"));
        body.appendChild(tr);
      });
      ledgerCursor = r.data.nextCursor || null;
      more.hidden = !ledgerCursor;
      $("lg-empty").hidden = body.children.length > 0;
    });
  }
  $("lg-more").addEventListener("click", function () { loadLedger(false); });

  /* ═══════════════ Start ═══════════════ */
  // auth.js reads GET /me on DOMContentLoaded; render once it has answered.
  function start() {
    Auth.onChange(function (u) { render(u); });
    (Auth.ready || Auth.refresh()).then(function () { render(Auth.user); });
    document.addEventListener("visibilitychange", function () { if (!document.hidden && Auth.user) loadWithdrawals(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
