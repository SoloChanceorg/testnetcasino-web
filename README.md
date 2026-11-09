# TestnetCasino.com

A Bitcoin Cash **Testnet4** faucet as a set of slot machines. A project from [SoloChance.org](https://solochance.org).

> **Not a real casino.** No real money of any kind is involved. No Bitcoin, Bitcoin Cash or any other real
> mainnet crypto is involved. There is no deposit process of any kind, not even for Testnet4 coins.
> You can only play, win and withdraw Testnet4 coins.

## Status

A static frontend (this repo, GitHub Pages) for the backend [testnetcasino-service](https://api.testnetcasino.com), which runs every
game, balance and account. There is no demo or guest mode: playing requires signing in.

- Balance: kept on the server per account and shared by all games. New accounts get a **10,000 sat** sign-up bonus, plus a
  **1,000 sat** daily bonus (resets at 00:00 UTC).
- Bets: **1 to 1,000 sats** per spin. Every game has an RTP of **110%** with everything included (it is a faucet, so it pays
  back more than it takes): the reels, free spins and bonus games 96%, the collector's reward 4%, the jackpots 10%.
- Jackpots: a Minor and a Major per game and a shared Grand, won inside the game (backend decision D43).
- Collectors: a shared fill meter per game; the spin that fills it plays a reward.
- Withdrawals go to any Testnet4 address the player enters.

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
| Jackpots (Minor / Major / Grand) | 🍎 **Golden Apples**: 3 / 4 / 5 on the reels | 🦪 **Magic Oyster**: open clams until 3 match | 🌠 3 shooting stars spin the **Star Map Wheel** |
| Collector · reward | 🍃 **Apple Tree** (186) · **Harvest Festival**: 10 sticky-wild free spins, wins ×2 | 🪙 **Treasure Chest** (109) · **Treasure Hold & Win**: 6 pearls, respins reset on every new pearl | ⛽ **Fuel Tank** (940) · **Hyperdrive**: 7 free spins, a wild locked in the middle, ×1 rising to ×10 |
| RTP · hit rate | 110% in all · 34% | 110% in all · 32% | 110% in all · 25% |
| Free spins · bonus | 1 in 75 · 1 in 202 | 1 in 66 · 1 in 431 | 1 in 130 · 1 in 783 |
| Volatility | Low | Medium | High |

Every spin is played on the server (testnetcasino-service), which is the source of truth for the game math: `GET /games/{id}/config`
returns the symbols, paytables, features and stats, and the algorithm is described in its `docs/FAIRNESS.md` (provably fair:
HMAC-SHA256 of a committed server seed, your client seed and a nonce). Every game's RTP is 110% with everything included
(`rtp` and `rtpParts` in the config; game config version 4).

## Look & feel

"Vegas Casino" site chrome shared with the SoloChance.org casino edition: green felt, Bungee and Poppins (Google Fonts), gold and red, a marquee sign with chasing bulbs.
Each game page drops you into its own world and has **its own machine**, and its card in the lobby is a small version of it
(Fruit Orchard: wooden crate, striped awning with string lights, tilted sign, price-tag Play; Deep Sea: riveted hull, brass
nameplate, porthole reels, brass Play; Cosmic Voyage: cut-corner neon panel, holographic title, neon Play):

| | Cabinet | Display | Spin | Bet |
|---|---|---|---|---|
| 🍒 Fruit Orchard | Wooden fruit-stand crate, striped awning with string lights, hanging sign | Chalkboard | Pull **lever** | Price tags (1/10/100/500/MAX), crate − / +, chalk field to type any amount |
| 🐚 Deep Sea | Riveted brass submarine hull, porthole reel window, brass nameplate | Sonar screen | Brass **DIVE** button | Rotary **dial** (drag, scroll, ◀ ▶ or arrow keys; tap a number), amount field in the knob |
| 🌙 Cosmic Voyage | PixiJS starship cockpit: neon cabinet, a console sloping toward the player (see PixiJS machine) | Neon display | Raised hexagonal **LAUNCH** key | **Thrust** lever in a slot, ▲ ▼ keys |

− / + and the dial and throttle move along the bet ladder 1, 2, 5, 10, 20, 50, 100, 200, 500, 1,000. Any whole amount from 1 to 1,000 can be typed. Space spins on every machine.
The reels stop one by one, left to right (about 3 s per spin). While they turn, the spin control reads STOP: pressing it or Space
lands the remaining reels at once. That is display only: the result is already fixed by the server. After a win the machine
waits for the win animations to finish, plus half a second, before the next spin can start.
Big wins get BIG / MEGA / JACKPOT banners, a coin shower, themed confetti and synthesized sounds (a different pack per game).
Each machine has a full-screen button next to its sound button: the site header, nav and paytable are hidden and the machine is scaled
to fit the screen (Esc or the button exits). It is hidden in browsers without the Fullscreen API, such as Safari on iPhone.
The BCH Testnet4 coin (`assets/img/bch-testnet4.svg`) drifts through every venue's animated background, rains down in the win coin
showers and marks tBCH in the UI (balance chip, wallet sign-in, Withdraw step, lobby and sign-in tab icon).
Respects `prefers-reduced-motion` and works down to 360px wide.

## Live faucet stats

Every page has a bar at the top with live totals from `GET /faucet` (public): what is left in the faucet (`house`) and
the sum of player balances, plus player counts (all time, last 30 days, last 24 hours, with a
balance). The server recomputes them at most every 5 minutes; the bar re-reads them every
minute while the tab is visible and says so when the server marks them `stale`. The faucet is rounded to 2 decimals (hover for the exact value); player balances show all 8 decimals.

## Units

The API works in sats (1 tBCH = 100,000,000 sats). The site shows every amount in **tBCH** (`assets/js/units.js`): the faucet
bar, the nav balance, the daily bonus, the account page and the fairness page. Inside a game machine the credit (balance, wins,
win breakdown, recent spins) is shown in **tSats** by default, with a tSats / tBCH switch under the machine; the choice is
remembered in `localStorage` (display preference only). Bets are always whole tSats (1 to 1,000).

## Returning coins

The lobby and every game page end with a "Return to the house" panel asking players to send their Testnet4 coins back once they have
had enough fun, so the faucet keeps running. The house address is shown as code with a Copy button:
`bchtest:qphp0rfnp6uyjfh5p235r8lwykv6knknfqqw5ghdxy`

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
that was playing resumes on the first tap or key press. Media keys and the OS media controls (Media Session API) work too. The music keeps playing while the window is minimized or another tab is in front (the scheduler plans about 1.6 s ahead while hidden, since browsers throttle background timers).
Recipes live in `PLAYLISTS` in `assets/js/music.js` (the section plan is `FORM`). Add a song by adding a recipe.

## How the site talks to the API

The contract is `docs/API.md` in testnetcasino-service. `assets/js/api.js` is the only file that knows endpoint paths.

- Base URL: `TNC_CONFIG.apiBase` in `assets/js/config.js` (`https://api.testnetcasino.com`).
- Every call uses `fetch` with `credentials: "include"`; every call except the public ones (`/faucet`, `/games/{id}/config`) sends
  `X-Requested-With: tnc`, which the server requires on every POST (CSRF). The session is the HttpOnly cookie `__Host-session`: the
  frontend never stores a token or user data.
- Every method resolves to `{ status, data }` and never throws (status 0 = network error or 20 s timeout). Errors are
  `{ error, message }`: the page branches on `error` and shows `message` (`TNC_API.errorText`).
- CORS allows `https://testnetcasino.com` (plus localhost when the backend runs with the `dev` profile). Passkeys only work on
  `https://testnetcasino.com` (rp id).

## Playing a game

`assets/js/slot.js` holds no game math. On load it reads `GET /games/{id}/config` (symbols, paytable, features, paylines, stats)
and builds the machine and the paytable from it. A spin sends `POST /spins { gameId, bet, requestId }` with a new
`crypto.randomUUID()`; a network error, timeout or 5xx is retried with the same `requestId`, so a spin is never played twice.
The reels start turning at once and land one by one on the server's result (a stop request only shortens the wait). The response's `steps[]` are then animated in order:
`spin` (one or more phases: Lucky Respin, expanded reels, multiplier wilds, sticky wilds in free spins), `freeSpinsStart`,
`retrigger`, `bonus` (pick / wheel / ladder, with the result already fixed), `freeSpinsEnd`, and from version 4 `jackpot`,
`collect`, `rewardStart` and `holdAndWin` (see Jackpots and Collectors below). Every win is shown in sats
exactly as the server sent it, and the balance is set to the response's `balance` at the end.

Signed-out visitors see the machine with a "Sign in to play" button. Errors show the server's message
(`insufficient_funds`, `invalid_bet`, `rate_limited`, ...); a 401 means the session ended and shows the sign-in button.

## Jackpots

The jackpots (backend decision D43, game config version 4) are part of every game's 110% RTP: every bet adds 4% of itself
to its game's **Minor**, 3% to its **Major** and 3% to the **Grand** shared by all three. They are won **inside the game**:
after the free spins, a paid spin with bet `b` draws Grand, Major and Minor (each a hit with chance `b / oneInSats`, from the
spin's own stream) and wins the highest tier hit, everything its meter holds. After a win the next cycle starts with a head
start from the house (25% to 75% of a hidden target), so a jackpot never shows 0. Names, emojis and texts come from the
config's `jackpot` block.

`assets/js/jackpots.js` reads `GET /jackpots` (public) when the page opens and every 12 s while the tab is visible. It only
ever shows what the server sent:

- **GRAND, MAJOR and MINOR are prize amounts** (`amount`), like real progressive displays: every
  `[data-jackpot="grand" | "major:<id>" | "minor:<id>"]` counts up smoothly to each new reading. `data-jackpot-units="bch8"`
  is tBCH with 8 decimals (lobby, jackpots page); `"game"` follows the machine's tSats / tBCH switch.
- When a `cycle` goes up between two readings, someone won it: the amount flashes "WON!" and then shows the new, smaller one.
- The target ranges are never shown (a surprise). Only a win's Verify details show its range, because the check needs it.
- GRAND has one global red-neon style; MAJOR and MINOR wear each machine's theme (styles keyed on `.theme-*`, which sits on
  `<body>` in the games and on each lobby card).

A jackpot won in a spin is a step `{ type: "jackpot", tier, cells, picks?, slice?, win }`. `cells` are `[reel, row]` on the
paid spin's **first grid**; the game draws its jackpot symbols there, over the symbols (they still pay as shown; if respins
or free spins came in between, the first grid is put back first):

- 🍒 **Fruit Orchard**: 3, 4 or 5 golden 🍎 on those cells: MINOR, MAJOR or GRAND.
- 🐚 **Deep Sea**: one 🦪 Magic Oyster, then a clam pick on the bonus stage: 7 clams, opened by the player (or Auto, or by
  themselves after 12 s), revealing `picks` in order; the last is the third of the won tier. The clams left closed show the
  other tiers, at most two of each, so only the won tier ever shows three.
- 🚀 **Cosmic Voyage**: three 🌠, then the Star Map Wheel (`jackpot.slices`) spins and stops on `slice`.

Then the celebration with the amount in tBCH (`win`; `jackpotWin` and `balance` include it): the Minor big, the Major bigger,
the Grand the biggest, and a line in Recent spins. A response with `"jackpots": false` had its jackpot draws skipped.

While a spin plays the displays are held (`TNC_Jackpots.hold()`), so a poll can never give a win away before the reels stop;
when the spin has played out they are read at once (`release()`).

Where they are:

- **Games**: at the very top of the machine, also in full screen: GRAND (the most prominent), then MAJOR and MINOR side by
  side (stacked on phones). The rules section explains the jackpots and the collector from the config.
- **Lobby**: the Grand amount at the top of the casino floor (with a link to the jackpots page), and each machine's Major
  amount at the top of its card.
- **Jackpots page** (`jackpots.html`): every jackpot and collector now, the rules in short, the seed hash of every running
  jackpot ("Seed hashes now"), and the latest 20 wins from `recentWins` (time, tier and game, player, amount in tBCH and
  tSats). Wins with a `seed` have a **Verify** button: in the browser, SHA-256(seed) must equal `seedHash`, the seed must
  give the same `target` and `startSats`, and the amount must be at least the head start. Older wins (D40, D41, with a
  `displayScale`) are checked by their own rules (display scale, the old head start, amount at least the target). Wins from
  the first pools (no `seed`) show "Old jackpot" and no Verify. The API has no full history of jackpot wins.

## Collectors

Every game has a collector (config `collector`), a fill meter **shared by all players**: 🍃 the Apple Tree (186 leaves), 🪙 the
Treasure Chest (109 coins), ⛽ the Fuel Tank (940 fuel cells). Every paid spin shows 0 to 3 collect symbols: the step
`{ type: "collect", cells, filled, size, full, bet? }` after the jackpot. The game draws them on those first-grid cells (never
on a jackpot cell) and flies them into the meter. `GET /jackpots` gives every game's `collector { filled, size, cycle }`.

- **Games**: the collector has its own screen right of the reels, about 1.5 reels wide (`.reel-bay` grid, 5 : 1.45), under
  the reels as a strip on phones (600 px and less), with "filled / size". The Apple Tree's crown and the Treasure Chest fill
  with leaves and coins: a pile of 15 spots (a pyramid of rows 5, 4, 3, 2, 1, or on phones 8 + 7), `floor(filled / size of
  15)` shown, so it is complete only when full. The Fuel Tank fills like a tank. When someone else fills it (its `cycle`
  goes up) it says "FULL!" and starts again empty.
- **Full** (`full: true`): the meter glows "FULL!", a banner announces the reward, and the reward is played at `bet` (the
  spin's bet capped at the cycle's average): 🍒 **Harvest Festival** and 🚀 **Hyperdrive** start with
  `{ type: "rewardStart", bet, spins }`, then free spins (`spin` steps, the Hyperdrive with a wild locked at reel 3, row 2
  and the multiplier rising every spin) and a `freeSpinsEnd`; 🐚 **Treasure Hold & Win** is one `holdAndWin` step
  (`start` pearls, `respins[]`, `prize`, `win`), shown on a 5 × 3 board with each pearl's value × bet, the respins counter
  (back to 3 whenever a pearl lands) and the total. Then the meter starts again empty. `totalWin` includes the reward.
- **Jackpots page**: each game's collector as a bar with "filled / size".

## PixiJS machine

Cosmic Voyage plays on a machine drawn entirely with **PixiJS 8** (`assets/vendor/pixi-8.22.0.min.js`, MIT, kept in the repo
so the site does not depend on a CDN; about 240 KB gzipped, loaded only on that page). Its HTML machine was removed. Fruit
Orchard and Deep Sea still use the HTML machines in `slot.js` until they are ported, then those go too. `slot.js` picks the
machine by theme (`PIXI_THEMES`); if PixiJS cannot start (no WebGL), the page says so with a "Try again" button.

- One canvas holds the whole machine: GRAND / MAJOR / MINOR, the cabinet and title, the reels (motion blur, landing with a
  bounce), the Fuel Tank (waving fuel), the display, win lines, banners, coin and emoji particles, the Warp Ladder and the
  Star Map Wheel. Static art is painted with Canvas 2D into textures (gradients, glows) and moved by PixiJS.
- **The cockpit console** (WIN, BALANCE, LAUNCH, THRUST) is drawn flat into a render texture every frame and shown on a
  `PerspectiveMesh`, so it slopes toward the player: narrower at the back, a slab edge in front. LAUNCH is a hexagonal key
  standing up from it (side walls, glowing socket) that sinks when pressed; WIN and BALANCE are recessed screens; the bet
  lever runs in a sunken slot with raised ▲ ▼ keys. Taps are mapped back to the flat deck through the inverse homography.
- The same steps as the HTML machines, from the same server responses (free spins, the bonus, a jackpot won in the game, fuel
  cells into the tank, the Hyperdrive reward). Space spins and stops the reels; there is no typed bet.
- The canvas sits in a CSS 3D stage, so the **whole machine tilts** on a MINOR (stronger on a MAJOR, rocking on a GRAND), a
  bit on MEGA and TOP PRIZE wins, and when the tank fills; the canvas also shakes. Shorter with reduced motion.
- Full screen: the button in the cabinet's top-right corner; the canvas grows to fill the screen.
- Outside the canvas, in HTML: the unit switch, sound, the paytable and rules (`TNC_Slot.paytableSection`, shared with the
  HTML machines) and Recent spins. Screen readers get the display text through a live region.
- `window.TNC_PixiState()` reports what the machine shows (for the smoke test). `TNC_Jackpots.onRender(fn)` gives non-HTML
  displays every jackpot reading.

## Account and withdrawals

`account.html` (`assets/js/account.js`), reached from the account pill in the nav:

- **Withdraw**: `POST /withdrawals { amount, address }`, 1,000 to 10,000,000 sats per withdrawal, at most 100,000,000 sats (1 tBCH) per
  player in 24 hours and 10 tBCH a day for the whole faucet. `address` is any Testnet4 address the player types or pastes
  (no signature, no waiting period). Wallet accounts get their sign-in address prefilled and may leave it empty; passkey
  accounts must enter one (prefilled with a saved default if `GET /me` has `user.withdrawalAddress`). `cashaddr.js` rejects
  obvious non-Testnet4 input early, but the server's answer counts: `invalid_address`, `address_required`, the amount and
  daily-limit errors and `withdrawals_paused` show the server's message.
- **Withdrawals**: `GET /withdrawals`, with each txid linked to the Testnet4 explorer `https://bchexplorer.cash/testnet4/tx/<txid>`. The list
  re-reads itself every 15 s while a withdrawal is pending.
- **Balance history**: `GET /ledger?cursor=`, 50 per page with "Load more".

## Withdrawals page

`withdrawals.html` (`assets/js/withdrawals.js`) lists every withdrawal the faucet has sent (`GET /faucet/withdrawals?cursor=`, public).
When the page opens it follows every page (`nextCursor`) and then shows the whole list at once, with the total withdrawn (tBCH,
sats on hover) and the number of withdrawals on top. Each row: time in the visitor's time zone, the full address (shortened on
narrow screens, with the full one in the tooltip and a copy button), the amount in tBCH (sats on hover) and the txid linked to
the explorer in a new tab. No polling. The explorer URL is `TNC_CONFIG.explorerTx` in `assets/js/config.js`.

