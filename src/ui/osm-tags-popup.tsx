import {UI_SVG_ASSETS} from "../built-in-config/ui-svg.js";
import type {InteractiveFeatureDetailsType, InteractiveOsmTagGroupType} from "../models/web/interactive-ui-models.js";
import {InteractivePopup} from "./interactive-popup.js";

interface OsmTagsPopupProps {
  details: InteractiveFeatureDetailsType;
  onClose(): void;
}

const FEATURE_TYPE_ICONS = {
  node: UI_SVG_ASSETS.icons.node,
  way: UI_SVG_ASSETS.icons.way,
  area: UI_SVG_ASSETS.icons.polygon,
} as const;

function osmRef(osmType: InteractiveOsmTagGroupType["osmType"], osmId: number): string {
  const prefix = osmType === "node" ? "n" : osmType === "way" ? "w" : "r";
  return `${prefix}/${osmId}`;
}

function TagGroup({record}: {record: InteractiveOsmTagGroupType}) {
  // AI Output record 已经保留 OSM 身份和自己的 tags；这里不跨 record 聚合或反推来源。
  const tags = Object.entries(record.tags);
  return (
    <section className="geomcp-interactive-popup-record geomcp-osm-tags-popup-tag-group">
      <h4 className="geomcp-interactive-popup-record-title geomcp-osm-tags-popup-tag-group-title">{osmRef(record.osmType, record.osmId)}</h4>
      {tags.length === 0 ? <p className="geomcp-osm-tags-popup-empty">No tags</p> : (
        <dl className="geomcp-interactive-popup-values geomcp-osm-tags-popup-tag-list">
          {tags.map(([key, value]) => (
            <div className="geomcp-interactive-popup-row geomcp-osm-tags-popup-tag-row" key={key}>
              <img className="geomcp-ui-icon geomcp-ui-icon-popup-row-dot" src={UI_SVG_ASSETS.icons.tagPopupDot} alt="" draggable={false} aria-hidden="true" />
              <dt className="geomcp-osm-tags-popup-tag-key">{key}</dt>
              <dd className="geomcp-osm-tags-popup-tag-value">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <img className="geomcp-ui-decoration geomcp-ui-decoration-popup-record-divider" src={UI_SVG_ASSETS.decorations.tagBarEnd} alt="" draggable={false} aria-hidden="true" />
    </section>
  );
}

/** click-selected Feature 的稳定 OSM tags 详情；hover 不挂载或切换该 popup。 */
export function OsmTagsPopup({details, onClose}: OsmTagsPopupProps) {
  const featureOsmType = details.featureType === "node" ? "node" : "way";
  return (
    <InteractivePopup
      variant="feature"
      className={`geomcp-osm-tags-popup geomcp-osm-tags-popup-${details.featureType}`}
      ariaLabel={`OSM data for ${details.featureType} feature ${details.displayId}`}
      onClose={onClose}
      header={(
        <span className="geomcp-osm-tags-popup-title-group">
          <img className={`geomcp-ui-icon geomcp-ui-icon-osm-feature geomcp-ui-icon-osm-feature-${details.featureType}`} src={FEATURE_TYPE_ICONS[details.featureType]} alt="" draggable={false} aria-hidden="true" />
          <span className="geomcp-osm-tags-popup-title">{details.displayId}</span>
          <img className="geomcp-ui-icon geomcp-ui-icon-osm-tag" src={UI_SVG_ASSETS.icons.tag} alt="" draggable={false} aria-hidden="true" />
        </span>
      )}
    >
        <section className="geomcp-osm-tags-popup-section geomcp-osm-tags-popup-feature-section">
          <h3 className="geomcp-osm-tags-popup-section-title">
            <img className="geomcp-ui-icon geomcp-ui-icon-popup-section" src={UI_SVG_ASSETS.icons.volcano} alt="" draggable={false} aria-hidden="true" />
            <span>OSM Data</span>
          </h3>
          {details.sourceRecords.length === 0
            ? (
                <div className="geomcp-osm-tags-popup-empty-group">
                  <p className="geomcp-osm-tags-popup-osm-refs">{details.osmIds.map((osmId) => osmRef(featureOsmType, osmId)).join(" · ")}</p>
                  <p className="geomcp-osm-tags-popup-empty">No AI Output records are available for this map feature.</p>
                </div>
              )
            : details.sourceRecords.map((record) => <TagGroup record={record} key={`${record.osmType}/${record.osmId}`} />)}
        </section>

        {details.relations.length === 0 ? null : (
          <section className="geomcp-osm-tags-popup-section geomcp-osm-tags-popup-relations-section">
            <h3 className="geomcp-osm-tags-popup-section-title">Relations</h3>
            {details.relations.map((relation) => (
              <article className="geomcp-osm-tags-popup-relation" key={relation.featureId}>
                <header className="geomcp-osm-tags-popup-relation-header">
                  <span className="geomcp-osm-tags-popup-relation-id">{relation.displayId}</span>
                  {relation.role.length === 0 ? null : <span className="geomcp-osm-tags-popup-relation-role">role={relation.role}</span>}
                </header>
                <p className="geomcp-osm-tags-popup-osm-refs">{relation.osmIds.map((osmId) => osmRef("relation", osmId)).join(" · ")}</p>
                {relation.sourceRecords.length === 0
                  ? <p className="geomcp-osm-tags-popup-empty">Relation tags are unavailable.</p>
                  : relation.sourceRecords.map((record) => <TagGroup record={record} key={`${record.osmType}/${record.osmId}`} />)}
              </article>
            ))}
          </section>
        )}
    </InteractivePopup>
  );
}
