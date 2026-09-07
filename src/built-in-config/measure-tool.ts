/**
 * Measure Tool 的内建交互参数。这些值只描述固定产品手感和 Leaflet 层级，
 * 不是部署环境参数；高频预览间隔仍由 app.yaml/ui 提供。
 */
export const MEASURE_TOOL_BUILT_IN_CONFIG = Object.freeze({
  // 闭合判断使用当前 CSS 像素，仅在 finalize 时读取，不进入测地计算。
  pathCloseSnapThresholdPx: 8,
  // 连续点击落在半像素内视为同一点，避免双击事件产生重复末点。
  duplicateVertexThresholdPx: 0.5,
  panes: Object.freeze({
    // label 独立于 Canvas 排序且不参与命中；delete 始终位于测量各层之上。
    visual: Object.freeze({name: "measurement-visual", zIndex: 485}),
    hit: Object.freeze({name: "measurement-hit", zIndex: 500}),
    label: Object.freeze({name: "measurement-label", zIndex: 505}),
    deleteMarker: Object.freeze({name: "measurement-delete", zIndex: 510}),
  }),
  visual: Object.freeze({
    weightPx: 3,
    hoverWeightPx: 4,
    selectedWeightPx: 5,
    innerBandWidthPx: 8,
    // 较长的 dash/gap 让地图缩放后仍保持清晰、稀疏的测量轮廓。
    dashArray: "12 10",
    draftOpacity: 0.82,
  }),
  // 与 Overlay node-default 使用同一组双圆尺寸，只替换为 Measure/UI 色板。
  vertex: Object.freeze({outerRadiusPx: 5, centerRadiusPx: 1.5, outerStrokeWidthPx: 1.5}),
  hit: Object.freeze({lineWidthPx: 16, circleWidthPx: 16}),
  // DivIcon 与原生 button 共用尺寸，CSS 内部 SVG 只比该命中框小 2px。
  deleteMarkerSizePx: 26,
  // 屏幕像素留白，不随地图 zoom 放大，也不进入测地计算。
  deleteMarkerGapPx: 4,
  labelGapPx: 6,
  circle: Object.freeze({
    coarseSampleCount: 256,
    fineSampleCount: 512,
  }),
} as const);
