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

function encodeWebp(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new AppError("screenshot_encode_failed", "The browser could not encode the AI map image"));
      else if (blob.type !== "image/webp") reject(new AppError("screenshot_format_invalid", "The browser did not export a WebP image"));
      else resolve(blob);
    }, "image/webp", quality);
  });
}

async function readWebpBase64(blob: Blob, width: number, height: number): Promise<string> {
  // MIME 不能区分 VP8/VP8L/Alpha；只接受静态有损 VP8（8-bit YUV420），并核对编码尺寸。
  const bytes = new DataView(await blob.arrayBuffer());
  const fourCC = (offset: number): string => String.fromCharCode(bytes.getUint8(offset), bytes.getUint8(offset + 1), bytes.getUint8(offset + 2), bytes.getUint8(offset + 3));
  const invalid = (): AppError => new AppError("screenshot_format_invalid", "The browser did not export an opaque lossy WebP image with the expected dimensions");
  if (bytes.byteLength < 12 || fourCC(0) !== "RIFF" || fourCC(8) !== "WEBP" || bytes.getUint32(4, true) + 8 !== bytes.byteLength) throw invalid();
  let offset = 12;
  let hasVp8 = false;
  while (offset + 8 <= bytes.byteLength) {
    const kind = fourCC(offset);
    const size = bytes.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + size > bytes.byteLength || kind === "ALPH" || kind === "VP8L" || kind === "ANIM" || kind === "ANMF") throw invalid();
    if (kind === "VP8X" && (size < 10 || (bytes.getUint8(start) & 0x12) !== 0)) throw invalid();
    if (kind === "VP8 ") {
      if (hasVp8 || size < 10 || (bytes.getUint8(start) & 1) !== 0 || bytes.getUint8(start + 3) !== 0x9d || bytes.getUint8(start + 4) !== 0x01 || bytes.getUint8(start + 5) !== 0x2a) throw invalid();
      if ((bytes.getUint16(start + 6, true) & 0x3fff) !== width || (bytes.getUint16(start + 8, true) & 0x3fff) !== height) throw invalid();
      hasVp8 = true;
    }
    offset = start + size + (size & 1);
  }
  if (!hasVp8 || offset !== bytes.byteLength) throw invalid();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new AppError("screenshot_encode_failed", "The encoded AI map image could not be read"));
    reader.onload = () => {
      const match = typeof reader.result === "string" ? /^data:image\/webp;base64,([A-Za-z0-9+/=]+)$/u.exec(reader.result) : null;
      if (match === null) reject(invalid());
      else resolve(match[1]);
    };
    reader.readAsDataURL(blob);
  });
}

