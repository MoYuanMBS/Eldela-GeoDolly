/// <reference path="../src/browser/web/vite-env.d.ts" />

import {App, type McpUiHostContext} from "@modelcontextprotocol/ext-apps";
import {createElement, type ReactNode} from "react";
import {flushSync} from "react-dom";
import {createRoot} from "react-dom/client";
import {z} from "zod";
import "../styles/ui-palette.css";
import "../styles/ui-typography.css";
import "../styles/web.css";
import "../styles/ui-bars.css";
import "../styles/ui-panels.css";
import "../styles/ui-assets.css";
import "../styles/ui-scrollbar.css";
import {MapPage} from "../src/browser/web/map-page.js";
import {MapSurfaceView} from "../src/browser/browser-map-flow/map-surface-view.js";
import {finalSessionIdSchema} from "../src/models/backend/session-id-models.js";
import {mcpInteractiveMapDataSchema, type InteractiveMapDataType} from "../src/models/web/interactive-ui-models.js";
import * as mapAppModels from "../src/models/web/map-app-models.js";
import type {CommonVisualMapPayloadType} from "../src/models/mapsurface/map-payload-models.js";
import type {AiMapViewCommands, MapSurfaceBoundsReader} from "../src/browser/web/map-surface-port.js";
import {AiMap} from "./ai-map.js";
import {registerAiMapTools, type AiMapJobResult, type AiMapToolBinding, type UserMapToolBinding} from "./register-tools.js";
import type {AiMapCapturePort} from "./ai-map-screenshot.js";
import type {AiMapScreenshot} from "../src/models/web/snapshot-ui-models.js";
import {AppError} from "../src/shared/app-error.js";
import {GEOMCP_NAME} from "../src/shared/brand.js";

const INTERACTIVE_MAP_META_KEY = "io.geomcp/interactiveMap";
const clientOutputSchema = z.object({
  url: z.url(),
  session_id: finalSessionIdSchema,
  map_data: mcpInteractiveMapDataSchema,
}).strict();

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new AppError("missing_app_element", `Interactive App element is missing: ${id}`);
  return element as T;
}

const publicBaseUrl = new URL(__GEOMCP_APP_BASE_URL__);
const publicBasePath = publicBaseUrl.pathname.replace(/\/+$/u, "");
const appLeafletConfig = __GEOMCP_APP_LEAFLET__;
const appStylePayload = __GEOMCP_APP_STYLE__;
const rootElement = requireElement<HTMLElement>("app-root");
const message = requireElement<HTMLElement>("launcher-message");
const viewport = requireElement<HTMLElement>("map-viewport");
const mapContent = requireElement<HTMLElement>("map-content");
const fallback = requireElement<HTMLElement>("map-fallback");
const urlField = requireElement<HTMLInputElement>("map-url");
const openButton = requireElement<HTMLButtonElement>("open-map");
const copyButton = requireElement<HTMLButtonElement>("copy-map-url");
const fallbackStatus = requireElement<HTMLElement>("fallback-status");
const reactRoot = createRoot(mapContent);

// 诊断区独立于两张地图和截图 wrapper；保留最近事件，即使地图交付失败也能复制排查过程。
const diagnostics = document.createElement("details");
diagnostics.id = "app-diagnostics";
diagnostics.style.cssText = "position:fixed;right:8px;bottom:8px;z-index:10000;max-width:calc(100% - 16px);padding:6px;background:Canvas;color:CanvasText;border:1px solid GrayText;border-radius:4px;font:12px/1.4 system-ui,sans-serif";
const diagnosticSummary = document.createElement("summary");
const diagnosticText = document.createElement("pre");
diagnosticText.style.cssText = "max-width:520px;max-height:220px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text";
const copyDiagnostics = document.createElement("button");
copyDiagnostics.type = "button";
copyDiagnostics.textContent = "复制诊断";
diagnostics.append(diagnosticSummary, diagnosticText, copyDiagnostics);
rootElement.append(diagnostics);
const diagnosticEntries: string[] = [];

