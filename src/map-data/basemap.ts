/** Node 侧 basemap profile resolver。 */

import type {BasemapProfileIdType, ResolvedBasemapType} from "../models/common/basemap-models.js";
import {basemapConfigSchema} from "../models/backend/config-models.js";
import {AppError} from "../utils/app-error.js";
import {config} from "../utils/config-loader.js";
import {GEOMCP_NAME} from "../utils/leaflet-internal-render-config.js";

/**
 * 把部署级 Proxy base URL 展开为 Browser 可直接消费的规范 XYZ template。
 *
 * namespace 固定取内部展示名的小写形式；profile ID 已在 `tiles.yaml` 启动校验中限制为安全单路径段。
 * 原始 base URL 的 query/hash 放在 XYZ path 之后，避免直接字符串追加把路径写进 query。
 */
function buildProxyTileUrl(proxyBaseUrl: string, profileId: BasemapProfileIdType): string {
  const parsedBaseUrl = new URL(proxyBaseUrl);
  // Proxy 配置只是 base URL；query/hash 中的字面花括号必须编码，不能冒充 Leaflet placeholder。
  const queryAndFragment = `${parsedBaseUrl.search}${parsedBaseUrl.hash}`
    .replaceAll("{", "%7B")
    .replaceAll("}", "%7D");
  parsedBaseUrl.search = "";
  parsedBaseUrl.hash = "";
  const baseUrl = parsedBaseUrl.href.endsWith("/") ? parsedBaseUrl.href : `${parsedBaseUrl.href}/`;
  return `${baseUrl}${GEOMCP_NAME.toLowerCase()}/${profileId}/{z}/{x}/{y}${queryAndFragment}`;
}

/**
 * 从 ConfigLoader 的启动期缓存生成单次 Browser payload 使用的可序列化快照。
 *
 * 本函数不读取 YAML、不维护第二份缓存；未知 ID 在进入 Python 或 Browser 流程前直接失败。
 */
export function resolveBasemap(profileId: BasemapProfileIdType): ResolvedBasemapType {
  const profiles = config.getBasemapProfiles();
  if (!Object.hasOwn(profiles, profileId)) {
    throw new AppError("missing_tile_profile", `Unknown tile profile: ${profileId}`);
  }
  const profile = profiles[profileId];
  // app.yaml section 已由 ConfigLoader.initialize() 缓存；resolver 不重新读取或维护配置副本。
  const basemapConfig = config.getAppSection("basemap", basemapConfigSchema);
  const proxyTileUrl = basemapConfig.proxy_url === null ? null : buildProxyTileUrl(basemapConfig.proxy_url, profileId);
  return Object.freeze({id: profileId, ...profile, proxy_tile_url: proxyTileUrl});
}
