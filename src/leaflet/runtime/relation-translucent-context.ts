/**
 * 固定 Relation membership 的一次性反向索引；不创建 geometry 或 Leaflet layer。
 *
 * 输入仍以 relation_feature_id 分组，输出增加 feature_id → relation IDs 的热路径索引。
 * Overlay renderer 由当前 Feature 反查即可决定 addon，不需要为每个 Feature 重扫全部 Relation。
 */

import type {IdentifiedOverlayRelationFeatureType, RelationMemberFeaturesByRelationType} from "../../models/map-data-models.js";
import type {RelationTranslucentContext, ReadonlyRelationFeatureIdsByFeatureId} from "../../models/leaflet-renderer-models.js";
import type {RuntimeStylePlan} from "../../models/style/runtime-style-models.js";
import {buildRelationMembershipByFeatureId} from "../../map-data/relation-membership.js";

const ENABLED_RELATION_MEMBERSHIP = Object.freeze({enabled: true as const});

/** 深度冻结单个 feature_type 的反向索引，避免渲染过程中改变 relation 身份列表。 */
function freezeMembershipIndex(index: Record<string, Array<string>>): ReadonlyRelationFeatureIdsByFeatureId {
  const frozenIndex = Object.create(null) as Record<string, ReadonlyArray<string>>;
  for (const [featureId, relationFeatureIds] of Object.entries(index)) {
    frozenIndex[featureId] = Object.freeze([...relationFeatureIds]);
  }
  return Object.freeze(frozenIndex);
}

/**
 * Relation properties 不参与样式匹配；这里只保留真实 Overlay relation 中拥有空间成员的项，
 * 再对权威 relation 字典执行一次反向展开，供每个空间 Feature 在绘制时 O(1) 查询。
 */
export function buildRelationTranslucentContext(
  relations: ReadonlyArray<IdentifiedOverlayRelationFeatureType>,
  relationMemberFeaturesByRelation: RelationMemberFeaturesByRelationType,
  plan: RuntimeStylePlan,
): RelationTranslucentContext {
  const byRelationFeatureId = Object.create(null) as Record<string, Readonly<{enabled: true}>>;
  const activeMembersByRelation: RelationMemberFeaturesByRelationType = {};
  for (const relation of relations) {
    // 只有同时存在于最终 Overlay relation 和权威成员字典中的 Relation 才能进入渲染上下文。
    if (!Object.hasOwn(relationMemberFeaturesByRelation, relation.feature_id)) continue;
    byRelationFeatureId[relation.feature_id] = ENABLED_RELATION_MEMBERSHIP;
    activeMembersByRelation[relation.feature_id] = relationMemberFeaturesByRelation[relation.feature_id];
  }
  const membershipByFeatureId = buildRelationMembershipByFeatureId(activeMembersByRelation);
  // 保留正向 relation 身份供详情查询，同时冻结反向索引供绘制阶段 O(1) 读取。
  return Object.freeze({
    membershipStyle: plan.relationMembershipStyle,
    byRelationFeatureId: Object.freeze(byRelationFeatureId),
    membershipByFeatureId: Object.freeze({
      node: freezeMembershipIndex(membershipByFeatureId.node),
      area: freezeMembershipIndex(membershipByFeatureId.area),
      way: freezeMembershipIndex(membershipByFeatureId.way),
    }),
  });
}
