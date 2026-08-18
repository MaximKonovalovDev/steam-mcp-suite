/**
 * itch.io game-jams tools (keyless, scraping). Intents from
 * petrarka/itch-jams-mcp (MIT) — browse by status, search, jam details.
 * itch.io may block automated requests; blocked calls return a structured error.
 */
import { z } from "zod";
import type { ToolSpec } from "./registry.js";

const jamFilter = z
  .enum(["active", "upcoming", "recent", "all"])
  .default("all")
  .describe("Jam status: active (running now), upcoming (not started), recent (ended), or all.");

export const itchTools: ToolSpec[] = [
  {
    name: "get_itch_jams",
    title: "Get itch.io game jams",
    description:
      "Browse game jams on itch.io by status: active (running now), upcoming (not started), " +
      "recent (just ended), or all (the front calendar). Returns title, URL, dates and participant " +
      "count for each jam. Keyless scraping — itch.io may occasionally block automated requests, " +
      "in which case this returns a clear structured error.",
    inputSchema: z.strictObject({
      filter: jamFilter,
      page: z.int().positive().default(1).describe("Page number (default 1)."),
    }),
    handler: async ({ itch }, { filter, page }) => {
      const res = await itch.getJams(filter, page);
      return {
        ...res,
        jams: res.jams.map((j) => ({
          id: j.id,
          title: j.title,
          url: j.url,
          start_date: j.start_date,
          end_date: j.end_date,
          participants: j.joined,
          featured: j.highlight,
        })),
      };
    },
  },
  {
    name: "search_itch_jams",
    title: "Search itch.io game jams",
    description:
      "Search itch.io game jams by keyword in the title, optionally narrowed to a status " +
      "(active/upcoming/recent). Keyless scraping — see get_itch_jams for the block caveat.",
    inputSchema: z.strictObject({
      query: z.string().trim().min(1).describe("Search keyword."),
      filter: jamFilter,
    }),
    handler: async ({ itch }, { query, filter }) => {
      const res = await itch.searchJams(query, filter);
      return {
        query: res.query,
        filter,
        scanned: res.scanned,
        matched: res.matched,
        jams: res.jams.map((j) => ({
          id: j.id,
          title: j.title,
          url: j.url,
          start_date: j.start_date,
          end_date: j.end_date,
          participants: j.joined,
          featured: j.highlight,
        })),
      };
    },
  },
  {
    name: "get_jam_details",
    title: "Get itch.io jam details",
    description:
      "Fetch the full details of a specific itch.io game jam page: description, host, dates, and " +
      "entry/rating statistics. Pass either a full URL (https://itch.io/jam/...) or just the jam " +
      "slug (e.g. 'micro-jam-055'). Keyless scraping — see get_itch_jams for the block caveat.",
    inputSchema: z.strictObject({
      jam: z
        .string()
        .trim()
        .min(1)
        .describe("Full URL or slug of the jam, e.g. 'micro-jam-055' or 'https://itch.io/jam/micro-jam-055'."),
    }),
    handler: async ({ itch }, { jam }) => {
      const d = await itch.getJamDetails(jam);
      return {
        title: d.title,
        url: d.url,
        host: d.host,
        start_date: d.start_date,
        end_date: d.end_date,
        stats: d.stats,
        description: d.description.slice(0, 4000),
      };
    },
  },
];
