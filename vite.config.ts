import path from "node:path";
import {fileURLToPath} from "node:url";
import react from "@vitejs/plugin-react";
import {defineConfig} from "vite";
import {iframeAdaptiveConfigSchema} from "./src/models/config-models.js";
import {config} from "./src/utils/config-loader.js";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(projectRoot, "src", "web");
const iframeAdaptiveConfig = config.getAppSection("iframe_adaptive", iframeAdaptiveConfigSchema);

export default defineConfig({
  root: webRoot,
  plugins: [react()],
  css: {
    transformer: "lightningcss",
  },
  define: {
    __GEOMCP_MAP_PADDING__: JSON.stringify(iframeAdaptiveConfig.padding),
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
