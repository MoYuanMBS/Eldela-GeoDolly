/** MCP Tool handler 的公共执行、错误与发布结果适配。 */

import type {ServerContext} from "@modelcontextprotocol/server";
import type {AiToolInputReqType, LocSearchReplyRawType} from "../../models/backend/bridge-models.js";
import type {PublishedMapToolExecutorType, PublishedToolFlowResultType} from "../../models/backend/tool-flow-models.js";
import {AppError} from "../../shared/app-error.js";
import type {ToolExecutionScheduler} from "./tool-execution-scheduler.js";
import type {ToolFlowServicesType} from "./tool-flow.js";

interface PublishedMapToolHandlerOptions {
  scheduler: ToolExecutionScheduler;
  services: ToolFlowServicesType;
  getCachedSelection: (sessionId: string) => LocSearchReplyRawType;
}

export function createTextToolResult(text: string, isError = false) {
  return {
    content: [{type: "text" as const, text}],
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

/** MCP Tool handler 的统一 AppError → text error result 边界。 */
export function createErrorToolResult(error: unknown) {
  const appError = AppError.fromUnknown(error, "internal_error", "Unexpected TypeScript processing error");
  return createTextToolResult(JSON.stringify(appError.toJSON(), null, 2), true);
}

/** 为共享搜索缓存、调度器与发布格式的地图 Tool 创建统一 handler。 */
export function createPublishedMapToolHandler(
  executeTool: PublishedMapToolExecutorType<ToolFlowServicesType>,
  options: PublishedMapToolHandlerOptions,
) {
  return async (args: AiToolInputReqType, requestContext?: ServerContext) => {
    try {
      const cachedSelection = options.getCachedSelection(args.session_id);
      const publication = await options.scheduler.run((context) => executeTool(cachedSelection, args, context, options.services), requestContext?.mcpReq.signal);
      return createPublishedToolResult(publication);
    } catch (error) {
      return createErrorToolResult(error);
    }
  };
}
