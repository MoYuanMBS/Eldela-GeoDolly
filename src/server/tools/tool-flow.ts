/**
 * Core / Non-core / Basemap-only 的 Node 发布编排。
 *
 * 公开 Tool 名称与 Python action 只存在于 `tools.ts`。本模块只接收已映射的地图 Flow，
 * 并在唯一 switch 中处理 Python `basemap_only` 覆盖。
 */

import {generateCaptureCenter} from "../iframe-capture/center-generator.js";
import {generateCaptureSize} from "../iframe-capture/capture-generator.js";
import {toLeafletBounds} from "../iframe-capture/leaflet-bounds.js";
import {addFeatureIdsToAiOutput} from "../map-data/ai-output.js";
import {addDisplayIds} from "../map-data/display-id.js";
import {
  buildRelationMemberFeaturesByRelation,
  buildRelationMembershipByFeatureId,
} from "../../shared/relation-membership.js";
import {generateAiOutputYaml} from "../map-data/yaml-output.js";
import {buildMapRuntimePayloads} from "../map-session/map-runtime.js";
import type {SessionManager} from "../map-session/session-manager.js";
import {leafletConfigSchema, outputConfigSchema} from "../../models/backend/config-models.js";
import {
  interactiveMapArchiveSchema,
  selectedQueryArchiveSchema,
  type InteractiveMapArchiveType,
} from "../../models/backend/map-session-models.js";
import type {SessionIndexRecordType} from "../../models/backend/session-manager-models.js";
import type {
  CommonMapPayloadFields,
  ProcessedToolReplyType,
  PublishedToolFlowResultType,
  RunToolFlowResultType,
  ToolFlowInputType,
} from "../../models/backend/tool-flow-models.js";
import type {ToolExecutionContextType} from "../../models/backend/tool-execution-models.js";
import {
  type CommonVisualMapPayloadType,
  mapSurfacePayloadSchema,
} from "../../models/mapsurface/map-payload-models.js";
import {AppError} from "../../shared/app-error.js";
import {mapAppSharedDataSchema} from "../../models/web/map-app-models.js";
import {config} from "../utils/config-loader.js";
import {
  cleanupSessionFiles,
  sessionFilesAreComplete,
  writeSessionFiles,
} from "../utils/file-writer.js";
import {logger} from "../utils/logger.js";
import {buildBasemapOnlyMapPayload} from "./basemap-only-flow.js";
import {buildCoreMapPayload} from "./core-flow.js";
import {buildNonCoreMapPayload} from "./non-core-flow.js";

export interface ToolFlowServicesType {
  sessionManager: SessionManager;
}

interface PreparedBackendFlowType {
  processed: ProcessedToolReplyType;
  commonMapFields: CommonMapPayloadFields;
}

/** Python reply 的公共后处理只执行一次。此阶段不选择地图模式，也不创建 Browser runtime。 */
export function processToolReply(toolReply: ToolFlowInputType["toolReply"]): ProcessedToolReplyType {
  const {bbox, output, recommended_viewport_area_factor: areaFactor, effective_query_mode: effectiveQueryMode, info} = toolReply.result;
  const leafletConfig = config.getAppSection("leaflet", leafletConfigSchema);
  let aiOutput = null;
  let overlayOutput = null;
  let displayIdByFeatureId = null;
  let relationMemberFeaturesByRelation = null;
  let relationMembershipByFeatureId = null;

  // Basemap-only 没有地图数据；其他模式共用同一份 enrichment 与 Relation 索引。
  if (output !== null) {
    const displayIdEnrichment = addDisplayIds(output.overlay_output);
    overlayOutput = displayIdEnrichment.overlayOutput;
    displayIdByFeatureId = displayIdEnrichment.displayIdByFeatureId;
    aiOutput = addFeatureIdsToAiOutput(output.ai_output, overlayOutput);
    relationMemberFeaturesByRelation = buildRelationMemberFeaturesByRelation(overlayOutput);
    relationMembershipByFeatureId = buildRelationMembershipByFeatureId(relationMemberFeaturesByRelation);
  }

  return {
    session_id: toolReply.session_id,
    effective_query_mode: effectiveQueryMode,
    ai_output: aiOutput,
    overlay_output: overlayOutput,
    display_id_by_feature_id: displayIdByFeatureId,
    relation_member_features_by_relation: relationMemberFeaturesByRelation,
    relation_membership_by_feature_id: relationMembershipByFeatureId,
    screenshot_size: generateCaptureSize(bbox, areaFactor),
    center: generateCaptureCenter(bbox),
    leaflet_bbox: toLeafletBounds(bbox),
    leaflet: leafletConfig,
    info,
  };
}

