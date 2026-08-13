/** Snapshot 入口只启动共享 MapSurface + Visual runtime，不静态依赖 Interaction。 */

import {
  createLeafletVisualRuntime,
  type LeafletVisualRuntimeOptions,
  type LeafletVisualRuntimeResult,
} from "../leaflet/runtime/leaflet-visual-runtime.js";

/** Snapshot 不附加交互状态，因此输入契约与共享 Visual runtime 完全一致。 */
export type SnapshotMapFlowOptions = LeafletVisualRuntimeOptions;
/** Snapshot 只返回 MapSurface 与 Visual；结果中不会出现透明命中层。 */
export type SnapshotMapFlowResult = LeafletVisualRuntimeResult;

/**
 * 启动截图使用的共享地图流程。
 *
 * 保持这个入口为薄边界，可以确保截图 bundle 不静态导入 Interaction；截图 ready、字体和瓦片等待
 * 由更外层编排，不在这里复制另一套 Leaflet 渲染实现。
 */
export function createSnapshotMapFlow(options: SnapshotMapFlowOptions): Promise<SnapshotMapFlowResult> {
  return createLeafletVisualRuntime(options);
}
