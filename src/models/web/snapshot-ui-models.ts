import {z} from "zod";
import {commonVisualMapPayloadSchema} from "../mapsurface/map-payload-models.js";
import {renderStylePayloadSchema} from "../mapsurface/style/user-css-style-models.js";

/** MCP App Snapshot 的最小视觉数据；不包含 AI Output 或 Interactive lookup。 */
export const snapshotMapDataSchema = z.object({
  map_payload: commonVisualMapPayloadSchema,
  style_payload: renderStylePayloadSchema,
}).strict();

export type SnapshotMapDataType = z.infer<typeof snapshotMapDataSchema>;

/** Snapshot 截图使用的固定恢复结果。 */
export const snapshotWarningCodeSchema = z.enum([
  "basemap_tiles_missing",
  "label_font_fallback",
  "reference_ui_font_fallback",
  "reference_ui_decoration_hidden",
  "scale_omitted",
]);

export const snapshotRecoverableWarningSchema = snapshotWarningCodeSchema;

export type SnapshotWarningCodeType = z.infer<typeof snapshotWarningCodeSchema>;
export type SnapshotRecoverableWarningType = z.infer<typeof snapshotRecoverableWarningSchema>;
