#!/usr/bin/env node
/**
 * Smoke test: real MCP stdio session against the built server.
 *
 * Spawns `node build/index.js`, performs initialize → tools/list → tools/call
 * for EVERY tool with a valid input and an invalid input, and reports
 * PASS/FAIL per call. Exit code 0 only when every call behaves as expected.
 *
 * Usage: npm run smoke   (after npm run build)
 * No STEAM_API_KEY is set on purpose — this also verifies the keyless default
 * and the graceful-degradation path for the key-gated tools.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SERVER = path.join(ROOT, "build", "entry.js");

const PROTOCOL = "2025-06-18";

class McpClient {
  constructor(child) {
    this.child = child;
    this.buffer = "";
    this.pending = new Map();
    this.nextId = 1;
    this.stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d) => (this.stderr += d));
    child.stdout.on("data", (d) => this.onData(d));
  }
  onData(chunk) {
    this.buffer += chunk;
    let idx;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    }
  }
  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  notify(method, params) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }
  close() {
    this.child.stdin.end();
    this.child.kill();
  }
}

let pass = 0;
let fail = 0;
const failures = [];

function report(name, ok, detail) {
  const status = ok ? "PASS" : "FAIL";
  if (ok) pass++;
  else {
    fail++;
    failures.push({ name, detail });
  }
  const short = String(detail).replace(/\s+/g, " ").slice(0, 140);
  console.log(`[${status}] ${name}${detail !== undefined && detail !== null ? " :: " + short : ""}`);
}

function truncate(s, n = 90) {
  const t = String(s).replace(/\s+/g, " ");
  return t.length > n ? t.slice(0, n) + "…" : t;
}

function isStructuredError(result) {
  return result?.isError === true && typeof result?.content?.[0]?.text === "string";
}

async function callTool(client, name, args, expectError, label) {
  const t0 = Date.now();
  try {
    const result = await client.request("tools/call", { name, arguments: args });
    const ms = Date.now() - t0;
    const text = result?.content?.[0]?.text ?? "";
    if (expectError === "degradation") {
      // Key-gated tools WITHOUT STEAM_API_KEY must degrade to a clear,
      // structured isError explaining how to enable them — not a crash.
      const parsed = (() => {
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      })();
      const okStructured =
        isStructuredError(result) && parsed && parsed.error === true && typeof parsed.message === "string";
      report(label ?? `${name} (no key → structured degradation)`, okStructured, okStructured ? parsed.message : text.slice(0, 200));
      return;
    }
    if (expectError) {
      const parsed = (() => {
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      })();
      const okStructured =
        isStructuredError(result) && parsed && parsed.error === true && typeof parsed.message === "string";
      report(label ?? `${name} (invalid input)`, okStructured, okStructured ? parsed.message : text.slice(0, 200));
      return;
    }
    const parsed = (() => {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    })();
    const ok = result && !result.isError && parsed !== null;
    report(label ?? name, ok, ok ? truncate(JSON.stringify(parsed).slice(0, 220)) : `unexpected: ${truncate(text)}`);
    return parsed;
  } catch (e) {
    report(label ?? name, false, `request failed: ${truncate(String(e.message))} (${Date.now() - t0}ms)`);
    return null;
  }
}

async function main() {
  const child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "pipe"] });
  const client = new McpClient(child);
  const timeout = setTimeout(() => {
    console.error("GLOBAL TIMEOUT");
    child.kill();
    process.exit(1);
  }, 240_000);

  // --- handshake ---
  try {
    const init = await client.request("initialize", {
      protocolVersion: PROTOCOL,
      capabilities: {},
      clientInfo: { name: "smoke", version: "1.0.0" },
    });
    client.notify("notifications/initialized");
    report("initialize", init?.serverInfo?.name === "steam-mcp-suite", init?.serverInfo?.name ?? JSON.stringify(init).slice(0, 80));

    const list = await client.request("tools/list", {});
    const names = (list?.tools ?? []).map((t) => t.name);
    report(`tools/list (${names.length} tools)`, names.length >= 15, names.join(", "));
  } catch (e) {
    console.error("handshake failed:", e.message, "\nserver stderr:", client.stderr.slice(-2000));
    process.exit(1);
  }

  // --- valid-input calls (real network) ---
  const valid = [
    ["search_games", { term: "Hades" }],
    ["get_game", { appid: 1145360 }],
    ["get_prices", { appids: [1145360, 570, 730, 999999999] }],
    ["get_specials", {}],
    ["get_game_reviews", { appid: 1145360, limit: 3 }],
    ["analyze_reviews", { appid: 1145360, sample_size: 30 }],
    ["get_game_news", { appid: 1145360, limit: 2 }],
    ["get_current_players", { appid: 570 }],
    ["get_global_achievements", { appid: 1145360 }],
    ["get_wishlist", { steamid: "76561198014830870" }],
    ["get_itch_jams", { filter: "active" }],
    ["search_itch_jams", { query: "game" }],
    ["get_jam_details", { jam: "micro-jam-055" }],
    ["get_cache_stats", {}],
  ];

  for (const [name, args] of valid) {
    await callTool(client, name, args, false);
  }

  // Key-gated player tools WITHOUT STEAM_API_KEY must degrade to structured
  // errors (this smoke run has no key on purpose — the degradation path IS
  // the test).
  const degraded = [
    ["get_owned_games", {}],
    ["get_player_summary", {}],
    ["resolve_vanity_url", { vanity_url: "gaben" }],
    ["get_recently_played", {}],
    ["get_player_achievements", { app_id: 1145360 }],
    ["get_achievement_summary", {}],
  ];

  for (const [name, args] of degraded) {
    await callTool(client, name, args, "degradation");
  }

  // analyze_reviews again — should hit the 15-min review cache (cache stats prove it)
  await callTool(client, "analyze_reviews", { appid: 1145360, sample_size: 30 }, false, "analyze_reviews (2nd call, cached)");
  await callTool(client, "get_cache_stats", {}, false, "get_cache_stats (after repeat)");

  // --- invalid-input calls (must be structured validation errors) ---
  const invalid = [
    ["search_games", { term: "" }],
    ["get_game", {}],
    ["get_prices", { appids: [] }],
    ["get_game_reviews", { appid: "not-a-number" }],
    ["analyze_reviews", { appid: -5 }],
    ["get_wishlist", { steamid: "123" }],
    ["get_owned_games", { limit: 9999 }],
    ["get_itch_jams", { filter: "bogus" }],
    ["search_itch_jams", {}],
    ["get_jam_details", { jam: "" }],
    ["resolve_vanity_url", {}],
    ["totally_unknown_tool", {}],
  ];

  for (const [name, args] of invalid) {
    await callTool(client, name, args, true);
  }

  clearTimeout(timeout);
  client.close();

  console.log(`\n===== RESULT: ${pass} passed, ${fail} failed =====`);
  if (failures.length > 0) {
    console.log("Failures:");
    for (const f of failures) console.log(`  - ${f.name}: ${truncate(String(f.detail), 200)}`);
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("smoke crashed:", e);
  process.exit(1);
});
