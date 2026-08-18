/**
 * Wishlist + dev-portal analytics tools.
 *
 * get_wishlist works without a key (public wishlists only — graceful
 * found:false when private). The player tools (owned games, recently played,
 * summary, vanity resolution, achievements, achievement summary) need the free
 * Steam Web API key and return a clear structured error when it is missing.
 * Intents from Grinv/steam-games-mcp and sharkusmanch/steam-mcp-server (MIT).
 */
import { z } from "zod";
import type { ToolSpec } from "./registry.js";

const steamid = z
  .string()
  .regex(/^\d{17}$/, "Must be a 17-digit SteamID64")
  .describe("64-bit Steam ID (get it via resolve_vanity_url or from a profile URL).");

export const portalTools: ToolSpec[] = [
  {
    name: "get_wishlist",
    title: "Get a player's wishlist",
    description:
      "List a player's Steam wishlist by SteamID64. No API key required, but the wishlist/profile " +
      "must be public — otherwise it returns found:false. Sorted by priority (lower = higher on " +
      "the list). Set include_details to also fetch current price/discount and name for every item " +
      "in the same call. Convert a vanity name first with resolve_vanity_url (needs the key).",
    inputSchema: z.strictObject({
      steamid,
      include_details: z
        .boolean()
        .default(false)
        .describe("Also fetch name + current price/discount for every item (default false)."),
    }),
    handler: async ({ steam }, { steamid: sid, include_details }) => {
      const wishlist = await steam.getWishlist(sid, include_details);
      if (!wishlist.found) {
        return {
          found: false,
          reason:
            "Wishlist not found — the profile is private or the steamid doesn't exist. Wishlist must be public (Steam → Privacy → Wishlist = Public).",
        };
      }
      return {
        found: true,
        steamid: sid,
        wishlist_count: wishlist.wishlist_count,
        items: wishlist.items.map((i) => ({
          appid: i.appid,
          name: i.name,
          priority: i.priority,
          date_added: new Date(i.date_added * 1000).toISOString().slice(0, 10),
          price: i.price,
        })),
      };
    },
  },
  {
    name: "get_player_summary",
    title: "Get player profile summary",
    description:
      "Get a Steam player's public profile info: name, avatar, online status, current game, " +
      "level, country, account age. Requires STEAM_API_KEY; the profile must be public. " +
      "Without the key this tool returns a clear structured error.",
    inputSchema: z.strictObject({
      steamid: steamid.optional().describe("17-digit SteamID64 (defaults to STEAM_ID env if set)."),
    }),
    handler: async ({ steam }, { steamid }) => {
      const sid = await steam.requireSteamId(steamid);
      const player = await steam.getPlayerSummary(sid);
      if (!player) {
        throw Object.assign(new Error("Player not found — the profile is private or the steamid doesn't exist."), { code: "not_found" });
      }
      return player;
    },
  },
  {
    name: "get_owned_games",
    title: "Get a player's owned games",
    description:
      "Get the games a player owns with playtime statistics, sorted by playtime (desc) by " +
      "default. Use limit/offset for pagination (has_more tells you if more remain). Requires " +
      "STEAM_API_KEY; profile game details must be public. Private profiles return a clear " +
      "structured error.",
    inputSchema: z.strictObject({
      steamid: steamid.optional().describe("17-digit SteamID64 (defaults to STEAM_ID env if set)."),
      limit: z.int().min(1).max(200).default(100).describe("Max games to return (default 100, max 200)."),
      offset: z.int().nonnegative().default(0).describe("Number of games to skip for pagination."),
      sort_by: z
        .enum(["playtime", "name", "recent"])
        .default("playtime")
        .describe("Sort order: playtime (desc), name (asc), or recent (by 2-week playtime)."),
    }),
    handler: async ({ steam }, { steamid, limit, offset, sort_by }) => {
      const sid = await steam.requireSteamId(steamid);
      const { game_count, games } = await steam.getOwnedGames(sid);
      if (sort_by === "name") games.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
      else if (sort_by === "recent") games.sort((a, b) => (b.playtime_2weeks ?? 0) - (a.playtime_2weeks ?? 0));
      else games.sort((a, b) => b.playtime_forever - a.playtime_forever);
      const page = games.slice(offset, offset + limit);
      return {
        steamid: sid,
        total_games: game_count,
        returned: page.length,
        offset,
        has_more: offset + page.length < game_count,
        games: page.map((g) => ({
          appid: g.appid,
          name: g.name,
          playtime_forever_hours: Math.round((g.playtime_forever / 60) * 10) / 10,
          playtime_2weeks_hours: g.playtime_2weeks ? Math.round((g.playtime_2weeks / 60) * 10) / 10 : undefined,
          has_achievements: g.has_community_visible_stats,
        })),
      };
    },
  },
  {
    name: "get_recently_played",
    title: "Get recently played games",
    description:
      "Get the games a player played in the last two weeks with playtime. Requires STEAM_API_KEY.",
    inputSchema: z.strictObject({
      steamid: steamid.optional().describe("17-digit SteamID64 (defaults to STEAM_ID env if set)."),
      count: z.int().min(1).max(50).default(10).describe("Max games to return (default 10, max 50)."),
    }),
    handler: async ({ steam }, { steamid, count }) => {
      const sid = await steam.requireSteamId(steamid);
      const { total_count, games } = await steam.getRecentlyPlayed(sid, count);
      return { steamid: sid, total_count, count: games.length, games };
    },
  },
  {
    name: "resolve_vanity_url",
    title: "Resolve vanity URL to SteamID64",
    description:
      "Convert a Steam vanity URL (custom profile name) to a 17-digit SteamID64 — e.g. 'gaben' " +
      "from steamcommunity.com/id/gaben. Requires STEAM_API_KEY.",
    inputSchema: z.strictObject({
      vanity_url: z
        .string()
        .trim()
        .min(1)
        .max(32)
        .describe("The vanity URL part, e.g. 'gaben' from steamcommunity.com/id/gaben."),
    }),
    handler: async ({ steam }, { vanity_url }) => {
      if (!/^[a-zA-Z0-9_-]{1,32}$/.test(vanity_url)) {
        throw Object.assign(new Error("Invalid vanity URL format. Use only letters, numbers, underscores and hyphens (1-32 characters)."), {
          code: "bad_request",
        });
      }
      const steamId = await steam.resolveVanityUrl(vanity_url);
      if (!steamId) {
        throw Object.assign(new Error("Vanity URL not found."), { code: "not_found" });
      }
      return { vanity_url, steam_id: steamId };
    },
  },
  {
    name: "get_player_achievements",
    title: "Get a player's achievements for a game",
    description:
      "Get a player's achievements for a specific game by appid, each merged with its global " +
      "unlock % (rarity) from the keyless endpoint. Private game details or an unowned game " +
      "return a clear explanation. Requires STEAM_API_KEY.",
    inputSchema: z.strictObject({
      steamid: steamid.optional().describe("17-digit SteamID64 (defaults to STEAM_ID env if set)."),
      app_id: z.int().positive().describe("Steam application ID."),
      language: z.string().trim().describe("Achievement display language (default: STEAM_LANGUAGE).").optional(),
    }),
    handler: async ({ steam }, { steamid, app_id, language }) => {
      const sid = await steam.requireSteamId(steamid);
      const res = await steam.getPlayerAchievements(sid, app_id, language);
      if (!res.found) {
        throw Object.assign(new Error(res.reason ?? "Achievements unavailable."), { code: "not_found" });
      }
      const unlocked = (res.achievements ?? []).filter((a) => a.achieved === true).length;
      return {
        steamid: sid,
        app_id,
        game_name: res.gameName,
        unlocked,
        total: res.achievements?.length ?? 0,
        completion_percent: (res.achievements?.length ?? 0) > 0 ? Math.round((unlocked / (res.achievements?.length ?? 1)) * 100) : 0,
        achievements: res.achievements,
      };
    },
  },
  {
    name: "get_achievement_summary",
    title: "Get achievement completion summary",
    description:
      "Get achievement completion % across a player's recently played games (or a specific list " +
      "of app_ids) in one call — a dev-portal style progress view. Requires STEAM_API_KEY.",
    inputSchema: z.strictObject({
      steamid: steamid.optional().describe("17-digit SteamID64 (defaults to STEAM_ID env if set)."),
      app_ids: z
        .array(z.int().positive())
        .max(50)
        .describe("Specific app IDs to check (max 50). If omitted, the 10 most recently played games are checked.")
        .optional(),
    }),
    handler: async ({ steam }, { steamid, app_ids }) => {
      const sid = await steam.requireSteamId(steamid);
      const { game_count, summaries } = await steam.getAchievementSummary(sid, app_ids);
      return { steamid: sid, game_count, summaries };
    },
  },
  {
    name: "get_cache_stats",
    title: "Get cache statistics",
    description:
      "Get the in-memory cache hit/miss statistics — the cache cuts repeat upstream API calls " +
      "70-85% (reviews and store data are cached for minutes to hours).",
    inputSchema: z.strictObject({}),
    handler: async (_ctx, _args) => {
      const stats = _ctx.cacheStats();
      return {
        ...stats,
        note: "Hits are upstream calls avoided entirely. A high hit rate means fewer Steam API calls.",
      };
    },
  },
];
