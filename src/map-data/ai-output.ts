/**
 * 按 typed OSM identity 将 canonical/display ID 并列补入 AI Output。
 *
 * 本模块不合并 AI records；同一 Overlay Feature 的多个 osm_id 会分别命中原有 records，
 * 未命中 Overlay 的 AI-only record 保持原样。
 */

import type {
  AiOutputGroupsType,
  AiOutputGroupsWithIdsType,
  AiOutputRecordType,
  AiOutputRecordWithIdsType,
  IdentifiedOverlayFeatureWithDisplayIdType,
  IdentifiedOverlayGroupsWithDisplayIdType,
} from "../models/backend/map-data-models.js";
import {logger} from "../utils/logger.js";

function addFeaturesToOsmIndex(index: Map<number, {feature_id: string; display_id: string}>, features: Array<IdentifiedOverlayFeatureWithDisplayIdType>, osmType: "node" | "way" | "relation"): void {
  for (const feature of features) {
    const featureIds = {feature_id: feature.feature_id, display_id: feature.display_id};
    for (const osmId of feature.osm_id) {
      const existingIds = index.get(osmId);
      if (existingIds !== undefined) {
        // 同一 typed OSM identity 只能回填一组 ID；保留先注册项并跳过冲突项。
        logger.warning("skip_conflicting_overlay_osm_mapping", {
          status: "skipped",
          reason: "typed_osm_identity_conflict",
          osm_type: osmType,
          osm_id: osmId,
          retained_feature_id: existingIds.feature_id,
          retained_display_id: existingIds.display_id,
          skipped_feature_id: feature.feature_id,
          skipped_display_id: feature.display_id,
        });
        continue;
      }
      index.set(osmId, featureIds);
    }
  }
}

function addIdsToAiRecords(records: Array<AiOutputRecordType>, index: ReadonlyMap<number, {feature_id: string; display_id: string}>): Array<AiOutputRecordWithIdsType> {
  return records.map((record) => {
    const featureIds = index.get(record.osm_id);
    return featureIds === undefined ? {...record} : {...record, ...featureIds};
  });
}

/**
 * 返回保持原 type 分组与 record 顺序的新 AI Output。
 * Overlay area 来源仍是 OSM way，因此与 Overlay way 共用 way osm_id 索引。
 */
export function addFeatureIdsToAiOutput(aiOutput: AiOutputGroupsType, overlayOutput: IdentifiedOverlayGroupsWithDisplayIdType): AiOutputGroupsWithIdsType {
  const nodeIndex = new Map<number, {feature_id: string; display_id: string}>();
  const wayIndex = new Map<number, {feature_id: string; display_id: string}>();
  const relationIndex = new Map<number, {feature_id: string; display_id: string}>();
  addFeaturesToOsmIndex(nodeIndex, overlayOutput.node, "node");
  addFeaturesToOsmIndex(wayIndex, [...overlayOutput.way, ...overlayOutput.area], "way");
  addFeaturesToOsmIndex(relationIndex, overlayOutput.relation, "relation");
  return {
    node: addIdsToAiRecords(aiOutput.node, nodeIndex),
    way: addIdsToAiRecords(aiOutput.way, wayIndex),
    relation: addIdsToAiRecords(aiOutput.relation, relationIndex),
  };
}
