/*
 * TestnetCasino.com: session helper (every page) + sign-in page logic.
 *
 * Session helper
 *   On load it calls GET /me (via TNC_API): { user, balances, dailyBonuses, ... }, or
 *   401 when signed out. It renders the nav (#auth-nav): the coin switch (tBTC / tBCH, D46) on
 *   every page, then "Sign in" for visitors; for players the selected coin's balance (the other
 *   coin's in its tooltip and in the account chip's), its daily bonus pill, the account and
 *   "Sign out". On the lobby it also fills the daily bonus card (#daily-bonus, both coins).
 *   No token is stored: the session is an HttpOnly cookie. Exposed as window.TNC_Auth:
 *   Auth.balance is the selected coin's balance; Auth.balances / Auth.bonuses have every coin.
 *
 * Sign-in page (<body data-page="login">)
 *   Two tabs: Testnet4 wallet (a tBCH bchtest:q... or a tBTC tb1.../m.../n... address, signed
 *   challenge) and Passkey (WebAuthn).
 *
 * Depends on: config.js, api.js, units.js; cashaddr.js and btcaddr.js on the sign-in page.
 */
(function () {
  "use strict";

  var api = window.TNC_API;
  var U = window.TNC_Units;
  var script = document.currentScript;
  var SITE = new URL("../../", script ? script.src : location.href);   // site root (works under a sub-path too)
  var LOGIN = new URL("login.html", SITE);
  var Coin = window.TNC_Coin;
  // The network badge: a small diamond in the coin's colour.
  function coinIcon(c) { return '<img class="tbch coin-badge" src="' + new URL("assets/img/t" + c + ".svg", SITE).href + '" alt="">'; }

  function $(id) { return document.getElementById(id); }
  function short(addr) {
    var p = String(addr).split(":"), b = p[p.length - 1];
    return (p.length > 1 ? p[0] + ":" : "") + b.slice(0, 4) + "..." + b.slice(-4);
  }
  function userLabel(u) { return u.method === "wallet" && u.address ? short(u.address) : "Passkey account"; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  // Amounts in sats of a coin (default: the selected one).
  function fmtSats(n, c) { return U ? U.format(n, c) : Number(n).toLocaleString("en-US") + " sats"; }
  function fmtBalance(n, c) { return fmtSats(n, c); }
  function coin() { return Coin ? Coin.get() : "bch"; }
  function reducedMotion() { return window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches; }

  // "5h 12m" (an hour or more), "12m 30s" (less than an hour), "45s"
  function fmtLeft(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    if (h) return h + "h " + m + "m";
    if (m) return m + "m " + ("0" + sec).slice(-2) + "s";
    return sec + "s";
  }

  /* ═══════════════ Session helper (all pages) ═══════════════ */
  var listeners = [];
  var Auth = {
    user: null,          // { id, method, address?, addressCoin?, withdrawalAddress?, withdrawalAddresses? }
    balance: null,       // sats of the selected coin
    dailyBonus: null,    // the selected coin's { available, amount, nextClaimAt? }
    balances: {},        // { btc: sats, bch: sats }
    bonuses: {},         // { btc: {...}, bch: {...} }
    ready: null,
    short: short,
    label: userLabel,
    onChange: function (fn) { listeners.push(fn); },
    // me: a GET /me body, or { user } alone after sign-in.
    set: function (me) {
      Auth.user = me && me.user || null;
      Auth.balances = {}; Auth.bonuses = {};
      if (Auth.user) {
        // Before D46 the server only had balance / dailyBonus (tBCH).
        Auth.balances = me.balances || (typeof me.balance === "number" ? { bch: me.balance } : {});
        Auth.bonuses = me.dailyBonuses || (me.dailyBonus ? { bch: me.dailyBonus } : {});
        // The selected coin is off on the server: show the other one (not remembered).
        if (Coin && typeof Auth.balances[coin()] !== "number") {
          var on = Coin.list.filter(function (c) { return typeof Auth.balances[c] === "number"; })[0];
          if (on) Coin.fallback(on);
        }
      }
      sync();
      changed();
    },
    // A new balance from a spin, a bet or a bonus; coin defaults to the selected one.
    setBalance: function (sats, c) {
      if (!Auth.user || typeof sats !== "number") return;
      Auth.balances[c || coin()] = sats;
      sync(); changed();
    },
    balanceOf: function (c) { return typeof Auth.balances[c] === "number" ? Auth.balances[c] : null; },
    coinIcon: coinIcon,
    refresh: function () {
      return api.me().then(function (r) {
        Auth.set(r.status === 200 && r.data ? r.data : null);
        return Auth.user;
      });
    },
    signOut: function () {
      return api.logout().then(function () { Auth.set(null); announce("You are signed out."); });
    },
    loginHref: function () {
      return LOGIN.pathname + "?next=" + encodeURIComponent(location.pathname + location.search + location.hash);
    },
    claimBonus: claimBonus
  };

  function sync() {
    Auth.balance = Auth.user && typeof Auth.balances[coin()] === "number" ? Auth.balances[coin()] : null;
    Auth.dailyBonus = Auth.user && Auth.bonuses[coin()] || null;
  }

  function changed() {
    renderNav();
    renderBonusCard();
    tickCountdowns();
    listeners.forEach(function (fn) { fn(Auth.user, Auth); });
  }

  function announce(msg) { var l = $("auth-live"); if (l) { l.textContent = ""; setTimeout(function () { l.textContent = msg; }, 50); } }

  /* --- Daily bonus --- */
  var claiming = null, bonusNote = "";   // claiming: the coin being claimed
  function claimBonus(c) {
    c = c || coin();
    if (claiming || !Auth.user) return Promise.resolve(false);
    claiming = c; bonusNote = "";
    renderNav(); renderBonusCard();
    return api.claimDailyBonus(c).then(function (r) {
      claiming = null;
      if (r.status === 200 && r.data) {
        var rc = r.data.coin || c;
        Auth.balances[rc] = r.data.balance;
        Auth.bonuses[rc] = { available: false, amount: r.data.amount, nextClaimAt: r.data.nextClaimAt };
        sync(); changed();
        announce("Daily bonus claimed: " + fmtSats(r.data.amount, rc) + " added. Balance " + fmtBalance(r.data.balance, rc) + ".");
        if (window.TNC_fx && !reducedMotion()) window.TNC_fx.coinShower(40);
        return true;
      }
      if (api.errorCode(r) === "daily_bonus_claimed") return Auth.refresh().then(function () { return false; });
      if (r.status === 401) { Auth.set(null); return false; }
      bonusNote = api.errorText(r);
      changed();
      announce(bonusNote);
      return false;
    });
  }

  function bonusOf(c) { return Auth.bonuses[c || coin()] || null; }
  function bonusAmount(c) { var b = bonusOf(c); return b && b.amount || (Coin ? Coin.info(c).bonus : 1000); }
  // Every coin's bonus resets at 00:00 UTC, so one countdown serves both.
  function nextClaimMs() {
    var t = NaN;
    (Coin ? Coin.list : ["bch"]).forEach(function (c) { var b = Auth.bonuses[c], x = b && Date.parse(b.nextClaimAt); if (!isNaN(x) && (isNaN(t) || x < t)) t = x; });
    return isNaN(t) ? null : t - Date.now();
  }

  // One timer drives every "Next bonus in ..." label; at zero, /me is read again.
  var countdownTimer = null, refreshing = false;
  function tickCountdowns() {
    var els = document.querySelectorAll("[data-bonus-left]");
    var left = nextClaimMs();
    if (!els.length || left === null) { clearInterval(countdownTimer); countdownTimer = null; return; }
    els.forEach(function (el) { el.textContent = fmtLeft(left); });
    if (left <= 0 && !refreshing) {
      refreshing = true;
      clearInterval(countdownTimer); countdownTimer = null;
      sleep(1500).then(Auth.refresh).then(function () { refreshing = false; });
      return;
    }
    if (!countdownTimer) countdownTimer = setInterval(tickCountdowns, 1000);
  }

  function bonusPill() {
    var b = Auth.dailyBonus, c = coin();
    if (!b) return null;
    if (b.available) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip-link bonus-pill is-ready";
      btn.disabled = !!claiming;
      btn.innerHTML = '<span class="chip-emoji" aria-hidden="true">🎁</span> ' + (claiming === c ? "Claiming..." : "Claim " + fmtSats(bonusAmount(c)));
      if (bonusNote) btn.title = bonusNote;
      btn.addEventListener("click", function () { claimBonus(c); });
      return btn;
    }
    var t = Date.parse(b.nextClaimAt);
    if (isNaN(t)) return null;
    var span = document.createElement("span");
    span.className = "chip-link bonus-pill";
    span.title = "The daily bonus resets at 00:00 UTC.";
    span.innerHTML = '<span class="chip-emoji" aria-hidden="true">🎁</span> Next bonus in <span data-bonus-left></span>';
    return span;
  }

  // Lobby card: one line per coin (tBTC first), each with its own Claim button.
  function renderBonusCard() {
    var body = $("daily-bonus-body");
    if (!body) return;
    var coins = Coin ? Coin.list : ["bch"];
    if (!Auth.user) {
      body.innerHTML = '<p class="db-text">Sign in and claim every day:</p>' +
        '<ul class="db-coins">' + coins.map(function (c) {
          return '<li class="db-coin" data-coin="' + c + '"><span class="db-amount">' + esc(fmtSats(bonusAmount(c), c)) + '</span></li>';
        }).join("") + '</ul>' +
        '<p class="db-note">New accounts also get ' + coins.map(function (c) { return esc(fmtSats(Coin ? Coin.info(c).signup : 10000, c)); }).join(" and ") + '.</p>' +
        '<a class="btn-outline db-btn" href="' + Auth.loginHref() + '">Sign in to claim</a>';
      return;
    }
    var shown = coins.filter(function (c) { return Auth.bonuses[c]; });
    body.innerHTML = '<ul class="db-coins">' + shown.map(function (c) {
      var b = Auth.bonuses[c], amt = esc(fmtSats(b.amount || bonusAmount(c), c));
      return '<li class="db-coin" data-coin="' + c + '"><span class="db-amount">' + amt + '</span>' +
        (b.available
          ? '<button type="button" class="btn-outline db-claim" data-claim="' + c + '"' + (claiming ? " disabled" : "") + '>' + (claiming === c ? "Claiming..." : "Claim") + '</button>'
          : '<span class="db-done">Claimed today</span>') + '</li>';
    }).join("") + '</ul>' +
      (shown.some(function (c) { return !Auth.bonuses[c].available; }) ? '<p class="db-note">Next bonus in <span data-bonus-left></span> (every day at 00:00 UTC).</p>' : "") +
      (bonusNote ? '<p class="db-note is-error">' + esc(bonusNote) + '</p>' : "");
    body.querySelectorAll("[data-claim]").forEach(function (btn) {
      btn.addEventListener("click", function () { claimBonus(btn.getAttribute("data-claim")); });
    });
  }

  // The coin switch: two radio-like buttons, tBTC first. Choosing one reloads the page in that coin.
  function coinSwitch() {
    var wrap = document.createElement("span");
    wrap.className = "coin-switch";
    wrap.setAttribute("role", "radiogroup");
    wrap.setAttribute("aria-label", "Coin to play and show");
    (Coin ? Coin.list : []).forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "coin-opt";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", c === coin() ? "true" : "false");
      b.setAttribute("data-coin", c);
      b.title = Coin.info(c).name;
      b.innerHTML = coinIcon(c) + Coin.ticker(c);
      b.addEventListener("click", function () { Coin.set(c); });
      wrap.appendChild(b);
    });
    return wrap;
  }

  function renderNav() {
    var nav = $("auth-nav");
    if (!nav) return;
    var onLogin = document.body.getAttribute("data-page") === "login";
    var hadFocus = nav.contains(document.activeElement) && document.activeElement.classList.contains("bonus-pill");
    nav.textContent = "";
    if (Coin) nav.appendChild(coinSwitch());
    var mob = $("sh-coin");
    if (mob && Coin && !mob.firstChild) mob.appendChild(coinSwitch());
    if (!Auth.user) {
      var a = document.createElement("a");
      a.className = "chip-link auth-pill";
      a.href = onLogin ? LOGIN.pathname + location.search : Auth.loginHref();
      if (onLogin) a.setAttribute("aria-current", "page");
      a.textContent = "Sign in";
      nav.appendChild(a);
    } else {
      var c = coin(), other = Coin ? Coin.list.filter(function (x) { return x !== c && typeof Auth.balances[x] === "number"; }) : [];
      if (Auth.balance !== null) {
        var bal = document.createElement("span");
        bal.className = "chip-balance";
        bal.innerHTML = coinIcon(c) + "<strong></strong>";
        bal.querySelector("strong").textContent = fmtBalance(Auth.balance, c);
        var all = "Balance " + fmtBalance(Auth.balance, c) + other.map(function (x) { return ", " + fmtBalance(Auth.balances[x], x); }).join("");
        bal.setAttribute("aria-label", all);
        bal.title = all;
        nav.appendChild(bal);
      }
      var pill = bonusPill();
      if (pill) nav.appendChild(pill);
      var who = document.createElement("a");
      who.className = "chip-link auth-user";
      who.href = new URL("account.html", SITE).pathname;
      if (document.body.getAttribute("data-page") === "account") who.setAttribute("aria-current", "page");
      if (Auth.user.address) who.title = Auth.user.address;
      who.innerHTML = (Auth.user.method === "wallet" ? coinIcon(Auth.user.addressCoin || "bch") : '<span class="chip-emoji" aria-hidden="true">🔐</span>') + " ";
      // A wallet address is shown as written (lowercase, monospaced); "Passkey account" keeps the sign font.
      var name = document.createElement("span");
      if (Auth.user.method === "wallet" && Auth.user.address) name.className = "auth-addr";
      name.textContent = userLabel(Auth.user);
      who.appendChild(name);
      // The other coin's balance, small, in the account chip.
      other.forEach(function (x) {
        var o = document.createElement("span");
        o.className = "auth-other";
        o.setAttribute("data-coin", x);
        o.textContent = fmtBalance(Auth.balances[x], x);
        who.appendChild(o);
      });
      who.setAttribute("aria-label", "Your account, signed in as " + (Auth.user.address || "a passkey account") +
        other.map(function (x) { return ", " + fmtBalance(Auth.balances[x], x); }).join(""));
      var out = document.createElement("button");
      out.type = "button";
      out.className = "chip-link auth-out";
      out.textContent = "Sign out";
      out.addEventListener("click", function () { out.disabled = true; Auth.signOut(); });
      nav.appendChild(who);
      nav.appendChild(out);
      if (hadFocus) { var p = nav.querySelector(".bonus-pill"); if (p && p.tagName === "BUTTON") p.focus(); }
    }
    var live = document.createElement("span");
    live.id = "auth-live"; live.className = "sr-only"; live.setAttribute("aria-live", "polite");
    nav.appendChild(live);
  }

  window.TNC_Auth = Auth;

  // The site header's menu button (phones): opens and closes the links.
  function menu() {
    document.documentElement.classList.add("js");
    var btn = $("sh-menu"), head = btn && btn.closest(".site-head");
    if (!btn || !head) return;
    function set(open) { head.classList.toggle("is-open", open); btn.setAttribute("aria-expanded", open ? "true" : "false"); }
    btn.addEventListener("click", function () { set(!head.classList.contains("is-open")); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && head.classList.contains("is-open")) { set(false); btn.focus(); } });
    document.addEventListener("click", function (e) { if (!head.contains(e.target)) set(false); });
    head.querySelectorAll(".nav-link").forEach(function (a) { a.addEventListener("click", function () { set(false); }); });
  }

  function start() {
    menu();
    renderNav();
    renderBonusCard();
    Auth.ready = Auth.refresh();
    // Coming back to the tab: the balance or the bonus may have changed elsewhere.
    document.addEventListener("visibilitychange", function () { if (!document.hidden && Auth.user) Auth.refresh(); });
    if (document.body.getAttribute("data-page") === "login") loginPage();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();

  /* ═══════════════ Sign-in page ═══════════════ */
  function loginPage() {
    var AD = window.TNC_Address;

    // Where to go after signing in: same-origin paths only (no open redirect).
    function nextUrl() {
      var raw = new URLSearchParams(location.search).get("next");
      if (raw) {
        try {
          var u = new URL(raw, location.href);
          if (u.origin === location.origin && u.pathname !== LOGIN.pathname) return u.pathname + u.search + u.hash;
        } catch (e) { /* fall through */ }
      }
      return SITE.pathname;
    }
    $("auth-back").href = nextUrl();

    /* --- Tabs (WAI-ARIA tabs pattern) --- */
    var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
    function selectTab(tab, focus) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute("aria-selected", on ? "true" : "false");
        t.tabIndex = on ? 0 : -1;
        $(t.getAttribute("aria-controls")).hidden = !on;
      });
      if (focus) tab.focus();
    }
    tabs.forEach(function (t, i) {
      t.addEventListener("click", function () { selectTab(t); });
      t.addEventListener("keydown", function (e) {
        var j = null;
        if (e.key === "ArrowRight") j = (i + 1) % tabs.length;
        else if (e.key === "ArrowLeft") j = (i - 1 + tabs.length) % tabs.length;
        else if (e.key === "Home") j = 0;
        else if (e.key === "End") j = tabs.length - 1;
        if (j !== null) { e.preventDefault(); selectTab(tabs[j], true); }
      });
    });

    /* --- Signed-in state on the sign-in page --- */
    function showSignedIn(u) {
      $("auth-signed-in").hidden = !u;
      $("auth-forms").hidden = !!u;
      if (u) $("auth-who").textContent = u.address || "Passkey account";
    }
    Auth.onChange(function (u) { if (!redirecting) showSignedIn(u); });
    $("auth-signout").addEventListener("click", function () {
      this.disabled = true;
      Auth.signOut().then(function () { $("auth-signout").disabled = false; resetWallet(); $("w-address").focus(); });
    });

    var redirecting = false;
    function succeed(user, statusEl) {
      redirecting = true;
      Auth.set({ user: user });
      Auth.refresh();
      var dest = nextUrl();
      setStatus(statusEl, "Signed in as " + userLabel(user) + ". Taking you back now.", "ok");
      return sleep(1200).then(function () { location.assign(dest); });
    }

    function setStatus(el, msg, kind) {
      el.textContent = msg || "";
      el.className = "auth-status" + (kind ? " is-" + kind : "");
    }
    function busy(btn, on, label) {
      if (on) { btn.dataset.label = btn.textContent; btn.textContent = label; btn.disabled = true; btn.setAttribute("aria-busy", "true"); }
      else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; btn.removeAttribute("aria-busy"); }
    }

    /* ═══ Wallet: step 1 (address) → step 2 (sign) → step 3 (done) ═══ */
    var w = { address: null, nonce: null, expiresAt: 0, timer: null };
    var addrInput = $("w-address"), addrErr = $("w-address-error"), wStatus = $("w-status");
    var sigInput = $("w-signature"), sigErr = $("w-signature-error");

    function step(n) {
      [1, 2, 3].forEach(function (i) {
        $("w-step" + i).hidden = i !== n;
        var li = $("w-dot" + i);
        li.classList.toggle("is-done", i < n);
        if (i === n) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
      });
    }
    function fieldError(input, el, msg) {
      el.textContent = msg || "";
      el.hidden = !msg;
      if (msg) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");
    }
    function resetWallet() {
      clearInterval(w.timer);
      w.nonce = null;
      sigInput.value = "";
      fieldError(sigInput, sigErr, "");
      setStatus(wStatus, "");
      step(1);
    }

    $("w-step1").addEventListener("submit", function (e) {
      e.preventDefault();
      var res = AD.check(addrInput.value, { login: true });
      if (!res.ok) { fieldError(addrInput, addrErr, res.message); addrInput.focus(); return; }
      var btc = res.coin === "btc";
      $("w-howto-btc").hidden = !btc; $("w-howto-bch").hidden = btc;
      fieldError(addrInput, addrErr, "");
      addrInput.value = res.address;
      requestChallenge(res.address, $("w-get"));
    });
    addrInput.addEventListener("input", function () { if (!addrErr.hidden) fieldError(addrInput, addrErr, ""); });

    function requestChallenge(address, btn) {
      busy(btn, true, "Getting message...");
      setStatus(wStatus, "");
      return api.walletChallenge(address).then(function (r) {
        busy(btn, false);
        if (r.status !== 200 || !r.data || !r.data.message) {
          if (api.errorCode(r) === "invalid_address") { fieldError(addrInput, addrErr, api.errorText(r, "That is not a valid Testnet4 address.")); addrInput.focus(); return; }
          setStatus(wStatus, api.errorText(r), "error");
          return;
        }
        w.address = address;
        w.nonce = r.data.nonce;
        w.expiresAt = Date.parse(r.data.expiresAt);
        $("w-message").value = r.data.message;           // exactly as received
        $("w-addr-short").textContent = short(address);
        $("w-addr-short").title = address;
        sigInput.value = "";
        fieldError(sigInput, sigErr, "");
        $("w-renew").hidden = true;
        $("w-submit").disabled = false;
        step(2);
        startCountdown();
        $("w-message").focus();
      });
    }

    function startCountdown() {
      clearInterval(w.timer);
      var cd = $("w-countdown");
      function tick() {
        var left = Math.max(0, Math.round((w.expiresAt - Date.now()) / 1000));
        cd.textContent = Math.floor(left / 60) + ":" + ("0" + (left % 60)).slice(-2);
        cd.parentNode.classList.toggle("is-low", left <= 60);
        if (left <= 0) {
          clearInterval(w.timer);
          expired("This message expired. Get a new message and sign again.");
        }
      }
      tick();
      w.timer = setInterval(tick, 1000);
    }
    function expired(msg) {
      $("w-submit").disabled = true;
      $("w-renew").hidden = false;
      setStatus(wStatus, msg, "error");
    }

    $("w-copy").addEventListener("click", function () {
      var text = $("w-message").value, btn = this, state = $("w-copy-state");
      function done(ok) {
        state.textContent = ok ? "Copied" : "Select the message and copy it";
        btn.classList.toggle("is-copied", ok);
        setTimeout(function () { state.textContent = ""; btn.classList.remove("is-copied"); }, 2000);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
      else fallback();
      function fallback() {
        var ta = $("w-message"); ta.focus(); ta.select();
        var ok = false; try { ok = document.execCommand("copy"); } catch (e) {}
        done(ok);
      }
    });

    $("w-change").addEventListener("click", function () { resetWallet(); addrInput.focus(); addrInput.select(); });
    $("w-renew").addEventListener("click", function () { requestChallenge(w.address, this); });

    var VERIFY_ERRORS = {
      invalid_signature: "The signature does not match this address and message. Sign the exact message with the same address.",
      challenge_expired: "This message expired. Get a new message and sign again.",
      challenge_used: "This message was already used. Get a new message and sign again."
    };

    $("w-form-sign").addEventListener("submit", function (e) {
      e.preventDefault();
      // Pasted as the wallet gives it: only the spaces around it are trimmed (BIP-322 signatures may carry an "smp" prefix).
      var sig = sigInput.value.trim();
      sigInput.value = sig;
      if (!sig) { fieldError(sigInput, sigErr, "Paste the signature from your wallet."); sigInput.focus(); return; }
      if (sig.length < 60) {
        fieldError(sigInput, sigErr, "That does not look like a signature. Copy the whole signature your wallet shows.");
        sigInput.focus(); return;
      }
      if (Date.now() > w.expiresAt) { expired(VERIFY_ERRORS.challenge_expired); return; }
      fieldError(sigInput, sigErr, "");
      var btn = $("w-submit");
      busy(btn, true, "Checking...");
      setStatus(wStatus, "");
      api.walletVerify(w.address, w.nonce, sig).then(function (r) {
        busy(btn, false);
        if (r.status === 200 && r.data && r.data.user) {
          clearInterval(w.timer);
          $("w-done-addr").textContent = r.data.user.address || w.address;
          step(3);
          $("w-step3").focus();
          return succeed(r.data.user, $("w-done-status"));
        }
        var code = r.data && r.data.error;
        if (code === "challenge_expired" || code === "challenge_used") { clearInterval(w.timer); expired(VERIFY_ERRORS[code]); return; }
        if (code === "invalid_signature") { fieldError(sigInput, sigErr, VERIFY_ERRORS.invalid_signature); sigInput.focus(); return; }
        setStatus(wStatus, api.errorText(r), "error");
      });
    });

    /* ═══ Passkey ═══ */
    var pkStatus = $("pk-status");
    if (!window.PublicKeyCredential || !navigator.credentials) {
      $("pk-unsupported").hidden = false;
      $("pk-actions").hidden = true;
    }

    function b64uToBuf(s) {
      s = String(s).replace(/-/g, "+").replace(/_/g, "/");
      while (s.length % 4) s += "=";
      var bin = atob(s), out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out.buffer;
    }
    function bufToB64u(buf) {
      if (!buf) return null;
      var b = new Uint8Array(buf), s = "";
      for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
      return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }
    function creationOptions(j) {
      var o = Object.assign({}, j, { challenge: b64uToBuf(j.challenge), user: Object.assign({}, j.user, { id: b64uToBuf(j.user.id) }) });
      if (j.excludeCredentials) o.excludeCredentials = j.excludeCredentials.map(function (c) { return Object.assign({}, c, { id: b64uToBuf(c.id) }); });
      return o;
    }
    function requestOptions(j) {
      var o = Object.assign({}, j, { challenge: b64uToBuf(j.challenge) });
      if (j.allowCredentials) o.allowCredentials = j.allowCredentials.map(function (c) { return Object.assign({}, c, { id: b64uToBuf(c.id) }); });
      return o;
    }
    function serialize(cred) {
      var r = cred.response, resp = { clientDataJSON: bufToB64u(r.clientDataJSON) };
      if (r.attestationObject) {
        resp.attestationObject = bufToB64u(r.attestationObject);
        if (r.getTransports) resp.transports = r.getTransports();
      }
      if (r.authenticatorData) {
        resp.authenticatorData = bufToB64u(r.authenticatorData);
        resp.signature = bufToB64u(r.signature);
        resp.userHandle = bufToB64u(r.userHandle);
      }
      return {
        id: cred.id, rawId: bufToB64u(cred.rawId), type: cred.type,
        authenticatorAttachment: cred.authenticatorAttachment || null,
        clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
        response: resp
      };
    }
    function passkeyError(err, creating) {
      var n = err && err.name;
      if (n === "NotAllowedError" || n === "AbortError") return "Sign-in cancelled.";
      if (n === "InvalidStateError" && creating) return "This device already has a passkey for this site. Use Sign in with passkey.";
      if (n === "SecurityError") return "Passkeys only work on the real testnetcasino.com address over https.";
      return "The passkey could not be used. Please try again.";
    }

    function passkeyFlow(creating, btn) {
      var other = creating ? $("pk-login") : $("pk-create");
      busy(btn, true, creating ? "Creating..." : "Waiting for passkey...");
      other.disabled = true;
      setStatus(pkStatus, "");
      var getOptions = creating ? api.passkeyRegisterOptions() : api.passkeyLoginOptions();
      return getOptions.then(function (r) {
        if (r.status !== 200 || !r.data) throw { api: api.errorText(r) };
        return creating
          ? navigator.credentials.create({ publicKey: creationOptions(r.data) }).then(serialize)
          : navigator.credentials.get({ publicKey: requestOptions(r.data) }).then(serialize);
      }).then(function (credential) {
        return creating ? api.passkeyRegisterVerify(credential) : api.passkeyLoginVerify(credential);
      }).then(function (r) {
        if (r.status === 200 && r.data && r.data.user) return succeed(r.data.user, pkStatus);
        var code = api.errorCode(r);
        if (code === "challenge_expired") throw { api: "That took too long. Please try again." };
        if (code === "invalid_passkey") throw { api: creating ? "The passkey could not be registered. Please try again." : "That passkey is not registered here. Create a passkey account first." };
        throw { api: api.errorText(r) };
      }).catch(function (err) {
        busy(btn, false);
        other.disabled = false;
        var msg = err && err.api ? err.api : passkeyError(err, creating);
        setStatus(pkStatus, msg, msg === "Sign-in cancelled." ? "" : "error");
      });
    }
    $("pk-login").addEventListener("click", function () { passkeyFlow(false, this); });
    $("pk-create").addEventListener("click", function () { passkeyFlow(true, this); });
  }
})();
