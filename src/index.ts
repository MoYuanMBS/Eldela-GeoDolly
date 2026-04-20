/**
 * Current authority source: doc/GeoMCP 技术规范文档.md
 *
 * `src/index.ts` is the MCP server bootstrap entry:
 * - create the MCP server
 * - register tools
 * - connect stdio transport
 *
 * Tool business logic should stay thin here. Heavy work belongs in:
 * - `src/utils/python-bridge.ts`
 * - `src/tools/*`
 * - `src/renderer/*`
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import {
  searchRequestSchema,
  searchResponseRawSchema,
  toolAInputSchema,
  toolBInputSchema,
} from "./utils/bridge-models.js";
import { callBridge, sanitizeSearchResponseForAI } from "./utils/python-bridge.js";

function createTextToolResult(text: string, isError = false) {
  return {
    content: [
      {
        type: "text" as const,
        text,
      },
    ],
    isError,
  };
}

/**
 * 统一把运行时错误转换成 MCP text error result。
 * 这样 tool handler 不会把异常直接抛到 transport 层。
 */
function createErrorToolResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return createTextToolResult(message, true);
}

function buildServer() {
  const server = new McpServer({
    name: "geomcp",
    version: "0.1.0",
  });

  server.registerTool(
    "location_search",
    {
      title: "Location Search",
      description:
        "Search and shortlist a location candidate before any heavy analysis. Call this tool first.",
      inputSchema: searchRequestSchema,
    },
    async (args) => {
      try {
        const rawResponse = searchResponseRawSchema.parse(
          await callBridge("search_location", args),
        );
        const responseForAI = sanitizeSearchResponseForAI(rawResponse);

        return createTextToolResult(JSON.stringify(responseForAI, null, 2));
      } catch (error) {
        return createErrorToolResult(error);
      }
    },
  );

  server.registerTool(
    "tool_a",
    {
      title: "Road And Traffic Analysis",
      description:
        "Heavy road and traffic analysis. Call location_search first, then pass the confirmed session and selection.",
      inputSchema: toolAInputSchema,
    },
    async (_args) =>
      createTextToolResult(
        "tool_a MCP entry is registered, but the tool_a execution pipeline is not implemented yet.",
        true,
      ),
  );

  server.registerTool(
    "tool_b",
    {
      title: "Area And Facility Analysis",
      description:
        "Heavy area and facility analysis. Call location_search first, then pass the confirmed session and selection.",
      inputSchema: toolBInputSchema,
    },
    async (_args) =>
      createTextToolResult(
        "tool_b MCP entry is registered, but the tool_b execution pipeline is not implemented yet.",
        true,
      ),
  );

  return server;
}

async function main() {
  // GeoMCP 当前先使用 stdio transport，供本地 MCP client / AI 进程拉起。
  const server = buildServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
