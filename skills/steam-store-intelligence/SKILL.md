---
name: steam-store-intelligence
description: Steam + itch.io storefront intelligence via the Steam MCP Suite — search games, prices/discounts, review sentiment, news, wishlists, and game jams. Use when asked about Steam games, deals, reviews, player libraries, wishlists, or itch.io jams.
---

# Steam + itch.io Storefront Intelligence

Use the **steam-mcp-suite** MCP server for anything Steam or itch.io: game lookup,
deals, review analysis, news, wishlists, player libraries, and game jams.

## Workflow

1. **Find the game first.** Almost every question starts with `search_games`
   (term can be partial) to get the appid, then:
   - details → `get_game` (by appid or name)
   - "is it on sale / what does it cost" → `get_prices` (batch) or `get_specials`
   - "is it good" → `get_game_reviews` for the summary, `analyze_reviews` for sentiment + themes
   - "what's new" → `get_game_news`; "how alive is it" → `get_current_players`
2. **Batches.** Price/rating-check whole lists with `get_prices` (up to 500 appids,
   one call) instead of one request per game.
3. **Wishlists & players.** `get_wishlist` works without a key (public wishlists
   only). Player tools (`get_owned_games`, `get_player_achievements`, ...) need
   `STEAM_API_KEY`; without it they return a structured error explaining how to
   enable them — report that to the user rather than inventing data.
4. **itch.io jams.** `get_itch_jams` (filter: active/upcoming/recent/all),
   `search_itch_jams`, `get_jam_details` (slug or URL). itch.io may block
   automated requests; if a tool returns the structured 403 error, say so and
   suggest retrying later — the Steam tools are unaffected.

## Rules

- Only cite numbers that came from tool output. Never guess prices, review
  percentages, player counts, or wishlist contents.
- Reviews: prefer the summary's `scoreText`/`scorePercent` for "is it well
  received"; use `analyze_reviews` for *why* (themes, keywords, quotes).
- If a profile is private, the tool returns `found:false` / a clear reason —
  don't keep guessing at other steamids.
- Prices are region-bound (`STEAM_COUNTRY`, default US).
- Read-only: never attempt to write, wishlist, follow, or purchase anything.