## Leaderboards

`leaderboards.html` (`assets/js/leaderboards.js`): seven boards from `GET /leaderboards` (top balances, biggest winners over 24
hours, 30 days and all time, top withdrawals over 24 hours, 30 days and all time), up to 1,000 players each. The response (up to ~500 KB)
is fetched once per page view, with the session cookie, and again only when the player signs in or out; the server refreshes it
every 5 minutes. Rows render 50 at a time (more on scroll or "Show more"). The signed-in player's row is found only by
`me: true` (labels can collide), highlighted with a "You" badge and `aria-current`, and a "Jump to my position (#n)" button
shows while that row is out of view (IntersectionObserver). Amounts are tBCH, with the sats in the tooltip.

## Provably fair

`fairness.html` (`assets/js/fairness.js`):

- **Your seeds**: server seed hash, client seed and next nonce (`GET /fairness/seed`). Set a client seed
  (`POST /fairness/client-seed`) or reveal the server seed (`POST /fairness/rotate`); the page checks the revealed seed against the
  hash it showed before.
- **Your spins**: `GET /spins?cursor=`. Once a spin's seed is revealed it can be verified, one by one or all at once.
- **Verify any spin**: replays a spin from server seed, client seed, nonce, game, game version and bet. Nothing is sent to the server.
- **Jackpots**: the jackpots explained in plain words, and a checker: paste a seed, pick the tier and type the range from the
  win's Verify details (no presets, so the ranges are not given away) to get
  its seed hash, target, display scale and head start; with the published hash and the amount it also passes or fails the win.

