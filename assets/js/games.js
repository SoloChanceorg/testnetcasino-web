/*
 * Game definitions for TestnetCasino.com.
 *
 * All games share the rules in assets/js/engine.js (5 reels × 3 rows,
 * 10 paylines, wilds, scatters, free spins, bonus games). Each game adds:
 *   feature     its unique base-game mechanic ("respin" | "expand" | "multwild")
 *   freeSpins   awards for 3/4/5 scatters + its own free-spin twist
 *   bonus       its own bonus game ("pick" | "wheel" | "ladder")
 *   theme       visual + sound world (CSS class, fx ambience, audio pack)
 *
 * symbols[]:
 *   weight  relative chance of landing on any cell of an allowed reel
 *   pays    [3, 4, 5 of a kind] × TOTAL bet
 *   kind    "wild" | "scatter" | "bonus" (regular symbols: common → rare)
 *   reels   optional list of reels (0–4) the symbol can appear on
 *
 * payScale multiplies every payout so each game's RTP is 100.01% (a faucet).
 * payScale and stats.* come from
 *   node tools/simulate.js 84000000 <game> --workers 12
 * (1 billion spins; 250000000 × 12 = 3 billion for cosmic-voyage). Re-run after
 * changing any number here and paste the printed payScale and stats in.
 */
