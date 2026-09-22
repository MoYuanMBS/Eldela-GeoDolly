/** MCP Tool 注册层与内部地图 Flow 之间的适配入口。 */

import type {
  AiToolInputReqType,
  LocSearchReplyRawType,
  PyToolReplyType,
  PyToolReqType,
  ToolType,
} from "../../models/backend/bridge-models.js";
import type {PublishedToolFlowResultType} from "../../models/backend/tool-flow-models.js";
import type {ToolExecutionContextType} from "../../models/backend/tool-execution-models.js";
import {resolveBasemap} from "../map-data/basemap.js";
import {AppError} from "../../shared/app-error.js";
import {PythonBridgeError, callBridge, exportToolsQueryForPython} from "../utils/python-bridge.js";
import {
  publishToolFlow,
  type ToolFlowServicesType,
} from "./tool-flow.js";

/** 调用已经固定 selected candidate 的 Python Tool，并保留 Bridge 结构化错误。 */
async function callPythonTool(tool: ToolType, pythonQuery: PyToolReqType, signal?: AbortSignal): Promise<PyToolReplyType> {
  try {
    // callBridge 已按 action registry 的 reply schema 完成运行时校验。
    return await callBridge(tool, pythonQuery, signal) as PyToolReplyType;
  } catch (error) {
    if (error instanceof PythonBridgeError) throw error;
    if (signal?.aborted === true && error instanceof AppError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new AppError(
      "python_tool",
      `Python ${tool} call failed: ${message}`,
      error instanceof AppError ? error.toJSON() : message,
      error instanceof Error ? {cause: error} : undefined,
    );
  }
}

/** Tool A 独立入口：固定调用 Python tool_a，并选择 Non-core flow。 */
export async function funcToolA(
  cachedSelection: LocSearchReplyRawType,
  toolInput: AiToolInputReqType,
  context: ToolExecutionContextType,
  services: ToolFlowServicesType,
): Promise<PublishedToolFlowResultType> {
  context.throwIfAborted();
  const resolvedBasemap = resolveBasemap(toolInput.basemap);
  const pythonQuery = exportToolsQueryForPython(cachedSelection, toolInput);
  const toolReply = await callPythonTool("tool_a", pythonQuery, context.signal);
  context.throwIfAborted();
  return publishToolFlow({
    requestedFlow: "non_core",
    cachedSelection,
    toolInput,
    pythonQuery,
    toolReply,
    resolvedBasemap,
  }, context, services);
}

/** Tool B 独立入口：固定调用 Python tool_b，并选择 Core flow。 */
export async function funcToolB(
  cachedSelection: LocSearchReplyRawType,
  toolInput: AiToolInputReqType,
  context: ToolExecutionContextType,
  services: ToolFlowServicesType,
): Promise<PublishedToolFlowResultType> {
  context.throwIfAborted();
  const resolvedBasemap = resolveBasemap(toolInput.basemap);
  const pythonQuery = exportToolsQueryForPython(cachedSelection, toolInput);
  const toolReply = await callPythonTool("tool_b", pythonQuery, context.signal);
  context.throwIfAborted();
  return publishToolFlow({
    requestedFlow: "core",
    cachedSelection,
    toolInput,
    pythonQuery,
    toolReply,
    resolvedBasemap,
  }, context, services);
}
