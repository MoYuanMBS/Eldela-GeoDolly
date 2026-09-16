/** Map HTTP service 的内部 Snapshot route 与 Browser 构建资源。 */

import {readFileSync} from "node:fs";
import {readFile, stat} from "node:fs/promises";
import {createServer, type Server, type ServerResponse} from "node:http";
import path from "node:path";
import type {WebConfigType} from "../models/backend/config-models.js";
import type {SnapshotTokenStore} from "../screenshot/snapshot-token-store.js";
import {AppError} from "../utils/app-error.js";
import {logger} from "../utils/logger.js";

const INTERNAL_REQUEST_TIMEOUT_MS = 10_000;
const INTERNAL_KEEP_ALIVE_TIMEOUT_MS = 5_000;
const SNAPSHOT_ROUTE_PATTERN = /^\/_geomcp\/snapshot\/([0-9a-f]{64})(\/data)?$/u;
const SNAPSHOT_FLOW_ATTRIBUTE = 'data-geomcp-browser-flow="interactive"';
const MAP_DATA_META_PATTERN = /<meta\s+name="geomcp-map-data-url"\s+content="[^"]*"\s*\/>/u;

const ASSET_CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

function writeResponse(response: ServerResponse, statusCode: number, body: string | Buffer = "", headers: Readonly<Record<string, string>> = {}): void {
  const bodyBuffer = typeof body === "string" ? Buffer.from(body) : body;
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-length": String(bodyBuffer.byteLength),
    "x-content-type-options": "nosniff",
    ...headers,
  });
  response.end(bodyBuffer);
}

function buildSnapshotHtml(htmlTemplate: string, token: string): string {
  if (!htmlTemplate.includes(SNAPSHOT_FLOW_ATTRIBUTE) || !MAP_DATA_META_PATTERN.test(htmlTemplate)) {
    throw new AppError("invalid_browser_build", "Browser index does not expose the required Snapshot injection points");
  }
  const dataPath = `/_geomcp/snapshot/${token}/data`;
  return htmlTemplate
    .replace(SNAPSHOT_FLOW_ATTRIBUTE, 'data-geomcp-browser-flow="snapshot"')
    .replace(MAP_DATA_META_PATTERN, `<meta name="geomcp-map-data-url" content="${dataPath}" />`);
}

function resolveAssetPath(assetsRootPath: string, encodedPathname: string): string | null {
  let pathname: string;
  try {
    pathname = decodeURIComponent(encodedPathname);
  } catch {
    return null;
  }
  if (!pathname.startsWith("/assets/") || pathname.includes("\0")) return null;
  const relativePath = pathname.slice("/assets/".length);
  if (relativePath.length === 0 || relativePath.includes("/") || relativePath === "." || relativePath === "..") return null;
  const assetPath = path.resolve(assetsRootPath, relativePath);
  return path.dirname(assetPath) === assetsRootPath ? assetPath : null;
}

/** Playwright 连接 wildcard listener 时使用 loopback；公开 origin 不参与预发布截图。 */
export function getInternalMapOrigin(httpConfig: WebConfigType["http"]): string {
  const configuredHost = httpConfig.listen_host;
  const connectHost = configuredHost === "0.0.0.0" ? "127.0.0.1" : configuredHost === "::" ? "::1" : configuredHost;
  const urlHost = connectHost.includes(":") && !connectHost.startsWith("[") ? `[${connectHost}]` : connectHost;
  return `http://${urlHost}:${httpConfig.map.port}`;
}

/**
 * 创建当前只处理内部 Snapshot route 的 map listener。
 *
 * HTML route 仅验证 token；data route 先原子消费再序列化，因此刷新 data、重放或并发第二次读取均为
 * 404。构建资源只允许访问 dist/web/assets 的单层 hash 文件，不能借路径穿越读取 cache 或源码。
 */
export function createMapHttpService(httpConfig: WebConfigType["http"], tokenStore: SnapshotTokenStore): Server {
  const webRootPath = path.resolve(process.cwd(), "dist", "web");
  const assetsRootPath = path.join(webRootPath, "assets");
  let htmlTemplate: string;
  try {
    htmlTemplate = readFileSync(path.join(webRootPath, "index.html"), "utf8");
  } catch (error) {
    throw AppError.fromUnknown(error, "browser_build_not_found", "Browser build index could not be loaded");
  }

  const server = createServer((request, response) => {
    void (async () => {
      const requestUrl = new URL(request.url ?? "/", "http://geomcp.internal");
      if (request.method !== "GET") {
        writeResponse(response, 405, "", {allow: "GET"});
        return;
      }
      if (requestUrl.search !== "") {
        writeResponse(response, 404);
        return;
      }

      const routeMatch = SNAPSHOT_ROUTE_PATTERN.exec(requestUrl.pathname);
      if (routeMatch !== null) {
        const token = routeMatch[1];
        const isDataRoute = routeMatch[2] === "/data";
        if (isDataRoute) {
          const payload = tokenStore.consume(token);
          if (payload === null) {
            writeResponse(response, 404);
            return;
          }
          writeResponse(response, 200, JSON.stringify(payload), {"content-type": "application/json; charset=utf-8"});
          return;
        }
        if (!tokenStore.has(token)) {
          writeResponse(response, 404);
          return;
        }
        writeResponse(response, 200, buildSnapshotHtml(htmlTemplate, token), {"content-type": "text/html; charset=utf-8"});
        return;
      }

      const assetPath = resolveAssetPath(assetsRootPath, requestUrl.pathname);
      if (assetPath === null) {
        writeResponse(response, 404);
        return;
      }
      try {
        const assetStats = await stat(assetPath);
        if (!assetStats.isFile()) {
          writeResponse(response, 404);
          return;
        }
        const body = await readFile(assetPath);
        const contentType = ASSET_CONTENT_TYPES[path.extname(assetPath).toLowerCase()] ?? "application/octet-stream";
        writeResponse(response, 200, body, {
          "cache-control": "public, max-age=31536000, immutable",
          "content-type": contentType,
        });
      } catch {
        writeResponse(response, 404);
      }
    })().catch(() => {
      logger.warning("map_http_request_failed", {reason_code: "internal_request_error"});
      if (!response.headersSent) writeResponse(response, 500);
      else if (!response.writableEnded) response.end();
    });
  });

  server.requestTimeout = INTERNAL_REQUEST_TIMEOUT_MS;
  server.headersTimeout = INTERNAL_REQUEST_TIMEOUT_MS;
  server.keepAliveTimeout = INTERNAL_KEEP_ALIVE_TIMEOUT_MS;
  server.maxHeadersCount = 32;
  server.on("clientError", (_error, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });
  return server;
}
