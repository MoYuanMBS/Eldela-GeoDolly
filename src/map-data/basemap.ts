import type {BasemapProfileIdType, ResolvedBasemapType} from "../models/common/basemap-models.js";
import {AppError} from "../utils/app-error.js";
import {config} from "../utils/config-loader.js";

/**
 * 从 ConfigLoader 的启动期缓存生成单次 Browser payload 使用的可序列化快照。
 *
 * 本函数不读取 YAML、不维护第二份缓存；未知 ID 在进入 Python 或 Browser 流程前直接失败。
 */
export function resolveBasemap(profileId: BasemapProfileIdType): ResolvedBasemapType {
  const profiles = config.getBasemapProfiles();
  if (!Object.hasOwn(profiles, profileId)) {
    throw new AppError("missing_tile_profile", `Unknown tile profile: ${profileId}`);
  }
  const {upstream: _upstream, ...browserProfile} = profiles[profileId];
  return Object.freeze({id: profileId, ...browserProfile});
}