/** 后端公共子流程：整理 Python 结果并收窄 MapSurface 边界。 */
function prepareBackendFlow(input: ToolFlowInputType): PreparedBackendFlowType {
  const processed = processToolReply(input.toolReply);
  const mapSurface = mapSurfacePayloadSchema.parse({
    screenshot_size: processed.screenshot_size,
    center: processed.center,
    leaflet_bbox: processed.leaflet_bbox,
  });
  return {
    processed,
    commonMapFields: {
      ...mapSurface,
      basemap: input.resolvedBasemap,
      leaflet: processed.leaflet,
    },
  };
}

/** 只保存无法从当前部署配置重建的数据；Basemap-only 明确丢弃不适用的 Feature 数据。 */
function buildInteractiveMapArchive(
  input: ToolFlowInputType,
  processed: ProcessedToolReplyType,
  mapPayload: CommonVisualMapPayloadType,
): InteractiveMapArchiveType {
  const hasInteractiveData = mapPayload.render_mode !== "basemap_only";
  return interactiveMapArchiveSchema.parse({
    ai_output: hasInteractiveData ? processed.ai_output : null,
    overlay_output: hasInteractiveData ? processed.overlay_output : null,
    display_id_by_feature_id: hasInteractiveData ? processed.display_id_by_feature_id : null,
    relation_member_features_by_relation: hasInteractiveData ? processed.relation_member_features_by_relation : null,
    relation_membership_by_feature_id: hasInteractiveData ? processed.relation_membership_by_feature_id : null,
    selected_location_name: input.pythonQuery.selected_candidate.name ?? null,
    screenshot_size: processed.screenshot_size,
    center: processed.center,
    leaflet_bbox: processed.leaflet_bbox,
    render_mode: mapPayload.render_mode,
    core_visual: mapPayload.render_mode === "core" ? mapPayload.core_visual : null,
    basemap: input.toolInput.basemap,
  });
}

/** 前端公共子流程：Archive 与当前版本配置组装成 Interactive runtime。 */
function prepareFrontendFlow(
  input: ToolFlowInputType,
  processed: ProcessedToolReplyType,
  mapPayload: CommonVisualMapPayloadType,
): RunToolFlowResultType {
  const interactiveArchive = buildInteractiveMapArchive(input, processed, mapPayload);
  const browserRuntime = buildMapRuntimePayloads(interactiveArchive);
  return Object.freeze({
    session_id: processed.session_id,
    visual_output: input.toolInput.visual_output,
    effective_query_mode: processed.effective_query_mode,
    ai_output: processed.ai_output,
    display_id_by_feature_id: processed.display_id_by_feature_id,
    relation_membership_by_feature_id: processed.relation_membership_by_feature_id,
    selected_location_name: input.pythonQuery.selected_candidate.name ?? null,
    interactive_archive: interactiveArchive,
    interactive_runtime: browserRuntime.interactive,
    info: processed.info,
  });
}

