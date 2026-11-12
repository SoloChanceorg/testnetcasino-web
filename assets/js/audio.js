/*
 * TestnetCasino.com — synthesized sound packs (Web Audio API, no files).
 *
 * One AudioContext, created lazily on the first user gesture:
 *   sources → out → (dry + generated room reverb) → master → speakers
 * Each game picks a pack with TNC_sfx.setTheme("orchard" | "deepsea" | "cosmic"):
 *   orchard  bright marimba + plucks, breeze and birdsong
 *   deepsea  muffled bass, bubbles, sonar pings, whale calls
 *   cosmic   synth arps, lasers, warp sweeps, a space drone
 * The default "casino" pack is the classic slot cabinet.
 * Mute is remembered per browser; audio is suspended while the tab is hidden.
 */
(function () {
  "use strict";

  var MUTE_KEY = "tnc.muted";
  var ctx = null, out = null, master = null, verbGain = null;
  var muted = false, theme = "casino";
  var loop = { tick: null, mel: null, active: 0 };
  var amb = { nodes: [], timers: [] };
  try { muted = localStorage.getItem(MUTE_KEY) === "1"; } catch (e) {}

  /* ---------- Graph ---------- */
  function impulse(c, secs, decay) {
    var len = Math.floor(c.sampleRate * secs), buf = c.createBuffer(2, len, c.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }
  function ac() {
    if (muted) return null;
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      // Mastering: a compressor keeps the big moments (many layers at once) punchy without clipping.
      var comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 14; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.14;
      comp.connect(ctx.destination);
      master = ctx.createGain(); master.gain.value = 0.6; master.connect(comp);
      out = ctx.createGain(); out.connect(master);
      var verb = ctx.createConvolver();
      verb.buffer = impulse(ctx, theme === "deepsea" ? 3.2 : theme === "cosmic" ? 2.6 : 1.8, 3);
      verbGain = ctx.createGain(); verbGain.gain.value = theme === "deepsea" ? 0.4 : theme === "cosmic" ? 0.32 : 0.22;
      out.connect(verb); verb.connect(verbGain); verbGain.connect(master);
      document.addEventListener("visibilitychange", function () {
        if (!ctx) return;
        if (document.hidden) ctx.suspend(); else if (!muted) ctx.resume();
      });
    }
    if (ctx.state === "suspended" && !document.hidden) ctx.resume();
    if (!amb.nodes.length) startAmbient();
    return ctx;
  }

  /* ---------- Synth helpers ---------- */
  // tone(freq, start, dur, type, vol, freqEnd, lowpassHz)
  function tone(freq, start, dur, type, vol, freqEnd, lp) {
    var c = ac(); if (!c) return;
    var t = c.currentTime + start;
    var o = c.createOscillator(), g = c.createGain(), dest = g;
    o.type = type || "square";
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (lp) {
      var f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = lp;
      o.connect(f); f.connect(g);
    } else o.connect(g);
    dest.connect(out);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(start, dur, vol, freq, ftype, freqEnd) {
    var c = ac(); if (!c) return;
    var t = c.currentTime + start;
    var len = Math.max(1, Math.floor(c.sampleRate * dur)), buf = c.createBuffer(1, len, c.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = buf; f.type = ftype || "bandpass";
    f.frequency.setValueAtTime(freq || 1500, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    g.gain.value = vol || 0.3;
    s.connect(f); f.connect(g); g.connect(out);
    s.start(t);
  }
  function chord(fs, start, dur, type, vol, lp) { fs.forEach(function (f) { tone(f, start, dur, type, vol, null, lp); }); }
  function drum(start, vol) { noise(start, 0.18, vol || 0.7, 160, "lowpass"); tone(110, start, 0.22, "sine", (vol || 0.7) * 0.8, 45); }
  function marimba(f, start, vol) { tone(f, start, 0.32, "sine", vol || 0.12); tone(f * 4, start, 0.06, "sine", (vol || 0.12) * 0.35); }
  function pluck(f, start, vol) { tone(f, start, 0.18, "triangle", vol || 0.1); tone(f * 2, start, 0.05, "square", (vol || 0.1) * 0.25, null, 3000); }
  function bubble(start, f, vol) { tone(f || 500, start, 0.07, "sine", vol || 0.06, (f || 500) * 2.6); }
  function harp(f, start, vol) { tone(f, start, 0.9, "triangle", vol || 0.08, null, 2200); tone(f * 2, start, 0.4, "sine", (vol || 0.08) * 0.3); }
  function zap(start, f0, f1, vol) { tone(f0, start, 0.14, "square", vol || 0.05, f1, 3500); }
  function arp(notes, start, step, fn) { notes.forEach(function (n, i) { fn(n, start + i * step); }); }
  function rnd(a) { return a[Math.floor(Math.random() * a.length)]; }
  // Casino instruments, shared by every pack: the bell of a slot cabinet, a brass fanfare, a coin clink, a reel's thunk.
  function bell(f, start, vol, dur) {
    vol = vol || 0.12; dur = dur || 0.9;
    tone(f, start, dur, "sine", vol); tone(f * 2.76, start, dur * 0.35, "sine", vol * 0.35); tone(f * 5.4, start, dur * 0.12, "sine", vol * 0.18);
    tone(f * 0.5, start, dur * 0.5, "triangle", vol * 0.25, null, 1200);
  }
  function brass(fs, start, dur, vol) {
    var c = ac(); if (!c) return;
    var t = c.currentTime + start, vib = c.createOscillator(), vg = c.createGain();
    vib.frequency.value = 5.5; vg.gain.value = 3; vib.connect(vg); vib.start(t); vib.stop(t + dur + 0.1);
    fs.forEach(function (f) {
      [-6, 6].forEach(function (cents) {
        var o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
        o.type = "sawtooth"; o.frequency.value = f * Math.pow(2, cents / 1200); vg.connect(o.detune);
        lp.type = "lowpass"; lp.frequency.setValueAtTime(500, t); lp.frequency.exponentialRampToValueAtTime(3200, t + Math.min(0.5, dur * 0.4)); lp.frequency.exponentialRampToValueAtTime(900, t + dur);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime((vol || 0.05) / 2, t + 0.09); g.gain.setValueAtTime((vol || 0.05) / 2, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(lp); lp.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05);
      });
    });
  }
  function clink(start, p, vol) {   // a coin on the tray; p (0..1) raises its pitch
    var f = 2600 * Math.pow(2, (p || 0) * 0.9);
    noise(start, 0.02, (vol || 0.16) * 1.2, 7000, "bandpass"); tone(f, start, 0.08, "sine", vol || 0.05); tone(f * 1.5, start, 0.05, "sine", (vol || 0.05) * 0.4);
  }
  function thunk(start, i) {         // a reel's stop: a soft click, then the body of the cabinet
    noise(start, 0.006, 0.5, 4200, "bandpass"); noise(start, 0.05, 0.3, 240, "lowpass");
    tone(130 - i * 9, start, 0.16, "sine", 0.26, 48);
  }
  function bellRun(notes, start, step, vol) { notes.forEach(function (f, i) { bell(f, start + i * step, vol || 0.08, 0.6); }); }
  function riser(dur, vol) { noise(0, dur, vol || 0.05, 320, "bandpass", 4200); }

  /* ---------- Ambience ---------- */
  function noiseLoop(lpHz, vol, brown) {
    var c = ctx, len = c.sampleRate * 4, buf = c.createBuffer(1, len, c.sampleRate);
    var d = buf.getChannelData(0), last = 0;
    for (var i = 0; i < len; i++) {
      if (brown) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
      else d[i] = Math.random() * 2 - 1;
    }
    var s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = buf; s.loop = true; f.type = "lowpass"; f.frequency.value = lpHz;
    g.gain.setValueAtTime(0.0001, c.currentTime);
    g.gain.exponentialRampToValueAtTime(vol, c.currentTime + 2);
    s.connect(f); f.connect(g); g.connect(master);
    s.start();
    amb.nodes.push(s);
    return { src: s, gain: g, filter: f };
  }
  function every(minMs, maxMs, fn) {
    (function next() {
      var id = setTimeout(function () { if (!muted && !document.hidden) fn(); next(); }, minMs + Math.random() * (maxMs - minMs));
      amb.timers.push(id);
    }());
  }
  function startAmbient() {
    var c = ctx;
    if (theme === "orchard") {
      var breeze = noiseLoop(700, 0.03, false);
      var lfo = c.createOscillator(), lg = c.createGain();
      lfo.frequency.value = 0.12; lg.gain.value = 0.02; lfo.connect(lg); lg.connect(breeze.gain.gain); lfo.start();
      amb.nodes.push(lfo);
      every(2500, 7000, function () {          // bird chirps
        var base = 2400 + Math.random() * 1400, n = 2 + Math.floor(Math.random() * 3);
        for (var i = 0; i < n; i++) tone(base, i * 0.11, 0.08, "sine", 0.018, base * 1.35);
      });
    } else if (theme === "deepsea") {
      noiseLoop(220, 0.09, true);
      every(900, 2600, function () {           // bubble clusters
        var n = 2 + Math.floor(Math.random() * 4);
        for (var i = 0; i < n; i++) bubble(i * (0.05 + Math.random() * 0.08), 300 + Math.random() * 600, 0.02);
      });
      every(9000, 16000, function () {         // distant whale
        tone(180, 0, 1.4, "sine", 0.02, 260, 600);
        tone(260, 1.3, 1.6, "sine", 0.018, 150, 600);
      });
    } else if (theme === "cosmic") {
      [55, 55.4, 82.4].forEach(function (f) {  // drone pad
        var o = c.createOscillator(), g = c.createGain(), lpf = c.createBiquadFilter();
        o.type = "sawtooth"; o.frequency.value = f; lpf.type = "lowpass"; lpf.frequency.value = 260;
        g.gain.setValueAtTime(0.0001, c.currentTime); g.gain.exponentialRampToValueAtTime(0.018, c.currentTime + 3);
        o.connect(lpf); lpf.connect(g); g.connect(master); o.start();
        amb.nodes.push(o);
      });
      every(2500, 6000, function () {          // computer blips
        var n = 2 + Math.floor(Math.random() * 4);
        for (var i = 0; i < n; i++) tone(rnd([1320, 1760, 2093, 2637, 3136]), i * 0.07, 0.05, "square", 0.012, null, 4000);
      });
    } else {
      noiseLoop(420, 0.07, true);
      every(3000, 8000, function () {
        var base = rnd([1047, 1175, 1319, 1568]);
        tone(base, 0, 0.5, "sine", 0.012); tone(base * 1.25, 0.12, 0.5, "sine", 0.01); tone(base * 1.5, 0.24, 0.6, "sine", 0.009);
      });
    }
  }
  function stopAmbient() {
    amb.timers.forEach(clearTimeout);
    amb.nodes.forEach(function (n) { try { n.stop(); } catch (e) {} });
    amb = { nodes: [], timers: [] };
  }

  /* ---------- Sound packs ---------- */
  var PENTA = [523, 587, 659, 784, 880, 1047, 1175, 1319, 1568, 1760, 2093];        // C major pentatonic
  var DORIAN = [147, 165, 175, 196, 220, 247, 262, 294, 330, 349, 392, 440, 494, 523]; // D dorian
  var AMIN = [220, 262, 330, 440, 523, 659, 880, 1047, 1319, 1760];                  // A minor arp

  var packs = {
    casino: {
      spinStart: function () { noise(0, 0.45, 0.22, 400, "bandpass", 2600); arp([523, 659, 784, 1047], 0.04, 0.045, function (f, t) { tone(f, t, 0.09, "square", 0.05); }); },
      loopTick: function (n) { noise(0, 0.018, 0.04 + 0.02 * n, 2600 + Math.random() * 1200); },
      loopNotes: [523, 659, 784, 659, 587, 698, 880, 698], loopStep: 125,
      loopNote: function (f) { tone(f, 0, 0.1, "square", 0.028); },
      reelStop: function (i) { noise(0, 0.07, 0.55, 520); tone(210 - i * 18, 0, 0.13, "triangle", 0.25, 90); },
      scatter: function (n) { var m = Math.pow(2, (n - 1) * 2 / 12); [1320, 1760, 2093, 2637].forEach(function (f, i) { tone(f * m, i * 0.05, 0.22, "sine", 0.09); }); },
      lineBlip: function (k) { tone(880 * Math.pow(2, k / 12), 0, 0.12, "square", 0.06); },
      noWin: function () { tone(330, 0, 0.12, "triangle", 0.08); tone(262, 0.12, 0.2, "triangle", 0.08); },
      win: function () { [784, 988, 1175].forEach(function (f, i) { tone(f, i * 0.08, 0.2, "triangle", 0.14); }); tone(2349, 0.25, 0.6, "sine", 0.05); },
      bigWin: function () { [523, 659, 784, 1047, 1319, 1568, 2093].forEach(function (f, i) { tone(f, i * 0.06, 0.16, "square", 0.06); }); chord([523, 659, 784, 1047], 0.45, 0.9, "triangle", 0.08); drum(0.45, 0.5); },
      megaWin: function () {
        [[392, 0], [523, 0.14], [659, 0.28], [784, 0.42], [1047, 0.56]].forEach(function (n) { tone(n[0], n[1], 0.2, "square", 0.08); tone(n[0] / 2, n[1], 0.2, "triangle", 0.08); });
        chord([523, 659, 784, 1047], 0.72, 1.4, "square", 0.04); chord([262, 392], 0.72, 1.4, "triangle", 0.1);
        [0, 0.28, 0.56, 0.72, 0.86].forEach(function (t) { drum(t, 0.6); });
      },
      jackpotExtra: function () {
        for (var k = 0; k < 14; k++) tone(k % 2 ? 2637 : 2093, 1.1 + k * 0.13, 0.3, "sine", 0.06);
        chord([523, 659, 784, 1047, 1319], 2.9, 2.2, "triangle", 0.07); drum(2.9, 0.8);
        for (var j = 0; j < 40; j++) tone(2400 + Math.random() * 2000, 1.0 + j * 0.06 + Math.random() * 0.04, 0.08, "sine", 0.05);
      },
      feature: function () { arp([784, 1047, 1319, 1568], 0, 0.06, function (f, t) { tone(f, t, 0.15, "square", 0.05); }); },
      bonusStart: function () { this.bigWin(); },
      reveal: function (v) { tone(880 + Math.min(v, 25) * 40, 0, 0.18, "triangle", 0.12); },
      collect: function () { tone(400, 0, 0.3, "triangle", 0.1, 200); },
      collectItem: function (p) { clink(0, p, 0.05); },
      collectFull: function () { bellRun([1047, 1319, 1568, 2093], 0, 0.08, 0.07); },
      pour: function () {},
      wheelTick: function () { noise(0, 0.02, 0.3, 2500); },
      wheelStop: function () { this.win(); },
      ladderUp: function (lv) { tone(300 + lv * 120, 0, 0.25, "square", 0.06, 600 + lv * 160); },
      ladderFail: function () { tone(600, 0, 0.6, "sawtooth", 0.08, 70, 1500); }
    },

    orchard: {
      spinStart: function () { noise(0, 0.3, 0.12, 900, "bandpass", 2400); arp([523, 659, 784, 1047, 1319], 0.02, 0.05, function (f, t) { marimba(f, t, 0.1); }); },
      loopTick: function () { noise(0, 0.02, 0.09, 1800 + Math.random() * 300); },
      loopNotes: [784, 880, 1047, 880, 784, 659, 587, 659, 784, 1047, 1175, 1047], loopStep: 140,
      loopNote: function (f) { marimba(f, 0, 0.045); },
      reelStop: function (i) { noise(0, 0.05, 0.45, 900); tone(340 + i * 22, 0, 0.12, "sine", 0.22, 170); },
      scatter: function (n) { var m = Math.pow(2, (n - 1) * 2 / 12); tone(1568 * m, 0, 1.0, "sine", 0.09); tone(2093 * m, 0.08, 0.9, "sine", 0.06); tone(3136 * m, 0.16, 0.6, "sine", 0.03); },
      anticipationTone: function (dur) { for (var k = 0; k < dur / 0.12; k++) pluck(PENTA[k % 6] * 2, k * 0.12, 0.05); },
      lineBlip: function (k) { marimba(PENTA[Math.min(k + 3, PENTA.length - 1)], 0, 0.14); },
      noWin: function () { marimba(659, 0, 0.1); marimba(523, 0.14, 0.1); },
      win: function () { arp([784, 1047, 1319], 0, 0.08, function (f, t) { marimba(f, t, 0.14); }); tone(3000, 0.3, 0.08, "sine", 0.02, 3900); tone(3000, 0.42, 0.08, "sine", 0.02, 3900); },
      bigWin: function () { arp(PENTA.slice(0, 9), 0, 0.055, function (f, t) { pluck(f, t, 0.09); }); chord([523, 659, 784, 1047], 0.55, 1.0, "triangle", 0.07); drum(0.55, 0.4); },
      megaWin: function () {
        arp([523, 659, 784, 1047, 784, 1047, 1319, 1568], 0, 0.1, function (f, t) { pluck(f, t, 0.1); tone(f / 2, t, 0.12, "triangle", 0.06); });
        chord([523, 659, 784, 1047], 0.85, 1.4, "triangle", 0.08); [0, 0.4, 0.85].forEach(function (t) { drum(t, 0.5); });
      },
      jackpotExtra: function () {
        for (var k = 0; k < 16; k++) marimba(PENTA[(k * 3) % PENTA.length], 1.1 + k * 0.1, 0.1);
        chord([523, 659, 784, 1047, 1319], 2.9, 2.2, "triangle", 0.07); drum(2.9, 0.7);
        for (var b = 0; b < 6; b++) tone(2800 + Math.random() * 800, 1.2 + b * 0.35, 0.08, "sine", 0.03, 4000);
      },
      feature: function () { tone(600, 0, 0.45, "sine", 0.08, 1800); arp([1047, 1319, 1568, 2093], 0.3, 0.07, function (f, t) { tone(f, t, 0.4, "sine", 0.07); }); },
      bonusStart: function () { arp([523, 659, 784, 1047, 784, 1047, 1319], 0, 0.11, function (f, t) { pluck(f, t, 0.12); }); chord([523, 784, 1047], 0.8, 1.2, "triangle", 0.08); drum(0.8, 0.4); },
      reveal: function (v) { tone(400, 0, 0.06, "sine", 0.12, 900); marimba(PENTA[Math.min(Math.round(Math.log2(v + 1) * 2), PENTA.length - 1)] * 1.0, 0.05, 0.14); },
      collect: function () { tone(320, 0, 0.18, "sine", 0.12, 160); tone(240, 0.16, 0.3, "sine", 0.1, 120); },
      // a leaf settling on the tree: a rustle and a rising note; the full tree: wind through the leaves and a harp
      collectItem: function (p) { noise(0, 0.08, 0.22, 2600, "bandpass", 900); marimba(PENTA[Math.min(PENTA.length - 1, 3 + Math.round(p * 5))], 0.02, 0.09); },
      collectFull: function () { noise(0, 0.9, 0.18, 1800, "bandpass", 600); [0, 0.09, 0.18, 0.3, 0.42, 0.6].forEach(function (t, i) { harp(PENTA[(i * 2) % PENTA.length] * 2, t, 0.06); }); },
      wheelTick: function () { noise(0, 0.02, 0.2, 1800); }, wheelStop: function () { this.win(); },
      ladderUp: function (lv) { marimba(PENTA[Math.min(lv + 2, PENTA.length - 1)], 0, 0.12); }, ladderFail: function () { this.collect(); }
    },

    deepsea: {
      spinStart: function () { noise(0, 0.6, 0.25, 250, "lowpass", 1400); for (var i = 0; i < 6; i++) bubble(0.05 + i * 0.05, 350 + Math.random() * 500, 0.05); },
      loopTick: function () { bubble(0, 380 + Math.random() * 520, 0.025); },
      loopNotes: [147, 220, 175, 220, 196, 294, 175, 262], loopStep: 230,
      loopNote: function (f) { tone(f, 0, 0.22, "triangle", 0.06, null, 700); },
      reelStop: function (i) { tone(130 - i * 8, 0, 0.22, "sine", 0.35, 55); noise(0, 0.1, 0.35, 260, "lowpass"); bubble(0.04, 420 + i * 60, 0.04); },
      scatter: function (n) { var m = Math.pow(2, (n - 1) * 2 / 12); tone(1175 * m, 0, 1.4, "sine", 0.1); tone(1175 * m, 0.38, 1.0, "sine", 0.035); },
      anticipationTone: function (dur) { tone(70, 0, dur, "sine", 0.12, 150); for (var i = 0; i < dur / 0.15; i++) bubble(i * 0.15, 300 + i * 40, 0.03); },
      lineBlip: function (k) { bubble(0, 500 + k * 90, 0.05); harp(DORIAN[Math.min(k + 6, DORIAN.length - 1)] * 2, 0, 0.07); },
      noWin: function () { tone(220, 0, 0.3, "triangle", 0.07, null, 800); tone(175, 0.2, 0.5, "triangle", 0.07, null, 800); },
      win: function () { arp([294, 349, 440, 587], 0, 0.09, function (f, t) { harp(f, t, 0.1); }); },
      bigWin: function () {
        tone(180, 0, 1.0, "sine", 0.1, 300, 900); tone(300, 0.9, 1.0, "sine", 0.08, 160, 900);       // whale call
        arp([294, 349, 440, 523, 587, 698, 880], 0.2, 0.08, function (f, t) { harp(f, t, 0.09); });
        chord([147, 220, 294], 0.8, 1.6, "triangle", 0.08, 900);
      },
      megaWin: function () {
        this.bigWin();
        arp([587, 698, 880, 1047, 1175], 1.0, 0.1, function (f, t) { harp(f, t, 0.08); });
        [0, 0.5, 1.0].forEach(function (t) { tone(60, t, 0.5, "sine", 0.3, 40); });
      },
      jackpotExtra: function () {
        for (var k = 0; k < 12; k++) tone(rnd([1175, 1397, 1760]), 1.4 + k * 0.16, 1.0, "sine", 0.04);
        for (var j = 0; j < 30; j++) bubble(1.2 + j * 0.07, 300 + Math.random() * 900, 0.04);
        chord([147, 220, 294, 440], 3.0, 2.4, "triangle", 0.08, 1200);
      },
      feature: function () { noise(0, 0.6, 0.3, 300, "bandpass", 3200); chord([294, 440, 587, 880], 0.35, 0.9, "sine", 0.05); },
      bonusStart: function () { [0, 0.5, 1.0].forEach(function (t) { tone(880, t, 1.2, "sine", 0.1); tone(1340, t, 0.8, "sine", 0.04); }); },
      reveal: function () { bubble(0, 600, 0.06); },
      collect: function () { this.noWin(); },
      // a coin landing on the pile, a pearl's plink; the full chest: a cascade of coins and a harp
      collectItem: function (p) { clink(0, p, 0.06); tone(1600 + p * 900, 0.03, 0.12, "sine", 0.04); },
      collectFull: function () { for (var k = 0; k < 14; k++) clink(k * 0.045, k / 14, 0.045); harp(1047, 0.3, 0.08); harp(1568, 0.5, 0.07); harp(2093, 0.7, 0.06); },
      wheelTick: function () { noise(0, 0.03, 0.35, 900); tone(500, 0, 0.03, "triangle", 0.04); },
      wheelStop: function () { tone(880, 0, 1.4, "sine", 0.12); tone(1340, 0, 1.0, "sine", 0.05); },
      ladderUp: function (lv) { bubble(0, 400 + lv * 80, 0.06); }, ladderFail: function () { this.noWin(); }
    },

    cosmic: {
      spinStart: function () { tone(200, 0, 0.5, "sawtooth", 0.07, 2200, 2500); noise(0, 0.5, 0.12, 600, "bandpass", 5000); },
      loopTick: function () { tone(2000 + Math.random() * 800, 0, 0.02, "square", 0.012, null, 5000); },
      loopNotes: [440, 523, 659, 880, 659, 523, 392, 494, 587, 784, 587, 494], loopStep: 95,
      loopNote: function (f) { tone(f, 0, 0.08, "sawtooth", 0.03, null, 1800); },
      reelStop: function (i) { zap(0, 1600 - i * 120, 140, 0.07); tone(90, 0, 0.15, "sine", 0.25, 40); },
      scatter: function (n) { var m = Math.pow(2, (n - 1) * 2 / 12); tone(660 * m, 0, 0.6, "sine", 0.08, 2640 * m); tone(990 * m, 0.1, 0.6, "triangle", 0.04, 3960 * m); },
      anticipationTone: function (dur) { tone(110, 0, dur, "sawtooth", 0.05, 880, 1400); noise(0, dur, 0.06, 300, "bandpass", 4000); },
      lineBlip: function (k) { tone(AMIN[Math.min(k + 3, AMIN.length - 1)], 0, 0.12, "square", 0.05, null, 3000); zap(0.02, 3000, 1500, 0.02); },
      noWin: function () { tone(440, 0, 0.18, "sawtooth", 0.05, 220, 1200); },
      win: function () { arp([440, 659, 880, 1319], 0, 0.06, function (f, t) { tone(f, t, 0.18, "sawtooth", 0.06, null, 2500); }); },
      bigWin: function () {
        arp(AMIN, 0, 0.05, function (f, t) { tone(f, t, 0.14, "square", 0.05, null, 3000); });
        chord([220, 330, 440, 659], 0.5, 1.3, "sawtooth", 0.035, 1800); drum(0.5, 0.5);
      },
      megaWin: function () {
        tone(80, 0, 1.0, "sawtooth", 0.08, 1600, 2000);
        arp([440, 523, 659, 880, 1047, 1319, 1760], 0.4, 0.07, function (f, t) { tone(f, t, 0.16, "square", 0.05, null, 3500); });
        chord([220, 330, 440, 554, 659], 1.0, 1.6, "sawtooth", 0.03, 2200); [0.4, 0.75, 1.0].forEach(function (t) { drum(t, 0.55); });
      },
      jackpotExtra: function () {
        for (var k = 0; k < 20; k++) zap(1.2 + k * 0.08, 4000 - k * 100, 800, 0.025);
        tone(60, 2.6, 1.0, "sawtooth", 0.08, 2400, 3000);
        chord([220, 330, 440, 554, 659, 880], 3.0, 2.4, "sawtooth", 0.03, 2400); drum(3.0, 0.8);
      },
      feature: function () { arp([330, 440, 660, 880, 1320], 0, 0.05, function (f, t) { tone(f, t, 0.1, "square", 0.05, null, 4000); }); tone(1320, 0.3, 0.5, "sine", 0.06, 2640); },
      bonusStart: function () { noise(0, 1.2, 0.2, 200, "bandpass", 6000); tone(60, 0, 1.2, "sawtooth", 0.08, 1200, 2400); chord([220, 330, 440], 1.1, 1.0, "sawtooth", 0.04, 2000); },
      reveal: function () { zap(0, 2600, 900, 0.05); },
      collect: function () { this.noWin(); },
      // a cell draining with a glug, fuel pouring for `dur` seconds; the full tank: the engine lights
      collectItem: function (p) { tone(200 + p * 80, 0, 0.14, "sine", 0.09, 90); bubble(0.06, 500 + p * 300, 0.05); },
      pour: function (dur) { noise(0, dur, 0.06, 700, "bandpass", 420); for (var k = 0; k < dur * 9; k++) bubble(Math.random() * dur, 320 + Math.random() * 500, 0.025); },
      collectFull: function () { noise(0, 1.4, 0.25, 90, "lowpass", 40); riser(0.9, 0.07); tone(55, 0.1, 1.3, "sawtooth", 0.1, 28, 400); zap(0.9, 3000, 600, 0.05); zap(1.05, 3400, 700, 0.05); },
      wheelTick: function () { tone(1800, 0, 0.02, "square", 0.03); }, wheelStop: function () { this.win(); },
      ladderUp: function (lv) { noise(0, 0.35, 0.18, 300 + lv * 200, "bandpass", 2000 + lv * 500); tone(220 * Math.pow(2, lv / 4), 0, 0.35, "sawtooth", 0.06, 440 * Math.pow(2, lv / 4), 3000); },
      ladderFail: function () { tone(900, 0, 1.0, "sawtooth", 0.08, 50, 1600); noise(0, 0.8, 0.2, 2000, "lowpass", 100); }
    }
  };
  function P(name) { var p = packs[theme] || packs.casino; return p[name] ? p : packs.casino; }
  function call(name, args) { var p = P(name); return p[name].apply(p, args || []); }

  function stopSpinLoop() {
    clearInterval(loop.tick); clearInterval(loop.mel);
    loop.tick = loop.mel = null;
  }

  window.TNC_sfx = {
    setTheme: function (t) { theme = packs[t] ? t : "casino"; },
    press: function () { noise(0, 0.025, 0.5, 3200); tone(95, 0, 0.14, "sine", 0.5, 50); },
    spinStart: function () { call("spinStart"); },
    startSpinLoop: function () {
      stopSpinLoop();
      loop.active = 5;
      if (!ac()) return;
      var p = packs[theme] || packs.casino, step = 0;
      loop.tick = setInterval(function () {
        if (muted || !loop.active) return stopSpinLoop();
        call("loopTick", [loop.active]);
      }, theme === "deepsea" ? 110 : 64);
      loop.mel = setInterval(function () {
        if (muted || !loop.active) return stopSpinLoop();
        p.loopNote(p.loopNotes[step++ % p.loopNotes.length]);
      }, p.loopStep);
    },
    stopSpinLoop: stopSpinLoop,
    reelStop: function (i) {
      call("reelStop", [i]); thunk(0, i);
      loop.active = Math.max(0, loop.active - 1);
      if (!loop.active) stopSpinLoop();
    },
    scatter: function (n) { call("scatter", [n]); },
    anticipation: function (dur) {
      var c = ac(); if (!c) return;
      if (packs[theme] && packs[theme].anticipationTone) packs[theme].anticipationTone(dur);
      else {
        var t = c.currentTime, o = c.createOscillator(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
        o.type = "sawtooth"; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(880, t + dur);
        lfo.frequency.value = 14; lg.gain.value = 0.03; lfo.connect(lg); lg.connect(g.gain);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.1);
        g.gain.setValueAtTime(0.05, t + dur - 0.1); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        var f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 1800;
        o.connect(f); f.connect(g); g.connect(out);
        o.start(t); lfo.start(t); o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
      }
      for (var k = 0; k < dur / 0.35; k++) drum(k * 0.35, 0.22);   // heartbeat
      riser(dur, 0.045);
    },
    lineBlip: function (k) { call("lineBlip", [k]); },
    // The win meter rolling up: coins on the tray, rising in pitch with the count; a bell when it lands.
    countTick: function (p) { clink(0, p || 0, 0.04); },
    countDone: function () { bell(2093, 0, 0.1, 0.8); bell(2637, 0.02, 0.05, 0.6); },
    noWin: function () { call("noWin"); },
    win: function () { call("win"); },
    bigWin: function () { call("bigWin"); bellRun([1047, 1319, 1568, 2093, 2637], 0.05, 0.09, 0.07); },
    megaWin: function () {
      call("megaWin"); brass([262, 330, 392, 523], 0.1, 1.8, 0.05);
      bellRun([1047, 1319, 1568, 2093, 2637, 3136], 0.3, 0.08, 0.07); bellRun([1568, 2093, 2637, 3136], 1.0, 0.1, 0.06);
    },
    jackpot: function () {
      call("megaWin"); call("jackpotExtra");
      for (var k = 0; k < 14; k++) bell(k % 2 ? 2637 : 2093, 0.1 + k * 0.11, 0.09, 0.4);   // the alarm bell on top of the cabinet
      brass([262, 330, 392, 523], 0.2, 2.6, 0.06); brass([349, 440, 523, 698], 2.9, 2.4, 0.06);
      bellRun([1047, 1319, 1568, 2093, 2637, 3136, 4186], 1.7, 0.07, 0.07);
    },
    freeSpins: function () { call("bigWin"); call("scatter", [5]); },
    feature: function () { call("feature"); },
    bonusStart: function () { call("bonusStart"); },
    reveal: function (v) { call("reveal", [v]); },
    collect: function () { call("collect"); },
    collectItem: function (p) { call("collectItem", [p]); },
    collectFull: function () { call("collectFull"); },
    pour: function (dur) { call("pour", [dur]); },
    wheelTick: function () { call("wheelTick"); },
    wheelStop: function () { call("wheelStop"); },
    ladderUp: function (lv) { call("ladderUp", [lv]); },
    ladderFail: function () { call("ladderFail"); },
    tilt: function () {
      tone(150, 0, 0.6, "sawtooth", 0.16, 70); tone(156, 0, 0.6, "sawtooth", 0.12, 73);
      tone(440, 0.65, 0.12, "square", 0.06); tone(440, 0.85, 0.12, "square", 0.06);
    },
    chip: function () {
      if (theme === "deepsea") bubble(0, 700, 0.06);
      else if (theme === "cosmic") tone(1800, 0, 0.05, "square", 0.04, 2400, 4000);
      else { noise(0, 0.03, 0.35, 4200); tone(1800, 0, 0.05, "triangle", 0.05); }
    },
    isMuted: function () { return muted; },
    setMuted: function (m) {
      muted = !!m;
      if (muted) { stopSpinLoop(); stopAmbient(); if (ctx) ctx.suspend(); }
      try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch (e) {}
    }
  };
})();
