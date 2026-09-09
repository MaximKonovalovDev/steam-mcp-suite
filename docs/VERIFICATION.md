# Verification Report — Steam MCP Suite

Date: 2026-08-13 · Environment: Windows 11, Node v24.14.0, Python 3.13.14 (unused)
Build path: `StudioAI/products/steam-mcp-suite/` · Full transcript: [`smoke-2026-08-13.txt`](smoke-2026-08-13.txt)

## What ran

1. **Fresh install from lockfile**: `npm ci` (0 vulnerabilities) → `npm run build` (tsc, clean).
2. **Documented start commands**:
   - `npm start` → `node build/entry.js` — starts, ready line on stderr, stdout stays protocol-clean.
   - `npx --no-install steam-mcp-suite` (published bin `steam-mcp-suite`) — verified working.
3. **Real MCP stdio session** (`npm run smoke`): initialize → tools/list (20 tools) → 14 valid calls against live Steam/itch.io, 6 keyless-degradation calls, 12 invalid-input calls. **Result: 36 passed, 0 failed.**

## Tool-by-tool: valid input → valid output (live, no key)

| Tool | Call | Result |
|---|---|---|
| search_games | `{term:"Hades"}` | 10 ranked matches, appid 1145360 → |
| get_game | `{appid:1145360}` | full store card (Hades, price, genres, metacritic) |
| get_prices | `{appids:[1145360,570,730,999999999]}` | 3 priced rows + unknown id marked `available:false` (not dropped) |
| get_specials | `{}` | 10 front-page deals w/ discount %, expiry |
| get_game_reviews | `{appid:1145360,limit:3}` | 307,514 reviews, 98% "Overwhelmingly Positive" + excerpts |
| analyze_reviews | `{appid:1145360,sample_size:30}` | sentiment 0.30 positive, themes, keywords, quote URLs; 2nd call = cache hit (0 upstream) |
| get_game_news | `{appid:1145360,limit:2}` | 2 news items |
| get_current_players | `{appid:570}` | 609,696 concurrent |
| get_global_achievements | `{appid:1145360}` | 49 achievements, 81.9% rarest-first |
| get_wishlist | `{steamid:"76561198139829386",include_details:true}` | found:true, 3 items + per-item price enrichment (real public profile) |
| get_itch_jams | `{filter:"active"}` | **493 active jams — itch.io NOT blocked** |
| search_itch_jams | `{query:"game"}` | 160/493 matched |
| get_jam_details | `{jam:"micro-jam-055"}` | full jam page (title/host/dates/stats/description) |
| get_cache_stats | `{}` | live hit/miss stats; hits increased on repeat call |

## Keyless degradation (no STEAM_API_KEY set — the default)

`get_owned_games`, `get_player_summary`, `get_recently_played`, `get_player_achievements`,
`get_achievement_summary`, `resolve_vanity_url` → each returns a structured `isError`
naming the missing `STEAM_API_KEY` + how to get it (free), no crash, server keeps running.
`get_wishlist` on a private/nonexistent profile → `found:false` with reason.

## Invalid input → structured error

12/12 validation cases passed (empty term, no appid/name, empty appids, non-numeric
appid, negative appid, bad steamid, out-of-range limit, bad enum, missing query,
unknown tool, …) — all `isError: true` with `details` listing failing fields.

## Bugs found & fixed during verification

1. **Reviews cache-key collision** — cache key omitted `num_per_page`, so a limit-3
   fetch served the limit-30 analysis call (and vice versa). Fixed; cache hit rate still
   demonstrated (repeat analyze_reviews → 0 upstream calls).
2. **`/api/featured/` returned 0 deals** — Steam changed the specials endpoint shape;
   switched to `/api/featuredcategories/` (`specials.items`), which returns 10 deals
   incl. discount expiry.
3. **stdout pollution by `natural`→`dotenv`** — `natural`'s optional storage backends
   call `dotenv.config()` at import; modern dotenv prints "injected env" tips to
   **stdout**, which corrupts MCP framing. Fixed with a preload entry
   (`src/entry.ts` setting `DOTENV_CONFIG_QUIET=true` + inert path before the dynamic
   import). Verified: stdout empty on startup, 36/36 MCP checks pass.

## GAP / blocked

- **Keyed player tools not exercised against a real key** — no account was created
  (per task rules). The keyed endpoints (GetOwnedGames, GetPlayerSummaries, etc.) use
  the same HTTP layer as the keyless ones that all pass, and the client code is
  carried over from two verified MIT seeds; the no-key degradation path is fully
  verified. Live keyed validation is a 2-minute user-side step: set `STEAM_API_KEY`,
  run `npm run smoke`.
- **itch.io blocking**: not observed today (493 jams scraped fine). If itch.io
  starts blocking, `get_itch_jams`/`search_itch_jams`/`get_jam_details` return a
  structured 403 error (message explains the situation) — never garbage.
- **Wishlist**: only public profiles resolve; private wishlists correctly report
  `found:false`.

## No secrets / licenses

- Secret scan clean (no key-shaped strings outside `.env.example` placeholder).
- `.env` git-ignored; `.env.example` contains placeholder only.
- `LICENSE` = MIT with all four seed copyrights; `THIRD_PARTY_NOTICES.md` maps code
  to seed repo per module.

## Paid-tier seam (monetization, not built — MIT core is the adoption layer)

The template's license split: OSS core (MIT) for adoption, paid layer elsewhere.
Natural seams for the product layer:
1. **Hosted SaaS server** (Streamable HTTP/SSE instead of stdio) — "Steam + itch
   intelligence as a service": multi-tenant, no install, per-seat license. The itch
   seed already shipped SSE/streamable-http transports the paid fork can expose.
2. **Bulk/dev-portal analytics tier** — deeper library analytics (playtime trend,
   achievement completion tracking across time, price-drop alerts on wishlists,
   review-bomb detection diffs) keyed by a license.
3. **White-label skill packs** (bundled Claude/Codex/Cursor skills per use case:
   indiedev research, marketwatch, community mods) — $9-49 one-time.
4. **Caching as a differentiator** — the 70-85% API-cut cache + `get_cache_stats`
   makes the free key's daily Web-API quota go further than raw API scripts; the
   paid tier removes the per-process cache (shared Redis) for teams.
