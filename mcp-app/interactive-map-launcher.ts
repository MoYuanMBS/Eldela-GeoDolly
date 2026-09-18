import {App, type McpUiHostContext} from "@modelcontextprotocol/ext-apps";

const INTERACTIVE_MAP_META_KEY = "io.geomcp/interactiveMap";
const FINAL_SESSION_PATH_PATTERN = /^\/session\/\d{2}[0-9ab][0-9a-f]{8}-[1-9]\d*\/interactive$/u;

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Launcher element is missing: ${id}`);
  return element as T;
}

function readNumberMeta(name: string): number {
  const rawValue = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content;
  if (rawValue === undefined) throw new Error(`Launcher configuration is missing: ${name}`);
  return Number(rawValue);
}

const publicOriginMeta = document.querySelector<HTMLMetaElement>('meta[name="geomcp-public-origin"]');
if (publicOriginMeta === null) throw new Error("GeoMCP public origin metadata is missing");
const publicOrigin = new URL(publicOriginMeta.content).origin;
const preferredInlineHeightPx = readNumberMeta("geomcp-launcher-preferred-height-px");
const loadNoticeDelayMs = readNumberMeta("geomcp-launcher-load-notice-delay-ms");
const root = requireElement<HTMLElement>("app-root");
const message = requireElement<HTMLElement>("launcher-message");
const frameShell = requireElement<HTMLElement>("map-frame-shell");
const frame = requireElement<HTMLIFrameElement>("interactive-map-frame");
const fallback = requireElement<HTMLElement>("map-fallback");
const urlField = requireElement<HTMLInputElement>("map-url");
const openButton = requireElement<HTMLButtonElement>("open-map");
const copyButton = requireElement<HTMLButtonElement>("copy-map-url");
const fallbackStatus = requireElement<HTMLElement>("fallback-status");

let interactiveMapUrl: string | null = null;
let loadNoticeTimer: number | null = null;
let appConnected = false;

function clearLoadNotice(): void {
  if (loadNoticeTimer === null) return;
  window.clearTimeout(loadNoticeTimer);
  loadNoticeTimer = null;
}

function showError(errorMessage: string): void {
  clearLoadNotice();
  interactiveMapUrl = null;
  frame.removeAttribute("src");
  frameShell.hidden = true;
  fallback.hidden = true;
  root.dataset.state = "error";
  message.hidden = false;
  message.textContent = errorMessage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateInteractiveMapUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.origin !== publicOrigin || parsed.username !== "" || parsed.password !== "") return null;
    if (parsed.search !== "" || parsed.hash !== "" || !FINAL_SESSION_PATH_PATTERN.test(parsed.pathname)) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function showInteractiveMap(url: string): void {
  clearLoadNotice();
  interactiveMapUrl = url;
  urlField.value = url;
  frame.referrerPolicy = "no-referrer";
  frame.src = url;
  frameShell.hidden = false;
  fallback.hidden = false;
  message.hidden = true;
  fallbackStatus.textContent = "If the embedded map is unavailable, open or copy this URL.";
  root.dataset.state = "ready";
  loadNoticeTimer = window.setTimeout(() => {
    fallbackStatus.textContent = "If the map is blank or still loading, open it in a browser or copy the URL.";
  }, loadNoticeDelayMs);
}

function readInteractiveMapUrl(meta: unknown): string | null {
  if (!isRecord(meta)) return null;
  const clientOutput = meta[INTERACTIVE_MAP_META_KEY];
  if (!isRecord(clientOutput)) return null;
  return validateInteractiveMapUrl(clientOutput.url);
}

function positiveDimension(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function applyHostDimensions(context: McpUiHostContext | undefined): void {
  const dimensions = context?.containerDimensions;
  const fixedHeight = dimensions !== undefined && "height" in dimensions ? positiveDimension(dimensions.height) : null;
  if (fixedHeight !== null) {
    document.documentElement.style.height = "100%";
    root.style.height = "100%";
    return;
  }

  const maximumHeight = dimensions !== undefined && "maxHeight" in dimensions ? positiveDimension(dimensions.maxHeight) : null;
  const preferredHeight = maximumHeight === null ? preferredInlineHeightPx : Math.min(preferredInlineHeightPx, maximumHeight);
  document.documentElement.style.height = `${preferredHeight}px`;
  root.style.height = `${preferredHeight}px`;
  if (appConnected) void app.sendSizeChanged({height: preferredHeight}).catch(() => undefined);
}

function selectUrlForManualCopy(): void {
  urlField.focus();
  urlField.select();
  urlField.setSelectionRange(0, urlField.value.length);
}

const app = new App(
  {name: "GeoMCP Interactive Map Launcher", version: "1.0.0"},
  {},
  {autoResize: false},
);

app.ontoolresult = (result): void => {
  if (result.isError === true) {
    showError("The map tool returned an error. No Interactive map is available.");
    return;
  }
  const url = readInteractiveMapUrl(result._meta);
  if (url === null) {
    showError("The map tool did not provide a valid Interactive map URL.");
    return;
  }
  showInteractiveMap(url);
};

// SDK 会先把增量 context 合并进内部状态；读取完整状态可避免主题更新误清已有尺寸约束。
app.onhostcontextchanged = (): void => applyHostDimensions(app.getHostContext());

frame.addEventListener("load", () => {
  clearLoadNotice();
  fallbackStatus.textContent = "The map frame responded. If it is blank, use Open map or copy the URL.";
});

openButton.addEventListener("click", () => {
  void (async () => {
    const url = interactiveMapUrl;
    if (url === null) return;
    if (app.getHostCapabilities()?.openLinks === undefined) {
      selectUrlForManualCopy();
      fallbackStatus.textContent = "This chat host cannot open links. The URL is selected for manual copy.";
      return;
    }
    try {
      const result = await app.openLink({url});
      if (result.isError === true) {
        selectUrlForManualCopy();
        fallbackStatus.textContent = "The chat host declined to open the map. The URL is selected for manual copy.";
      }
    } catch {
      selectUrlForManualCopy();
      fallbackStatus.textContent = "The map could not be opened. The URL is selected for manual copy.";
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
      fallbackStatus.textContent = "The URL is selected. Copy it manually if clipboard access is unavailable.";
    }
  })();
});

applyHostDimensions(undefined);
void app.connect().then(() => {
  appConnected = true;
  applyHostDimensions(app.getHostContext());
}).catch(() => showError("This chat host could not initialize the Interactive map launcher."));
