import {z} from "zod";
import {
  aiOutputGroupsWithIdsSchema,
  relationMembershipByFeatureIdSchema,
} from "../backend/map-data-models.js";
import {commonVisualMapPayloadSchema} from "../mapsurface/map-payload-models.js";
import type {CanvasSpatialFeatureType} from "../mapsurface/style/base-canvas-style.js";
import {renderStylePayloadSchema} from "../mapsurface/style/user-css-style-models.js";

/** 公开 Interactive route 返回并由同一 Browser App 严格校验的动态数据。 */
export const interactiveMapDataSchema = z.object({
  map_payload: commonVisualMapPayloadSchema,
  style_payload: renderStylePayloadSchema,
  ai_output: aiOutputGroupsWithIdsSchema.nullable(),
  relation_membership_by_feature_id: relationMembershipByFeatureIdSchema.nullable(),
  selected_location_name: z.string().nullable(),
}).strict().superRefine((payload, context) => {
  const expectsInteractiveDetails = payload.map_payload.render_mode !== "basemap_only";
  if (expectsInteractiveDetails && (payload.ai_output === null || payload.relation_membership_by_feature_id === null)) {
    context.addIssue({code: "custom", message: "Interactive Overlay maps require AI Output and relation membership data"});
  }
  if (!expectsInteractiveDetails && (payload.ai_output !== null || payload.relation_membership_by_feature_id !== null)) {
    context.addIssue({code: "custom", message: "Basemap-only maps cannot contain Interactive Overlay details"});
  }
});

export type InteractiveMapDataType = z.infer<typeof interactiveMapDataSchema>;

/** React 与后续 DrawingController 共享的可序列化工具状态。 */
export type DrawingUiModeType = "idle" | "draw_path" | "draw_circle";

/** selected/hover 解析完成后交给 Interactive UI 的最小空间对象摘要。 */
export interface InteractiveFeatureSummaryType {
  featureType: CanvasSpatialFeatureType;
  displayId: string;
  name: string | null;
}

export interface InteractiveOsmTagGroupType {
  osmType: "node" | "way" | "relation";
  osmId: number;
  tags: Readonly<Record<string, string>>;
}

export interface InteractiveRelationDetailsType {
  featureId: string;
  displayId: string;
  role: string;
  osmIds: ReadonlyArray<number>;
  sourceRecords: ReadonlyArray<InteractiveOsmTagGroupType>;
}

export interface InteractiveFeatureDetailsType {
  featureType: CanvasSpatialFeatureType;
  featureId: string;
  displayId: string;
  name: string | null;
  osmIds: ReadonlyArray<number>;
  sourceRecords: ReadonlyArray<InteractiveOsmTagGroupType>;
  relations: ReadonlyArray<InteractiveRelationDetailsType>;
}
