/**
 * 常驻 MCP HTTP(S) 入口：分发 MCP 与地图请求，管理每个客户端的 SDK 协议会话。
 * 搜索缓存、工具调度器与地图 SessionManager 由 index 创建并共享；
 * 客户端会话结束只释放本模块登记的 SDK 实例，全局业务服务的关闭由 index 负责。
 */

import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {createServer, type IncomingMessage, type Server, type ServerResponse} from "node:http";
import {createServer as createHttpsServer} from "node:https";
import {NodeStreamableHTTPServerTransport} from "@modelcontextprotocol/node";
import {isJSONRPCNotification, isJSONRPCRequest, isJSONRPCResponse, validateHostHeader, type McpServer} from "@modelcontextprotocol/server";
import type {WebConfigType} from "../../models/backend/config-models.js";
import type {McpHttpSession} from "../../models/backend/mcp-http-models.js";
import type {SessionManager} from "../map-session/session-manager.js";
import {AppError} from "../../shared/app-error.js";
import {logger} from "../utils/logger.js";
import {closeMapHttpService, createMapHttpRequestHandler} from "./map-http-service.js";

/** HTTP 入口错误使用 JSON-RPC envelope；已经开始的 SSE 响应只能结束，不能再写一组响应头。 */
function writeProtocolError(response: ServerResponse, status: number, message: string): void {
  if (response.headersSent) {
    if (!response.writableEnded) response.end();
    return;
  }
  response.writeHead(status, {"content-type": "application/json", "cache-control": "no-store"});
  response.end(JSON.stringify({jsonrpc: "2.0", error: {code: status === 404 ? -32001 : -32000, message}, id: null}));
}

