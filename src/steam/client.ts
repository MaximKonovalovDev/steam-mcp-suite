/**
 * SteamClient — storefront + reviews + Web API access for the suite.
 *
 * Intents merged from three MIT seeds:
 *  - Grinv/steam-games-mcp: keyless storefront design (storesearch, appdetails,
 *    featured, appreviews), keyless-caveat endpoints (news, global achievement %,
 *    current players, wishlist), cc/l region handling.
 *  - jhomen368/steam-reviews-mcp: review fetch/normalize, cached reviews.
 *  - sharkusmanch/steam-mcp-server: Web API surface (player summaries, owned
 *    games, recently played, achievements, vanity resolution), pagination.
 *
 * Player data endpoints need STEAM_API_KEY; store/review/news tools work
 * without it (the key is attached when present — Valve's docs say a key is
 * required, several endpoints currently answer either way).
 */
import { AppError, keyMissingError } from "../errors.js";
import { HttpClient, pool } from "../lib/http.js";
import type { Config } from "../config.js";
import type {
  OwnedGame,
  PlayerSummary,
  PriceRow,
  Review,
  ReviewStats,
  SteamGame,
  StoreApp,
  WishlistItem,
} from "./types.js";

const STEAM_API_BASE = "https://api.steampowered.com";
const STEAM_STORE_BASE = "https://store.steampowered.com";
const STEAMID64_RE = /^\d{17}$/;

/** Cache TTLs (ms) — from jhomen368's config defaults (MIT). */
export const TTL = {
  reviews: 15 * 60_000, // 15 min
  gameInfo: 2 * 60 * 60_000, // 2 hours
  statistics: 5 * 60_000, // 5 min
  analysis: 30 * 60_000, // 30 min
  storefront: 10 * 60_000, // 10 min
};

export interface ReviewsOptions {
  filter?: "all" | "recent" | "updated";
  language?: string;
  reviewType?: "all" | "positive" | "negative";
  purchaseType?: "all" | "steam" | "non_steam_purchase";
  limit?: number;
  cursor?: string;
  dayRange?: number;
  filterOfftopicActivity?: boolean;
}

interface AppReviewsRaw {
  success: number;
  query_summary?: {
    num_reviews: number;
    review_score: number;
    review_score_desc: string;
    total_positive: number;
    total_negative: number;
    total_reviews: number;
  };
  reviews?: RawReview[];
  cursor?: string;
}

interface RawReview {
  recommendationid: string;
  author: {
    steamid: string;
    num_games_owned: number;
    num_reviews: number;
    playtime_forever: number;
    playtime_at_review: number;
    last_played: number;
  };
  language: string;
  review: string;
  timestamp_created: number;
  timestamp_updated: number;
  voted_up: boolean;
  votes_up: number;
  votes_funny: number;
  comment_count: number;
  steam_purchase: boolean;
  received_for_free: boolean;
  written_during_early_access: boolean;
}

interface AppDetailsRaw {
  [appid: string]: {
    success: boolean;
    data?: {
      steam_appid: number;
      name: string;
      short_description?: string;
      detailed_description?: string;
      header_image?: string;
      developers?: string[];
      publishers?: string[];
      is_free?: boolean;
      release_date?: { date?: string; coming_soon?: boolean };
      metacritic?: { score?: number };
      genres?: Array<{ description: string }>;
      platforms?: { windows?: boolean; mac?: boolean; linux?: boolean };
      price_overview?: {
        currency: string;
        final: number;
        initial: number;
        discount_percent: number;
        final_formatted: string;
        initial_formatted?: string;
      };
      pc_requirements?: { minimum?: string; recommended?: string };
      dlc?: number[];
    };
  };
}

export class SteamClient {
  private readonly config: Config;
  private readonly api: HttpClient;
  private readonly store: HttpClient;

  constructor(config: Config, api: HttpClient, store: HttpClient) {
    this.config = config;
    this.api = api;
    this.store = store;
  }

  /** True when a Steam Web API key is configured; player tools degrade otherwise. */
  get keyed(): boolean {
    return Boolean(this.config.steamApiKey);
  }

  private requireKey(): void {
    if (!this.config.steamApiKey) throw keyMissingError();
  }

