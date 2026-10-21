/// <reference path="../src/browser/web/vite-env.d.ts" />

import {App, McpUiToolResultNotificationSchema, type McpUiHostContext} from "@modelcontextprotocol/ext-apps";
import {createElement} from "react";
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
import {mcpInteractiveMapDataSchema, type InteractiveMapDataType, type McpInteractiveMapDataType} from "../src/models/web/interactive-ui-models.js";
import * as mapAppModels from "../src/models/web/map-app-models.js";
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
let mapDataRequest: AbortController | null = null;
// 仅缩放整个展示区域；Leaflet 始终在后端给出的逻辑画布上确定初始 zoom。
function fitMapContent(): void {
  if (mapContent.offsetWidth === 0 || mapContent.offsetHeight === 0) return;
  const scale = Math.min(1, viewport.clientWidth / mapContent.offsetWidth, viewport.clientHeight / mapContent.offsetHeight);
  mapContent.style.transform = `translate(-50%, -50%) scale(${scale})`;
}

const resizeObserver = new ResizeObserver(fitMapContent);
resizeObserver.observe(viewport);
resizeObserver.observe(mapContent);

// 交付或初始化失败时释放本次 User 地图，并保留浏览器打开入口。
function showError(errorMessage: string): void {
  resultRevision += 1;
  mapDataRequest?.abort();
  mapDataRequest = null;
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

const app = new App({name: `${GEOMCP_NAME} Map`, version: "2.0.0"}, {}, {autoResize: false});
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

app.ontoolresult = (result): void => {
  if (tornDown) return;
  const revision = ++resultRevision;
  mapDataRequest?.abort();
  mapDataRequest = null;
  interactiveMapUrl = null;
  urlField.value = "";
  viewport.hidden = true;
  fallback.hidden = true;
  message.hidden = false;
  message.textContent = "Loading the Interactive map…";
  rootElement.dataset.state = "loading";
  // 同 Session 重发也同步撤销旧 effect，阻止迟到初始化覆盖当前地图。
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
  interactiveMapUrl = `${publicBaseUrl.origin}${publicBasePath}/session/${encodeURIComponent(sessionId)}/interactive`;
  urlField.value = interactiveMapUrl;
  fallback.hidden = false;
  fallbackStatus.textContent = "Open or copy the map URL to view it in a browser.";
  const controller = new AbortController();
  mapDataRequest = controller;
  void (async () => {
    const data = await loadMapData(sessionId, controller.signal);
    // 取消请求仍可能已有响应；同 Session 的旧结果也不能覆盖新地图。
    if (controller.signal.aborted || tornDown || revision !== resultRevision) return;
    const userData: InteractiveMapDataType = {
      ...data,
      map_payload: {...data.map_payload, leaflet: appLeafletConfig},
      style_payload: appStylePayload,
    };
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
    reactRoot.render(createElement("section", {key: revision, "aria-label": "User map"},
      createElement("h2", {className: "geomcp-app-map-title"}, "User map"),
      createElement(MapPage, {mapData: userData, MapSurfaceComponent: MapSurfaceView})));
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
  // 先拒绝后续通知和迟到 connect，再卸载 User 地图；后端 AI 生命周期独立。
  tornDown = true;
  resultRevision += 1;
  mapDataRequest?.abort();
  mapDataRequest = null;
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
  applyHostDimensions(app.getHostContext());
  requestFullscreen();
}).catch(() => { if (!tornDown) showError("This chat host could not initialize the map App."); });
