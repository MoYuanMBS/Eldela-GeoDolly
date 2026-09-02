import {UI_SVG_ASSETS} from "../built-in-config/ui-svg.js";
import type {InteractiveFeatureDetailsType, InteractiveOsmTagGroupType} from "../models/web/interactive-ui-models.js";

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
  const tags = Object.entries(record.tags).sort(([left], [right]) => left.localeCompare(right));
  return (
    <section className="geomcp-osm-tags-popup-tag-group">
      <h4 className="geomcp-osm-tags-popup-tag-group-title">{osmRef(record.osmType, record.osmId)}</h4>
      {tags.length === 0 ? <p className="geomcp-osm-tags-popup-empty">No tags</p> : (
        <dl className="geomcp-osm-tags-popup-tag-list">
          {tags.map(([key, value]) => (
            <div className="geomcp-osm-tags-popup-tag-row" key={key}>
              <dt className="geomcp-osm-tags-popup-tag-key">{key}</dt>
              <dd className="geomcp-osm-tags-popup-tag-value">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

/** click-selected Feature 的稳定 OSM tags 详情；hover 不挂载或切换该 popup。 */
export function OsmTagsPopup({details, onClose}: OsmTagsPopupProps) {
  const featureOsmType = details.featureType === "node" ? "node" : "way";
  return (
    <aside className={`geomcp-osm-tags-popup geomcp-osm-tags-popup-${details.featureType}`} aria-label={`OSM tags for ${details.featureType} feature ${details.displayId}`}>
      <header className="geomcp-osm-tags-popup-header">
        <span className="geomcp-osm-tags-popup-title-group">
          <img className={`geomcp-ui-icon geomcp-ui-icon-osm-feature geomcp-ui-icon-osm-feature-${details.featureType}`} src={FEATURE_TYPE_ICONS[details.featureType]} alt="" draggable={false} aria-hidden="true" />
          <span className="geomcp-osm-tags-popup-title">{details.displayId}</span>
          <img className="geomcp-ui-icon geomcp-ui-icon-osm-tag" src={UI_SVG_ASSETS.icons.tag} alt="" draggable={false} aria-hidden="true" />
        </span>
        <button className="geomcp-osm-tags-popup-close" type="button" aria-label="Close OSM tags" onClick={onClose}>×</button>
      </header>

      <div className="geomcp-osm-tags-popup-scroll">
        <section className="geomcp-osm-tags-popup-section geomcp-osm-tags-popup-feature-section">
          <h3 className="geomcp-osm-tags-popup-section-title">OSM</h3>
          <p className="geomcp-osm-tags-popup-osm-refs">
            {details.osmIds.map((osmId) => osmRef(featureOsmType, osmId)).join(" · ")}
          </p>
          {details.sourceRecords.length === 0
            ? <p className="geomcp-osm-tags-popup-empty">No AI Output tags are available for this map feature.</p>
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
      </div>
    </aside>
  );
}