  /** Resolve the SteamID64 a player tool acts on: explicit arg, else STEAM_ID env. */
  async requireSteamId(explicit?: string): Promise<string> {
    if (explicit) return explicit;
    const raw = this.config.defaultSteamId;
    if (!raw) {
      throw new AppError(
        "bad_request",
        "no steamid was given and STEAM_ID is not set. Pass a 17-digit SteamID64, or set " +
          "STEAM_ID (a SteamID64 or vanity name) in the server config.",
      );
    }
    if (STEAMID64_RE.test(raw)) return raw;
    // Vanity name: needs the key to resolve.
    this.requireKey();
    const res = await this.api.getJson<{ response: { success: number; steamid?: string } }>(
      `${STEAM_API_BASE}/ISteamUser/ResolveVanityURL/v1/`,
      { query: { vanityurl: raw }, cacheKey: `vanity:${raw}`, cacheTtlMs: TTL.statistics },
    );
    if (res.response?.success === 1 && res.response.steamid) return res.response.steamid;
    throw new AppError("bad_request", `could not resolve STEAM_ID vanity name "${raw}" to a SteamID64`);
  }

  private apiGet<T>(path: string, query: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.api.getJson<T>(`${STEAM_API_BASE}/${path}`, { query });
  }

  // ---------------------------------------------------------------- store ---

  /** Relevance-ranked storefront search (keyless, top ~10 matches). */
  async searchGames(term: string, cc = this.config.country, l = this.config.language): Promise<{ store_total: number; apps: StoreApp[] }> {
    const data = await this.store.getJson<{ total?: number; items?: Array<Record<string, unknown> & { id: number | string; name: string; type?: string }> }>(
      `${STEAM_STORE_BASE}/api/storesearch/`,
      { query: { term, cc, l }, cacheKey: `search:${term}:${cc}`, cacheTtlMs: TTL.gameInfo },
    );
    const items = data.items ?? [];
    const apps: StoreApp[] = items
      .filter((item) => item.type === "app" && item.name)
      .map((item) => ({
        appid: Number(item.id),
        name: String(item.name),
        type: item.type ?? "app",
        tiny_image: item.tiny_image as string | undefined,
        price: item.price,
        platforms: item.platforms,
        metascore: item.metascore as string | undefined,
        controller_support: item.controller_support as string | undefined,
      }));
    return { store_total: data.total ?? apps.length, apps };
  }

  /** Resolve a game title to its appid via storefront search (first match). */
  async resolveAppId(name: string, cc = this.config.country, l = this.config.language): Promise<number | null> {
    const { apps } = await this.searchGames(name, cc, l);
    if (apps.length === 0) return null;
    const exact = apps.find((a) => a.name.toLowerCase() === name.toLowerCase());
    return (exact ?? apps[0]).appid;
  }

  /** Full store card for one game by appid or name. */
  async getGameDetails(appidOrName: number | string, cc = this.config.country, l = this.config.language): Promise<Record<string, unknown>> {
    let appid: number;
    if (typeof appidOrName === "string") {
      const resolved = await this.resolveAppId(appidOrName, cc, l);
      if (!resolved) throw new AppError("not_found", `No Steam game found matching "${appidOrName}".`);
      appid = resolved;
    } else {
      appid = appidOrName;
    }

    const raw = await this.store.getJson<AppDetailsRaw>(
      `${STEAM_STORE_BASE}/api/appdetails`,
      { query: { appids: appid, cc, l }, cacheKey: `game:${appid}:${cc}:${l}`, cacheTtlMs: TTL.gameInfo },
    );
    const entry = raw[String(appid)];
    if (!entry?.success || !entry.data) {
      throw new AppError("not_found", `No Steam app with id ${appid}`);
    }
    const d = entry.data;
    const price = d.price_overview;
    return {
      appid: d.steam_appid,
      name: d.name,
      short_description: d.short_description,
      detailed_description: d.detailed_description ? d.detailed_description.slice(0, 3000) : undefined,
      header_image: d.header_image,
      store_url: `https://store.steampowered.com/app/${d.steam_appid}`,
      is_free: d.is_free,
      price: price
        ? {
            currency: price.currency,
            final: price.final,
            initial: price.initial,
            discount_percent: price.discount_percent,
            final_formatted: price.final_formatted,
            initial_formatted: price.initial_formatted ?? price.final_formatted,
          }
        : undefined,
      platforms: d.platforms,
      metacritic: d.metacritic?.score,
      genres: d.genres?.map((g) => g.description),
      developers: d.developers,
      publishers: d.publishers,
      release_date: d.release_date?.date,
      coming_soon: d.release_date?.coming_soon,
      pc_requirements: d.pc_requirements
        ? {
            minimum: d.pc_requirements.minimum?.slice(0, 1200),
            recommended: d.pc_requirements.recommended?.slice(0, 1200),
          }
        : undefined,
      dlc_count: d.dlc?.length ?? 0,
    };
  }

