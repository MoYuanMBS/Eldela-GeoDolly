/**
 * Node 侧地图 Tool 总编排入口。
 *
 * Python 返回以后先统一执行 enrichment 与视口计算，再根据 requested Tool 和 effective query mode
 * 选择 Core / Non-core / Basemap-only payload builder。这里不导入 Leaflet，也不持有浏览器对象。
 */

import {
  type AiToolInputReqType,
  type LocSearchReplyRawType,
  type PyToolReqType,
  type PyToolReplyType,
  type ToolType,
} from "../models/backend/bridge-models.js";
import type {ResolvedBasemapType} from "../models/common/basemap-models.js";
import {addFeatureIdsToAiOutput} from "../map-data/ai-output.js";
import {resolveBasemap} from "../map-data/basemap.js";
import {addDisplayIds} from "../map-data/display-id.js";
import {
  buildRelationMemberFeaturesByRelation,
  buildRelationMembershipByFeatureId,
} from "../map-data/relation-membership.js";
import {generateCaptureSize} from "../iframe-capture/capture-generator.js";
import {generateCaptureCenter} from "../iframe-capture/center-generator.js";
import {toLeafletBounds} from "../iframe-capture/leaflet-bounds.js";
import {leafletConfigSchema} from "../models/backend/config-models.js";
import {
  mapSurfacePayloadSchema,
  type CommonVisualMapPayloadType,
  type MapRenderModeType,
} from "../models/mapsurface/map-payload-models.js";
import type {EffectiveQueryModeType} from "../models/backend/map-data-models.js";
import {renderStylePayloadSchema, type RenderStylePayload} from "../models/mapsurface/style/user-css-style-models.js";
import type {
  CommonMapPayloadFields,
  MapModeSwitchInput,
  ProcessedToolReplyType,
  RunToolFlowResultType,
} from "../models/backend/tool-flow-models.js";
import {AppError} from "../utils/app-error.js";
import {config} from "../utils/config-loader.js";
import {PythonBridgeError, callBridge, exportToolsQueryForPython} from "../utils/python-bridge.js";
import {getUserStyle} from "../utils/user-style-rule.js";
import {buildBasemapOnlyMapPayload} from "./basemap-only-flow.js";
import {buildCoreMapPayload} from "./core-flow.js";
import {buildNonCoreMapPayload} from "./non-core-flow.js";

/**
 * 执行已经固定 selected candidate 的 Python 请求。
 *
 * 调用方先固定 pythonQuery；Core visual 因而可以复用真正发给 Python 的 selected_candidate，
 * 不在 Python 完成后按 selected_indices 再做第二次选择。
 */
