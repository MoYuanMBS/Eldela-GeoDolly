/** 在线 raster tile 底图的部署配置模型。 */

import {z} from "zod";

const basemapProfileIdValueSchema = z.string().min(1).regex(
  /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/,
  "basemap profile ID must start and end with a lowercase letter or digit and contain only lowercase letters, digits, _ or -",
);

/** Tool Input 使用的动态 basemap profile ID。 */
export const basemapProfileIdSchema = z.string().trim().pipe(basemapProfileIdValueSchema);

/** `tiles.yaml` 顶层 key 不自动修剪，必须直接满足安全的单路径段约束。 */
const basemapRegistryProfileIdSchema = basemapProfileIdValueSchema;

const REQUIRED_TILE_URL_PLACEHOLDERS = ["{z}", "{x}", "{y}"] as const;
const REQUIRED_TILE_URL_PLACEHOLDER_MARKERS = new Map<string, string>([
  ["{z}", "geomcp-z-placeholder"],
  ["{x}", "geomcp-x-placeholder"],
  ["{y}", "geomcp-y-placeholder"],
]);
const ALLOWED_TILE_URL_PLACEHOLDER_REPLACEMENTS = new Map<string, string>([
  ...REQUIRED_TILE_URL_PLACEHOLDER_MARKERS,
  ["{s}", "a"],
  ["{r}", ""],
]);
const TILE_URL_PLACEHOLDER_PATTERN = /\{[^{}]*\}/g;

/** Attribution 的公开版权页面；Reference UI 仅允许浏览器可直接访问的 HTTP(S)。 */
const attributionUrlSchema = z.string().trim().min(1).superRefine((url, context) => {
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      context.addIssue({code: "custom", message: "attribution URL must use HTTP or HTTPS"});
    }
  } catch {
    context.addIssue({code: "custom", message: "attribution URL must be a valid URL"});
  }
});

/** 服务端在线 raster upstream 模板；要求标准 XYZ 坐标变量并只允许 HTTP(S)。 */
const tileUrlTemplateSchema = z.string().trim().min(1).superRefine((template, context) => {
  let hasInvalidPlaceholder = false;
  for (const placeholder of template.match(TILE_URL_PLACEHOLDER_PATTERN) ?? []) {
    if (!ALLOWED_TILE_URL_PLACEHOLDER_REPLACEMENTS.has(placeholder)) {
      hasInvalidPlaceholder = true;
      context.addIssue({code: "custom", message: `tile URL template contains unknown placeholder ${placeholder}`});
    }
  }
  const templateWithoutMatchedPlaceholders = template.replace(TILE_URL_PLACEHOLDER_PATTERN, "");
  if (templateWithoutMatchedPlaceholders.includes("{") || templateWithoutMatchedPlaceholders.includes("}")) {
    hasInvalidPlaceholder = true;
    context.addIssue({code: "custom", message: "tile URL template contains a malformed placeholder"});
  }
  if (hasInvalidPlaceholder) return;

  // URL() 不认识 Leaflet placeholder；允许的可选变量只在 validation 副本中替换。
  let validationUrl = template;
  for (const [placeholder, replacement] of ALLOWED_TILE_URL_PLACEHOLDER_REPLACEMENTS) {
    validationUrl = validationUrl.replaceAll(placeholder, replacement);
  }
  try {
    const parsedUrl = new URL(validationUrl);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      context.addIssue({code: "custom", message: "tile URL template must use HTTP or HTTPS"});
      return;
    }
    // Fragment 不会被发送给 tile provider；XYZ 若只出现在 fragment/host/userinfo，看似完整却会让
    // 每块瓦片命中同一请求。唯一有效的请求定位边界是 pathname + search。
    const requestTarget = `${parsedUrl.pathname}${parsedUrl.search}`;
    for (const placeholder of REQUIRED_TILE_URL_PLACEHOLDERS) {
      const marker = REQUIRED_TILE_URL_PLACEHOLDER_MARKERS.get(placeholder);
      if (marker !== undefined && !requestTarget.includes(marker)) {
        context.addIssue({code: "custom", message: `tile URL template must contain ${placeholder} in its path or query`});
      }
    }
  } catch {
    context.addIssue({code: "custom", message: "tile URL template must be a valid URL"});
  }
});

/** `tiles.yaml` 中单个在线 raster profile 的完整部署配置。 */
export const basemapProfileConfigSchema = z.object({
  /** Prompt 与 UI 展示名称，不参与 profile 查询。 */
  name: z.string().trim().min(1),
  /** GeoMCP Tile Endpoint 访问的 provider URL 模板，不进入 Browser payload。 */
  upstream: tileUrlTemplateSchema,
  /** 在线 raster provider 的最高原生层级，只传给在线 TileLayer.maxNativeZoom。 */
  max_native_zoom: z.number().int().positive(),
  /** 首版 Browser map 唯一允许的投影。 */
  crs: z.literal("EPSG:3857"),
  /** 紧凑 attribution，由后续 UI 层消费，Basemap runtime 不读取。 */
  attribution: z.string().trim().min(1),
  /** 紧凑 attribution 对应的公开版权页面。 */
  attribution_url: attributionUrlSchema,
  /** 完整 attribution 可省略或留空；消费者统一读取 string | null。 */
  full_attribution: z.string().trim().min(1).nullish().transform((attribution) => attribution ?? null),
}).strict();

/** Node 已从部署 registry 解析完成、移除 upstream 且可直接序列化进 Browser payload 的底图快照。 */
export const resolvedBasemapSchema = basemapProfileConfigSchema.omit({upstream: true}).extend({
  id: basemapProfileIdSchema,
});

/** 完整 profile registry；空 registry 无法为 Tool Input 提供任何可用底图。 */
export const basemapProfileRegistrySchema = z.record(basemapRegistryProfileIdSchema, basemapProfileConfigSchema).refine(
  (registry) => Object.keys(registry).length > 0,
  {message: "tiles.yaml must contain at least one basemap profile"},
);

export type BasemapProfileIdType = z.infer<typeof basemapProfileIdSchema>;
export type BasemapProfileConfigType = z.infer<typeof basemapProfileConfigSchema>;
export type BasemapProfileRegistryType = z.infer<typeof basemapProfileRegistrySchema>;
export type ResolvedBasemapType = z.infer<typeof resolvedBasemapSchema>;