  /** Batch price/discount check (one call per appid internally, pooled, cached). */
  async getPrices(appids: number[], cc = this.config.country): Promise<{ returned: number; prices: PriceRow[] }> {
    const rows = await pool(appids, 8, async (appid) => {
      try {
        const raw = await this.store.getJson<AppDetailsRaw>(
          `${STEAM_STORE_BASE}/api/appdetails`,
          { query: { appids: appid, cc, l: "english" }, cacheKey: `price:${appid}:${cc}`, cacheTtlMs: TTL.gameInfo },
        );
        const entry = raw[String(appid)];
        if (!entry?.success || !entry.data) return { appid, available: false } as PriceRow;
        const d = entry.data;
        const p = d.price_overview;
        return {
          appid,
          available: true,
          name: d.name,
          is_free: d.is_free,
          final_price: p?.final,
          initial_price: p?.initial,
          discount_percent: p?.discount_percent ?? 0,
          final_formatted: p?.final_formatted,
          initial_formatted: p?.initial_formatted,
          currency: p?.currency,
        } as PriceRow;
      } catch {
        return { appid, available: false } as PriceRow;
      }
    });
    return { returned: rows.filter((r) => r.available).length, prices: rows };
  }

  /** Current front-page specials (discounted games) — keyless. */
  async getSpecials(cc = this.config.country, l = this.config.language): Promise<{ returned: number; deals: Array<Record<string, unknown>> }> {
    const data = await this.store.getJson<{ specials?: { items?: Array<Record<string, unknown>> } }>(
      `${STEAM_STORE_BASE}/api/featuredcategories/`,
      { query: { cc, l }, cacheKey: `specials:${cc}:${l}`, cacheTtlMs: TTL.storefront },
    );
    const deals = (data.specials?.items ?? []).map((deal) => ({
      appid: deal.id,
      name: deal.name,
      url: `https://store.steampowered.com/app/${deal.id}`,
      large_capsule_image: deal.large_capsule_image,
      discount_percent: deal.discount_percent,
      original_price: deal.original_price,
      final_price: deal.final_price,
      currency: deal.currency,
      discount_expiration: deal.discount_expiration
        ? new Date(Number(deal.discount_expiration) * 1000).toISOString()
        : undefined,
    }));
    deals.sort((a, b) => Number(b.discount_percent) - Number(a.discount_percent));
    return { returned: deals.length, deals };
  }

  // ------------------------------------------------------------- reviews ---

  /** Review summary (score label + totals + %). Cached 15 min. */
  async getReviewSummary(appid: number): Promise<ReviewStats | null> {
    const data = await this.store.getJson<AppReviewsRaw>(
      `${STEAM_STORE_BASE}/appreviews/${appid}`,
      { query: { json: 1, purchase_type: "all", language: "all", num_per_page: 0 }, cacheKey: `review-summary:${appid}`, cacheTtlMs: TTL.reviews },
    );
    if (data.success !== 1 || !data.query_summary) return null;
    const s = data.query_summary;
    return {
      totalReviews: s.total_reviews,
      totalPositive: s.total_positive,
      totalNegative: s.total_negative,
      scorePercent: s.total_reviews > 0 ? Math.round((s.total_positive / s.total_reviews) * 100) : 0,
      scoreText: s.review_score_desc,
    };
  }

