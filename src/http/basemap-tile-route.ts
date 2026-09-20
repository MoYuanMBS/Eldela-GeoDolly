/** `/basemap/{source}/{z}/{x}/{y}` 的参数校验与 provider 路由。 */

import type {IncomingHttpHeaders} from "node:http";
import {requestUpstreamTile, type UpstreamTileResult} from "../basemap/upstream-tile-client.js";
import {basemapConfigSchema} from "../models/backend/config-models.js";
import {basemapProfileIdSchema} from "../models/common/basemap-models.js";
import {config} from "../utils/config-loader.js";

const BASEMAP_TILE_ROUTE_PATTERN = /^\/basemap\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)$/u;
const UNSIGNED_INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value.join(", ") : value;
}

function parseUnsignedInteger(value: string): number | null {
  if (!UNSIGNED_INTEGER_PATTERN.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function emptyResponse(statusCode: number): UpstreamTileResult {
  return {kind: "response", statusCode, body: Buffer.alloc(0), headers: {"cache-control": "no-store"}};
}

/** 返回 null 表示 pathname 不属于 Basemap Tile Endpoint。 */
export async function resolveBasemapTileHttpRoute(
  pathname: string,
  requestHeaders: IncomingHttpHeaders,
  signal?: AbortSignal,
): Promise<UpstreamTileResult | null> {
  const routeMatch = BASEMAP_TILE_ROUTE_PATTERN.exec(pathname);
  if (routeMatch === null) return null;

  const parsedSource = basemapProfileIdSchema.safeParse(routeMatch[1]);
  if (!parsedSource.success) return emptyResponse(404);
  const profiles = config.getBasemapProfiles();
  if (!Object.hasOwn(profiles, parsedSource.data)) return emptyResponse(404);
  const profile = profiles[parsedSource.data];

  const z = parseUnsignedInteger(routeMatch[2]);
  const x = parseUnsignedInteger(routeMatch[3]);
  const y = parseUnsignedInteger(routeMatch[4]);
  if (z === null || x === null || y === null || z > profile.max_native_zoom) return emptyResponse(400);
  const tileCount = 2 ** z;
  if (!Number.isSafeInteger(tileCount) || x >= tileCount || y >= tileCount) return emptyResponse(400);

  const basemapConfig = config.getAppSection("basemap", basemapConfigSchema);
  const publicOrigin = config.getWebConfig().http.map.public_origin;
  const timeoutMs = Math.min(MAX_TIMER_DELAY_MS, Math.max(1, Math.round(basemapConfig.upstream_timeout_seconds * 1000)));
  return requestUpstreamTile({
    profile,
    z,
    x,
    y,
    userAgent: basemapConfig.user_agent,
    referer: `${publicOrigin}/`,
    timeoutMs,
    ifNoneMatch: headerValue(requestHeaders, "if-none-match"),
    ifModifiedSince: headerValue(requestHeaders, "if-modified-since"),
    signal,
  });
}
