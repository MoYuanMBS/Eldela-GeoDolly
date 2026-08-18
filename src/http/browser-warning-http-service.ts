/** 全局共享的 Browser warning 专用 HTTP service。 */

import {createServer, type IncomingMessage, type Server, type ServerResponse} from "node:http";
import type {WebConfigType} from "../models/backend/config-models.js";
import {BROWSER_WARNING_ROUTE} from "../models/common/browser-warning-models.js";
import {logger, recordBrowserWarning} from "../utils/logger.js";

const INTERNAL_REQUEST_TIMEOUT_MS = 10_000;
const INTERNAL_KEEP_ALIVE_TIMEOUT_MS = 5_000;

function writeEmptyResponse(response: ServerResponse, statusCode: number, extraHeaders: Readonly<Record<string, string>> = {}): void {
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-length": "0",
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  });
  response.end();
}

/**
 * 在 JSON.parse 前累计并限制原始字节数。
 *
 * 超限后继续丢弃剩余 chunk，确保内存保持有界；HTTP server 的 request timeout 负责限制恶意慢请求
 * 占用连接的最长时间。
 */
async function readWarningJson(request: IncomingMessage, maxBodyBytes: number) {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let bodyTooLarge = false;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBodyBytes) {
      bodyTooLarge = true;
      chunks.length = 0;
      continue;
    }
    if (!bodyTooLarge) chunks.push(buffer);
  }
  if (bodyTooLarge) return {status: "too_large"} as const;

  try {
    return {status: "ok", payload: JSON.parse(Buffer.concat(chunks, totalBytes).toString("utf8")) as unknown} as const;
  } catch {
    return {status: "invalid_json"} as const;
  }
}

/**
 * 创建只处理 `POST /browser-warnings` 的 Node HTTP server。
 *
 * 本服务不提供页面、Map payload、session 或 snapshot route。限流在当前全局 service 内按固定窗口
 * 计数，Browser 页面仍负责事件去重；无效请求只得到 4xx，不产生新的 warning 日志放大攻击流量。
 */
export function createBrowserWarningHttpService(httpConfig: WebConfigType["http"]): Server {
  const warningConfig = httpConfig.warning;
  const rateLimitWindowMs = warningConfig.rate_limit_window_seconds * 1000;
  let rateLimitWindowStartedAt = Date.now();
  let requestCountInWindow = 0;

  const takeRateLimitQuota = (): boolean => {
    const now = Date.now();
    if (now - rateLimitWindowStartedAt >= rateLimitWindowMs) {
      rateLimitWindowStartedAt = now;
      requestCountInWindow = 0;
    }
    if (requestCountInWindow >= warningConfig.max_requests_per_window) return false;
    requestCountInWindow += 1;
    return true;
  };

  const server = createServer((request, response) => {
    void (async () => {
      const requestUrl = new URL(request.url ?? "/", "http://geomcp.internal");
      if (requestUrl.pathname !== BROWSER_WARNING_ROUTE || requestUrl.search !== "") {
        writeEmptyResponse(response, 404);
        return;
      }
      if (!takeRateLimitQuota()) {
        writeEmptyResponse(response, 429, {"retry-after": String(warningConfig.rate_limit_window_seconds)});
        return;
      }
      if (request.method !== "POST") {
        writeEmptyResponse(response, 405, {allow: "POST"});
        return;
      }
      const contentType = request.headers["content-type"];
      if (typeof contentType !== "string" || contentType.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
        writeEmptyResponse(response, 415);
        return;
      }

      const contentLength = request.headers["content-length"];
      if (contentLength !== undefined) {
        const parsedContentLength = Number(contentLength);
        if (!Number.isSafeInteger(parsedContentLength) || parsedContentLength < 0) {
          writeEmptyResponse(response, 400);
          return;
        }
        if (parsedContentLength > warningConfig.max_body_bytes) {
          request.resume();
          writeEmptyResponse(response, 413);
          return;
        }
      }

      const bodyResult = await readWarningJson(request, warningConfig.max_body_bytes);
      if (bodyResult.status === "too_large") {
        writeEmptyResponse(response, 413);
        return;
      }
      if (bodyResult.status === "invalid_json" || !recordBrowserWarning(bodyResult.payload)) {
        writeEmptyResponse(response, 400);
        return;
      }
      writeEmptyResponse(response, 204);
    })().catch(() => {
      // 请求流异常属于 warning service 自身诊断，不向 Browser 泄漏底层异常文本。
      logger.warning("browser_warning_http_request_failed", {reason_code: "request_stream_error"});
      if (!response.headersSent) writeEmptyResponse(response, 500);
      else if (!response.writableEnded) response.end();
    });
  });

  // warning payload 极小，固定内部超时用于防止慢请求长期占用全局共享 listener。
  server.requestTimeout = INTERNAL_REQUEST_TIMEOUT_MS;
  server.headersTimeout = INTERNAL_REQUEST_TIMEOUT_MS;
  server.keepAliveTimeout = INTERNAL_KEEP_ALIVE_TIMEOUT_MS;
  server.maxHeadersCount = 32;
  server.on("clientError", (_error, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });
  return server;
}
