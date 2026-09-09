# Steam MCP Suite

One MCP server for Steam + itch.io storefront intelligence: prices, reviews with
sentiment, news, players, wishlist analytics, and jam research.

Built to feed store/jam research into asset-pack-factory (https://github.com/MaximKonovalovDev/asset-pack-factory).

## Why

Game decisions need market facts: what a game costs today, what players say,
how many play now, which jams are live. This server gives all of that to an
LLM agent as 20 typed tools, keyless by default, read-only always.

## What it does

- Steam store without a key: search, game card, batch prices (500 ids), front-page
  specials, reviews + excerpts, NLP sentiment, news, live players, achievements.
- Wishlist + player analytics: keyless public wishlist; owned/recent games,
  profile, achievements need the free Steam Web API key and fail with a clear
  message without it.
- itch.io jams without a key: browse, keyword search, jam details.
- Typed zod schemas on every tool; bad input returns a structured error, never
  a crash. Shared LRU + TTL cache cuts repeat upstream calls.

## Quick start

```bash
npm install
npm run build
npm start                 # node build/index.js — stdio MCP server
```

Client config:

```json
{
  "mcpServers": {
    "steam-mcp-suite": {
      "command": "node",
      "args": ["/absolute/path/to/steam-mcp-suite/build/entry.js"]
    }
  }
}
```

Only the player tools need `STEAM_API_KEY` (free at
https://steamcommunity.com/dev/apikey). Everything else works keyless.
`npm install` + `npm run build` + an MCP handshake were run clean on
2026-09-09 (Node 24, tsc, no key set).

## Demo + proof numbers

Measured 2026-09-09, in this checkout:

- `npm run build`: tsc clean, `build/` emitted.
- 20 tools counted in `src/tools/` (9 store, 8 wishlist/player, 3 itch).
- Live handshake: piped MCP `initialize` to `node build/entry.js`, got
  `serverInfo steam-mcp-suite 1.0.0` back with the no-key notice.
- Prior live run `docs/smoke-2026-08-13.txt`: 36/36 checks passed (search,
  reviews, sentiment, prices, jams, wishlist, keyless degradation).
- `npm run smoke` needs live network; it was not re-run today.

## Tools (20)

| Tool | What it does |
|---|---|
| `search_games` | Title search, top ~10 ranked matches |
| `get_game` | Full store card by appid or name |
| `get_prices` | Batch prices, unknown ids stay as `available:false` |
| `get_specials` | Front-page discounts by discount % |
| `get_game_reviews` | Score label, totals, excerpts (15 min cache) |
| `analyze_reviews` | NLP sentiment: score, themes, keywords, quotes |
| `get_game_news` | News and patch notes |
| `get_current_players` | Live concurrent count |
| `get_global_achievements` | Achievement rarity, rarest first |
| `get_wishlist` | Public wishlist, keyless, optional price details |
| `resolve_vanity_url` | Vanity name to SteamID64 (key) |
| `get_player_summary` | Profile, status, level (key) |
| `get_owned_games` | Library + playtime, paginated (key) |
| `get_recently_played` | Last 2 weeks (key) |
| `get_player_achievements` | Player + global rarity merged (key) |
| `get_achievement_summary` | Completion % across games (key) |
| `get_cache_stats` | Live cache hit rate |
| `get_itch_jams` | Browse jams by status |
| `search_itch_jams` | Keyword search over jams |
| `get_jam_details` | Jam page: host, dates, entries |

## Project structure

```
src/          # entry (stdio preload) + index (server) + config + errors
src/steam/    # storefront + Web API client, analysis, types
src/itch/     # jam scraper
src/tools/    # store, portal (player), itch, registry — 20 tools
src/lib/      # cache, http, rate limit
scripts/      # smoke.mjs — live MCP check over stdio
docs/         # smoke transcript + verification notes
skills/       # agent skill wrapper
```

## License

MIT — see `LICENSE`. Combines MIT code from Grinv/steam-games-mcp,
jhomen368/steam-reviews-mcp, sharkusmanch/steam-mcp-server and
petrarka/itch-jams-mcp; attribution in `THIRD_PARTY_NOTICES.md`.

## Author

Maxim Konovalov — Haifa. Store intelligence + MCP tooling.
