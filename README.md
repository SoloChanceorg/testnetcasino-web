# TestnetCasino.com

A Bitcoin Cash **Testnet4** faucet as a set of slot machines. A project from [SoloChance.org](https://solochance.org).

> **Not a real casino.** No real money of any kind is involved. No Bitcoin, Bitcoin Cash or any other real
> mainnet crypto is involved. There is no deposit process of any kind, not even for Testnet4 coins.
> You can only play, win and withdraw Testnet4 coins.

## Status

Frontend only, in demo mode. The backoffice and backend (accounts, server-side spins, Testnet4 withdrawals) are not built yet.

- Demo balance: **10,000 sats**, kept in the browser (`localStorage`) and shared by all games. It can be reset at any time.
- Bets: **1 to 1,000 sats** per spin.

## Games

All games are 5 reels × 3 rows with 10 fixed paylines. The bet is the total for all lines (1–1,000 sats) and every pay is a multiple of it.

Every machine has:
- **Line wins**: 3, 4 or 5 matching symbols from the leftmost reel on any payline. Every winning line pays and the wins add up.
- **Wild**: stands in for regular symbols. A line of wilds pays the top prize.
- **Scatter**: 3+ anywhere pays and awards free spins (retriggerable, capped at 100 per feature).
- **Bonus symbol**: on reels 1, 3 and 5 at the same time it starts the game's bonus round.
- **A unique feature, its own free-spin twist and its own bonus game:**

| | 🍒 Fruit Orchard | 🐚 Deep Sea Treasure | 🌙 Cosmic Voyage |
|---|---|---|---|
| Unique feature | 🌟 **Lucky Respin**: new wilds stick, other cells respin (up to 3×), each respin pays | 🔱 **Expanding Trident**: wild fills its reel | 🛸 **Multiplier Wilds**: ×2/×3/×5, multiply on a line (max ×25) |
| Free spins (🍀/💎/🌌) | 10/15/25, **sticky wilds** for the whole feature | 8/12/20, **Rising Tide** ×1 → +1 per winning spin (max ×10) | 8/12/20, **Hyperspace** all wins ×3 |
| Bonus game (🧺/🧭/🛰️) | **Harvest Pick**: pick baskets until a 🐛 | **Ship's Wheel**: 16 segments, 5×–100× | **Warp Ladder**: 8 levels 3×–1,000×, 60% per boost |
| Sound | Marimba, plucks, birdsong | Bubbles, sonar, whale calls | Synth arps, lasers, space drone |
| World | Sunlit orchard, leaves and butterflies | Ocean depths, light shafts, bubbles, fish | Starfield, nebulae, shooting stars |
| RTP · hit rate | 96.4% · 34% | 95.6% · 32% | 95.9% · 25% |
| Free spins · bonus | 1 in 76 · 1 in 202 | 1 in 66 · 1 in 432 | 1 in 129 · 1 in 787 |
| Volatility | Low | Medium | High |

Symbols, weights, paytables, features and bonus settings are in `assets/js/games.js`. The rules (including every feature and the bonus games) are in `assets/js/engine.js`.
RTP figures come from the Monte Carlo simulator, which runs the same engine code:

```sh
node tools/simulate.js 10000000 fruit-orchard   # or deep-sea / cosmic-voyage; omit for all
```

Re-run it after changing any game math and paste the printed `stats` into `games.js`. Use 10M spins: the high-volatility games need that many for a stable RTP.

## Look & feel

"Vegas Casino" site chrome shared with the SoloChance.org casino edition: green felt, Bungee and Poppins (Google Fonts), gold and red, a marquee sign with chasing bulbs.
Each game page drops you into its own world and has **its own machine**:

| | Cabinet | Display | Spin | Bet |
|---|---|---|---|---|
| 🍒 Fruit Orchard | Wooden fruit-stand crate, striped awning with string lights, hanging sign | Chalkboard | Pull **lever** | Price tags (1/10/100/500/MAX), crate − / +, chalk field to type any amount |
| 🐚 Deep Sea | Riveted brass submarine hull, porthole reel window, brass nameplate | Sonar screen | Brass **DIVE** button | Rotary **dial** (drag, scroll, ◀ ▶ or arrow keys; tap a number), amount field in the knob |
| 🌙 Cosmic Voyage | Angled starship cockpit, neon trim, HUD corners | Holographic HUD | Hexagonal **LAUNCH** button | **Throttle** slider (vertical on desktop, horizontal on phones), ▲ ▼, amount field |

− / + and the dial and throttle move along the bet ladder 1, 2, 5, 10, 20, 50, 100, 200, 500, 1,000. Any whole amount from 1 to 1,000 can be typed. Space spins on every machine.
Big wins get BIG / MEGA / JACKPOT banners, a coin shower, themed confetti and synthesized sounds (a different pack per game).
Respects `prefers-reduced-motion` and works down to 360px wide.

## Jukebox

Every page has a jukebox (bottom-right on wide screens, top-right corner on phones, collapses to a 🎵 button) with play/pause, previous, next, volume and a
live spectrum display. The music is **composed live in the browser** with the Web Audio API, so there are no audio files. Each song is a recipe (tempo, meter,
chord progressions, drum groove, bass, comping, lead and a backing band), and a look-ahead step sequencer plays it.

Each song is a 40-bar arrangement that loops (about 1 to 2 minutes):

| Section | Bars | What plays |
|---|---|---|
| Intro | 4 | Light drums, bass, comping, pad, ostinato |
| A1 | 8 | Full drums, bass, comping, lead melody |
| A2 | 8 | Lead with a harmony voice a third below, counter-line, ostinato |
| Bridge | 8 | New chords and melody on a second lead instrument, pad, counter-line |
| A3 | 8 | Everything at once |
| Outro | 4 | Lead ends on the tonic, then the song starts over |

Drum fills mark the last beat of each section and a crash opens the next one (not in the ambient songs). Melodies come from a fixed seed, so a song always
sounds the same. The current song repeats until you press next or previous.

| Venue | Jukebox | Songs |
|---|---|---|
| 🎰 Lobby | Classic arched jukebox, rainbow neon | Velvet Lounge (lounge swing) · Neon Strip (disco funk) · High Roller Bossa (bossa nova) |
| 🍒 Fruit Orchard | Wooden country radio | Morning Harvest (country shuffle) · Cider Barn Hoedown · Sunset Picnic Waltz (marimba) |
| 🐚 Deep Sea | Brass ship's gramophone | Abyssal Drift (deep ambient) · Coral Reef Calypso (steel drums) · Sunken Galleon Shanty |
| 🌙 Cosmic Voyage | Holographic console | Hyperdrive (synthwave) · Nebula Dreams (space ambient) · Starport 8-bit (chiptune) |

On/off and volume are remembered across pages, and the current song is remembered per venue. Browsers only allow sound after a user action, so a jukebox
that was playing resumes on the first tap or key press. Media keys and the OS media controls (Media Session API) work too.
Recipes live in `PLAYLISTS` in `assets/js/music.js` (the section plan is `FORM`). Add a song by adding a recipe.

## Auth (mock mode)

Sign-in lives on `login.html` and has two methods: a **Testnet4 wallet** (address plus a signed message) and a **passkey** (WebAuthn).
There are no passwords, no email and no social logins. Guests can still play the demo without signing in.

- `assets/js/config.js`: `window.TNC_CONFIG = { apiBase: "https://api.testnetcasino.com", mock: true }`.
  Set `mock: false` when the Spring Boot backend is live.
- `?mock=1` or `?mock=0` on any page URL overrides the config for testing. The override sticks for the browser tab (sessionStorage),
  and `?mock=default` clears it.
- `assets/js/api.js` is the only file that knows endpoint paths. Real calls use `fetch` with `credentials: "include"` and the header
  `X-Requested-With: tnc`. The session is an HttpOnly cookie set by the backend, and the frontend never stores a token.
- Mock mode answers after 300 to 700 ms and keeps a **fake** session in `sessionStorage` (`tnc.mock.session`). Nothing is sent anywhere.
- `assets/js/cashaddr.js` validates addresses (CashAddr checksum). Only `bchtest:q...` (P2PKH) can sign in. Mainnet, script (`p`),
  token-aware (`z`) and legacy addresses get a specific message.
- `assets/js/auth.js` runs the sign-in page and renders the nav pill on every page from `GET /me` (401 = guest).

Testing in mock mode:
- Use any Testnet4 address, for example `bchtest:qr6m7j9njldwwzlg9v7v53unlr4jkmx6eymt9qmp0k`. The `bchtest:` prefix is optional.
- Any base64 signature of 80+ characters signs you in, and the page has a "Mock: fill a test signature" button.
  **A signature starting with `bad` fails** with `invalid_signature`. Reusing a message gives `challenge_used`, and waiting
  5 minutes gives `challenge_expired`.
- Passkey buttons succeed after a short delay. In mock mode `navigator.credentials` is never called, so no test passkeys end up in
  your password manager.
- `?next=` sends you back after sign-in (same-origin paths only).

## Structure

```
index.html            Landing page (lobby)
login.html            Sign-in: Testnet4 wallet or passkey (CSP-protected)
games/*.html          One page per game (body[data-game] selects the config)
assets/css/style.css  "Vegas Casino" theme + per-game cabinet skins (.theme-orchard / -deepsea / -cosmic)
assets/js/engine.js   Slot rules: grid, paylines, wild/scatter/free-spin evaluation (browser + Node)
assets/js/games.js    Game definitions (symbols, weights, paytables, stats)
assets/js/slot.js     UI: cabinet, reels, win presentation, free spins, demo wallet
assets/js/audio.js    Synthesized sound packs per game (Web Audio API, no audio files), mute saved per browser
assets/js/fx.js       Marquee bulbs, themed animated backgrounds per game, coin shower + themed confetti
assets/js/music.js    Jukebox: procedural music engine, playlists per venue, player UI
assets/js/config.js   apiBase + mock switch (?mock=1 / ?mock=0)
assets/js/api.js      API client: the only place with endpoint paths; mock implementation
assets/js/cashaddr.js CashAddr decode + checksum validation
assets/js/auth.js     Session helper (nav pill on every page) + sign-in page logic
tools/simulate.js     RTP simulator (Node, not used by the site)
.nojekyll             Serve files as-is on GitHub Pages
```

## Hosting: GitHub Pages

This is a plain static site with no build step and relative URLs only, so it works from the repository root on GitHub Pages
(Settings → Pages → Deploy from branch → `main` / root). For the `TestnetCasino.com` custom domain, add a `CNAME` file
containing `testnetcasino.com` and configure DNS.

Run it locally:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

## When the backend arrives

Spin outcomes are generated in the browser (`crypto.getRandomValues`) only because this is a demo.
Real Testnet4 payouts must use server-side results; replace `DemoWallet` and the `Engine.spinGrid` call in `assets/js/slot.js` with API calls (the server can reuse `engine.js` to evaluate).
