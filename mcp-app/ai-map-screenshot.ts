/// <reference path="../src/browser/web/vite-env.d.ts" />

import {snapdom} from "@zumer/snapdom";
import type {AiMapViewCommands} from "../src/browser/web/map-surface-port.js";
import type {AiMapViewType} from "../src/models/web/map-app-models.js";
import type {AiMapScreenshot} from "../src/models/web/snapshot-ui-models.js";
import {SNAPSHOT_BUILT_IN_CONFIG} from "../src/browser/built-in-config/snapshot.js";
import {AppError} from "../src/shared/app-error.js";

export interface AiMapCapturePort {
  commands: AiMapViewCommands;
  capture(view: AiMapViewType, signal: AbortSignal): Promise<AiMapScreenshot>;
}

function nextFrame(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = (): void => { cancelAnimationFrame(frame); reject(signal.reason); };
    const frame = requestAnimationFrame(() => { signal.removeEventListener("abort", abort); resolve(); });
    signal.addEventListener("abort", abort, {once: true});
  });
}

/** 单次捕获只返回图片或 warning；截图失败不调用页面的 fatal error，也不重拍。 */
export async function captureAiMapWebp(wrapper: HTMLElement, commands: AiMapViewCommands, view: AiMapViewType, signal: AbortSignal): Promise<AiMapScreenshot> {
  let stage = "viewport";
  let revision = 0;
  const mutations = new MutationObserver(() => { revision += 1; });
  const resize = new ResizeObserver(() => { revision += 1; });
  const requireCurrentView = (): void => {
    signal.throwIfAborted();
    if (!wrapper.isConnected || JSON.stringify(commands.getView()) !== JSON.stringify(view)) {
      throw new AppError("ai_map_view_changed", "The AI map changed during screenshot generation");
    }
  };
  try {
    requireCurrentView();
    const tileView = await commands.waitForScreenshot(signal);
    requireCurrentView();
    stage = "layout";
    const reference = wrapper.querySelector<HTMLElement>(".geomcp-reference-bar");
    const content = reference?.querySelector<HTMLElement>(".geomcp-reference-bar-content");
    if (reference === null || reference === undefined || content === null || content === undefined) throw new AppError("reference_ui_layout_failed", "AI map Reference UI is missing");
    mutations.observe(wrapper, {subtree: true, attributes: true, childList: true, characterData: true});
    resize.observe(wrapper);
    resize.observe(reference);
    resize.observe(content);
    let previousLayout = "";
    let width = 0;
    let height = 0;
    while (true) {
      await nextFrame(signal);
      requireCurrentView();
      const style = getComputedStyle(wrapper);
      width = Math.ceil(Number.parseFloat(style.width));
      height = Math.ceil(Number.parseFloat(style.height));
      const layout = `${width}/${height}/${revision}`;
      if (layout === previousLayout && reference.dataset.referenceUiStatus === "ready") break;
      previousLayout = layout;
    }
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) throw new AppError("screenshot_size_invalid", "AI map screenshot dimensions are invalid");
    if (content.offsetWidth > reference.clientWidth || content.offsetHeight > reference.clientHeight) throw new AppError("reference_ui_overflow", "AI map Reference UI overflowed its natural layout");
    if (width * height > __GEOMCP_SNAPSHOT_MAX_PIXELS__) throw new AppError("screenshot_pixel_budget", "AI map screenshot exceeds the configured pixel budget");
    const captureRevision = revision;
    let missingBusinessImage = false;
    let missingTiles = 0;
    // 地图 ready 后导出仍会重新读取图片；业务图标不得静默变成占位，底图沿用部分缺失策略。
    const tileImages = new Set<Element>(tileView.tiles);
    const onlineIcons = [...wrapper.querySelectorAll<SVGImageElement>("image.geomcp-user-overlay")].filter((icon) => !icon.getAttribute("href")?.startsWith("data:"));
    stage = "capture";
    const result = await snapdom(wrapper, {
      engine: "svg", width, height, dpr: 1, scale: 1, placeholders: true,
      exclude: (element) => element.classList.contains("leaflet-tile") && !tileImages.has(element),
      excludeMode: "remove",
      fallbackURL: ({element}) => {
        if (element?.classList.contains("leaflet-tile")) missingTiles += 1;
        else if (!element?.classList.contains("geomcp-ui-decoration")) missingBusinessImage = true;
        return "";
      }
    });
    requireCurrentView();
    if (missingBusinessImage) throw new AppError("screenshot_resource_failed", "A visible AI map image could not be embedded in the screenshot");
    if ((tileView.success_count - missingTiles) / tileView.total_count < tileView.required_ratio) {
      throw new AppError("screenshot_basemap_missing", "Too many basemap images could not be embedded in the screenshot");
    }
    // SnapDOM 的 HTML img fallback 不覆盖 SVG image；在线节点图标必须已内联，不能静默保留不可绘制的 URL。
    if (onlineIcons.length > 0) {
      const raw = result.toRaw();
      const svg = new DOMParser().parseFromString(decodeURIComponent(raw.slice(raw.indexOf(",") + 1)), "image/svg+xml");
      const icons = [...svg.querySelectorAll("image.geomcp-user-overlay")];
      if (svg.querySelector("parsererror") !== null || icons.length < onlineIcons.length || icons.some((icon) => !(icon.getAttribute("href") ?? icon.getAttribute("xlink:href"))?.startsWith("data:"))) {
        throw new AppError("screenshot_resource_failed", "An AI map SVG node icon could not be embedded in the screenshot");
      }
    }
    stage = "export";
    const image = await result.toWebp({quality: SNAPSHOT_BUILT_IN_CONFIG.webpQuality, backgroundColor: "#ffffff"});
    await image.decode();
    requireCurrentView();
    // 库内工作不能被 AbortSignal 强制停止；完成后丢弃超时、失效或布局已改变的产物，不启动重拍。
    revision += mutations.takeRecords().length;
    if (revision !== captureRevision) throw new AppError("screenshot_layout_changed", "AI map layout changed during screenshot generation");
    if (image.naturalWidth !== width || image.naturalHeight !== height) throw new AppError("screenshot_size_mismatch", "Exported AI map image dimensions do not match its logical layout");
    const match = /^data:image\/webp;base64,([A-Za-z0-9+/=]+)$/u.exec(image.src);
    if (match === null) throw new AppError("screenshot_format_invalid", "The browser did not export a WebP image");
    return {image: {type: "image", mimeType: "image/webp", data: match[1]}, warning: null};
  } catch (error) {
    const failure = AppError.fromUnknown(error, "ai_map_screenshot_failed", "AI map screenshot generation failed").toJSON();
    return {image: null, warning: {...failure, details: {stage, reason: failure.details ?? null}}};
  } finally {
    mutations.disconnect();
    resize.disconnect();
  }
}
