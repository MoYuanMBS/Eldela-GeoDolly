import {z} from "zod";
import {browserWarningReportSchema} from "../common/browser-warning-models.js";
import {commonVisualMapPayloadSchema} from "../mapsurface/map-payload-models.js";
import {renderStylePayloadSchema} from "../mapsurface/style/user-css-style-models.js";

/** 内部 Snapshot route 返回的最小视觉数据；不包含 AI Output 或 Interactive lookup。 */
export const snapshotMapDataSchema = z.object({
  map_payload: commonVisualMapPayloadSchema,
  style_payload: renderStylePayloadSchema,
}).strict();

export type SnapshotMapDataType = z.infer<typeof snapshotMapDataSchema>;

/** Snapshot ready summary 只包含影响截图终态的固定恢复结果。 */
export const snapshotWarningCodeSchema = z.enum([
  "basemap_tiles_missing",
  "label_font_fallback",
  "reference_ui_font_fallback",
  "reference_ui_decoration_hidden",
  "scale_omitted",
]);

export const snapshotInitialTileSummarySchema = z.object({
  success_count: z.number().int().nonnegative(),
  total_count: z.number().int().positive(),
  success_ratio: z.number().finite().min(0).max(1),
  required_ratio: z.number().finite().min(0).max(1),
}).strict();

export const snapshotSpatialRenderCountsSchema = z.object({
  node: z.number().int().nonnegative(),
  way: z.number().int().nonnegative(),
  area: z.number().int().nonnegative(),
}).strict();

const snapshotVisualStageSummarySchema = z.object({
  status: z.enum(["ready", "skipped"]),
  rendered: snapshotSpatialRenderCountsSchema,
}).strict();

const snapshotScaleSummarySchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    label: z.string().min(1),
    distance_meters: z.number().finite().positive(),
    width_px: z.number().finite().positive(),
  }).strict(),
  z.object({status: z.literal("omitted")}).strict(),
]);

export const snapshotRecoverableWarningSchema = snapshotWarningCodeSchema;

/** Basemap 运行诊断独立交给 Playwright；它不参与 Snapshot ready 判定。 */
export const snapshotDiagnosticsSchema = z.array(browserWarningReportSchema);

function hasRenderedFeature(counts: z.infer<typeof snapshotSpatialRenderCountsSchema>): boolean {
  return counts.node !== 0 || counts.way !== 0 || counts.area !== 0;
}

/** Playwright 从页面 ready attribute 读取的完整、可序列化截图终态。 */
export const snapshotBrowserReadySummarySchema = z.object({
  status: z.literal("ready"),
  error: z.null(),
  initial_view: z.object({
    center: z.tuple([z.number().finite(), z.number().finite()]),
    zoom: z.number().int().nonnegative(),
    bounds: z.tuple([
      z.tuple([z.number().finite(), z.number().finite()]),
      z.tuple([z.number().finite(), z.number().finite()]),
    ]),
  }).strict(),
  basemap: z.object({status: z.literal("ready"), error: z.null()}).strict(),
  overlay: snapshotVisualStageSummarySchema,
  core_overlay: snapshotVisualStageSummarySchema,
  reference_ui: z.object({status: z.literal("ready"), measured_height: z.number().int().positive()}).strict(),
  scale: snapshotScaleSummarySchema,
  final_logical_height: z.number().int().positive(),
  initial_tiles: snapshotInitialTileSummarySchema,
  warnings: z.array(snapshotRecoverableWarningSchema),
}).strict().superRefine((summary, context) => {
  const [[south, west], [north, east]] = summary.initial_view.bounds;
  const [centerLatitude, centerLongitude] = summary.initial_view.center;
  if (south > north || west > east) {
    context.addIssue({code: "custom", path: ["initial_view", "bounds"], message: "bounds must be ordered south-west to north-east"});
  } else if (centerLatitude < south || centerLatitude > north || centerLongitude < west || centerLongitude > east) {
    context.addIssue({code: "custom", path: ["initial_view", "center"], message: "center must lie within the initial bounds"});
  }
  const {initial_tiles: tiles} = summary;
  if (tiles.success_count > tiles.total_count) {
    context.addIssue({code: "custom", path: ["initial_tiles", "success_count"], message: "success_count must not exceed total_count"});
  }
  const calculatedRatio = tiles.success_count / tiles.total_count;
  if (Math.abs(tiles.success_ratio - calculatedRatio) > 1e-12) {
    context.addIssue({code: "custom", path: ["initial_tiles", "success_ratio"], message: "success_ratio must match success_count / total_count"});
  }
  if (tiles.success_ratio < tiles.required_ratio) {
    context.addIssue({code: "custom", path: ["initial_tiles", "success_ratio"], message: "ready summary must meet required_ratio"});
  }
  if (summary.overlay.status === "skipped" && hasRenderedFeature(summary.overlay.rendered)) {
    context.addIssue({code: "custom", path: ["overlay", "rendered"], message: "skipped overlay must not report rendered features"});
  }
  if (summary.core_overlay.status === "skipped" && hasRenderedFeature(summary.core_overlay.rendered)) {
    context.addIssue({code: "custom", path: ["core_overlay", "rendered"], message: "skipped core_overlay must not report rendered features"});
  }
  const warningSet = new Set(summary.warnings);
  if (warningSet.size !== summary.warnings.length) {
    context.addIssue({code: "custom", path: ["warnings"], message: "warnings must not contain duplicates"});
  }
  if (warningSet.has("scale_omitted") !== (summary.scale.status === "omitted")) {
    context.addIssue({code: "custom", path: ["warnings"], message: "scale_omitted must match the scale terminal state"});
  }
  if (warningSet.has("basemap_tiles_missing") !== (tiles.success_count < tiles.total_count)) {
    context.addIssue({code: "custom", path: ["warnings"], message: "basemap_tiles_missing must match the initial tile counts"});
  }
  if (summary.final_logical_height <= summary.reference_ui.measured_height) {
    context.addIssue({code: "custom", path: ["final_logical_height"], message: "final_logical_height must include a positive map height"});
  }
});

export type SnapshotWarningCodeType = z.infer<typeof snapshotWarningCodeSchema>;
export type SnapshotRecoverableWarningType = z.infer<typeof snapshotRecoverableWarningSchema>;
export type SnapshotBrowserReadySummaryType = z.infer<typeof snapshotBrowserReadySummarySchema>;