Game versions: the API serves only the current config (version 3). Versions 1 and 3 have the same rules; version 2
(2026-11-08 to 2026-11-09) adds the two old jackpot draws at the end of the spin's random stream (the game's Major, then the
Grand; a hit when `randInt(oneInSats) < bet`, with `oneInSats` 730,000 and 9,300,000 for every game). `TNC_Fair.configFor()`
rebuilds a version from the current config, so every spin ever played can still be replayed; for version 2 the page also
checks that a jackpot was paid exactly when the replay hits one. From version 3 the jackpots draw nothing from the spin.

`assets/js/fairness-engine.js` is an independent implementation of the backend's `docs/FAIRNESS.md`: HMAC-SHA256 stream with
`crypto.subtle`, rejection sampling, the slot rules, exact `BigInt` win arithmetic, the game versions and the jackpot derivation
(`meter()`, `verifyMeterWin()`, FAIRNESS.md section 8: target, display scale, head start). It decides nothing; it only checks.
It must reproduce every backend test vector:

```sh
node tools/verify-vectors.mjs   # reads ../testnetcasino-service/docs/fairness-test-vectors.json; prints 79/79 (streams, version 2 and 3 spins, meters)
```

## Sign-in, account and daily bonus

Sign-in lives on `login.html`: a **Testnet4 wallet** (address plus a signed message) or a **passkey** (WebAuthn). There are no
passwords, no email and no social logins.