function recordDiagnostic(event: string, details: unknown = null, warning = false): void {
  const entry = {time: new Date().toISOString(), level: warning ? "WARNING" : "INFO", event, details};
  diagnosticEntries.push(JSON.stringify(entry));
  if (diagnosticEntries.length > 100) diagnosticEntries.shift();
  diagnosticText.textContent = diagnosticEntries.join("\n");
  diagnosticSummary.textContent = `诊断：${event}`;
  if (warning) diagnostics.open = true;
  if (warning) console.warn("[GeoMCP]", entry);
  else console.info("[GeoMCP]", entry);
}

function diagnosticError(error: unknown) {
  // Zod 原始错误可能很大；只记录字段路径和校验原因，不复制地图数据或业务 records。
  if (error instanceof z.ZodError) return new AppError("app_data_validation", "Map App data failed validation", {issues: error.issues.slice(0, 12).map((issue) => ({path: issue.path.map(String).join("."), message: issue.message})), issue_count: error.issues.length}).toJSON();
  return AppError.fromUnknown(error, "app_diagnostic_error", "Map App operation failed").toJSON();
}

copyDiagnostics.addEventListener("click", () => {
  void Promise.resolve().then(() => navigator.clipboard.writeText(diagnosticEntries.join("\n"))).then(() => {
    copyDiagnostics.textContent = "已复制";
  }).catch(() => {
    window.getSelection()?.selectAllChildren(diagnosticText);
    copyDiagnostics.textContent = "请手动复制选中的诊断";
  });
});
recordDiagnostic("app_started", {public_base_url: publicBaseUrl.href});

let interactiveMapUrl: string | null = null;
let appConnected = false;
let fullscreenRequested = false;
// 代次对应一次结果交付；同 Session 重发也必须区分，以撤销上一轮初始化和迟到回调。
let resultRevision = 0;
let tornDown = false;
// 只保存当前已 ready 的命令/读取端口；两张地图的 Leaflet 实例仍由各自 runtime 持有。
interface AiMapBinding extends AiMapToolBinding {
  port: AiMapCapturePort;
  mode: "screenshot" | "interactive";
  revision: number;
  initialStarted: boolean;
  initialFinished: boolean;
}
let aiBinding: AiMapBinding | null = null;
let userBinding: UserMapToolBinding | null = null;
let aiJob: {controller: AbortController} | null = null;

// 仅缩放整个展示区域；Leaflet 始终在后端给出的逻辑画布上确定初始 zoom。
function fitMapContent(): void {
  if (mapContent.offsetWidth === 0 || mapContent.offsetHeight === 0) return;
  const scale = Math.min(1, viewport.clientWidth / mapContent.offsetWidth, viewport.clientHeight / mapContent.offsetHeight);
  mapContent.style.transform = `translate(-50%, -50%) scale(${scale})`;
}

const resizeObserver = new ResizeObserver(fitMapContent);
resizeObserver.observe(viewport);
resizeObserver.observe(mapContent);

// 共享交付或 App 初始化失败时清理两张地图；AI 的局部失败由下面的独立路径处理。
function showError(errorMessage: string): void {
  resultRevision += 1;
  userBinding = null;
  revokeAiBinding();
  interactiveMapUrl = null;
  flushSync(() => reactRoot.render(null));
  viewport.hidden = true;
  fallback.hidden = true;
  rootElement.dataset.state = "error";
  message.hidden = false;
  message.textContent = errorMessage;
}

