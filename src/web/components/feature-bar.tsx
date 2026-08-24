import featureBarDividerUrl from "../../../assets/ui/decorations/feature-bar-divider.svg";
import featureBarLeftUrl from "../../../assets/ui/decorations/feature-bar-left.svg";
import featureBarRightUrl from "../../../assets/ui/decorations/feature-bar-right.svg";
import nodeIconUrl from "../../../assets/ui/icons/node.svg";
import polygonIconUrl from "../../../assets/ui/icons/polygon.svg";
import wayIconUrl from "../../../assets/ui/icons/way.svg";
import type {InteractiveFeatureSummaryType} from "../../models/web/interactive-ui-models.js";

interface FeatureBarProps {
  feature: InteractiveFeatureSummaryType | null;
}

const FEATURE_TYPE_ICONS = {
  node: nodeIconUrl,
  way: wayIconUrl,
  area: polygonIconUrl,
} as const;

function FeatureBarDivider({position}: {position: "type-feature" | "feature-name"}) {
  return (
    <span className={`feature-bar-divider feature-bar-divider-${position}`} aria-hidden="true">
      <img className="feature-bar-divider-decoration" src={featureBarDividerUrl} alt="" draggable={false} />
    </span>
  );
}

/** 当前空间对象的固定类型图标 / Feature / Name 摘要；详情与 AI Output 不进入此栏。 */
export function FeatureBar({feature}: FeatureBarProps) {
  const featureLabel = feature?.displayId ?? "—";
  const nameLabel = feature?.name ?? "—";
  const featureTypeClass = feature === null ? "feature-bar-type-empty" : `feature-bar-type-${feature.featureType}`;
  return (
    <section className={`feature-bar ${feature === null ? "feature-bar-state-empty" : "feature-bar-state-ready"} ${featureTypeClass}`} aria-label="Current map feature" aria-live="polite" data-feature-state={feature === null ? "empty" : "ready"}>
      <span className="feature-bar-end feature-bar-end-left" aria-hidden="true">
        <img className="feature-bar-end-decoration feature-bar-end-decoration-left" src={featureBarLeftUrl} alt="" draggable={false} />
      </span>
      <span className="feature-bar-end feature-bar-end-right" aria-hidden="true">
        <img className="feature-bar-end-decoration feature-bar-end-decoration-right" src={featureBarRightUrl} alt="" draggable={false} />
      </span>
      <div className="feature-bar-content">
        <span className="feature-bar-icon-slot" aria-label={feature === null ? "No current feature" : `Feature type ${feature.featureType}`}>
          {feature === null ? null : <img className={`feature-bar-icon feature-bar-icon-${feature.featureType}`} src={FEATURE_TYPE_ICONS[feature.featureType]} alt="" draggable={false} aria-hidden="true" />}
        </span>
        <FeatureBarDivider position="type-feature" />
        <div className="feature-bar-field feature-bar-feature">
          <span className="feature-bar-label">Feature</span>
          <span className="feature-bar-value">{featureLabel}</span>
        </div>
        <FeatureBarDivider position="feature-name" />
        <div className="feature-bar-field feature-bar-name">
          <span className="feature-bar-label">Name</span>
          <span className="feature-bar-value">{nameLabel}</span>
        </div>
      </div>
    </section>
  );
}
