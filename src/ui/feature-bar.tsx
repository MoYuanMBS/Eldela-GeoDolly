import {useId, useState} from "react";
import featureBarDividerUrl from "../../assets/ui/decorations/feature-bar-divider.svg";
import featureBarLeftUrl from "../../assets/ui/decorations/feature-bar-left.svg";
import featureBarRightUrl from "../../assets/ui/decorations/feature-bar-right.svg";
import extendIconUrl from "../../assets/ui/icons/extend.svg";
import type {AiOutputGroupsWithIdsType} from "../models/backend/map-data-models.js";
import {AiOutputTree} from "./ai-output-tree.js";

interface FeatureBarProps {
  selectedLocationName: string | null;
  aiOutput: AiOutputGroupsWithIdsType | null;
}

function FeatureBarDivider() {
  return (
    <span className="feature-bar-divider feature-bar-divider-feature-location" aria-hidden="true">
      <img className="feature-bar-divider-decoration" src={featureBarDividerUrl} alt="" draggable={false} />
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
    <button className="feature-bar-content feature-bar-toggle" type="button" aria-expanded={expanded} aria-controls={treeId} onClick={onToggle}>
      <span className="feature-bar-title">Feature</span>
      <FeatureBarDivider />
      <span className={`feature-bar-location-name ${selectedLocationName === null ? "feature-bar-location-name-empty" : "feature-bar-location-name-ready"}`}>{selectedLocationName ?? ""}</span>
      {/* 仅在 AI Output 存在时挂载 img，basemap-only 页面不会请求 extend.svg。 */}
      <img className={`feature-bar-extend-icon${expanded ? " feature-bar-extend-icon-expanded" : ""}`} src={extendIconUrl} alt="" draggable={false} aria-hidden="true" />
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
    <section className={`feature-bar feature-bar-state-${state}`} aria-label="Feature data" data-feature-ui-state={state}>
      <span className="feature-bar-end feature-bar-end-left" aria-hidden="true">
        <img className="feature-bar-end-decoration feature-bar-end-decoration-left" src={featureBarLeftUrl} alt="" draggable={false} />
      </span>
      <span className="feature-bar-end feature-bar-end-right" aria-hidden="true">
        <img className="feature-bar-end-decoration feature-bar-end-decoration-right" src={featureBarRightUrl} alt="" draggable={false} />
      </span>
      {expandable ? (
        <FeatureBarHeader selectedLocationName={selectedLocationName} expanded={expanded} treeId={treeId} onToggle={() => setExpanded((current) => !current)} />
      ) : (
        <div className="feature-bar-content feature-bar-content-static">
          <span className="feature-bar-title">Feature</span>
          <FeatureBarDivider />
          <span className={`feature-bar-location-name ${selectedLocationName === null ? "feature-bar-location-name-empty" : "feature-bar-location-name-ready"}`}>{selectedLocationName ?? ""}</span>
        </div>
      )}
      {/* 折叠时不挂载树，避免无用 DOM 与大量 tag 内容参与页面布局。 */}
      {expanded && aiOutput !== null ? <div className="feature-bar-tree-body" id={treeId}><AiOutputTree aiOutput={aiOutput} /></div> : null}
    </section>
  );
}