  /** Fetch reviews (filtered, paginated). Only first-page calls are cached. */
  async getAppReviews(appid: number, options: ReviewsOptions = {}): Promise<{ reviews: Review[]; cursor: string | null; hasMore: boolean }> {
    const params: Record<string, string> = {
      json: "1",
      filter: options.filter || "all",
      language: options.language || "all",
      review_type: options.reviewType || "all",
      purchase_type: options.purchaseType || "all",
      num_per_page: String(Math.min(options.limit || 20, 100)),
    };
    if (options.cursor) params.cursor = options.cursor;
    if (options.dayRange) params.day_range = String(options.dayRange);
    if (options.filterOfftopicActivity !== undefined) {
      params.filter_offtopic_activity = options.filterOfftopicActivity ? "1" : "0";
    }
    const cacheKey = options.cursor
      ? undefined
      : `reviews:${appid}:${params.filter}:${params.language}:${params.review_type}:${params.purchase_type}:${params.num_per_page}:${params.day_range ?? ""}:${params.filter_offtopic_activity ?? ""}`;

    const data = await this.store.getJson<AppReviewsRaw>(
      `${STEAM_STORE_BASE}/appreviews/${appid}`,
      { query: params, cacheKey, cacheTtlMs: TTL.reviews },
    );
    if (data.success !== 1) return { reviews: [], cursor: null, hasMore: false };
    const reviews = (data.reviews ?? []).map((r) => ({
      recommendationId: r.recommendationid,
      author: {
        steamId: r.author.steamid,
        numGamesOwned: r.author.num_games_owned,
        numReviews: r.author.num_reviews,
        playtimeForever: r.author.playtime_forever,
        playtimeAtReview: r.author.playtime_at_review,
        lastPlayed: r.author.last_played,
      },
      language: r.language,
      review: r.review,
      timestampCreated: r.timestamp_created,
      timestampUpdated: r.timestamp_updated,
      votedUp: r.voted_up,
      votesUp: r.votes_up,
      votesFunny: r.votes_funny,
      votesHelpful: r.votes_up,
      commentCount: r.comment_count,
      steamPurchase: r.steam_purchase,
      receivedForFree: r.received_for_free,
      writtenDuringEarlyAccess: r.written_during_early_access,
    }));
    return { reviews, cursor: data.cursor || null, hasMore: reviews.length === Math.min(options.limit || 20, 100) };
  }

  /** Fetch a sample of reviews (cached 15 min) for analysis. */
  async fetchReviewSample(appid: number, sampleSize: number, options: Omit<ReviewsOptions, "limit" | "cursor"> = {}): Promise<Review[]> {
    const first = await this.getAppReviews(appid, { ...options, limit: Math.min(sampleSize, 100) });
    let reviews = first.reviews;
    if (sampleSize > 100 && first.cursor) {
      const remaining = sampleSize - reviews.length;
      const page2 = await this.getAppReviews(appid, { ...options, limit: Math.min(remaining, 100), cursor: first.cursor });
      reviews = [...reviews, ...page2.reviews];
    }
    return reviews;
  }

  // -------------------------------------------------- keyless web API ------

  /** Recent news / patch notes (keyless — Valve requires a key per docs; currently answers either way). */
  async getNews(appid: number, count: number): Promise<{ count: number; items: Array<Record<string, unknown>> }> {
    try {
      const data = await this.apiGet<{ appnews?: { newsitems?: Array<Record<string, unknown>> } }>(
        "ISteamNews/GetNewsForApp/v2/",
        { appid, count, maxlength: 400 },
      );
      const items = (data.appnews?.newsitems ?? []).map((n) => ({
        title: n.title,
        url: n.url,
        author: n.author,
        date: new Date(Number(n.date) * 1000).toISOString(),
        contents: String(n.contents ?? "").slice(0, 500),
        feed: n.feedlabel,
      }));
      return { count: items.length, items };
    } catch (e) {
      // A large/unassigned appid makes Steam answer 403 — degrade to empty list.
      if (e instanceof AppError && (e.code === "auth" || e.code === "not_found")) {
        return { count: 0, items: [] };
      }
      throw e;
    }
  }

  /** Live concurrent player count (keyless). */
  async getCurrentPlayers(appid: number): Promise<{ app_id: number; current_players: number }> {
    try {
      const data = await this.apiGet<{ response?: { player_count?: number; result?: number } }>(
        "ISteamUserStats/GetNumberOfCurrentPlayers/v1/",
        { appid },
      );
      if (data.response?.result !== 1) {
        throw new AppError("not_found", `No Steam app with id ${appid}`);
      }
      return { app_id: appid, current_players: data.response.player_count ?? 0 };
    } catch (e) {
      if (e instanceof AppError && e.code === "not_found") throw e;
      throw new AppError("not_found", `No Steam app with id ${appid}`);
    }
  }