function positiveDimension(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function applyHostDimensions(context: McpUiHostContext | undefined): void {
  const dimensions = context?.containerDimensions;
  const fixedWidth = dimensions !== undefined && "width" in dimensions ? positiveDimension(dimensions.width) : null;
  const fixedHeight = dimensions !== undefined && "height" in dimensions ? positiveDimension(dimensions.height) : null;
  const maximumHeight = dimensions !== undefined && "maxHeight" in dimensions ? positiveDimension(dimensions.maxHeight) : null;
  const maximumWidth = dimensions !== undefined && "maxWidth" in dimensions ? positiveDimension(dimensions.maxWidth) : null;
  const height = Math.min(__GEOMCP_IFRAME_MAX_HEIGHT_PX__, fixedHeight ?? maximumHeight ?? __GEOMCP_IFRAME_MAX_HEIGHT_PX__);
  document.documentElement.style.height = fixedHeight === null ? `${height}px` : "100%";
  rootElement.style.height = `${height}px`;
  rootElement.style.maxWidth = `${Math.min(__GEOMCP_IFRAME_MAX_WIDTH_PX__, fixedWidth ?? maximumWidth ?? __GEOMCP_IFRAME_MAX_WIDTH_PX__)}px`;
  if (appConnected && fixedHeight === null) void app.sendSizeChanged({height}).catch(() => undefined);
}

function requestFullscreen(): void {
  if (!appConnected || interactiveMapUrl === null || fullscreenRequested) return;
  const context = app.getHostContext();
  if (context?.displayMode === "fullscreen") {
    fullscreenRequested = true;
    return;
  }
  if (!context?.availableDisplayModes?.includes("fullscreen")) return;
  fullscreenRequested = true;
  // 请求只发一次；拒绝或退出 fullscreen 后继续遵循宿主的实际展示模式。
  void app.requestDisplayMode({mode: "fullscreen"}).catch(() => undefined);
}

function selectUrlForManualCopy(): void {
  urlField.focus();
  urlField.select();
  urlField.setSelectionRange(0, urlField.value.length);
}

const app = new App({name: `${GEOMCP_NAME} Map`, version: "2.0.0"}, {tools: {listChanged: true}}, {autoResize: false});
// 同一个 App 承载两张地图；connect 前完成注册，每次工具调用通过 getter 读取当前绑定。
const {fitAiMapTool, setAiMapTool, captureAiMapTool, fitAiMapToUserViewTool} = registerAiMapTools(app, () => aiBinding, () => userBinding);
const diagnosticTools = {geomcp_fit_ai_map_bbox: fitAiMapTool, geomcp_set_ai_map_center_zoom: setAiMapTool, geomcp_capture_ai_map: captureAiMapTool, geomcp_fit_ai_map_to_user_view: fitAiMapToUserViewTool};
// 包装 SDK 的公开列表 handler，只观察真实返回值，不替换其工具注册、schema 或分发行为。
const listAppTools = app.onlisttools;
if (listAppTools !== undefined) app.onlisttools = async (params, extra) => {
  recordDiagnostic("host_tools_list_requested");
  const result = await listAppTools(params, extra);
  recordDiagnostic("app_tools_list_returned", {tools: result.tools.map((tool) => tool.name)});
  return result;
};

// 在取消异步初始化或释放地图前先撤销可调用入口，防止宿主继续使用上一轮命令。
function revokeAiBinding(): void {
  aiBinding = null;
  aiJob?.controller.abort(new AppError("ai_map_unavailable", "AI map result has been replaced or released"));
  fitAiMapTool.disable();
  setAiMapTool.disable();
  captureAiMapTool.disable();
  fitAiMapToUserViewTool.disable();
  recordDiagnostic("ai_tools_disabled");
}

function requireCurrentAiBinding(binding: AiMapBinding): void {
  if (tornDown || binding !== aiBinding || binding.revision !== resultRevision) throw new AppError("ai_map_unavailable", "AI map result has been replaced or released");
}

function syncAiTools(): void {
  if (aiBinding === null || !aiBinding.initialFinished) {
    fitAiMapTool.disable();
    setAiMapTool.disable();
    captureAiMapTool.disable();
    fitAiMapToUserViewTool.disable();
  } else {
    fitAiMapTool.enable();
    setAiMapTool.enable();
    if (aiBinding.mode === "screenshot") captureAiMapTool.enable();
    else captureAiMapTool.disable();
    if (userBinding !== null && userBinding.sessionId === aiBinding.sessionId) fitAiMapToUserViewTool.enable();
    else fitAiMapToUserViewTool.disable();
  }
  recordDiagnostic("ai_tools_state", {session_id: aiBinding?.sessionId ?? null, enabled_tools: Object.entries(diagnosticTools).filter(([, tool]) => tool.enabled).map(([name]) => name)});
}

function waitForAiJob<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = (): void => { reject(signal.reason); };
    signal.addEventListener("abort", abort, {once: true});
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

async function runAiMapJob(binding: AiMapBinding, operation?: (commands: AiMapViewCommands) => mapAppModels.AiMapViewType, hostSignal?: AbortSignal): Promise<AiMapJobResult> {
  requireCurrentAiBinding(binding);
  if (aiJob !== null) throw new AppError("ai_map_busy", "An AI map operation is still running");
  hostSignal?.throwIfAborted();
  const job = {controller: new AbortController()};
  aiJob = job;
  const lifetimeSignal = hostSignal === undefined ? job.controller.signal : AbortSignal.any([hostSignal, job.controller.signal]);
  const budget = new AbortController();
  const signal = AbortSignal.any([lifetimeSignal, budget.signal]);
  const deadline = performance.now() + __GEOMCP_MAP_READY_TIMEOUT_MS__;
  const timer = setTimeout(() => budget.abort(new AppError("ai_map_job_timeout", "AI map screenshot job exceeded its time budget")), __GEOMCP_MAP_READY_TIMEOUT_MS__);
  let captureWork: Promise<AiMapScreenshot> | null = null;
  try {
    const view = operation === undefined ? binding.port.commands.getView() : operation(binding.port.commands);
    let screenshot: AiMapScreenshot | null = null;
    if (binding.mode === "screenshot") {
      recordDiagnostic("ai_screenshot_started", {session_id: binding.sessionId, revision: binding.revision, initial: operation === undefined});
      try {
        captureWork = binding.port.capture(view, signal);
        screenshot = await waitForAiJob(captureWork, signal);
      } catch (error) {
        screenshot = {image: null, warning: AppError.fromUnknown(error, "ai_map_screenshot_failed", "AI map screenshot generation failed").toJSON()};
      }
      // 生命周期撤销和客户端取消不交付旧图；单纯截图超时仍返回视口与 warning。
      requireCurrentAiBinding(binding);
      hostSignal?.throwIfAborted();
      if (screenshot.image !== null && JSON.stringify(binding.port.commands.getView()) !== JSON.stringify(view)) {
        screenshot = {image: null, warning: new AppError("ai_map_view_changed", "The AI map changed before its screenshot could be delivered").toJSON()};
      }
      if (screenshot.warning !== null) recordDiagnostic("ai_screenshot_failed", {session_id: binding.sessionId, warning: screenshot.warning}, true);
      else recordDiagnostic("ai_screenshot_created", {session_id: binding.sessionId, mime_type: screenshot.image?.mimeType, base64_length: screenshot.image?.data.length});
      if (operation === undefined) {
        const state = {session_id: binding.sessionId, ...binding.port.commands.getView()};
        const content: Array<{type: "text"; text: string} | NonNullable<AiMapScreenshot["image"]>> = [{type: "text", text: JSON.stringify(state)}];
        if (screenshot.image !== null) content.push(screenshot.image);
        else content.push({type: "text", text: JSON.stringify({warning: screenshot.warning})});
        try {
          // 超时也只发送一次文字 warning；SDK 消费剩余预算，不为发送重置整份超时。
          lifetimeSignal.throwIfAborted();
          recordDiagnostic("model_context_submission_started", {session_id: binding.sessionId, content_types: content.map((block) => block.type), host_capability: app.getHostCapabilities()?.updateModelContext ?? null});
          await waitForAiJob(app.updateModelContext({content}, {signal: lifetimeSignal, timeout: Math.max(1, deadline - performance.now())}), lifetimeSignal);
          if (binding === aiBinding && !tornDown) recordDiagnostic("model_context_acknowledged", {session_id: binding.sessionId, note: "宿主已确认接收；不代表当前模型已经收到图片"});
        } catch (error) {
          if (binding === aiBinding && !tornDown) recordDiagnostic("model_context_submission_failed", {session_id: binding.sessionId, error: diagnosticError(error)}, true);
        }
      }
    }
    requireCurrentAiBinding(binding);
    return {view: binding.port.commands.getView(), screenshot};
  } finally {
    clearTimeout(timer);
    const release = (): void => {
      if (aiJob === job) aiJob = null;
      // 只处理尚未开始的最新结果首图；已尝试的首图永不自动重拍或重发。
      submitInitialAiImage();
    };
    // SnapDOM 不接收 AbortSignal；超时可以先回复，但底层结束前保留作业槽，避免无限堆积捕获。
    if (captureWork === null) release();
    else void captureWork.then(release, release);
  }
}

function submitInitialAiImage(): void {
  const binding = aiBinding;
  if (!appConnected || aiJob !== null || binding === null || binding.mode !== "screenshot" || binding.initialStarted || tornDown) return;
  binding.initialStarted = true;
  void runAiMapJob(binding).catch((error: unknown) => {
    if (binding === aiBinding && !tornDown) recordDiagnostic("ai_initial_screenshot_failed", {session_id: binding.sessionId, error: diagnosticError(error)}, true);
  }).finally(() => {
    if (binding !== aiBinding || tornDown) return;
    binding.initialFinished = true;
    syncAiTools();
  });
}

// URL 只接受当前部署和当前 Session 的固定路由，避免备用链接或视觉 URL 混入别处的数据。
function validateMapUrl(value: string, sessionId: string, routes: readonly string[]): URL {
  const url = new URL(value);
  if (url.origin !== publicBaseUrl.origin || !routes.some((route) => url.pathname === `${publicBasePath}/session/${sessionId}/${route}`) || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw new AppError("invalid_app_map_url", "Map URL does not match its session and App deployment", {expected_origin: publicBaseUrl.origin, expected_paths: routes.map((route) => `${publicBasePath}/session/${sessionId}/${route}`), received_origin: url.origin, received_path: url.pathname, has_credentials: url.username !== "" || url.password !== "", has_query: url.search !== "", has_fragment: url.hash !== ""});
  }
  return url;
}

function assembleMapPayload(data: mapAppModels.MapAppSharedDataType, layout: mapAppModels.UserMapAppPayloadType | mapAppModels.AiMapAppPayloadType): CommonVisualMapPayloadType {
  const {session_id, visual_output, ai_output, display_id_by_feature_id, relation_membership_by_feature_id, selected_location_name, ...visual} = data;
  // 共享业务字段已在接收边界校验；只新建角色的顶层容器，嵌套 Overlay/Core 数据继续使用同一引用。
  // map_size 是地图本身的 [width, height] 逻辑像素，映射回既有字段，不把角色 UI 高度计入其中。
  return {...visual, screenshot_size: layout.map_size, center: layout.center, leaflet_bbox: layout.leaflet_bbox, leaflet: appLeafletConfig};
}

app.ontoolresult = (result): void => {
  if (tornDown) return;
  const revision = ++resultRevision;
  recordDiagnostic("host_tool_result_received", {revision, is_error: result.isError === true, metadata_keys: Object.keys(result._meta ?? {}), has_interactive_map_data: result._meta?.[INTERACTIVE_MAP_META_KEY] !== undefined, has_structured_content: result.structuredContent !== undefined, content_types: result.content?.map((block) => block.type) ?? []});
  userBinding = null;
  revokeAiBinding();
  // 同 Session 重发也必须同步撤销旧 effect，阻止迟到初始化和旧命令继续使用旧实例。
  flushSync(() => reactRoot.render(null));
  if (result.isError === true) {
    showError("The map tool returned an error. No Interactive map is available.");
    recordDiagnostic("backend_tool_failed", {revision}, true);
    return;
  }
  let deliveryStage = "metadata";
  try {
    const raw = result._meta?.[INTERACTIVE_MAP_META_KEY];
    if (raw === undefined || raw === null) throw new AppError("app_map_metadata_missing", "Host tool result is missing io.geomcp/interactiveMap");
    let sessionId: string;
    let url: URL;
    let userData: InteractiveMapDataType;
    const maps: ReactNode[] = [];
    if (typeof raw === "object" && raw !== null && "data" in raw) {
      // 一次校验共享业务数据和 User 布局；AI 布局留给下方单独校验，使其失败只影响 AI 区域。
      deliveryStage = "shared_data_and_user_layout";
      const output = mapAppModels.mapAppResultSchema.parse(raw);
      const data = output.data;
      sessionId = data.session_id;
      deliveryStage = "user_map_url";
      url = validateMapUrl(output.user_payload.url, sessionId, ["interactive"]);
      recordDiagnostic("user_delivery_validated", {revision, session_id: sessionId, visual_output: data.visual_output});
      userData = {
        map_payload: assembleMapPayload(data, output.user_payload),
        style_payload: appStylePayload,
        ai_output: data.ai_output,
        display_id_by_feature_id: data.display_id_by_feature_id,
        relation_membership_by_feature_id: data.relation_membership_by_feature_id,
        selected_location_name: data.selected_location_name,
      };
      try {
        if (data.visual_output === "none") {
          if (output.ai_payload !== null) throw new AppError("invalid_app_ai_map_data", "AI map payload must be null when visual_output is none");
          recordDiagnostic("ai_map_disabled_by_visual_output", {revision, session_id: sessionId});
        } else {
          const layout = mapAppModels.aiMapAppPayloadSchema.parse(output.ai_payload);
          if (layout.url !== undefined) validateMapUrl(layout.url, sessionId, ["snapshot-interactive", "snapshot.webp"]);
          const aiData = {map_payload: assembleMapPayload(data, layout), style_payload: appStylePayload};
          const mode = data.visual_output;
          recordDiagnostic("ai_delivery_validated", {revision, session_id: sessionId, visual_output: mode});
          const onAiViewCommandsChange = (port: AiMapCapturePort | null): void => {
            // 旧实例的 ready 或 cleanup 可能迟到；仅当前代次能启用工具或撤销当前绑定。
            if (tornDown || revision !== resultRevision) return;
            if (port === null) {
              revokeAiBinding();
            } else {
              const binding: AiMapBinding = {
                sessionId, port, mode, revision,
                initialStarted: false, initialFinished: mode !== "screenshot",
                run: (operation, signal) => runAiMapJob(binding, operation, signal)
              };
              aiBinding = binding;
              recordDiagnostic("ai_map_ready", {revision, session_id: sessionId});
              syncAiTools();
              submitInitialAiImage();
            }
          };
          maps.push(createElement("section", {key: "ai", "aria-label": "AI map"},
            createElement("h2", {className: "geomcp-app-map-title"}, "AI map"),
            createElement(AiMap, {mapData: aiData, onAiViewCommandsChange})));
        }
      } catch (error) {
        recordDiagnostic("ai_map_delivery_invalid", {revision, session_id: sessionId, error: diagnosticError(error)}, true);
        maps.push(createElement("section", {key: "ai-error", className: "geomcp-map-page-state geomcp-map-page-error", role: "alert"}, "The tool did not provide valid AI map data. The User map is available."));
      }
    } else {
      // 旧后端仍只创建 User 地图；同样只校验一次，不复制已校验的 Overlay。
      deliveryStage = "legacy_user_data";
      const output = clientOutputSchema.parse(raw);
      sessionId = output.session_id;
      deliveryStage = "legacy_user_map_url";
      url = validateMapUrl(output.url, sessionId, ["interactive"]);
      recordDiagnostic("legacy_user_only_delivery", {revision, session_id: sessionId});
      userData = {
        ...output.map_data,
        map_payload: {...output.map_data.map_payload, leaflet: appLeafletConfig},
        style_payload: appStylePayload,
      };
    }
    deliveryStage = "map_mount";
    let tileMeta = document.querySelector<HTMLMetaElement>('meta[name="geomcp-basemap-base-url"]');
    if (tileMeta === null) {
      tileMeta = document.createElement("meta");
      tileMeta.name = "geomcp-basemap-base-url";
      document.head.append(tileMeta);
    }
    tileMeta.content = `${publicBaseUrl.origin}${publicBasePath}/basemap/${sessionId}`;
    interactiveMapUrl = url.href;
    urlField.value = url.href;
    message.hidden = true;
    viewport.hidden = false;
    fallback.hidden = false;
    fallbackStatus.textContent = "Open or copy the map URL to view it in a browser.";
    rootElement.dataset.state = "ready";
    const onViewBoundsReaderChange = (reader: MapSurfaceBoundsReader | null): void => {
      // 旧 User 实例的 ready/cleanup 不得启用新代次工具，也不得撤销新实例的绑定。
      if (tornDown || revision !== resultRevision) return;
      userBinding = reader === null ? null : {sessionId, getBounds: reader};
      recordDiagnostic(reader === null ? "user_map_released" : "user_map_ready", {revision, session_id: sessionId});
      syncAiTools();
    };
    maps.unshift(createElement("section", {key: "user", "aria-label": "User map"},
      createElement("h2", {className: "geomcp-app-map-title"}, "User map"),
      createElement(MapPage, {mapData: userData, MapSurfaceComponent: MapSurfaceView, onViewBoundsReaderChange})));
    reactRoot.render(createElement("div", {className: "geomcp-app-maps", key: revision}, ...maps));
    recordDiagnostic("maps_mount_requested", {revision, session_id: sessionId});
    requestFullscreen();
  } catch (error) {
    showError("The map tool did not provide valid Interactive map data for this App.");
    recordDiagnostic("app_map_delivery_failed", {revision, stage: deliveryStage, error: diagnosticError(error)}, true);
  }
};

// SDK 合并增量 context 后再读取，避免主题通知清除已有尺寸约束。
app.onhostcontextchanged = (): void => {
  if (tornDown) return;
  applyHostDimensions(app.getHostContext());
  requestFullscreen();
};
app.onteardown = async () => {
  // 先拒绝后续通知/迟到 connect，再撤销工具；React unmount 会取消两张地图的异步任务并释放 runtime。
  tornDown = true;
  resultRevision += 1;
  userBinding = null;
  revokeAiBinding();
  interactiveMapUrl = null;
  resizeObserver.disconnect();
  reactRoot.unmount();
  recordDiagnostic("app_teardown");
  return {};
};

openButton.addEventListener("click", () => {
  void (async () => {
    if (interactiveMapUrl === null) return;
    try {
      if (app.getHostCapabilities()?.openLinks === undefined || (await app.openLink({url: interactiveMapUrl})).isError === true) {
        selectUrlForManualCopy();
        fallbackStatus.textContent = "The URL is selected for manual copy.";
      }
    } catch {
      selectUrlForManualCopy();
      fallbackStatus.textContent = "The URL is selected for manual copy.";
    }
  })();
});
copyButton.addEventListener("click", () => {
  void (async () => {
    if (interactiveMapUrl === null) return;
    selectUrlForManualCopy();
    try {
      await navigator.clipboard.writeText(interactiveMapUrl);
      fallbackStatus.textContent = "Map URL copied.";
    } catch {
      fallbackStatus.textContent = "The URL is selected for manual copy.";
    }
  })();
});

applyHostDimensions(undefined);
recordDiagnostic("host_connection_started");
void app.connect().then(() => {
  if (tornDown) return;
  appConnected = true;
  recordDiagnostic("host_connected", {host_info: app.getHostVersion() ?? null, host_capabilities: app.getHostCapabilities() ?? null});
  submitInitialAiImage();
  applyHostDimensions(app.getHostContext());
  requestFullscreen();
}).catch((error: unknown) => {
  if (tornDown) return;
  showError("This chat host could not initialize the map App.");
  recordDiagnostic("host_connection_failed", {error: diagnosticError(error)}, true);
});
