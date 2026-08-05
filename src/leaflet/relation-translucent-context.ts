/** Relation translucent rules 的一次性预解析缓存；不创建 geometry 或 Leaflet layer。 */

import type {IdentifiedOverlayRelationFeatureType, RelationMemberFeaturesByRelationType} from "../models/map-data-models.js";
import type {RelationTranslucentContext, RelationTranslucentRuleSelection, RuntimeStylePlan} from "../models/style/runtime-style-models.js";
import {resolveRelationTranslucentRules} from "./feature-style-resolver.js";

/**
 * 每个拥有最终空间成员的 relation 只执行一次 Tag 匹配。
 * 空 rules 明确表示使用 membershipStyle.defaultColor，不能解释为不绘制 membership。
 */
export function buildRelationTranslucentContext(
  relations: ReadonlyArray<IdentifiedOverlayRelationFeatureType>,
  relationMemberFeaturesByRelation: RelationMemberFeaturesByRelationType,
  plan: RuntimeStylePlan,
): RelationTranslucentContext {
  const byRelationFeatureId = Object.create(null) as Record<string, RelationTranslucentRuleSelection>;
  for (const relation of relations) {
    // 没有任何最终空间成员的 relation 不会进入渲染，避免为它建立无消费者的样式缓存。
    if (!Object.hasOwn(relationMemberFeaturesByRelation, relation.feature_id)) continue;
    const rules = resolveRelationTranslucentRules(relation, plan);
    byRelationFeatureId[relation.feature_id] = Object.freeze({usesDefaultColor: rules.length === 0, rules});
  }
  return Object.freeze({
    membershipStyle: plan.relationMembershipStyle,
    byRelationFeatureId: Object.freeze(byRelationFeatureId),
  });
}
