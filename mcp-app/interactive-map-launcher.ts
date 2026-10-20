/// <reference path="../src/browser/web/vite-env.d.ts" />

import {App, McpUiToolResultNotificationSchema, type McpUiHostContext} from "@modelcontextprotocol/ext-apps";
import {createElement, type ReactNode} from "react";
import {flushSync} from "react-dom";
import {createRoot} from "react-dom/client";
import "../styles/ui-palette.css";
import "../styles/ui-typography.css";
import "../styles/web.css";
import "../styles/ui-bars.css";
import "../styles/ui-panels.css";
import "../styles/ui-assets.css";
import "../styles/ui-scrollbar.css";
import {MapPage} from "../src/browser/web/map-page.js";
import {MapSurfaceView} from "../src/browser/browser-map-flow/map-surface-view.js";
import {visualOutputSchema, type VisualOutputType} from "../src/models/backend/bridge-models.js";
import {mcpInteractiveMapDataSchema, type InteractiveMapDataType, type McpInteractiveMapDataType} from "../src/models/web/interactive-ui-models.js";
import * as mapAppModels from "../src/models/web/map-app-models.js";
import type {MapSurfaceBoundsReader} from "../src/browser/web/map-surface-port.js";
import {AiMap} from "./ai-map.js";
import {registerAiMapTools, type UserMapToolBinding} from "./register-tools.js";
import type {AiMapCapturePort} from "./ai-map-screenshot.js";
import type {AiMapScreenshot} from "../src/models/web/snapshot-ui-models.js";
import {AppError} from "../src/shared/app-error.js";
import {GEOMCP_NAME} from "../src/shared/brand.js";

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

let interactiveMapUrl: string | null = null;
let appConnected = false;
let fullscreenRequested = false;
// 代次对应一次结果交付；同 Session 重发也必须区分，以撤销上一轮初始化和迟到回调。
let resultRevision = 0;
let tornDown = false;
let visualOutput: VisualOutputType | null = null;
let mapDataRequest: AbortController | null = null;
// 只保存当前已 ready 的命令/读取端口；两张地图的 Leaflet 实例仍由各自 runtime 持有。
interface AiMapBinding {
  sessionId: string;
  port: AiMapCapturePort;
  mode: "screenshot" | "interactive";
  revision: number;
}
interface MapDelivery {
  sessionId: string;
  mode: VisualOutputType | null;
  controller: AbortController;
  aiError: AppError | null;
  userError: AppError | null;
  initialState: "pending" | "capturing" | "tool" | "done";
  initialWork: Promise<mapAppModels.AiMapJobResult> | null;
}
let mapDelivery: MapDelivery | null = null;
let mapFailure: AppError | null = null;
const readyWaiters = new Set<() => void>();
let aiBinding: AiMapBinding | null = null;
let userBinding: UserMapToolBinding | null = null;
let aiJob: {controller: AbortController; initial: boolean; done: Promise<void>} | null = null;

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
  mapFailure = new AppError("ai_map_unavailable", errorMessage);
  mapDelivery?.controller.abort(mapFailure);
  mapDataRequest?.abort();
  mapDataRequest = null;
  userBinding = null;
  revokeAiBinding();
  flushSync(() => reactRoot.render(null));
  viewport.hidden = true;
  fallback.hidden = interactiveMapUrl === null;
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
// 首次列表包含全部工具；入口按本次交付等待 ready，不用 disable 改变可发现的工具集合。
registerAiMapTools(app, runAiMapTool, () => userBinding);

// 在取消异步初始化或释放地图前先撤销可调用入口，防止宿主继续使用上一轮命令。
function revokeAiBinding(): void {
  const reason = new AppError("ai_map_unavailable", "AI map result has been replaced or released");
  aiBinding = null;
  aiJob?.controller.abort(reason);
  notifyMapReady();
}

function requireCurrentAiBinding(binding: AiMapBinding): void {
  if (tornDown || binding !== aiBinding || binding.revision !== resultRevision) throw new AppError("ai_map_unavailable", "AI map result has been replaced or released");
}

function notifyMapReady(): void {
  for (const check of [...readyWaiters]) check();
}

