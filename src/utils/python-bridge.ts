/**
 * Current authority source: doc/GeoMCP 技术规范文档.md
 *
 * Python bridge only handles protocol-boundary work:
 * - validate MCP-side input with Zod
 * - wrap data into the Python bridge envelope
 * - parse / unwrap Python responses
 * - strip geojson before returning search data to AI
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

import {
  type AppErrorType,
  type BridgeActionType,
  type BridgeRequestType,
  type BridgeResponseType,
  type JsonDictType,
  type JsonValueType,
  type LocSearchReplyRawType,
  type LocSearchReplyType,
  type PyToolReqType,
  type AiToolInputReqType,
  bridgeResponseSchemaFn,
  bridgeRequestSchemaFn,
  locSearchReplySchema,
  BridgeActionsRegistry,
  pyToolReqSchema
} from "../models/bridge-models.js";
import { filterAvailableExpertNames } from "./config-loader.js";

const PYTHON_ENTRYPOINT = "python/main.py";

/**
 * 解析当前请求应使用的 Python 解释器。
 *
 * 优先级：
 * 1. MCP / 部署环境显式传入的 `PYTHON_PATH`
 * 2. 仓库根目录下的 `.venv`
 * 3. 最后才回退到系统解释器名称
 *
 * 这样可以避免误用系统 Python，确保 bridge 优先走项目自己的虚拟环境。
 */
