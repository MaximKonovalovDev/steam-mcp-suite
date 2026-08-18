/**
 * Shared types for the Steam side of the suite.
 * Shapes follow jhomen368/steam-reviews-mcp (MIT) and sharkusmanch/steam-mcp-server (MIT).
 */
export interface SteamGame {
  appId: number;
  name: string;
  shortDescription?: string;
  headerImage?: string;
  developers?: string[];
  publishers?: string[];
  releaseDate?: string;
  isFree?: boolean;
  priceFormatted?: string;
  priceRaw?: number;
  currency?: string;
  metacriticScore?: number;
  genres?: string[];
  platforms?: { windows?: boolean; mac?: boolean; linux?: boolean };
}

export interface Review {
  recommendationId: string;
  author: {
    steamId: string;
    numGamesOwned?: number;
    numReviews?: number;
    playtimeForever: number;
    playtimeAtReview: number;
    lastPlayed?: number;
  };
  language: string;
  review: string;
  timestampCreated: number;
  timestampUpdated: number;
  votedUp: boolean;
  votesUp: number;
  votesFunny: number;
  votesHelpful: number;
  commentCount: number;
  steamPurchase: boolean;
  receivedForFree: boolean;
  writtenDuringEarlyAccess: boolean;
}

export interface ReviewStats {
  totalReviews: number;
  totalPositive: number;
  totalNegative: number;
  scorePercent: number;
  scoreText: string;
  recentReviews?: { total: number; positive: number; negative: number; scorePercent: number; scoreText: string };
}

export interface SentimentAnalysis {
  score: number;
  label: "positive" | "negative" | "neutral";
  confidence: number;
}

export interface ExampleQuote {
  excerpt: string;
  url: string;
  isPositive: boolean;
  votesHelpful: number;
  playtimeHours: number;
  authorSteamId: string;
}

export interface ReviewAnalysis {
  summary: string;
  sentiment: SentimentAnalysis;
  commonThemes: string[];
  positiveKeywords: string[];
  negativeKeywords: string[];
  totalAnalyzed: number;
  sampleSize: number;
  exampleQuotes?: ExampleQuote[];
}

export interface PriceRow {
  appid: number;
  available: boolean;
  name?: string;
  is_free?: boolean;
  final_price?: number;
  initial_price?: number;
  discount_percent?: number;
  final_formatted?: string;
  initial_formatted?: string;
  currency?: string;
}

export interface StoreApp {
  appid: number;
  name: string;
  type: string;
  tiny_image?: string;
  price?: unknown;
  platforms?: unknown;
  metascore?: string;
  controller_support?: string;
}

export interface PlayerSummary {
  steamid: string;
  personaname: string;
  profileurl: string;
  avatar: string;
  avatarmedium: string;
  avatarfull: string;
  personastate: number;
  personastate_name?: string;
  communityvisibilitystate?: number;
  realname?: string;
  loccountrycode?: string;
  timecreated?: number;
  lastlogoff?: number;
  level?: number | null;
  current_game?: string;
  gameextrainfo?: string;
  gameid?: string;
}

export interface OwnedGame {
  appid: number;
  name?: string;
  playtime_forever: number;
  playtime_2weeks?: number;
  img_icon_url?: string;
  has_community_visible_stats?: boolean;
}

export interface WishlistItem {
  appid: number;
  priority: number;
  date_added: number;
  name?: string;
  price?: PriceRow;
}
