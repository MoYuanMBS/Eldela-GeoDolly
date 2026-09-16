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
} from "../map-data/relation-membership.js";
import {generateAiOutputYaml} from "../map-data/yaml-output.js";
import {buildMapRuntimePayloads} from "../map-session/map-runtime.js";
import type {SessionManager} from "../map-session/session-manager.js";
import type {SnapshotService} from "../map-session/snapshot-service.js";
import {leafletConfigSchema} from "../models/backend/config-models.js";
import {
  interactiveMapArchiveSchema,
  selectedQueryArchiveSchema,
  type InteractiveMapArchiveType,
} from "../models/backend/map-session-models.js";
import type {
  CommonMapPayloadFields,
  ProcessedToolReplyType,
  PublishedToolFlowResultType,
  RunToolFlowResultType,
  ToolFlowInputType,
} from "../models/backend/tool-flow-models.js";
import type {ToolExecutionContextType} from "../models/backend/tool-execution-models.js";
import {
  type CommonVisualMapPayloadType,
  mapSurfacePayloadSchema,
} from "../models/mapsurface/map-payload-models.js";
import {AppError} from "../utils/app-error.js";
import {config} from "../utils/config-loader.js";
import {
  cleanupSessionFiles,
  sessionFilesAreComplete,
  writeSessionFiles,
  writeSnapshotFile,
} from "../utils/file-writer.js";
import {logger} from "../utils/logger.js";
import {buildBasemapOnlyMapPayload} from "./basemap-only-flow.js";
import {buildCoreMapPayload} from "./core-flow.js";
import {buildNonCoreMapPayload} from "./non-core-flow.js";

export interface ToolFlowServicesType {
  sessionManager: SessionManager;
  snapshotService: SnapshotService;
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

/** 前端公共子流程：Archive 与当前版本配置组装成 Interactive / Snapshot runtime。 */
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
    snapshot_runtime: browserRuntime.snapshot,
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

function resolvePublishedUrls(sessionId: string, visualOutput: ToolFlowInputType["toolInput"]["visual_output"]): {
  interactiveUrl: string;
  visualUrl?: string;
} {
  const publicOrigin = config.getWebConfig().http.map.public_origin;
  const interactiveUrl = `${publicOrigin}/session/${encodeURIComponent(sessionId)}`;
  switch (visualOutput) {
    case "none":
      return {interactiveUrl};
    case "screenshot":
      return {interactiveUrl, visualUrl: `${interactiveUrl}/snapshot.webp`};
    case "interactive":
      return {interactiveUrl, visualUrl: `${interactiveUrl}/snapshot`};
  }
}

/** 后端发布子流程：一次准备目录并并发写入快速产物。 */
async function publishBackendFiles(
  sessionId: string,
  files: Parameters<typeof writeSessionFiles>[1],
  signal: AbortSignal,
): Promise<void> {
  await writeSessionFiles(sessionId, files, {signal});
}

/** 前端发布子流程：并发渲染 WebP，但只在后端目录准备成功后追加文件。 */
async function publishFrontendSnapshot(
  sessionId: string,
  snapshotRuntime: RunToolFlowResultType["snapshot_runtime"],
  backendFilesPromise: Promise<void>,
  signal: AbortSignal,
  snapshotService: SnapshotService,
): Promise<void> {
  const image = await snapshotService.capture(snapshotRuntime, signal);
  await backendFilesPromise;
  await writeSnapshotFile(sessionId, image, {signal});
}

/**
 * 两条发布子流程共享同一 signal。任一分支失败后先取消并等待兄弟分支，
 * 再删除整个 Session 目录，避免晚到写入重建残片。
 */
async function publishSessionArtifacts(
  sessionId: string,
  files: Parameters<typeof writeSessionFiles>[1],
  snapshotRuntime: RunToolFlowResultType["snapshot_runtime"],
  context: ToolExecutionContextType,
  snapshotService: SnapshotService,
): Promise<void> {
  const siblingController = new AbortController();
  const branchSignal = AbortSignal.any([context.signal, siblingController.signal]);
  const observeFailure = <T>(promise: Promise<T>): Promise<T> => promise.catch((error: unknown) => {
    if (!siblingController.signal.aborted) siblingController.abort(error);
    throw error;
  });

  const backendFilesPromise = observeFailure(publishBackendFiles(sessionId, files, branchSignal));
  const frontendSnapshotPromise = observeFailure(publishFrontendSnapshot(
    sessionId,
    snapshotRuntime,
    backendFilesPromise,
    branchSignal,
    snapshotService,
  ));
  const branches: Promise<unknown>[] = [backendFilesPromise, frontendSnapshotPromise];

  try {
    const results = await Promise.allSettled(branches);
    const failedResult = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failedResult !== undefined) throw failedResult.reason;
    context.throwIfAborted();
    if (!await sessionFilesAreComplete(sessionId)) {
      throw new AppError("file_session_incomplete", "Session files are incomplete after publication", sessionId);
    }
  } catch (error) {
    if (!siblingController.signal.aborted) siblingController.abort(error);
    await Promise.allSettled(branches);
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
  const overlayOutput = input.toolInput.include_overlay_geojson === true
    ? result.interactive_archive.overlay_output ?? undefined
    : undefined;
  const overlayOutputJson = overlayOutput === undefined ? undefined : serializeOverlayJson(overlayOutput);
  const urls = resolvePublishedUrls(result.session_id, input.toolInput.visual_output);

  // 同 ID 重建开始后旧目录会被 writer 删除，先关闭旧 RAM 入口，避免固定 URL 暴露半成品。
  services.sessionManager.unregisterSession(result.session_id);
  await publishSessionArtifacts(result.session_id, {
    selectedQuery,
    interactiveMap: result.interactive_archive,
    aiOutputYaml,
    interactiveMapUrl: {url: urls.interactiveUrl},
    overlayOutput,
  }, result.snapshot_runtime, context, services.snapshotService);
  context.throwIfAborted();
  services.sessionManager.registerSession(result.session_id, sessionRecord);

  return Object.freeze({
    session_id: result.session_id,
    ...(aiOutputYaml === undefined ? {} : {ai_output_yaml: aiOutputYaml}),
    ...(overlayOutputJson === undefined ? {} : {overlay_output_json: overlayOutputJson}),
    ...(urls.visualUrl === undefined ? {} : {visual_url: urls.visualUrl}),
    interactive_url: urls.interactiveUrl,
  });
}
