/**
 * NLP sentiment analysis and review summarization.
 *
 * Ported from jhomen368/steam-reviews-mcp (MIT) — AFINN lexicon via the
 * `natural` library: per-review and aggregate sentiment scores, keyword
 * extraction, topic-focused drill-down, and clickable example quotes.
 */
import natural from "natural";
import type { Review, SentimentAnalysis, ReviewAnalysis, ExampleQuote } from "./types.js";

const { SentimentAnalyzer, PorterStemmer } = natural;

const MAX_EXCERPT_LENGTH = 200;
const MAX_EXAMPLE_QUOTES = 5;

export function generateReviewUrl(steamId: string, appId: number): string {
  return `https://steamcommunity.com/profiles/${steamId}/recommended/${appId}/`;
}

function truncateText(text: string, maxLength: number = MAX_EXCERPT_LENGTH): string {
  if (text.length <= maxLength) return text;
  const breakPoint = text.lastIndexOf(" ", maxLength - 3);
  if (breakPoint > maxLength / 2) return text.substring(0, breakPoint) + "...";
  return text.substring(0, maxLength - 3) + "...";
}

export function selectExampleQuotes(
  reviews: Review[],
  appId: number,
  maxQuotes: number = MAX_EXAMPLE_QUOTES,
): ExampleQuote[] {
  if (reviews.length === 0) return [];

  const positiveReviews = reviews.filter((r) => r.votedUp);
  const negativeReviews = reviews.filter((r) => !r.votedUp);
  const sortedPositive = [...positiveReviews].sort((a, b) => b.votesHelpful - a.votesHelpful);
  const sortedNegative = [...negativeReviews].sort((a, b) => b.votesHelpful - a.votesHelpful);

  const quotes: ExampleQuote[] = [];
  const positiveCount = Math.ceil(maxQuotes / 2);
  const negativeCount = maxQuotes - positiveCount;

  for (let i = 0; i < Math.min(positiveCount, sortedPositive.length); i++) {
    const review = sortedPositive[i];
    quotes.push({
      excerpt: truncateText(review.review.trim()),
      url: generateReviewUrl(review.author.steamId, appId),
      isPositive: true,
      votesHelpful: review.votesHelpful,
      playtimeHours: Math.round(review.author.playtimeAtReview / 60),
      authorSteamId: review.author.steamId,
    });
  }
  for (let i = 0; i < Math.min(negativeCount, sortedNegative.length); i++) {
    const review = sortedNegative[i];
    quotes.push({
      excerpt: truncateText(review.review.trim()),
      url: generateReviewUrl(review.author.steamId, appId),
      isPositive: false,
      votesHelpful: review.votesHelpful,
      playtimeHours: Math.round(review.author.playtimeAtReview / 60),
      authorSteamId: review.author.steamId,
    });
  }
  return quotes.sort((a, b) => b.votesHelpful - a.votesHelpful).slice(0, maxQuotes);
}

/** AFINN sentiment: score -1..1, label positive/negative/neutral, confidence 0..1. */
export function analyzeSentiment(text: string): SentimentAnalysis {
  const analyzer = new SentimentAnalyzer("English", PorterStemmer, "afinn");
  const tokens = text.toLowerCase().split(/\s+/);
  const score = analyzer.getSentiment(tokens);

  let label: "positive" | "negative" | "neutral";
  let confidence: number;
  if (score > 0.1) {
    label = "positive";
    confidence = Math.min(score, 1);
  } else if (score < -0.1) {
    label = "negative";
    confidence = Math.min(Math.abs(score), 1);
  } else {
    label = "neutral";
    confidence = 1 - Math.abs(score);
  }
  return { score, label, confidence };
}

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by",
  "from", "as", "is", "was", "are", "been", "be", "have", "has", "had", "do", "does", "did",
  "will", "would", "could", "should", "may", "might", "must", "can", "this", "that", "these",
  "those", "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them",
  "my", "your", "his", "its", "our", "their", "what", "which", "who", "when", "where", "why",
  "how", "all", "each", "every", "both", "few", "more", "most", "other", "some", "such", "no",
  "nor", "not", "only", "own", "same", "so", "than", "too", "very", "just", "game", "play",
  "played", "playing",
]);

