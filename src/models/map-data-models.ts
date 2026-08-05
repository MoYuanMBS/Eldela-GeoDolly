/**
 * Python Tool result 中供 TypeScript 地图数据流程消费的边界模型。
 *
 * 当前镜像 python/utils/models.py 中的 Geometry、Overpass 与 Tools.PyToolResult。
 */

import { z } from "zod";

// Python Tool result 的 bbox 使用标准 GIS 顺序 (west, south, east, north)；GeoJSON 坐标固定为 [lon, lat]。
export const bboxSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);
export const identifiedOverlayFeatureTypeSchema = z.enum(["node", "way", "area", "relation"]);
export const geoJsonPositionSchema = z.tuple([z.number(), z.number()]);

// Overlay 只接受 Python 当前可能返回的五种 GeoJSON geometry。
export const geoJsonPointSchema = z
  .object({
    type: z.literal("Point"),
    coordinates: geoJsonPositionSchema,
  })
  .strict();

export const geoJsonLineStringSchema = z
  .object({
    type: z.literal("LineString"),
    coordinates: z.array(geoJsonPositionSchema),
  })
  .strict();

export const geoJsonMultiLineStringSchema = z
  .object({
    type: z.literal("MultiLineString"),
    coordinates: z.array(z.array(geoJsonPositionSchema)),
  })
  .strict();

export const geoJsonPolygonSchema = z
  .object({
    type: z.literal("Polygon"),
    coordinates: z.array(z.array(geoJsonPositionSchema)),
  })
  .strict();

export const geoJsonMultiPolygonSchema = z
  .object({
    type: z.literal("MultiPolygon"),
    coordinates: z.array(z.array(z.array(geoJsonPositionSchema))),
  })
  .strict();

export const overlayGeoJsonGeometrySchema = z.discriminatedUnion("type", [
  geoJsonPointSchema,
  geoJsonLineStringSchema,
  geoJsonMultiLineStringSchema,
  geoJsonPolygonSchema,
  geoJsonMultiPolygonSchema,
]);

// relation 不含自身 geometry，只保留成员引用，供渲染层对成员追加一层关系样式。
export const identifiedRelationMemberSchema = z
  .object({
    type: z.enum(["node", "way", "relation"]),
    ref: z.number().int(),
    role: z.string(),
  })
  .strict();

// feature_id 是 Python 分配的内部稳定标识；osm_id 与 properties 均可能聚合多个来源值。
const identifiedOverlayFeatureBaseSchema = z
  .object({
    type: z.literal("Feature"),
    feature_id: z.string(),
    osm_id: z.array(z.number().int()),
    properties: z.record(z.string(), z.array(z.string())),
  })
  .strict();

// node、way、area 各自约束 geometry；relation 则通过 members 表达成员关系。
export const identifiedOverlayNodeFeatureSchema = identifiedOverlayFeatureBaseSchema.extend({
  feature_type: z.literal("node"),
  geometry: geoJsonPointSchema,
  members: z.null(),
});

export const identifiedOverlayWayFeatureSchema = identifiedOverlayFeatureBaseSchema.extend({
  feature_type: z.literal("way"),
  geometry: z.union([geoJsonLineStringSchema, geoJsonMultiLineStringSchema]),
  members: z.null(),
});

export const identifiedOverlayAreaFeatureSchema = identifiedOverlayFeatureBaseSchema.extend({
  feature_type: z.literal("area"),
  geometry: z.union([geoJsonPolygonSchema, geoJsonMultiPolygonSchema]),
  members: z.null(),
});

export const identifiedOverlayRelationFeatureSchema = identifiedOverlayFeatureBaseSchema.extend({
  feature_type: z.literal("relation"),
  geometry: z.null(),
  members: z.array(identifiedRelationMemberSchema),
});

export const identifiedOverlayFeatureSchema = z.discriminatedUnion("feature_type", [
  identifiedOverlayNodeFeatureSchema,
  identifiedOverlayWayFeatureSchema,
  identifiedOverlayAreaFeatureSchema,
  identifiedOverlayRelationFeatureSchema,
]);

// display_id 是 TypeScript 根据 render skin 派生的显示标识，canonical feature_id 保持不变。
const identifiedOverlayNodeFeatureWithDisplayIdSchema = identifiedOverlayNodeFeatureSchema.extend({display_id: z.string()});
const identifiedOverlayWayFeatureWithDisplayIdSchema = identifiedOverlayWayFeatureSchema.extend({display_id: z.string()});
const identifiedOverlayAreaFeatureWithDisplayIdSchema = identifiedOverlayAreaFeatureSchema.extend({display_id: z.string()});
const identifiedOverlayRelationFeatureWithDisplayIdSchema = identifiedOverlayRelationFeatureSchema.extend({display_id: z.string()});
export const identifiedOverlayFeatureWithDisplayIdSchema = z.discriminatedUnion("feature_type", [
  identifiedOverlayNodeFeatureWithDisplayIdSchema,
  identifiedOverlayWayFeatureWithDisplayIdSchema,
  identifiedOverlayAreaFeatureWithDisplayIdSchema,
  identifiedOverlayRelationFeatureWithDisplayIdSchema,
]);

// AI Output 只保留原始 OSM 身份与 tags，不与用于最终渲染的 Overlay Feature 合并。
export const aiOutputRecordSchema = z
  .object({
    osm_id: z.number().int(),
    tags: z.record(z.string(), z.string()),
  })
  .strict();

