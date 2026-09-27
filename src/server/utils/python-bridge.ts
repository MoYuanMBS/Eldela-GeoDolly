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
} from "../../models/backend/bridge-models.js";
import {AppError} from "../../shared/app-error.js";
import { config } from "./config-loader.js";
import {buildFinalSessionId} from "./session-id.js";

const PYTHON_MODULE = "python.main";

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

/** 保留旧的专用类名供调用方识别，其实例同时遵守统一 AppError 契约。 */
export class PythonBridgeError extends AppError {
  constructor(error: AppErrorType) {
    super(error.code, error.message, error.details ?? null);
    this.name = "PythonBridgeError";
  }
}

function bridgeAbortError(signal: AbortSignal): AppError {
  if (signal.reason instanceof AppError) return signal.reason;
  const message = signal.reason instanceof Error ? signal.reason.message : "Python bridge call was cancelled";
  return new AppError("python_bridge_cancelled", message, null, signal.reason instanceof Error ? {cause: signal.reason} : undefined);
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

    throw new AppError("invalid_bridge_response", "python bridge returned ok=false without an error payload");
  }

  if (response.data === null) {
    throw new AppError("invalid_bridge_response", "python bridge returned ok=true with null data");
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
  signal?: AbortSignal,
): Promise<z.infer<TResponseSchema>> {
  if (signal?.aborted === true) return Promise.reject(bridgeAbortError(signal));
  const pythonExecutable = resolvePythonExecutable();

  // 验原始 payload 是否符合当前 action 对应的请求 schema。。
  const validatedPayload = requestSchema.parse(payload);

  // 把业务 payload 包成 bridge 统一约定的 envelope：
  const requestEnvelope = bridgeRequestSchemaFn(requestSchema).parse(
    buildBridgeRequestData(action, validatedPayload),
  );

  return new Promise((resolve, reject) => {
    // 启动 Python 入口程序。
    const child = spawn(pythonExecutable, ["-m", PYTHON_MODULE], {
      // POSIX 使用独立进程组，取消时连同 Python 可能派生的子进程一起终止。
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Node 的 stream 会分块收到数据，所以这里先累计到字符串里，
    let stdout = "";
    let stderr = "";
    let settled = false;
    let abortFailure: AppError | null = null;
    const removeAbortListener = (): void => signal?.removeEventListener("abort", handleAbort);
    const rejectOnce = (error: unknown): void => {
      if (settled) return;
      settled = true;
      removeAbortListener();
      reject(error);
    };
    const resolveOnce = (value: z.infer<TResponseSchema>): void => {
      if (settled) return;
      settled = true;
      removeAbortListener();
      resolve(value);
    };
    const handleAbort = (): void => {
      if (signal === undefined || abortFailure !== null || settled) return;
      abortFailure = bridgeAbortError(signal);
      // Promise 只在 close 后拒绝，确保 scheduler 释放 worker 时 Python 已经真实退出。
      child.stdin.destroy();
      try {
        if (process.platform !== "win32" && child.pid !== undefined) process.kill(-child.pid, "SIGTERM");
        else if (!child.killed) child.kill("SIGTERM");
      } catch {
        // 进程恰好已经退出时 close 会立即收敛；不能让终止竞争覆盖原始取消原因。
      }
    };
    signal?.addEventListener("abort", handleAbort, {once: true});
    // spawn 到 listener 注册之间也可能取消，注册后立即补查避免遗漏。
    if (signal?.aborted === true) handleAbort();

    // Python stdout 约定只输出最终 JSON 响应；
    // 如果中间掺杂了 print 调试文本，后面的 JSON.parse 就会失败。
    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    // stderr 不参与 Bridge 协议；warning 实时写到后端终端，同时保留原文供失败诊断。
    child.stderr.on("data", (chunk: Buffer | string) => {
      const message = chunk.toString();
      stderr += message;
      process.stderr.write(message);
    });

    // 这里处理的是“进程级错误”
    child.on("error", (error) => {
      rejectOnce(abortFailure ?? new AppError("python_process", error.message, null, {cause: error}));
    });

    child.on("close", (code) => {
      if (settled) return;
      if (abortFailure !== null) {
        rejectOnce(abortFailure);
        return;
      }
      // Python 正常结束后，理论上 stdout 必须至少有一份 JSON 响应。
      // 如果完全没有 stdout，说明 Python 没按 bridge 协议返回结果，
      // 这时把 exit code 和 stderr 一起带出去，方便定位问题。
      if (!stdout.trim()) {
        rejectOnce(
          new AppError(
            "empty_bridge_response",
            `python process returned no stdout (exit code ${code ?? "unknown"}): ${stderr.trim()}`,
            {exit_code: code, stderr: stderr.trim()},
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
        resolveOnce(unwrapBridgeResponseData(responseEnvelope));
      } catch (error) {
        // Python 明确返回的 AppError 保留原 code；只把 JSON/Zod 等边界异常收敛为响应错误。
        if (error instanceof AppError) rejectOnce(error);
        else rejectOnce(new AppError("invalid_bridge_response", `failed to handle python bridge response: ${String(error)}\nstderr: ${stderr.trim()}\nstdout: ${stdout.trim()}`, {
          reason: error instanceof Error ? error.message : String(error),
          stderr: stderr.trim(),
          stdout: stdout.trim(),
        }, error instanceof Error ? {cause: error} : undefined));
      }
    });

    // 把请求送给 Python：
    if (abortFailure === null) {
      child.stdin.write(JSON.stringify(requestEnvelope));
      child.stdin.end();
    }
  });
}

export function callBridge(
  action: BridgeActionType,
  payload: unknown,
  signal?: AbortSignal,
): Promise<JsonValueType> {
  // `error` 只保留给协议层类型对齐，不允许作为主动调用的 bridge action。
  if (action === "error") {
    throw new AppError("invalid_bridge_action", "cannot call bridge with action 'error'");
  }

  const registryEntry = BridgeActionsRegistry[action];

  return callPython(action, registryEntry.requestSchema, registryEntry.responseSchema, payload, signal);
}

export function exportToolsQueryForPython(
  cachedSelection: LocSearchReplyRawType,
  query: AiToolInputReqType,
): PyToolReqType {
  const selectedIndex = query.selected_indices[0];
  const selected = cachedSelection.candidates.find((candidate) => candidate.index === selectedIndex);

  if (!selected) {
    throw new AppError("missing_candidate", `selected candidate index ${selectedIndex} not found in cached search response`);
  }

  return pyToolReqSchema.parse({
    // Tool A/B 从第二次正式调用开始统一携带候选 index，避免并发任务串用目录与结果。
    session_id: buildFinalSessionId(query.session_id, selected.index),
    selected_candidate: selected,
    attention_experts: config.filterAvailableExpertNames(query.attention_experts ?? []),
  });
}
