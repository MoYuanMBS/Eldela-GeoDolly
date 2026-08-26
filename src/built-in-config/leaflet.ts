/**
 * Leaflet renderer 的内建视觉常量。
 *
 * 这里集中保存不准备作为部署选项公开、但调试视觉结果时需要统一查看的稳定值。它们属于
 * renderer 实现契约，修改时应同时核对 pane 覆盖顺序、标签碰撞和 CSS geometry seed 的语义。
 * 对象只包含浏览器安全的原始数据；导入本文件不会连带加载 Leaflet、DOM 或用户配置。
 */
/** UI 使用原始大小写；Proxy namespace 在拼接时从同一常量转换为小写。 */
export const GEOMCP_NAME = "GeoMCP";

export const LEAFLET_INTERNAL_RENDER_CONFIG = Object.freeze({
  /**
   * Leaflet pane 按生命周期拆分。Snapshot 只读取 visual；Interactive attach 时才读取
   * interaction，避免共享 Visual 初始化隐式创建透明命中层所需的 pane。
   */
  panes: Object.freeze({
    visual: Object.freeze({
      // 面积填充最先铺底，避免覆盖道路和点。
      areaBase: 410,
      // Area translucent/addon 位于自身 Base 上方、Way 下方。
      areaSpecial: 420,
      // 道路主体与 casing 的基础绘制层。
      wayBase: 430,
      // Way bridge/tunnel/translucent 等附加绘制层。
      waySpecial: 440,
      // Node 主体高于线和面。
      nodeBase: 450,
      // Node 附加绘制仍保持在所有基础几何之上。
      nodeSpecial: 460,
      // 固定 relation membership 覆盖三类基础几何，但不参与交互。
      relationMembership: 470,
      // 独立 Core 视觉高于普通 Relation membership，但仍位于 Label 下方。
      coreOverlay: 475,
      // 单 Canvas 标签层位于全部空间视觉层上方。
      labels: 480,
    }),
    interaction: Object.freeze({
      name: "interaction" as const,
      // 唯一透明命中层必须最后绘制，确保 pointer hit 不受视觉层 DOM 顺序干扰。
      zIndex: 490,
    }),
  }),
  /** Label Canvas 的排版与视觉常量，全部尺寸均为 CSS 逻辑像素，不乘设备 DPR。 */
  label: Object.freeze({
    // @font-face 内部名称；必须与 src/leaflet/styles/leaflet-font.css 保持一致。
    fontFaceFamily: "GeoMCP Source Han Sans",
    // Canvas font shorthand 使用的完整 family，并保留 sans-serif 作为异常情况下的声明回退。
    fontFamily: "'GeoMCP Source Han Sans', sans-serif",
    // display_id 与 name 共用字号，字重区分信息层级。
    fontSizePx: 12,
    // display_id 使用稍粗字重，优先承担地图对象识别。
    idFontWeight: 600,
    // name 使用正常字重，避免双行标签整体过重。
    nameFontWeight: 400,
    // 多行基线间距；同时参与标签框高度与碰撞计算。
    lineHeightPx: 15,
    // 文字测量框四周留白，不绘制实体背景。
    paddingPx: 3,
    // Node 最外视觉圆与标签框之间的垂直间隔。
    nodeGapPx: 4,
    // 碰撞空间索引的网格边长；只影响查询成本，不改变最终碰撞语义。
    collisionCellSizePx: 64,
    // 标签正文颜色。
    textColor: "#202020",
    // 标签描边光晕颜色，用于维持道路、Area 和未来 basemap 上的对比度。
    haloColor: "rgba(255, 255, 255, 0.95)",
    // Canvas strokeText 的线宽；实际向文字轮廓内外各扩展约一半。
    haloWidthPx: 3,
    // document.fonts.load 的代表性字形，确保中文、拉丁字符与数字在 ready 前完成解码。
    fontLoadSample: "GeoMCP 地图 0123456789",
    // 碰撞时先放 Node，再放 Way，最后放 Area；后进入的候选只会避让已接受标签。
    featurePriority: Object.freeze(["node", "way", "area"] as const),
    // 凹 Area 质心不可用时尝试的水平扫描线位置，值是外环高度的比例。
    areaScanlineRatios: Object.freeze([0.5, 0.4, 0.6, 0.25, 0.75]),
  }),
  /**
   * CSS rule 创建 SVG Path 时仍需 Leaflet geometry options。这里仅提供挂载前的尺寸/透明度 seed；
   * SVG 挂载后的最终 presentation 由 computed style 决定，Canvas recipe 不读取这些值。
   */
  cssGeometrySeed: Object.freeze({
    // translucent CSS layer 在没有进一步覆盖时使用的默认整体透明度。
    translucentOpacity: 0.35,
    // Way border seed 相对默认 Base 线宽增加的逻辑像素。
    wayBorderExtraWidthPx: 4,
    // Area border seed 相对默认描边增加的逻辑像素。
    areaBorderExtraWidthPx: 2,
  }),
  /** 自定义 Relation Canvas renderer 模拟 Leaflet _fillStroke 时使用的缺省 presentation。 */
  canvasFallback: Object.freeze({
    // Path 未提供 color 时与 Leaflet 默认值保持一致。
    color: "#3388ff",
    // Path 未提供 fillOpacity 时与 Leaflet 默认值保持一致。
    fillOpacity: 0.2,
    // Relation line/inner band 的端点统一采用圆头。
    lineCap: "round" as const,
    // Relation 折线拐角统一采用圆角。
    lineJoin: "round" as const,
  }),
});
