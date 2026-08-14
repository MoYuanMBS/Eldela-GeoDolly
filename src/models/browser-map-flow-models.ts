/** Browser Map Flow 各独立子流程使用的可序列化状态。 */

import type {JsonValueType} from "./bridge-models.js";

/** 单次初始视口瓦片加载失败；该状态不属于 AppError throw 路径。 */
export interface TileRuntimeFailure {
  code: string;
  message: string;
  details: JsonValueType;
}

/** Basemap runtime 只发布初始瓦片自己的终态。 */
export type BasemapRuntimeStatus =
  | {status: "ready"; error: null}
  | {status: "failed"; error: TileRuntimeFailure};
