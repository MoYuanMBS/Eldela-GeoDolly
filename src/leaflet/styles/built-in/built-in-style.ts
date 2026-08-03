/**
 * 内置 Canvas Base style recipes 主入口。
 *
 * 这里只描述单个 Feature 的绘制 operations；CSS、Relation membership 与其他 addons 不参与。
 */

import type {CanvasBaseStyleRecipe} from "../../../models/style/base-canvas-style.js";

/**
 * OSM iD 风格道路 recipe：先画较宽 casing，再画内部主线。
 * operation 顺序就是 Canvas 绘制顺序，因此这里不能交换两条 line。
 */
function wayStyle(
  casingColor: string,
  strokeColor: string,
  casingWidth: number,
  strokeWidth: number,
  dash?: ReadonlyArray<number>,
): CanvasBaseStyleRecipe {
  return {
    featureType: "way",
    operations: [{
      kind: "line",
      color: casingColor,
      opacity: 1,
      width: casingWidth,
      lineCap: "round",
      lineJoin: "round",
    }, {
      kind: "line",
      color: strokeColor,
      opacity: 1,
      width: strokeWidth,
      lineCap: dash === undefined ? "round" : "butt",
      lineJoin: "round",
      ...(dash === undefined ? {} : {dash}),
    }],
  };
}

/**
 * Area Base 使用一次填充加边线；mainColor 留给后续 relation 内侧填充带合成自身颜色。
 */
function areaStyle(fillColor: string, fillOpacity: number, strokeColor = fillColor): CanvasBaseStyleRecipe {
  return {
    featureType: "area",
    mainColor: fillColor,
    operations: [{
      kind: "area",
      fillColor,
      fillOpacity,
      strokeColor,
      strokeOpacity: 1,
      strokeWidth: 1.5,
    }],
  };
}

/** 内置默认样式和当前 highway/landuse/building recipe；rule 文件只通过 ID 引用这里。 */
export const BUILT_IN_CANVAS_STYLES = {
  "node-default": {
    featureType: "node",
    operations: [{
      kind: "circle",
      radius: 7,
      fillColor: "#ffffff",
      fillOpacity: 1,
      strokeColor: "#000000",
      strokeOpacity: 1,
      strokeWidth: 2,
    }, {
      kind: "circle",
      radius: 2,
      fillColor: "#000000",
      fillOpacity: 1,
      strokeColor: "#000000",
      strokeOpacity: 0,
      strokeWidth: 0,
    }],
  },

  "way-default": wayStyle("#444444", "#cccccc", 5, 3),
  "way-highway-motorway": wayStyle("#70372f", "#cf2081", 10, 8),
  "way-highway-trunk": wayStyle("#70372f", "#dd2f22", 10, 8),
  "way-highway-primary": wayStyle("#70372f", "#f99806", 10, 8),
  "way-highway-secondary": wayStyle("#70372f", "#f3f312", 10, 8),
  "way-highway-tertiary": wayStyle("#70372f", "#fff9b3", 10, 8),
  "way-highway-residential": wayStyle("#444444", "#ffffff", 10, 8),
  "way-highway-unclassified": wayStyle("#444444", "#ddccaa", 10, 8),
  "way-highway-living-street": wayStyle("#ffffff", "#cccccc", 7, 5),
  "way-highway-service": wayStyle("#666666", "#ffffff", 7, 5),
  "way-highway-track": wayStyle("#746f6f", "#c5b59f", 7, 5),
  "way-highway-road": wayStyle("#666666", "#9e9e9e", 7, 5),
  "way-highway-pedestrian": wayStyle("#998888", "#ffffff", 5.5, 3.5, [6, 6]),
  "way-highway-path": wayStyle("#ffffff", "#998888", 5, 3, [6, 6]),
  "way-highway-footway": wayStyle("#998888", "#ffffff", 5, 3, [6, 6]),
  "way-highway-cycleway": wayStyle("#58a9ed", "#ffffff", 5, 3, [6, 6]),
  "way-highway-bridleway": wayStyle("#e06d5f", "#ffffff", 5, 3, [6, 6]),
  "way-highway-steps": wayStyle("#ffffff", "#81d25c", 5, 3, [3, 3]),

  "area-default": areaStyle("#aaaaaa", 0.18),
  "area-building": areaStyle("#b08e7c", 0.38, "#7d6255"),
  "area-landuse-green": areaStyle("#8cd05f", 0.3),
  "area-landuse-water": areaStyle("#77d3de", 0.3),
  "area-landuse-residential": areaStyle("#c4bd19", 0.3),
  "area-landuse-commercial": areaStyle("#d6881a", 0.3),
  "area-landuse-industrial": areaStyle("#e4a4f5", 0.3),
  "area-landuse-agricultural": areaStyle("#bfe83f", 0.3),
  "area-landuse-farmyard": areaStyle("#f5dcba", 0.3, "#e2b16f"),
  "area-landuse-default": areaStyle("#aaaaaa", 0.24),
} as const satisfies Record<string, CanvasBaseStyleRecipe>;