export function resolvePythonExecutable(): string {
  const pythonPathFromEnv = process.env.PYTHON_PATH?.trim();

  if (pythonPathFromEnv) {
    return pythonPathFromEnv;
  }

  const projectRoot = process.cwd();
  const venvCandidates = process.platform === "win32"
    ? [
        path.join(projectRoot, ".venv", "Scripts", "python.exe"),
        path.join(projectRoot, "venv", "Scripts", "python.exe"),
      ]
    : [
        path.join(projectRoot, ".venv", "bin", "python"),
        path.join(projectRoot, "venv", "bin", "python"),
      ];

  for (const candidate of venvCandidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return process.platform === "win32" ? "python" : "python3";
}

export class PythonBridgeError extends Error {
  readonly code: string;
  readonly details: JsonValueType | undefined;

  constructor(error: AppErrorType) {
    super(error.message);
    this.name = "PythonBridgeError";
    this.code = error.code;
    this.details = error.details;
  }
}

/**
 * 按 Python bridge 约定，把业务数据包装成统一请求 envelope。
 */
export function buildBridgeRequestData<T extends JsonDictType>(
  action: BridgeActionType,
  data: T,
): BridgeRequestType<T> {
  return {
    action,
    data,
  };
}

/**
 * 解析 Python stdout，并按 `ok + data + error` 结构做校验。
 */
export function parseBridgeResponseData<T extends z.ZodTypeAny>(
  stdout: string,
  dataSchema: T,
): BridgeResponseType<z.infer<T>> {
  const parsedJson = JSON.parse(stdout) as unknown;
  const responseEnvelope = bridgeResponseSchemaFn(dataSchema).parse(parsedJson) as BridgeResponseType<
    z.infer<T>
  >;

  return responseEnvelope;
}

/**
 * 解开 Python bridge 响应外层：
 * - `ok=false` 时抛出结构化 bridge 错误
 * - `ok=true` 时返回内部 `data`
 */
export function unwrapBridgeResponseData<T>(response: BridgeResponseType<T>): T {
  if (!response.ok) {
    if (response.error) {
      throw new PythonBridgeError(response.error);
    }

    throw new Error("python bridge returned ok=false without an error payload");
  }

  if (response.data === null) {
    throw new Error("python bridge returned ok=true with null data");
  }

  return response.data;
}

/**
 * Python 内部保留 `geojson` 供 session/后续工具使用；
 * 返回给 AI 前必须裁掉该字段，其余字段保持不变。
 */
export function sanitizeSearchResponseForAI(
  rawResponse: LocSearchReplyRawType,
): LocSearchReplyType {
  const sanitized = {
    ...rawResponse,
    candidates: rawResponse.candidates.map(({ geojson: _geojson, ...candidate }) => candidate),
  };

  return locSearchReplySchema.parse(sanitized);
}

/**
 * 通用 Python 调用入口。
 *
 * 这层 bridge 主要负责 4 件事：
 * 1. 先用 Zod 校验调用方传入的 payload，避免把脏数据直接送进 Python
 * 2. 把 `{ action, data }` 包装成统一请求 envelope，并通过 stdin 发给 Python
 * 3. 收集 Python 的 stdout/stderr；其中 stdout 按约定只应包含最终 JSON 响应
 * 4. 用 responseSchema 校验 Python 返回值，最后只把内部 data 解包给调用方
 *
 * 这里不额外写 `async/await`，而是直接返回 Promise：
 * child_process 本身就是事件驱动模型，最终在 `close` 时 resolve/reject 即可。
 */
function callPython<
  TRequestSchema extends z.ZodType<JsonDictType>,
  TResponseSchema extends z.ZodTypeAny,
>(
  action: BridgeActionType,
  requestSchema: TRequestSchema,
  responseSchema: TResponseSchema,
  payload: unknown,
): Promise<z.infer<TResponseSchema>> {
  const pythonExecutable = resolvePythonExecutable();

  // 验原始 payload 是否符合当前 action 对应的请求 schema。。
  const validatedPayload = requestSchema.parse(payload);

  // 把业务 payload 包成 bridge 统一约定的 envelope：
  const requestEnvelope = bridgeRequestSchemaFn(requestSchema).parse(
    buildBridgeRequestData(action, validatedPayload),
  );

  return new Promise((resolve, reject) => {
    // 启动 Python 入口程序。
    const child = spawn(pythonExecutable, [PYTHON_ENTRYPOINT], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Node 的 stream 会分块收到数据，所以这里先累计到字符串里，
    let stdout = "";
    let stderr = "";

    // Python stdout 约定只输出最终 JSON 响应；
    // 如果中间掺杂了 print 调试文本，后面的 JSON.parse 就会失败。
    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    // stderr 不参与协议解析，只作为诊断信息保留。
    // 当 Python 异常、traceback、或桥接格式不对时，最终错误信息会把它带上。
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    // 这里处理的是“进程级错误”
    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      // Python 正常结束后，理论上 stdout 必须至少有一份 JSON 响应。
      // 如果完全没有 stdout，说明 Python 没按 bridge 协议返回结果，
      // 这时把 exit code 和 stderr 一起带出去，方便定位问题。
      if (!stdout.trim()) {
        reject(
          new Error(
            `python process returned no stdout (exit code ${code ?? "unknown"}): ${stderr.trim()}`,
          ),
        );
        return;
      }

      try {
        // 把 stdout 当成 JSON 响应 envelope 来解析。
        // parseBridgeResponseData 会做两件事：
        // 1. JSON.parse(stdout)
        // 2. 用 responseSchema 校验外层 ok/data/error 以及内部 data 结构
        const responseEnvelope = parseBridgeResponseData(stdout, responseSchema);

        // unwrapBridgeResponseData 会按 bridge 约定解开 envelope：
        // - ok=true  -> 返回内部 data
        // - ok=false -> 把 Python 返回的结构化错误包装成 PythonBridgeError 再抛出
        resolve(unwrapBridgeResponseData(responseEnvelope));
      } catch (error) {
        // 兜底“响应处理失败”的情况
        reject(
          new Error(
            `failed to handle python bridge response: ${String(error)}\nstderr: ${stderr.trim()}\nstdout: ${stdout.trim()}`,
          ),
        );
      }
    });

    // 把请求送给 Python：
    child.stdin.write(JSON.stringify(requestEnvelope));
    child.stdin.end();
  });
}

export function callBridge(
  action: BridgeActionType,
  payload: unknown,
): Promise<JsonValueType> {
  // `error` 只保留给协议层类型对齐，不允许作为主动调用的 bridge action。
  if (action === "error") {
    throw new Error("cannot call bridge with action 'error'");
  }

  const registryEntry = BridgeActionsRegistry[action];

  return callPython(action, registryEntry.requestSchema, registryEntry.responseSchema, payload);
}

export function exportToolsQueryForPython(
  cachedSelection: LocSearchReplyRawType,
  query: AiToolInputReqType,
): PyToolReqType {
  const selectedIndex = query.selected_indices[0];
  const selected = cachedSelection.candidates.find((candidate) => candidate.index === selectedIndex);

  if (!selected) {
    throw new Error(`selected candidate index ${selectedIndex} not found in cached search response`);
  }

  return pyToolReqSchema.parse({
    session_id: query.session_id,
    selected_candidate: selected,
    basemap: query.basemap,
    attention_experts: filterAvailableExpertNames(query.attention_experts ?? []),
  });
}
