/**
 * 为 Identified Overlay 选择 ref / canonical ID，并应用 TypeScript render skin。
 *
 * 本模块只生成 display_id 并执行分类型冲突检查，不修改 canonical feature_id，
 * 也不负责 AI Output join 或 relation membership 整理。
 */

import {type FeatureIdDisplayConfigType, featureIdDisplayConfigSchema} from "../models/backend/config-models.js";
import type {DisplayIdEnrichmentResultType, DisplayIdGroupResult, IdentifiedOverlayFeatureType, IdentifiedOverlayGroupsType} from "../models/backend/map-data-models.js";
import {AppError} from "../utils/app-error.js";
import { config } from "../utils/config-loader.js";

const CANONICAL_DIGITS = "0123456789";

/**
 * 对一个 feature_type 命名空间直接添加 display_id，并在返回前完成冲突检查。
 * ref 保留原值且不应用 skin；只有回退到 canonical feature_id 时才做字符替换。
 */
function addDisplayIdsToGroup<TFeature extends IdentifiedOverlayFeatureType>(features: Array<TFeature>, featureIdConfig: FeatureIdDisplayConfigType): DisplayIdGroupResult<TFeature> {
  const activeAlphabetSkin = featureIdConfig.render.skins.alphabet[featureIdConfig.render.active_skins.alphabet];
  const activeDigitsSkin = featureIdConfig.render.skins.digits[featureIdConfig.render.active_skins.digits];
  const alphabetPool = Array.from(featureIdConfig.alphabet_pool);
  const alphabetSkin = activeAlphabetSkin === undefined ? null : Array.from(activeAlphabetSkin);
  const digitsSkin = activeDigitsSkin === undefined ? null : Array.from(activeDigitsSkin);
  const canonicalIdByDisplayId = new Map<string, string>();
  const displayIdByFeatureId = new Map<string, string>();
  const enrichedFeatures = features.map((feature) => {
    if (displayIdByFeatureId.has(feature.feature_id)) {
      throw new AppError(
        "duplicate_overlay_feature",
        `Duplicate ${feature.feature_type} feature_id "${feature.feature_id}" while building display ID index`,
        {feature_type: feature.feature_type, feature_id: feature.feature_id},
      );
    }
    const refs = (feature.properties.ref ?? []).filter((ref) => ref.trim().length > 0);
    let displayId: string;
    if (refs.length > 0) {
      displayId = refs.length > 1 && refs.every((ref) => /^\d+$/.test(ref.trim()))
        ? refs.reduce((minimum, ref) => BigInt(ref.trim()) < BigInt(minimum.trim()) ? ref : minimum)
        : refs[0];
    } else {
      displayId = feature.feature_id;
      if (alphabetSkin !== null) {
        displayId = Array.from(displayId).map((character) => {
          const index = alphabetPool.indexOf(character);
          return index === -1 ? character : alphabetSkin[index];
        }).join("");
      }
      if (digitsSkin !== null) {
        displayId = Array.from(displayId).map((character) => {
          const index = CANONICAL_DIGITS.indexOf(character);
          return index === -1 ? character : digitsSkin[index];
        }).join("");
      }
    }
    const existingCanonicalId = canonicalIdByDisplayId.get(displayId);
    if (existingCanonicalId !== undefined) {
      throw new AppError(
        "duplicate_display_id",
        `display ID collision in ${feature.feature_type}: "${existingCanonicalId}" and "${feature.feature_id}" both map to "${displayId}"`,
        {display_id: displayId, feature_ids: [existingCanonicalId, feature.feature_id]},
      );
    }
    canonicalIdByDisplayId.set(displayId, feature.feature_id);
    displayIdByFeatureId.set(feature.feature_id, displayId);
    return {...feature, display_id: displayId};
  });
  return {features: enrichedFeatures, displayIdByFeatureId: Object.fromEntries(displayIdByFeatureId)};
}

/**
 * 非原地为全部 Identified Overlay records 添加 display_id。
 * 四种 feature_type 分别检查冲突，跨类型同名保持合法。
 */
export function addDisplayIds(overlayOutput: IdentifiedOverlayGroupsType): DisplayIdEnrichmentResultType {
  const featureIdConfig = config.getAppSection("feature_id", featureIdDisplayConfigSchema);
  const node = addDisplayIdsToGroup(overlayOutput.node, featureIdConfig);
  const way = addDisplayIdsToGroup(overlayOutput.way, featureIdConfig);
  const area = addDisplayIdsToGroup(overlayOutput.area, featureIdConfig);
  const relation = addDisplayIdsToGroup(overlayOutput.relation, featureIdConfig);
  return {
    overlayOutput: {node: node.features, way: way.features, area: area.features, relation: relation.features},
    displayIdByFeatureId: {
      node: node.displayIdByFeatureId,
      way: way.displayIdByFeatureId,
      area: area.displayIdByFeatureId,
      relation: relation.displayIdByFeatureId,
    },
  };
}
