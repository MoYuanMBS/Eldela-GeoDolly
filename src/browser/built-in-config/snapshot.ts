/** 前端截图的内置编码质量；修改后重新构建 App，不作为部署配置传递。 */
export const SNAPSHOT_BUILT_IN_CONFIG = Object.freeze({
  // 浏览器 WebP quality 是有损编码质量；1 不代表无损。
  webpQuality: 0.95,
  webpMinQuality: 0.65,
  webpQualityStep: 0.15,
  // 先尝试 2K 内的等比缩图，最终兜底最长边不低于 640；小原图不放大。
  fallbackMaxSidePx: 2048,
  fallbackMinSidePx: 640
});
