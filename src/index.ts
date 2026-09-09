#!/usr/bin/env node
/**
 * Steam MCP Suite — combined Steam + itch.io storefront intelligence.
 *
 * One MCP server over stdio, read-only tools only:
 *  - Steam store: search, details, prices/discounts, reviews + NLP sentiment
 *    (cached), news, live players, achievement rarity — no API key required.
 *  - Wishlist + player analytics — keyless where possible; key-gated tools
 *    degrade to a clear structured error when STEAM_API_KEY is unset.
 *  - itch.io game jams — keyless scraping.
 *
 * Built from four MIT seeds — see THIRD_PARTY_NOTICES.md for attribution.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { CacheManager } from "./lib/cache.js";
import { RateLimiter } from "./lib/rateLimit.js";
import { HttpClient } from "./lib/http.js";
import { SteamClient } from "./steam/client.js";
import { ItchJamsClient } from "./itch/jams.js";
import { buildServer, type ToolContext } from "./tools/registry.js";
import { storeTools } from "./tools/store.js";
import { portalTools } from "./tools/portal.js";
import { itchTools } from "./tools/itch.js";

const VERSION = "1.0.0";
const NAME = "steam-mcp-suite";

const INSTRUCTIONS =
  "Steam + itch.io storefront intelligence. Store data needs no key: search_games → get_game for " +
  "details, get_prices / get_specials for prices and discounts, get_game_reviews for the summary " +
  "and excerpts, analyze_reviews for NLP sentiment + themes, get_game_news for news, " +
  "get_current_players for live counts, get_global_achievements for achievement rarity. " +
  "Wishlist/player analytics: get_wishlist is keyless (public wishlists only); get_owned_games, " +
  "get_recently_played, get_player_summary, resolve_vanity_url, get_player_achievements and " +
  "get_achievement_summary need the free Steam Web API key (STEAM_API_KEY) and report clearly " +
  "when it is unset or the profile is private. itch.io tools (get_itch_jams, search_itch_jams, " +
  "get_jam_details) are keyless scraping and may be blocked by itch.io occasionally. All tools " +
  "are read-only.";

export function buildSuiteServer(config: ReturnType<typeof loadConfig>): ReturnType<typeof buildServer> {
  const cache = new CacheManager<unknown>(config.cacheMaxSize);
  const limiter = new RateLimiter(config.rateLimitPerMinute, 60_000);

  const apiHttp = new HttpClient({
    timeoutMs: config.httpTimeoutMs,
    retries: config.httpRetries,
    limiter,
    cache,
    defaultQuery: config.steamApiKey ? { key: config.steamApiKey } : undefined,
  });
  const storeHttp = new HttpClient({
    timeoutMs: config.httpTimeoutMs,
    retries: config.httpRetries,
    limiter,
    cache,
  });
  const itchHttp = new HttpClient({
    timeoutMs: 15000,
    retries: 1,
    limiter,
    cache,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  });

  const ctx: ToolContext = {
    steam: new SteamClient(config, apiHttp, storeHttp),
    itch: new ItchJamsClient(itchHttp),
    cacheStats: () => cache.getStats(),
  };

  const specs = [...storeTools, ...portalTools, ...itchTools];
  return buildServer(specs, ctx, { name: NAME, version: VERSION, instructions: INSTRUCTIONS });
}

export async function main(): Promise<void> {
  const config = loadConfig();
  const server = buildSuiteServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const log = (msg: string): void => {
    process.stderr.write(`[steam-mcp-suite] ${msg}\n`);
  };
  log(`v${VERSION} ready (stdio). Steam Web API key: ${config.steamApiKey ? "set" : "NOT set (player tools will report how to enable them)"}`);

  const shutdown = (signal: string): void => {
    log(`received ${signal}, shutting down`);
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) => log(`unhandled rejection: ${String(reason)}`));
  process.on("uncaughtException", (err) => {
    log(`uncaught exception: ${err.message}`);
    process.exit(1);
  });
}

main().catch((err: unknown) => {
  process.stderr.write(`[steam-mcp-suite] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
