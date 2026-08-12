/** Node 侧 Core 地图分支；Core visual 与普通 Overlay 始终保持两条独立数据路径。 */

import {
  coreMapPayloadSchema,
  type CoreMapPayloadType,
} from "../models/map-payload-models.js";
import type {CoreFlowInput} from "../models/tool-flow-models.js";

/**
 * 为普通 Overlay 追加地点确认阶段保存的独立 Core visual。
 *
 * 本函数只负责模式封装与边界校验，不从 bbox 反算 Core geometry，也不把 Core 写入
 * overlay_output、Relation membership 或普通 Feature index。缺失或不支持的 geometry 会由共享
 * schema 直接拒绝，避免 Browser 收到无法可靠解释的半成品。
 */
export function buildCoreMapPayload(
  input: CoreFlowInput,
): CoreMapPayloadType {
  return coreMapPayloadSchema.parse({...input, render_mode: "core"});
}
