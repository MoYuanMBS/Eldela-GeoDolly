/** 在线 raster tile 底图的部署配置模型。 */

import {z} from "zod";

/** Tool Input 使用的动态 basemap profile ID。 */
export const basemapProfileIdSchema = z.string().trim().min(1);

/** `tiles.yaml` 顶层 key；配置中的首尾空白属于错误，不按 Tool Input 规则自动修剪。 */
const basemapRegistryProfileIdSchema = z.string().min(1).refine((profileId) => profileId.trim() === profileId, {
  message: "basemap profile ID must not contain leading or trailing whitespace",
});

/** Leaflet 在线 raster URL 模板；首版要求标准 XYZ 坐标变量并只允许浏览器可访问的 HTTP(S)。 */
const tileUrlTemplateSchema = z.string().trim().min(1).superRefine((template, context) => {
  for (const placeholder of ["{z}", "{x}", "{y}"]) {
    if (!template.includes(placeholder)) {
      context.addIssue({code: "custom", message: `tile URL template must contain ${placeholder}`});
    }
  }

  // URL() 不认识 Leaflet placeholder；先替换内置变量，再校验协议与 URL 结构。
  const validationUrl = template
    .replaceAll("{z}", "0")
    .replaceAll("{x}", "0")
    .replaceAll("{y}", "0")
    .replaceAll("{s}", "a")
    .replaceAll("{r}", "");
  try {
    const parsedUrl = new URL(validationUrl);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      context.addIssue({code: "custom", message: "tile URL template must use HTTP or HTTPS"});
    }
  } catch {
    context.addIssue({code: "custom", message: "tile URL template must be a valid URL"});
  }
});

/** `tiles.yaml` 中单个在线 raster profile 的完整部署配置。 */
export const basemapProfileConfigSchema = z.object({
  /** Prompt 与 UI 展示名称，不参与 profile 查询。 */
  name: z.string().trim().min(1),
  /** Interactive 与 Snapshot 共用的浏览器可访问 Leaflet raster URL 模板。 */
  url: tileUrlTemplateSchema,
  /** 在线 raster provider 的最高原生层级，只传给在线 TileLayer.maxNativeZoom。 */
  max_native_zoom: z.number().int().positive(),
  /** 首版 Browser map 唯一允许的投影。 */
  crs: z.literal("EPSG:3857"),
  /** 紧凑 attribution，由后续 UI 层消费，Basemap runtime 不读取。 */
  attribution: z.string().trim().min(1),
  /** 完整 attribution 可省略或留空；消费者统一读取 string | null。 */
  full_attribution: z.string().trim().min(1).nullish().transform((attribution) => attribution ?? null),
}).strict();

/** Node 已从部署 registry 解析完成、带稳定 ID 且可直接序列化进 Browser payload 的底图快照。 */
export const resolvedBasemapSchema = basemapProfileConfigSchema.extend({
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
