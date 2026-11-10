/*
 * TestnetCasino.com: page effects:
 *   - animated background world on #casino-bg, chosen by <body data-ambient>:
 *       casino   drifting card suits and coins (lobby)
 *       orchard  falling leaves and petals, passing butterflies
 *       deepsea  rising bubbles, swimming fish
 *       cosmic   twinkling starfield with parallax and shooting stars
 *   Every world also carries drifting tBCH diamonds (assets/img/tbch.svg, the network badge).
 *   - coin shower (spinning tBCH coins) + themed confetti on #coin-shower:
 *       TNC_fx.coinShower(n), TNC_fx.burst(["🍒","🍋"], n)
 */
(function () {
  "use strict";

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function R(a, b) { return a + Math.random() * (b - a); }

  /* ---------- BCH Testnet4 coin image ---------- */
  // Resolved from this script's URL so it works from the lobby and from /games/.
  var SCRIPT_SRC = (document.currentScript && document.currentScript.src) || location.href;
  var TBCH = new Image();
  TBCH.decoding = "async";
  TBCH.src = new URL("../img/tbch.svg", SCRIPT_SRC).href;
  function tbchReady() { return TBCH.complete && TBCH.naturalWidth > 0; }
  // A coin of radius r; `flip` (cos of the spin angle) squashes it for a 3D spin.
  function tcoin(ctx, r, flip) {
    var fx = flip == null ? 1 : Math.max(0.08, Math.abs(flip));
    if (tbchReady()) { ctx.scale(fx, 1); ctx.drawImage(TBCH, -r, -r, r * 2, r * 2); return; }
    ctx.beginPath(); ctx.ellipse(0, 0, r * fx, r, 0, 0, 6.283); ctx.fillStyle = "#f5c542"; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = "#a87a12"; ctx.stroke();
  }
  // Shared drifting-coin item for the background worlds.
  function coinItem(x, y, s, o) { return { tc: true, x: x, y: y, s: s, o: o, sp: R(0, 6.28), vsp: R(0.01, 0.03), ph: R(0, 6.28) }; }
  function drawCoinItem(ctx, it) { ctx.globalAlpha = it.o; ctx.translate(it.x, it.y); tcoin(ctx, it.s / 2, Math.cos(it.sp)); }
  function pickOne(a) { return a[Math.floor(Math.random() * a.length)]; }

  /* ---------- Background worlds ---------- */
  var worlds = {
    casino: {
      count: function (W, H) { return Math.min(60, Math.round(W * H / 22000)); },
      make: function (W, H, fresh) {
        var g = pickOne(["♠", "♥", "♣", "♦", "coin", "coin"]);
        return { x: R(0, W), y: fresh ? R(0, H) : H + 30, g: g, s: g === "coin" ? R(16, 30) : R(10, 24),
                 v: R(0.08, 0.33), r: R(0, 6.28), vr: R(-0.005, 0.005), o: g === "coin" ? R(0.14, 0.32) : R(0.05, 0.17),
                 sp: R(0, 6.28), vsp: R(0.008, 0.02) };
      },
      step: function (it, W, H) { it.y -= it.v; it.r += it.vr; it.sp += it.vsp; return it.y > -30; },
      draw: function (ctx, it) {
        ctx.globalAlpha = it.o; ctx.translate(it.x, it.y);
        if (it.g === "coin") { tcoin(ctx, it.s / 2, Math.cos(it.sp)); return; }
        ctx.rotate(it.r);
        ctx.font = it.s * 1.4 + "px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillStyle = (it.g === "♥" || it.g === "♦") ? "#ff5a6e" : "#fff6dc"; ctx.fillText(it.g, 0, 0);
      }
    },
    orchard: {
      count: function (W, H) { return Math.min(34, Math.round(W * H / 38000)); },
      make: function (W, H, fresh) {
        if (Math.random() < 0.18) { var c = coinItem(R(0, W), fresh ? R(0, H) : -30, R(16, 26), R(0.3, 0.55)); c.v = R(0.3, 0.6); c.sw = R(0.4, 1.2); return c; }
        var bfly = Math.random() < 0.06;
        return bfly
          ? { b: true, x: -40, y: R(H * 0.1, H * 0.8), g: "🦋", s: R(18, 26), vx: R(0.5, 1.1), ph: R(0, 6.28), o: R(0.35, 0.6) }
          : { x: R(0, W), y: fresh ? R(0, H) : -30, g: pickOne(["🍃", "🍃", "🌸", "🍂", "🌼"]), s: R(12, 22),
              v: R(0.25, 0.7), sw: R(0.5, 1.6), ph: R(0, 6.28), r: R(0, 6.28), vr: R(-0.02, 0.02), o: R(0.25, 0.55) };
      },
      step: function (it, W, H) {
        it.ph += 0.02;
        if (it.tc) { it.y += it.v; it.x += Math.sin(it.ph) * it.sw * 0.4; it.sp += it.vsp; return it.y < H + 30; }
        if (it.b) { it.x += it.vx; it.y += Math.sin(it.ph * 3) * 0.8; return it.x < W + 40; }
        it.y += it.v; it.x += Math.sin(it.ph) * it.sw * 0.4; it.r += it.vr; return it.y < H + 30;
      },
      draw: function (ctx, it) {
        if (it.tc) { drawCoinItem(ctx, it); return; }
        ctx.globalAlpha = it.o; ctx.translate(it.x, it.y);
        if (it.b) ctx.scale(1, 0.75 + Math.abs(Math.sin(it.ph * 8)) * 0.25); else ctx.rotate(it.r);
        emoji(ctx, it.g, it.s);
      }
    },
    deepsea: {
      count: function (W, H) { return Math.min(55, Math.round(W * H / 20000)); },
      make: function (W, H, fresh) {
        if (Math.random() < 0.12) { var c = coinItem(R(0, W), fresh ? R(0, H) : -30, R(16, 28), R(0.25, 0.45)); c.v = R(0.2, 0.45); return c; }
        var fish = Math.random() < 0.1;
        if (fish) {
          var left = Math.random() < 0.5;
          return { f: true, dir: left ? 1 : -1, x: left ? -50 : W + 50, y: R(H * 0.15, H * 0.9), g: pickOne(["🐟", "🐠", "🐡", "🦑"]),
                   s: R(18, 30), vx: R(0.3, 0.8), ph: R(0, 6.28), o: R(0.18, 0.35) };
        }
        return { x: R(0, W), y: fresh ? R(0, H) : H + 20, rad: R(2, 7), v: R(0.25, 0.9), ph: R(0, 6.28), o: R(0.12, 0.35) };
      },
      step: function (it, W, H) {
        it.ph += 0.03;
        if (it.tc) { it.y += it.v; it.x += Math.sin(it.ph) * 0.5; it.sp += it.vsp * 0.6; return it.y < H + 30; }
        if (it.f) { it.x += it.vx * it.dir; it.y += Math.sin(it.ph) * 0.3; return it.dir > 0 ? it.x < W + 60 : it.x > -60; }
        it.y -= it.v; it.x += Math.sin(it.ph) * 0.35; return it.y > -20;
      },
      draw: function (ctx, it) {
        if (it.tc) { drawCoinItem(ctx, it); return; }
        ctx.globalAlpha = it.o; ctx.translate(it.x, it.y);
        if (it.f) {
          // Sea creature emoji face left, so mirror them when they swim right.
          if (it.dir > 0) ctx.scale(-1, 1);
          emoji(ctx, it.g, it.s); return;
        }
        ctx.beginPath(); ctx.arc(0, 0, it.rad, 0, 6.283);
        ctx.strokeStyle = "rgba(190,240,255,.9)"; ctx.lineWidth = 1.2; ctx.stroke();
        ctx.beginPath(); ctx.arc(-it.rad * 0.35, -it.rad * 0.35, it.rad * 0.3, 0, 6.283);
        ctx.fillStyle = "rgba(255,255,255,.8)"; ctx.fill();
      }
    },
    cosmic: {
      count: function (W, H) { return Math.min(170, Math.round(W * H / 7000)); },
      make: function (W, H, fresh) {
        if (!fresh && Math.random() < 0.03)
          return { shoot: true, x: R(W * 0.2, W), y: R(-20, H * 0.4), vx: -R(6, 10), vy: R(2.5, 4.5), life: 1 };
        if (Math.random() < 0.04) { var c = coinItem(fresh ? R(0, W) : W + 30, R(0, H), R(14, 30), R(0.3, 0.6)); c.vx = R(0.15, 0.45); return c; }
        var z = R(0.2, 1);
        return { x: R(0, W), y: R(0, H), z: z, rad: z * 1.6, ph: R(0, 6.28), tw: R(0.02, 0.06),
                 c: pickOne(["#ffffff", "#ffffff", "#cfe3ff", "#ffe9b3", "#e3c9ff"]) };
      },
      step: function (it, W, H) {
        if (it.shoot) { it.x += it.vx; it.y += it.vy; it.life -= 0.012; return it.life > 0 && it.x > -100 && it.y < H + 100; }
        if (it.tc) { it.x -= it.vx; it.y += Math.sin(it.ph += 0.01) * 0.15; it.sp += it.vsp * 0.5; return it.x > -30; }
        it.ph += it.tw; it.x -= it.z * 0.15; if (it.x < -5) { it.x = W + 5; it.y = R(0, H); } return true;
      },
      draw: function (ctx, it) {
        if (it.tc) { drawCoinItem(ctx, it); return; }
        if (it.shoot) {
          var g = ctx.createLinearGradient(it.x, it.y, it.x - it.vx * 12, it.y - it.vy * 12);
          g.addColorStop(0, "rgba(255,255,255," + it.life + ")"); g.addColorStop(1, "rgba(255,255,255,0)");
          ctx.strokeStyle = g; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(it.x, it.y);
          ctx.lineTo(it.x - it.vx * 12, it.y - it.vy * 12); ctx.stroke(); return;
        }
        ctx.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(it.ph)) * it.z;
        ctx.fillStyle = it.c; ctx.beginPath(); ctx.arc(it.x, it.y, it.rad, 0, 6.283); ctx.fill();
      },
      extra: 0.01  // chance per frame to add a shooting star
    }
  };
  function emoji(ctx, g, s) {
    ctx.font = s + 'px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(g, 0, 0);
  }

  function background() {
    var canvas = document.getElementById("casino-bg");
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext("2d");
    var world = worlds[document.body.getAttribute("data-ambient")] || worlds.casino;
    var W, H, items = [], target = 0;

    function resize() {
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
      target = world.count(W, H);
      items = [];
      for (var i = 0; i < target; i++) items.push(world.make(W, H, true));
    }
    function frame() {
      ctx.clearRect(0, 0, W, H);
      for (var i = items.length - 1; i >= 0; i--) {
        var it = items[i];
        if (!reduce && !world.step(it, W, H)) { items.splice(i, 1); continue; }
        ctx.save(); world.draw(ctx, it); ctx.restore();
      }
      if (!reduce) {
        while (items.length < target) items.push(world.make(W, H, false));
        if (world.extra && Math.random() < world.extra) items.push({ shoot: true, x: R(W * 0.3, W), y: R(-20, H * 0.3), vx: -R(6, 10), vy: R(2.5, 4.5), life: 1 });
        if (!document.hidden) requestAnimationFrame(frame);
      }
    }
    resize();
    frame();
    window.addEventListener("resize", function () { resize(); if (reduce) frame(); });
    document.addEventListener("visibilitychange", function () { if (!document.hidden && !reduce) requestAnimationFrame(frame); });
  }

  /* ---------- Coin shower + themed confetti ---------- */
  var shower = (function () {
    var canvas = null, ctx = null, parts = [], running = false;
    function setup() {
      canvas = document.getElementById("coin-shower");
      if (!canvas || !canvas.getContext) return false;
      ctx = canvas.getContext("2d");
      resize();
      window.addEventListener("resize", resize);
      return true;
    }
    function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
    function frame() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      parts = parts.filter(function (c) { return c.y < canvas.height + 50; });
      parts.forEach(function (c) {
        c.vy += 0.25; c.x += c.vx; c.y += c.vy; c.spin += c.vs;
        if (c.g) {
          ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.spin * 0.3); emoji(ctx, c.g, c.r * 2.2); ctx.restore();
        } else {
          ctx.save(); ctx.translate(c.x, c.y); tcoin(ctx, c.r * 1.15, Math.cos(c.spin)); ctx.restore();
        }
      });
      if (parts.length) requestAnimationFrame(frame);
      else { running = false; ctx.clearRect(0, 0, canvas.width, canvas.height); }
    }
    function add(n, glyphs) {
      if (reduce) return;
      if (!ctx && !setup()) return;
      for (var i = 0; i < n; i++) {
        parts.push({
          x: Math.random() * canvas.width, y: -20 - Math.random() * canvas.height * 0.5,
          vx: (Math.random() - 0.5) * 2, vy: Math.random() * 3, r: Math.random() * 6 + 8,
          spin: Math.random() * Math.PI, vs: Math.random() * 0.2 + 0.1,
          g: glyphs ? pickOne(glyphs) : null
        });
      }
      if (!running) { running = true; requestAnimationFrame(frame); }
    }
    return add;
  }());

  window.TNC_fx = {
    coinShower: function (n) { shower(n); },
    burst: function (glyphs, n) { shower(n, glyphs); }
  };

  function start() {
    background();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
