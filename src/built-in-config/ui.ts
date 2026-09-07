/**
 * 固定地图页面的内置 UI 参数；该模块不读取或依赖 Leaflet runtime。
 *
 * 这些值属于 UI 实现约束，不通过部署配置或 config loader 覆盖。
 */

export const UI_BUILT_IN_CONFIG = {
  // 地图、Popup、Feature Bar 的外框共用线宽；内部 divider 保持独立。
  frameBorderWidthPx: 1.5,
  referenceUi: {
    minWidth: 600,
    minHeight: 50,
  },
  standardUi: {
    minWidth: 600,
    minHeight: 50,
    endBlockRatio: 0.02,
    liveFeatureMinWidth: 160,
    dividerWidth: 32,
    emptyPrompt: "Hover or select a feature",
    // 新素材已收紧画板；仅横向拉伸整幅 stander-end，不再放大后裁出局部。
    barEndSourceWidthPx: 32,
    barEndHeightPx: 3,
  },
  featureBar: {
    gapPx: 6,
  },
  popup: {
    // Popup 优先使用窄布局；长单词只在该区间内推动卡片扩宽，超过上限后换行。
    minWidthPx: 240,
    maxWidthPx: 320,
    minHeightPx: 160,
    maxHeightPx: 480,
  },
  toolbar: {
    minWidth: 600,
    minHeight: 50,
    // 三段背景使用实际栏宽；body 高度由按钮行数和行高决定，端帽保持素材比例。
    widthPx: 40,
    controlHeightPx: 34,
    leftOffsetPx: 15,
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
