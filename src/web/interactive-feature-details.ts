import type {
  AiOutputGroupsWithIdsType,
  DisplayIdByFeatureIdType,
  IdentifiedOverlayGroupsWithDisplayIdType,
  IdentifiedOverlaySpatialFeatureWithDisplayIdType,
  RelationMemberFeaturesByRelationType,
  RelationMembershipByFeatureIdType,
} from "../models/backend/map-data-models.js";
import type {
  InteractiveFeatureDetailsType,
  InteractiveOsmTagGroupType,
  InteractiveRelationDetailsType,
} from "../models/web/interactive-ui-models.js";
import type {InteractiveFeatureTargetType} from "./map-surface-port.js";

function findSpatialFeature(
  overlayOutput: IdentifiedOverlayGroupsWithDisplayIdType,
  target: InteractiveFeatureTargetType,
): IdentifiedOverlaySpatialFeatureWithDisplayIdType | undefined {
  if (target.featureType === "node") return overlayOutput.node.find(({feature_id}) => feature_id === target.featureId);
  if (target.featureType === "way") return overlayOutput.way.find(({feature_id}) => feature_id === target.featureId);
  return overlayOutput.area.find(({feature_id}) => feature_id === target.featureId);
}

function collectSourceRecords(
  aiOutput: AiOutputGroupsWithIdsType,
  target: InteractiveFeatureTargetType,
  sourceOsmIds: ReadonlySet<number>,
): Array<InteractiveOsmTagGroupType> {
  const osmType = target.featureType === "node" ? "node" : "way";
  const records = target.featureType === "node" ? aiOutput.node : aiOutput.way;
  return records
    .filter((record) => record.feature_id === target.featureId && sourceOsmIds.has(record.osm_id))
    .map((record) => Object.freeze({osmType, osmId: record.osm_id, tags: Object.freeze({...record.tags})}));
}

function collectExactNames(sourceRecords: ReadonlyArray<InteractiveOsmTagGroupType>): string | null {
  const names: Array<string> = [];
  const seenNames = new Set<string>();
  for (const record of sourceRecords) {
    const name = record.tags.name;
    if (name === undefined || name.length === 0 || seenNames.has(name)) continue;
    seenNames.add(name);
    names.push(name);
  }
  return names.length === 0 ? null : names.join(" / ");
}

function collectRelationDetails(
  target: InteractiveFeatureTargetType,
  aiOutput: AiOutputGroupsWithIdsType,
  overlayOutput: IdentifiedOverlayGroupsWithDisplayIdType,
  displayIdByFeatureId: DisplayIdByFeatureIdType,
  relationMemberFeaturesByRelation: RelationMemberFeaturesByRelationType,
  relationMembershipByFeatureId: RelationMembershipByFeatureIdType,
): Array<InteractiveRelationDetailsType> {
  const relationFeatureIds = relationMembershipByFeatureId[target.featureType][target.featureId] ?? [];
  const details: Array<InteractiveRelationDetailsType> = [];
  for (const relationFeatureId of relationFeatureIds) {
    const relationFeature = overlayOutput.relation.find(({feature_id}) => feature_id === relationFeatureId);
    const relationDisplayId = displayIdByFeatureId.relation[relationFeatureId];
    // 两份后端索引理论上同步生成；任一缺失时不把 canonical ID 冒充 display_id。
    if (relationFeature === undefined || relationDisplayId === undefined) continue;
    const relationOsmIds = new Set(relationFeature.osm_id);
    const sourceRecords = aiOutput.relation
      .filter((record) => record.feature_id === relationFeatureId && relationOsmIds.has(record.osm_id))
      .map((record): InteractiveOsmTagGroupType => Object.freeze({
        osmType: "relation",
        osmId: record.osm_id,
        tags: Object.freeze({...record.tags}),
      }));
    const role = relationMemberFeaturesByRelation[relationFeatureId]?.[target.featureType]
      .find(({feature_id}) => feature_id === target.featureId)?.role ?? "";
    details.push(Object.freeze({
      featureId: relationFeatureId,
      displayId: relationDisplayId,
      role,
      osmIds: Object.freeze([...relationFeature.osm_id]),
      sourceRecords: Object.freeze(sourceRecords),
    }));
  }
  return details;
}

/**
 * 只使用既有 AI/Overlay/relation 索引现场组合当前 Feature，不保存第二份空间详情索引。
 * 所有查找以 canonical feature_id 为 key；只有返回给组件前才读取后端 display_id 字典。
 */
export function resolveInteractiveFeatureDetails(
  target: InteractiveFeatureTargetType | null,
  aiOutput: AiOutputGroupsWithIdsType | null,
  overlayOutput: IdentifiedOverlayGroupsWithDisplayIdType | null,
  displayIdByFeatureId: DisplayIdByFeatureIdType | null,
  relationMemberFeaturesByRelation: RelationMemberFeaturesByRelationType | null,
  relationMembershipByFeatureId: RelationMembershipByFeatureIdType | null,
): InteractiveFeatureDetailsType | null {
  if (target === null || aiOutput === null || overlayOutput === null || displayIdByFeatureId === null || relationMemberFeaturesByRelation === null || relationMembershipByFeatureId === null) return null;
  const spatialFeature = findSpatialFeature(overlayOutput, target);
  const displayId = displayIdByFeatureId[target.featureType][target.featureId];
  if (spatialFeature === undefined || displayId === undefined) return null;
  const osmIds = Object.freeze([...spatialFeature.osm_id]);
  const sourceRecords = Object.freeze(collectSourceRecords(aiOutput, target, new Set(osmIds)));
  const relations = Object.freeze(collectRelationDetails(
    target,
    aiOutput,
    overlayOutput,
    displayIdByFeatureId,
    relationMemberFeaturesByRelation,
    relationMembershipByFeatureId,
  ));
  return Object.freeze({
    featureType: target.featureType,
    featureId: target.featureId,
    displayId,
    name: collectExactNames(sourceRecords),
    osmIds,
    sourceRecords,
    relations,
  });
}
