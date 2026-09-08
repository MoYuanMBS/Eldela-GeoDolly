import {z} from "zod";
import {commonVisualMapPayloadSchema} from "../mapsurface/map-payload-models.js";
import {renderStylePayloadSchema} from "../mapsurface/style/user-css-style-models.js";

/** 内部 Snapshot route 返回的最小视觉数据；不包含 AI Output 或 Interactive lookup。 */
export const snapshotMapDataSchema = z.object({
  map_payload: commonVisualMapPayloadSchema,
  style_payload: renderStylePayloadSchema,
}).strict();

export type SnapshotMapDataType = z.infer<typeof snapshotMapDataSchema>;
