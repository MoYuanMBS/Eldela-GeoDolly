/** Core Overlay 的 GeoJSON 校验模型与独立 Browser runtime 契约。 */

import type {LayerGroup, Map as LeafletMap} from "leaflet";
import {z} from "zod";
import type {JsonDictType} from "./bridge-models.js";
import type {LeafletConfigType} from "./config-models.js";

export type CoreGeoJsonPositionType = [number, number];

export interface CorePointGeometryType {
  type: "Point";
  coordinates: CoreGeoJsonPositionType;
}

export interface CoreMultiPointGeometryType {
  type: "MultiPoint";
  coordinates: Array<CoreGeoJsonPositionType>;
}

export interface CoreLineStringGeometryType {
  type: "LineString";
  coordinates: Array<CoreGeoJsonPositionType>;
}

export interface CoreMultiLineStringGeometryType {
  type: "MultiLineString";
  coordinates: Array<Array<CoreGeoJsonPositionType>>;
}

export interface CorePolygonGeometryType {
  type: "Polygon";
  coordinates: Array<Array<CoreGeoJsonPositionType>>;
}

export interface CoreMultiPolygonGeometryType {
  type: "MultiPolygon";
  coordinates: Array<Array<Array<CoreGeoJsonPositionType>>>;
}

/** GeometryCollection 进入 Leaflet 前必须先递归拆分，不能作为单一 Path 绘制。 */
export interface CoreGeometryCollectionType {
  type: "GeometryCollection";
  geometries: Array<CoreGeoJsonGeometryType>;
}

export type CoreGeoJsonPrimitiveGeometryType =
  | CorePointGeometryType
  | CoreMultiPointGeometryType
  | CoreLineStringGeometryType
  | CoreMultiLineStringGeometryType
  | CorePolygonGeometryType
  | CoreMultiPolygonGeometryType;

export type CoreGeoJsonGeometryType = CoreGeoJsonPrimitiveGeometryType | CoreGeometryCollectionType;
export type CoreLineGeometryType = CoreLineStringGeometryType | CoreMultiLineStringGeometryType;
export type CoreAreaGeometryType = CorePolygonGeometryType | CoreMultiPolygonGeometryType;

export interface CoreRenderableGeometryGroups {
  points: Array<CorePointGeometryType>;
  lines: Array<CoreLineGeometryType>;
  areas: Array<CoreAreaGeometryType>;
}

export type CoreGeometryParseResult =
  | Readonly<{success: true; geometries: CoreRenderableGeometryGroups}>
  | Readonly<{success: false; reason: string}>;

const longitudeSchema = z.number().finite().min(-180).max(180);
const latitudeSchema = z.number().finite().min(-90).max(90);
const positionSchema = z.tuple([longitudeSchema, latitudeSchema]);
const lineCoordinatesSchema = z.array(positionSchema).min(2);
const ringCoordinatesSchema = z.array(positionSchema).min(4).superRefine((ring, context) => {
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    context.addIssue({code: "custom", message: "Polygon rings must be closed"});
  }
});
const polygonCoordinatesSchema = z.array(ringCoordinatesSchema).min(1);

/** Node payload 只保证 JSON object；Core renderer 使用这里的 schema 校验完整 GeoJSON。 */
export const coreGeoJsonGeometrySchema: z.ZodType<CoreGeoJsonGeometryType> = z.lazy(() => z.discriminatedUnion("type", [
  z.object({type: z.literal("Point"), coordinates: positionSchema}).strict(),
  z.object({type: z.literal("MultiPoint"), coordinates: z.array(positionSchema).min(1)}).strict(),
  z.object({type: z.literal("LineString"), coordinates: lineCoordinatesSchema}).strict(),
  z.object({type: z.literal("MultiLineString"), coordinates: z.array(lineCoordinatesSchema).min(1)}).strict(),
  z.object({type: z.literal("Polygon"), coordinates: polygonCoordinatesSchema}).strict(),
  z.object({type: z.literal("MultiPolygon"), coordinates: z.array(polygonCoordinatesSchema).min(1)}).strict(),
  z.object({type: z.literal("GeometryCollection"), geometries: z.array(coreGeoJsonGeometrySchema)}).strict(),
]));

/** 独立 Core renderer 只接收原始 GeoJSON、Node zoom 配置和连续世界参考中心。 */
export interface CoreOverlayRendererOptions {
  /** 已由 MapSurface 初始化完成的共享 Leaflet map。 */
  map: LeafletMap;
  /** 地点确认阶段缓存的原始 JSON object；GeoJSON 语义由 Core renderer 自行校验。 */
  coreVisual: JsonDictType;
  /** Core Point 与普通 Node 复用同一组 zoom 显隐/缩放档位。 */
  nodeZoomConfig: LeafletConfigType["node_zoom"];
  /** 后端 center[1]；连续世界适配只使用经度。 */
  centerLongitude: number;
  /** 上层卸载时中断首次绘制等待。 */
  signal?: AbortSignal;
}

/** Core result 只保存独立 Canvas runtime 对象，不进入 payload、Feature index 或 React state。 */
export interface CoreOverlayRenderResult {
  rootLayer: LayerGroup;
  /** 幂等清理 Node zoom listener、Canvas renderer 与全部 Core Paths。 */
  dispose(): void;
}
