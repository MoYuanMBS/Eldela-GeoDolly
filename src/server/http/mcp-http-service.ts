/** 常驻后端的 Streamable HTTP MCP 入口；transport session 不持有地图 Session 生命周期。 */

import {randomUUID} from "node:crypto";
import {createServer, type IncomingMessage, type Server, type ServerResponse} from "node:http";
import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StreamableHTTPServerTransport} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {isInitializeRequest} from "@modelcontextprotocol/sdk/types.js";

import type {WebConfigType} from "../../models/backend/config-models.js";
import type {McpSessionEntry} from "../../models/backend/mcp-http-models.js";
import {AppError} from "../../shared/app-error.js";
import {logger} from "../utils/logger.js";

const MCP_ROUTE = "/mcp";

function writeJsonError(response: ServerResponse, statusCode: number, code: number, message: string): void {
  if (response.headersSent || response.writableEnded) return;
  const body = JSON.stringify({jsonrpc: "2.0", error: {code, message}, id: null});
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(body)),
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

async function readPostBody(request: IncomingMessage, maxBodyBytes: number): Promise<{status: "ok"; body: unknown} | {status: "invalid" | "too_large"}> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let tooLarge = false;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBodyBytes) {
      tooLarge = true;
      chunks.length = 0;
      continue;
    }
    if (!tooLarge) chunks.push(buffer);
  }
  if (tooLarge) return {status: "too_large"};
  try {
    return {status: "ok", body: JSON.parse(Buffer.concat(chunks, totalBytes).toString("utf8")) as unknown};
  } catch {
    return {status: "invalid"};
  }
}

