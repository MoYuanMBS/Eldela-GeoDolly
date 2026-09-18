/** 已登记 Map Session 的公开 HTTP route 解析与响应构筑。 */

import {createHash} from "node:crypto";
import type {IncomingHttpHeaders} from "node:http";

import {buildMapRuntimePayloads} from "../map-session/map-runtime.js";
import type {SessionManager} from "../map-session/session-manager.js";
import type {SessionConfigType} from "../models/backend/config-models.js";
import {finalSessionIdSchema, type IndexSessionIdType} from "../models/backend/session-id-models.js";
import type {SessionHttpStatusType} from "../models/common/session-http-models.js";
import {
  readInteractiveMapArchiveFile,
  readSessionSnapshotFile,
  sessionDirectoryExists,
} from "../utils/file-writer.js";
import {AppError} from "../utils/app-error.js";

const SESSION_ROUTE_PATTERN = /^\/session\/([^/]+)\/(status|interactive|interactive\/data|snapshot-interactive|snapshot-interactive\/data|snapshot\.webp)$/u;
const INTERACTIVE_FLOW_ATTRIBUTE = 'data-geomcp-browser-flow="interactive"';
const MAP_DATA_META_PATTERN = /<meta\s+name="geomcp-map-data-url"\s+content="[^"]*"\s*\/>/u;

export interface MapHttpRouteResponseType {
  statusCode: number;
  body?: string | Buffer;
  headers?: Readonly<Record<string, string>>;
}

interface PublicSessionHtmlOptions {
  status: "active" | "archived";
  statusUrl: string;
  snapshotUrl: string;
}

/** 同一 Browser build 同时服务公开 Interactive 与 Snapshot Interactive 页面。 */
export function buildMapBrowserHtml(
  htmlTemplate: string,
  flow: "interactive" | "snapshot",
  dataUrl: string,
  session?: PublicSessionHtmlOptions,
): string {
  if (!htmlTemplate.includes(INTERACTIVE_FLOW_ATTRIBUTE) || !MAP_DATA_META_PATTERN.test(htmlTemplate)) {
    throw new AppError("invalid_browser_build", "Browser index does not expose the required Map injection points");
  }
  let html = htmlTemplate
    .replace(INTERACTIVE_FLOW_ATTRIBUTE, `data-geomcp-browser-flow="${flow}"`)
    .replace(MAP_DATA_META_PATTERN, `<meta name="geomcp-map-data-url" content="${dataUrl}" />`);
  if (session !== undefined) {
    const sessionMeta = [
      `<meta name="geomcp-session-status-url" content="${session.statusUrl}" />`,
      `<meta name="geomcp-session-snapshot-url" content="${session.snapshotUrl}" />`,
      `<meta name="geomcp-session-initial-status" content="${session.status}" />`,
    ].join("\n    ");
    html = html.replace("</head>", `    ${sessionMeta}\n  </head>`);
  }
  return html;
}

function emptyResponse(statusCode: number, headers?: Readonly<Record<string, string>>): MapHttpRouteResponseType {
  return {statusCode, headers};
}

function jsonResponse(value: unknown): MapHttpRouteResponseType {
  return {
    statusCode: 200,
    body: JSON.stringify(value),
    headers: {"content-type": "application/json; charset=utf-8"},
  };
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value.join(", ") : value;
}

function recheckAfterMilliseconds(config: SessionConfigType): number {
  return Math.min(config.max_timer_delay_ms, Math.max(1, Math.round(config.expiry_check_interval_seconds * 1000)));
}

async function removeMissingArchive(sessionManager: SessionManager, sessionId: IndexSessionIdType): Promise<MapHttpRouteResponseType | null> {
  if (await sessionDirectoryExists(sessionId)) return null;
  sessionManager.unregisterSession(sessionId);
  return emptyResponse(404);
}

/**
 * 返回 null 表示 pathname 不属于公开 Session route；已识别 route 的全部状态均在这里收敛，
 * 使 map listener 不会因为磁盘存在而绕过 RAM 真源开放孤儿目录。
 */
export async function resolveSessionHttpRoute(
  pathname: string,
  requestHeaders: IncomingHttpHeaders,
  htmlTemplate: string,
  sessionConfig: SessionConfigType,
  sessionManager: SessionManager,
): Promise<MapHttpRouteResponseType | null> {
  const routeMatch = SESSION_ROUTE_PATTERN.exec(pathname);
  if (routeMatch === null) return null;

  let decodedSessionId: string;
  try {
    decodedSessionId = decodeURIComponent(routeMatch[1]);
  } catch {
    return emptyResponse(404);
  }
  const parsedSessionId = finalSessionIdSchema.safeParse(decodedSessionId);
  if (!parsedSessionId.success) return emptyResponse(404);
  const sessionId = parsedSessionId.data;

  const lookup = sessionManager.lookupSession(sessionId);
  if (lookup.status === "missing") return emptyResponse(404);
  const missingArchiveResponse = await removeMissingArchive(sessionManager, sessionId);
  if (missingArchiveResponse !== null) return missingArchiveResponse;

  const route = routeMatch[2];
  if (route === "status") {
    const status: SessionHttpStatusType = lookup.status === "active"
      ? {status: "active", recheck_after_ms: recheckAfterMilliseconds(sessionConfig)}
      : {status: "archived"};
    return jsonResponse(status);
  }

  if (route === "interactive/data" || route === "snapshot-interactive/data") {
    if (lookup.status === "archived") return emptyResponse(410);
    const archive = await readInteractiveMapArchiveFile(sessionId);
    if (archive === null) {
      sessionManager.unregisterSession(sessionId);
      return emptyResponse(404);
    }
    const runtime = buildMapRuntimePayloads(archive);
    return jsonResponse(route === "interactive/data" ? runtime.interactive : runtime.snapshot);
  }

  if (route === "snapshot.webp") {
    const snapshot = await readSessionSnapshotFile(sessionId);
    if (snapshot === null) {
      sessionManager.unregisterSession(sessionId);
      return emptyResponse(404);
    }
    const etag = `"${createHash("sha256").update(snapshot).digest("base64url")}"`;
    const headers = {"cache-control": "no-cache", "content-type": "image/webp", etag};
    if (headerValue(requestHeaders, "if-none-match") === etag) return emptyResponse(304, headers);
    return {statusCode: 200, body: snapshot, headers};
  }

  const encodedSessionId = encodeURIComponent(sessionId);
  const basePath = `/session/${encodedSessionId}`;
  const flow = route === "snapshot-interactive" ? "snapshot" : "interactive";
  const dataUrl = flow === "snapshot"
    ? `${basePath}/snapshot-interactive/data`
    : `${basePath}/interactive/data`;
  const html = buildMapBrowserHtml(htmlTemplate, flow, dataUrl, {
    status: lookup.status,
    statusUrl: `${basePath}/status`,
    snapshotUrl: `${basePath}/snapshot.webp`,
  });
  return {
    statusCode: 200,
    body: html,
    headers: {"content-type": "text/html; charset=utf-8", "referrer-policy": "no-referrer"},
  };
}
