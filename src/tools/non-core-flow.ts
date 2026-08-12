/** Node 侧 Non-core 地图分支；只组装并校验可序列化 payload，不创建任何 Leaflet 对象。 */

import {
  nonCoreMapPayloadSchema,
  type NonCoreMapPayloadType,
} from "../models/map-payload-models.js";
import type {NonCoreFlowInput} from "../models/tool-flow-models.js";

/**
 * 为不需要 Core 装饰的地图补上稳定判别字段。
 *
 * 调用方必须传入已经完成 display_id enrichment 的 Overlay 与同源 Relation 字典；本分支不重复
 * 编号、匹配 Relation 或读取配置。schema.parse() 在 Node 边界生成独立的可序列化结果副本。
 */
export function buildNonCoreMapPayload(
  input: NonCoreFlowInput,
): NonCoreMapPayloadType {
  return nonCoreMapPayloadSchema.parse({
    ...input,
    render_mode: "non_core",
    core_visual: null,
  });
}
