/**
 * 根据 Identified Overlay relation members 建立 relation → 空间 Feature 索引。
 *
 * 本模块只匹配最终 Overlay 已存在的 node / way / area，不补抓成员、不构建 relation geometry。
 */

import type {
  IdentifiedOverlayGroupsType,
  IdentifiedRelationMemberType,
  RelationMemberFeatureType,
  RelationMemberFeaturesByRelationType,
  RelationFeatureIdsByFeatureIdType,
  RelationMembershipByFeatureIdType,
} from "../models/backend/map-data-models.js";

/** 从 relation members 提取指定 OSM primitive type 的 ref → role；重复 ref 保留先出现的 role。 */
function buildMemberRoleIndex(members: Array<IdentifiedRelationMemberType>, memberType: "node" | "way"): Map<number, string> {
  const roleByRef = new Map<number, string>();
  for (const member of members) {
    if (member.type === memberType && !roleByRef.has(member.ref)) roleByRef.set(member.ref, member.role);
  }
  return roleByRef;
}

/** 按 Overlay 自身分组，把命中 member ref 的 canonical feature_id 与 role 写入成员数组。 */
function addFeatureRoles(featureRoles: Array<RelationMemberFeatureType>, features: IdentifiedOverlayGroupsType["node"] | IdentifiedOverlayGroupsType["area"] | IdentifiedOverlayGroupsType["way"], roleByRef: ReadonlyMap<number, string>): void {
  const existingFeatureIds = new Set(featureRoles.map(({feature_id}) => feature_id));
  for (const feature of features) {
    for (const osmId of feature.osm_id) {
      const role = roleByRef.get(osmId);
      if (role === undefined || existingFeatureIds.has(feature.feature_id)) continue;
      featureRoles.push({feature_id: feature.feature_id, role});
      existingFeatureIds.add(feature.feature_id);
      break;
    }
  }
}

/**
 * 返回 `relation_feature_id → {node, area, way} → [{feature_id, role}]`。
 * 输出分组完全使用 Overlay feature_type；OSM member type 只约束 node 与 way/area 的合法匹配。
 */
export function buildRelationMemberFeaturesByRelation(overlayOutput: IdentifiedOverlayGroupsType): RelationMemberFeaturesByRelationType {
  const result: RelationMemberFeaturesByRelationType = {};
  for (const relation of overlayOutput.relation) {
    const nodeRoles: Array<RelationMemberFeatureType> = [];
    const areaRoles: Array<RelationMemberFeatureType> = [];
    const wayRoles: Array<RelationMemberFeatureType> = [];
    const nodeRoleByRef = buildMemberRoleIndex(relation.members, "node");
    const wayRoleByRef = buildMemberRoleIndex(relation.members, "way");
    addFeatureRoles(nodeRoles, overlayOutput.node, nodeRoleByRef);
    addFeatureRoles(areaRoles, overlayOutput.area, wayRoleByRef);
    addFeatureRoles(wayRoles, overlayOutput.way, wayRoleByRef);
    if (nodeRoles.length > 0 || areaRoles.length > 0 || wayRoles.length > 0) {
      result[relation.feature_id] = {node: nodeRoles, area: areaRoles, way: wayRoles};
    }
  }
  return result;
}

////////////////////////////////relation membership 反爬流程 /////////////////////////////////////////////

/** 将 relation feature_id 追加到每个空间 Feature 的反向成员数组。 */
function addRelationFeatureId(
  result: RelationFeatureIdsByFeatureIdType,
  members: ReadonlyArray<RelationMemberFeatureType>,
  relationFeatureId: string,
): void {
  for (const member of members) {
    const relationFeatureIds = result[member.feature_id];
    if (relationFeatureIds === undefined) result[member.feature_id] = [relationFeatureId];
    else relationFeatureIds.push(relationFeatureId);
  }
}

/**
 * 建立 `node / area / way feature_id → relation feature_id[]` 的渲染反向索引。
 *
 * 权威 relation 字典及其 role 数据保持不变；反向索引只供后续按空间 Feature 查找 relation。
 */
export function buildRelationMembershipByFeatureId(
  relationMemberFeaturesByRelation: RelationMemberFeaturesByRelationType,
): RelationMembershipByFeatureIdType {
  const result: RelationMembershipByFeatureIdType = {
    node: {},
    area: {},
    way: {},
  };

  // 权威 relation 字典只遍历一次，并在同一轮填充三种空间 Feature 的反向索引。
  for (const relationFeatureId in relationMemberFeaturesByRelation) {
    if (!Object.hasOwn(relationMemberFeaturesByRelation, relationFeatureId)) continue;
    const membersByType = relationMemberFeaturesByRelation[relationFeatureId];
    addRelationFeatureId(result.node, membersByType.node, relationFeatureId);
    addRelationFeatureId(result.area, membersByType.area, relationFeatureId);
    addRelationFeatureId(result.way, membersByType.way, relationFeatureId);
  }

  return result;
}
