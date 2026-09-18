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

import {registerAppTool} from "@modelcontextprotocol/ext-apps/server";
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";

import {closeMapHttpService, createMapHttpService, getInternalMapOrigin, listenMapHttpService} from "./http/map-http-service.js";
import {SessionManager} from "./map-session/session-manager.js";
import {SnapshotService} from "./map-session/snapshot-service.js";
import {INTERACTIVE_MAP_LAUNCHER_URI, registerInteractiveMapLauncherResource} from "./mcp-apps/interactive-map-launcher-resource.js";
import {
  type AiToolInputReqType,
  type LocSearchReplyRawType,
  locSearchQueryReqSchema,
  locSearchReplyRawSchema,
  AitoolInputReqSchema,
} from "./models/backend/bridge-models.js";
import type {PublishedToolFlowResultType} from "./models/backend/tool-flow-models.js";
import type {ToolFlowServicesType} from "./tools/tool-flow.js";
import {ToolExecutionScheduler} from "./tools/tool-execution-scheduler.js";
import {funcToolA, funcToolB} from "./tools/tools.js";
import {AppError} from "./utils/app-error.js";
import { getToolPromptsConfigWithHints } from "./utils/prompt-hints.js";
import {
  callBridge,
  sanitizeSearchResponseForAI,
} from "./utils/python-bridge.js";
import {config} from "./utils/config-loader.js";
import {initializeUserStyle} from "./utils/user-style-rule.js";
import {logger} from "./utils/logger.js";

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

/** 客户端 URL 只进入 `_meta`，AI-facing JSON 只序列化已经分离的 `ai_output`。 */
function createPublishedToolResult(publication: PublishedToolFlowResultType) {
  return {
    ...createTextToolResult(JSON.stringify(publication.ai_output, null, 2)),
    _meta: {"io.geomcp/interactiveMap": publication.client_output},
  };
}

/**
 * 统一把运行时错误转换成 MCP text error result。
 * 这样 tool handler 不会把异常直接抛到 transport 层。
 */
function createErrorToolResult(error: unknown) {
  const appError = AppError.fromUnknown(error, "internal_error", "Unexpected TypeScript processing error");
  return createTextToolResult(JSON.stringify(appError.toJSON(), null, 2), true);
}

function getCachedSearchResponse(sessionId: string): LocSearchReplyRawType {
  const cachedResponse = searchResultCache.get(sessionId);

  if (!cachedResponse) {
    throw new AppError("missing_search_session", `search session not found for session_id: ${sessionId}`);
  }

  return cachedResponse;
}

async function executeToolARequest(
  args: AiToolInputReqType,
  scheduler: ToolExecutionScheduler,
  services: ToolFlowServicesType,
) {
  try {
    const cachedResponse = getCachedSearchResponse(args.session_id);
    const toolResponse = await scheduler.run((context) => funcToolA(cachedResponse, args, context, services));
    return createPublishedToolResult(toolResponse);
  } catch (error) {
    return createErrorToolResult(error);
  }
}

async function executeToolBRequest(
  args: AiToolInputReqType,
  scheduler: ToolExecutionScheduler,
  services: ToolFlowServicesType,
) {
  try {
    const cachedResponse = getCachedSearchResponse(args.session_id);
    const toolResponse = await scheduler.run((context) => funcToolB(cachedResponse, args, context, services));
    return createPublishedToolResult(toolResponse);
  } catch (error) {
    return createErrorToolResult(error);
  }
}

function buildServer(scheduler: ToolExecutionScheduler, services: ToolFlowServicesType, publicOrigin: string) {
  const toolPromptsConfig = getToolPromptsConfigWithHints();
  const server = new McpServer({
    name: "geomcp",
    version: "0.1.0",
  });
  registerInteractiveMapLauncherResource(server, publicOrigin);

  server.registerTool(
    "location_search",
    {
      title: toolPromptsConfig.location_search.title,
      description: toolPromptsConfig.location_search.description,
      inputSchema: locSearchQueryReqSchema,
    },
    async (args) => {
      try {
        const rawResponse = await scheduler.run(async (context) => locSearchReplyRawSchema.parse(
          await callBridge("search_location", args, context.signal),
        ));
        searchResultCache.set(rawResponse.session_id, rawResponse);
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
    async (args) => executeToolARequest(args, scheduler, services),
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
    async (args) => executeToolBRequest(args, scheduler, services),
  );

  return server;
}

async function main() {
  // 配置与用户 CSS/YAML 在工具注册前完成校验；失败时服务不进入可调用状态。
  config.initialize();
  initializeUserStyle();
  const webConfig = config.getWebConfig();
  const sessionManager = new SessionManager(webConfig.session);
  const snapshotService = new SnapshotService(getInternalMapOrigin(webConfig.http), webConfig.snapshot);
  const toolScheduler = new ToolExecutionScheduler(webConfig.tool_execution);
  const mapHttpService = createMapHttpService(webConfig, sessionManager);
  // GeoMCP 当前先使用 stdio transport，供本地 MCP client / AI 进程拉起。
  const server = buildServer(toolScheduler, {sessionManager, snapshotService}, webConfig.http.map.public_origin);
  const transport = new StdioServerTransport();
  let shutdownPromise: Promise<void> | null = null;

  const shutdown = (): Promise<void> => {
    if (shutdownPromise !== null) return shutdownPromise;
    shutdownPromise = (async () => {
      await toolScheduler.close();
      await snapshotService.close();
      await closeMapHttpService(mapHttpService);
      await sessionManager.close();
      await server.close();
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
  // stdio 客户端正常断开时也必须关闭 HTTP listener，否则端口会让进程继续常驻。
  server.server.onclose = handleShutdownSignal;

  try {
    await sessionManager.start();
    await listenMapHttpService(mapHttpService, webConfig.http);
    await snapshotService.start();
    await server.connect(transport);
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