function waitForAiBinding(sessionId: string, kind: mapAppModels.AiMapToolKind, signal: AbortSignal): Promise<{binding: AiMapBinding; delivery: MapDelivery; initialWork: Promise<mapAppModels.AiMapJobResult> | null}> {
  return new Promise((resolve, reject) => {
    let delivery: MapDelivery | null = null;
    const cleanup = (): void => { readyWaiters.delete(check); signal.removeEventListener("abort", check); };
    const check = (): void => {
      try {
        signal.throwIfAborted();
        if (tornDown) throw new AppError("ai_map_unavailable", "The map App has been released");
        if (mapFailure !== null) throw mapFailure;
        delivery ??= mapDelivery;
        if (delivery === null) return;
        delivery.controller.signal.throwIfAborted();
        if (delivery !== mapDelivery) throw new AppError("ai_map_unavailable", "The requested map delivery has been replaced");
        if (delivery.sessionId !== sessionId) throw new AppError("ai_map_session_mismatch", "The requested session does not match the current AI map");
        if (delivery.mode === null || delivery.mode === "none") throw new AppError("ai_map_unavailable", "AI tools are unavailable for this visual mode");
        if (kind === "capture" && delivery.mode !== "screenshot") throw new AppError("ai_map_unavailable", "AI map capture requires screenshot mode");
        if (delivery.aiError !== null) throw delivery.aiError;
        if (kind === "user" && delivery.userError !== null) throw delivery.userError;
        // 接管在等待之前生效；调用取消后也不自动退回发送消息，避免意外触发新的模型轮次。
        const takeInitial = delivery.initialState !== "done";
        if (takeInitial && delivery.mode === "screenshot") delivery.initialState = "tool";
        if (!appConnected || aiBinding === null || (kind === "user" && userBinding === null)) return;
        requireCurrentAiBinding(aiBinding);
        cleanup();
        resolve({binding: aiBinding, delivery, initialWork: kind === "capture" && takeInitial ? delivery.initialWork : null});
      } catch (error) { cleanup(); reject(error); }
    };
    readyWaiters.add(check);
    signal.addEventListener("abort", check, {once: true});
    check();
  });
}

async function runAiMapTool(sessionId: string, operation: (commands: mapAppModels.AiMapViewCommands) => mapAppModels.AiMapViewType, hostSignal: AbortSignal, kind: mapAppModels.AiMapToolKind): Promise<mapAppModels.AiMapJobResult> {
  const deadline = performance.now() + __GEOMCP_MAP_READY_TIMEOUT_MS__;
  const budget = new AbortController();
  const signal = AbortSignal.any([hostSignal, budget.signal]);
  const timer = setTimeout(() => budget.abort(new AppError("ai_map_job_timeout", "AI map operation exceeded its time budget while waiting for readiness")), __GEOMCP_MAP_READY_TIMEOUT_MS__);
  try {
    const {binding, delivery, initialWork} = await waitForAiBinding(sessionId, kind, signal);
    const lifetimeSignal = AbortSignal.any([signal, delivery.controller.signal]);
    if (initialWork !== null) {
      // 显式 capture 接管同一张首图；fit/set/对齐须先让原始捕获真正结束，再改变视口。
      const result = await waitForAiJob(initialWork, lifetimeSignal);
      lifetimeSignal.throwIfAborted();
      requireCurrentAiBinding(binding);
      if (JSON.stringify(result.view) !== JSON.stringify(binding.port.commands.getView())) {
        return {view: binding.port.commands.getView(), screenshot: {image: null, warning: new AppError("ai_map_view_changed", "The AI map changed before its screenshot could be delivered").toJSON()}};
      }
      return result;
    }
    if (aiJob?.initial) await waitForAiJob(aiJob.done, lifetimeSignal);
    lifetimeSignal.throwIfAborted();
    requireCurrentAiBinding(binding);
    clearTimeout(timer);
    return await runAiMapJob(binding, operation, hostSignal, deadline);
  } finally { clearTimeout(timer); }
}

function waitForAiJob<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = (): void => { reject(signal.reason); };
    signal.addEventListener("abort", abort, {once: true});
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

