/**
 * Keyless store tools — search, details, prices, discounts, reviews + NLP
 * sentiment (cached), news, live players, achievement rarity. Intents from
 * Grinv/steam-games-mcp and jhomen368/steam-reviews-mcp (both MIT).
 */
import { z } from "zod";
import { summarizeReviews, analyzeTopicFocused } from "../steam/analysis.js";
import type { ToolSpec } from "./registry.js";

const appid = z.int().positive().describe("Steam appid (get it from search_games).");
const country = z.string().trim().min(2).max(2).default("US").describe("ISO country code for prices (default: STEAM_COUNTRY or US).");
const language = z.string().trim().min(2).default("english").describe("Store language (default: STEAM_LANGUAGE or english).");

export const storeTools: ToolSpec[] = [
  {
    name: "search_games",
    title: "Search games",
    description:
      "Search the Steam store by title — term can be partial or approximate. Returns matches with " +
      "appid (needed by the other game tools), name, price, Metacritic score, platforms and type " +
      "(game/dlc/...). Steam returns only the top ~10 ranked matches (no pagination) — refine the " +
      "term if the game you want isn't listed. No API key required.",
    inputSchema: z.strictObject({
      term: z.string().trim().min(1).describe("Game title to search for."),
      country,
      language,
    }),
    handler: async ({ steam }, { term, country: cc, language: l }) => {
      const { store_total, apps } = await steam.searchGames(term, cc, l);
      return {
        query: term,
        store_total,
        returned: apps.length,
        note: "Steam returns only the top-ranked storefront matches; refine the query for more specific results.",
        apps,
      };
    },
  },
  {
    name: "get_game",
    title: "Get game details",
    description:
      "Get the full store card for one game: description, price/discount, platforms, genres, " +
      "developers, publishers, release date, Metacritic, PC requirements and DLC count. Identify " +
      "the game by appid OR by name (a title is resolved to the closest store match). " +
      "No API key required.",
    inputSchema: z
      .strictObject({
        appid: appid.describe("Steam appid (from search_games). Provide appid OR name.").optional(),
        name: z
          .string()
          .trim()
          .min(1)
          .describe("Game title to look up instead of an appid — resolved to the closest store match. Provide appid OR name; appid wins if both are given.")
          .optional(),
        country,
        language,
      })
      .refine((input) => input.appid !== undefined || input.name !== undefined, {
        message: "Provide either appid or name.",
      }),
    handler: async ({ steam }, { appid: id, name, country: cc, language: l }) => {
      return steam.getGameDetails(id ?? (name as string), cc, l);
    },
  },
  {
    name: "get_prices",
    title: "Get prices for many games",
    description:
      "Get current price and discount for a batch of games by appid in ONE call — efficient for " +
      "checking a whole list (e.g. a wishlist) for deals. Handles up to 500 appids; rows come back " +
      "in the same order as the given appids, one per id (unavailable ones marked available:false, " +
      "never dropped). Each row has final/initial price, discount_percent and currency (or is_free). " +
      "No API key required.",
    inputSchema: z.strictObject({
      appids: z.array(z.int().positive()).min(1).max(500).describe("Steam appids to price (1-500)."),
      country,
    }),
    handler: async ({ steam }, { appids, country: cc }) => {
      return steam.getPrices(appids, cc);
    },
  },
  {
    name: "get_specials",
    title: "Get current discounts",
    description:
      "List games currently on special (discounted) on the Steam store front page, sorted by " +
      "discount %, with the discount % and original/final price. No API key required.",
    inputSchema: z.strictObject({ country, language }),
    handler: async ({ steam }, { country: cc, language: l }) => {
      return steam.getSpecials(cc, l);
    },
  },
  {
    name: "get_game_reviews",
    title: "Get game reviews",
    description:
      "Get the review summary (score label, positive/negative counts, %) and a few recent review " +
      "excerpts for a game by appid. Review text over 600 characters is truncated. For NLP " +
      "sentiment analysis and themes, use analyze_reviews instead. Results are cached 15 minutes. " +
      "No API key required.",
    inputSchema: z.strictObject({
      appid,
      limit: z.int().positive().max(20).default(5).describe("How many recent reviews (1-20). Default 5."),
      review_language: z.string().trim().default("all").describe("Filter reviews by language, e.g. 'english'. Default 'all'."),
      type: z
        .enum(["all", "positive", "negative"])
        .default("all")
        .describe("Only positive or negative reviews. Steam only computes the summary for 'all'."),
    }),
    handler: async ({ steam }, { appid: id, limit, review_language, type }) => {
      const [summary, fetched] = await Promise.all([
        steam.getReviewSummary(id),
        steam.getAppReviews(id, { limit, language: review_language, reviewType: type }),
      ]);
      const reviews = fetched.reviews.map((r) => ({
        recommended: r.votedUp,
        votesHelpful: r.votesHelpful,
        playtime_hours_at_review: Math.round(r.author.playtimeAtReview / 60),
        language: r.language,
        date: new Date(r.timestampCreated * 1000).toISOString().slice(0, 10),
        excerpt: r.review.length > 600 ? r.review.slice(0, 600) + "..." : r.review,
        url: `https://steamcommunity.com/profiles/${r.author.steamId}/recommended/${id}/`,
      }));
      return {
        appid: id,
        summary: type === "all" ? summary : null,
        returned: reviews.length,
        reviews,
      };
    },
  },
  {
    name: "analyze_reviews",
    title: "Analyze reviews (sentiment + themes)",
    description:
      "Fetch a sample of a game's reviews and run NLP analysis: overall sentiment score (-1..1) " +
      "with label and confidence, positive/negative keyword extraction, common themes, and " +
      "clickable example quotes from the most helpful positive and negative reviews. Optional " +
      "`topic` drills into reviews mentioning a specific theme (e.g. 'performance', 'multiplayer'). " +
      "Review fetches are cached 15 minutes. No API key required.",
    inputSchema: z.strictObject({
      appid,
      sample_size: z.int().min(10).max(200).default(50).describe("Number of reviews to analyze (10-200). Default 50."),
      topic: z
        .string()
        .trim()
        .min(1)
        .describe("Optional: only analyze reviews mentioning this topic/keyword, e.g. 'performance'.")
        .optional(),
      language: z.string().trim().describe("Filter reviews by language, e.g. 'english' (default: all).").optional(),
      review_type: z.enum(["all", "positive", "negative"]).default("all").describe("Analyze only positive or negative reviews (default all)."),
      day_range: z.int().positive().describe("Only analyze reviews from the last N days.").optional(),
    }),
    handler: async ({ steam }, { appid: id, sample_size, topic, language, review_type, day_range }) => {
      const reviews = await steam.fetchReviewSample(id, sample_size, {
        language,
        reviewType: review_type,
        dayRange: day_range,
      });
      if (reviews.length === 0) {
        return {
          appid: id,
          error: "No reviews found",
          details: "No reviews were found for the specified game and filters.",
        };
      }
      const analysis = topic ? analyzeTopicFocused(reviews, topic, id) : summarizeReviews(reviews, id);
      return { appid: id, ...analysis };
    },
  },
  {
    name: "get_game_news",
    title: "Get game news",
    description:
      "Get recent news / patch notes for a game by appid (title, date, author, excerpt, link). " +
      "An unknown or unassigned appid comes back as an empty list rather than an error. " +
      "No API key required.",
    inputSchema: z.strictObject({
      appid,
      limit: z.int().positive().max(20).default(5).describe("How many news items (1-20). Default 5."),
    }),
    handler: async ({ steam }, { appid: id, limit }) => {
      return { appid: id, ...(await steam.getNews(id, limit)) };
    },
  },
  {
    name: "get_current_players",
    title: "Get current player count",
    description:
      "Get how many people are playing a game right now (live concurrent player count) by appid. " +
      "Errors clearly if the appid is unknown rather than returning a null count. No API key required.",
    inputSchema: z.strictObject({ appid }),
    handler: async ({ steam }, { appid: id }) => {
      return steam.getCurrentPlayers(id);
    },
  },
  {
    name: "get_global_achievements",
    title: "Get global achievement rates",
    description:
      "Get the global unlock percentage of each achievement in a game by appid — how rare each " +
      "achievement is across all players, rarest first. An appid with no achievement schema " +
      "(e.g. a DLC/soundtrack) comes back as an empty list. No API key required.",
    inputSchema: z.strictObject({ appid }),
    handler: async ({ steam }, { appid: id }) => {
      return { appid: id, ...(await steam.getGlobalAchievements(id)) };
    },
  },
];
