/**
 * Tool A / Tool B 共用的 TypeScript 主流程。
 *
 * 两个 Tool 只在 Python action 上不同；Python 返回以后统一执行地图数据整理与截图参数生成。
 */

import {
  type AiToolInputReqType,
  type LocSearchReplyRawType,
  type PyToolReplyType,
  type ToolType,
} from "../models/bridge-models.js";
import {addFeatureIdsToAiOutput} from "../map-data/ai-output.js";
import {addDisplayIds} from "../map-data/display-id.js";
import {
  buildRelationMemberFeaturesByRelation,
  buildRelationMembershipByFeatureId,
} from "../map-data/relation-membership.js";
import {generateCaptureSize} from "../iframe-capture/capture-generator.js";
import {generateCaptureCenter} from "../iframe-capture/center-generator.js";
import {toLeafletBounds} from "../iframe-capture/leaflet-bounds.js";
import {leafletConfigSchema} from "../models/config-models.js";
import {config} from "../utils/config-loader.js";
import {callBridge, exportToolsQueryForPython} from "../utils/python-bridge.js";
import {getUserStyle} from "../utils/user-style-rule.js";

/**
 * 单独执行 Python Tool 调用；失败时补充 requested tool 上下文，并保留原错误为 cause。
 */
export async function callPythonTool(tool: ToolType, cachedSelection: LocSearchReplyRawType, toolInput: AiToolInputReqType): Promise<PyToolReplyType> {
  const pythonQuery = exportToolsQueryForPython(cachedSelection, toolInput);
  try {
    // callBridge 已按 action registry 的 pyToolReplySchema 完成运行时校验，这里只恢复静态类型。
    return await callBridge(tool, pythonQuery) as PyToolReplyType;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Python ${tool} call failed: ${message}`, {cause: error});
  }
}

/**
 * 纯 TypeScript 后处理入口，不启动 Python 子进程；用户样式从 Node 启动缓存复制为
 * 本次 render payload 的固定快照，不在浏览器请求时重新读取配置文件。
 */
export function processToolReply(toolReply: PyToolReplyType) {
  const sessionId = toolReply.session_id;
  const bbox = toolReply.result.bbox;
  const output = toolReply.result.output;
  const areaFactor = toolReply.result.recommended_viewport_area_factor;
  const effectiveQueryMode = toolReply.result.effective_query_mode;
  const info = toolReply.result.info; // 单独保留，供后续追加到 AI Output YAML 末尾。
  const userStyle = getUserStyle();
  // 浏览器不直接访问服务端配置文件；复制启动时已校验的 section，保证一次地图生成使用固定快照。
  const leafletConfig = config.getAppSection("leaflet", leafletConfigSchema);
  let aiOutput = null;
  let overlayOutput = null;
  let relationMemberFeaturesByRelation = null;
  let relationMembershipByFeatureId = null;

  // basemap-only 没有地图数据；其他模式统一完成 display ID、AI Output enrichment 与 relation 成员索引。
  if (output !== null) {
    overlayOutput = addDisplayIds(output.overlay_output);
    aiOutput = addFeatureIdsToAiOutput(output.ai_output, overlayOutput);
    relationMemberFeaturesByRelation = buildRelationMemberFeaturesByRelation(overlayOutput);
    relationMembershipByFeatureId = buildRelationMembershipByFeatureId(relationMemberFeaturesByRelation);
  }

  // 截图尺寸和 center 属于后端稳定结果；Leaflet bounds 仅作为后续浏览器初始化格式。
  const screenshotSize = generateCaptureSize(bbox, areaFactor);
  const center = generateCaptureCenter(bbox);
  const leafletBounds = toLeafletBounds(bbox);

  return {
    "session_id": sessionId,
    "effective_query_mode": effectiveQueryMode,
    "ai_output": aiOutput,
    "overlay_output": overlayOutput,
    "relation_member_features_by_relation": relationMemberFeaturesByRelation,
    "relation_membership_by_feature_id": relationMembershipByFeatureId,
    "screenshot_size": screenshotSize,
    "center": center,
    "leaflet_bbox": leafletBounds,
    "leaflet": leafletConfig,
    "render_style": {
      "user_css": userStyle.css,
      "user_rules": userStyle.rules,
    },
    "info": info,
  };
}

/** Tool A / Tool B 共用入口：Python action 不同，后续 TS 流程完全一致。 */
export async function runToolFlow(tool: ToolType, cachedSelection: LocSearchReplyRawType, toolInput: AiToolInputReqType) {
  return processToolReply(await callPythonTool(tool, cachedSelection, toolInput));
}
