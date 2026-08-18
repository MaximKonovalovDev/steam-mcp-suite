/**
 * Configuration loaded from environment variables. Follows the env names of
 * Grinv/steam-games-mcp (MIT) so existing user configs carry over.
 *
 * The Steam Web API key is OPTIONAL: the server always starts, the storefront
 * + reviews + news + itch tools work without it, and the player tools report a
 * clear, actionable error at call time when it is missing (graceful
 * degradation).
 */
import { z } from "zod";

const UNSUBSTITUTED_PLACEHOLDER = /^\$\{[^}]*\}$/;

const EnvSchema = z.object({
  /** Free Steam Web API key (player data). https://steamcommunity.com/dev/apikey */
  STEAM_API_KEY: z.string().trim().min(1).optional(),
  /** Default player for the player tools: SteamID64 or vanity name. */
  STEAM_ID: z.string().trim().min(2).optional(),
  /** Storefront region (prices are region-aware). */
  STEAM_COUNTRY: z.string().trim().min(2).max(2).default("US"),
  /** Storefront language. */
  STEAM_LANGUAGE: z.string().trim().min(2).default("english"),
  /** Generic tunables. */
  HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  HTTP_RETRIES: z.coerce.number().int().nonnegative().default(2),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),
  CACHE_MAX_SIZE: z.coerce.number().int().positive().default(2000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "silent"]).default("info"),
});

export interface Config {
  steamApiKey: string | undefined;
  defaultSteamId: string | undefined;
  country: string;
  language: string;
  httpTimeoutMs: number;
  httpRetries: number;
  rateLimitPerMinute: number;
  cacheMaxSize: number;
  logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Drop empty strings and unsubstituted ${...} placeholders so optional
  // fields stay genuinely unset (an unfilled client-config placeholder is
  // non-empty and would otherwise be treated as a real key).
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(
      ([, v]) => v !== undefined && v.trim() !== "" && !UNSUBSTITUTED_PLACEHOLDER.test(v),
    ),
  );
  const parsed = EnvSchema.parse(cleaned);
  return {
    steamApiKey: parsed.STEAM_API_KEY,
    defaultSteamId: parsed.STEAM_ID,
    country: parsed.STEAM_COUNTRY,
    language: parsed.STEAM_LANGUAGE,
    httpTimeoutMs: parsed.HTTP_TIMEOUT_MS,
    httpRetries: parsed.HTTP_RETRIES,
    rateLimitPerMinute: parsed.RATE_LIMIT_PER_MINUTE,
    cacheMaxSize: parsed.CACHE_MAX_SIZE,
    logLevel: parsed.LOG_LEVEL,
  };
}
