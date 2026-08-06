/**
 * 透明 Canvas hit geometry 工厂。
 *
 * 每个空间 Feature 只生成一个 interactive Path，并写入 typed layer index。Base、casing、Relation、
 * Label 等可见重复层全部 interactive=false，后续 hover/click 因而不会重复触发或依赖 CSS/SVG DOM。
 */

import {circleMarker, polygon, polyline, type Path, type Renderer} from "leaflet";
import type {LeafletSpatialGeometry} from "../models/leaflet-renderer-models.js";
import type {CanvasBaseStyleRecipe} from "../models/style/base-canvas-style.js";

// 最小尺寸独立于视觉线宽，保证细线与小点仍有可操作的屏幕像素命中范围。
const MIN_NODE_HIT_RADIUS = 8;
const MIN_WAY_HIT_WIDTH = 12;
const MIN_AREA_EDGE_HIT_WIDTH = 8;

function getLargestRecipeSize(recipe: CanvasBaseStyleRecipe): number {
  // 同一 Base 可能有多次 operation；interaction 必须覆盖最外层 casing，而不是只看主线。
  let largest = 0;
  for (const operation of recipe.operations) {
    if (operation.kind === "circle") largest = Math.max(largest, operation.radius + operation.strokeWidth / 2);
    else if (operation.kind === "line") largest = Math.max(largest, operation.width);
    else largest = Math.max(largest, operation.strokeWidth);
  }
  return largest;
}

/**
 * opacity=0 只隐藏实际像素，不会绕过 Leaflet Canvas 的 containsPoint 检查。
 * Area 同时保留透明 fill 与较宽边线，使内部和边界都可以稳定命中。
 */
export function createOverlayInteractionLayer(geometry: LeafletSpatialGeometry, baseRecipe: CanvasBaseStyleRecipe, renderer: Renderer, nodeVisualRadius = 0): Path {
  const recipeSize = getLargestRecipeSize(baseRecipe);
  const commonOptions = {renderer, interactive: true, bubblingMouseEvents: false} as const;
  if (geometry.featureType === "node") {
    // Relation 外圈可能大于 Base recipe，因此 Node 还需要纳入实际视觉最大半径。
    return circleMarker(geometry.center, {
      ...commonOptions,
      radius: Math.max(MIN_NODE_HIT_RADIUS, recipeSize, nodeVisualRadius + 2),
      stroke: false,
      fill: true,
      fillColor: "#000000",
      fillOpacity: 0,
    });
  }
  if (geometry.featureType === "way") {
    // 透明粗线仍沿用完整 MultiLine geometry；视觉上的 dash 不应造成命中空洞。
    return polyline(geometry.latLngs, {
      ...commonOptions,
      color: "#000000",
      opacity: 0,
      weight: Math.max(MIN_WAY_HIT_WIDTH, recipeSize + 6),
      lineCap: "round",
      lineJoin: "round",
    });
  }
  // even-odd fill 让 Polygon holes 保持不可命中，同时较宽透明 stroke 覆盖边界附近的指针误差。
  return polygon(geometry.latLngs, {
    ...commonOptions,
    stroke: true,
    color: "#000000",
    opacity: 0,
    weight: Math.max(MIN_AREA_EDGE_HIT_WIDTH, recipeSize + 6),
    fill: true,
    fillColor: "#000000",
    fillOpacity: 0,
    fillRule: "evenodd",
  });
}
