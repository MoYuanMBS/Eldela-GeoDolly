import nodeIconUrl from "../../../assets/ui/icons/node.svg";
import polygonIconUrl from "../../../assets/ui/icons/polygon.svg";
import tagIconUrl from "../../../assets/ui/icons/tag.svg";
import wayIconUrl from "../../../assets/ui/icons/way.svg";
import type {InteractiveFeatureDetailsType, InteractiveOsmTagGroupType} from "../../models/web/interactive-ui-models.js";

interface OsmTagsPopupProps {
  details: InteractiveFeatureDetailsType;
  onClose(): void;
}

const FEATURE_TYPE_ICONS = {
  node: nodeIconUrl,
  way: wayIconUrl,
  area: polygonIconUrl,
} as const;

function osmRef(osmType: InteractiveOsmTagGroupType["osmType"], osmId: number): string {
  const prefix = osmType === "node" ? "n" : osmType === "way" ? "w" : "r";
  return `${prefix}/${osmId}`;
}

function TagGroup({record}: {record: InteractiveOsmTagGroupType}) {
  const tags = Object.entries(record.tags).sort(([left], [right]) => left.localeCompare(right));
  return (
    <section className="osm-tags-popup-tag-group">
      <h4 className="osm-tags-popup-tag-group-title">{osmRef(record.osmType, record.osmId)}</h4>
      {tags.length === 0 ? <p className="osm-tags-popup-empty">No tags</p> : (
        <dl className="osm-tags-popup-tag-list">
          {tags.map(([key, value]) => (
            <div className="osm-tags-popup-tag-row" key={key}>
              <dt className="osm-tags-popup-tag-key">{key}</dt>
              <dd className="osm-tags-popup-tag-value">{value}</dd>
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
    <aside className={`osm-tags-popup osm-tags-popup-${details.featureType}`} aria-label={`OSM tags for ${details.featureType} feature ${details.displayId}`}>
      <header className="osm-tags-popup-header">
        <span className="osm-tags-popup-title-group">
          <img className={`osm-tags-popup-feature-icon osm-tags-popup-feature-icon-${details.featureType}`} src={FEATURE_TYPE_ICONS[details.featureType]} alt="" draggable={false} aria-hidden="true" />
          <span className="osm-tags-popup-title">{details.displayId}</span>
          <img className="osm-tags-popup-tag-icon" src={tagIconUrl} alt="" draggable={false} aria-hidden="true" />
        </span>
        <button className="osm-tags-popup-close" type="button" aria-label="Close OSM tags" onClick={onClose}>×</button>
      </header>

      <div className="osm-tags-popup-scroll">
        <section className="osm-tags-popup-section osm-tags-popup-feature-section">
          <h3 className="osm-tags-popup-section-title">OSM</h3>
          <p className="osm-tags-popup-osm-refs">
            {details.osmIds.map((osmId) => osmRef(featureOsmType, osmId)).join(" · ")}
          </p>
          {details.sourceRecords.length === 0
            ? <p className="osm-tags-popup-empty">No AI Output tags are available for this map feature.</p>
            : details.sourceRecords.map((record) => <TagGroup record={record} key={`${record.osmType}/${record.osmId}`} />)}
        </section>

        {details.relations.length === 0 ? null : (
          <section className="osm-tags-popup-section osm-tags-popup-relations-section">
            <h3 className="osm-tags-popup-section-title">Relations</h3>
            {details.relations.map((relation) => (
              <article className="osm-tags-popup-relation" key={relation.featureId}>
                <header className="osm-tags-popup-relation-header">
                  <span className="osm-tags-popup-relation-id">{relation.displayId}</span>
                  {relation.role.length === 0 ? null : <span className="osm-tags-popup-relation-role">role={relation.role}</span>}
                </header>
                <p className="osm-tags-popup-osm-refs">{relation.osmIds.map((osmId) => osmRef("relation", osmId)).join(" · ")}</p>
                {relation.sourceRecords.length === 0
                  ? <p className="osm-tags-popup-empty">Relation tags are unavailable.</p>
                  : relation.sourceRecords.map((record) => <TagGroup record={record} key={`${record.osmType}/${record.osmId}`} />)}
              </article>
            ))}
          </section>
        )}
      </div>
    </aside>
  );
}
