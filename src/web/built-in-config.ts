/**
 * 固定地图页面的内置 UI 参数。
 *
 * 这些值属于 UI 实现约束，不通过部署配置或 config loader 覆盖。
 */

export const UI_BUILT_IN_CONFIG = {
  referenceUi: {
    minWidth: 600,
    minHeight: 50,
  },
  standardUi: {
    minWidth: 600,
    minHeight: 50,
    endBlockRatio: 0.065,
    liveFeatureMinWidth: 160,
    dividerWidth: 32,
  },
  featureBar: {
    gapPx: 6,
  },
  toolbar: {
    minWidth: 600,
    minHeight: 50,
  },
} as const;