/** 单次捕获只返回图片或 warning；截图失败不调用页面的 fatal error，也不重拍。 */
export async function captureAiMapWebp(wrapper: HTMLElement, commands: AiMapViewCommands, view: AiMapViewType, signal: AbortSignal): Promise<AiMapScreenshot> {
  let stage = "viewport";
  let revision = 0;
  let originalCanvas: HTMLCanvasElement | null = null;
  let scaledCanvas: HTMLCanvasElement | null = null;
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
    const requireCurrentCapture = (): void => {
      requireCurrentView();
      revision += mutations.takeRecords().length;
      if (revision !== captureRevision) throw new AppError("screenshot_layout_changed", "AI map layout changed during screenshot generation");
    };
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
    // DOM 只捕获一次；toCanvas 先合成不透明白底，后续编码/缩放始终读取这张原始图。
    originalCanvas = await result.toCanvas({backgroundColor: "#ffffff"});
    requireCurrentCapture();
    if (originalCanvas.width !== width || originalCanvas.height !== height) throw new AppError("screenshot_size_mismatch", "Captured AI map image dimensions do not match its logical layout");
    const originalSide = Math.max(width, height);
    const minimumSide = Math.min(originalSide, SNAPSHOT_BUILT_IN_CONFIG.fallbackMinSidePx);
    // 为 JSON/协议包装留出余量；所有候选仍按最终 Base64 长度执行严格硬上限检查。
    const targetBytes = Math.floor(__GEOMCP_SNAPSHOT_MAX_BASE64_BYTES__ * 0.97 / 4) * 3;
    let longSide = originalSide;
    let quality: number = SNAPSHOT_BUILT_IN_CONFIG.webpQuality;
    let retries = 0;
    let finalFallback = false;
    let encoded: Blob;
    let outputWidth = width;
    let outputHeight = height;
    while (true) {
      requireCurrentCapture();
      let canvas = originalCanvas;
      outputWidth = Math.max(1, Math.round(width * longSide / originalSide));
      outputHeight = Math.max(1, Math.round(height * longSide / originalSide));
      if (longSide < originalSide) {
        scaledCanvas ??= document.createElement("canvas");
        scaledCanvas.width = outputWidth;
        scaledCanvas.height = outputHeight;
        const context = scaledCanvas.getContext("2d", {alpha: false});
        if (context === null) throw new AppError("screenshot_canvas_failed", "The browser could not resize the AI map image");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, outputWidth, outputHeight);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(originalCanvas, 0, 0, outputWidth, outputHeight);
        canvas = scaledCanvas;
      }
      encoded = await encodeWebp(canvas, quality);
      requireCurrentCapture();
      if (encoded.size <= targetBytes && 4 * Math.ceil(encoded.size / 3) < __GEOMCP_SNAPSHOT_MAX_BASE64_BYTES__) break;
      if (finalFallback || (longSide === minimumSide && quality === SNAPSHOT_BUILT_IN_CONFIG.webpMinQuality)) {
        throw new AppError("screenshot_byte_budget", "The AI map image still exceeds the encoded size budget at its minimum resolution", {max_base64_bytes: __GEOMCP_SNAPSHOT_MAX_BASE64_BYTES__, encoded_bytes: encoded.size, width: outputWidth, height: outputHeight});
      }
      // 先保留原尺寸降质量，再按体积估算等比缩图；质量/缩放共享有限重试次数。
      if (retries < __GEOMCP_SNAPSHOT_MAX_ENCODE_RETRIES__) {
        retries += 1;
        if (quality > SNAPSHOT_BUILT_IN_CONFIG.webpMinQuality) {
          quality = Math.max(SNAPSHOT_BUILT_IN_CONFIG.webpMinQuality, quality - SNAPSHOT_BUILT_IN_CONFIG.webpQualityStep);
        } else {
          longSide = Math.max(minimumSide, Math.min(SNAPSHOT_BUILT_IN_CONFIG.fallbackMaxSidePx, Math.floor(longSide * Math.sqrt(targetBytes / encoded.size) * 0.9)));
          quality = SNAPSHOT_BUILT_IN_CONFIG.webpQuality;
        }
      } else {
        // 耗尽重试后只再尝试一次 640px；不放大小原图，不延长原作业超时。
        finalFallback = true;
        longSide = minimumSide;
        quality = SNAPSHOT_BUILT_IN_CONFIG.webpMinQuality;
      }
    }
    const data = await readWebpBase64(encoded, outputWidth, outputHeight);
    requireCurrentCapture();
    if (data.length >= __GEOMCP_SNAPSHOT_MAX_BASE64_BYTES__) throw new AppError("screenshot_byte_budget", "The AI map image exceeds the Base64 size budget");
    const image = new Image();
    image.src = "data:image/webp;base64," + data;
    await image.decode();
    requireCurrentCapture();
    // 库内工作不能被 AbortSignal 强制停止；完成后丢弃超时、失效或布局已改变的产物，不启动重拍。
    if (image.naturalWidth !== outputWidth || image.naturalHeight !== outputHeight) throw new AppError("screenshot_size_mismatch", "Exported AI map image dimensions do not match its encoded size");
    return {image: {type: "image", mimeType: "image/webp", data}, warning: null};
  } catch (error) {
    const failure = AppError.fromUnknown(error, "ai_map_screenshot_failed", "AI map screenshot generation failed").toJSON();
    return {image: null, warning: {...failure, details: {stage, reason: failure.details ?? null}}};
  } finally {
    mutations.disconnect();
    resize.disconnect();
    // 本次编码真正结束后再释放像素缓冲；超时回复不会提前回收仍在编码的 Canvas。
    if (originalCanvas !== null) originalCanvas.width = originalCanvas.height = 0;
    if (scaledCanvas !== null) scaledCanvas.width = scaledCanvas.height = 0;
  }
}
