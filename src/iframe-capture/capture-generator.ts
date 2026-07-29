/**
 * 根据 Python 提供的权威 bbox 与面积倍率生成纯地图截图尺寸。
 *
 * bbox 使用标准 GIS 顺序 (west, south, east, north)；输出不包含 attribution footer。
 */

import type {BBoxType} from "../models/map-data-models.js";
import {iframeCaptureConfigSchema, type IframeCaptureConfigType} from "../models/config-models.js";
import {config} from "../utils/config-loader.js";

// Leaflet CRS.EPSG3857 使用的纬度上限；超过后会投影到同一极区边界。
const MAX_MERCATOR_LATITUDE = 85.0511287798066;

/** 将纬度换算为 EPSG:3857 的归一化 world Y，不依赖具体 tile size 或 zoom。 */
function projectLatitude(latitude: number): number {
  // Leaflet EPSG:3857 会在投影前截断极区纬度，避免 Mercator 在两极发散。
  const clampedLatitude = Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, latitude));
  const sinLatitude = Math.sin(clampedLatitude * Math.PI / 180);
  return 0.5 - Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI);
}

/**
 * 在 Leaflet 投影空间中计算 bbox 宽高比。
 * 经纬度比例不能直接使用，因为 Mercator 的纬向尺度会随纬度发生非线性变化。
 */
function getProjectedAspectRatio(bbox: BBoxType): number {
  const [west, south, east, north] = bbox;
  const projectedWest = (west + 180) / 360;
  let projectedEast = (east + 180) / 360;
  if (east < west) projectedEast += 1; // 日期变更线 bbox 在 west 右侧的连续世界副本中计算。
  const projectedWidth = projectedEast - projectedWest;
  const projectedHeight = Math.abs(projectLatitude(south) - projectLatitude(north));
  return projectedWidth / projectedHeight;
}

/**
 * 将连续宽高一次性整数化，并在 ceil 触发安全上限时保持比例回缩。
 * 最后复查所有硬约束，避免浮点误差产生越界的截图任务。
 */
function finalizeIntegerSize(width: number, height: number, captureConfig: IframeCaptureConfigType): [number, number] {
  let screenshotWidth = Math.ceil(width);
  let screenshotHeight = Math.ceil(height);
  if (screenshotWidth > captureConfig.max_screenshot_width || screenshotHeight > captureConfig.max_screenshot_height || screenshotWidth * screenshotHeight > captureConfig.max_screenshot_pixels) {
    // ceil 单独越界时仍按统一比例回缩，再同时 floor，避免只减一边破坏比例。
    const roundingScale = Math.min(
      1,
      captureConfig.max_screenshot_width / width,
      captureConfig.max_screenshot_height / height,
      Math.sqrt(captureConfig.max_screenshot_pixels / (width * height)),
    );
    screenshotWidth = Math.floor(width * roundingScale);
    screenshotHeight = Math.floor(height * roundingScale);
  }
  const belowMinimum = screenshotWidth < captureConfig.min_screenshot_width || screenshotHeight < captureConfig.min_screenshot_height;
  const aboveMaximum = screenshotWidth > captureConfig.max_screenshot_width || screenshotHeight > captureConfig.max_screenshot_height;
  if (belowMinimum || aboveMaximum || screenshotWidth * screenshotHeight > captureConfig.max_screenshot_pixels) {
    throw new Error("capture constraints cannot produce a legal integer screenshot size");
  }
  // 固定返回 [screenshotWidth, screenshotHeight]，两项均为 MapSurface 的 CSS 整数像素。
  return [screenshotWidth, screenshotHeight];
}

/**
 * 生成纯地图 MapSurface 的逻辑截图尺寸。
 *
 * @param bbox Python pipeline 确定的权威 bbox，顺序为 (west, south, east, north)
 * @param recommendedViewportAreaFactor Python 根据 bbox 面积和 Overlay 复杂度合成的面积倍率
 * @returns [screenshotWidth, screenshotHeight]，两项均为不含 attribution footer 的整数
 */
export function generateCaptureSize(bbox: BBoxType, recommendedViewportAreaFactor: number): [number, number] {
  // loader 缓存通过 schema 格式化后的 section，重复生成截图时不会重复读取 YAML。
  const captureConfig = config.getAppSection("iframe_adaptive", iframeCaptureConfigSchema);
  const projectedAspectRatio = getProjectedAspectRatio(bbox);
  // 极端 bbox 只限制画布比例，不裁切或改写权威 bbox。
  const usedAspectRatio = Math.max(captureConfig.min_aspect_ratio, Math.min(captureConfig.max_aspect_ratio, projectedAspectRatio));
  // 面积和宽高比共同唯一确定连续候选尺寸，此处不能提前分别取整。
  const targetArea = captureConfig.reference_screenshot_area * recommendedViewportAreaFactor;
  const candidateWidth = Math.sqrt(targetArea * usedAspectRatio);
  const candidateHeight = Math.sqrt(targetArea / usedAspectRatio);

  // 最小限制只允许统一放大，保证宽高比保持不变。
  const minimumScale = Math.max(1, captureConfig.min_screenshot_width / candidateWidth, captureConfig.min_screenshot_height / candidateHeight);
  const minimumWidth = candidateWidth * minimumScale;
  const minimumHeight = candidateHeight * minimumScale;
  // 最大边界优先于建议面积，因此超限时按同一个比例缩小两边。
  const boxScale = Math.min(1, captureConfig.max_screenshot_width / minimumWidth, captureConfig.max_screenshot_height / minimumHeight);
  let constrainedWidth = minimumWidth * boxScale;
  let constrainedHeight = minimumHeight * boxScale;
  // 总像素预算独立于 max box，再次统一缩放以约束最坏渲染成本。
  if (constrainedWidth * constrainedHeight > captureConfig.max_screenshot_pixels) {
    const pixelScale = Math.sqrt(captureConfig.max_screenshot_pixels / (constrainedWidth * constrainedHeight));
    constrainedWidth *= pixelScale;
    constrainedHeight *= pixelScale;
  }
  return finalizeIntegerSize(constrainedWidth, constrainedHeight, captureConfig);
}
