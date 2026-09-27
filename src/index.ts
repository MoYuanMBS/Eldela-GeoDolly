/**
 * `src/index.ts` is the MCP server bootstrap entry:
 * - create the MCP server
 * - register tools
 * - accept MCP clients over Streamable HTTP
 *
 * Tool business logic should stay thin here. Heavy work belongs in:
 * - `src/server/utils/python-bridge.ts`
 * - `src/server/tools/*`
 * - `src/browser/*`
 */

import {registerAppTool} from "@modelcontextprotocol/ext-apps/server";
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";

import {closeMapHttpService, createMapHttpService, getInternalMapOrigin, listenMapHttpService} from "./server/http/map-http-service.js";
import {createMcpHttpService, listenMcpHttpService} from "./server/http/mcp-http-service.js";
import {SessionManager} from "./server/map-session/session-manager.js";
import {SnapshotService} from "./server/map-session/snapshot-service.js";
import {INTERACTIVE_MAP_LAUNCHER_URI, registerInteractiveMapLauncherResource} from "./server/interactive-map-launcher-resource.js";
import {
  type LocSearchReplyRawType,
  locSearchQueryReqSchema,
  locSearchReplyRawSchema,
  AitoolInputReqSchema,
} from "./models/backend/bridge-models.js";
import type {ToolFlowServicesType} from "./server/tools/tool-flow.js";
import {ToolExecutionScheduler} from "./server/tools/tool-execution-scheduler.js";
import {createErrorToolResult, createPublishedMapToolHandler, createTextToolResult} from "./server/tools/mcp-tool-handler.js";
import {funcToolA, funcToolB} from "./server/tools/tools.js";
import {AppError} from "./shared/app-error.js";
import { getToolPromptsConfigWithHints } from "./server/utils/prompt-hints.js";
import {
  callBridge,
  sanitizeSearchResponseForAI,
} from "./server/utils/python-bridge.js";
import {config} from "./server/utils/config-loader.js";
import {initializeUserStyle} from "./server/utils/user-style/user-style-rule.js";
import {logger} from "./server/utils/logger.js";

//#################################################################################
const searchResultCache = new Map<string, {response: LocSearchReplyRawType; expiresAt: number}>();

// 临时搜索候选缓存清理；接入正式 Session 管理后移除。
function deleteExpiredSearchResponse(sessionId: string, nowSeconds: number): void {
  const cachedResponse = searchResultCache.get(sessionId);
  if (cachedResponse && nowSeconds >= cachedResponse.expiresAt) searchResultCache.delete(sessionId);
}

function getCachedSearchResponse(sessionId: string): LocSearchReplyRawType {
  deleteExpiredSearchResponse(sessionId, Date.now() / 1000);
  const cachedResponse = searchResultCache.get(sessionId);

  if (!cachedResponse) {
    throw new AppError("missing_search_session", `search session not found for session_id: ${sessionId}`);
  }

  return cachedResponse.response;
}

function buildServer(scheduler: ToolExecutionScheduler, services: ToolFlowServicesType, publicOrigin: string) {
  const toolPromptsConfig = getToolPromptsConfigWithHints();
  const server = new McpServer({
    name: "geomcp",
    version: "0.1.0",
  });
  registerInteractiveMapLauncherResource(server, publicOrigin);
  const mapToolHandlerOptions = {scheduler, services, getCachedSelection: getCachedSearchResponse};

  server.registerTool(
    "location_search",
    {
      title: toolPromptsConfig.location_search.title,
      description: toolPromptsConfig.location_search.description,
      inputSchema: locSearchQueryReqSchema,
    },
    async (args, extra) => {
      try {
        const rawResponse = await scheduler.run(async (context) => locSearchReplyRawSchema.parse(
          await callBridge("search_location", args, context.signal),
        ), extra.signal);
        searchResultCache.set(rawResponse.session_id, {
          response: rawResponse,
          expiresAt: Date.now() / 1000 + config.getWebConfig().session.ttl_seconds,
        });
        const responseForAI = sanitizeSearchResponseForAI(rawResponse);

        return createTextToolResult(JSON.stringify(responseForAI, null, 2));
      } catch (error) {
        return createErrorToolResult(error);
      }
    },
  );

  registerAppTool(
    server,
    "tool_a",
    {
      title: toolPromptsConfig.tool_a.title,
      description: toolPromptsConfig.tool_a.description,
      inputSchema: AitoolInputReqSchema,
      _meta: {ui: {resourceUri: INTERACTIVE_MAP_LAUNCHER_URI, visibility: ["model"]}},
    },
    createPublishedMapToolHandler(funcToolA, mapToolHandlerOptions),
  );

  registerAppTool(
    server,
    "tool_b",
    {
      title: toolPromptsConfig.tool_b.title,
      description: toolPromptsConfig.tool_b.description,
      inputSchema: AitoolInputReqSchema,
      _meta: {ui: {resourceUri: INTERACTIVE_MAP_LAUNCHER_URI, visibility: ["model"]}},
    },
    createPublishedMapToolHandler(funcToolB, mapToolHandlerOptions),
  );

  return server;
}

async function main() {
  // 配置与用户 CSS/YAML 在工具注册前完成校验；失败时服务不进入可调用状态。
  config.initialize();
  initializeUserStyle();
  const webConfig = config.getWebConfig();
  const sessionManager = new SessionManager(webConfig.session, (nowSeconds) => {
    for (const sessionId of searchResultCache.keys()) deleteExpiredSearchResponse(sessionId, nowSeconds);
  });
  const snapshotService = new SnapshotService(getInternalMapOrigin(webConfig.http), webConfig.snapshot);
  const toolScheduler = new ToolExecutionScheduler(webConfig.tool_execution);
  const mapHttpService = createMapHttpService(webConfig, sessionManager);
  const mcpHttpService = createMcpHttpService(
    webConfig.http,
    () => buildServer(toolScheduler, {sessionManager, snapshotService}, webConfig.http.map.public_origin),
  );
  let shutdownPromise: Promise<void> | null = null;

  const shutdown = (): Promise<void> => {
    if (shutdownPromise !== null) return shutdownPromise;
    shutdownPromise = (async () => {
      await toolScheduler.close();
      await mcpHttpService.close();
      await snapshotService.close();
      await closeMapHttpService(mapHttpService);
      await sessionManager.close();
      searchResultCache.clear();
    })();
    return shutdownPromise;
  };
  const handleShutdownSignal = (): void => {
    void shutdown().catch((error: unknown) => {
      logger.warning("service_shutdown_failed", {reason: error instanceof Error ? error.message : String(error)});
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", handleShutdownSignal);
  process.once("SIGTERM", handleShutdownSignal);
  try {
    await sessionManager.start();
    await listenMapHttpService(mapHttpService, webConfig.http);
    await snapshotService.start();
    await listenMcpHttpService(mcpHttpService, webConfig.http);
  } catch (error) {
    process.off("SIGINT", handleShutdownSignal);
    process.off("SIGTERM", handleShutdownSignal);
    await shutdown().catch((shutdownError: unknown) => {
      logger.warning("service_startup_cleanup_failed", {reason: shutdownError instanceof Error ? shutdownError.message : String(shutdownError)});
    });
    throw error;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
