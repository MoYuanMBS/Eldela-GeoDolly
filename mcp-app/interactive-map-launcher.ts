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
import type {AiMapViewCommands} from "../src/browser/web/map-surface-port.js";
import {AiMap} from "./ai-map.js";
import {registerAiMapTools} from "./register-tools.js";
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

let interactiveMapUrl: string | null = null;
let appConnected = false;
let fullscreenRequested = false;
// 代次对应一次结果交付；同 Session 重发也必须区分，以撤销上一轮初始化和迟到回调。
let resultRevision = 0;
let tornDown = false;
// 只保存当前已 ready 的 AI 命令；User 地图状态由自己的页面和 runtime 持有。
let aiBinding: {sessionId: string; commands: AiMapViewCommands} | null = null;

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
const {fitAiMapTool, setAiMapTool} = registerAiMapTools(app, () => aiBinding);

// 在取消异步初始化或释放地图前先撤销可调用入口，防止宿主继续使用上一轮命令。
function revokeAiBinding(): void {
  aiBinding = null;
  fitAiMapTool.disable();
  setAiMapTool.disable();
}

// URL 只接受当前部署和当前 Session 的固定路由，避免备用链接或视觉 URL 混入别处的数据。
function validateMapUrl(value: string, sessionId: string, routes: readonly string[]): URL {
  const url = new URL(value);
  if (url.origin !== publicBaseUrl.origin || !routes.some((route) => url.pathname === `${publicBasePath}/session/${sessionId}/${route}`) || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw new AppError("invalid_app_map_url", "Map URL does not match its session and App deployment");
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
  revokeAiBinding();
  // 同 Session 重发也必须同步撤销旧 effect，阻止迟到初始化和旧命令继续使用旧实例。
  flushSync(() => reactRoot.render(null));
  if (result.isError === true) {
    showError("The map tool returned an error. No Interactive map is available.");
    return;
  }
  try {
    const raw = result._meta?.[INTERACTIVE_MAP_META_KEY];
    let sessionId: string;
    let url: URL;
    let userData: InteractiveMapDataType;
    const maps: ReactNode[] = [];
    if (typeof raw === "object" && raw !== null && "data" in raw) {
      // 一次校验共享业务数据和 User 布局；AI 布局留给下方单独校验，使其失败只影响 AI 区域。
      const output = mapAppModels.mapAppResultSchema.parse(raw);
      const data = output.data;
      sessionId = data.session_id;
      url = validateMapUrl(output.user_payload.url, sessionId, ["interactive"]);
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
        } else {
          const layout = mapAppModels.aiMapAppPayloadSchema.parse(output.ai_payload);
          if (layout.url !== undefined) validateMapUrl(layout.url, sessionId, ["snapshot-interactive", "snapshot.webp"]);
          const aiData = {map_payload: assembleMapPayload(data, layout), style_payload: appStylePayload};
          const onAiViewCommandsChange = (commands: AiMapViewCommands | null): void => {
            // 旧实例的 ready 或 cleanup 可能迟到；仅当前代次能启用工具或撤销当前绑定。
            if (tornDown || revision !== resultRevision) return;
            if (commands === null) {
              revokeAiBinding();
            } else {
              aiBinding = {sessionId, commands};
              fitAiMapTool.enable();
              setAiMapTool.enable();
            }
          };
          maps.push(createElement("section", {key: "ai", "aria-label": "AI map"},
            createElement("h2", {className: "geomcp-app-map-title"}, "AI map"),
            createElement(AiMap, {mapData: aiData, onAiViewCommandsChange})));
        }
      } catch (error) {
        console.error("ai_map_delivery_invalid", error);
        maps.push(createElement("section", {key: "ai-error", className: "geomcp-map-page-state geomcp-map-page-error", role: "alert"}, "The tool did not provide valid AI map data. The User map is available."));
      }
    } else {
      // 旧后端仍只创建 User 地图；同样只校验一次，不复制已校验的 Overlay。
      const output = clientOutputSchema.parse(raw);
      sessionId = output.session_id;
      url = validateMapUrl(output.url, sessionId, ["interactive"]);
      userData = {
        ...output.map_data,
        map_payload: {...output.map_data.map_payload, leaflet: appLeafletConfig},
        style_payload: appStylePayload,
      };
    }
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
    maps.unshift(createElement("section", {key: "user", "aria-label": "User map"},
      createElement("h2", {className: "geomcp-app-map-title"}, "User map"),
      createElement(MapPage, {mapData: userData, MapSurfaceComponent: MapSurfaceView})));
    reactRoot.render(createElement("div", {className: "geomcp-app-maps", key: revision}, ...maps));
    requestFullscreen();
  } catch {
    showError("The map tool did not provide valid Interactive map data for this App.");
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
  applyHostDimensions(app.getHostContext());
  requestFullscreen();
}).catch(() => { if (!tornDown) showError("This chat host could not initialize the map App."); });