/** Core 确定分支：只组装 Core payload，再进入共用前端子流程。 */
function runCoreFlow(input: ToolFlowInputType, backend: PreparedBackendFlowType): RunToolFlowResultType {
  const mapPayload = buildCoreMapPayload({
    ...backend.commonMapFields,
    overlay_output: backend.processed.overlay_output,
    relation_member_features_by_relation: backend.processed.relation_member_features_by_relation,
    // Core visual 始终来自搜索阶段缓存的原始 candidate，不从 Python geometry 反算。
    core_visual: input.pythonQuery.selected_candidate.geojson ?? null,
  });
  return prepareFrontendFlow(input, backend.processed, mapPayload);
}

/** Non-core 确定分支：不读取 Core visual，也不理解降级。 */
function runNonCoreFlow(input: ToolFlowInputType, backend: PreparedBackendFlowType): RunToolFlowResultType {
  const mapPayload = buildNonCoreMapPayload({
    ...backend.commonMapFields,
    overlay_output: backend.processed.overlay_output,
    relation_member_features_by_relation: backend.processed.relation_member_features_by_relation,
  });
  return prepareFrontendFlow(input, backend.processed, mapPayload);
}

/** Basemap-only 确定分支：只保留底图与 MapSurface，不生成任何动态 Feature 数据。 */
function runBasemapOnlyFlow(input: ToolFlowInputType, backend: PreparedBackendFlowType): RunToolFlowResultType {
  return prepareFrontendFlow(input, backend.processed, buildBasemapOnlyMapPayload(backend.commonMapFields));
}

function serializeOverlayJson(overlayOutput: NonNullable<InteractiveMapArchiveType["overlay_output"]>): string {
  try {
    return `${JSON.stringify(overlayOutput, null, 2)}\n`;
  } catch (error) {
    throw AppError.fromUnknown(error, "overlay_output_serialize", "Failed to serialize Overlay output");
  }
}

/** `interactive-map-url.json` 只供客户端完整 Interactive 页面使用。 */
function buildClientInteractiveUrl(sessionId: string): string {
  const publicOrigin = config.getWebConfig().http.map.public_origin;
  return `${publicOrigin}/session/${encodeURIComponent(sessionId)}/interactive`;
}

/** 部署总开关、请求开关与实际数据必须同时成立才发布 Overlay JSON。 */
function resolveOverlayGeoJsonOutput(
  input: ToolFlowInputType,
  result: RunToolFlowResultType,
): NonNullable<InteractiveMapArchiveType["overlay_output"]> | undefined {
  const outputConfig = config.getAppSection("output", outputConfigSchema);
  if (!outputConfig.allow_overlay_geojson || input.toolInput.include_overlay_geojson !== true) return undefined;
  return result.interactive_archive.overlay_output ?? undefined;
}

