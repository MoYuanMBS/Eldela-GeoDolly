import {z} from "zod";

const positiveFiniteNumberSchema = z.number().finite().positive();
const positiveIntegerSchema = z.number().int().positive();

export const iframePaddingConfigSchema = z.object({
  top: positiveIntegerSchema,
  right: positiveIntegerSchema,
  bottom: positiveIntegerSchema,
  left: positiveIntegerSchema,
}).strict().superRefine((padding, context) => {
  if (padding.left !== padding.right) {
    context.addIssue({code: "custom", message: "left padding must equal right padding", path: ["left"]});
  }
  if (padding.top !== padding.bottom) {
    context.addIssue({code: "custom", message: "top padding must equal bottom padding", path: ["top"]});
  }
});

export const leafletConfigSchema = z.object({
  viewport: z.object({
    max_zoom: positiveIntegerSchema,
  }).strict(),
  render_batch_size: positiveIntegerSchema,
  node_zoom: z.object({
    hidden_max_zoom: positiveIntegerSchema,
    compact_max_zoom: positiveIntegerSchema,
    compact_scale: positiveFiniteNumberSchema.max(1),
    medium_max_zoom: positiveIntegerSchema,
    medium_scale: positiveFiniteNumberSchema.max(1),
  }).strict(),
  relation_membership: z.object({
    node_radius_px: positiveFiniteNumberSchema,
    node_stroke_width_px: positiveFiniteNumberSchema,
    way_width_px: positiveFiniteNumberSchema,
    area_band_total_width_px: positiveFiniteNumberSchema,
  }).strict(),
  interaction: z.object({
    node_extra_radius_px: positiveFiniteNumberSchema,
    way_extra_width_px: positiveFiniteNumberSchema,
    area_edge_width_px: positiveFiniteNumberSchema,
    min_node_radius_px: positiveFiniteNumberSchema,
    max_node_radius_px: positiveFiniteNumberSchema,
    min_way_width_px: positiveFiniteNumberSchema,
    max_way_width_px: positiveFiniteNumberSchema,
    max_area_edge_width_px: positiveFiniteNumberSchema,
  }).strict(),
  visual_limits: z.object({
    max_canvas_node_radius_px: positiveFiniteNumberSchema,
    max_canvas_stroke_width_px: positiveFiniteNumberSchema,
  }).strict(),
}).strict().superRefine((leafletConfig, context) => {
  const {node_zoom: nodeZoom, relation_membership: relation, interaction, visual_limits: limits} = leafletConfig;

  if (!(nodeZoom.hidden_max_zoom < nodeZoom.compact_max_zoom && nodeZoom.compact_max_zoom < nodeZoom.medium_max_zoom)) {
    context.addIssue({code: "custom", message: "node zoom thresholds must be strictly increasing", path: ["node_zoom"]});
  }
  if (nodeZoom.compact_scale > nodeZoom.medium_scale) {
    context.addIssue({code: "custom", message: "compact_scale must not exceed medium_scale", path: ["node_zoom", "compact_scale"]});
  }
  if (interaction.min_node_radius_px > interaction.max_node_radius_px) {
    context.addIssue({code: "custom", message: "min_node_radius_px must not exceed max_node_radius_px", path: ["interaction", "min_node_radius_px"]});
  }
  if (interaction.min_way_width_px > interaction.max_way_width_px) {
    context.addIssue({code: "custom", message: "min_way_width_px must not exceed max_way_width_px", path: ["interaction", "min_way_width_px"]});
  }
  if (interaction.area_edge_width_px > interaction.max_area_edge_width_px) {
    context.addIssue({code: "custom", message: "area_edge_width_px must not exceed max_area_edge_width_px", path: ["interaction", "area_edge_width_px"]});
  }
  if (relation.node_radius_px > limits.max_canvas_node_radius_px) {
    context.addIssue({code: "custom", message: "relation node radius exceeds max_canvas_node_radius_px", path: ["relation_membership", "node_radius_px"]});
  }
  for (const [field, width] of [
    ["node_stroke_width_px", relation.node_stroke_width_px],
    ["way_width_px", relation.way_width_px],
    ["area_band_total_width_px", relation.area_band_total_width_px],
  ] as const) {
    if (width > limits.max_canvas_stroke_width_px) {
      context.addIssue({code: "custom", message: `${field} exceeds max_canvas_stroke_width_px`, path: ["relation_membership", field]});
    }
  }
});

export type IframePaddingConfigType = z.infer<typeof iframePaddingConfigSchema>;
export type LeafletConfigType = z.infer<typeof leafletConfigSchema>;