- `assets/js/cashaddr.js` validates addresses (CashAddr checksum) before calling the server. Only `bchtest:q...` (P2PKH) can sign in.
  Mainnet, script (`p`), token-aware (`z`) and legacy addresses get a specific message.
- `assets/js/auth.js` reads `GET /me` (`{ user, balance, dailyBonus }`, 401 = signed out) on every page and renders the nav: the
  balance, the daily bonus pill, the account and "Sign out". It refreshes when the tab becomes visible again.
- Daily bonus: "Claim 1,000 sats" (`POST /bonus/daily`) when available, otherwise a countdown to `nextClaimAt`. It is in the nav on
  every page and in a card on the lobby. `409 daily_bonus_claimed` just switches to the countdown.
- `?next=` sends you back after sign-in (same-origin paths only).

## Terms and Privacy

`legal/terms-of-service.pdf` and `legal/privacy-policy.pdf` are linked from every footer and from the sign-in page ("By
signing in you accept the Terms of Service..."). Their text lives in `tools/legal/build_legal.py`: edit it there, bump
`EFFECTIVE`, and rebuild with Python 3.10+ and reportlab (`python tools/legal/build_legal.py`).

## Structure

```
index.html            Landing page (lobby)
login.html            Sign-in: Testnet4 wallet or passkey (CSP-protected)
account.html          Balance, withdrawals, withdrawal address, balance history (CSP-protected)
fairness.html         Seeds, spin history and the in-browser verifier (CSP-protected)
leaderboards.html     Seven leaderboards (CSP-protected)
jackpots.html         The jackpots now, their seed hashes and the latest 20 wins with Verify (CSP-protected)
withdrawals.html      Every withdrawal the faucet has sent, with the total (CSP-protected)
legal/*.pdf           Terms of Service and Privacy Policy (built by tools/legal/build_legal.py)
games/*.html          One page per game (body[data-game] selects the config)
assets/css/style.css  "Vegas Casino" theme + per-game cabinet skins (.theme-orchard / -deepsea / -cosmic)
assets/js/slot.js     UI: loads the game config, sends POST /spins and animates the returned steps
assets/js/audio.js    Synthesized sound packs per game (Web Audio API, no audio files), mute saved per browser
assets/js/fx.js       Marquee bulbs, themed animated backgrounds per game, coin shower + themed confetti
assets/img/bch-testnet4.svg  BCH Testnet4 coin icon
assets/js/faucet.js   Live faucet totals bar (GET /faucet)
assets/js/units.js    Amount formatting: tBCH everywhere, tSats / tBCH switch inside the games
assets/js/jackpots.js Jackpot amounts, Minor coin pots and the latest wins (GET /jackpots, lobby, games, jackpots page)
assets/js/copy.js     Copy buttons ([data-copy]); used for the house return address
assets/js/music.js    Jukebox: procedural music engine, playlists per venue, player UI
assets/js/config.js   apiBase
assets/js/api.js      API client: the only place with endpoint paths
assets/js/cashaddr.js CashAddr decode + checksum validation
assets/js/auth.js     Session helper (nav, balance, daily bonus) + sign-in page logic
assets/js/account.js  Account page
assets/js/fairness.js Fairness page
assets/js/leaderboards.js  Leaderboards page
assets/js/withdrawals.js  Withdrawals page (every withdrawal the faucet has sent)
assets/js/fairness-engine.js  Provably fair verifier (browser + Node, no DOM)
tools/verify-vectors.mjs      Checks the verifier against the backend test vectors
tools/site.mjs                Shared header, nav and footer for every page; ?v= version tag
tools/check/smoke.mjs         Smoke tests: every page in headless Chrome against a fake API
.nojekyll             Serve files as-is on GitHub Pages
```

## Hosting: GitHub Pages

Every local script and stylesheet link carries a version tag (`?v=20261110a`). GitHub Pages lets browsers cache files for about
10 minutes, so bump the tag on each release (`node tools/site.mjs version`); otherwise a new page can run with an old cached script.

## Development tools

Node 22+ only, no dependencies; the site itself still has no build step.

- `node tools/site.mjs build` writes the shared blocks into every page from one template: the warning strip, the faucet bar,
  the small header, the nav and the footer. In the pages they sit between markers such as `<!-- site:nav -->` and
  `<!-- /site:nav -->`; edit the templates in `tools/site.mjs`, never the copies. `check` reports pages that are out of date.
- `node tools/site.mjs version` bumps the `?v=` tag (date + letter, never backwards) in every page and this README.
- `node tools/check/smoke.mjs` runs every page in headless Chrome against a fake API (fixtures in `tools/check/fixtures`:
  real game configs and real spin results from the backend's test vectors) and checks: shared blocks in sync, every local
  link resolves, every page loads without errors or sideways scroll, a spin in each game, the full-screen fit, reels stopping one by one and the STOP press, the jackpots (machine rows and the unit switch, jackpots won by someone
  else, a jackpot spin with Minor and Major wins and no spoiler, lobby, jackpots page with Verify), the
  withdrawals total, the leaderboards jump, the account withdraw lock, the fairness verifier (version 3 and 2 spins) and the
  jackpot checker. Exit code 0 = all passed. `fixtures/meters.json` holds the backend's jackpot vectors.
  Refresh the fixtures when the game config version changes.
- `node tools/verify-vectors.mjs` checks the fairness verifier against all backend test vectors.

This is a plain static site with no build step and relative URLs only, so it works from the repository root on GitHub Pages
(Settings → Pages → Deploy from branch → `main` / root). For the `TestnetCasino.com` custom domain, add a `CNAME` file
containing `testnetcasino.com` and configure DNS.

Run it locally:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```