  /** Global achievement unlock % (keyless), rarest-first. */
  async getGlobalAchievements(appid: number): Promise<{ count: number; achievements: Array<{ name: string; percent: number }> }> {
    try {
      const data = await this.apiGet<{ achievementpercentages?: { achievements?: Array<{ name: string; percent: number }> } }>(
        "ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/",
        { gameid: appid },
      );
      const list = (data.achievementpercentages?.achievements ?? [])
        .map((a) => ({ name: a.name, percent: a.percent }))
        .sort((a, b) => b.percent - a.percent);
      return { count: list.length, achievements: list };
    } catch (e) {
      // No achievement schema (e.g. a DLC/soundtrack) → clean empty list.
      if (e instanceof AppError && ["auth", "bad_request", "not_found", "upstream"].includes(e.code)) {
        return { count: 0, achievements: [] };
      }
      throw e;
    }
  }

  /** A player's wishlist (keyless; profile must be public). */
  async getWishlist(steamid: string, includeDetails: boolean): Promise<{ found: boolean; wishlist_count: number; items: WishlistItem[] }> {
    let data: { response?: { items?: Array<{ appid: number; priority: number; date_added: number }> } };
    try {
      data = await this.apiGet(
        "IWishlistService/GetWishlist/v1/",
        { steamid },
      );
    } catch (e) {
      if (e instanceof AppError && (e.code === "auth" || e.code === "bad_request" || e.code === "not_found")) {
        return { found: false, wishlist_count: 0, items: [] };
      }
      throw e;
    }
    const items: WishlistItem[] = (data.response?.items ?? []).map((i) => ({ appid: i.appid, priority: i.priority, date_added: i.date_added }));
    if (items.length === 0) return { found: false, wishlist_count: 0, items: [] };

    if (includeDetails) {
      const { prices } = await this.getPrices(items.map((i) => i.appid));
      const byId = new Map(prices.map((p) => [p.appid, p]));
      for (const item of items) {
        const row = byId.get(item.appid);
        if (row?.available) {
          item.name = row.name;
          item.price = row;
        }
      }
    }
    return { found: true, wishlist_count: items.length, items };
  }

  // ------------------------------------------------------ keyed (player) ----

  async getPlayerSummary(steamid: string): Promise<PlayerSummary | null> {
    this.requireKey();
    const [res, levelRes] = await Promise.all([
      this.apiGet<{ response?: { players?: PlayerSummary[] } }>("ISteamUser/GetPlayerSummaries/v2/", { steamids: steamid }),
      this.apiGet<{ response?: { player_level?: number } }>("IPlayerService/GetSteamLevel/v1/", { steamid }).catch(() => null),
    ]);
    const players = res.response?.players ?? [];
    if (players.length === 0) return null;
    const p = players[0];
    const states: Record<number, string> = {
      0: "Offline", 1: "Online", 2: "Busy", 3: "Away", 4: "Snooze", 5: "Looking to trade", 6: "Looking to play",
    };
    return {
      ...p,
      personastate_name: states[p.personastate] ?? "Unknown",
      level: levelRes?.response?.player_level ?? null,
      current_game: p.gameextrainfo ? `${p.gameextrainfo}${p.gameid ? ` (app ${p.gameid})` : ""}` : undefined,
    };
  }

  async getOwnedGames(steamid: string): Promise<{ game_count: number; games: OwnedGame[] }> {
    this.requireKey();
    const data = await this.apiGet<{ response?: { game_count?: number; games?: OwnedGame[] } }>(
      "IPlayerService/GetOwnedGames/v1/",
      { steamid, include_appinfo: true, include_played_free_games: true },
    ).catch((e) => {
      // A malformed/out-of-range steamid can answer raw HTTP 400.
      if (e instanceof AppError && e.code === "bad_request") {
        throw new AppError("not_found", "Profile is private or the steamid doesn't exist.");
      }
      throw e;
    });
    const games = data.response?.games ?? [];
    if ((data.response?.game_count === undefined || data.response.game_count === 0) && games.length === 0) {
      throw new AppError("not_found", "Profile is private or the steamid doesn't exist.");
    }
    return { game_count: data.response?.game_count ?? games.length, games };
  }

  async getRecentlyPlayed(steamid: string, count: number): Promise<{ total_count: number; games: Array<Record<string, unknown>> }> {
    this.requireKey();
    const data = await this.apiGet<{ response?: { total_count?: number; games?: Array<Record<string, unknown>> } }>(
      "IPlayerService/GetRecentlyPlayedGames/v1/",
      { steamid, count },
    );
    const games = (data.response?.games ?? []).map((g) => ({
      appid: g.appid,
      name: g.name,
      playtime_2weeks_minutes: g.playtime_2weeks,
      playtime_2weeks_hours: Math.round(Number(g.playtime_2weeks) / 60 * 10) / 10,
      playtime_forever_hours: Math.round(Number(g.playtime_forever) / 60 * 10) / 10,
    }));
    return { total_count: data.response?.total_count ?? games.length, games };
  }

