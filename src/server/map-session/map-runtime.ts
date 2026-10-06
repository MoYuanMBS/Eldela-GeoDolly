/** 从长期 Interactive Archive 组装当前前端版本的 Interactive runtime。 */

import {resolveBasemap} from "../map-data/basemap.js";
import {leafletConfigSchema} from "../../models/backend/config-models.js";
import {
  interactiveMapArchiveSchema,
  type InteractiveMapArchiveType,
} from "../../models/backend/map-session-models.js";
import {
  basemapOnlyMapPayloadSchema,
  coreMapPayloadSchema,
  nonCoreMapPayloadSchema,
  type CommonVisualMapPayloadType,
} from "../../models/mapsurface/map-payload-models.js";
import {renderStylePayloadSchema} from "../../models/mapsurface/style/user-css-style-models.js";
import {
  interactiveMapDataSchema,
  type InteractiveMapDataType,
} from "../../models/web/interactive-ui-models.js";
import {config} from "../utils/config-loader.js";
import {getUserStyle} from "../utils/user-style/user-style-rule.js";

function buildCurrentMapPayload(archive: InteractiveMapArchiveType): CommonVisualMapPayloadType {
  const currentFields = {
    basemap: resolveBasemap(archive.basemap),
    leaflet: config.getAppSection("leaflet", leafletConfigSchema),
    screenshot_size: archive.screenshot_size,
    center: archive.center,
    leaflet_bbox: archive.leaflet_bbox,
  };
  switch (archive.render_mode) {
    case "core":
      return coreMapPayloadSchema.parse({
        ...currentFields,
        render_mode: archive.render_mode,
        overlay_output: archive.overlay_output,
        relation_member_features_by_relation: archive.relation_member_features_by_relation,
        core_visual: archive.core_visual,
      });
    case "non_core":
      return nonCoreMapPayloadSchema.parse({
        ...currentFields,
        render_mode: archive.render_mode,
        overlay_output: archive.overlay_output,
        relation_member_features_by_relation: archive.relation_member_features_by_relation,
        core_visual: null,
      });
    case "basemap_only":
      return basemapOnlyMapPayloadSchema.parse({
        ...currentFields,
        render_mode: archive.render_mode,
        overlay_output: null,
        relation_member_features_by_relation: null,
        core_visual: null,
      });
  }
}

/**
 * Archive 只提供不可重新派生的业务数据；basemap profile、Leaflet 配置与用户样式始终取当前版本。
 * 未知 profile 或不兼容 archive 在这个 Node 装载边界明确失败，不向 Browser 发送降级默认值。
 */
export interface MapRuntimePayloadsType {
  interactive: InteractiveMapDataType;
}

export function buildMapRuntimePayloads(archiveInput: unknown): MapRuntimePayloadsType {
  const archive = interactiveMapArchiveSchema.parse(archiveInput);
  const userStyle = getUserStyle();
  const sharedRuntime = {
    map_payload: buildCurrentMapPayload(archive),
    style_payload: renderStylePayloadSchema.parse({user_css: userStyle.css, user_rules: userStyle.rules}),
  };
  const interactive = interactiveMapDataSchema.parse({
    ...sharedRuntime,
    ai_output: archive.ai_output,
    display_id_by_feature_id: archive.display_id_by_feature_id,
    relation_membership_by_feature_id: archive.relation_membership_by_feature_id,
    selected_location_name: archive.selected_location_name,
  });
  return Object.freeze({
    interactive,
  });
}