export function createMcpHttpService(httpConfig: WebConfigType["http"], buildServer: () => McpServer) {
  const sessions = new Map<string, McpSessionEntry>();
  const entries = new Set<McpSessionEntry>();
  const idleTimeoutMs = httpConfig.mcp.session_idle_timeout_seconds * 1000;
  let closing = false;
  let closePromise: Promise<void> | null = null;

  const clearIdleTimer = (entry: McpSessionEntry): void => {
    if (entry.idleTimer !== null) clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  };

  const closeEntry = (entry: McpSessionEntry): Promise<void> => {
    if (entry.closePromise !== null) return entry.closePromise;
    entry.closed = true;
    clearIdleTimer(entry);
    if (entry.sessionId !== null) sessions.delete(entry.sessionId);
    entries.delete(entry);
    entry.closePromise = entry.server.close();
    return entry.closePromise;
  };

  const scheduleIdleClose = (entry: McpSessionEntry): void => {
    if (entry.closed || entry.sessionId === null || entry.activePostRequests !== 0) return;
    clearIdleTimer(entry);
    entry.idleTimer = setTimeout(() => {
      void closeEntry(entry).catch((error: unknown) => {
        logger.warning("mcp_session_close_failed", {reason: error instanceof Error ? error.message : String(error)});
      });
    }, idleTimeoutMs);
    entry.idleTimer.unref();
  };

  const httpServer = createServer((request, response) => {
    void (async () => {
      const requestUrl = new URL(request.url ?? "/", "http://geomcp.internal");
      if (requestUrl.pathname !== MCP_ROUTE || requestUrl.search !== "") {
        writeJsonError(response, 404, -32001, "MCP route not found");
        return;
      }
      if (closing) {
        writeJsonError(response, 503, -32000, "MCP service is shutting down");
        return;
      }
      const origin = request.headers.origin;
      if (origin !== undefined && !httpConfig.mcp.allowed_origins.includes(origin)) {
        writeJsonError(response, 403, -32000, "Origin is not allowed");
        return;
      }
      if (request.method !== "POST" && request.method !== "GET" && request.method !== "DELETE") {
        response.setHeader("allow", "POST, GET, DELETE");
        writeJsonError(response, 405, -32000, "Method not allowed");
        return;
      }
      const rawSessionId = request.headers["mcp-session-id"];
      if (Array.isArray(rawSessionId)) {
        writeJsonError(response, 400, -32000, "Invalid MCP session ID");
        return;
      }
      const sessionId = rawSessionId === undefined || rawSessionId === "" ? null : rawSessionId;
      let parsedBody: unknown;
      if (request.method === "POST") {
        const parsed = await readPostBody(request, httpConfig.mcp.max_body_bytes);
        if (parsed.status !== "ok") {
          writeJsonError(response, parsed.status === "too_large" ? 413 : 400, -32700, parsed.status === "too_large" ? "MCP request body is too large" : "Invalid JSON request body");
          return;
        }
        parsedBody = parsed.body;
      }
      if (closing) {
        writeJsonError(response, 503, -32000, "MCP service is shutting down");
        return;
      }

      let entry: McpSessionEntry;
      if (sessionId === null) {
        if (request.method !== "POST" || !isInitializeRequest(parsedBody)) {
          writeJsonError(response, 400, -32000, "MCP session ID or initialize request is required");
          return;
        }
        const server = buildServer();
        entry = {
          server,
          transport: new StreamableHTTPServerTransport({
            sessionIdGenerator: randomUUID,
            onsessioninitialized: (initializedId) => {
              entry.sessionId = initializedId;
              sessions.set(initializedId, entry);
            },
          }),
          sessionId: null,
          activePostRequests: 0,
          idleTimer: null,
          closePromise: null,
          closed: false,
        };
        entries.add(entry);
        try {
          await server.connect(entry.transport);
        } catch (error) {
          await closeEntry(entry);
          throw error;
        }
        server.server.onclose = () => {
          entry.closed = true;
          clearIdleTimer(entry);
          if (entry.sessionId !== null) sessions.delete(entry.sessionId);
          entries.delete(entry);
        };
      } else {
        const existing = sessions.get(sessionId);
        if (existing === undefined || existing.closed) {
          writeJsonError(response, 404, -32001, "MCP session not found");
          return;
        }
        entry = existing;
      }

      clearIdleTimer(entry);
      if (request.method === "POST") entry.activePostRequests += 1;
      // GET 事件流可长期保持连接；它本身不算持续的工具活动。
      else if (request.method === "GET") scheduleIdleClose(entry);
      try {
        await entry.transport.handleRequest(request, response, parsedBody);
      } finally {
        if (request.method === "POST") entry.activePostRequests -= 1;
        if (entry.sessionId === null) await closeEntry(entry);
        else scheduleIdleClose(entry);
      }
    })().catch((error: unknown) => {
      logger.warning("mcp_http_request_failed", {reason: error instanceof Error ? error.message : String(error)});
      if (!response.headersSent) writeJsonError(response, 500, -32603, "Internal MCP request error");
      else if (!response.writableEnded) response.end();
    });
  });

  const requestReceiveTimeoutMs = httpConfig.mcp.request_receive_timeout_seconds * 1000;
  httpServer.requestTimeout = requestReceiveTimeoutMs;
  httpServer.headersTimeout = requestReceiveTimeoutMs;
  httpServer.maxHeadersCount = 32;
  httpServer.on("clientError", (_error, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });

  const close = (): Promise<void> => {
    if (closePromise !== null) return closePromise;
    closing = true;
    closePromise = (async () => {
      await Promise.all([...entries].map(closeEntry));
      if (!httpServer.listening) return;
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => error === undefined ? resolve() : reject(error));
      });
    })();
    return closePromise;
  };
  return {server: httpServer, close};
}

export function listenMcpHttpService(service: ReturnType<typeof createMcpHttpService>, httpConfig: WebConfigType["http"]): Promise<void> {
  return new Promise((resolve, reject) => {
    const handleError = (error: Error): void => {
      service.server.off("listening", handleListening);
      reject(AppError.fromUnknown(error, "mcp_http_listen", "MCP HTTP service could not start"));
    };
    const handleListening = (): void => {
      service.server.off("error", handleError);
      resolve();
    };
    service.server.once("error", handleError);
    service.server.once("listening", handleListening);
    service.server.listen(httpConfig.mcp.port, httpConfig.listen_host);
  });
}