  async resolveVanityUrl(vanity: string): Promise<string | null> {
    this.requireKey();
    const data = await this.apiGet<{ response?: { success: number; steamid?: string } }>(
      "ISteamUser/ResolveVanityURL/v1/",
      { vanityurl: vanity },
    );
    return data.response?.success === 1 ? (data.response.steamid ?? null) : null;
  }

  /** A player's achievements for a game, merged with global rarity (keyed). */
  async getPlayerAchievements(
    steamid: string,
    appid: number,
    language?: string,
  ): Promise<{ found: boolean; reason?: string; gameName?: string; achievements?: Array<Record<string, unknown>>; global?: Array<{ name: string; percent: number }> }> {
    this.requireKey();
    const l = language ?? this.config.language;
    let data: { playerstats?: { success?: boolean; steamID?: string; gameName?: string; achievements?: Array<Record<string, unknown>>; error?: string } };
    try {
      data = await this.apiGet("ISteamUserStats/GetPlayerAchievements/v1/", { steamid, appid, l });
    } catch (e) {
      if (e instanceof AppError && (e.code === "auth" || e.code === "bad_request" || e.code === "not_found")) {
        // Disambiguate: does the game even have achievements?
        try {
          const schema = await this.apiGet<{ game?: { availableGameStats?: { achievements?: unknown[] } } }>(
            "ISteamUserStats/GetSchemaForGame/v2/",
            { appid, l },
          );
          const has = (schema.game?.availableGameStats?.achievements?.length ?? 0) > 0;
          return {
            found: false,
            reason: has
              ? "This game has achievements, but the player's data is hidden (private game-details, or they don't own it)."
              : "This game has no achievements.",
          };
        } catch {
          return { found: false, reason: "Achievements unavailable for this profile/game." };
        }
      }
      throw e;
    }
    const ps = data.playerstats;
    if (!ps?.success) {
      return {
        found: false,
        reason: ps?.error && /not public|private/i.test(ps.error)
          ? "The profile's game details are private."
          : "Achievements unavailable for this profile/game.",
      };
    }
    let global: Array<{ name: string; percent: number }> = [];
    try {
      global = (await this.getGlobalAchievements(appid)).achievements;
    } catch {
      global = [];
    }
    const globalBy = new Map(global.map((g) => [g.name, g.percent]));
    const achievements = (ps.achievements ?? []).map((a: Record<string, unknown>) => ({
      name: a.name,
      display_name: a.displayName,
      description: a.description,
      achieved: a.achieved === 1,
      unlocktime: Number(a.unlocktime),
      global_unlock_percent: globalBy.get(String(a.name)),
    }));
    return { found: true, gameName: ps.gameName, achievements };
  }

  /** Completion % across a player's recently played (or given) games (keyed). */
  async getAchievementSummary(
    steamid: string,
    appIds?: number[],
  ): Promise<{ game_count: number; summaries: Array<{ appid: number; name?: string; unlocked: number; total: number; percent: number }> }> {
    this.requireKey();
    let gamesToCheck: Array<{ appid: number; name?: string }>;
    if (appIds && appIds.length > 0) {
      gamesToCheck = appIds.map((appid) => ({ appid }));
    } else {
      const recent = await this.getRecentlyPlayed(steamid, 10);
      gamesToCheck = recent.games.map((g) => ({ appid: Number(g.appid), name: String(g.name) }));
    }
    const summaries = await pool(gamesToCheck, 10, async (game) => {
      try {
        const res = await this.getPlayerAchievements(steamid, game.appid);
        if (res.found && res.achievements && res.achievements.length > 0) {
          const total = res.achievements.length;
          const unlocked = res.achievements.filter((a) => a.achieved === true).length;
          return {
            appid: game.appid,
            name: game.name ?? res.gameName,
            unlocked,
            total,
            percent: Math.round((unlocked / total) * 100),
          };
        }
      } catch {
        // Game has no achievements or profile is private for it — skip.
      }
      return null;
    });
    const kept = summaries.filter((s): s is NonNullable<typeof s> => s !== null);
    return { game_count: kept.length, summaries: kept };
  }
}
