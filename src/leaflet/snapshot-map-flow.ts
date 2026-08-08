/** Snapshot 入口只启动共享 MapSurface + Visual runtime，不静态依赖 Interaction。 */

import {
  createLeafletVisualRuntime,
  type LeafletVisualRuntimeOptions,
  type LeafletVisualRuntimeResult,
} from "./runtime/leaflet-visual-runtime.js";

export type SnapshotMapFlowOptions = LeafletVisualRuntimeOptions;
export type SnapshotMapFlowResult = LeafletVisualRuntimeResult;

export function createSnapshotMapFlow(options: SnapshotMapFlowOptions): Promise<SnapshotMapFlowResult> {
  return createLeafletVisualRuntime(options);
}
