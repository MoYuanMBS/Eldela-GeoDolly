/**
 * Python Tool result 中供 TypeScript 地图数据流程消费的边界模型。
 *
 * 当前镜像 python/utils/models.py 中的 Geometry、Overpass 与 Tools.PyToolResult。
 */

import { z } from "zod";

export const bboxSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);
export const identifiedOverlayFeatureTypeSchema = z.enum(["node", "way", "area", "relation"]);
export const geoJsonPositionSchema = z.tuple([z.number(), z.number()]);

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

export const identifiedRelationMemberSchema = z
  .object({
    type: z.enum(["node", "way", "relation"]),
    ref: z.number().int(),
    role: z.string(),
  })
  .strict();

const identifiedOverlayFeatureBaseSchema = z
  .object({
    type: z.literal("Feature"),
    feature_id: z.string(),
    osm_id: z.array(z.number().int()),
    properties: z.record(z.string(), z.array(z.string())),
  })
  .strict();

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

export const aiOutputRecordSchema = z
  .object({
    osm_id: z.number().int(),
    tags: z.record(z.string(), z.string()),
  })
  .strict();

export const aiOutputGroupsSchema = z
  .object({
    node: z.array(aiOutputRecordSchema),
    way: z.array(aiOutputRecordSchema),
    relation: z.array(aiOutputRecordSchema),
  })
  .strict();

export const identifiedOverlayGroupsSchema = z
  .object({
    node: z.array(identifiedOverlayNodeFeatureSchema),
    way: z.array(identifiedOverlayWayFeatureSchema),
    area: z.array(identifiedOverlayAreaFeatureSchema),
    relation: z.array(identifiedOverlayRelationFeatureSchema),
  })
  .strict();

export const filteredOverpassResultSchema = z
  .object({
    ai_output: aiOutputGroupsSchema,
    overlay_output: identifiedOverlayGroupsSchema,
  })
  .strict();

export const effectiveQueryModeSchema = z.enum(["tool_a", "tool_b", "basemap_only"]);

export const pyToolResultSchema = z
  .object({
    bbox: bboxSchema,
    output: filteredOverpassResultSchema.nullable(),
    recommended_viewport_area_factor: z.number(),
    info: z.string(),
    effective_query_mode: effectiveQueryModeSchema,
  })
  .strict();

export type BBoxType = z.infer<typeof bboxSchema>;
export type IdentifiedOverlayFeatureKindType = z.infer<typeof identifiedOverlayFeatureTypeSchema>;
export type OverlayGeoJsonGeometryType = z.infer<typeof overlayGeoJsonGeometrySchema>;
export type IdentifiedRelationMemberType = z.infer<typeof identifiedRelationMemberSchema>;
export type IdentifiedOverlayFeatureType = z.infer<typeof identifiedOverlayFeatureSchema>;
export type AiOutputRecordType = z.infer<typeof aiOutputRecordSchema>;
export type AiOutputGroupsType = z.infer<typeof aiOutputGroupsSchema>;
export type IdentifiedOverlayGroupsType = z.infer<typeof identifiedOverlayGroupsSchema>;
export type FilteredOverpassResultType = z.infer<typeof filteredOverpassResultSchema>;
export type EffectiveQueryModeType = z.infer<typeof effectiveQueryModeSchema>;
export type PyToolResultType = z.infer<typeof pyToolResultSchema>;
