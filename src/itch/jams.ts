/**
 * itch.io game-jams scraper — ported from petrarka/itch-jams-mcp (MIT),
 * Python (httpx + BeautifulSoup) → TypeScript (axios + cheerio).
 *
 * Tool intents preserved: browse jams by status (active/upcoming/recent/all),
 * search by keyword, fetch full jam details. Keyless; relies on the public
 * jams calendar page. itch.io may block automated requests (403/Cloudflare) —
 * in that case tools return a structured error rather than garbage.
 */
import * as cheerio from "cheerio";
import { HttpClient } from "../lib/http.js";
import { AppError } from "../errors.js";

const JAMS_URL = "https://itch.io/jams";
const JAM_PAGE_URL = "https://itch.io/jam";
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export type JamFilter = "active" | "upcoming" | "recent" | "all";

export interface Jam {
  id: number | null;
  title: string;
  url: string;
  start_date: string;
  end_date: string;
  joined: number;
  highlight: boolean;
}

export interface JamDetails {
  title: string;
  url: string;
  host: string;
  start_date: string;
  end_date: string;
  stats: Record<string, string>;
  description: string;
}

export class ItchJamsClient {
  private readonly http: HttpClient;

  constructor(http: HttpClient) {
    this.http = http;
  }

  private async fetchPage(url: string, query: Record<string, string | number | undefined> = {}): Promise<string> {
    try {
      return await this.http.getText(url, { query, timeoutMs: 15000 });
    } catch (e) {
      if (e instanceof AppError && e.code === "auth") {
        throw new AppError(
          "auth",
          "itch.io blocked this request (403). The jams calendar is behind bot protection — " +
            "retry later, or use the Steam-side tools which are unaffected.",
        );
      }
      if (e instanceof AppError) {
        throw new AppError(e.code, `itch.io request failed: ${e.message}`);
      }
      throw e;
    }
  }

  /** Extract the FilteredJamCalendar JSON embedded in the jams page. */
  private extractJams(html: string): Jam[] {
    const $ = cheerio.load(html);
    const cal = $(".calendar_wrapper").first();
    if (!cal.length) return [];
    const script = cal.find("script").first().text();
    const marker = "FilteredJamCalendar(";
    const start = script.indexOf(marker);
    if (start < 0) return [];
    const body = script.slice(start + marker.length);
    let depth = 0;
    let end = -1;
    for (let i = 0; i < body.length; i++) {
      if (body[i] === "{") depth++;
      else if (body[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end < 0) return [];
    try {
      const data = JSON.parse(body.slice(0, end)) as { jams?: Jam[] };
      return (data.jams ?? []).map((j) => {
        let url = j.url ?? "";
        if (url && !url.startsWith("http")) url = `https://itch.io${url}`;
        return {
          id: j.id ?? null,
          title: j.title ?? "",
          url,
          start_date: j.start_date ?? "",
          end_date: j.end_date ?? "",
          joined: j.joined ?? 0,
          highlight: Boolean(j.highlight),
        };
      });
    } catch {
      return [];
    }
  }

  async getJams(filter: JamFilter, page = 1): Promise<{ filter: string; page: number; total: number; jams: Jam[] }> {
    const query: Record<string, string | number | undefined> = {};
    if (filter !== "all") query.filter = filter;
    if (page > 1) query.page = page;
    const html = await this.fetchPage(JAMS_URL, query);
    const jams = this.extractJams(html);
    return { filter, page, total: jams.length, jams };
  }

  async searchJams(query: string, filter: JamFilter = "all"): Promise<{ query: string; matched: number; scanned: number; jams: Jam[] }> {
    const html = await this.fetchPage(JAMS_URL, filter !== "all" ? { filter } : undefined);
    const jams = this.extractJams(html);
    const q = query.toLowerCase();
    const matches = jams.filter((j) => j.title.toLowerCase().includes(q));
    return { query, matched: matches.length, scanned: jams.length, jams: matches };
  }

  async getJamDetails(jam: string): Promise<JamDetails> {
    const jamUrl = jam.startsWith("http") ? jam : `${JAM_PAGE_URL}/${jam.replace(/^\/+/, "")}`;
    let html: string;
    try {
      html = await this.fetchPage(jamUrl);
    } catch (e) {
      if (e instanceof AppError && (e.code === "not_found" || e.code === "auth")) {
        throw new AppError("not_found", `Could not fetch jam "${jam}" — the page may not exist or itch.io blocked the request.`);
      }
      throw e;
    }
    const $ = cheerio.load(html);

    const titleEl = $(".jam_title_header").first();
    const title = titleEl.length
      ? titleEl.text().trim()
      : ($('meta[property="og:title"]').attr("content") ?? "");
    const host = $(".jam_host_header").first().text().trim();

    const stats: Record<string, string> = {};
    $(".stat_box").each((_, box) => {
      const label = $(box).find(".stat_label").first().text().trim();
      const value = $(box).find(".stat_value").first().text().trim();
      if (label && value) stats[label] = value;
    });

    let startDate = "";
    let endDate = "";
    const widget = $(".jam_header_widget").first();
    if (widget.length) {
      const text = widget.text().replace(/\s+/g, " ").trim();
      const dates = text.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g) ?? [];
      if (dates.length >= 2) [startDate, endDate] = [dates[0] ?? "", dates[1] ?? ""];
      else if (dates.length === 1) startDate = dates[0] ?? "";
    }

    const content = $(".jam_content").first();
    let description = "";
    if (content.length) {
      const lines: string[] = [];
      content.find("h1, h2, h3, h4, p, li, hr, details").each((_, tag) => {
        const name = tag.tagName.toLowerCase();
        if (name === "hr") {
          lines.push("\n---");
          return;
        }
        const text = $(tag).text().trim();
        if (!text) return;
        if (name === "h1" || name === "h2") lines.push(`\n## ${text}`);
        else if (name === "h3" || name === "h4") lines.push(`\n### ${text}`);
        else if (name === "li") lines.push(`- ${text}`);
        else lines.push(text);
      });
      description = lines.join("\n").trim();
    }

    return { title, url: jamUrl, host, start_date: startDate, end_date: endDate, stats, description };
  }
}

export const ITCH_UA = CHROME_UA;
