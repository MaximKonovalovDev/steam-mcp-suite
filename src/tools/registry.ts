/**
 * Tool registry: typed specs + MCP server assembly.
 *
 * Every tool has a zod input schema (validation before any action), a
 * description written for the calling model, and a handler that either returns
 * a JSON result or throws AppError → structured isError. All tools are
 * read-only; there are no destructive tools in this suite.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { toJSONSchema, type z } from "zod";
import { sanitizeErrorMessage } from "../errors.js";
import type { SteamClient } from "../steam/client.js";
import type { ItchJamsClient } from "../itch/jams.js";

export interface ToolContext {
  steam: SteamClient;
  itch: ItchJamsClient;
  cacheStats: () => { size: number; hits: number; misses: number; hitRate: number };
}

// A is intentionally loose (any): handlers destructure their own fields after
// zod validation, and the typed schemas in each tool file still constrain the
// model. Keeps array literals of mixed schemas ergonomic under strict mode.
export interface ToolSpec<A = any> {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodType<A>;
  handler: (ctx: ToolContext, args: A) => Promise<unknown>;
}

export function jsonContent(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export function buildServer(
  specs: ToolSpec[],
  ctx: ToolContext,
  info: { name: string; version: string; instructions?: string },
): Server {
  const server = new Server(
    { name: info.name, version: info.version },
    { capabilities: { tools: {} }, instructions: info.instructions },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools: Tool[] = specs.map((spec) => ({
      name: spec.name,
      title: spec.title,
      description: spec.description,
      inputSchema: toJSONSchema(spec.inputSchema) as Tool["inputSchema"],
      annotations: { readOnlyHint: true },
    }));
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const spec = specs.find((s) => s.name === name);
    if (!spec) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: true, message: `Unknown tool: ${name}`, tool: name }, null, 2) }],
        isError: true,
      };
    }
    try {
      const parsed = spec.inputSchema.safeParse(args ?? {});
      if (!parsed.success) {
        const details = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { error: true, message: "Validation error", details, tool: name },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }
      const result = await spec.handler(ctx, parsed.data);
      return jsonContent(result);
    } catch (error) {
      const message = sanitizeErrorMessage(error);
      const code = error instanceof Error && "code" in error ? String((error as { code?: unknown }).code) : undefined;
      return {
        content: [
          { type: "text", text: JSON.stringify({ error: true, message, code, tool: name }, null, 2) },
        ],
        isError: true,
      };
    }
  });

  return server;
}
