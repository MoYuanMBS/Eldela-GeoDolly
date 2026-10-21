import {readFileSync} from "node:fs";
import path from "node:path";

import type {McpUiResourceMeta} from "@modelcontextprotocol/ext-apps";
import {registerAppResource, RESOURCE_MIME_TYPE} from "@modelcontextprotocol/ext-apps/server";
import type {McpServer} from "@modelcontextprotocol/server";

import {GEOMCP_NAME} from "../shared/brand.js";
import {finalSessionIdSchema} from "../models/backend/session-id-models.js";
import {AppError} from "../shared/app-error.js";
import {config} from "./utils/config-loader.js";

export const INTERACTIVE_MAP_LAUNCHER_URI = "ui://geomcp/interactive/map-launcher.html";

/** Legacy Host 从 content 读取完整外壳；只嵌入现有 User 网页，不依赖 App 的初始化消息。 */
export function createLegacyInteractiveMapResource(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError("invalid_interactive_map_url", "Interactive map URL is invalid");
  }
  const match = /\/session\/([^/]+)\/interactive$/u.exec(parsed.pathname);
  const sessionId = finalSessionIdSchema.safeParse(match?.[1]);
  const publicBaseUrl = config.getWebConfig().http.map.public_origin;
  if (!sessionId.success || parsed.href !== `${publicBaseUrl}/session/${encodeURIComponent(sessionId.data)}/interactive`) {
    throw new AppError("invalid_interactive_map_url", "Interactive map URL is invalid");
  }
  const safeUrl = parsed.href.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return {
    type: "resource" as const,
    resource: {
      uri: `ui://geomcp/interactive-map-legacy/${sessionId.data}.html`,
      mimeType: "text/html",
      text: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${GEOMCP_NAME} Interactive map</title>
    <style>
      body { margin: 0; font: 13px/1.4 system-ui, sans-serif; }
      iframe { display: block; width: 100%; height: 600px; border: 0; }
      nav { display: flex; gap: 8px; padding: 8px; }
      input { flex: 1; min-width: 0; }
    </style>
  </head>
  <body>
    <iframe src="${safeUrl}" title="${GEOMCP_NAME} Interactive map" referrerpolicy="no-referrer"></iframe>
    <nav aria-label="Interactive map fallback">
      <a href="${safeUrl}" target="_blank" rel="noopener noreferrer">Open map</a>
      <input id="map-url" type="text" value="${safeUrl}" readonly aria-label="Interactive map URL" />
      <button id="copy-map-url" type="button">Copy</button>
    </nav>
    <script>
      document.getElementById("copy-map-url").addEventListener("click", async () => {
        const field = document.getElementById("map-url");
        field.focus();
        field.select();
        try { await navigator.clipboard.writeText(field.value); } catch { /* selected for manual copy */ }
      });
    </script>
  </body>
</html>`
    }
  };
}

/** App 的配置、样式和资源在 Vite 构建时冻结，后端只发布已经构建好的 HTML。 */
export function registerInteractiveMapLauncherResource(server: McpServer, publicOrigin: string): void {
  let html: string;
  try {
    html = readFileSync(path.resolve(process.cwd(), "dist", "mcp-apps", "interactive-map-launcher.html"), "utf8");
  } catch (error) {
    throw AppError.fromUnknown(error, "mcp_app_build_not_found", "Interactive map App build could not be loaded");
  }
  const escapedPublicOrigin = publicOrigin.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  if (!html.includes('<meta name="geomcp-public-origin" content="' + escapedPublicOrigin + '" />')) {
    throw new AppError("mcp_app_build_origin_mismatch", "Rebuild the Interactive map App for the configured public origin");
  }
  const uiMeta = {
    prefersBorder: false,
    csp: {resourceDomains: [new URL(publicOrigin).origin], connectDomains: [new URL(publicOrigin).origin]},
    permissions: {clipboardWrite: {}},
  } satisfies McpUiResourceMeta;
  registerAppResource(server, `${GEOMCP_NAME} Interactive Map`, INTERACTIVE_MAP_LAUNCHER_URI, {
    description: `Renders the ${GEOMCP_NAME} User map, feature details and measurement tools, with a link to open the map in a browser.`,
    _meta: {ui: uiMeta},
  }, async () => ({
    contents: [{
      uri: INTERACTIVE_MAP_LAUNCHER_URI,
      mimeType: RESOURCE_MIME_TYPE,
      text: html,
      _meta: {ui: uiMeta},
    }],
  }));
}
