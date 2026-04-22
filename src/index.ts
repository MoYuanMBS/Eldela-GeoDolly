/**
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

import { getToolPromptsConfig } from "./utils/config-loader.js";
import {
  type LocSearchReplyRawType,
  locSearchQueryReqSchema,
  locSearchReplyRawSchema,
  AitoolInputReqSchema,
} from "./models/bridge-models.js";
import {
  callBridge,
  exportToolsQueryForPython,
  sanitizeSearchResponseForAI,
} from "./utils/python-bridge.js";

//#################################################################################
const searchResultCache = new Map<string, LocSearchReplyRawType>();

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

function getCachedSearchResponse(sessionId: string): LocSearchReplyRawType {
  const cachedResponse = searchResultCache.get(sessionId);

  if (!cachedResponse) {
    throw new Error(`search session not found for session_id: ${sessionId}`);
  }

  return cachedResponse;
}

function buildServer() {
  const toolPromptsConfig = getToolPromptsConfig();
  const server = new McpServer({
    name: "geomcp",
    version: "0.1.0",
  });

  server.registerTool(
    "location_search",
    {
      title: toolPromptsConfig.location_search.title,
      description: toolPromptsConfig.location_search.description,
      inputSchema: locSearchQueryReqSchema,
    },
    async (args) => {
      try {
        const rawResponse = locSearchReplyRawSchema.parse(
          await callBridge("search_location", args),
        );
        searchResultCache.set(rawResponse.session_id, rawResponse);
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
      title: toolPromptsConfig.tool_a.title,
      description: toolPromptsConfig.tool_a.description,
      inputSchema: AitoolInputReqSchema,
    },
    async (args) => {
      try {
        const cachedResponse = getCachedSearchResponse(args.session_id);
        const pythonQuery = exportToolsQueryForPython(cachedResponse, args);
        const toolResponse = await callBridge("tool_a", pythonQuery);

        return createTextToolResult(JSON.stringify(toolResponse, null, 2));
      } catch (error) {
        return createErrorToolResult(error);
      }
    },
  );

  server.registerTool(
    "tool_b",
    {
      title: toolPromptsConfig.tool_b.title,
      description: toolPromptsConfig.tool_b.description,
      inputSchema: AitoolInputReqSchema,
    },
    async (args) => {
      try {
        const cachedResponse = getCachedSearchResponse(args.session_id);
        const pythonQuery = exportToolsQueryForPython(cachedResponse, args);
        const toolResponse = await callBridge("tool_b", pythonQuery);

        return createTextToolResult(JSON.stringify(toolResponse, null, 2));
      } catch (error) {
        return createErrorToolResult(error);
      }
    },
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
