import {z} from "zod";
import {
  aiOutputGroupsWithIdsSchema,
  displayIdByFeatureIdSchema,
  type IdentifiedOverlayFeatureKindType,
  relationMembershipByFeatureIdSchema,
} from "../backend/map-data-models.js";
import {commonVisualMapPayloadSchema} from "../mapsurface/map-payload-models.js";
import {renderStylePayloadSchema} from "../mapsurface/style/user-css-style-models.js";

/** 公开 Interactive route 返回并由同一 Browser App 严格校验的动态数据。 */
export const interactiveMapDataSchema = z.object({
  map_payload: commonVisualMapPayloadSchema,
  style_payload: renderStylePayloadSchema,
  ai_output: aiOutputGroupsWithIdsSchema.nullable(),
  display_id_by_feature_id: displayIdByFeatureIdSchema.nullable(),
  relation_membership_by_feature_id: relationMembershipByFeatureIdSchema.nullable(),
  selected_location_name: z.string().nullable(),
}).strict().superRefine((payload, context) => {
  const expectsInteractiveDetails = payload.map_payload.render_mode !== "basemap_only";
  if (expectsInteractiveDetails && (payload.ai_output === null || payload.display_id_by_feature_id === null || payload.relation_membership_by_feature_id === null)) {
    context.addIssue({code: "custom", message: "Interactive Overlay maps require AI Output, display IDs and relation membership data"});
  }
  if (!expectsInteractiveDetails && (payload.ai_output !== null || payload.display_id_by_feature_id !== null || payload.relation_membership_by_feature_id !== null)) {
    context.addIssue({code: "custom", message: "Basemap-only maps cannot contain Interactive Overlay details"});
  }
});

export type InteractiveMapDataType = z.infer<typeof interactiveMapDataSchema>;

/** UI 只认识业务 Feature 类型；不得借用 Leaflet Canvas renderer 的类型作为页面契约。 */
export type InteractiveSpatialFeatureType = Exclude<IdentifiedOverlayFeatureKindType, "relation">;

/** selected/hover 解析完成后交给 Interactive UI 的最小空间对象摘要。 */
export interface InteractiveFeatureSummaryType {
  featureType: InteractiveSpatialFeatureType;
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
  featureType: InteractiveSpatialFeatureType;
  featureId: string;
  displayId: string;
  name: string | null;
  osmIds: ReadonlyArray<number>;
  sourceRecords: ReadonlyArray<InteractiveOsmTagGroupType>;
  relations: ReadonlyArray<InteractiveRelationDetailsType>;
}
