# Steam MCP Suite

One MCP server for **Steam + itch.io storefront intelligence**: search games, prices &
discounts, reviews with NLP sentiment (cached), news, live player counts, wishlist &
player analytics, and itch.io game jams. Read-only by default, stdio transport, typed
zod schemas on every tool, structured errors (never stack traces).

Built by combining four MIT-licensed seed projects — attribution in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

- **Steam store** — no API key needed: search, details, batch prices, specials, reviews, sentiment, news, live players, achievement rarity.
- **Wishlist + player analytics** — `get_wishlist` works keyless (public wishlists); the player tools use the free Steam Web API key and degrade to a clear error when it's missing.
- **itch.io jams** — keyless scraping (browse / search / details).

## Install & run

```bash
npm install
npm run build
npm start                 # runs: node build/entry.js (stdio MCP server)
```

Or run the published bin directly: `npx steam-mcp-suite` (requires a build first).

### Client configuration

```json
{
  "mcpServers": {
    "steam-mcp-suite": {
      "command": "node",
      "args": ["/absolute/path/to/steam-mcp-suite/build/entry.js"],
      "env": {
        "STEAM_API_KEY": ""        // optional — free key at https://steamcommunity.com/dev/apikey
      }
    }
  }
}
```

### Environment variables (see `.env.example`)

| Variable | Default | Purpose |
|---|---|---|
| `STEAM_API_KEY` | *(unset)* | Optional free Steam Web API key — enables the player tools. Without it they return a structured error explaining how to enable them. |
| `STEAM_ID` | *(unset)* | Optional default SteamID64 (or vanity name) for the player tools. |
| `STEAM_COUNTRY` | `US` | Region for prices (cc). |
| `STEAM_LANGUAGE` | `english` | Storefront language (l). |
| `HTTP_TIMEOUT_MS` / `HTTP_RETRIES` | `15000` / `2` | Upstream request tuning. |
| `RATE_LIMIT_PER_MINUTE` | `60` | Token-bucket rate limit across all upstream hosts. |
| `CACHE_MAX_SIZE` | `2000` | LRU cache entries. |

No secret is ever committed: `.env` is git-ignored and `.env.example` only contains placeholders.

## Tools (20)

### Steam store — keyless
| Tool | What it does |
|---|---|
| `search_games` | Search the store by title (top ~10 ranked matches: appid, name, price, Metacritic, platforms). |
| `get_game` | Full store card for one game by **appid or name**: description, price/discount, platforms, genres, developers, release date, Metacritic, PC requirements, DLC count. |
| `get_prices` | Batch price/discount check for up to 500 appids in one call (unavailable ids stay in the list as `available:false`). |
| `get_specials` | Current front-page discounts, sorted by discount %, with deal expiry. |
| `get_game_reviews` | Review summary (score label, positive/negative totals & %) + recent review excerpts. Cached 15 min. |
| `analyze_reviews` | NLP sentiment analysis of a review sample: score/label/confidence, themes, positive & negative keywords, clickable example quotes, optional topic drill-down. Cached 15 min. |
| `get_game_news` | Recent news / patch notes. |
| `get_current_players` | Live concurrent player count. |
| `get_global_achievements` | Achievement rarity (global unlock %, rarest first). |

### Wishlist & player analytics
| Tool | Key? | What it does |
|---|---|---|
| `get_wishlist` | no | A player's public wishlist (appid, priority, date added); `include_details` adds name + current price/discount per item. |
| `resolve_vanity_url` | yes | Vanity name → SteamID64. |
| `get_player_summary` | yes | Profile: name, avatar, online status, current game, level. |
| `get_owned_games` | yes | Library with playtime hours, paginated (`offset`/`limit`/`has_more`). |
| `get_recently_played` | yes | Games played in the last 2 weeks. |
| `get_player_achievements` | yes | Player's achievements for a game, merged with global rarity. |
| `get_achievement_summary` | yes | Completion % across recently played (or given) games. |
| `get_cache_stats` | — | Cache hit/miss statistics (the 70-85% API-call cut is measurable). |

### itch.io — keyless
| Tool | What it does |
|---|---|
| `get_itch_jams` | Browse jams by status: active / upcoming / recent / all. |
| `search_itch_jams` | Keyword search over the jams calendar. |
| `get_jam_details` | Full jam page: description, host, dates, entry statistics (slug or URL). |

All tools validate input with typed zod schemas before any network call; invalid input
returns a structured `isError` (`Validation error` + the failing fields), never a crash.

## Real run output (verified 2026-08-13, no API key set)

Full transcript: [`docs/smoke-2026-08-13.txt`](docs/smoke-2026-08-13.txt) — **36/36 checks passed**.

Search + review summary + live players:

