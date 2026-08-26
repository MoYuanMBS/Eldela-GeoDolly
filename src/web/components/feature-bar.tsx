import featureBarDividerUrl from "../../../assets/ui/decorations/feature-bar-divider.svg";
import featureBarLeftUrl from "../../../assets/ui/decorations/feature-bar-left.svg";
import featureBarRightUrl from "../../../assets/ui/decorations/feature-bar-right.svg";

interface FeatureBarProps {
  selectedLocationName: string | null;
}

function FeatureBarDivider() {
  return (
    <span className="feature-bar-divider feature-bar-divider-feature-location" aria-hidden="true">
      <img className="feature-bar-divider-decoration" src={featureBarDividerUrl} alt="" draggable={false} />
    </span>
  );
}

/** Feature UI 的默认折叠标题；当前 hover/selection 摘要只属于 Standard UI。 */
export function FeatureBar({selectedLocationName}: FeatureBarProps) {
  return (
    <section className="feature-bar feature-bar-state-collapsed" aria-label="Feature data" aria-expanded="false" data-feature-ui-state="collapsed">
      <span className="feature-bar-end feature-bar-end-left" aria-hidden="true">
        <img className="feature-bar-end-decoration feature-bar-end-decoration-left" src={featureBarLeftUrl} alt="" draggable={false} />
      </span>
      <span className="feature-bar-end feature-bar-end-right" aria-hidden="true">
        <img className="feature-bar-end-decoration feature-bar-end-decoration-right" src={featureBarRightUrl} alt="" draggable={false} />
      </span>
      <div className="feature-bar-content">
        <span className="feature-bar-title">Feature</span>
        <FeatureBarDivider />
        <span className={`feature-bar-location-name ${selectedLocationName === null ? "feature-bar-location-name-empty" : "feature-bar-location-name-ready"}`}>{selectedLocationName ?? ""}</span>
      </div>
    </section>
  );
}
