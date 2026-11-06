/*
 * TestnetCasino.com — page effects:
 *   - light bulbs around the marquee sign (#marquee)
 *   - animated background world on #casino-bg, chosen by <body data-ambient>:
 *       casino   drifting card suits and coins (lobby)
 *       orchard  falling leaves and petals, passing butterflies
 *       deepsea  rising bubbles, swimming fish
 *       cosmic   twinkling starfield with parallax and shooting stars
 *   - coin shower + themed confetti on #coin-shower:
 *       TNC_fx.coinShower(n), TNC_fx.burst(["🍒","🍋"], n)
 */
(function () {
  "use strict";

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function R(a, b) { return a + Math.random() * (b - a); }
  function pickOne(a) { return a[Math.floor(Math.random() * a.length)]; }

  /* ---------- Marquee bulbs ---------- */
  function placeBulbs() {
    var marquee = document.getElementById("marquee");
    if (!marquee) return;
    marquee.querySelectorAll(".bulb").forEach(function (b) { b.remove(); });
    var w = marquee.offsetWidth, h = marquee.offsetHeight, inset = 10, gap = 22;
    var iw = w - inset * 2, ih = h - inset * 2;
    var nx = Math.max(2, Math.round(iw / gap)), ny = Math.max(2, Math.round(ih / gap));
    var pts = [], i;
    for (i = 0; i < nx; i++) pts.push([inset + iw * i / nx, inset]);
    for (i = 0; i < ny; i++) pts.push([w - inset, inset + ih * i / ny]);
    for (i = 0; i < nx; i++) pts.push([w - inset - iw * i / nx, h - inset]);
    for (i = 0; i < ny; i++) pts.push([inset, h - inset - ih * i / ny]);
    pts.forEach(function (p, idx) {
      var b = document.createElement("span");
      b.className = "bulb" + (idx % 2 ? " odd" : "");
      b.setAttribute("aria-hidden", "true");
      b.style.left = p[0] + "px";
      b.style.top = p[1] + "px";
      marquee.appendChild(b);
    });
  }

  /* ---------- Background worlds ---------- */
  var worlds = {
    casino: {
      count: function (W, H) { return Math.min(60, Math.round(W * H / 22000)); },
      make: function (W, H, fresh) {
        return { x: R(0, W), y: fresh ? R(0, H) : H + 30, g: pickOne(["♠", "♥", "♣", "♦", "coin"]), s: R(10, 24),
                 v: R(0.08, 0.33), r: R(0, 6.28), vr: R(-0.005, 0.005), o: R(0.05, 0.17) };
      },
      step: function (it, W, H) { it.y -= it.v; it.r += it.vr; return it.y > -30; },
      draw: function (ctx, it) {
        ctx.globalAlpha = it.o; ctx.translate(it.x, it.y); ctx.rotate(it.r);
        if (it.g === "coin") { coin(ctx, it.s / 2); }
        else {
          ctx.font = it.s * 1.4 + "px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillStyle = (it.g === "♥" || it.g === "♦") ? "#ff5a6e" : "#fff6dc"; ctx.fillText(it.g, 0, 0);
        }
      }
    },
    orchard: {
      count: function (W, H) { return Math.min(34, Math.round(W * H / 38000)); },
      make: function (W, H, fresh) {
        var bfly = Math.random() < 0.06;
        return bfly
          ? { b: true, x: -40, y: R(H * 0.1, H * 0.8), g: "🦋", s: R(18, 26), vx: R(0.5, 1.1), ph: R(0, 6.28), o: R(0.35, 0.6) }
          : { x: R(0, W), y: fresh ? R(0, H) : -30, g: pickOne(["🍃", "🍃", "🌸", "🍂", "🌼"]), s: R(12, 22),
              v: R(0.25, 0.7), sw: R(0.5, 1.6), ph: R(0, 6.28), r: R(0, 6.28), vr: R(-0.02, 0.02), o: R(0.25, 0.55) };
      },
      step: function (it, W, H) {
        it.ph += 0.02;
        if (it.b) { it.x += it.vx; it.y += Math.sin(it.ph * 3) * 0.8; return it.x < W + 40; }
        it.y += it.v; it.x += Math.sin(it.ph) * it.sw * 0.4; it.r += it.vr; return it.y < H + 30;
      },
      draw: function (ctx, it) {
        ctx.globalAlpha = it.o; ctx.translate(it.x, it.y);
        if (it.b) ctx.scale(1, 0.75 + Math.abs(Math.sin(it.ph * 8)) * 0.25); else ctx.rotate(it.r);
        emoji(ctx, it.g, it.s);
      }
    },
    deepsea: {
      count: function (W, H) { return Math.min(55, Math.round(W * H / 20000)); },
      make: function (W, H, fresh) {
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
        if (it.f) { it.x += it.vx * it.dir; it.y += Math.sin(it.ph) * 0.3; return it.dir > 0 ? it.x < W + 60 : it.x > -60; }
        it.y -= it.v; it.x += Math.sin(it.ph) * 0.35; return it.y > -20;
      },
      draw: function (ctx, it) {
        ctx.globalAlpha = it.o; ctx.translate(it.x, it.y);
        if (it.f) { if (it.dir < 0) ctx.scale(-1, 1); emoji(ctx, it.g, it.s); return; }
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
        var z = R(0.2, 1);
        return { x: R(0, W), y: R(0, H), z: z, rad: z * 1.6, ph: R(0, 6.28), tw: R(0.02, 0.06),
                 c: pickOne(["#ffffff", "#ffffff", "#cfe3ff", "#ffe9b3", "#e3c9ff"]) };
      },
      step: function (it, W, H) {
        if (it.shoot) { it.x += it.vx; it.y += it.vy; it.life -= 0.012; return it.life > 0 && it.x > -100 && it.y < H + 100; }
        it.ph += it.tw; it.x -= it.z * 0.15; if (it.x < -5) { it.x = W + 5; it.y = R(0, H); } return true;
      },
      draw: function (ctx, it) {
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
  function coin(ctx, r) {
    ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.283); ctx.fillStyle = "#f5c542"; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = "#a87a12"; ctx.stroke();
  }
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
          var w = Math.abs(Math.cos(c.spin)) * c.r;
          ctx.beginPath(); ctx.ellipse(c.x, c.y, Math.max(1, w), c.r, 0, 0, 6.283);
          ctx.fillStyle = "#f5c542"; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = "#a87a12"; ctx.stroke();
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
    burst: function (glyphs, n) { shower(n, glyphs); },
    placeBulbs: placeBulbs
  };

  function start() {
    placeBulbs();
    window.addEventListener("resize", placeBulbs);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(placeBulbs);
    background();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
