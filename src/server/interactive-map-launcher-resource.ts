import {readFileSync} from "node:fs";
import path from "node:path";

import type {McpUiResourceMeta} from "@modelcontextprotocol/ext-apps";
import {registerAppResource, RESOURCE_MIME_TYPE} from "@modelcontextprotocol/ext-apps/server";
import type {McpServer} from "@modelcontextprotocol/server";

import {GEOMCP_NAME} from "../shared/brand.js";
import {mcpAppsConfigSchema} from "../models/backend/config-models.js";
import {AppError} from "../shared/app-error.js";
import {config} from "./utils/config-loader.js";

export const INTERACTIVE_MAP_LAUNCHER_URI = "ui://geomcp/interactive-map-launcher/v1.html";

function readLauncherScript(): string {
  try {
    return readFileSync(path.resolve(process.cwd(), "dist", "mcp-apps", "interactive-map-launcher.iife.js"), "utf8");
  } catch (error) {
    throw AppError.fromUnknown(error, "mcp_app_build_not_found", "Interactive map launcher build could not be loaded");
  }
}

function readLogoDataUrl(): string {
  try {
    const logo = readFileSync(path.resolve(process.cwd(), "assets", "logo", "graphic.svg"));
    return `data:image/svg+xml;base64,${logo.toString("base64")}`;
  } catch (error) {
    throw AppError.fromUnknown(error, "mcp_app_logo_not_found", `${GEOMCP_NAME} logo could not be loaded`);
  }
}

function escapeHtmlAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function buildLauncherHtml(publicOrigin: string, script: string, logoDataUrl: string): string {
  const launcherConfig = config.getAppSection("mcp_apps", mcpAppsConfigSchema).interactive_map_launcher;
  const inlineScript = script.replace(/<\/script/giu, "<\\/script");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <link rel="icon" type="image/svg+xml" sizes="any" href="${escapeHtmlAttribute(logoDataUrl)}" />
    <title>${GEOMCP_NAME}</title>
    <meta name="geomcp-public-origin" content="${escapeHtmlAttribute(publicOrigin)}" />
    <meta name="geomcp-launcher-preferred-height-px" content="${launcherConfig.preferred_height_px}" />
    <meta name="geomcp-launcher-load-notice-delay-ms" content="${launcherConfig.load_notice_delay_ms}" />
    <style>
      :root { background: transparent; color: CanvasText; font: 13px/1.4 system-ui, sans-serif; }
      * { box-sizing: border-box; }
      html, body { width: 100%; min-width: 0; margin: 0; overflow: hidden; }
      body { height: 100%; }
      #app-root { display: flex; width: 100%; min-width: 0; min-height: 0; flex-direction: column; gap: 8px; padding: 0; }
      #launcher-message { margin: auto; padding: 16px; text-align: center; }
      #map-frame-shell { min-width: 0; min-height: 0; flex: 1 1 auto; overflow: hidden; border-radius: 8px; background: Canvas; }
      #interactive-map-frame { display: block; width: 100%; height: 100%; border: 0; background: Canvas; }
      #map-fallback { display: grid; min-width: 0; flex: 0 0 auto; grid-template-columns: auto minmax(0, 1fr) auto; gap: 6px; align-items: center; }
      #map-url { width: 100%; min-width: 0; padding: 6px 8px; border: 1px solid color-mix(in srgb, CanvasText 28%, transparent); border-radius: 5px; background: Canvas; color: CanvasText; }
      button { padding: 6px 10px; border: 1px solid color-mix(in srgb, CanvasText 28%, transparent); border-radius: 5px; background: ButtonFace; color: ButtonText; cursor: pointer; }
      button:focus-visible, #map-url:focus-visible { outline: 2px solid Highlight; outline-offset: 1px; }
      #fallback-status { grid-column: 1 / -1; min-height: 1.4em; color: GrayText; }
      [hidden] { display: none !important; }
    </style>
  </head>
  <body>
    <main id="app-root" data-state="loading">
      <p id="launcher-message" role="status">Waiting for the Interactive map…</p>
      <div id="map-frame-shell" hidden>
        <iframe id="interactive-map-frame" title="${GEOMCP_NAME} Interactive map"></iframe>
      </div>
      <section id="map-fallback" aria-label="Interactive map fallback" hidden>
        <button id="open-map" type="button">Open map</button>
        <input id="map-url" type="text" readonly aria-label="Interactive map URL" />
        <button id="copy-map-url" type="button">Copy</button>
        <span id="fallback-status" role="status"></span>
      </section>
    </main>
    <script>${inlineScript}</script>
  </body>
</html>`;
}

/** 注册只负责启动现有 Interactive 页面的轻量 MCP App Resource。 */
export function registerInteractiveMapLauncherResource(server: McpServer, publicOrigin: string): void {
  const html = buildLauncherHtml(publicOrigin, readLauncherScript(), readLogoDataUrl());
  const uiMeta = {
    prefersBorder: false,
    csp: {frameDomains: [new URL(publicOrigin).origin]},
    permissions: {clipboardWrite: {}},
  } satisfies McpUiResourceMeta;
  registerAppResource(server, `${GEOMCP_NAME} Interactive Map Launcher`, INTERACTIVE_MAP_LAUNCHER_URI, {
    description: `Launches the existing ${GEOMCP_NAME} Interactive map with a safe URL fallback.`,
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
