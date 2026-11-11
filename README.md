# TestnetCasino.com

A **Testnet4** faucet for Bitcoin (tBTC) and Bitcoin Cash (tBCH) as a set of slot machines and a roulette table. A project from [SoloChance.org](https://solochance.org).

> **Not a real casino.** No real money of any kind is involved. No Bitcoin, Bitcoin Cash or any other real
> mainnet crypto is involved. There is no deposit process of any kind, not even for Testnet4 coins.
> You can only play, win and withdraw Testnet4 coins.

## Status

A static frontend (this repo, GitHub Pages) for the backend [testnetcasino-service](https://api.testnetcasino.com), which runs every
game, balance and account. There is no demo or guest mode: playing requires signing in.

- Two coins (backend decision D46): **tBTC** (Bitcoin Testnet4) and **tBCH** (Bitcoin Cash Testnet4). They never mix: no exchange,
  a balance, bonus, jackpots, leaderboards and withdrawals per coin. See **Coins** below.
- Balance: kept on the server per account and coin, and shared by all games. New accounts get **1,000 tBTC sats** and
  **10,000 tBCH sats**, plus a daily bonus of **100 tBTC sats** and **1,000 tBCH sats** (each claimed on its own; resets at 00:00 UTC).
- Bets: **1 to 100 tBTC sats** or **1 to 1,000 tBCH sats** per spin. Every game has an RTP of **101%** with everything included (it is a faucet, so it pays
  back more than it takes; backend decision D45): the reels, free spins and bonus games 80.74%, the collector's reward
  3.36%, the jackpots' share of every bet 8.4% and the jackpot head starts 8.5%.
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
| RTP · hit rate | 101% in all · 34% | 101% in all · 32% | 101% in all · 25% |
| Free spins · bonus | 1 in 75 · 1 in 202 | 1 in 66 · 1 in 431 | 1 in 130 · 1 in 784 |
| Volatility | Low | Medium | High |

Every spin is played on the server (testnetcasino-service), which is the source of truth for the game math: `GET /games/{id}/config`
returns the symbols, paytables, features and stats, and the algorithm is described in its `docs/FAIRNESS.md` (provably fair:
HMAC-SHA256 of a committed server seed, your client seed and a nonce). Every game's RTP is 101% with everything included
(`rtp` and `rtpParts` in the config: `game`, `collector`, `jackpots`, `headStarts`; game config version 5). The site never
hard-codes these: the paytable reads them from the config, and running text marks them (`data-rtp`, `data-rtp-part`,
`data-jp-share`) so `units.js` fills them in from `GET /games/fruit-orchard/config`.

## Look & feel

The site follows the brand kit ("Bracket Diamond": the mark is two code brackets around a diamond pip, `<♦>`). The kit itself
is kept outside the repo; the files the site uses are copied in:

- **Colours** (CSS variables `--tc-*` at the top of `style.css`, from the kit's `tokens.css`): Felt 900 `#052A19` page,
  Felt 800 cards, Felt 700 borders, Ivory `#F4EEDD` text and primary buttons, Gold `#E9B949` only for the house ("casino",
  jackpots, headline accents; never a button), Diamond red `#E5484D` for the pip and notices, Mint `#3DD9A4` for links,
  success and **tBCH** (its network colour; tBTC will be Orange `#FF8A1F`).
- **Fonts** (Google Fonts): Poppins 500/700 for headings, buttons and the nav; Inter for text; JetBrains Mono for amounts,
  addresses and hashes. The machines and the lobby's game cards keep their own skins and the Bungee sign font, which only the
  lobby and the game pages load.
- **Top of every page** (`tools/site.mjs`): the red warning strip ("NOT A REAL CASINO ♦ …"), the faucet bar on Felt 950, then
  the site header: the horizontal logo (`assets/img/logo-horizontal.svg`), the links and the account chips. Below 760px the
  links and chips fold into a menu button (`auth.js`; Esc or a click outside closes it).
- **Panels** are Felt 800 cards with a small-capitals eyebrow after a red pip. Buttons: Ivory primary, outlined secondary.
- **Icons**: `favicon.ico` (16 pixel-fitted, 32, 48), `assets/img/favicon.svg`, `apple-touch-icon.png`, the manifest icons
  (`site.webmanifest`) and the share card `og-image.png` (1200 × 630), all in the shared head block.
- **The tBCH badge** is a small mint diamond (`assets/img/tbch.svg`): no mainnet coin logos next to the mark.

Each game page drops you into its own world and has **its own machine**, and its card in the lobby is a small version of it
(Fruit Orchard: wooden crate, striped awning with string lights, tilted sign, price-tag Play; Deep Sea: riveted hull, brass
nameplate, porthole reels, brass Play; Cosmic Voyage: cut-corner neon panel, holographic title, neon Play):

| | Cabinet | Display | Spin | Bet |
|---|---|---|---|---|
| 🍒 Fruit Orchard | Wooden fruit stand: striped awning with string lights, board walls, a wooden counter | Chalkboard | Round red apple **SPIN** key | Ten hanging **price tags**, crate − / + around a chalk slate |
| 🐚 Deep Sea | Riveted submarine hull, brass nameplate, bolted porthole round the reels, bubbles, a diamond-plate console | Sonar screen | Amber **DIVE** key in a brass collar | Rotary **BET DIAL** (a ridged brass knob; tap a number), ◀ ▶ keys |
| 🌙 Cosmic Voyage | Neon starship cabinet, a cockpit console | Neon display | Raised hexagonal **LAUNCH** key | **Thrust** lever in a slot, ▲ ▼ keys |

All three are drawn with PixiJS (see Machines). The bet controls move along the bet ladder 1, 2, 5, 10, 20, 50, 100, 200, 500, 1,000. Space spins on every machine.
The reels stop one by one, left to right (about 3 s per spin). While they turn, the spin control reads STOP: pressing it or Space
lands the remaining reels at once. That is display only: the result is already fixed by the server. After a win the machine
waits for the win animations to finish, plus half a second, before the next spin can start.
Big wins get BIG / MEGA / JACKPOT banners, a coin shower, themed confetti and synthesized sounds (a different pack per game).
Each machine has a full-screen button in its top-right corner: the site header, nav and paytable are hidden and the machine is sized
to fit the screen, 10px from the edges (Esc or the button exits). It is hidden in browsers without the Fullscreen API, such as Safari on iPhone.
The tBCH diamond (`assets/img/tbch.svg`) drifts through every venue's animated background, rains down in the win showers and
marks tBCH in the UI (faucet bar, balance chip, wallet sign-in, Withdraw step, return to the house).
Respects `prefers-reduced-motion` and works down to 360px wide.

## Live faucet stats

Every page has a bar at the top with live totals from `GET /faucet` (public): what is left in the faucet (`house`) and
the sum of player balances, plus player counts (all time, last 30 days, last 24 hours, with a
balance). The server recomputes them at most every 5 minutes; the bar re-reads them every
minute while the tab is visible and says so when the server marks them `stale`. It is the only place that shows whole coins:
the faucet rounded to 2 decimals (hover for the exact tBCH sats), player balances with all 8 decimals.

## Coins

Every account plays both coins (D46; `docs/API.md` "Coins" in the backend), whatever it signed in with (a tBTC wallet, a tBCH
wallet or a passkey). tBTC amounts are a tenth of tBCH's, and the RTP is 101% in both.

- **The coin switch** (`TNC_Coin` in `units.js`, rendered by `auth.js`): tBTC / tBCH in the header beside the balance (on phones beside
  the menu button), remembered in `localStorage` (`tnc.coin`). tBTC is the default and comes first wherever both are listed
  (brand kit). Choosing a coin reloads the page; every page reads it once. `<html data-coin>` and any element's `data-coin`
  set `--tc-net`: tBTC orange, tBCH mint. If the server has a coin off (`GET /me` has no balance in it), the page shows the other.
- **Every call that moves money takes the coin** (`api.js`; the server treats a missing coin as tBCH): `POST /spins`,
  `POST /bonus/daily?coin=`, `GET /ledger?coin=`, `GET /jackpots?coin=`, `GET /leaderboards?coin=`, `POST /roulette/bets`
  and `/clear`, `POST /withdrawals`.
- **Header**: the selected coin's balance beside the coin switch (both coins in its tooltip) and its daily bonus pill; the
  account chip only names the account. The lobby's daily bonus card has a line and a Claim button per coin.
- **Faucet bar**: both faucets and both player totals side by side (`coins` in `GET /faucet`).
- **Slots**: the bet ladder follows the coin (tBTC 1, 2, 3, 5, 10, 15, 20, 30, 50, 100; tBCH 1 ... 1,000; every skin draws ten
  stops), and the machine shows the coin's jackpots and collectors.
- **Roulette**: one table for both coins. Your chips are in the selected coin, with its chip values (tBTC 1 to 100, tBCH 1 to
  1,000) and limits (`limits` in the `table` message). Every chip carries a small diamond in its coin's colour; the players
  list, the round and the results show each player's amounts per coin; `settled` updates the balance of its coin.
- **Leaderboards**: a tBTC / tBCH toggle on the page (default: the selected coin).
- **Withdrawals page**: every coin, a tBTC txid linked to `https://mempool.space/testnet4/tx/<txid>`, a tBCH txid to
  `https://bchexplorer.cash/testnet4/tx/<txid>`, the total per coin.
- **Account**: both balances; withdraw, history and the address check in the selected coin; "Default withdrawal addresses" with
  a saved address per coin (a signed message, like sign-in: passkey accounts in both coins, wallet accounts in the other coin).
- **Sign-in**: a tBTC address (`tb1q...`, `tb1p...`, `m...`, `n...`) or a tBCH one (`bchtest:q...`); the address decides the coin.
  `assets/js/btcaddr.js` checks bech32 / bech32m and base58check (with its own SHA-256) and refuses mainnet, script addresses
  (`2...`, P2WSH) and typos before asking the server; the server's message is shown for `invalid_address`. The signature is
  pasted as the wallet gives it (BIP-322, with or without `smp`, or the 65-byte compact one), only trimmed.
- **Fairness**: a tBTC spin's jackpot draws use bet × 10 (FAIRNESS.md section 3, `opts.coin` in `fairness-engine.js`); the
  verifier has a coin field and the spin list shows each spin's coin.

## Units

The API works in sats of a coin (1 coin = 100,000,000 sats). Following the brand kit, every amount is shown in sats and written
**tBTC sats** or **tBCH sats** (`assets/js/units.js`; `coin` defaults to the selected one): bonuses, bets, wins, balances,
jackpots, each withdrawal, the tables (the column header names the unit). Only the faucet bar, and the withdrawals page's
totals, show whole coins. The withdraw form takes a whole number of sats. The games show sats only. Bets are always whole sats. On the machines the unit is set in Poppins, since
the sign font has capitals only and the ticker keeps its lowercase t.

## Returning coins

The lobby ends with a "Return to the house" panel asking players to send their Testnet4 coins back once they have
had enough fun, so the faucet keeps running. One house address per coin (tBTC first), each shown as code with a Copy button:

- tBTC: `tb1qm2xvvwdv4xtxcagg2xtfy45kj58506sy8fyx2c`
- tBCH: `bchtest:qphp0rfnp6uyjfh5p235r8lwykv6knknfqqw5ghdxy`

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

No game math runs in the browser. On load `assets/js/slot.js` reads `GET /games/{id}/config` (symbols, paytable, features,
paylines, stats), builds the paytable and loads the machine (see Machines), which is built from the same config. A spin sends `POST /spins { gameId, bet, requestId }` with a new
`crypto.randomUUID()`; a network error, timeout or 5xx is retried with the same `requestId`, so a spin is never played twice.
The reels start turning at once and land one by one on the server's result (a stop request only shortens the wait). The response's `steps[]` are then animated in order:
`spin` (one or more phases: Lucky Respin, expanded reels, multiplier wilds, sticky wilds in free spins), `freeSpinsStart`,
`retrigger`, `bonus` (pick / wheel / ladder, with the result already fixed), `freeSpinsEnd`, and from version 4 `jackpot`,
`collect`, `rewardStart` and `holdAndWin` (see Jackpots and Collectors below). Every win is shown in sats
exactly as the server sent it, and the balance is set to the response's `balance` at the end.

Signed-out visitors see the machine with SIGN IN on its spin key. Errors show the server's message
(`insufficient_funds`, `invalid_bet`, `rate_limited`, ...); a 401 means the session ended and shows the sign-in button.

## Jackpots

The jackpots (backend decision D43, game config version 4+) are part of every game's 101% RTP: every bet adds 3.36% of
itself to its game's **Minor**, 2.52% to its **Major** and 2.52% to the **Grand** shared by all three (version 5; the head
starts are inside the RTP too). They are won **inside the game**:
after the free spins, a paid spin with bet `b` draws Grand, Major and Minor (each a hit with chance `b / oneInSats`, from the
spin's own stream) and wins the highest tier hit, everything its meter holds. After a win the next cycle starts with a head
start from the house (25% to 75% of a hidden target), so a jackpot never shows 0. Names, emojis and texts come from the
config's `jackpot` block.

`assets/js/jackpots.js` reads `GET /jackpots` (public) when the page opens and every 12 s while the tab is visible. It only
ever shows what the server sent:

- **GRAND, MAJOR and MINOR are prize amounts** (`amount`), like real progressive displays: every
  `[data-jackpot="grand" | "major:<id>" | "minor:<id>"]` counts up smoothly to each new reading. `data-jackpot-units="bch8"`
  and `"game"` are both sats of the selected coin (lobby and jackpots page, machines).
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
- **Lobby**: the Grand amount at the top of the Slot machines section (with a link to the jackpots page), and each machine's Major
  amount at the top of its card.
- **Jackpots page** (`jackpots.html`): every jackpot and collector now, the rules in short, the seed hash of every running
  jackpot ("Seed hashes now"), and the latest 20 wins from `recentWins` (time, tier and game, player, amount in tBCH sats). Wins with a `seed` have a **Verify** button: in the browser, SHA-256(seed) must equal `seedHash`, the seed must
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

## Roulette

`games/roulette.html` (`assets/js/roulette.js`, backend decision D44): **one live table for everyone**, a European single-zero
wheel at **RTP 101%** with the **golden ball** (backend decision D45; its own RTP, apart from the slots). A round every
real minute while someone is at the table: `:00` to `:20` betting, then a 28 to 32 s spin, then the result until the next
`:00`.

- **Payouts and the golden ball** (rules version 2, `rules` in the `table` message): a winning bet on `n` numbers returns
  `stake × 36 / n` (straight 35 to 1, red 1 to 1, ...). In about 1 round in 236 the ball is golden and every win of the
  round pays ×10. It is drawn when betting closes and arrives with the `spin` message (`round.golden`), so the page never
  hints at it during betting. A golden spin has a gold ball with a glow from the start and a "GOLDEN BALL! All wins ×10"
  banner; the result shows ×10 on the wins (`win` and `payout` already include it). Golden rounds have a small gold ball
  in the history, the previous rounds and on the lobby card. Hovering a bet shows its odds and what the chip in hand would
  return. Rounds from before D45 are rules 1 (`stake × 37 / n`, no golden field) and are shown as they were.

- **Live over a WebSocket** (`wss://api.testnetcasino.com/roulette/ws`, the session cookie is sent by the browser; `api.js`
  `rouletteSocketUrl()`): the first message is `table`, then `round`, `bets`, `cleared`, `spin`, `result`, `settled` (to the
  player only), `joined`, `left`, `chat`, `pong`, `error`. Pinged every 30 s, reopened after a drop with a growing wait (the
  server keeps the place for 10 s). Every countdown runs on the server's clock (`serverTime`). Signed-out visitors see the
  table from `GET /roulette/state` (every 10 s) with a "Sign in to play" button.
- **Lobby card**: a wide card in the lobby's own Roulette section, below Slot machines and apart from the Grand (roulette has no
  jackpots; a Poker section will follow) (`assets/js/lobby.js`) with the last five numbers from
  `GET /roulette/rounds` and how many players are at the table from `GET /roulette/state`, read every 30 s while the tab is
  visible. Without an answer it keeps its own text and sample numbers.
- **Chips** go through `POST /roulette/bets` (taps close together in one request, up to 50 chips, each with its own
  `requestId`) and **Clear** through `POST /roulette/bets/clear`; **Repeat** places your chips of the last round again.
  Chips of 1 to 100 tBTC sats (at most 1,000 a round) or 1 to 1,000 tBCH sats (at most 10,000 a round), in the coin selected
  in the header (checked before sending too). A player who joins during a round sees "You
  joined mid-round: you can bet from the next round" with a countdown.
- **The wheel** turns all the time. When the `spin` arrives the number is known, but it is never shown as text before
  `resultAt`: the ball follows a closed-form path relative to the wheel (many turns against it, slowing, dropping from the
  rim into the pockets with a few bounces) that ends exactly in the number's pocket at `resultAt`, so it is right even for a
  player who opens the page halfway through a spin. Then the number lights up on the felt and in its pocket, lost chips
  fade, winning chips pulse, and the player's own win or loss gets a banner until the next round.
- **The felt** is drawn in PixiJS with every bet as a hit zone, worked out from where the pointer is: inside bets
  (straight, split, street, trio, corner, first four, line) on the numbers, their lines and edges; outside bets (dozens,
  columns, red/black, odd/even, low/high) around them. Everyone's chips are on it: a stack per player and spot, yours on top
  with a gold ring, other players' with their colour and a short label. Two layouts: wide screens get the wheel beside a
  horizontal felt; narrower ones (under 860 px) the wheel above a vertical felt (numbers running down, outside bets on the
  left) and a bigger status bar.
- **HTML around the canvas:** the players and the chat (text only, never HTML; 200 characters, one message every 2 s, the
  server's `chat_too_fast` / `invalid_chat` shown under it; chat is not kept, it starts when you join), this round's chips
  and results per player, **previous rounds** (`GET /roulette/rounds`) with **Details** (`GET /roulette/rounds/{id}`): every
  chip with its payout and an in-browser check of the round (seed hash, number, spin length, golden ball, every payout),
  and the rules with the payouts (36 / n: straight 36×, red 2×, ×10 with the golden ball).
- **Fairness:** `TNC_Fair.roulette(seed, roundId, bets, rules)` (FAIRNESS.md section 9; rules 2 draws the golden ball
  after the spin length, checked against the backend's roulette
  vectors by `tools/verify-vectors.mjs`), and a 🎡 Roulette section on the fairness page: load a round by number (or
  enter a seed, round id and chips) to recompute everything. `fairness.html#roulette-<id>` loads a round directly.
- The ledger shows `roulette_bet`, `roulette_refund` and `roulette_win` on the account page.

## Machines

Every game plays on a machine drawn entirely with **PixiJS 8** (`assets/vendor/pixi-8.22.0.min.js`, MIT, kept in the repo
so the site does not depend on a CDN; about 240 KB gzipped, loaded only on the game pages). `slot.js` loads PixiJS, the engine
`assets/js/pixi-machine.js` and the game's skin `assets/js/pixi-<theme>.js` (`orchard`, `deepsea`, `cosmic`); if PixiJS cannot
start (no WebGL), the page says so with a "Try again" button.

- **The engine** is shared: the jackpot rows, the reels (motion blur, landing with a bounce, one by one, STOP), win lines,
  held and expanding wilds, multiplier badges, banners, coin and emoji particles, the display, the stage for bonus games, a
  prize wheel and a pick game, the collector's level, the console in perspective, full screen and pointer mapping. It plays
  the server's `steps[]` exactly as before.
- **A skin** draws the game's own machine and plays its own shows: Fruit Orchard (the stand, the Apple Tree turning green,
  price tags, Harvest Pick baskets, the golden apples), Deep Sea (the hull, the Treasure Chest filling with coins, the BET
  DIAL, the Ship's Wheel, the Magic Oyster's clams, Treasure Hold & Win), Cosmic Voyage (the cockpit, the Fuel Tank, the
  THRUST lever, the Warp Ladder, the Star Map Wheel).
- Static art is painted with Canvas 2D into textures (gradients, glows, wood grain, rivets) and moved by PixiJS.
- **The console** (readouts, spin key, bet control) is drawn flat into a render texture every frame and shown on a
  `PerspectiveMesh`, so it slopes toward the player, a little wider at the front. Keys stand up from it (side walls) and
  sink when pressed; screens are recessed. Taps are mapped back to the flat deck through the inverse homography.
- The canvas sits in a CSS 3D stage, so the **whole machine tilts** on a MINOR (stronger on a MAJOR, rocking on a GRAND), a
  bit on MEGA and TOP PRIZE wins, and when the collector fills; the canvas also shakes. Shorter with reduced motion.
- Outside the canvas, in HTML: sound, the fairness link, the paytable and rules (`TNC_Slot.paytableSection`) and Recent spins.
  Screen readers get the display text through a live region.
- For the smoke test: `window.TNC_PixiState()` reports what the machine shows, `TNC_PixiBet(n)` sets the bet,
  `TNC_PixiGo()` presses a stage's button (or Auto). `TNC_Jackpots.onRender(fn)` gives the machine every jackpot reading.

## Account and withdrawals

`account.html` (`assets/js/account.js`), reached from the account pill in the nav:

- **Withdraw** (in the selected coin): `POST /withdrawals { coin, amount, address }`. tBCH: 1,000 to 10,000,000 sats per withdrawal,
  at most 100,000,000 sats (1 tBCH) per player in 24 hours and 10 tBCH a day for the whole faucet. tBTC: 1,000 to 100,000 sats, at
  most 100,000 sats per player in 24 hours and 0.01 tBTC a day for the whole faucet. `address` is any Testnet4 address the player types or pastes
  (no signature, no waiting period). In its sign-in coin a wallet account gets its sign-in address prefilled and may leave it
  empty; otherwise the field is prefilled with the saved default of the coin (`user.withdrawalAddresses`), and without one an
  address is required. `btcaddr.js` / `cashaddr.js` reject input of the wrong coin and obvious typos early, but the server's answer counts: `invalid_address`, `address_required`, the amount and
  daily-limit errors and `withdrawals_paused` show the server's message.
- **Default withdrawal addresses**: one per coin, saved with a signed message (`POST /account/withdrawal-address/challenge`,
  then `/account/withdrawal-address`). Wallet accounts only in the coin they do not sign in with.
- **Withdrawals**: `GET /withdrawals` (every coin), each txid linked to its coin's explorer (mempool.space for tBTC,
  bchexplorer.cash for tBCH). The list re-reads itself every 15 s while a withdrawal is pending.
- **Balance history**: `GET /ledger?coin=&cursor=`, 50 per page with "Load more".

## Withdrawals page

`withdrawals.html` (`assets/js/withdrawals.js`) lists every withdrawal the faucet has sent in both coins (`GET /faucet/withdrawals?cursor=`,
public, no coin). When the page opens it follows every page (`nextCursor`) and then shows the whole list at once, with the total
withdrawn per coin (whole coins, sats on hover) and the number of withdrawals on top. Each row: time in the visitor's time zone, the full address (shortened on
narrow screens, with the full one in the tooltip and a copy button), the amount in sats with its ticker and the txid linked to
its coin's explorer in a new tab (`TNC_Coin.info(coin).explorerTx`). No polling.