// 两条输出路径保持独立分组：AI 消费简化记录，前端消费带 geometry 的 Overlay。
export const aiOutputGroupsSchema = z
  .object({
    node: z.array(aiOutputRecordSchema),
    way: z.array(aiOutputRecordSchema),
    relation: z.array(aiOutputRecordSchema),
  })
  .strict();

// AI Output 仍以 type + osm_id 为主体，只并列补充匹配到的 canonical/display ID。
export const aiOutputRecordWithIdsSchema = aiOutputRecordSchema.extend({
  feature_id: z.string().optional(),
  display_id: z.string().optional(),
});
export const aiOutputGroupsWithIdsSchema = z.object({
  node: z.array(aiOutputRecordWithIdsSchema),
  way: z.array(aiOutputRecordWithIdsSchema),
  relation: z.array(aiOutputRecordWithIdsSchema),
}).strict();

export const identifiedOverlayGroupsSchema = z
  .object({
    node: z.array(identifiedOverlayNodeFeatureSchema),
    way: z.array(identifiedOverlayWayFeatureSchema),
    area: z.array(identifiedOverlayAreaFeatureSchema),
    relation: z.array(identifiedOverlayRelationFeatureSchema),
  })
  .strict();

export const identifiedOverlayGroupsWithDisplayIdSchema = z.object({
  node: z.array(identifiedOverlayNodeFeatureWithDisplayIdSchema),
  way: z.array(identifiedOverlayWayFeatureWithDisplayIdSchema),
  area: z.array(identifiedOverlayAreaFeatureWithDisplayIdSchema),
  relation: z.array(identifiedOverlayRelationFeatureWithDisplayIdSchema),
}).strict();

// Relation 成员只保留后续渲染需要的 canonical feature_id 与 role。
export const relationMemberFeatureSchema = z.object({feature_id: z.string(), role: z.string()}).strict();

// Relation 渲染索引按项目自身 node / area / way 分组，便于后续直接遍历成员对象。
export const relationMemberFeaturesSchema = z.object({
  node: z.array(relationMemberFeatureSchema),
  area: z.array(relationMemberFeatureSchema),
  way: z.array(relationMemberFeatureSchema),
}).strict();
export const relationMemberFeaturesByRelationSchema = z.record(z.string(), relationMemberFeaturesSchema);

export const filteredOverpassResultSchema = z
  .object({
    ai_output: aiOutputGroupsSchema,
    overlay_output: identifiedOverlayGroupsSchema,
  })
  .strict();

export const effectiveQueryModeSchema = z.enum(["tool_a", "tool_b", "basemap_only"]);

// bbox、viewport factor 与实际查询模式始终存在；纯底图降级时 output 可以为 null。
export const pyToolResultSchema = z
  .object({
    bbox: bboxSchema,
    output: filteredOverpassResultSchema.nullable(),
    recommended_viewport_area_factor: z.number(),
    info: z.string(),
    effective_query_mode: effectiveQueryModeSchema,
  })
  .strict();

// 所有公开边界 TypeScript 类型均由对应边界 schema 推导。
export type BBoxType = z.infer<typeof bboxSchema>;
export type IdentifiedOverlayFeatureKindType = z.infer<typeof identifiedOverlayFeatureTypeSchema>;
export type OverlayGeoJsonGeometryType = z.infer<typeof overlayGeoJsonGeometrySchema>;
export type IdentifiedRelationMemberType = z.infer<typeof identifiedRelationMemberSchema>;
export type IdentifiedOverlayFeatureType = z.infer<typeof identifiedOverlayFeatureSchema>;
export type IdentifiedOverlayRelationFeatureType = z.infer<typeof identifiedOverlayRelationFeatureSchema>;
export type IdentifiedOverlayFeatureWithDisplayIdType = z.infer<typeof identifiedOverlayFeatureWithDisplayIdSchema>;
export type AiOutputRecordType = z.infer<typeof aiOutputRecordSchema>;
export type AiOutputGroupsType = z.infer<typeof aiOutputGroupsSchema>;
export type AiOutputRecordWithIdsType = z.infer<typeof aiOutputRecordWithIdsSchema>;
export type AiOutputGroupsWithIdsType = z.infer<typeof aiOutputGroupsWithIdsSchema>;
export type IdentifiedOverlayGroupsType = z.infer<typeof identifiedOverlayGroupsSchema>;
export type IdentifiedOverlayGroupsWithDisplayIdType = z.infer<typeof identifiedOverlayGroupsWithDisplayIdSchema>;
export type RelationMemberFeatureType = z.infer<typeof relationMemberFeatureSchema>;
export type RelationMemberFeaturesType = z.infer<typeof relationMemberFeaturesSchema>;
export type RelationMemberFeaturesByRelationType = z.infer<typeof relationMemberFeaturesByRelationSchema>;
// 反向索引只在浏览器运行时派生，不进入 Bridge 或 session 边界，因此不增加 Zod schema。
export type RelationFeatureIdsByFeatureIdType = Record<string, Array<string>>;
export interface RelationMembershipByFeatureIdType {
  node: RelationFeatureIdsByFeatureIdType;
  area: RelationFeatureIdsByFeatureIdType;
  way: RelationFeatureIdsByFeatureIdType;
}
export type FilteredOverpassResultType = z.infer<typeof filteredOverpassResultSchema>;
export type EffectiveQueryModeType = z.infer<typeof effectiveQueryModeSchema>;
export type PyToolResultType = z.infer<typeof pyToolResultSchema>;