(function (root) {
  "use strict";

  var GAMES = {
    "fruit-orchard": {
      name: "Fruit Orchard",
      tagline: "Sunny classic fruits. Frequent small wins.",
      volatility: "Low",
      theme: "orchard",
      feature: "respin",
      featureName: "Lucky Respin",
      featureText: "Every new 🌟 sticks in place and all other cells respin, up to 3 times. Each respin pays.",
      symbols: [
        { emoji: "🍒", name: "Cherry",      weight: 60, pays: [0.5, 1.2, 5] },
        { emoji: "🍋", name: "Lemon",       weight: 52, pays: [0.5, 1.5, 6] },
        { emoji: "🍊", name: "Orange",      weight: 44, pays: [0.6, 2, 7] },
        { emoji: "🍇", name: "Grapes",      weight: 32, pays: [1, 3, 12] },
        { emoji: "🍉", name: "Watermelon",  weight: 24, pays: [1.5, 5, 25] },
        { emoji: "7️⃣", name: "Lucky Seven", weight: 16,  pays: [3, 12, 60] },
        { emoji: "🌟", name: "Golden Star", weight: 3,  pays: [5, 25, 120], kind: "wild" },
        { emoji: "🍀", name: "Four-Leaf Clover", weight: 8, pays: [2, 10, 50], kind: "scatter" },
        { emoji: "🧺", name: "Harvest Basket", weight: 14, pays: [0, 0, 0], kind: "bonus", reels: [0, 2, 4] }
      ],
      freeSpins: { awards: [10, 15, 25], multiplier: 1, sticky: true,
                   name: "Sticky Wild Free Spins", text: "Every 🌟 that lands stays put until the free spins end." },
      bonus: { type: "pick", name: "Harvest Pick", prizes: [1, 1, 2, 2, 3, 5, 5, 10, 15], collect: 3,
               text: "Pick baskets to collect prizes until you find a 🐛 worm." },
      payScale: 1.039426,   // faucet boost: RTP 100.01% (see tools/simulate.js)
      stats: { rtp: 1.0001, hit: 0.341, featureEvery: 75, bonusEvery: 202, spins: "1 billion" }
    },

    "deep-sea": {
      name: "Deep Sea Treasure",
      tagline: "Dive for pearls, sharks and sunken diamonds.",
      volatility: "Medium",
      theme: "deepsea",
      feature: "expand",
      featureName: "Expanding Trident",
      featureText: "A 🔱 that lands grows to fill its whole reel.",
      symbols: [
        { emoji: "🐚", name: "Shell",   weight: 52, pays: [0.4, 1, 4] },
        { emoji: "🐠", name: "Fish",    weight: 46, pays: [0.4, 1.2, 5] },
        { emoji: "🐙", name: "Octopus", weight: 40, pays: [0.5, 2, 8] },
        { emoji: "🦀", name: "Crab",    weight: 32, pays: [1, 3, 15] },
        { emoji: "🦈", name: "Shark",   weight: 22, pays: [2, 6, 30] },
        { emoji: "🐳", name: "Whale",   weight: 14,  pays: [3, 15, 80] },
        { emoji: "🔱", name: "Trident", weight: 3,  pays: [8, 40, 300], kind: "wild" },
        { emoji: "💎", name: "Sunken Diamond", weight: 8, pays: [2, 10, 100], kind: "scatter" },
        { emoji: "🧭", name: "Captain's Compass", weight: 10, pays: [0, 0, 0], kind: "bonus", reels: [0, 2, 4] }
      ],
      freeSpins: { awards: [8, 12, 20], progressive: { start: 1, step: 1, max: 10 },
                   name: "Rising Tide Free Spins", text: "Wins start at ×1 and the multiplier rises by 1 after every winning free spin (up to ×10)." },
      bonus: { type: "wheel", name: "Ship's Wheel",
               segments: [5, 10, 8, 15, 5, 20, 10, 50, 8, 12, 5, 25, 10, 15, 5, 100],
               text: "Spin the ship's wheel for a prize of up to 100× your bet." },
      payScale: 1.043096,   // faucet boost: RTP 100.01% (see tools/simulate.js)
      stats: { rtp: 1.0001, hit: 0.320, featureEvery: 66, bonusEvery: 431, spins: "1 billion" }
    },

    "cosmic-voyage": {
      name: "Cosmic Voyage",
      tagline: "Rare hits, astronomical jackpots.",
      volatility: "High",
      theme: "cosmic",
      feature: "multwild",
      featureName: "Multiplier Wilds",
      featureText: "Every 🛸 carries ×2, ×3 or ×5. Wilds on a winning line multiply together, up to ×25.",
      symbols: [
        { emoji: "🌙", name: "Moon",    weight: 20, pays: [0.3, 1, 3] },
        { emoji: "⭐", name: "Star",    weight: 19, pays: [0.4, 1, 4] },
        { emoji: "🌍", name: "Earth",   weight: 18, pays: [0.5, 2, 8] },
        { emoji: "🪐", name: "Planet",  weight: 16, pays: [1, 3, 12] },
        { emoji: "☄️", name: "Comet",   weight: 13, pays: [1.5, 6, 25] },
        { emoji: "👽", name: "Alien",   weight: 9,  pays: [3, 12, 60] },
        { emoji: "🚀", name: "Rocket",  weight: 5,  pays: [6, 30, 200] },
        { emoji: "🛸", name: "Mothership", weight: 2, pays: [15, 100, 1000], kind: "wild" },
        { emoji: "🌌", name: "Galaxy",  weight: 3,  pays: [3, 12, 120], kind: "scatter" },
        { emoji: "🛰️", name: "Satellite", weight: 4, pays: [0, 0, 0], kind: "bonus", reels: [0, 2, 4] }
      ],
      wildMult: { values: [2, 3, 5], weights: [8, 3, 1], cap: 25 },
      freeSpins: { awards: [8, 12, 20], multiplier: 3,
                   name: "Hyperspace Free Spins", text: "Every win in hyperspace pays ×3, on top of the 🛸 multipliers." },
      bonus: { type: "ladder", name: "Warp Ladder", levels: [3, 6, 12, 25, 50, 100, 250, 1000], advance: 0.6,
               text: "Ride the warp ladder. Every boost climbs a level until the engines cut out. The top pays 1,000×." },
      payScale: 1.038924,   // faucet boost: RTP 100.01% (see tools/simulate.js)
      stats: { rtp: 1.0001, hit: 0.247, featureEvery: 130, bonusEvery: 783, spins: "3 billion" }
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = GAMES;
  else root.TNC_GAMES = GAMES;
})(typeof window !== "undefined" ? window : this);
