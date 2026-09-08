import {useId, useState} from "react";
import {UI_SVG_ASSETS} from "../built-in-config/ui-svg.js";
import {UI_DECORATIONS_ENABLED} from "../built-in-config/ui.js";
import type {AiOutputGroupsWithIdsType} from "../models/backend/map-data-models.js";
import {AiOutputTree} from "./ai-output-tree.js";
import {ScrollArea} from "./scroll-area.js";

interface FeatureBarProps {
  selectedLocationName: string | null;
  aiOutput: AiOutputGroupsWithIdsType | null;
}

function FeatureBarDivider({position}: {position: "title-toggle" | "toggle-location"}) {
  return (
    <span className={`geomcp-feature-bar-divider geomcp-feature-bar-divider-${position}`} aria-hidden="true">
      <img className="geomcp-ui-decoration geomcp-ui-decoration-feature-divider" src={UI_SVG_ASSETS.decorations.featureBarDivider} alt="" draggable={false} />
    </span>
  );
}

interface FeatureBarHeaderProps {
  selectedLocationName: string | null;
  expanded: boolean;
  treeId: string;
  onToggle: () => void;
}

function FeatureBarHeader({selectedLocationName, expanded, treeId, onToggle}: FeatureBarHeaderProps) {
  return (
    // 整个标题栏是唯一按钮；树区域仍是其兄弟节点，操作 record 不会误收起 Feature UI。
    <button className="geomcp-feature-bar-content geomcp-feature-bar-content-expandable geomcp-feature-bar-toggle" type="button" aria-label={expanded ? "Collapse Feature data" : "Expand Feature data"} aria-expanded={expanded} aria-controls={treeId} onClick={onToggle}>
      <span className="geomcp-feature-bar-title">Feature</span>
      <FeatureBarDivider position="title-toggle" />
      <span className="geomcp-feature-bar-toggle-icon" aria-hidden="true">
        {/* 仅在 AI Output 存在时挂载 img，basemap-only 页面不会请求 extend.svg。 */}
        <img className={`geomcp-ui-icon geomcp-ui-icon-feature-extend${expanded ? " geomcp-ui-icon-feature-extend-expanded" : ""}`} src={UI_SVG_ASSETS.icons.extend} alt="" draggable={false} aria-hidden="true" />
      </span>
      <FeatureBarDivider position="toggle-location" />
      <span className={`geomcp-feature-bar-location-name ${selectedLocationName === null ? "geomcp-feature-bar-location-name-empty" : "geomcp-feature-bar-location-name-ready"}`}>{selectedLocationName ?? ""}</span>
    </button>
  );
}

/** Feature UI 与 Standard UI 的 hover/selection 状态完全分离。 */
export function FeatureBar({selectedLocationName, aiOutput}: FeatureBarProps) {
  const [expanded, setExpanded] = useState(false);
  const treeId = useId();
  const expandable = aiOutput !== null;
  const state = !expandable ? "static" : expanded ? "expanded" : "collapsed";

  return (
    <section className={`geomcp-feature-bar geomcp-feature-bar-state-${state}`} aria-label="Feature data" data-feature-ui-state={state}>
      {UI_DECORATIONS_ENABLED ? <>
        <span className="geomcp-feature-bar-end geomcp-feature-bar-end-left" aria-hidden="true">
          <img className="geomcp-ui-decoration geomcp-ui-decoration-feature-end geomcp-ui-decoration-feature-end-left" src={UI_SVG_ASSETS.decorations.featureBarLeft} alt="" draggable={false} />
        </span>
        <span className="geomcp-feature-bar-end geomcp-feature-bar-end-right" aria-hidden="true">
          <img className="geomcp-ui-decoration geomcp-ui-decoration-feature-end geomcp-ui-decoration-feature-end-right" src={UI_SVG_ASSETS.decorations.featureBarRight} alt="" draggable={false} />
        </span>
      </> : null}
      {expandable ? (
        <FeatureBarHeader selectedLocationName={selectedLocationName} expanded={expanded} treeId={treeId} onToggle={() => setExpanded((current) => !current)} />
      ) : (
        <div className="geomcp-feature-bar-content geomcp-feature-bar-content-static">
          <span className="geomcp-feature-bar-title">Feature</span>
          <FeatureBarDivider position="title-toggle" />
          <span className={`geomcp-feature-bar-location-name ${selectedLocationName === null ? "geomcp-feature-bar-location-name-empty" : "geomcp-feature-bar-location-name-ready"}`}>{selectedLocationName ?? ""}</span>
        </div>
      )}
      {/* 折叠时不挂载树，避免无用 DOM 与大量 tag 内容参与页面布局。 */}
      {expanded && aiOutput !== null ? <ScrollArea className="geomcp-feature-bar-tree-body" id={treeId} ariaLabel="Feature data"><AiOutputTree aiOutput={aiOutput} /></ScrollArea> : null}
    </section>
  );
}