/** 创建共用的公开 listener；index 负责监听端口，并在后端退出时调用返回的 close()。 */
export function createMcpHttpService(webConfig: WebConfigType, sessionManager: SessionManager, buildServer: () => McpServer) {
  const publicUrl = new URL(webConfig.http.map.public_origin);
  const publicBasePath = publicUrl.pathname.replace(/\/+$/u, "");
  // public_origin 的配置路径本身就是 MCP 入口；同一前缀下继续提供 session、assets 和 basemap。
  const mcpPath = publicBasePath || "/mcp";
  const allowedHosts = [publicUrl.hostname];
  // 本机配置允许 loopback 的等价写法；公网 IP 与域名不开放额外 Host。
  if (["localhost", "127.0.0.1", "[::1]"].includes(publicUrl.hostname)) allowedHosts.push("localhost", "127.0.0.1", "[::1]");
  // Origin 比较完整的协议、Host 和端口；不包含部署路径。无 Origin 的非浏览器客户端可正常访问。
  const allowedOrigins = new Set(allowedHosts.map((hostname) => `${publicUrl.protocol}//${hostname}${publicUrl.port ? `:${publicUrl.port}` : ""}`));
  const mapHandler = createMapHttpRequestHandler(webConfig, sessionManager, publicBasePath);
  // sessions 按 SDK 已分配的协议 ID 登记实例，供后续 HTTP 请求查找。
  const sessions = new Map<string, McpHttpSession>();
  // connections 还包含正在初始化的实例，确保初始化失败和后端退出时也能完整清理。
  const connections = new Set<McpHttpSession>();
  let closing = false;
  let closePromise: Promise<void> | null = null;

  /** 按 Mcp-Session-Id 分发请求；请求解析、初始化握手和 GET/POST/DELETE 协议语义交给 SDK。 */
  const handleMcpRequest = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const sessionId = request.headers["mcp-session-id"];
    if (Array.isArray(sessionId)) {
      writeProtocolError(response, 400, "Invalid Mcp-Session-Id header");
      return;
    }
    let session = sessionId === undefined ? undefined : sessions.get(sessionId);
    if (sessionId !== undefined && session === undefined) {
      // 已结束或未知的会话返回 404，由客户端重新初始化；不能用旧 ID 悄悄创建新会话。
      writeProtocolError(response, 404, "Session not found");
      return;
    }
    if (session === undefined) {
      if (request.method !== "POST") {
        writeProtocolError(response, request.method === "GET" || request.method === "DELETE" ? 400 : 405, "Initialize the MCP session with POST first");
        return;
      }
      // 首次 POST 可以创建临时实例；SDK 为 initialize 分配会话 ID 后才加入 sessions。
      const server = buildServer();
      const transport = new NodeStreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        onsessioninitialized: (id) => { sessions.set(id, connection); },
      });
      const connection: McpHttpSession = {server, transport, lastActivity: Date.now(), activeResponses: 0, pendingRequests: new Set()};
      connections.add(connection);
      // DELETE、闲置回收或全局关闭会触发此清理；普通 HTTP/SSE 断线不调用 server.close()。
      server.server.onclose = () => {
        if (transport.sessionId !== undefined) sessions.delete(transport.sessionId);
        connections.delete(connection);
      };
      server.server.onerror = () => logger.warning("mcp_session_protocol_error", {reason_code: "protocol_error"});
      try {
        await server.connect(transport);
        // HTTP 响应结束与工具执行完成是两个边界；独立跟踪请求，保护断线后仍在排队或执行的工具。
        const onmessage = transport.onmessage;
        transport.onmessage = (message, extra) => {
          if (isJSONRPCRequest(message)) connection.pendingRequests.add(message.id);
          onmessage?.(message, extra);
          if (isJSONRPCNotification(message) && message.method === "notifications/cancelled") {
            // SDK 接收通知后取消请求 signal，并可能省略回复；主动移除 ID、结束该请求的 SSE，避免永久残留。
            const requestId = message.params?.requestId;
            if (typeof requestId === "string" || typeof requestId === "number") {
              connection.pendingRequests.delete(requestId);
              transport.closeSSEStream(requestId);
            }
          }
        };
        const send = transport.send.bind(transport);
        transport.send = async (message, options) => {
          try {
            await send(message, options);
          } finally {
            // 发送失败也表示本次 handler 的回复已处理完，不能因客户端断线一直阻止会话回收。
            if (isJSONRPCResponse(message) && message.id !== undefined) connection.pendingRequests.delete(message.id);
            connection.lastActivity = Date.now();
          }
        };
      } catch (error) {
        // 连接 SDK 失败只关闭本次创建的实例；上层 HTTP 边界负责返回错误。
        await server.close();
        throw error;
      }
      session = connection;
    }
    session.lastActivity = Date.now();
    session.activeResponses += 1;
    try {
      await session.transport.handleRequest(request, response);
    } finally {
      session.activeResponses -= 1;
      session.lastActivity = Date.now();
      // 未生成协议 ID 的临时实例在本次响应结束后释放，防止无效初始化请求积累在 connections。
      if (session.transport.sessionId === undefined) await session.server.close();
    }
  };

  /** 公开入口先校验 Host/Origin，再按精确 MCP 路径分发；地图 handler 自行处理其余固定路由。 */
  const handler = (request: IncomingMessage, response: ServerResponse): void => {
    if (closing) {
      writeProtocolError(response, 503, "Server is shutting down");
      return;
    }
    const origin = request.headers.origin;
    if (!validateHostHeader(request.headers.host, allowedHosts).ok) {
      writeProtocolError(response, 403, "Host or Origin is not allowed");
      return;
    }
    let requestUrl: URL;
    try {
      requestUrl = new URL(request.url ?? "/", publicUrl.origin);
    } catch {
      writeProtocolError(response, 400, "Invalid request URL");
      return;
    }
    // App 的 opaque iframe 会以 Origin: null 读取底图；仅 GET 底图路径允许跨源，MCP 的 Origin 校验保持原样。
    const appTileRequest = request.method === "GET" && requestUrl.search === "" && requestUrl.pathname.startsWith(`${publicBasePath}/basemap/`);
    if (origin !== undefined && !allowedOrigins.has(origin) && !appTileRequest) {
      writeProtocolError(response, 403, "Host or Origin is not allowed");
      return;
    }
    if (requestUrl.pathname !== mcpPath || requestUrl.search !== "") {
      mapHandler(request, response);
      return;
    }
    response.setHeader("cache-control", "no-store");
    void handleMcpRequest(request, response).catch(() => {
      logger.warning("mcp_http_request_failed", {reason_code: "internal_request_error"});
      writeProtocolError(response, 500, "Internal server error");
    });
  };

  let server: Server;
  try {
    // 协议已由配置模型按公开 Host 类型确定；TLS 在请求到达前建立，证书装载失败直接上抛。
    server = publicUrl.protocol === "https:"
      ? createHttpsServer({cert: readFileSync(webConfig.http.tls.cert_file), key: readFileSync(webConfig.http.tls.key_file)}, handler)
      : createServer(handler);
  } catch (error) {
    throw AppError.fromUnknown(error, "https_configuration", "HTTPS requires a readable server certificate chain and matching private key");
  }
  server.maxHeadersCount = 32;
  server.on("clientError", (_error, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });

  // 复用现有 RAM 保留期限和检查节奏，但 MCP 独立计算闲置时间；活动响应或待回复工具都会阻止回收。
  const expiryTimer = setInterval(() => {
    const expiredBefore = Date.now() - webConfig.session.ttl_seconds * 1000;
    for (const session of connections) {
      if (session.activeResponses !== 0 || session.pendingRequests.size !== 0 || session.lastActivity > expiredBefore) continue;
      void session.server.close().catch(() => logger.warning("mcp_session_cleanup_failed", {reason_code: "session_close_failed"}));
    }
  }, Math.min(webConfig.session.max_timer_delay_ms, Math.max(1, Math.round(webConfig.session.expiry_check_interval_seconds * 1000))));
  expiryTimer.unref();

  return {
    server,
    endpoint: `${publicUrl.origin}${mcpPath}`,
    /** 后端退出时使用：先停止接受新请求，再关闭所有协议实例和残留 HTTP 连接；重复调用共用同一 Promise。 */
    close(): Promise<void> {
      if (closePromise !== null) return closePromise;
      closing = true;
      clearInterval(expiryTimer);
      closePromise = (async () => {
        // server.close() 要等现有响应结束，因此先取得关闭 Promise，待 SSE 清理后再等待它。
        const listenerClosed = closeMapHttpService(server);
        const results = await Promise.allSettled([...connections].map((session) => session.server.close()));
        // 先关闭协议会话，再结束残留 HTTP 连接，避免 SSE 阻塞进程退出。
        server.closeAllConnections();
        await listenerClosed;
        // 单个实例关闭失败也要先完成其他实例和 listener 的清理，最后统一上抛。
        const failure = results.find((result) => result.status === "rejected");
        if (failure?.status === "rejected") throw AppError.fromUnknown(failure.reason, "mcp_http_close", "MCP sessions could not close");
      })();
      return closePromise;
    },
  };
}
