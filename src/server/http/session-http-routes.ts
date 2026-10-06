/** 已登记 Map Session 的公开 HTTP route 解析与响应构筑。 */

import {buildMapRuntimePayloads} from "../map-session/map-runtime.js";
import type {SessionManager} from "../map-session/session-manager.js";
import type {SessionConfigType} from "../../models/backend/config-models.js";
import {finalSessionIdSchema, type IndexSessionIdType} from "../../models/backend/session-id-models.js";
import type {SessionHttpStatusType} from "../../models/common/session-http-models.js";
import {
  readInteractiveMapArchiveFile,
  sessionDirectoryExists,
} from "../utils/file-writer.js";
import {AppError} from "../../shared/app-error.js";

const SESSION_ROUTE_PATTERN = /^\/session\/([^/]+)\/(status|interactive|interactive\/data)$/u;
const INTERACTIVE_FLOW_ATTRIBUTE = 'data-geomcp-browser-flow="interactive"';
const MAP_DATA_META_PATTERN = /<meta\s+name="geomcp-map-data-url"\s+content="[^"]*"\s*\/>/u;

export interface MapHttpRouteResponseType {
  statusCode: number;
  body?: string | Buffer;
  headers?: Readonly<Record<string, string>>;
}

/** Browser build 只服务完整 Interactive 页面，不注入前端到期管理。 */
export function buildMapBrowserHtml(
  htmlTemplate: string,
  dataUrl: string,
  publicBasePath = "",
): string {
  if (!htmlTemplate.includes(INTERACTIVE_FLOW_ATTRIBUTE) || !MAP_DATA_META_PATTERN.test(htmlTemplate)) {
    throw new AppError("invalid_browser_build", "Browser index does not expose the required Map injection points");
  }
  return htmlTemplate
    .replace("<head>", `<head>\n    <meta name="geomcp-base-path" content="${publicBasePath}" />`)
    .replaceAll('="./assets/', `="${publicBasePath}/assets/`)
    .replace(MAP_DATA_META_PATTERN, `<meta name="geomcp-map-data-url" content="${dataUrl}" />`);
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
  htmlTemplate: string,
  sessionConfig: SessionConfigType,
  sessionManager: SessionManager,
  publicBasePath = "",
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

  if (route === "interactive/data") {
    const archive = await readInteractiveMapArchiveFile(sessionId);
    if (archive === null) {
      sessionManager.unregisterSession(sessionId);
      return emptyResponse(404);
    }
    const runtime = buildMapRuntimePayloads(archive);
    return jsonResponse(runtime.interactive);
  }

  const encodedSessionId = encodeURIComponent(sessionId);
  const basePath = `${publicBasePath}/session/${encodedSessionId}`;
  const html = buildMapBrowserHtml(htmlTemplate, `${basePath}/interactive/data`, publicBasePath)
    .replace("</head>", `    <meta name="geomcp-basemap-base-url" content="${publicBasePath}/basemap/${encodedSessionId}" />\n  </head>`);
  return {
    statusCode: 200,
    body: html,
    headers: {"content-type": "text/html; charset=utf-8", "referrer-policy": "no-referrer"},
  };
}
