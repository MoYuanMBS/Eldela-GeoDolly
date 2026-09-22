/** Core 原始 GeoJSON 的 Browser 校验与可绘制 geometry 分类。 */

import type {JsonDictType} from "../../../models/common/json-models.js";
import {
  coreGeoJsonGeometrySchema,
  type CoreGeoJsonGeometryType,
  type CoreGeometryParseResult,
  type CoreRenderableGeometryGroups,
} from "../../../models/mapsurface/core-render-models.js";

function collectRenderableGeometry(geometry: CoreGeoJsonGeometryType, output: CoreRenderableGeometryGroups): void {
  switch (geometry.type) {
    case "Point":
    case "MultiPoint":
      // GeometryCollection 不改变成员语义；Point/MultiPoint 无论嵌套层级都进入同一 Core 点流程。
      output.points.push(geometry);
      return;
    case "LineString":
    case "MultiLineString":
      output.lines.push(geometry);
      return;
    case "Polygon":
    case "MultiPolygon":
      output.areas.push(geometry);
      return;
    case "GeometryCollection":
      for (const member of geometry.geometries) collectRenderableGeometry(member, output);
  }
}

/**
 * Node payload 只保证 JSON object；真正的 GeoJSON 校验在这里一次完成。任一成员错误都会跳过
 * 完整 Core Overlay，避免合法部分与非法部分形成不可复现的半张 Core 视觉。
 */
export function parseCoreRenderableGeometries(coreVisual: JsonDictType): CoreGeometryParseResult {
  const parsed = coreGeoJsonGeometrySchema.safeParse(coreVisual);
  if (!parsed.success) {
    return Object.freeze({success: false, reason: parsed.error.issues[0]?.message ?? "Invalid Core GeoJSON"});
  }
  const geometries: CoreRenderableGeometryGroups = {points: [], lines: [], areas: []};
  collectRenderableGeometry(parsed.data, geometries);
  if (geometries.points.length === 0 && geometries.lines.length === 0 && geometries.areas.length === 0) {
    return Object.freeze({success: false, reason: `Core GeoJSON type ${parsed.data.type} has no supported renderable geometry`});
  }
  return Object.freeze({success: true, geometries});
}
