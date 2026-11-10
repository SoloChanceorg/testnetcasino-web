/*
 * TestnetCasino.com: account page (account.html).
 *
 * Everything is in the coin selected in the header (D46), with both balances on top:
 *   Withdraw            POST /withdrawals { coin, amount, address }: any Testnet4 address of the coin,
 *                       no signature. Left empty, the account's default in that coin is used (a wallet
 *                       account's sign-in address in its own coin, or a saved one).
 *   Withdrawals         GET /withdrawals (every coin: status, txid linked to the coin's explorer).
 *   Balance history     GET /ledger?coin=&cursor= (50 per page, "Load more").
 *   Default addresses   POST /account/withdrawal-address/challenge, then /account/withdrawal-address with
 *                       a signed message: passkey accounts in both coins, wallet accounts in the coin
 *                       they do not sign in with.
 *
 * Depends on: api.js, units.js, cashaddr.js, btcaddr.js, auth.js.
 */
(function () {
  "use strict";

  var api = window.TNC_API, Auth = window.TNC_Auth, AD = window.TNC_Address, U = window.TNC_Units, Coin = window.TNC_Coin;
  if (!api || !Auth || document.body.getAttribute("data-page") !== "account") return;

  var COIN = Coin ? Coin.get() : "bch", INFO = Coin ? Coin.info(COIN) : { ticker: "tBCH", name: "Bitcoin Cash Testnet4", minWithdrawal: 1000, maxWithdrawal: 10000000 };
  var MIN_WD = INFO.minWithdrawal, MAX_WD = INFO.maxWithdrawal;   // sats per withdrawal (API.md); daily caps are checked by the server
  function explorerTx(c, txid) { return Coin ? Coin.info(c).explorerTx(txid) : "https://bchexplorer.cash/testnet4/tx/" + encodeURIComponent(txid); }
  var POLL_MS = 15000;

  function $(id) { return document.getElementById(id); }
  function fmt(n) { return Number(n).toLocaleString("en-US"); }
  // Amounts in sats of the selected coin, like the API.
  function sats(n, c) { return U.format(n, c); }
  function bchText(n) { return U.format(n); }
  function when(iso) {
    var d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  function short(a) { return AD ? AD.short(a) : a; }
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
    // The other coin's balance too (tBTC first).
    var others = $("acct-balances");
    if (others && Coin) others.textContent = Coin.list.filter(function (c) { return c !== COIN && Auth.balanceOf(c) !== null; })
      .map(function (c) { return U.format(Auth.balanceOf(c), c); }).join(" · ");
    renderSaved();
    renderDestination();
    renderLock();
    if (!started) { started = true; loadWithdrawals(); loadLedger(true); jumpToHash(); }
  }

  // The sections appear only after GET /me answers, so the browser's own jump to
  // #withdraw (from the games and the withdrawals page) finds nothing: do it now.
  function jumpToHash() {
    var id = (location.hash || "").slice(1), target = id && document.getElementById(id);
    if (!target || target.hidden) return;
    var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(function () {
      target.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
      if (id === "withdraw") { var a = $("wd-amount"); if (a) a.focus({ preventScroll: true }); }
    });
  }

  /* ═══════════════ Withdraw ═══════════════ */
  // POST /withdrawals { amount, address }: any Bitcoin Cash Testnet4 address, no ownership proof.
  // Wallet accounts: prefilled with the sign-in address (empty = the server uses it).
  // Passkey accounts: required, prefilled with a saved default if GET /me has one.
  var amountEl = $("wd-amount"), wdErr = $("wd-error"), wdStatus = $("wd-status");
  var addrEl = $("wd-address"), addrErr = $("wd-address-error");
  var addrTouched = false, prefilledFor = null;

  // The account's default address in the selected coin (what the server uses when none is given).
  function defaultAddress(c) {
    c = c || COIN;
    var u = Auth.user || {}, saved = u.withdrawalAddresses || (u.withdrawalAddress ? { bch: u.withdrawalAddress } : {});
    if (u.method === "wallet" && (u.addressCoin || "bch") === c) return u.address || "";
    return saved[c] || "";
  }
  // Below the minimum withdrawal the whole form is disabled, with the minimum and the
  // balance shown; it unlocks by itself once the balance reaches the minimum.
  function renderLock() {
    var low = (Auth.balance || 0) < MIN_WD, note = $("wd-locked");
    $("wd-fields").disabled = low;
    $("wd-form").classList.toggle("is-locked", low);
    note.hidden = !low;
    note.textContent = low
      ? "The minimum withdrawal is " + bchText(MIN_WD) + ". Your balance is " + sats(Auth.balance || 0) + ", so withdrawing is not possible yet. Play or claim your daily bonus to reach the minimum."
      : "";
  }

  function renderDestination() {
    var u = Auth.user;
    // Prefill once per account, and never over what the player typed.
    if (!addrTouched && prefilledFor !== u.id) { addrEl.value = defaultAddress(); prefilledFor = u.id; }
    var own = u.method === "wallet" && (u.addressCoin || "bch") === COIN, dflt = defaultAddress();
    addrEl.placeholder = COIN === "btc" ? "tb1..." : "bchtest:q...";
    $("wd-address-hint").textContent = own
      ? "Your sign-in address, or any other " + INFO.name + " address. Left empty, the coins go to your sign-in address."
      : dflt ? "Your saved " + INFO.ticker + " address, or any other " + INFO.name + " address. Left empty, the coins go to the saved one."
      : "Any " + INFO.name + " address you control" + (COIN === "bch" ? ". The bchtest: prefix is optional." : ": tb1..., m..., n... or 2....");
  }
  addrEl.addEventListener("input", function () { addrTouched = true; if (!addrErr.hidden) fieldError(addrEl, addrErr, ""); });

  // Early check by coin (cashaddr.js, btcaddr.js); the server's answer is still the one that counts.
  var ADDR_MESSAGES = {
    empty: "Enter the " + INFO.name + " address to send the coins to.",
    script: "Withdrawals go to a regular bchtest:q... address, not a script address."
  };
  function checkAddress() {
    var raw = addrEl.value.trim();
    if (!raw && defaultAddress()) return { ok: true, address: null };   // the server uses the default
    if (!raw) return { ok: false, message: ADDR_MESSAGES.empty };
    var res = AD ? AD.check(raw, { coin: COIN }) : { ok: true, address: raw };
    if (!res.ok) return { ok: false, message: ADDR_MESSAGES[res.code] || res.message };
    return { ok: true, address: res.address };
  }

  $("wd-max").addEventListener("click", function () {
    // The player's whole balance; the checks below explain any limit it is over.
    amountEl.value = String(Auth.balance || 0);
    fieldError(amountEl, wdErr, "");
    amountEl.focus();
  });
  amountEl.addEventListener("input", function () { if (!wdErr.hidden) fieldError(amountEl, wdErr, ""); });

  $("wd-form").addEventListener("submit", function (e) {
    e.preventDefault();
    setStatus(wdStatus, "");
    var amount = U.parse(amountEl.value);
    if (amount === null) { fieldError(amountEl, wdErr, "Enter a whole number of " + U.unit() + ", for example " + U.int(10 * MIN_WD) + "."); amountEl.focus(); return; }
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
    api.withdraw(amount, dest.address, COIN).then(function (r) {
      busy(btn, false);
      if (r.status === 200 && r.data) {
        setStatus(wdStatus, "Withdrawal requested: " + sats(r.data.amount, r.data.coin || COIN) + " to " + short(r.data.address) + ". It is sent shortly.", "ok");
        amountEl.value = "";
        Auth.refresh();
        loadWithdrawals();
        return;
      }
      if (r.status === 401) { Auth.set(null); return; }
      var code = api.errorCode(r);
      if (code === "amount_too_small" || code === "amount_too_large" || code === "insufficient_funds") { fieldError(amountEl, wdErr, api.errorText(r)); amountEl.focus(); return; }
      if (code === "invalid_address" || code === "address_required") { fieldError(addrEl, addrErr, api.errorText(r)); addrEl.focus(); return; }
      // daily_limit, faucet_daily_limit, invalid_coin, withdrawals_paused, ...
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
        var wc = w.coin || "bch";
        tr.setAttribute("data-coin", wc);
        tr.appendChild(td(sats(w.amount, wc), "num"));
        var to = td(short(w.address), "auth-mono"); to.title = w.address; tr.appendChild(to);
        var st = td(STATUS[w.status] || w.status, "wl-status is-" + String(w.status).toLowerCase()); tr.appendChild(st);
        var tx = document.createElement("td");
        if (w.txid) {
          var a = document.createElement("a");
          a.href = explorerTx(wc, w.txid);
          a.target = "_blank"; a.rel = "noopener";
          a.className = "auth-mono";
          a.textContent = w.txid.slice(0, 8) + "..." + w.txid.slice(-8);
          a.setAttribute("aria-label", "Transaction " + w.txid + " on the " + (Coin ? Coin.info(wc).name : "Bitcoin Cash Testnet4") + " explorer (opens in a new tab)");
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
    withdrawal: "📤 Withdrawal", withdrawal_reversal: "↩️ Withdrawal returned", admin_adjustment: "🛠️ Adjustment",
    roulette_bet: "🎡 Roulette bet", roulette_refund: "↩️ Roulette chips back", roulette_win: "🎡 Roulette win"
  };
  var ledgerCursor = null;
  function loadLedger(fresh) {
    var more = $("lg-more"), st = $("lg-status");
    if (fresh) { ledgerCursor = null; $("lg-body").textContent = ""; }
    more.disabled = true;
    return api.ledger(ledgerCursor, COIN).then(function (r) {
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
        tr.appendChild(td((it.amount > 0 ? "+" : it.amount < 0 ? "−" : "") + U.int(Math.abs(it.amount)), "num " + (it.amount > 0 ? "is-plus" : it.amount < 0 ? "is-minus" : "")));
        tr.appendChild(td(U.int(it.balanceAfter), "num"));
        body.appendChild(tr);
      });
      ledgerCursor = r.data.nextCursor || null;
      more.hidden = !ledgerCursor;
      $("lg-empty").hidden = body.children.length > 0;
    });
  }
  $("lg-more").addEventListener("click", function () { loadLedger(false); });

  /* ═══════════════ Default withdrawal addresses ═══════════════ */
  // Passkey accounts: one per coin; wallet accounts: the coin they do not sign in with (their own
  // coin's default is the sign-in address, 409 withdrawal_address_fixed).
  var sv = { coin: null, address: null, nonce: null, expiresAt: 0, timer: null };
  function canSave(c) { var u = Auth.user || {}; return !(u.method === "wallet" && (u.addressCoin || "bch") === c); }
  function renderSaved() {
    var list = $("sv-list");
    if (!list || !Coin) return;
    list.textContent = "";
    Coin.list.forEach(function (c) {
      var li = document.createElement("li"), name = Coin.ticker(c), a = defaultAddress(c);
      li.setAttribute("data-coin", c);
      var label = document.createElement("span"); label.className = "sv-coin"; label.innerHTML = Auth.coinIcon(c) + " " + name; li.appendChild(label);
      var val = document.createElement("span"); val.className = "sv-addr auth-mono";
      val.textContent = a ? a : "None saved"; if (a) val.title = a; li.appendChild(val);
      if (canSave(c)) {
        var b = document.createElement("button"); b.type = "button"; b.className = "btn-ghost";
        b.textContent = (a ? "Change the " : "Save a ") + name + " address";
        b.addEventListener("click", function () { openSave(c); });
        li.appendChild(b);
      } else {
        var n = document.createElement("span"); n.className = "sv-note"; n.textContent = "Your sign-in address"; li.appendChild(n);
      }
      list.appendChild(li);
    });
  }
  function svStep(n) { $("sv-step1").hidden = n !== 1; $("sv-step2").hidden = n !== 2; }
  function openSave(c) {
    sv.coin = c;
    $("sv-form").hidden = false;
    $("sv-title").textContent = "Save a " + Coin.ticker(c) + " address";
    $("sv-address").placeholder = c === "btc" ? "tb1..." : "bchtest:q...";
    $("sv-address").value = "";
    $("sv-howto").textContent = c === "btc"
      ? "Sign it in your Bitcoin wallet with \"Sign message\" (Sparrow, Electrum, Bitcoin Core, Unisat, Xverse, Leather, ...) and paste the signature as the wallet gives it."
      : "Sign it in Electron Cash (Tools > Sign/verify Message) with this address and paste the signature.";
    setStatus($("sv-status"), "");
    svStep(1);
    $("sv-address").focus();
  }
  if ($("sv-cancel")) $("sv-cancel").addEventListener("click", function () { clearInterval(sv.timer); $("sv-form").hidden = true; });
  if ($("sv-step1")) $("sv-step1").addEventListener("submit", function (e) {
    e.preventDefault();
    var input = $("sv-address"), err = $("sv-address-error");
    var res = AD ? AD.check(input.value, { coin: sv.coin, login: true }) : { ok: true, address: input.value.trim() };
    if (!res.ok) { fieldError(input, err, res.message); input.focus(); return; }
    fieldError(input, err, "");
    var btn = $("sv-get");
    busy(btn, true, "Getting message...");
    api.withdrawalAddressChallenge(res.address).then(function (r) {
      busy(btn, false);
      if (r.status !== 200 || !r.data || !r.data.message) {
        var code = api.errorCode(r);
        if (code === "invalid_address" || code === "withdrawal_address_fixed") { fieldError(input, err, api.errorText(r)); input.focus(); return; }
        setStatus($("sv-status"), api.errorText(r), "error"); return;
      }
      sv.address = res.address; sv.nonce = r.data.nonce; sv.expiresAt = Date.parse(r.data.expiresAt);
      $("sv-message").value = r.data.message;
      $("sv-signature").value = "";
      svStep(2);
      $("sv-message").focus();
      clearInterval(sv.timer);
      sv.timer = setInterval(function () {
        if (Date.now() > sv.expiresAt) { clearInterval(sv.timer); setStatus($("sv-status"), "This message expired. Start again to get a new one.", "error"); svStep(1); }
      }, 1000);
    });
  });
  if ($("sv-step2")) $("sv-step2").addEventListener("submit", function (e) {
    e.preventDefault();
    var input = $("sv-signature"), err = $("sv-signature-error"), sig = input.value.trim();
    input.value = sig;
    if (!sig) { fieldError(input, err, "Paste the signature from your wallet."); input.focus(); return; }
    fieldError(input, err, "");
    var btn = $("sv-submit");
    busy(btn, true, "Checking...");
    api.saveWithdrawalAddress(sv.address, sv.nonce, sig).then(function (r) {
      busy(btn, false);
      if (r.status === 200 && r.data) {
        clearInterval(sv.timer);
        $("sv-form").hidden = true;
        setStatus($("sv-saved"), "Saved: " + short(r.data.withdrawalAddress) + " is your default " + Coin.ticker(r.data.coin || sv.coin) + " address.", "ok");
        Auth.refresh();
        return;
      }
      var code = api.errorCode(r);
      if (code === "invalid_signature") { fieldError(input, err, "The signature does not match this address and message. Sign the exact message with the same address."); input.focus(); return; }
      if (code === "challenge_expired" || code === "challenge_used") { setStatus($("sv-status"), api.errorText(r), "error"); svStep(1); return; }
      setStatus($("sv-status"), api.errorText(r), "error");
    });
  });

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