/** 数据全部落盘并核验后才登记 Session；App 截图不参与后端发布。 */
async function publishSessionArtifacts(
  sessionId: string,
  files: Parameters<typeof writeSessionFiles>[1],
  sessionRecord: SessionIndexRecordType,
  context: ToolExecutionContextType,
  services: ToolFlowServicesType,
): Promise<void> {
  let sessionRegistered = false;
  try {
    await writeSessionFiles(sessionId, files, {signal: context.signal});
    context.throwIfAborted();
    if (!await sessionFilesAreComplete(sessionId)) {
      throw new AppError("file_session_incomplete", "Session files are incomplete after publication", sessionId);
    }
    context.throwIfAborted();
    services.sessionManager.registerSession(sessionId, sessionRecord);
    sessionRegistered = true;
  } catch (error) {
    if (sessionRegistered) services.sessionManager.unregisterSession(sessionId);
    try {
      await cleanupSessionFiles(sessionId);
    } catch (cleanupError) {
      logger.warning("tool_flow_cleanup_failed", {
        session_id: sessionId,
        reason: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
    }
    throw AppError.fromUnknown(error, "tool_flow_publish", "Tool Flow publication failed");
  }
}

/**
 * 完整发布入口。模式 switch 与 Basemap-only 回退只在本入口下汇合，三个确定模式
 * 分支都不理解 Tool 名称，也不互相跳转。
 */
export async function publishToolFlow(
  input: ToolFlowInputType,
  context: ToolExecutionContextType,
  services: ToolFlowServicesType,
): Promise<PublishedToolFlowResultType> {
  context.throwIfAborted();
  const backend = prepareBackendFlow(input);
  let result: RunToolFlowResultType;
  if (backend.processed.effective_query_mode === "basemap_only") {
    result = runBasemapOnlyFlow(input, backend);
  } else {
    // 非 Basemap-only 时保持 tools.ts 已经决定的模式；Python 内部 Tool B 降级不会改成 Non-core。
    switch (input.requestedFlow) {
      case "core":
        result = runCoreFlow(input, backend);
        break;
      case "non_core":
        result = runNonCoreFlow(input, backend);
        break;
    }
  }
  context.throwIfAborted();

  const selectedCandidate = input.pythonQuery.selected_candidate;
  const sessionRecord = services.sessionManager.createRecord(input.cachedSelection.query, selectedCandidate.name);
  const selectedQuery = selectedQueryArchiveSchema.parse({
    session_id: result.session_id,
    ...(input.toolInput.attention_experts === undefined ? {} : {attention_experts: input.toolInput.attention_experts}),
    basemap: input.toolInput.basemap,
    query: sessionRecord.query,
    ...(sessionRecord.name === undefined ? {} : {name: sessionRecord.name}),
    candidate: selectedCandidate,
    actual_tool: result.effective_query_mode,
    ...(input.toolInput.include_overlay_geojson === undefined ? {} : {include_overlay_geojson: input.toolInput.include_overlay_geojson}),
    visual_output: input.toolInput.visual_output,
    created_time: sessionRecord.created_time,
    open_time: sessionRecord.open_time,
    close_time: sessionRecord.close_time,
  });
  // Basemap-only 没有 AI Output，因此不生成空 YAML 文件或返回字段。
  const aiOutputYaml = result.ai_output === null ? undefined : generateAiOutputYaml(result.ai_output, result.info);
  const overlayOutput = resolveOverlayGeoJsonOutput(input, result);
  const overlayOutputJson = overlayOutput === undefined ? undefined : serializeOverlayJson(overlayOutput);
  const clientInteractiveUrl = buildClientInteractiveUrl(result.session_id);

  // 同 ID 重建开始后旧目录会被 writer 删除，先关闭旧 RAM 入口。
  services.sessionManager.unregisterSession(result.session_id);
  await publishSessionArtifacts(result.session_id, {
    selectedQuery,
    interactiveMap: result.interactive_archive,
    aiOutputYaml,
    interactiveMapUrl: {url: clientInteractiveUrl},
    overlayOutput,
  }, sessionRecord, context, services);
  context.throwIfAborted();
  const archive = result.interactive_archive;
  const layout = {map_size: archive.screenshot_size, center: archive.center, leaflet_bbox: archive.leaflet_bbox};

  return Object.freeze({
    ai_output: Object.freeze({
      session_id: result.session_id,
      ...(aiOutputYaml === undefined ? {} : {ai_output_yaml: aiOutputYaml}),
      ...(overlayOutputJson === undefined ? {} : {overlay_output_json: overlayOutputJson}),
    }),
    client_output: Object.freeze({
      data: mapAppSharedDataSchema.parse({
        session_id: result.session_id,
        visual_output: input.toolInput.visual_output,
        basemap: input.resolvedBasemap,
        render_mode: archive.render_mode,
        overlay_output: archive.overlay_output,
        relation_member_features_by_relation: archive.relation_member_features_by_relation,
        core_visual: archive.core_visual,
        ai_output: result.ai_output,
        display_id_by_feature_id: result.display_id_by_feature_id,
        relation_membership_by_feature_id: result.relation_membership_by_feature_id,
        selected_location_name: result.selected_location_name,
      }),
      user_payload: Object.freeze({...layout, url: clientInteractiveUrl}),
      ai_payload: input.toolInput.visual_output === "none" ? null : Object.freeze({...layout}),
    }),
  });
}
