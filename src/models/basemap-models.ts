/** 在线 raster tile 底图的部署配置模型。 */

import {z} from "zod";

const basemapProfileIdSchema = z.string().min(1).refine((profileId) => profileId.trim() === profileId, {
  message: "basemap profile ID must not contain leading or trailing whitespace",
});

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

export const basemapProfileConfigSchema = z.object({
  name: z.string().trim().min(1),
  url: tileUrlTemplateSchema,
  max_native_zoom: z.number().int().positive(),
  crs: z.literal("EPSG:3857"),
  attribution: z.string().trim().min(1),
  // 部署方可以省略或在 YAML 中留空；消费者统一读取 string | null。
  full_attribution: z.string().trim().min(1).nullish().transform((attribution) => attribution ?? null),
}).strict();

export const basemapProfileRegistrySchema = z.record(basemapProfileIdSchema, basemapProfileConfigSchema).refine(
  (registry) => Object.keys(registry).length > 0,
  {message: "tiles.yaml must contain at least one basemap profile"},
);

export type BasemapProfileConfigType = z.infer<typeof basemapProfileConfigSchema>;
export type BasemapProfileRegistryType = z.infer<typeof basemapProfileRegistrySchema>;