## Leaderboards

`leaderboards.html` (`assets/js/leaderboards.js`): seven boards of one coin from `GET /leaderboards?coin=` (a tBTC / tBCH toggle above
the tabs, default the selected coin; top balances, biggest winners over 24
hours, 30 days and all time, top withdrawals over 24 hours, 30 days and all time), up to 1,000 players each. The response (up to ~500 KB)
is fetched once per page view, with the session cookie, and again only when the player signs in or out; the server refreshes it
every 5 minutes. Rows render 50 at a time (more on scroll or "Show more"). The signed-in player's row is found only by
`me: true` (labels can collide), highlighted with a "You" badge and `aria-current`, and a "Jump to my position (#n)" button
shows while that row is out of view (IntersectionObserver). Amounts are sats of the board's coin.

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
node tools/verify-vectors.mjs   # reads ../testnetcasino-service/docs/fairness-test-vectors.json; prints 228/228 (streams, every game version, tBTC spins, rewards, meters, roulette)
```

## Sign-in, account and daily bonus

Sign-in lives on `login.html`: a **Testnet4 wallet** (address plus a signed message) or a **passkey** (WebAuthn). There are no
passwords, no email and no social logins.

- `assets/js/btcaddr.js` (tBTC: bech32, bech32m, base58check) and `assets/js/cashaddr.js` (tBCH: CashAddr checksum) validate
  addresses before calling the server; `TNC_Address.check()` picks the coin from the format. Only addresses that can sign get
  in: `tb1q...` (P2WPKH), `tb1p...`, `m...`, `n...`, `bchtest:q...`. Mainnet, script, token-aware and legacy CashAddr addresses
  get a specific message. The wallet how-to follows the coin (Electron Cash for tBCH; Sparrow, Electrum, Bitcoin Core, Unisat,
  Xverse, Leather for tBTC).
- `assets/js/auth.js` reads `GET /me` (`{ user, balances, dailyBonuses, ... }`, 401 = signed out) on every page and renders the nav:
  the coin switch, the balance, the daily bonus pill, the account (with the coin badge of `user.addressCoin`) and "Sign out". It
  refreshes when the tab becomes visible again.
- Daily bonus, per coin: "Claim 100 tBTC sats" (`POST /bonus/daily?coin=btc`) when available, otherwise a countdown to
  `nextClaimAt`. The selected coin's is in the nav on every page; the lobby card has both. `409 daily_bonus_claimed` just
  switches to the countdown.
- `?next=` sends you back after sign-in (same-origin paths only).

## Terms and Privacy

`legal/terms-of-service.pdf` and `legal/privacy-policy.pdf` are linked from every footer and from the sign-in page ("By
signing in you accept the Terms of Service..."). Their text lives in `tools/legal/build_legal.py`: edit it there, bump
`EFFECTIVE`, and rebuild with Python 3.10+ and reportlab (`python tools/legal/build_legal.py`). The contact address in both, and in the footer of every page, is
house@testnetcasino.com.

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
assets/css/style.css  Brand kit theme + per-game worlds and lobby cards (.theme-orchard / -deepsea / -cosmic)
assets/js/slot.js     Game page: loads the game config, the paytable, then PixiJS and the machine
assets/js/pixi-machine.js  The machine engine (PixiJS): reels, the spin's steps, stages, console in perspective
assets/js/pixi-orchard.js, pixi-deepsea.js, pixi-cosmic.js  Each game's machine (skin)
assets/js/audio.js    Synthesized sound packs per game (Web Audio API, no audio files), mute saved per browser
assets/js/fx.js       Themed animated backgrounds per game, the win shower + themed confetti
assets/img/           Logo, mark, favicons, app icons, share card (from the brand kit) and the tBCH diamond (tbch.svg)
favicon.ico, site.webmanifest  Tab icon and web app manifest
assets/js/faucet.js   Live faucet totals bar (GET /faucet)
assets/js/units.js    The selected coin (TNC_Coin) and amount formatting: sats of a coin everywhere, whole coins in the faucet bar
assets/js/btcaddr.js  Bitcoin Testnet4 address checks, and TNC_Address for both coins
assets/js/jackpots.js Jackpot amounts, Minor coin pots and the latest wins (GET /jackpots, lobby, games, jackpots page)
assets/js/copy.js     Copy buttons ([data-copy]); the lobby's house return and donation addresses
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
tools/site.mjs                Shared head, warning strip, faucet bar, header and footer for every page; ?v= version tag
tools/check/smoke.mjs         Smoke tests: every page in headless Chrome against a fake API
.nojekyll             Serve files as-is on GitHub Pages
```

## Hosting: GitHub Pages

Every local script and stylesheet link carries a version tag (`?v=20261111r`). GitHub Pages lets browsers cache files for about
10 minutes, so bump the tag on each release (`node tools/site.mjs version`); otherwise a new page can run with an old cached script.

## Development tools

Node 22+ only, no dependencies; the site itself still has no build step.

- `node tools/site.mjs build` writes the shared blocks into every page from one template: the head (icons, share
  card, fonts), the warning strip, the faucet bar, the site header with the nav, and the footer. In the pages they sit between markers such as `<!-- site:nav -->` and
  `<!-- /site:nav -->`; edit the templates in `tools/site.mjs`, never the copies. `check` reports pages that are out of date.
- `node tools/site.mjs version` bumps the `?v=` tag (date + letter, never backwards) in every page and this README.
- `node tools/check/smoke.mjs` runs every page in headless Chrome against a fake API (fixtures in `tools/check/fixtures`:
  real game configs and real spin results from the backend's test vectors) and checks: shared blocks in sync, every local
  link resolves, every page loads without errors or sideways scroll, a spin in each game, the full-screen fit, reels stopping one by one and the STOP press, the jackpots (machine rows in sats, jackpots won by someone
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
