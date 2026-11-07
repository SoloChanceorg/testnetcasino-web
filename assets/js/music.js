/*
 * TestnetCasino.com: jukebox with procedurally composed music (Web Audio API).
 *
 * No audio files: every song is described by a small recipe (tempo, meter,
 * chord progressions, drum groove, bass, comping, lead and a backing band)
 * and played live by a look-ahead step sequencer. Each song is a 40-bar
 * arrangement (intro, theme, theme with harmony, bridge, full-band theme,
 * outro) with up to nine parts at once: drums, bass, comping, lead, harmony,
 * counter-line, pad, ostinato and ambient layers. Melodies are composed once
 * per song from a fixed seed, so a song always sounds the same. A song
 * repeats until the player presses next or previous.
 *
 * Each venue has its own playlist, picked by <body data-ambient>:
 *   (none)   lobby: lounge jazz, disco, bossa nova
 *   orchard  country shuffle, hoedown, waltz
 *   deepsea  ambient, calypso, sea shanty
 *   cosmic   synthwave, space ambient, chiptune
 *
 * The jukebox UI (play/pause, previous, next, volume, spectrum display) is
 * injected into the page. Settings live in localStorage: on/off + volume are
 * shared, the current song is remembered per venue. Browsers only allow
 * audio after a user gesture, so a jukebox that was playing resumes on the
 * first tap or key press.
 */
