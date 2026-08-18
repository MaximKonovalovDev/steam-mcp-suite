# Third-Party Notices

The Steam MCP Suite is a MIT-licensed combination of four MIT-licensed seed
projects. Attribution is preserved per project; each retains its own copyright
notice. The combined MIT license is in `LICENSE`.

## Grinv / steam-games-mcp — MIT — https://github.com/Grinv/steam-games-mcp
Copyright (c) 2026 Grinv

Used for: storefront tool intents (search games, game details, prices, specials,
reviews, news, current players, global achievements, wishlist), the keyless-caveat
endpoint design (news / achievement % / current players / wishlist answer without
a key), config env names, and storefront region/locale handling (cc / l).

## jhomen368 / steam-reviews-mcp — MIT — https://github.com/jhomen368/steam-reviews-mcp
Copyright (c) 2026 Steam Reviews MCP Server Contributors

Used for: review fetching and normalization (`appreviews` endpoint), the NLP
sentiment pipeline (`src/steam/analysis.ts` — AFINN via `natural`, keyword
extraction, review summarization, topic-focused analysis, example quotes), and
the caching/rate-limit/retry utilities (`src/lib/` — LRU+TTL cache with hit-rate
stats, token-bucket rate limiter, exponential backoff retry).

## sharkusmanch / steam-mcp-server — MIT — https://github.com/sharkusmanch/steam-mcp-server
Copyright (c) 2025 Marcus Sanchez

Used for: the Steam Web API client surface (player summaries, owned games,
recently played, achievements, vanity resolution, wishlist, news, current
players, global achievements), typed-error classes and error-message
sanitization, pagination conventions (offset/limit + has_more), and the
achievement-summary scan pattern.

## petrarka / itch-jams-mcp — MIT — https://github.com/petrarka/itch-jams-mcp
Copyright (c) 2026 petrarka

Used for: the itch.io jams scraper (`src/itch/jams.ts` — `FilteredJamCalendar`
JSON extraction, jam page parsing, jam formatting), ported from Python
(httpx + BeautifulSoup) to TypeScript (axios + cheerio) with the tool intents
preserved.

---

Dependencies (each MIT):
- `@modelcontextprotocol/sdk` — Model Context Protocol TypeScript SDK
- `axios` — HTTP client
- `cheerio` — HTML parsing
- `natural` — NLP (AFINN sentiment lexicon)
- `zod` — input schema validation
