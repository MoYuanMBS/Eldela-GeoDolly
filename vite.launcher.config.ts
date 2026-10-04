import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import react from "@vitejs/plugin-react";
import {defineConfig, type Plugin} from "vite";
import {GEOMCP_NAME} from "./src/shared/brand.js";
import {basemapConfigSchema, browserMapConfigSchema, iframeAdaptiveConfigSchema, leafletConfigSchema, uiConfigSchema} from "./src/models/backend/config-models.js";
import {config} from "./src/server/utils/config-loader.js";
import {initializeUserStyle} from "./src/server/utils/user-style/user-style-rule.js";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const iframeConfig = config.getAppSection("iframe_adaptive", iframeAdaptiveConfigSchema);
const browserConfig = config.getAppSection("browser_map", browserMapConfigSchema);
const basemapConfig = config.getAppSection("basemap", basemapConfigSchema);
const uiConfig = config.getAppSection("ui", uiConfigSchema);
const publicBaseUrl = config.getWebConfig().http.map.public_origin;
const userStyle = initializeUserStyle();
const logoDataUrl = "data:image/svg+xml;base64," + readFileSync(path.join(projectRoot, "assets", "logo", "graphic.svg")).toString("base64");

const inlineAppPlugin: Plugin = {
  name: "geomcp-inline-interactive-app",
  enforce: "post",
  generateBundle(_options, bundle) {
    const scripts: string[] = [];
    const styles: string[] = [];
    for (const output of Object.values(bundle)) {
      if (output.type === "chunk") scripts.push(output.code);
      else if (output.fileName.endsWith(".css")) styles.push(typeof output.source === "string" ? output.source : Buffer.from(output.source).toString("utf8"));
    }
    const escapedBaseUrl = publicBaseUrl.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    // Vite library 模式内联图片/字体；再把唯一 JS 和 CSS 装入 MCP 可直接读取的 HTML。
    const html = [
      '<!doctype html>',
      '<html lang="en">',
      '<head>',
      '  <meta charset="utf-8" />',
      '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
      '  <meta name="color-scheme" content="light dark" />',
      '  <meta name="geomcp-public-origin" content="' + escapedBaseUrl + '" />',
      '  <link rel="icon" type="image/svg+xml" sizes="any" href="' + logoDataUrl + '" />',
      '  <title>' + GEOMCP_NAME + '</title>',
      '  <style>' + styles.join("\n").replace(/<\/style/giu, "<\\/style"),
      '    html, body { width: 100%; min-width: 0; min-height: 0; margin: 0; overflow: hidden; }',
      '    body { height: 100%; }',
      '    #app-root { display: flex; width: 100%; max-height: 100%; min-width: 0; min-height: 0; margin: auto; flex-direction: column; }',
      '    #launcher-message { margin: auto; padding: 16px; text-align: center; }',
      '    #map-viewport { position: relative; flex: 1 1 auto; min-width: 0; min-height: 0; overflow: hidden; }',
      '    #map-content { position: absolute; left: 50%; top: 50%; width: max-content; padding: 24px; transform-origin: center; }',
      '    .geomcp-app-maps { display: flex; align-items: flex-start; gap: 24px; }',
      '    .geomcp-app-map-title { margin: 0 0 8px; font: 600 16px/1.4 system-ui, sans-serif; }',
      '    #map-fallback { display: grid; flex: 0 0 auto; grid-template-columns: auto minmax(0, 1fr) auto; gap: 6px; padding: 6px; align-items: center; font: 12px/1.4 system-ui, sans-serif; }',
      '    #map-url { min-width: 0; width: 100%; }',
      '    #fallback-status { grid-column: 1 / -1; color: GrayText; }',
      '    [hidden] { display: none !important; }',
      '  </style>',
      '</head>',
      '<body>',
      '  <main id="app-root" data-state="loading">',
      '    <p id="launcher-message" role="status">Waiting for the Interactive map…</p>',
      '    <div id="map-viewport" hidden><div id="map-content"></div></div>',
      '    <section id="map-fallback" aria-label="Interactive map fallback" hidden>',
      '      <button id="open-map" type="button">Open map</button>',
      '      <input id="map-url" type="text" readonly aria-label="Interactive map URL" />',
      '      <button id="copy-map-url" type="button">Copy</button>',
      '      <span id="fallback-status" role="status"></span>',
      '    </section>',
      '  </main>',
      '  <script>' + scripts.join("\n").replace(/<\/script/giu, "<\\/script") + '</script>',
      '</body>',
      '</html>',
    ].join("\n");
    this.emitFile({type: "asset", fileName: "interactive-map-launcher.html", source: html});
  },
};

export default defineConfig({
  plugins: [react(), inlineAppPlugin],
  css: {transformer: "lightningcss"},
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    __GEOMCP_MCP_APP__: "true",
    __GEOMCP_APP_BASE_URL__: JSON.stringify(publicBaseUrl),
    __GEOMCP_APP_LEAFLET__: JSON.stringify(config.getAppSection("leaflet", leafletConfigSchema)),
    __GEOMCP_APP_STYLE__: JSON.stringify({user_css: userStyle.css, user_rules: userStyle.rules}),
    __GEOMCP_IFRAME_MAX_WIDTH_PX__: JSON.stringify(uiConfig.iframe_max_width_px),
    __GEOMCP_IFRAME_MAX_HEIGHT_PX__: JSON.stringify(uiConfig.iframe_max_height_px),
    __GEOMCP_MAP_PADDING__: JSON.stringify(iframeConfig.padding),
    __GEOMCP_MAP_READY_TIMEOUT_MS__: JSON.stringify(browserConfig.ready_timeout_seconds * 1000),
    __GEOMCP_SNAPSHOT_MIN_TILE_SUCCESS_RATIO__: JSON.stringify(basemapConfig.snapshot_min_tile_success_ratio),
    __GEOMCP_DECORATIONS_ENABLED__: JSON.stringify(uiConfig.decorations_enabled),
    __GEOMCP_MAX_SCALE_WIDTH_PX__: JSON.stringify(uiConfig.max_scale_width_px),
    __GEOMCP_FEATURE_UI_MAX_HEIGHT_PX__: JSON.stringify(uiConfig.feature_ui_max_height_px),
    __GEOMCP_MEASUREMENT_PREVIEW_REFRESH_INTERVAL_MS__: JSON.stringify(uiConfig.measurement_preview_refresh_interval_ms),
  },
  build: {
    outDir: path.join(projectRoot, "dist", "mcp-apps"),
    emptyOutDir: true,
    minify: true,
    sourcemap: false,
    rolldownOptions: {output: {codeSplitting: false}},
    lib: {
      entry: path.join(projectRoot, "mcp-app", "interactive-map-launcher.ts"),
      name: "GeoMcpInteractiveMapLauncher",
      formats: ["iife"],
      fileName: "interactive-map-launcher",
    },
  },
});
