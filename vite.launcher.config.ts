import path from "node:path";
import {fileURLToPath} from "node:url";
import {defineConfig} from "vite";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    outDir: path.join(projectRoot, "dist", "mcp-apps"),
    emptyOutDir: true,
    minify: true,
    sourcemap: false,
    lib: {
      entry: path.join(projectRoot, "mcp-app", "interactive-map-launcher.ts"),
      name: "GeoMcpInteractiveMapLauncher",
      formats: ["iife"],
      fileName: "interactive-map-launcher",
    },
  },
});
