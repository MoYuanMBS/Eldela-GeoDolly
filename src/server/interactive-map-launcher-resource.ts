import {readFileSync} from "node:fs";
import path from "node:path";

import type {McpUiResourceMeta} from "@modelcontextprotocol/ext-apps";
import {registerAppResource, RESOURCE_MIME_TYPE} from "@modelcontextprotocol/ext-apps/server";
import type {McpServer} from "@modelcontextprotocol/server";

import {GEOMCP_NAME} from "../shared/brand.js";
import {AppError} from "../shared/app-error.js";

export const INTERACTIVE_MAP_LAUNCHER_URI = "ui://geomcp/interactive/map-launcher.html";

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
    description: `Renders the ${GEOMCP_NAME} User map and measurement tools alongside an independent AI map with viewport tools in the host.`,
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
