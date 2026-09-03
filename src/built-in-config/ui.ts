/**
 * 固定地图页面的内置 UI 参数；该模块不读取或依赖 Leaflet runtime。
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
    emptyPrompt: "Hover or select a feature",
    // ui-bar-end.svg 保持素材原始纵向尺寸，只按 MapSurface 宽度计算横向 placement scale。
    barEndSourceWidthPx: 142.08,
    barEndVisibleWidthPx: 69.8592,
    barEndHeightPx: 73.2,
  },
  featureBar: {
    gapPx: 6,
  },
  popup: {
    // Feature/Measurement 共用固定宽度；长值换行，大量 records 只滚动内容区。
    widthPx: 280,
    minHeightPx: 160,
    maxHeightPx: 480,
  },
  toolbar: {
    minWidth: 600,
    minHeight: 50,
    // Toolbar 背景、控制槽、divider 和 icon 按同一个外框比例一起缩放。
    widthPx: 96,
    heightPx: 151,
    leftOffsetPx: -13,
  },
  attribution: {
    separator: " | ",
    references: {
      tool: {
        attribution: "GeoMCP",
        // 当前没有公开落地页；保留可空链接接口，不制造假 URL。
        attribution_url: null,
      },
      leaflet: {
        attribution: "Leaflet",
        attribution_url: "https://leafletjs.com/"
      },
      osmData: {
        attribution: "© OpenStreetMap contributors",
        attribution_url: "https://www.openstreetmap.org/copyright"
      },
    },
  },
} as const;