(function () {
  "use strict";

  var THEME = document.body.getAttribute("data-ambient") || "lobby";
  var KEY = "tnc.music", TRACK_KEY = "tnc.music.track." + THEME, UI_KEY = "tnc.music.open";
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function load(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  /* ═══════════════ Music theory helpers ═══════════════ */
  var NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  var QUAL = {
    "": [0, 4, 7], "m": [0, 3, 7], "7": [0, 4, 7, 10], "maj7": [0, 4, 7, 11], "m7": [0, 3, 7, 10],
    "6": [0, 4, 7, 9], "m6": [0, 3, 7, 9], "sus4": [0, 5, 7], "dim": [0, 3, 6], "add9": [0, 4, 7, 14], "m9": [0, 3, 7, 10, 14]
  };
  function chord(sym) {
    var m = /^([A-G])([#b]?)(.*)$/.exec(sym);
    var root = NOTE[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
    return { root: (root + 12) % 12, iv: QUAL[m[3]] || QUAL[""] };
  }
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function rng(seed) { // mulberry32
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  var MAJ = [0, 2, 4, 5, 7, 9, 11], MIN = [0, 2, 3, 5, 7, 8, 10], DOR = [0, 2, 3, 5, 7, 9, 10],
      PENT = [0, 2, 4, 7, 9], MPENT = [0, 3, 5, 7, 10];

  /* ═══════════════ Playlists ═══════════════ */
  // Per song: groove recipe (drums, bass, comp, lead) plus the band for the
  // longer arrangement: bridge = chords of the B section, lead2 = who takes the
  // melody in the bridge, harm = harmony voice a third under the lead,
  // counter = slow counter-line on the chord's guide tones, pad = sustained
  // chords, ost = ostinato pattern (digits are chord tones, "." is a rest).
  var PLAYLISTS = {
    lobby: [
      { name: "Velvet Lounge", genre: "Lounge swing", bpm: 92, meter: 4, sub: 4, swing: 0.22, root: 60, scale: MAJ,
        prog: ["Dm7", "G7", "Cmaj7", "A7", "Dm7", "G7", "Em7", "A7"],
        bridge: ["Fmaj7", "Fm6", "Em7", "A7", "Dm7", "G7", "Em7", "A7"],
        drums: "lounge", bass: "walk", bassInst: "upright", comp: "charleston", compInst: "epiano", lead: "vibes", density: 0.42, seed: 11,
        lead2: "piano", harm: "vibes", counter: "muted", pad: "strings" },
      { name: "Neon Strip", genre: "Disco funk", bpm: 116, meter: 4, sub: 4, swing: 0, root: 57, scale: MIN,
        prog: ["Am7", "Am7", "Dm7", "Dm7", "Fmaj7", "G", "Am7", "E7"],
        bridge: ["Dm7", "Em7", "Fmaj7", "G", "Dm7", "Em7", "Fmaj7", "E7"],
        drums: "disco", bass: "octave", bassInst: "synthbass", comp: "stabs", compInst: "organ", lead: "sawlead", density: 0.34, seed: 22,
        lead2: "brass", harm: "sawlead", counter: "strings", ost: { inst: "clav", pat: "0.1.2.0.1.0.2.1.", oct: 12 } },
      { name: "High Roller Bossa", genre: "Bossa nova", bpm: 124, meter: 4, sub: 4, swing: 0, root: 65, scale: MAJ,
        prog: ["Fmaj7", "Fmaj7", "G7", "G7", "Gm7", "C7", "Fmaj7", "C7"],
        bridge: ["Bbmaj7", "Bbm6", "Am7", "D7", "Gm7", "C7", "Fmaj7", "C7"],
        drums: "bossa", bass: "bossa", bassInst: "upright", comp: "bossa", compInst: "nylon", lead: "flute", density: 0.3, seed: 33,
        lead2: "vibes", harm: "flute", counter: "cello", pad: "strings" }
    ],
    orchard: [
      { name: "Morning Harvest", genre: "Country shuffle", bpm: 104, meter: 4, sub: 4, swing: 0.16, root: 60, scale: PENT,
        prog: ["C", "F", "C", "G", "C", "F", "G", "C"],
        bridge: ["F", "C", "Am", "G", "F", "C", "Dm", "G"],
        drums: "country", bass: "root5", bassInst: "upright", comp: "strum", compInst: "banjo", lead: "whistle", density: 0.4, seed: 41, under: "accordion",
        lead2: "harmonica", harm: "whistle", counter: "cello", ost: { inst: "glock", pat: "0...2...1...2...", oct: 24 } },
      { name: "Cider Barn Hoedown", genre: "Hoedown", bpm: 148, meter: 4, sub: 4, swing: 0.08, root: 67, scale: MAJ,
        prog: ["G", "C", "G", "D", "G", "C", "D", "G"],
        bridge: ["C", "G", "Em", "D", "C", "G", "A", "D"],
        drums: "hoedown", bass: "boomchick", bassInst: "upright", comp: "offbeat", compInst: "banjo", lead: "fiddle", density: 0.6, seed: 42,
        lead2: "harmonica", harm: "fiddle", counter: "accordion", ost: { inst: "mandolin", pat: "0.1.2.1.0.1.2.1.", oct: 12 } },
      { name: "Sunset Picnic Waltz", genre: "Marimba waltz", bpm: 96, meter: 3, sub: 4, swing: 0, root: 65, scale: MAJ,
        prog: ["F", "Am", "Bb", "C", "F", "Dm", "Bb", "C"],
        bridge: ["Bb", "C", "Am", "Dm", "Gm", "C", "F", "C"],
        drums: "waltz", bass: "waltz", bassInst: "upright", comp: "waltz", compInst: "marimba", lead: "marimba", density: 0.45, seed: 43, under: "pad",
        lead2: "flute", harm: "marimba", counter: "cello", pad: "strings", ost: { inst: "glock", pat: "....2...1...", oct: 24 } }
    ],
    deepsea: [
      { name: "Abyssal Drift", genre: "Deep ambient", bpm: 90, meter: 4, sub: 4, swing: 0, root: 62, scale: DOR,
        prog: ["Dm7", "Em7", "Dm7", "Cmaj7", "Dm7", "Em7", "Fmaj7", "Em7"],
        bridge: ["Fmaj7", "G", "Am7", "Em7", "Fmaj7", "G", "Cmaj7", "Am7"],
        drums: "drift", bass: "sub", bassInst: "subbass", comp: "pad", compInst: "pad", lead: "bell", density: 0.16, seed: 51, arp: "bubbles",
        lead2: "choir", harm: "glock", counter: "cello", pad: "strings", ost: { inst: "kalimba", pat: "0...1.......2...", oct: 12 } },
      { name: "Coral Reef Calypso", genre: "Steel-drum calypso", bpm: 112, meter: 4, sub: 4, swing: 0, root: 60, scale: MAJ,
        prog: ["C", "F", "G", "C", "C", "F", "G7", "C"],
        bridge: ["Am", "Em", "F", "C", "Dm", "G", "C", "G7"],
        drums: "calypso", bass: "calypso", bassInst: "synthbass", comp: "steel", compInst: "steel", lead: "steel", density: 0.5, seed: 52,
        lead2: "marimba", harm: "steel", counter: "brass", ost: { inst: "kalimba", pat: "..0...1...2...1.", oct: 24 } },
      { name: "Sunken Galleon Shanty", genre: "Sea shanty", bpm: 112, meter: 3, sub: 2, swing: 0, root: 62, scale: MIN,
        prog: ["Dm", "C", "Dm", "A", "Dm", "C", "Bb", "A"],
        bridge: ["F", "C", "Dm", "A", "Bb", "F", "Gm", "A"],
        drums: "shanty", bass: "waltz", bassInst: "tuba", comp: "accordion", compInst: "accordion", lead: "fiddle", density: 0.62, seed: 53,
        lead2: "whistle", harm: "fiddle", counter: "cello", pad: "choir" }
    ],
    cosmic: [
      { name: "Hyperdrive", genre: "Synthwave", bpm: 108, meter: 4, sub: 4, swing: 0, root: 57, scale: MIN,
        prog: ["Am", "F", "C", "G", "Am", "F", "C", "E"],
        bridge: ["Dm", "Am", "F", "G", "Dm", "Am", "F", "E"],
        drums: "synthwave", bass: "pulse8", bassInst: "synthbass", comp: "arp16", compInst: "arpsaw", lead: "sawlead", density: 0.36, seed: 61,
        lead2: "brass", harm: "sawlead", counter: "strings", pad: "choir", ost: { inst: "pluck", pat: "0..1..2..1..0.2.", oct: 24 } },
      { name: "Nebula Dreams", genre: "Space ambient", bpm: 90, meter: 4, sub: 4, swing: 0, root: 60, scale: MAJ,
        prog: ["Cmaj7", "Am7", "Fmaj7", "G6", "Cmaj7", "Em7", "Fmaj7", "G"],
        bridge: ["Am7", "Em7", "Fmaj7", "Cmaj7", "Dm7", "Am7", "Fmaj7", "G"],
        drums: "none", bass: "sub", bassInst: "subbass", comp: "pad", compInst: "pad", lead: "bell", density: 0.18, seed: 62, arp: "stars",
        lead2: "choir", harm: "glock", counter: "cello", pad: "strings", ost: { inst: "kalimba", pat: "0...1...2...3...", oct: 12 } },
      { name: "Starport 8-bit", genre: "Chiptune", bpm: 132, meter: 4, sub: 4, swing: 0, root: 60, scale: MAJ,
        prog: ["C", "Am", "F", "G", "C", "Am", "F", "G"],
        bridge: ["F", "G", "Em", "Am", "F", "G", "C", "G"],
        drums: "chip", bass: "pulse8", bassInst: "chipbass", comp: "arp16", compInst: "chip", lead: "chip", density: 0.58, seed: 63,
        lead2: "chiptri", harm: "chip", counter: "chipsq" }
    ]
  };
  var LIST = PLAYLISTS[THEME] || PLAYLISTS.lobby;
  var VENUE = { lobby: "Casino Lounge", orchard: "Fruit Orchard", deepsea: "Deep Sea Treasure", cosmic: "Cosmic Voyage" }[THEME] || "Casino Lounge";

  /* ═══════════════ Audio graph ═══════════════ */
  var ctx = null, bus = null, master = null, analyser = null, noiseBuf = null;
  function setupAudio() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 3;
    analyser = ctx.createAnalyser(); analyser.fftSize = 64; analyser.smoothingTimeConstant = 0.75;
    master.connect(comp); comp.connect(analyser); analyser.connect(ctx.destination);
    bus = ctx.createGain();
    var verb = ctx.createConvolver(), wet = ctx.createGain();
    var len = Math.floor(ctx.sampleRate * 2.4), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (var ch = 0; ch < 2; ch++) { var d = ir.getChannelData(ch); for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    verb.buffer = ir;
    wet.gain.value = THEME === "deepsea" || THEME === "cosmic" ? 0.38 : 0.2;
    bus.connect(master); bus.connect(verb); verb.connect(wet); wet.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    var nd = noiseBuf.getChannelData(0); for (var j = 0; j < nd.length; j++) nd[j] = Math.random() * 2 - 1;
    applyVolume();
    document.addEventListener("visibilitychange", function () {
      if (!ctx) return;
      if (document.hidden) ctx.suspend(); else if (state.playing) ctx.resume();
    });
    return ctx;
  }

  /* ═══════════════ Instruments ═══════════════ */
  // Generic voice: oscillator partials → optional filter → envelope → bus.
  function voice(t, f, dur, o) {
    var g = ctx.createGain(), out = g, peak = (o.vol || 0.2);
    var a = o.a || 0.005, dec = o.d || 0.4, sus = o.s == null ? 0 : o.s, rel = o.r || 0.15;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    if (sus > 0) {
      g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * sus), t + a + dec);
      g.gain.setValueAtTime(Math.max(0.0001, peak * sus), t + Math.max(a + dec, dur));
      g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a + dec, dur) + rel);
    } else {
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
    }
    var end = t + (sus > 0 ? Math.max(a + dec, dur) + rel : a + dec) + 0.05;
    var dest = g;
    if (o.lp) {
      var flt = ctx.createBiquadFilter(); flt.type = "lowpass"; flt.Q.value = o.q || 0.7;
      flt.frequency.setValueAtTime(o.lp, t);
      if (o.lpTo) flt.frequency.exponentialRampToValueAtTime(o.lpTo, t + (o.lpTime || 0.3));
      flt.connect(g); dest = flt;
    }
    (o.parts || [[1, 1]]).forEach(function (p) {
      var osc = ctx.createOscillator(), pg = ctx.createGain();
      osc.type = p[3] || o.type || "sine";
      osc.frequency.setValueAtTime(f * p[0], t);
      if (o.detune) osc.detune.value = (p[0] === 1 ? 1 : -1) * o.detune;
      pg.gain.setValueAtTime(p[1], t);
      if (p[2]) pg.gain.exponentialRampToValueAtTime(0.0001, t + p[2]);   // faster-decaying partial
      if (o.vib) {
        var l = ctx.createOscillator(), lg = ctx.createGain();
        l.frequency.value = o.vib[0]; lg.gain.value = f * p[0] * o.vib[1];
        l.connect(lg); lg.connect(osc.frequency); l.start(t + (o.vibDelay || 0)); l.stop(end);
      }
      osc.connect(pg); pg.connect(dest);
      osc.start(t); osc.stop(end);
    });
    out.connect(bus);
  }
  function noise(t, dur, vol, ftype, freq, q) {
    var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; f.type = ftype; f.frequency.value = freq; f.Q.value = q || 0.8;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(bus);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }
  var INST = {
    epiano:    function (t, f, d, v) { voice(t, f, d, { vol: 0.09 * v, parts: [[1, 1], [2, 0.35, 0.25], [3, 0.12, 0.12]], d: 1.4, a: 0.004 }); },
    vibes:     function (t, f, d, v) { voice(t, f, d, { vol: 0.08 * v, parts: [[1, 1], [4, 0.2, 0.2]], d: 1.6, vib: [5.5, 0.004] }); },
    flute:     function (t, f, d, v) { voice(t, f, d, { vol: 0.07 * v, a: 0.05, d: 0.2, s: 0.8, r: 0.2, parts: [[1, 1], [2, 0.12]], vib: [5, 0.006], vibDelay: 0.15 }); },
    whistle:   function (t, f, d, v) { voice(t, f, d, { vol: 0.06 * v, a: 0.03, d: 0.1, s: 0.85, r: 0.12, vib: [6, 0.008], vibDelay: 0.1 }); },
    marimba:   function (t, f, d, v) { voice(t, f, d, { vol: 0.12 * v, parts: [[1, 1], [4, 0.35, 0.06], [10, 0.08, 0.02]], d: 0.55, a: 0.002 }); },
    banjo:     function (t, f, d, v) { voice(t, f, d, { vol: 0.06 * v, type: "triangle", parts: [[1, 1], [2, 0.4, 0.08, "square"]], d: 0.32, lp: 3200 }); },
    nylon:     function (t, f, d, v) { voice(t, f, d, { vol: 0.07 * v, type: "triangle", parts: [[1, 1], [2, 0.25, 0.15]], d: 0.9, lp: 2200 }); },
    fiddle:    function (t, f, d, v) { voice(t, f, d, { vol: 0.045 * v, type: "sawtooth", a: 0.05, d: 0.15, s: 0.75, r: 0.12, lp: 2400, vib: [5.5, 0.007], vibDelay: 0.08 }); },
    steel:     function (t, f, d, v) { voice(t, f, d, { vol: 0.09 * v, parts: [[1, 1], [2, 0.5, 0.4], [3, 0.2, 0.15]], d: 0.9, a: 0.003 }); },
    bell:      function (t, f, d, v) { voice(t, f, d, { vol: 0.06 * v, parts: [[1, 1], [2.76, 0.4, 0.8], [5.4, 0.18, 0.4]], d: 2.8, a: 0.003 }); },
    sawlead:   function (t, f, d, v) { voice(t, f, d, { vol: 0.045 * v, type: "sawtooth", parts: [[1, 1], [1.005, 0.8]], a: 0.01, d: 0.2, s: 0.6, r: 0.18, lp: 3200, lpTo: 1400, lpTime: 0.4, vib: [5, 0.004], vibDelay: 0.2 }); },
    chip:      function (t, f, d, v) { voice(t, f, d, { vol: 0.035 * v, type: "square", a: 0.002, d: 0.08, s: 0.55, r: 0.04 }); },
    arpsaw:    function (t, f, d, v) { voice(t, f, d, { vol: 0.03 * v, type: "sawtooth", d: 0.18, lp: 2600, lpTo: 700, lpTime: 0.15 }); },
    pad:       function (t, f, d, v) { voice(t, f, d, { vol: 0.035 * v, type: "sawtooth", parts: [[1, 1], [1.006, 1]], a: 0.9, d: 0.5, s: 0.8, r: 1.4, lp: 900, q: 0.4 }); },
    organ:     function (t, f, d, v) { voice(t, f, d, { vol: 0.03 * v, type: "square", parts: [[1, 1], [2, 0.5]], a: 0.01, d: 0.05, s: 0.8, r: 0.06, lp: 1800 }); },
    accordion: function (t, f, d, v) { voice(t, f, d, { vol: 0.03 * v, type: "sawtooth", parts: [[1, 1], [1.004, 0.9]], a: 0.04, d: 0.1, s: 0.8, r: 0.1, lp: 1700, vib: [6, 0.003] }); },
    upright:   function (t, f, d, v) { voice(t, f, d, { vol: 0.22 * v, type: "triangle", parts: [[1, 1], [2, 0.2, 0.08, "sine"]], d: 0.6, a: 0.008, lp: 700 }); },
    synthbass: function (t, f, d, v) { voice(t, f, d, { vol: 0.12 * v, type: "sawtooth", d: 0.25, s: 0.4, r: 0.08, lp: 900, lpTo: 260, lpTime: 0.18, q: 3 }); },
    subbass:   function (t, f, d, v) { voice(t, f, d, { vol: 0.2 * v, a: 0.25, d: 0.5, s: 0.85, r: 0.8 }); },
    tuba:      function (t, f, d, v) { voice(t, f, d, { vol: 0.12 * v, type: "square", a: 0.03, d: 0.2, s: 0.6, r: 0.1, lp: 420 }); },
    chipbass:  function (t, f, d, v) { voice(t, f, d, { vol: 0.12 * v, type: "triangle", a: 0.002, d: 0.1, s: 0.8, r: 0.03 }); },
    // Arrangement band (harmony, counter-lines, pads, ostinatos, bridge leads)
    piano:     function (t, f, d, v) { voice(t, f, d, { vol: 0.07 * v, parts: [[1, 1], [2, 0.45, 0.35], [3, 0.2, 0.18], [4, 0.08, 0.1]], a: 0.003, d: 1.6 }); },
    muted:     function (t, f, d, v) { voice(t, f, d, { vol: 0.035 * v, type: "sawtooth", a: 0.03, d: 0.15, s: 0.7, r: 0.12, lp: 1300, q: 2, vib: [5, 0.005], vibDelay: 0.15 }); },
    brass:     function (t, f, d, v) { voice(t, f, d, { vol: 0.03 * v, type: "sawtooth", parts: [[1, 1], [1.004, 0.7]], a: 0.04, d: 0.2, s: 0.75, r: 0.15, lp: 700, lpTo: 2400, lpTime: 0.09 }); },
    strings:   function (t, f, d, v) { voice(t, f, d, { vol: 0.02 * v, type: "sawtooth", parts: [[1, 1], [1.007, 0.9], [0.995, 0.8]], a: 0.35, d: 0.3, s: 0.85, r: 0.6, lp: 2000, q: 0.5, vib: [5, 0.003], vibDelay: 0.3 }); },
    cello:     function (t, f, d, v) { voice(t, f, d, { vol: 0.045 * v, type: "sawtooth", a: 0.12, d: 0.2, s: 0.8, r: 0.3, lp: 1100, vib: [5, 0.004], vibDelay: 0.2 }); },
    choir:     function (t, f, d, v) { voice(t, f, d, { vol: 0.028 * v, type: "sawtooth", parts: [[1, 1], [1.005, 0.8]], a: 0.5, d: 0.3, s: 0.85, r: 0.9, lp: 1000, q: 3, vib: [4.5, 0.004] }); },
    glock:     function (t, f, d, v) { voice(t, f, d, { vol: 0.04 * v, parts: [[1, 1], [2.76, 0.25, 0.25], [5.4, 0.1, 0.1]], a: 0.002, d: 1.1 }); },
    kalimba:   function (t, f, d, v) { voice(t, f, d, { vol: 0.08 * v, parts: [[1, 1], [4.2, 0.25, 0.04]], a: 0.002, d: 0.8 }); },
    harmonica: function (t, f, d, v) { voice(t, f, d, { vol: 0.03 * v, type: "square", parts: [[1, 1], [1.003, 0.6]], a: 0.03, d: 0.1, s: 0.8, r: 0.1, lp: 1800, vib: [6, 0.006], vibDelay: 0.1 }); },
    mandolin:  function (t, f, d, v) { voice(t, f, d, { vol: 0.035 * v, type: "triangle", parts: [[1, 1], [2, 0.5, 0.06, "sawtooth"]], a: 0.002, d: 0.25, lp: 3500 }); },
    clav:      function (t, f, d, v) { voice(t, f, d, { vol: 0.035 * v, type: "square", parts: [[1, 1], [2, 0.3]], a: 0.002, d: 0.18, lp: 3000, lpTo: 900, lpTime: 0.12, q: 2 }); },
    pluck:     function (t, f, d, v) { voice(t, f, d, { vol: 0.03 * v, type: "sawtooth", a: 0.002, d: 0.22, lp: 3000, lpTo: 500, lpTime: 0.18, q: 3 }); },
    chiptri:   function (t, f, d, v) { voice(t, f, d, { vol: 0.06 * v, type: "triangle", a: 0.002, d: 0.08, s: 0.7, r: 0.04 }); },
    chipsq:    function (t, f, d, v) { voice(t, f, d, { vol: 0.018 * v, type: "square", a: 0.01, d: 0.1, s: 0.6, r: 0.05 }); }
  };
  var DRUM = {
    s: function (t, v) { noise(t, 0.16, 0.22 * v, "bandpass", 1900, 0.9); voice(t, 190, 0.05, { vol: 0.1 * v, type: "triangle", d: 0.09 }); },
    c: function (t, v) { [0, 0.012, 0.024].forEach(function (o) { noise(t + o, 0.1, 0.2 * v, "bandpass", 1200, 1.2); }); },
    h: function (t, v) { noise(t, 0.04, 0.09 * v, "highpass", 7500); },
    o: function (t, v) { noise(t, 0.22, 0.08 * v, "highpass", 6500); },
    b: function (t, v) { noise(t, 0.14, 0.07 * v, "bandpass", 3200, 0.5); },          // brush
    x: function (t, v) { noise(t, 0.05, 0.06 * v, "highpass", 5200); },               // shaker
    r: function (t, v) { voice(t, 1700, 0.02, { vol: 0.06 * v, type: "triangle", d: 0.04 }); noise(t, 0.03, 0.08 * v, "bandpass", 2600, 2); }, // rim
    t: function (t, v, f) { voice(t, f || 170, 0.2, { vol: 0.25 * v, d: 0.3 }); },     // tom (pitch for fills)
    y: function (t, v) { noise(t, 1.4, 0.1 * v, "highpass", 4500); noise(t, 0.5, 0.06 * v, "bandpass", 8000, 0.6); }, // crash
    n: function (t, v) { noise(t, 0.06, 0.08 * v, "lowpass", 9000); }                 // chip noise
  };
  function kickDrop(t, v) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.16);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.7 * v, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.35);
  }
  DRUM.k = function (t, v) { kickDrop(t, v); };

  // Drum grooves: one string per instrument, one character per step ("x" hit, "a" accent, "g" ghost).
  var GROOVES = {
    lounge:    { k: "a.......g.......", b: "x...x...x...x...", h: "..g...g...g...g.", r: "....g.......g..." },
    disco:     { k: "a...a...a...a...", o: "..x...x...x...x.", c: "....x.......x...", h: "g.g.g.g.g.g.g.g." },
    bossa:     { k: "a..x..x.a..x..x.", r: "x..x...x..x..x..", x: "gggggggggggggggg" },
    country:   { k: "a.......a.......", s: "....x.......x...", b: "xgxgxgxgxgxgxgxg" },
    hoedown:   { k: "a...x...a...x...", s: "..x...x...x...x.", x: "gggggggggggggggg" },
    waltz:     { k: "a...........", h: "....x...x...", b: "x.g.x.g.x.g." },
    drift:     { k: "g...............", x: "........g......." },
    calypso:   { k: "a..x..x.a..x..x.", x: "x.xgx.xgx.xgx.xg", r: "..x...x...x..x.." },
    shanty:    { k: "a.....", t: "..x.x.", x: "xgxgxg" },
    synthwave: { k: "a...a...a...a...", s: "....a.......a...", h: "gxgxgxgxgxgxgxgx" },
    chip:      { k: "a.....x...a.....", s: "....x.......x...", n: "x.x.x.x.x.x.x.x." },
    none:      {}
  };
  var VEL = { a: 1, x: 0.75, g: 0.4 };

  /* ═══════════════ Song engine ═══════════════ */
  // Song form: 40 bars, then the whole arrangement repeats. Each section turns
  // layers on or off so the song builds up, breaks into the bridge and returns.
  var FORM = [
    { name: "intro", bars: 4, chords: "A", from: 4, mel: null, drums: "light", pad: true, ost: true },
    { name: "A1",    bars: 8, chords: "A", mel: "A",  drums: "full" },
    { name: "A2",    bars: 8, chords: "A", mel: "A2", drums: "full", harm: true, counter: true, ost: true },
    { name: "B",     bars: 8, chords: "B", mel: "B",  drums: "full", lead2: true, counter: true, pad: true, ost: true },
    { name: "A3",    bars: 8, chords: "A", mel: "A",  drums: "full", harm: true, counter: true, pad: true, ost: true },
    { name: "outro", bars: 4, chords: "A", from: 4, mel: "A", drums: "full", harm: true, pad: true }
  ];
  function inScale(song, m) { return song.scale.indexOf(((m - song.root) % 12 + 12) % 12) !== -1; }
  function scaleBelow(song, m, steps) { var x = m; while (steps > 0) { x--; if (inScale(song, x)) steps--; } return x; }
  function clone(bar) { return bar.map(function (n) { return Object.assign({}, n); }); }

  function compose(song) {
    var N = song.meter * song.sub;
    var chA = song.prog.map(chord), chB = (song.bridge || song.prog).map(chord);
    // Melody pitch pool: song scale from root - 3 to root + 19 semitones.
    var pool = [];
    for (var m = song.root - 3; m <= song.root + 19; m++) if (inScale(song, m)) pool.push(m);

    // One 8-bar phrase. `base` + `from`: keep base's first bars, write new ones after.
    function phrase(r, chords, endNote, base, from) {
      var idx = Math.floor(pool.length / 2);
      function nearestChordTone(ch) {
        var best = idx, bd = 99;
        pool.forEach(function (p, i) {
          if (ch.iv.some(function (iv) { return (ch.root + iv) % 12 === p % 12; }) && Math.abs(i - idx) < bd) { bd = Math.abs(i - idx); best = i; }
        });
        return best;
      }
      function genBar(b) {
        var notes = [], ch = chords[b];
        for (var s = 0; s < N; s++) {
          var strong = s % song.sub === 0;
          var p = song.density * (s === 0 ? 1.5 : strong ? 1.0 : (song.sub === 4 && s % 2 === 0) ? 0.55 : 0.22);
          if (r() < p) {
            if (strong && r() < 0.7) idx = nearestChordTone(ch);
            else idx = Math.max(0, Math.min(pool.length - 1, idx + (r() < 0.5 ? -1 : 1) * (r() < 0.75 ? 1 : 2)));
            notes.push({ s: s, m: pool[idx] });
          }
        }
        notes.forEach(function (n, i) { n.len = Math.min((i + 1 < notes.length ? notes[i + 1].s : N) - n.s, song.sub * 2); });
        return notes;
      }
      var bars = [];
      for (var b = 0; b < 8; b++) {
        if (base && b < from) bars.push(clone(base[b]));
        else if (!base && (b === 2 || b === 6)) bars.push(clone(bars[0]));
        else bars.push(genBar(b));
      }
      // End the phrase on a long note (tonic for A, the fifth for the bridge).
      var last = bars[7];
      last.push({ s: N - song.sub * Math.min(2, song.meter - 1), m: endNote, len: song.sub * 2 });
      last.sort(function (a, c) { return a.s - c.s; });
      for (var i = last.length - 2; i >= 0; i--) if (last[i].s >= last[last.length - 1].s) last.splice(i, 1);
      return bars;
    }
    var A = phrase(rng(song.seed), chA, song.root + 12);                 // the original theme, unchanged
    var mel = {
      A: A,
      A2: phrase(rng(song.seed + 202), chA, song.root + 12, A, 4),       // same question, new answer
      B: phrase(rng(song.seed + 101), chB, song.root + 7)                // bridge melody, ends on the dominant
    };

    var form = [];
    FORM.forEach(function (sec) {
      var chs = sec.chords === "B" ? chB : chA, from = sec.from || 0;
      for (var i = 0; i < sec.bars; i++) {
        form.push({ sec: sec, ch: chs[from + i], mel: sec.mel ? mel[sec.mel][from + i] : null, first: i === 0, last: i === sec.bars - 1 });
      }
    });
    form.forEach(function (bd, i) { bd.next = form[(i + 1) % form.length].ch; });

    // Counter-line: the chord's guide tones (3rd, then 7th or 5th), moving by the smallest step.
    var prev = 57;
    function nearest(pcs, target, avoid) {
      var best = target, bd = 99;
      for (var m = 50; m <= 65; m++) {
        if (m === avoid || pcs.indexOf(m % 12) === -1) continue;
        if (Math.abs(m - target) < bd) { bd = Math.abs(m - target); best = m; }
      }
      return best;
    }
    form.forEach(function (bd) {
      var ch = bd.ch, iv = ch.iv;
      var guide = [iv[1], iv.length > 3 ? iv[3] : iv[2]].map(function (x) { return (ch.root + x) % 12; });
      var n1 = nearest(guide, prev);
      if (song.meter === 4) {
        var n2 = nearest(guide, n1, n1);
        bd.counter = [{ s: 0, m: n1, len: N / 2 }, { s: N / 2, m: n2, len: N / 2 }];
        prev = n2;
      } else {
        bd.counter = [{ s: 0, m: n1, len: N }];
        prev = n1;
      }
    });
    return { form: form, N: N, seconds: form.length * song.meter * 60 / song.bpm };
  }
  function songComp(song) { return song._comp || (song._comp = compose(song)); }

  var SOFT = { drift: true, none: true };   // ambient grooves: no fills or crashes
  var LIGHT = { k: true, h: true, x: true, b: true, n: true };

  function playStep(song, comp, bi, s, t, stepDur) {
    var bd = comp.form[bi], sec = bd.sec, ch = bd.ch, nextCh = bd.next, N = comp.N, sub = song.sub;
    var beat = s % sub === 0, beatIdx = Math.floor(s / sub);
    var rootBass = 36 + ch.root;                                   // C2–B2
    var B = INST[song.bassInst], C = INST[song.compInst];
    // Close voicing: each chord tone placed at or just above `base`.
    function chordNotes(base) {
      return ch.iv.slice(0, 4).map(function (iv) {
        var pc = (ch.root + iv) % 12;
        return base + ((pc - base % 12 + 12) % 12);
      }).sort(function (a, b) { return a - b; });
    }
    var voicing = chordNotes(55);

    // Drums: groove, a fill on the last beat of each section, a crash on each new section.
    var soft = SOFT[song.drums];
    if (!soft && bd.last && s >= N - sub) {
      var i = s - (N - sub);
      if (i === 0) DRUM.s(t, 0.85);
      else DRUM.t(t, 0.6 + 0.15 * i, [240, 200, 165, 135][Math.min(3, Math.floor(i * 4 / sub))]);
      if (i === sub - 1 || s === 0) DRUM.k(t, 0.8);
    } else {
      var groove = GROOVES[song.drums] || {};
      Object.keys(groove).forEach(function (k) {
        if (sec.drums === "light" && !LIGHT[k]) return;
        var pat = groove[k], c = pat[s % pat.length];
        if (c && c !== ".") DRUM[k](t, (VEL[c] || 0.7) * (sec.drums === "light" ? 0.7 : 1));
      });
    }
    if (!soft && bd.first && s === 0 && sec.name !== "intro") DRUM.y(t, 0.8);

    // Bass
    var fifth = rootBass + 7, third = rootBass + (ch.iv[1] || 4);
    switch (song.bass) {
      case "walk":
        if (beat) {
          var walk = [rootBass, third, fifth, rootBass + ((nextCh.root - ch.root + 12) % 12) - 1];
          B(t, mtof(walk[beatIdx % 4]), stepDur * sub * 0.9, beatIdx === 0 ? 1 : 0.8);
        }
        break;
      case "octave": if (s % 2 === 0) B(t, mtof(rootBass + (s % 4 === 2 ? 12 : 0)), stepDur * 1.6, 1); break;
      case "bossa": if (s === 0 || s === 8) B(t, mtof(rootBass), stepDur * 3, 1); else if (s === 6 || s === 14) B(t, mtof(fifth - 12), stepDur * 2, 0.8); break;
      case "root5": if (s === 0) B(t, mtof(rootBass), stepDur * 4, 1); else if (s === 8) B(t, mtof(fifth - 12), stepDur * 4, 0.85); break;
      case "boomchick": if (s % 8 === 0) B(t, mtof(s === 0 ? rootBass : fifth - 12), stepDur * 2, 1); break;
      case "waltz": if (s === 0) B(t, mtof(rootBass), stepDur * sub, 1); else if (s === sub * 2 && song.meter === 3) B(t, mtof(fifth - 12), stepDur * sub, 0.6); break;
      case "sub": if (s === 0) B(t, mtof(rootBass), stepDur * N * 0.95, 1); break;
      case "pulse8": if (s % 2 === 0) B(t, mtof(rootBass + (s === 14 ? 12 : 0)), stepDur * 1.7, s % 4 === 0 ? 1 : 0.75); break;
      case "calypso": if (s === 0 || s === 3 || s === 6) B(t, mtof(rootBass), stepDur * 2.5, 1); else if (s === 8 || s === 11 || s === 14) B(t, mtof(fifth - 12), stepDur * 2.5, 0.85); break;
    }

    // Comping
    switch (song.comp) {
      case "charleston": if (s === 0 || s === 6) voicing.forEach(function (n) { C(t, mtof(n), stepDur * 3, 0.8); }); break;
      case "stabs": if (s % 4 === 2) voicing.forEach(function (n) { C(t, mtof(n + 12), stepDur * 1.2, 0.8); }); break;
      case "bossa": if ([0, 3, 6, 10, 12].indexOf(s) !== -1) voicing.forEach(function (n, i) { C(t + i * 0.012, mtof(n), stepDur * 2, 0.7); }); break;
      case "strum": if (s === 4 || s === 12) voicing.concat([voicing[0] + 12]).forEach(function (n, i) { C(t + i * 0.018, mtof(n), stepDur * 2, 0.9); }); break;
      case "offbeat": if (s % 4 === 2) voicing.forEach(function (n, i) { C(t + i * 0.01, mtof(n), stepDur, 0.8); }); break;
      case "waltz": if (s === sub || s === sub * 2) voicing.forEach(function (n) { C(t, mtof(n + 12), stepDur * 2, 0.6); }); break;
      case "pad": if (s === 0) voicing.forEach(function (n) { C(t, mtof(n), stepDur * N, 0.9); }); break;
      case "steel": if ([0, 3, 6, 8, 11, 14].indexOf(s) !== -1) C(t, mtof(voicing[(s / 3 | 0) % voicing.length] + 12), stepDur * 2, s % 8 === 0 ? 1 : 0.7); break;
      case "accordion": if (beat && s !== 0) voicing.forEach(function (n) { C(t, mtof(n), stepDur * sub * 0.8, 0.7); }); break;
      case "arp16": {
        var arpN = voicing.concat([voicing[0] + 12, voicing[1] + 12]);
        var seq = arpN.concat(arpN.slice(1, -1).reverse());
        C(t, mtof(seq[s % seq.length] + 12), stepDur * 0.9, s % 4 === 0 ? 1 : 0.7);
        break;
      }
    }
    // Optional sustained layer under the comping (keeps sparse songs from going silent).
    if (song.under && s === 0) voicing.forEach(function (n) { INST[song.under](t, mtof(n), stepDur * N * 0.95, song.under === "pad" ? 0.8 : 0.45); });
    // Ambient sparkle layers
    if (song.arp === "bubbles" && s % 2 === 0 && Math.random() < 0.35) INST.marimba(t, mtof(voicing[Math.floor(Math.random() * voicing.length)] + 24), stepDur, 0.35);
    if (song.arp === "stars" && Math.random() < 0.12) INST.bell(t, mtof(voicing[Math.floor(Math.random() * voicing.length)] + 24), stepDur * 4, 0.4);

    // Arrangement layers
    if (sec.pad && song.pad && s === 0) chordNotes(60).forEach(function (n) { INST[song.pad](t, mtof(n), stepDur * N * 0.98, 0.7); });
    if (sec.counter && song.counter) bd.counter.forEach(function (n) { if (n.s === s) INST[song.counter](t, mtof(n.m), stepDur * n.len * 0.95, 0.9); });
    if (sec.ost && song.ost) {
      var oc = song.ost.pat[s % song.ost.pat.length];
      if (oc && oc !== ".") {
        var d = +oc, tone = voicing[d % voicing.length] + 12 * Math.floor(d / voicing.length) + song.ost.oct;
        INST[song.ost.inst](t, mtof(tone), stepDur * 1.5, 0.6);
      }
    }

    // Lead melody (and its harmony a third below)
    if (bd.mel) {
      var L = INST[sec.lead2 && song.lead2 ? song.lead2 : song.lead];
      bd.mel.forEach(function (n) {
        if (n.s !== s) return;
        L(t, mtof(n.m), stepDur * n.len * 0.92, 1);
        if (sec.harm && song.harm) INST[song.harm](t, mtof(scaleBelow(song, n.m, 2)), stepDur * n.len * 0.92, 0.6);
      });
    }
  }

  /* ═══════════════ Transport ═══════════════ */
  var state = {
    on: !!load(KEY, { on: false }).on,
    vol: load(KEY, { vol: 0.5 }).vol == null ? 0.5 : load(KEY, { vol: 0.5 }).vol,
    track: Math.min(LIST.length - 1, Math.max(0, load(TRACK_KEY, 0) | 0)),
    playing: false
  };
  var seq = { timer: null, next: 0, step: 0, bar: 0, song: null, comp: null };

  function persist() { save(KEY, { on: state.on, vol: state.vol }); save(TRACK_KEY, state.track); }
  function applyVolume() { if (master) master.gain.setTargetAtTime(Math.pow(state.vol, 2) * 0.9, ctx.currentTime, 0.05); }

  function startSong() {
    var song = LIST[state.track];
    seq.song = song;
    seq.comp = songComp(song);
    seq.step = 0; seq.bar = 0;
    seq.next = ctx.currentTime + 0.12;
    bus.gain.cancelScheduledValues(ctx.currentTime);
    bus.gain.setValueAtTime(0.0001, ctx.currentTime);
    bus.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 0.6);
    clearInterval(seq.timer);
    seq.timer = setInterval(tick, 25);
    ui.render();
    mediaSession();
  }
  function tick() {
    var song = seq.song, comp = seq.comp, stepDur = 60 / song.bpm / song.sub;
    while (seq.next < ctx.currentTime + 0.15) {
      var t = seq.next;
      if (song.swing && song.sub === 4 && seq.step % 2 === 1) t += song.swing * stepDur;
      playStep(song, comp, seq.bar, seq.step, t, stepDur);
      seq.next += stepDur;
      if (++seq.step >= comp.N) {
        seq.step = 0;
        if (++seq.bar >= comp.form.length) seq.bar = 0;   // the song repeats until the player picks another
      }
    }
  }
  function stopSeq(fade) {
    clearInterval(seq.timer); seq.timer = null;
    if (bus && ctx) {
      bus.gain.cancelScheduledValues(ctx.currentTime);
      bus.gain.setValueAtTime(Math.max(0.0001, bus.gain.value), ctx.currentTime);
      bus.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (fade || 0.25));
    }
  }
  function play() {
    if (!setupAudio()) return;
    ctx.resume();
    state.playing = true; state.on = true; persist();
    startSong();
  }
  function pause() {
    state.playing = false; state.on = false; persist();
    stopSeq(0.3);
    setTimeout(function () { if (!state.playing && ctx) ctx.suspend(); }, 400);
    ui.render();
    mediaSession();
  }
  function change(dir) {
    state.track = (state.track + dir + LIST.length) % LIST.length;
    persist();
    if (state.playing) { stopSeq(0.2); setTimeout(function () { if (state.playing) startSong(); }, 220); }
    else ui.render();
  }
  function next() { change(1); }
  function prev() { change(-1); }

  function mediaSession() {
    if (!("mediaSession" in navigator) || !window.MediaMetadata) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: LIST[state.track].name, artist: "TestnetCasino Jukebox", album: VENUE });
      navigator.mediaSession.playbackState = state.playing ? "playing" : "paused";
      navigator.mediaSession.setActionHandler("play", play);
      navigator.mediaSession.setActionHandler("pause", pause);
      navigator.mediaSession.setActionHandler("nexttrack", next);
      navigator.mediaSession.setActionHandler("previoustrack", prev);
    } catch (e) {}
  }

  /* ═══════════════ Jukebox UI ═══════════════ */
  var ui = (function () {
    var el = document.createElement("aside");
    el.className = "jukebox jb-" + THEME;
    el.setAttribute("aria-label", "Jukebox");
    var open = load(UI_KEY, window.innerWidth >= 1200);
    el.innerHTML =
      '<button type="button" class="jb-fab" aria-controls="jb-panel" title="Jukebox"><span aria-hidden="true">🎵</span><span class="jb-eq" aria-hidden="true"><i></i><i></i><i></i></span></button>' +
      '<div class="jb-panel" id="jb-panel">' +
        '<div class="jb-arch"><span class="jb-name">JUKEBOX</span><span class="jb-venue">' + VENUE + '</span>' +
          '<button type="button" class="jb-min" aria-label="Hide jukebox">▾</button></div>' +
        '<div class="jb-screen"><canvas class="jb-viz" width="200" height="34" aria-hidden="true"></canvas>' +
          '<div class="jb-track" aria-live="polite"><span class="jb-num"></span><span class="jb-title"></span></div><div class="jb-genre"></div></div>' +
        '<div class="jb-ctrls">' +
          '<button type="button" class="jb-btn jb-prev" aria-label="Previous song">⏮</button>' +
          '<button type="button" class="jb-btn jb-play" aria-label="Play music" aria-pressed="false">▶</button>' +
          '<button type="button" class="jb-btn jb-next" aria-label="Next song">⏭</button>' +
        '</div>' +
        '<label class="jb-vol"><span aria-hidden="true">🔈</span><input type="range" min="0" max="100" step="1" aria-label="Music volume"><span class="jb-volv"></span></label>' +
        '<div class="jb-note"></div>' +
      '</div>';
    document.body.appendChild(el);
    var fab = el.querySelector(".jb-fab"), playBtn = el.querySelector(".jb-play"), vol = el.querySelector(".jb-vol input");
    var title = el.querySelector(".jb-title"), num = el.querySelector(".jb-num"), genre = el.querySelector(".jb-genre");
    var volv = el.querySelector(".jb-volv"), note = el.querySelector(".jb-note"), canvas = el.querySelector(".jb-viz");
    var c2d = canvas.getContext("2d");

    function setOpen(o) {
      open = o; save(UI_KEY, o);
      el.classList.toggle("is-open", o);
      fab.setAttribute("aria-expanded", o ? "true" : "false");
      fab.setAttribute("aria-label", o ? "Hide jukebox" : "Show jukebox");
      if (o) draw();
    }
    fab.addEventListener("click", function () { setOpen(!open); });
    el.querySelector(".jb-min").addEventListener("click", function () { setOpen(false); fab.focus(); });
    playBtn.addEventListener("click", function () { if (state.playing) pause(); else play(); });
    el.querySelector(".jb-next").addEventListener("click", next);
    el.querySelector(".jb-prev").addEventListener("click", prev);
    vol.addEventListener("input", function () { state.vol = vol.value / 100; persist(); applyVolume(); volv.textContent = vol.value; });

    function render() {
      var s = LIST[state.track];
      title.textContent = s.name;
      num.textContent = (state.track + 1) + "/" + LIST.length;
      var sec = Math.round(songComp(s).seconds);
      genre.textContent = s.genre + " · " + s.bpm + " BPM · " + Math.floor(sec / 60) + ":" + ("0" + sec % 60).slice(-2);
      playBtn.textContent = state.playing ? "⏸" : "▶";
      playBtn.setAttribute("aria-label", state.playing ? "Pause music" : "Play music");
      playBtn.setAttribute("aria-pressed", state.playing ? "true" : "false");
      el.classList.toggle("is-playing", state.playing);
      vol.value = Math.round(state.vol * 100);
      volv.textContent = vol.value;
      note.textContent = !state.playing && state.on ? "Tap anywhere to resume the music" : "";
      if (state.playing && open) draw();
    }
    var raf = 0;
    function draw() {
      cancelAnimationFrame(raf);
      var w = canvas.width, h = canvas.height, bars = 16, bw = w / bars;
      var data = analyser && state.playing ? new Uint8Array(analyser.frequencyBinCount) : null;
      if (data) analyser.getByteFrequencyData(data);
      c2d.clearRect(0, 0, w, h);
      var css = getComputedStyle(el);
      var c1 = css.getPropertyValue("--jb-viz1").trim() || "#7dff8a", c2 = css.getPropertyValue("--jb-viz2").trim() || "#ffd166";
      var grad = c2d.createLinearGradient(0, h, 0, 0); grad.addColorStop(0, c1); grad.addColorStop(1, c2);
      c2d.fillStyle = grad;
      for (var i = 0; i < bars; i++) {
        var v = data ? data[Math.min(data.length - 1, 1 + i)] / 255 : 0.04;
        var bh = Math.max(2, v * h);
        c2d.fillRect(i * bw + 1, h - bh, bw - 2, bh);
      }
      if (state.playing && open && !reduce) raf = requestAnimationFrame(draw);
    }
    setOpen(open);
    return { render: render };
  }());

  ui.render();
  // Browsers block audio until the user interacts: resume a jukebox that was on.
  if (state.on) {
    var resume = function (e) {
      if (e.target && e.target.closest && e.target.closest(".jukebox")) return;   // the jukebox handles its own clicks
      ["pointerdown", "keydown"].forEach(function (t) { document.removeEventListener(t, resume, true); });
      if (!state.playing && state.on) play();
    };
    ["pointerdown", "keydown"].forEach(function (t) { document.addEventListener(t, resume, true); });
  }
  window.TNC_music = { play: play, pause: pause, next: next, prev: prev, state: state, playlist: LIST };
})();
