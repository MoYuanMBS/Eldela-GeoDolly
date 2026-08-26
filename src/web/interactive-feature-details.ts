import type {
  AiOutputGroupsWithIdsType,
  IdentifiedOverlayGroupsWithDisplayIdType,
  IdentifiedOverlaySpatialFeatureWithDisplayIdType,
  RelationMemberFeaturesByRelationType,
  RelationMembershipByFeatureIdType,
} from "../models/backend/map-data-models.js";
import type {OverlayInteractionTarget} from "../models/mapsurface/leaflet-renderer-models.js";
import type {
  InteractiveFeatureDetailsType,
  InteractiveOsmTagGroupType,
  InteractiveRelationDetailsType,
} from "../models/web/interactive-ui-models.js";

function findSpatialFeature(
  overlayOutput: IdentifiedOverlayGroupsWithDisplayIdType,
  target: OverlayInteractionTarget,
): IdentifiedOverlaySpatialFeatureWithDisplayIdType | undefined {
  if (target.featureType === "node") return overlayOutput.node.find(({feature_id}) => feature_id === target.featureId);
  if (target.featureType === "way") return overlayOutput.way.find(({feature_id}) => feature_id === target.featureId);
  return overlayOutput.area.find(({feature_id}) => feature_id === target.featureId);
}

function collectSourceRecords(
  aiOutput: AiOutputGroupsWithIdsType,
  target: OverlayInteractionTarget,
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
  target: OverlayInteractionTarget,
  aiOutput: AiOutputGroupsWithIdsType,
  overlayOutput: IdentifiedOverlayGroupsWithDisplayIdType,
  relationMemberFeaturesByRelation: RelationMemberFeaturesByRelationType,
  relationMembershipByFeatureId: RelationMembershipByFeatureIdType,
): Array<InteractiveRelationDetailsType> {
  const relationFeatureIds = relationMembershipByFeatureId[target.featureType][target.featureId] ?? [];
  return relationFeatureIds.map((relationFeatureId) => {
    const relationFeature = overlayOutput.relation.find(({feature_id}) => feature_id === relationFeatureId);
    const relationOsmIds = new Set(relationFeature?.osm_id ?? []);
    const sourceRecords = aiOutput.relation
      .filter((record) => record.feature_id === relationFeatureId && relationOsmIds.has(record.osm_id))
      .map((record): InteractiveOsmTagGroupType => Object.freeze({
        osmType: "relation",
        osmId: record.osm_id,
        tags: Object.freeze({...record.tags}),
      }));
    const role = relationMemberFeaturesByRelation[relationFeatureId]?.[target.featureType]
      .find(({feature_id}) => feature_id === target.featureId)?.role ?? "";
    return Object.freeze({
      featureId: relationFeatureId,
      displayId: relationFeature?.display_id ?? relationFeatureId,
      role,
      osmIds: Object.freeze([...(relationFeature?.osm_id ?? [])]),
      sourceRecords: Object.freeze(sourceRecords),
    });
  });
}

/** 只使用既有 AI/Overlay/relation 索引现场组合当前 Feature；不保存第二份空间详情索引。 */
export function resolveInteractiveFeatureDetails(
  target: OverlayInteractionTarget | null,
  aiOutput: AiOutputGroupsWithIdsType | null,
  overlayOutput: IdentifiedOverlayGroupsWithDisplayIdType | null,
  relationMemberFeaturesByRelation: RelationMemberFeaturesByRelationType | null,
  relationMembershipByFeatureId: RelationMembershipByFeatureIdType | null,
): InteractiveFeatureDetailsType | null {
  if (target === null || aiOutput === null || overlayOutput === null || relationMemberFeaturesByRelation === null || relationMembershipByFeatureId === null) return null;
  const spatialFeature = findSpatialFeature(overlayOutput, target);
  if (spatialFeature === undefined) return null;
  const osmIds = Object.freeze([...spatialFeature.osm_id]);
  const sourceRecords = Object.freeze(collectSourceRecords(aiOutput, target, new Set(osmIds)));
  const relations = Object.freeze(collectRelationDetails(
    target,
    aiOutput,
    overlayOutput,
    relationMemberFeaturesByRelation,
    relationMembershipByFeatureId,
  ));
  return Object.freeze({
    featureType: target.featureType,
    featureId: target.featureId,
    displayId: target.displayId,
    name: collectExactNames(sourceRecords),
    osmIds,
    sourceRecords,
    relations,
  });
}
