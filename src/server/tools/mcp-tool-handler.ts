/** MCP Tool handler 的公共执行、错误与发布结果适配。 */

import type {ServerContext} from "@modelcontextprotocol/server";
import type {AiToolInputReqType, LocSearchReplyRawType} from "../../models/backend/bridge-models.js";
import type {PublishedMapToolExecutorType, PublishedToolFlowResultType} from "../../models/backend/tool-flow-models.js";
import {AppError} from "../../shared/app-error.js";
import {createLegacyInteractiveMapResource} from "../interactive-map-launcher-resource.js";
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

/** App 继续读取成功指针；Legacy Host 从业务文字之后的嵌入资源打开同一 User 地图。 */
function createPublishedToolResult(publication: PublishedToolFlowResultType) {
  const textResult = createTextToolResult(JSON.stringify(publication.ai_output, null, 2));
  return {
    ...textResult,
    content: [...textResult.content, createLegacyInteractiveMapResource(publication.ai_output.interactive_map_url)],
    structuredContent: publication.client_output,
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
