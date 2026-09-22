/** Node 侧 Basemap-only 地图分支；显式跳过全部动态 Overlay 能力。 */

import {
  basemapOnlyMapPayloadSchema,
  type BasemapOnlyMapPayloadType,
} from "../../models/mapsurface/map-payload-models.js";
import type {BasemapOnlyFlowInput} from "../../models/backend/tool-flow-models.js";

/**
 * 构造只包含 MapSurface、底图选择和 Leaflet 部署配置的 payload。
 *
 * Overlay/Core/Relation 使用显式 null，而不是空数组或空对象。Browser 因此可以把对应 ready
 * 状态标记为 skipped，并且不会初始化 RuntimeStylePlan、Label 或 Interaction。样式使用独立 payload，
 * 不由本分支填充或清空。
 */
export function buildBasemapOnlyMapPayload(
  input: BasemapOnlyFlowInput,
): BasemapOnlyMapPayloadType {
  return basemapOnlyMapPayloadSchema.parse({
    ...input,
    render_mode: "basemap_only",
    overlay_output: null,
    relation_member_features_by_relation: null,
    core_visual: null,
  });
}