```json
$ search_games { term: "Hades" }
{ "query": "Hades", "store_total": 10, "returned": 10,
  "apps": [ { "appid": 1145360, "name": "Hades", "type": "app", ... } ] }

$ get_game_reviews { appid: 1145360, limit: 3 }
{ "appid": 1145360,
  "summary": { "totalReviews": 307514, "totalPositive": 301404, "totalNegative": 6110,
               "scorePercent": 98, "scoreText": "Overwhelmingly Positive" }, ... }

$ get_current_players { appid: 570 }
{ "app_id": 570, "current_players": 609696 }
```

Sentiment analysis on a 30-review sample (cached on repeat — second call cost 0 upstream requests):

```json
$ analyze_reviews { appid: 1145360, sample_size: 30 }
{ "appid": 1145360,
  "summary": "Analyzed 30 reviews: 80% positive, 20% negative. Overall sentiment is positive (score: 0.30). Common themes: combat, time, runs, weapon, story.",
  "sentiment": { "score": 0.3, "label": "positive", "confidence": 0.47 },
  "positiveKeywords": ["combat", "weapons", "amazing", "recommend", "story"],
  "negativeKeywords": ["runs", "difficulty", "controls", "time"],
  "exampleQuotes": [ { "isPositive": true, "votesHelpful": 3, "excerpt": "Easily one of the best games I have ever played...", "url": "https://steamcommunity.com/profiles/.../recommended/1145360/" }, ... ] }
```

Batch prices (an unknown appid is marked, not dropped):

```json
$ get_prices { appids: [1145360, 570, 730, 999999999] }
{ "returned": 3, "prices": [
    { "appid": 1145360, "available": true, "name": "Hades", "final_formatted": "$24.99", "discount_percent": 0, "currency": "USD" },
    { "appid": 999999999, "available": false } ] }
```

itch.io jams — **live and working (not blocked)** at verification time:

```json
$ get_itch_jams { filter: "active" }
{ "filter": "active", "page": 1, "total": 493,
  "jams": [ { "id": 408466, "title": "Kenney Jam 2026", "participants": 1292, ... }, ... ] }

$ search_itch_jams { query: "game" }   → { "scanned": 493, "matched": 160, ... }
$ get_jam_details { jam: "micro-jam-055" } → { "title": "Micro Jam 055: Horror ($350+ Prizes)", ... }
```

Wishlist (real public profile, keyless, with per-item price enrichment):

```json
$ get_wishlist { steamid: "76561198139829386", include_details: true }
{ "found": true, "wishlist_count": 3,
  "items": [
    { "appid": 745920,  "name": "Temtem", "priority": 0, "date_added": "2020-02-06",
      "price": { "available": true, "final_formatted": "$44.99", "currency": "USD" } },
    { "appid": 976730,  "name": "Halo: The Master Chief Collection", "date_added": "2021-07-11", ... },
    { "appid": 1118010, "name": "Monster Hunter World: Iceborne", "date_added": "2020-02-10", ... } ] }
```

Graceful degradation without a key — structured, actionable, no crash:

```json
$ get_owned_games {}
{ "error": true, "code": "bad_request", "tool": "get_owned_games",
  "message": "STEAM_API_KEY is not set. This tool needs the (free) Steam Web API key. Get one at
              https://steamcommunity.com/dev/apikey and start the server with STEAM_API_KEY set — the
              storefront, reviews, news and itch tools keep working without it." }

$ get_wishlist { steamid: "76561198014830870" }
{ "found": false, "reason": "Wishlist not found — the profile is private or the steamid doesn't exist. ..." }
```

Invalid input → structured validation error:

```json
$ get_prices { appids: [] }
{ "error": true, "message": "Validation error", "tool": "get_prices",
  "details": ["appids: Array must contain at least 1 element(s)"] }
```

## Caching

A shared LRU + TTL cache (from steam-reviews-mcp's design) covers store data (2 h),
reviews (15 min), analysis feeds (15 min), specials (10 min) and player stats (5 min).
It cuts repeat upstream calls by 70-85%; `get_cache_stats` reports the live hit rate.

## Verification

```bash
npm run build && npm run smoke
```

The smoke script speaks real MCP over stdio against the built server: initialize,
`tools/list`, a valid call for every tool, an invalid call for every tool, and the
keyless-degradation path for the key-gated tools. Exit code 0 = all green.

## Privacy & safety

- Read-only: every tool is an annotation-gated read (`readOnlyHint`); there are no destructive operations.
- Nothing is written anywhere; no accounts; no credentials — the API key is optional, read from the environment only, and never logged.
- Private profiles / blocked requests return structured errors with actionable messages.

## License

MIT — see [`LICENSE`](LICENSE). Combines MIT code from Grinv/steam-games-mcp,
jhomen368/steam-reviews-mcp, sharkusmanch/steam-mcp-server and petrarka/itch-jams-mcp
(attribution in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)).

