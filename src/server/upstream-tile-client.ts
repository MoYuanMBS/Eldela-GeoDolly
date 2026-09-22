/** GeoMCP 服务端访问在线 raster provider 的轻量 HTTP client。 */

import type {BasemapProfileConfigType} from "../models/common/basemap-models.js";

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const ALLOWED_IMAGE_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export interface UpstreamTileRequestOptions {
  profile: BasemapProfileConfigType;
  z: number;
  x: number;
  y: number;
  userAgent: string;
  referer: string;
  timeoutMs: number;
  ifNoneMatch?: string;
  ifModifiedSince?: string;
  signal?: AbortSignal;
}

export type UpstreamTileResult =
  | {kind: "response"; statusCode: number; body: Buffer; headers: Readonly<Record<string, string>>}
  | {kind: "aborted"};

function emptyErrorResponse(statusCode: number, headers: Readonly<Record<string, string>> = {}): UpstreamTileResult {
  return {kind: "response", statusCode, body: Buffer.alloc(0), headers: {"cache-control": "no-store", ...headers}};
}

function expandUpstreamUrl(template: string, z: number, x: number, y: number): string {
  const subdomain = "abc"[Math.abs(x + y) % 3];
  return template
    .replaceAll("{z}", String(z))
    .replaceAll("{x}", String(x))
    .replaceAll("{y}", String(y))
    .replaceAll("{s}", subdomain)
    .replaceAll("{r}", "");
}

function copyHeader(responseHeaders: Headers, targetHeaders: Record<string, string>, name: string): void {
  const value = responseHeaders.get(name);
  if (value !== null) targetHeaders[name] = value;
}

function collectCacheHeaders(responseHeaders: Headers): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const name of ["cache-control", "expires", "etag", "last-modified"] as const) {
    copyHeader(responseHeaders, headers, name);
  }
  return headers;
}

function hasBytesAt(body: Buffer, offset: number, expected: readonly number[]): boolean {
  return expected.every((value, index) => body[offset + index] === value);
}

function isValidImageBody(contentType: string, body: Buffer): boolean {
  if (contentType === "image/png") return body.length >= 8 && hasBytesAt(body, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (contentType === "image/jpeg") return body.length >= 3 && hasBytesAt(body, 0, [0xff, 0xd8, 0xff]);
  return body.length >= 12 && hasBytesAt(body, 0, [0x52, 0x49, 0x46, 0x46]) && hasBytesAt(body, 8, [0x57, 0x45, 0x42, 0x50]);
}

/**
 * 请求单块上游瓦片并把 provider 响应收敛为公开 endpoint 的有限状态。
 * redirect 固定禁止；provider body 只有通过图片类型校验的 200 响应才会返回给 Browser。
 */
export async function requestUpstreamTile(options: UpstreamTileRequestOptions): Promise<UpstreamTileResult> {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = (): void => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) return {kind: "aborted"};
  options.signal?.addEventListener("abort", abortFromCaller, {once: true});
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs);

  try {
    const requestHeaders = new Headers({
      "user-agent": options.userAgent,
      referer: options.referer,
    });
    if (options.ifNoneMatch !== undefined) requestHeaders.set("if-none-match", options.ifNoneMatch);
    if (options.ifModifiedSince !== undefined) requestHeaders.set("if-modified-since", options.ifModifiedSince);

    const upstreamResponse = await fetch(expandUpstreamUrl(options.profile.upstream, options.z, options.x, options.y), {
      method: "GET",
      headers: requestHeaders,
      redirect: "manual",
      signal: controller.signal,
    });

    if (REDIRECT_STATUS_CODES.has(upstreamResponse.status)) return emptyErrorResponse(502);
    if (upstreamResponse.status === 304 && (options.ifNoneMatch !== undefined || options.ifModifiedSince !== undefined)) {
      return {kind: "response", statusCode: 304, body: Buffer.alloc(0), headers: collectCacheHeaders(upstreamResponse.headers)};
    }
    if (upstreamResponse.status === 404) return emptyErrorResponse(404);
    if (upstreamResponse.status === 429) {
      const headers: Record<string, string> = {};
      copyHeader(upstreamResponse.headers, headers, "retry-after");
      return emptyErrorResponse(503, headers);
    }
    if (upstreamResponse.status !== 200) return emptyErrorResponse(502);

    const rawContentType = upstreamResponse.headers.get("content-type");
    const contentType = rawContentType?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType === undefined || !ALLOWED_IMAGE_CONTENT_TYPES.has(contentType)) return emptyErrorResponse(502);

    const headers = collectCacheHeaders(upstreamResponse.headers);
    headers["content-type"] = contentType;
    const body = Buffer.from(await upstreamResponse.arrayBuffer());
    if (!isValidImageBody(contentType, body)) return emptyErrorResponse(502);
    return {kind: "response", statusCode: 200, body, headers};
  } catch {
    if (options.signal?.aborted) return {kind: "aborted"};
    return emptyErrorResponse(timedOut ? 504 : 502);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}