async function runAiMapJob(binding: AiMapBinding, operation: ((commands: mapAppModels.AiMapViewCommands) => mapAppModels.AiMapViewType) | undefined, hostSignal: AbortSignal, deadline: number): Promise<mapAppModels.AiMapJobResult> {
  requireCurrentAiBinding(binding);
  if (aiJob !== null) throw new AppError("ai_map_busy", "An AI map operation is still running");
  hostSignal.throwIfAborted();
  if (performance.now() >= deadline) throw new AppError("ai_map_job_timeout", "AI map operation exceeded its time budget");
  let finishJob: () => void = () => {};
  const job = {controller: new AbortController(), initial: operation === undefined, done: new Promise<void>((resolve) => { finishJob = resolve; })};
  aiJob = job;
  const lifetimeSignal = AbortSignal.any([hostSignal, job.controller.signal, mapDelivery!.controller.signal]);
  const budget = new AbortController();
  const signal = AbortSignal.any([lifetimeSignal, budget.signal]);
  const timer = setTimeout(() => budget.abort(new AppError("ai_map_job_timeout", "AI map screenshot job exceeded its time budget")), Math.max(0, deadline - performance.now()));
  let captureWork: Promise<AiMapScreenshot> | null = null;
  try {
    const view = operation === undefined ? binding.port.commands.getView() : operation(binding.port.commands);
    let screenshot: AiMapScreenshot | null = null;
    if (binding.mode === "screenshot") {
      try {
        captureWork = binding.port.capture(view, signal);
        screenshot = await waitForAiJob(captureWork, signal);
      } catch (error) {
        screenshot = {image: null, warning: AppError.fromUnknown(error, "ai_map_screenshot_failed", "AI map screenshot generation failed").toJSON()};
      }
      // 生命周期撤销和客户端取消不交付旧图；单纯截图超时仍返回视口与 warning。
      requireCurrentAiBinding(binding);
      lifetimeSignal.throwIfAborted();
      if (screenshot.image !== null && JSON.stringify(binding.port.commands.getView()) !== JSON.stringify(view)) {
        screenshot = {image: null, warning: new AppError("ai_map_view_changed", "The AI map changed before its screenshot could be delivered").toJSON()};
      }
      if (screenshot.warning !== null) console.warn("[GeoMCP] AI map screenshot failed.", screenshot.warning);
    }
    requireCurrentAiBinding(binding);
    return {view: binding.port.commands.getView(), screenshot};
  } finally {
    clearTimeout(timer);
    const release = (): void => {
      if (aiJob === job) aiJob = null;
      finishJob();
      notifyMapReady();
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
  const delivery = mapDelivery;
  if (!appConnected || aiJob !== null || binding === null || delivery === null || binding.mode !== "screenshot" || delivery.initialState !== "pending" || tornDown) return;
  delivery.initialState = "capturing";
  const deadline = performance.now() + __GEOMCP_MAP_READY_TIMEOUT_MS__;
  const work = runAiMapJob(binding, undefined, delivery.controller.signal, deadline);
  delivery.initialWork = work;
  void work.then(async (result) => {
    requireCurrentAiBinding(binding);
    if (delivery !== mapDelivery || delivery.initialState !== "capturing") return;
    // 调用 sendMessage 是交付分界；发出后的消息无法保证撤回，不能因回执超时自动重发。
    delivery.initialState = "done";
    if (result.screenshot?.image === null || result.screenshot?.image === undefined) return;
    const capabilities = app.getHostCapabilities();
    if (capabilities?.message === undefined) throw new AppError("ai_map_message_unavailable", "The chat host does not support App messages");
    const params = {
      role: "user" as const,
      content: [{type: "text" as const, text: JSON.stringify({session_id: binding.sessionId, ...result.view})}, result.screenshot.image],
      ...(capabilities.experimental?.["openai/message"] === undefined ? {} : {_meta: {"openai/message": {target: "active", send: true}}})
    };
    const response = await app.sendMessage(params, {signal: delivery.controller.signal, timeout: Math.max(1, deadline - performance.now())});
    if (response.isError === true) throw new AppError("ai_map_message_failed", "The chat host rejected the AI map image message");
  }).catch((error: unknown) => {
    if (binding === aiBinding && delivery === mapDelivery && !tornDown) console.warn("[GeoMCP] AI map initial image could not be sent.", AppError.fromUnknown(error, "ai_map_message_failed", "AI map initial image delivery failed").toJSON());
  }).finally(() => {
    if (delivery.initialWork === work) delivery.initialWork = null;
    if (delivery.initialState === "capturing") delivery.initialState = "done";
  });
}

// 数据请求直接访问构建期 Server 地址；Host 只交付指针，不参与数据传输或 ACK。
async function loadMapData(sessionId: string, signal: AbortSignal): Promise<McpInteractiveMapDataType> {
  if (app.getHostCapabilities()?.sandbox?.csp?.connectDomains?.length === 0) {
    throw new AppError("app_map_connection_denied", "The chat host did not allow map data requests. Open the map in a browser.");
  }
  const url = `${publicBaseUrl.origin}${publicBasePath}/session/${encodeURIComponent(sessionId)}/mapdata`;
  const response = await fetch(url, {cache: "no-store", credentials: "omit", signal});
  if (!response.ok) {
    throw new AppError("app_map_data_request", response.status === 410 ? "已过期" : `Map data request failed with HTTP ${response.status}`);
  }
  return mcpInteractiveMapDataSchema.parse(await response.json());
}

// SDK 默认会补空 content；兼容解包要求文本中的对象本身就是完整 ToolResult。
const embeddedToolResultSchema = McpUiToolResultNotificationSchema.shape.params.extend({
  content: McpUiToolResultNotificationSchema.shape.params.shape.content.removeDefault(),
});

app.ontoolinput = (input): void => {
  if (tornDown) return;
  const mode = visualOutputSchema.safeParse(input.arguments?.visual_output);
  visualOutput = mode.success ? mode.data : null;
};

app.ontoolresult = (result): void => {
  if (tornDown) return;
  const revision = ++resultRevision;
  // 模式属于本次交付；在异步 GET 前固定它，缺少新输入时不沿用上一次的模式。
  const mode = visualOutput;
  visualOutput = null;
  mapDelivery?.controller.abort(new AppError("ai_map_unavailable", "The map delivery has been replaced"));
  mapDelivery = null;
  mapFailure = null;
  mapDataRequest?.abort();
  mapDataRequest = null;
  userBinding = null;
  revokeAiBinding();
  interactiveMapUrl = null;
  urlField.value = "";
  viewport.hidden = true;
  fallback.hidden = true;
  message.hidden = false;
  message.textContent = "Loading the Interactive map…";
  rootElement.dataset.state = "loading";
  // 同 Session 重发也必须同步撤销旧 effect，阻止迟到初始化和旧命令继续使用旧实例。
  flushSync(() => reactRoot.render(null));
  if (result.isError === true) {
    showError("The map tool returned an error. No Interactive map is available.");
    return;
  }
  let structuredContent = result.structuredContent;
  const content = result.content[0];
  // 只兼容缺失指针的单层文本包装；外层已提供的非法指针不能被内层覆盖。
  if (!Object.hasOwn(result, "structuredContent") && result.content.length === 1 && content?.type === "text") {
    let wrappedResult: unknown;
    try { wrappedResult = JSON.parse(content.text); }
    catch { wrappedResult = undefined; }
    const inner = embeddedToolResultSchema.safeParse(wrappedResult);
    if (inner.success) {
      if (inner.data.isError === true) {
        showError("The map tool returned an error. No Interactive map is available.");
        return;
      }
      structuredContent = inner.data.structuredContent;
    }
  }
  const output = mapAppModels.mapAppResultSchema.safeParse(structuredContent);
  if (!output.success) {
    // 错误页同步显示交付形状与校验失败项，便于无 Console 的桌面 Host 收集诊断。
    const diagnostics = {
      diagnostic_version: "map-result-diagnostics-v1",
      result_keys: Object.keys(result),
      structured_content_type: structuredContent === null ? "null" : Array.isArray(structuredContent) ? "array" : typeof structuredContent,
      structured_content_keys: structuredContent !== null && typeof structuredContent === "object" ? Object.keys(structuredContent) : [],
      issues: output.error.issues
    };
    console.warn("[GeoMCP] Map tool result validation failed.", diagnostics);
    showError("The map tool did not provide a valid Session ID for this App.");
    const details = document.createElement("span");
    details.textContent = JSON.stringify(diagnostics, null, 2);
    details.style.cssText = "display: block; max-height: 320px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; text-align: left; user-select: text;";
    message.append(details);
    return;
  }
  const sessionId = output.data.session_id;
  const delivery: MapDelivery = {sessionId, mode, controller: new AbortController(), aiError: null, userError: null, initialState: "pending", initialWork: null};
  mapDelivery = delivery;
  notifyMapReady();
  interactiveMapUrl = `${publicBaseUrl.origin}${publicBasePath}/session/${encodeURIComponent(sessionId)}/interactive`;
  urlField.value = interactiveMapUrl;
  fallback.hidden = false;
  fallbackStatus.textContent = "Open or copy the map URL to view it in a browser.";
  const controller = new AbortController();
  mapDataRequest = controller;
  void (async () => {
    const data = await loadMapData(sessionId, controller.signal);
    // 取消请求仍可能已有响应；同 Session 的旧结果也不能覆盖新地图或恢复旧 AI 工具。
    if (controller.signal.aborted || tornDown || revision !== resultRevision) return;
    const userData: InteractiveMapDataType = {
      ...data,
      map_payload: {...data.map_payload, leaflet: appLeafletConfig},
      style_payload: appStylePayload,
    };
    const maps: ReactNode[] = [];
    if (mode === null) {
      maps.push(createElement("section", {key: "ai-error", className: "geomcp-map-page-state geomcp-map-page-error", role: "alert"}, "The tool input did not provide a valid AI visual mode. The User map is available."));
    } else if (mode !== "none") {
      // 角色仅装配顶层容器，地图业务对象与构建样式共享引用，不再次解析完整数据。
      const aiData = {map_payload: userData.map_payload, style_payload: appStylePayload};
      const onAiViewCommandsChange = (port: AiMapCapturePort | null): void => {
        if (tornDown || revision !== resultRevision) return;
        if (port === null) {
          revokeAiBinding();
        } else {
          const binding: AiMapBinding = {
            sessionId, port, mode, revision
          };
          aiBinding = binding;
          notifyMapReady();
          submitInitialAiImage();
        }
      };
      maps.push(createElement("section", {key: "ai", "aria-label": "AI map"},
        createElement("h2", {className: "geomcp-app-map-title"}, "AI map"),
        createElement(AiMap, {mapData: aiData, onAiViewCommandsChange, onMapError: (message: string) => {
          if (tornDown || revision !== resultRevision) return;
          delivery.aiError = new AppError("ai_map_unavailable", message);
          revokeAiBinding();
        }})));
    }
    let tileMeta = document.querySelector<HTMLMetaElement>('meta[name="geomcp-basemap-base-url"]');
    if (tileMeta === null) {
      tileMeta = document.createElement("meta");
      tileMeta.name = "geomcp-basemap-base-url";
      document.head.append(tileMeta);
    }
    tileMeta.content = `${publicBaseUrl.origin}${publicBasePath}/basemap/${encodeURIComponent(sessionId)}`;
    message.hidden = true;
    viewport.hidden = false;
    rootElement.dataset.state = "ready";
    const onViewBoundsReaderChange = (reader: MapSurfaceBoundsReader | null): void => {
      // 旧 User 实例的 ready/cleanup 不得启用新代次工具，也不得撤销新实例的绑定。
      if (tornDown || revision !== resultRevision) return;
      userBinding = reader === null ? null : {sessionId, getBounds: reader};
      notifyMapReady();
    };
    maps.unshift(createElement("section", {key: "user", "aria-label": "User map"},
      createElement("h2", {className: "geomcp-app-map-title"}, "User map"),
      createElement(MapPage, {mapData: userData, MapSurfaceComponent: MapSurfaceView, onViewBoundsReaderChange, onMapError: (message: string) => {
        if (tornDown || revision !== resultRevision) return;
        delivery.userError = new AppError("user_map_not_ready", message);
        userBinding = null;
        notifyMapReady();
      }})));
    reactRoot.render(createElement("div", {className: "geomcp-app-maps", key: revision}, ...maps));
    requestFullscreen();
  })().catch((error: unknown) => {
    if (controller.signal.aborted || tornDown || revision !== resultRevision) return;
    showError(error instanceof AppError ? error.message : "The Interactive map data could not be loaded. Open the map in a browser.");
  }).finally(() => {
    if (mapDataRequest === controller) mapDataRequest = null;
  });
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
  mapDelivery?.controller.abort(new AppError("ai_map_unavailable", "The map App has been released"));
  mapDataRequest?.abort();
  mapDataRequest = null;
  userBinding = null;
  revokeAiBinding();
  interactiveMapUrl = null;
  resizeObserver.disconnect();
  reactRoot.unmount();
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
void app.connect().then(() => {
  if (tornDown) return;
  appConnected = true;
  notifyMapReady();
  submitInitialAiImage();
  applyHostDimensions(app.getHostContext());
  requestFullscreen();
}).catch(() => { if (!tornDown) showError("This chat host could not initialize the map App."); });