export function extractKeywords(text: string, limit = 10): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((word) => word.length > 3 && !STOP_WORDS.has(word));

  const frequencies = new Map<string, number>();
  for (const word of words) {
    frequencies.set(word, (frequencies.get(word) || 0) + 1);
  }
  return Array.from(frequencies.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word]) => word);
}

export function summarizeReviews(reviews: Review[], appId?: number): ReviewAnalysis {
  if (reviews.length === 0) {
    return {
      summary: "No reviews to analyze",
      sentiment: { score: 0, label: "neutral", confidence: 0 },
      commonThemes: [],
      positiveKeywords: [],
      negativeKeywords: [],
      totalAnalyzed: 0,
      sampleSize: 0,
    };
  }

  const positiveReviews = reviews.filter((r) => r.votedUp);
  const negativeReviews = reviews.filter((r) => !r.votedUp);

  const sentiments = reviews.map((r) => analyzeSentiment(r.review));
  const avgScore = sentiments.reduce((sum, s) => sum + s.score, 0) / sentiments.length;
  const avgConfidence = sentiments.reduce((sum, s) => sum + s.confidence, 0) / sentiments.length;

  let overallLabel: "positive" | "negative" | "neutral";
  if (avgScore > 0.1) overallLabel = "positive";
  else if (avgScore < -0.1) overallLabel = "negative";
  else overallLabel = "neutral";

  const positiveText = positiveReviews.map((r) => r.review).join(" ");
  const negativeText = negativeReviews.map((r) => r.review).join(" ");
  const positiveKeywords = extractKeywords(positiveText, 10);
  const negativeKeywords = extractKeywords(negativeText, 10);
  const allText = reviews.map((r) => r.review).join(" ");
  const commonThemes = extractKeywords(allText, 15);

  const posPercent = Math.round((positiveReviews.length / reviews.length) * 100);
  const negPercent = 100 - posPercent;
  const summary =
    `Analyzed ${reviews.length} reviews: ${posPercent}% positive, ${negPercent}% negative. ` +
    `Overall sentiment is ${overallLabel} (score: ${avgScore.toFixed(2)}). ` +
    `Common themes: ${commonThemes.slice(0, 5).join(", ")}.`;

  const exampleQuotes = appId ? selectExampleQuotes(reviews, appId) : undefined;

  return {
    summary,
    sentiment: { score: avgScore, label: overallLabel, confidence: avgConfidence },
    commonThemes,
    positiveKeywords,
    negativeKeywords,
    totalAnalyzed: reviews.length,
    sampleSize: reviews.length,
    exampleQuotes,
  };
}

export function analyzeTopicFocused(
  reviews: Review[],
  topic: string,
  appId?: number,
): ReviewAnalysis {
  const topicLower = topic.toLowerCase();
  const relevantReviews = reviews.filter((r) => r.review.toLowerCase().includes(topicLower));

  if (relevantReviews.length === 0) {
    return {
      summary: `No reviews found mentioning "${topic}". Try a different topic or broader search term.`,
      sentiment: { score: 0, label: "neutral", confidence: 0 },
      commonThemes: [],
      positiveKeywords: [],
      negativeKeywords: [],
      totalAnalyzed: 0,
      sampleSize: reviews.length,
    };
  }

  const baseAnalysis = summarizeReviews(relevantReviews, appId);
  const topicSummary =
    `Topic-focused analysis on "${topic}": ` +
    `Found ${relevantReviews.length} reviews (${Math.round((relevantReviews.length / reviews.length) * 100)}% of ${reviews.length} total). ` +
    baseAnalysis.summary;

  return {
    ...baseAnalysis,
    summary: topicSummary,
    sampleSize: reviews.length,
    totalAnalyzed: relevantReviews.length,
  };
}
