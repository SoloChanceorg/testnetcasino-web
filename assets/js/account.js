/*
 * TestnetCasino.com: account page (account.html).
 *
 *   Withdraw            POST /withdrawals { amount }. The destination is always
 *                       the account's verified address, never sent from here.
 *   Withdrawal address  passkey accounts only: POST /account/withdrawal-address/challenge
 *                       { address } → sign the message in a wallet → POST
 *                       /account/withdrawal-address { address, nonce, signature }.
 *                       Wallet accounts withdraw to their sign-in address.
 *   Withdrawals         GET /withdrawals (status, txid linked to an explorer).
 *   Balance history     GET /ledger?cursor= (50 per page, "Load more").
 *
 * Depends on: api.js, units.js, cashaddr.js, auth.js.
 */
(function () {
  "use strict";

  var api = window.TNC_API, Auth = window.TNC_Auth, CA = window.TNC_CashAddr, U = window.TNC_Units;
  if (!api || !Auth || document.body.getAttribute("data-page") !== "account") return;

  var EXPLORER_TX = "https://tbch4.loping.net/tx/";
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
  function destination() {
    var u = Auth.user || {};
    return u.method === "wallet" ? u.address : u.withdrawalAddress || null;
  }
  function renderDestination() {
    var u = Auth.user, dest = destination(), el = $("wd-dest");
    el.textContent = "";
    if (dest) {
      el.append("Coins go to ");
      var code = document.createElement("code"); code.className = "copy-code"; code.textContent = dest;
      el.append(code);
      el.append(u.method === "wallet" ? ", the address you signed in with." : ", your verified withdrawal address.");
    } else {
      el.append("Passkey accounts need a withdrawal address first. ");
      var a = document.createElement("a"); a.href = "#address"; a.textContent = "Add one below.";
      el.append(a);
    }
    $("wd-submit").disabled = !dest;
    // Withdrawal address section: passkey accounts only.
    var addr = $("address");
    addr.hidden = u.method !== "passkey";
    if (!addr.hidden) {
      $("addr-current").textContent = u.withdrawalAddress
        ? "Current address: " + u.withdrawalAddress + ". Verify another one to replace it."
        : "No withdrawal address yet. Add a Testnet4 address you own.";
      $("addr-get").textContent = u.withdrawalAddress ? "Change address" : "Get message to sign";
    }
  }

  var amountEl = $("wd-amount"), wdErr = $("wd-error"), wdStatus = $("wd-status");
  $("wd-max").addEventListener("click", function () {
    // The player's whole balance; the checks below explain any limit it is over.
    amountEl.value = U.bch(Auth.balance || 0).replace(/,/g, "");
    fieldError(amountEl, wdErr, "");
    amountEl.focus();
  });
  amountEl.addEventListener("input", function () { if (!wdErr.hidden) fieldError(amountEl, wdErr, ""); });

  $("wd-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var amount = U.parse(amountEl.value);
    if (amount === null) { fieldError(amountEl, wdErr, "Enter an amount in tBCH, for example 0.0001 (up to 8 decimals)."); amountEl.focus(); return; }
    if (amount < MIN_WD) { fieldError(amountEl, wdErr, "The minimum is " + bchText(MIN_WD) + "."); amountEl.focus(); return; }
    if (amount > MAX_WD) { fieldError(amountEl, wdErr, "The maximum is " + bchText(MAX_WD) + " per withdrawal."); amountEl.focus(); return; }
    if (amount > (Auth.balance || 0)) { fieldError(amountEl, wdErr, "That is more than your balance of " + sats(Auth.balance || 0) + "."); amountEl.focus(); return; }
    fieldError(amountEl, wdErr, "");
    var btn = $("wd-submit");
    busy(btn, true, "Requesting...");
    setStatus(wdStatus, "");
    api.withdraw(amount).then(function (r) {
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
      setStatus(wdStatus, api.errorText(r), "error");
      if (code === "no_withdrawal_address") Auth.refresh();
    });
  });

  /* ═══════════════ Withdrawal address (passkey accounts) ═══════════════ */
  var ad = { address: null, nonce: null, expiresAt: 0, timer: null };
  var addrInput = $("addr-input"), addrErr = $("addr-error"), addrStatus = $("addr-status");
  var sigInput = $("addr-signature"), sigErr = $("addr-sig-error");

  function addrStep(n) {
    $("addr-step1").hidden = n !== 1;
    $("addr-step2").hidden = n !== 2;
  }
  function resetAddr() {
    clearInterval(ad.timer); ad.nonce = null;
    sigInput.value = ""; fieldError(sigInput, sigErr, "");
    addrStep(1);
  }
  $("addr-step1").addEventListener("submit", function (e) {
    e.preventDefault();
    var res = CA.checkTestnetLogin(addrInput.value);
    if (!res.ok) { fieldError(addrInput, addrErr, res.message); addrInput.focus(); return; }
    fieldError(addrInput, addrErr, "");
    addrInput.value = res.address;
    var btn = $("addr-get");
    busy(btn, true, "Getting message...");
    setStatus(addrStatus, "");
    api.withdrawalAddressChallenge(res.address).then(function (r) {
      busy(btn, false);
      if (r.status !== 200 || !r.data || !r.data.message) {
        if (api.errorCode(r) === "invalid_address") { fieldError(addrInput, addrErr, api.errorText(r)); addrInput.focus(); return; }
        setStatus(addrStatus, api.errorText(r), "error");
        return;
      }
      ad.address = res.address; ad.nonce = r.data.nonce; ad.expiresAt = Date.parse(r.data.expiresAt);
      $("addr-message").value = r.data.message;
      sigInput.value = ""; fieldError(sigInput, sigErr, "");
      $("addr-submit").disabled = false;
      addrStep(2);
      countdown();
      $("addr-message").focus();
    });
  });
  addrInput.addEventListener("input", function () { if (!addrErr.hidden) fieldError(addrInput, addrErr, ""); });

  function countdown() {
    clearInterval(ad.timer);
    var cd = $("addr-countdown");
    function tick() {
      var left = Math.max(0, Math.round((ad.expiresAt - Date.now()) / 1000));
      cd.textContent = Math.floor(left / 60) + ":" + ("0" + (left % 60)).slice(-2);
      cd.parentNode.classList.toggle("is-low", left <= 60);
      if (left <= 0) {
        clearInterval(ad.timer);
        $("addr-submit").disabled = true;
        setStatus(addrStatus, "This message expired. Cancel and get a new one.", "error");
      }
    }
    tick();
    ad.timer = setInterval(tick, 1000);
  }
  $("addr-copy").addEventListener("click", function () {
    var text = $("addr-message").value, state = $("addr-copy-state");
    function done(ok) { state.textContent = ok ? "Copied" : "Select the message and copy it"; setTimeout(function () { state.textContent = ""; }, 2000); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    else fallback();
    function fallback() { var ta = $("addr-message"); ta.focus(); ta.select(); var ok = false; try { ok = document.execCommand("copy"); } catch (e) {} done(ok); }
  });
  $("addr-cancel").addEventListener("click", function () { resetAddr(); setStatus(addrStatus, ""); addrInput.focus(); });

  var ADDR_ERRORS = {
    invalid_signature: "The signature does not match this address and message. Sign the exact message with the same address.",
    challenge_expired: "This message expired. Cancel and get a new one.",
    challenge_used: "This message was already used. Cancel and get a new one."
  };
  $("addr-step2-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var sig = sigInput.value.replace(/\s+/g, "");
    sigInput.value = sig;
    if (!sig) { fieldError(sigInput, sigErr, "Paste the signature from your wallet."); sigInput.focus(); return; }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(sig) || sig.length < 80) {
      fieldError(sigInput, sigErr, "That does not look like a signature. It is usually 88 characters of letters, numbers, + and /.");
      sigInput.focus(); return;
    }
    fieldError(sigInput, sigErr, "");
    var btn = $("addr-submit");
    busy(btn, true, "Checking...");
    setStatus(addrStatus, "");
    api.setWithdrawalAddress(ad.address, ad.nonce, sig).then(function (r) {
      busy(btn, false);
      if (r.status === 200 && r.data) {
        resetAddr();
        addrInput.value = "";
        setStatus(addrStatus, "Saved. Withdrawals now go to " + r.data.withdrawalAddress + ".", "ok");
        Auth.refresh();
        return;
      }
      var code = api.errorCode(r);
      if (code === "invalid_signature") { fieldError(sigInput, sigErr, ADDR_ERRORS[code]); sigInput.focus(); return; }
      if (code === "challenge_expired" || code === "challenge_used") { clearInterval(ad.timer); btn.disabled = true; setStatus(addrStatus, ADDR_ERRORS[code], "error"); return; }
      setStatus(addrStatus, api.errorText(r), "error");
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
