/** 从长期 Interactive Archive 组装 /mapdata 的纯业务数据。 */

import {resolveBasemap} from "../map-data/basemap.js";
import {interactiveMapArchiveSchema} from "../../models/backend/map-session-models.js";
import {
  mcpInteractiveMapDataSchema,
  type McpInteractiveMapDataType,
} from "../../models/web/interactive-ui-models.js";

/**
 * Archive 只提供不可重新派生的业务数据；basemap profile 取当前 registry，配置和样式由浏览器预载。
 * 未知 profile 或不兼容 archive 在这个 Node 装载边界明确失败，不向 Browser 发送降级默认值。
 */
export interface MapRuntimePayloadsType {
  interactive: McpInteractiveMapDataType;
}

export function buildMapRuntimePayloads(archiveInput: unknown): MapRuntimePayloadsType {
  const archive = interactiveMapArchiveSchema.parse(archiveInput);
  const {basemap_id: basemapId, ...mapPayload} = archive.map_payload;
  const interactive = mcpInteractiveMapDataSchema.parse({
    ...archive,
    map_payload: {...mapPayload, basemap: resolveBasemap(basemapId)},
  });
  return Object.freeze({
    interactive,
  });
}
