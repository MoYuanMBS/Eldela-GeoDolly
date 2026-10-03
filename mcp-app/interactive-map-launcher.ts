/// <reference path="../src/browser/web/vite-env.d.ts" />

import {App, type McpUiHostContext} from "@modelcontextprotocol/ext-apps";
import {createElement} from "react";
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
import {interactiveMapDataSchema, mcpInteractiveMapDataSchema} from "../src/models/web/interactive-ui-models.js";
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

// 仅缩放整个展示区域；Leaflet 始终在后端给出的逻辑画布上确定初始 zoom。
function fitMapContent(): void {
  if (mapContent.offsetWidth === 0 || mapContent.offsetHeight === 0) return;
  const scale = Math.min(1, viewport.clientWidth / mapContent.offsetWidth, viewport.clientHeight / mapContent.offsetHeight);
  mapContent.style.transform = `translate(-50%, -50%) scale(${scale})`;
}

const resizeObserver = new ResizeObserver(fitMapContent);
resizeObserver.observe(viewport);
resizeObserver.observe(mapContent);

function showError(errorMessage: string): void {
  interactiveMapUrl = null;
  reactRoot.render(null);
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

const app = new App({name: `${GEOMCP_NAME} Interactive Map`, version: "2.0.0"}, {}, {autoResize: false});

app.ontoolresult = (result): void => {
  if (result.isError === true) {
    showError("The map tool returned an error. No Interactive map is available.");
    return;
  }
  try {
    const output = clientOutputSchema.parse(result._meta?.[INTERACTIVE_MAP_META_KEY]);
    const url = new URL(output.url);
    const expectedPath = `${publicBasePath}/session/${output.session_id}/interactive`;
    if (url.origin !== publicBaseUrl.origin || url.pathname !== expectedPath || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
      throw new AppError("invalid_app_map_url", "Interactive map URL does not match its session and App deployment");
    }
    const data = interactiveMapDataSchema.parse({
      ...output.map_data,
      map_payload: {...output.map_data.map_payload, leaflet: __GEOMCP_APP_LEAFLET__},
      style_payload: __GEOMCP_APP_STYLE__,
    });
    let tileMeta = document.querySelector<HTMLMetaElement>('meta[name="geomcp-basemap-base-url"]');
    if (tileMeta === null) {
      tileMeta = document.createElement("meta");
      tileMeta.name = "geomcp-basemap-base-url";
      document.head.append(tileMeta);
    }
    tileMeta.content = `${publicBaseUrl.origin}${publicBasePath}/basemap/${output.session_id}`;
    interactiveMapUrl = url.href;
    urlField.value = url.href;
    message.hidden = true;
    viewport.hidden = false;
    fallback.hidden = false;
    fallbackStatus.textContent = "Open or copy the map URL to view it in a browser.";
    rootElement.dataset.state = "ready";
    reactRoot.render(createElement(MapPage, {key: output.session_id, mapData: data, MapSurfaceComponent: MapSurfaceView}));
    requestFullscreen();
  } catch {
    showError("The map tool did not provide valid Interactive map data for this App.");
  }
};

// SDK 合并增量 context 后再读取，避免主题通知清除已有尺寸约束。
app.onhostcontextchanged = (): void => {
  applyHostDimensions(app.getHostContext());
  requestFullscreen();
};
app.onteardown = async () => {
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
  appConnected = true;
  applyHostDimensions(app.getHostContext());
  requestFullscreen();
}).catch(() => showError("This chat host could not initialize the Interactive map App."));
