/*
 * TestnetCasino.com: leaderboards page (leaderboards.html).
 *
 * GET /leaderboards (public, sent with the session cookie): seven boards of up
 * to 1,000 entries { rank, player, method, amount, me? }, already sorted,
 * refreshed server-side every 5 minutes. Fetched once when the page opens and
 * again only when the player signs in or out (the response is up to ~500 KB).
 *
 * Rows render 50 at a time (more on scroll or "Show more"). The signed-in
 * player's row is found ONLY by `me: true` (labels can collide). A "Jump to
 * my position" button shows while that row is not visible.
 *
 * Depends on: api.js, units.js, auth.js.
 */
(function () {
  "use strict";

  var api = window.TNC_API, Auth = window.TNC_Auth, U = window.TNC_Units;
  if (!api || document.body.getAttribute("data-page") !== "leaderboards") return;

  var PAGE = 50;
  var BOARDS = [
    { key: "balances", tab: "Top balances", sub: "", title: "Top balances", what: "Balance" },
    { key: "wins24h", tab: "Biggest winners", sub: "24 hours", title: "Biggest winners: 24 hours", what: "Net win", note: "Net winnings (won minus bet) over the last 24 hours. Only players who are ahead are listed." },
    { key: "wins30d", tab: "Biggest winners", sub: "30 days", title: "Biggest winners: 30 days", what: "Net win", note: "Net winnings (won minus bet) over the last 30 days. Only players who are ahead are listed." },
    { key: "winsAllTime", tab: "Biggest winners", sub: "all time", title: "Biggest winners: all time", what: "Net win", note: "Net winnings (won minus bet) since the start. Only players who are ahead are listed.", empty: "No one is ahead yet. Be the first!" },
    { key: "withdrawals24h", tab: "Top withdrawals", sub: "24 hours", title: "Top withdrawals: 24 hours", what: "Withdrawn", note: "Withdrawals sent in the last 24 hours." },
    { key: "withdrawals30d", tab: "Top withdrawals", sub: "30 days", title: "Top withdrawals: 30 days", what: "Withdrawn", note: "Withdrawals sent in the last 30 days." },
    { key: "withdrawalsAllTime", tab: "Top withdrawals", sub: "all time", title: "Top withdrawals: all time", what: "Withdrawn", note: "All withdrawals ever sent." }
  ];
  var MEDAL = { 1: "🥇", 2: "🥈", 3: "🥉" };
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  var tabsEl = document.getElementById("lb-tabs"), panelsEl = document.getElementById("lb-panels");
  var statusEl = document.getElementById("lb-status"), updatedEl = document.getElementById("lb-updated");
  var data = null, state = {}, active = null, loadedFor;   // loadedFor: user id the data was fetched for

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function fmtAmount(sats) { return U ? U.int(sats) : String(sats); }
  function fmtSats(sats) { return Number(sats).toLocaleString("en-US") + " tBCH sats"; }

  /* ═══════════════ Tabs (WAI-ARIA tabs pattern) ═══════════════ */
  var tabs = BOARDS.map(function (b, i) {
    var t = el("button", "lb-tab");
    t.type = "button";
    t.id = "lb-tab-" + b.key;
    t.setAttribute("role", "tab");
    t.setAttribute("aria-controls", "lb-panel-" + b.key);
    t.appendChild(el("span", "lb-tab-name", b.tab));
    if (b.sub) t.appendChild(el("span", "lb-tab-sub", b.sub));
    t.addEventListener("click", function () { select(b.key, false); });
    t.addEventListener("keydown", function (e) {
      var j = null;
      if (e.key === "ArrowRight") j = (i + 1) % BOARDS.length;
      else if (e.key === "ArrowLeft") j = (i - 1 + BOARDS.length) % BOARDS.length;
      else if (e.key === "Home") j = 0;
      else if (e.key === "End") j = BOARDS.length - 1;
      if (j !== null) { e.preventDefault(); select(BOARDS[j].key, true); }
    });
    tabsEl.appendChild(t);
    return t;
  });

  function select(key, focus) {
    active = key;
    BOARDS.forEach(function (b, i) {
      var on = b.key === key;
      tabs[i].setAttribute("aria-selected", on ? "true" : "false");
      tabs[i].tabIndex = on ? 0 : -1;
      if (state[b.key]) state[b.key].panel.hidden = !on;
    });
    if (focus) tabs[BOARDS.findIndex(function (b) { return b.key === key; })].focus();
    try { history.replaceState(null, "", "#" + key); } catch (e) {}
    if (state[key]) updateJump(key);
  }

  /* ═══════════════ Boards ═══════════════ */
  function build() {
    panelsEl.textContent = "";
    state = {};
    BOARDS.forEach(function (b) {
      var entries = Array.isArray(data[b.key]) ? data[b.key] : [];
      var panel = el("section", "panel lb-panel");
      panel.id = "lb-panel-" + b.key;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", "lb-tab-" + b.key);
      panel.tabIndex = 0;
      panel.hidden = true;
      var h = el("h2", "panel-label", b.title.toUpperCase());
      panel.appendChild(h);
      if (b.note) panel.appendChild(el("p", "lb-note", b.note));

      var st = { board: b, entries: entries, panel: panel, rendered: 0, meIndex: -1, meRow: null, meVisible: false };
      entries.forEach(function (e, i) { if (e.me === true && st.meIndex === -1) st.meIndex = i; });

      // Where you stand on this board.
      var you = el("p", "lb-you");
      st.you = you;
      panel.appendChild(you);

      if (!entries.length) {
        panel.appendChild(el("p", "acct-empty lb-empty", b.empty || "No one here yet."));
      } else {
        var wrap = el("div", "lb-table-wrap");
        var table = el("table", "acct-table lb-table");
        var cap = el("caption", "sr-only", b.title + ", " + entries.length.toLocaleString("en-US") + " players");
        table.appendChild(cap);
        var thead = el("thead");
        var hr = el("tr");
        [["Rank", "lb-rank"], ["Player", "lb-player"], [b.what + " (tBCH sats)", "num lb-amount"]].forEach(function (c) {
          var th = el("th", c[1], c[0]); th.scope = "col"; hr.appendChild(th);
        });
        thead.appendChild(hr);
        table.appendChild(thead);
        st.tbody = el("tbody");
        table.appendChild(st.tbody);
        wrap.appendChild(table);
        panel.appendChild(wrap);

        st.more = el("button", "btn-ghost acct-more lb-more", "Show more");
        st.more.type = "button";
        st.more.addEventListener("click", function () { renderMore(st, PAGE); });
        panel.appendChild(st.more);
        st.sentinel = el("div", "lb-sentinel");
        st.sentinel.setAttribute("aria-hidden", "true");
        panel.appendChild(st.sentinel);
      }

      // "Jump to my position": sticks to the bottom of the screen while the row is out of view.
      st.jump = el("button", "btn-gold lb-jump");
      st.jump.type = "button";
      st.jump.hidden = true;
      st.jump.addEventListener("click", function () { jumpToMe(st); });
      panel.appendChild(st.jump);

      panelsEl.appendChild(panel);
      state[b.key] = st;
      if (entries.length) renderMore(st, PAGE);
      renderYou(st);
    });
    observe();
  }

  function rowFor(st, e, i) {
    var tr = el("tr", "lb-row" + (e.rank <= 3 ? " is-top" : ""));
    var rank = el("td", "lb-rank");
    rank.appendChild(el("span", "lb-rank-n", "#" + Number(e.rank).toLocaleString("en-US")));
    if (MEDAL[e.rank]) { var m = el("span", "lb-medal", MEDAL[e.rank]); m.setAttribute("aria-hidden", "true"); rank.appendChild(m); }
    var who = el("td", "lb-player");
    var icon = el("span", "lb-method", e.method === "wallet" ? "👛" : "🔐");
    icon.setAttribute("aria-hidden", "true");
    who.appendChild(icon);
    who.appendChild(el("span", "lb-name" + (e.method === "wallet" ? " auth-mono" : ""), String(e.player)));
    var amt = el("td", "num lb-amount", fmtAmount(e.amount));
    amt.title = fmtSats(e.amount);
    tr.appendChild(rank); tr.appendChild(who); tr.appendChild(amt);
    if (e.me === true) {
      tr.classList.add("is-me");
      tr.setAttribute("aria-current", "true");
      tr.tabIndex = -1;
      var badge = el("span", "lb-you-badge", "You");
      who.appendChild(badge);
      who.appendChild(el("span", "sr-only", ", your position"));
      st.meRow = tr;
    }
    return tr;
  }

  function renderMore(st, count) {
    var end = Math.min(st.entries.length, st.rendered + count);
    var frag = document.createDocumentFragment();
    for (var i = st.rendered; i < end; i++) frag.appendChild(rowFor(st, st.entries[i], i));
    st.tbody.appendChild(frag);
    st.rendered = end;
    var left = st.entries.length - st.rendered;
    st.more.hidden = left <= 0;
    st.more.textContent = "Show more (" + Math.min(PAGE, left) + " of " + left.toLocaleString("en-US") + " left)";
    if (st.meRow && meObserver && !st.meRow._observed) { st.meRow._observed = true; meObserver.observe(st.meRow); }
    // Re-arm the "load more" sentinel: if it is still on screen after this batch, the
    // observer reports it again and the next batch follows (no stale "already visible").
    if (moreObserver && st.sentinel) { moreObserver.unobserve(st.sentinel); if (left > 0) moreObserver.observe(st.sentinel); }
    updateJump(st.board.key);
  }

  function renderYou(st) {
    var you = st.you;
    you.textContent = "";
    var user = Auth && Auth.user;
    if (!user) {
      if (st.entries.length) {
        var a = el("a", "", "Sign in to see your position");
        a.href = Auth ? Auth.loginHref() : "login.html";
        you.appendChild(a);
      }
      you.hidden = !st.entries.length;
      return;
    }
    you.hidden = false;
    if (st.meIndex === -1) {
      you.textContent = st.entries.length >= 1000
        ? "You are not in the top 1,000 on this board yet."
        : "You are not on this board yet.";
    } else {
      var e = st.entries[st.meIndex];
      you.appendChild(document.createTextNode("Your position: "));
      you.appendChild(el("strong", "", "#" + Number(e.rank).toLocaleString("en-US")));
      you.appendChild(document.createTextNode(" with " + U.format(e.amount) + "."));
    }
  }

  /* ═══════════════ "Jump to my position" ═══════════════ */
  var meObserver = window.IntersectionObserver ? new IntersectionObserver(function (items) {
    items.forEach(function (it) {
      Object.keys(state).forEach(function (k) {
        if (state[k].meRow === it.target) { state[k].meVisible = it.isIntersecting; updateJump(k); }
      });
    });
  }) : null;
  var moreObserver = window.IntersectionObserver ? new IntersectionObserver(function (items) {
    items.forEach(function (it) {
      if (!it.isIntersecting) return;
      var st = state[active];
      if (st && st.sentinel === it.target && st.rendered < st.entries.length) renderMore(st, PAGE);
    });
  }, { rootMargin: "400px 0px" }) : null;

  function observe() {
    Object.keys(state).forEach(function (k) {
      var st = state[k];
      if (st.sentinel && moreObserver) moreObserver.observe(st.sentinel);
    });
  }

  function updateJump(key) {
    var st = state[key];
    if (!st) return;
    var show = !!(Auth && Auth.user) && st.meIndex !== -1 && key === active && !(st.meRow && st.meVisible);
    st.jump.hidden = !show;
    if (show) st.jump.textContent = "Jump to my position (#" + Number(st.entries[st.meIndex].rank).toLocaleString("en-US") + ")";
  }

  function jumpToMe(st) {
    if (st.meIndex === -1) return;
    if (st.rendered <= st.meIndex) renderMore(st, st.meIndex + 1 - st.rendered + 10);
    var row = st.meRow;
    if (!row) return;
    row.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    row.focus({ preventScroll: true });
    row.classList.remove("is-flash");
    void row.offsetWidth;
    row.classList.add("is-flash");
    setTimeout(function () { row.classList.remove("is-flash"); }, 2200);
  }

  /* ═══════════════ Loading ═══════════════ */
  function fmtTime(iso) {
    var d = new Date(iso);
    return isNaN(d) ? "" : "Updated " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + ".";
  }

  function load() {
    var uid = Auth && Auth.user ? Auth.user.id : null;
    loadedFor = uid;
    statusEl.hidden = false;
    statusEl.className = "panel acct-loading";
    statusEl.textContent = "Loading the leaderboards…";
    api.leaderboards().then(function (r) {
      if (loadedFor !== uid) return;   // signed in or out meanwhile: a newer request is on its way
      if (r.status !== 200 || !r.data) {
        statusEl.textContent = api.errorText(r, "The leaderboards could not be loaded.") + " ";
        var b = el("button", "btn-gold", "Try again");
        b.type = "button";
        b.addEventListener("click", load);
        statusEl.appendChild(b);
        return;
      }
      data = r.data;
      statusEl.hidden = true;
      updatedEl.textContent = fmtTime(data.updatedAt);
      build();
      var want = (location.hash || "").slice(1);
      select(state[want] ? want : (active && state[active] ? active : BOARDS[0].key), false);
    });
  }

  // Fetch once, and again only when the player signs in or out (not on balance updates).
  function start() {
    var first = Auth && Auth.ready ? Auth.ready : Promise.resolve();
    first.then(function () {
      load();
      if (Auth) Auth.onChange(function (u) {
        var uid = u ? u.id : null;
        if (uid !== loadedFor) load();
      });
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
