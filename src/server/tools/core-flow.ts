/** Node 侧 Core 地图分支；Core visual 与普通 Overlay 始终保持两条独立数据路径。 */

import {
  coreMapPayloadSchema,
  type CoreMapPayloadType,
} from "../../models/mapsurface/map-payload-models.js";
import type {CoreFlowInput} from "../../models/backend/tool-flow-models.js";

/**
 * 为普通 Overlay 追加地点确认阶段保存的独立 Core visual。
 *
 * 本函数只负责模式封装与 JSON object/null 传输边界，不从 bbox 反算 Core geometry，也不把 Core
 * 写入 overlay_output、Relation membership 或普通 Feature index。GeoJSON 语义校验留给独立的
 * Browser Core renderer；null 保持 Core 模式并让该 renderer 静默跳过。
 */
export function buildCoreMapPayload(
  input: CoreFlowInput,
): CoreMapPayloadType {
  return coreMapPayloadSchema.parse({...input, render_mode: "core"});
}
