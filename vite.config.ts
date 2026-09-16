import path from "node:path";
import {fileURLToPath} from "node:url";
import react from "@vitejs/plugin-react";
import {defineConfig} from "vite";
import {basemapConfigSchema, browserMapConfigSchema, iframeAdaptiveConfigSchema, uiConfigSchema} from "./src/models/backend/config-models.js";
import {config} from "./src/utils/config-loader.js";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(projectRoot, "src", "web");
const iframeAdaptiveConfig = config.getAppSection("iframe_adaptive", iframeAdaptiveConfigSchema);
const browserMapConfig = config.getAppSection("browser_map", browserMapConfigSchema);
const uiConfig = config.getAppSection("ui", uiConfigSchema);
const basemapConfig = config.getAppSection("basemap", basemapConfigSchema);

export default defineConfig({
  root: webRoot,
  plugins: [react()],
  css: {
    transformer: "lightningcss",
  },
  define: {
    __GEOMCP_MAP_PADDING__: JSON.stringify(iframeAdaptiveConfig.padding),
    __GEOMCP_MAP_READY_TIMEOUT_MS__: JSON.stringify(browserMapConfig.ready_timeout_seconds * 1000),
    __GEOMCP_PROXY_TILE_TIMEOUT_MS__: JSON.stringify(browserMapConfig.proxy_tile_timeout_seconds * 1000),
    __GEOMCP_SNAPSHOT_MIN_TILE_SUCCESS_RATIO__: JSON.stringify(basemapConfig.snapshot_min_tile_success_ratio),
    __GEOMCP_DECORATIONS_ENABLED__: JSON.stringify(uiConfig.decorations_enabled),
    __GEOMCP_MAX_SCALE_WIDTH_PX__: JSON.stringify(uiConfig.max_scale_width_px),
    __GEOMCP_FEATURE_UI_MAX_HEIGHT_PX__: JSON.stringify(uiConfig.feature_ui_max_height_px),
    __GEOMCP_MEASUREMENT_PREVIEW_REFRESH_INTERVAL_MS__: JSON.stringify(uiConfig.measurement_preview_refresh_interval_ms),
  },
  server: {
    fs: {
      allow: [projectRoot],
    },
  },
  build: {
    outDir: path.join(projectRoot, "dist", "web"),
    emptyOutDir: true,
  },
});