export async function callPythonTool(tool: ToolType, pythonQuery: PyToolReqType): Promise<PyToolReplyType> {
  try {
    // callBridge 已按 action registry 的 pyToolReplySchema 完成运行时校验，这里只恢复静态类型。
    return await callBridge(tool, pythonQuery) as PyToolReplyType;
  } catch (error) {
    // Python 明确返回的结构化业务错误保持原 code；TS bridge/进程故障增加当前 Tool 上下文。
    if (error instanceof PythonBridgeError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new AppError(
      "python_tool",
      `Python ${tool} call failed: ${message}`,
      error instanceof AppError ? error.toJSON() : message,
      error instanceof Error ? {cause: error} : undefined,
    );
  }
}

/**
 * 纯 TypeScript 数据后处理入口，不启动 Python 子进程，也不读取或混入渲染样式。
 * display ID、AI join、Relation 索引和视口在所有地图模式中只执行一次。
 * ###################以降级为临时的 调试流程函数！######################
 */
export function processToolReply(toolReply: PyToolReplyType): ProcessedToolReplyType {
  const sessionId = toolReply.session_id;
  const bbox = toolReply.result.bbox;
  const output = toolReply.result.output;
  const areaFactor = toolReply.result.recommended_viewport_area_factor;
  const effectiveQueryMode = toolReply.result.effective_query_mode;
  const info = toolReply.result.info; // 单独保留，供后续追加到 AI Output YAML 末尾。
  // 浏览器不直接访问服务端配置文件；复制启动时已校验的 section，保证一次地图生成使用固定快照。
  const leafletConfig = config.getAppSection("leaflet", leafletConfigSchema);
  let aiOutput = null;
  let overlayOutput = null;
  let displayIdByFeatureId = null;
  let relationMemberFeaturesByRelation = null;
  let relationMembershipByFeatureId = null;

  // basemap-only 没有地图数据；其他模式统一完成 display ID、AI Output enrichment 与 relation 成员索引。
  if (output !== null) {
    const displayIdEnrichment = addDisplayIds(output.overlay_output);
    overlayOutput = displayIdEnrichment.overlayOutput;
    displayIdByFeatureId = displayIdEnrichment.displayIdByFeatureId;
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
    "display_id_by_feature_id": displayIdByFeatureId,
    "relation_member_features_by_relation": relationMemberFeaturesByRelation,
    "relation_membership_by_feature_id": relationMembershipByFeatureId,
    "screenshot_size": screenshotSize,
    "center": center,
    "leaflet_bbox": leafletBounds,
    "leaflet": leafletConfig,
    "info": info,
  };
}

/**
 * 把 requested Tool 与 Python 降级结果收敛为唯一 Browser render_mode。
 *
 * Basemap-only 是覆盖所有 Tool 的终态；其余模式的 Tool 映射只存在于这个 switch。后续增加 Tool
 * 时只需调整 Node 编排映射，Browser 与共享地图 payload 不需要认识新的 Tool 名称。
 */
export function selectMapRenderMode(requestedTool: ToolType, effectiveQueryMode: EffectiveQueryModeType): MapRenderModeType {
  if (effectiveQueryMode === "basemap_only") return "basemap_only";
  switch (requestedTool) {
    case "tool_a":
      return "non_core";
    case "tool_b":
      return "core";
  }
}

/**
 * 唯一地图模式 switch；每个分支只把公共数据交给对应 builder。
 *
 * 本层不手写 Overlay/Relation null 审查：Basemap-only 忽略无关 Python 数据，Core/Non-core 则由
 * 自己的共享 Zod schema 校验必需字段。这样模式契约只有一个权威实现，不在 orchestrator 重复。
 */
export function runMapModeFlow(input: MapModeSwitchInput): CommonVisualMapPayloadType {
  const {requestedTool, effectiveQueryMode, selectedCandidate, processed, commonMapFields} = input;
  switch (selectMapRenderMode(requestedTool, effectiveQueryMode)) {
    case "basemap_only":
      return buildBasemapOnlyMapPayload(commonMapFields);
    case "non_core":
      return buildNonCoreMapPayload({
        ...commonMapFields,
        overlay_output: processed.overlay_output,
        relation_member_features_by_relation: processed.relation_member_features_by_relation,
      });
    case "core":
      // Node 不解释原始 GeoJSON；null 静默跳过、非 null 校验与 warning 由 Browser Core renderer 负责。
      return buildCoreMapPayload({
        ...commonMapFields,
        overlay_output: processed.overlay_output,
        relation_member_features_by_relation: processed.relation_member_features_by_relation,
        core_visual: selectedCandidate.geojson ?? null,
      });
  }
}

/**
 * 从 Node 启动时已经验证并冻结的用户样式缓存生成独立传输快照。
 * built-in CSS/Canvas styles 随 Browser App 构建，不进入该变量；这里也不重新读取文件或支持热更新。
 */
function buildRenderStylePayload(): RenderStylePayload {
  const userStyle = getUserStyle();
  return renderStylePayloadSchema.parse({user_css: userStyle.css, user_rules: userStyle.rules});
}

/** 把公共视口结果收窄为共享地图 schema 的固定 tuple，并附加调用方明确选择的底图。 */
function buildCommonMapPayloadFields(
  processed: ProcessedToolReplyType,
  basemap: ResolvedBasemapType,
): CommonMapPayloadFields {
  // Leaflet 的 LatLngBoundsLiteral 静态类型允许多种形态；跨进程 payload 只接受固定双角 tuple。
  const mapSurfacePayload = mapSurfacePayloadSchema.parse({
    screenshot_size: processed.screenshot_size,
    center: processed.center,
    leaflet_bbox: processed.leaflet_bbox,
  });
  return {...mapSurfacePayload, basemap, leaflet: processed.leaflet};
}

/**
 * 执行完整 Node Tool Flow，并把 Node-only 数据与 Browser visual payload 分开返回。
 *
 * `effective_query_mode` 只在 Node 层决定 Basemap-only 覆盖；Browser 只读取 map_payload.render_mode。
 * Tool B 即使在 Python 内部降级到 tool_a，仍由 requested Tool 选择 Core builder。三个 builder 都只
 * 组装可序列化数据，不启动 Browser、Leaflet、截图或发布流程。
 */
export async function runToolFlow(tool: ToolType, cachedSelection: LocSearchReplyRawType, toolInput: AiToolInputReqType): Promise<RunToolFlowResultType> {
  // profile 必须在重型 Python 调用前解析；无效 ID 不得进入 Python 或 Browser payload。
  const basemap = resolveBasemap(toolInput.basemap);
  // 公共流程固定为：准备一次请求 → 调用 Python → 一次数据后处理 → 独立模式 switch。
  const pythonQuery = exportToolsQueryForPython(cachedSelection, toolInput);
  const processed = processToolReply(await callPythonTool(tool, pythonQuery));
  const commonMapFields = buildCommonMapPayloadFields(processed, basemap);
  const mapPayload = runMapModeFlow({
    requestedTool: tool,
    effectiveQueryMode: processed.effective_query_mode,
    selectedCandidate: pythonQuery.selected_candidate,
    processed,
    commonMapFields,
  });
  // 样式是与地图数据并列的独立部署快照，不嵌入 map_payload 或 Overlay。
  const stylePayload = buildRenderStylePayload();

  return Object.freeze({
    // Node/session/AI 数据不进入 CommonVisualMapPayload，避免 Browser 协议绑定 Tool 或 Python 状态。
    session_id: processed.session_id,
    // visual_output 只留在 Node 发布路径；exportToolsQueryForPython 不会把它送入 Bridge。
    visual_output: toolInput.visual_output,
    effective_query_mode: processed.effective_query_mode,
    ai_output: processed.ai_output,
    display_id_by_feature_id: processed.display_id_by_feature_id,
    relation_membership_by_feature_id: processed.relation_membership_by_feature_id,
    // Feature UI 只使用候选的精确 name，不以 display_name 代替。
    selected_location_name: pythonQuery.selected_candidate.name ?? null,
    map_payload: mapPayload,
    style_payload: stylePayload,
    info: processed.info,
  });
}
