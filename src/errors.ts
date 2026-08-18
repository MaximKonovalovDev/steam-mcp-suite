/**
 * Typed, sanitized errors — pattern from sharkusmanch/steam-mcp-server (MIT).
 *
 * Tool handlers throw AppError; the tool layer maps it to a structured MCP
 * `isError` result with a sanitized, actionable message. Messages never leak
 * stack traces, URLs, or upstream bodies to the calling model.
 */
export type ErrorCode =
  | "bad_request"
  | "auth"
  | "rate_limit"
  | "timeout"
  | "not_found"
  | "upstream"
  | "network"
  | "internal";

export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
  }
}

/** Human-readable guidance for the "no API key" degradation path. */
export function keyMissingError(): AppError {
  return new AppError(
    "bad_request",
    "STEAM_API_KEY is not set. This tool needs the (free) Steam Web API key. " +
      "Get one at https://steamcommunity.com/dev/apikey and start the server with " +
      "STEAM_API_KEY set — the storefront, reviews, news and itch tools keep working without it.",
  );
}

export function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof AppError) return error.message;
  if (error instanceof Error) {
    const message = error.message;
    if (message.includes("ENOTFOUND") || message.includes("ECONNREFUSED") || message.includes("ECONNRESET")) {
      return "Network error: unable to reach the Steam/itch.io API";
    }
    if (message.includes("timeout") || message.includes("ETIMEDOUT")) {
      return "The upstream API timed out. This is usually transient — try again.";
    }
    if (message.includes("401") || message.includes("403")) {
      return "Authorization error: check the API key or profile privacy settings";
    }
    if (message.includes("404")) {
      return "Not found: the requested resource does not exist";
    }
    if (message.includes("429")) {
      return "Rate limited by the upstream API. Please wait a moment and try again.";
    }
    if (message.includes("500") || message.includes("502") || message.includes("503")) {
      return "The upstream API is temporarily unavailable. Please try again later";
    }
    // Return the message only if it looks safe (no paths, reasonably short).
    if (!message.includes("/") && !message.includes("\\") && message.length < 200) {
      return message;
    }
    return "An error occurred while processing your request";
  }
  return "Unknown error";
}
