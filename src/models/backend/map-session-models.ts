/** 地图 Session 的长期归档模型；不包含当前前端版本的渲染配置。 */

import {z} from "zod";
import {basemapProfileIdSchema} from "../common/basemap-models.js";
import {
  coreVisualPayloadSchema,
  mapSurfacePayloadSchema,
} from "../mapsurface/map-payload-models.js";
import {
  aiOutputGroupsWithIdsSchema,
  displayIdByFeatureIdSchema,
  effectiveQueryModeSchema,
  identifiedOverlayGroupsWithDisplayIdSchema,
  relationMemberFeaturesByRelationSchema,
  relationMembershipByFeatureIdSchema,
} from "../common/map-data-models.js";
import {finalSessionIdSchema} from "./session-id-models.js";
import {
  locSearchCandidateRawSchema,
  visualOutputSchema,
} from "./bridge-models.js";

const archiveViewFields = {
  screenshot_size: mapSurfacePayloadSchema.shape.screenshot_size,
  center: mapSurfacePayloadSchema.shape.center,
  leaflet_bbox: mapSurfacePayloadSchema.shape.leaflet_bbox,
  basemap_id: basemapProfileIdSchema,
} as const;

const archiveInteractiveFields = {
  ai_output: aiOutputGroupsWithIdsSchema,
  display_id_by_feature_id: displayIdByFeatureIdSchema,
  relation_membership_by_feature_id: relationMembershipByFeatureIdSchema,
  selected_location_name: z.string().nullable(),
} as const;

const archiveOverlayFields = {
  overlay_output: identifiedOverlayGroupsWithDisplayIdSchema,
  relation_member_features_by_relation: relationMemberFeaturesByRelationSchema,
} as const;

/** Tool A/Non-core 归档不携带 Core visual，但保留完整 Interactive 数据。 */
const nonCoreInteractiveMapArchiveSchema = z.object({
  map_payload: z.object({
    ...archiveViewFields,
    ...archiveOverlayFields,
    render_mode: z.literal("non_core"),
    core_visual: z.null(),
  }).strict(),
  ...archiveInteractiveFields,
}).strict();

/** Tool B/Core 归档允许候选原始 GeoJSON 缺失；Browser 会把 null 作为 Core skipped。 */
const coreInteractiveMapArchiveSchema = z.object({
  map_payload: z.object({
    ...archiveViewFields,
    ...archiveOverlayFields,
    render_mode: z.literal("core"),
    core_visual: coreVisualPayloadSchema,
  }).strict(),
  ...archiveInteractiveFields,
}).strict();

/** Basemap-only 不使用空对象伪造 Interactive 数据，所有 Feature 字段固定为 null。 */
const basemapOnlyInteractiveMapArchiveSchema = z.object({
  map_payload: z.object({
    ...archiveViewFields,
    render_mode: z.literal("basemap_only"),
    overlay_output: z.null(),
    relation_member_features_by_relation: z.null(),
    core_visual: z.null(),
  }).strict(),
  ai_output: z.null(),
  display_id_by_feature_id: z.null(),
  relation_membership_by_feature_id: z.null(),
  selected_location_name: z.string().nullable(),
}).strict();

/** 与 /mapdata 对齐的纯业务归档；map_payload 中只保存底图 ID。 */
export const interactiveMapArchiveSchema = z.union([
  coreInteractiveMapArchiveSchema,
  nonCoreInteractiveMapArchiveSchema,
  basemapOnlyInteractiveMapArchiveSchema,
]);

/** `selected-query.json` 保存最终选择、原始调用选项和首次 Session 时间。 */
export const selectedQueryArchiveSchema = z.object({
  session_id: finalSessionIdSchema,
  attention_experts: z.array(z.string()).nullable().optional(),
  basemap: basemapProfileIdSchema,
  query: z.string(),
  name: z.string().nullable().optional(),
  candidate: locSearchCandidateRawSchema,
  actual_tool: effectiveQueryModeSchema,
  include_overlay_geojson: z.boolean().nullable().optional(),
  visual_output: visualOutputSchema,
  created_time: z.number().finite().nonnegative(),
  open_time: z.number().finite().nonnegative(),
  close_time: z.number().finite().nonnegative(),
}).strict().superRefine((selectedQuery, context) => {
  if (!selectedQuery.session_id.endsWith(`-${selectedQuery.candidate.index}`)) {
    context.addIssue({code: "custom", path: ["session_id"], message: "session_id must end with candidate.index"});
  }
  if (selectedQuery.created_time !== selectedQuery.open_time) {
    context.addIssue({code: "custom", path: ["created_time"], message: "created_time must equal open_time"});
  }
  if (selectedQuery.close_time <= selectedQuery.open_time) {
    context.addIssue({code: "custom", path: ["close_time"], message: "close_time must be later than open_time"});
  }
});

export type InteractiveMapArchiveType = z.infer<typeof interactiveMapArchiveSchema>;
export type SelectedQueryArchiveType = z.infer<typeof selectedQueryArchiveSchema>;
