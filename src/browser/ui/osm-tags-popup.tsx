import {UI_SVG_ASSETS} from "../built-in-config/ui-svg.js";
import type {InteractiveFeatureDetailsType, InteractiveOsmTagGroupType, InteractiveRelationDetailsType} from "../../models/web/interactive-ui-models.js";
import {Popup} from "./popup.js";

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

function formatTagText(text: string): string {
  // 只转换显示文本；AI record、React key 和 OSM identity 始终保留原值，星号不替换。
  return text.replace(/_/g, "-").replace(/[-:\/|;,@]/g, "$&\u200b");
}

function SectionTitle({children}: {children: string}) {
  return (
    <h3 className="geomcp-popup-section-title">
      <img className="geomcp-ui-icon geomcp-ui-icon-popup-section" src={UI_SVG_ASSETS.icons.volcano} alt="" draggable={false} aria-hidden="true" />
      <span>{children}</span>
    </h3>
  );
}

interface TagGroupProps {
  record: InteractiveOsmTagGroupType;
  role?: string;
  emptyMessage?: string;
}

function TagGroup({record, role = "", emptyMessage = "No tags"}: TagGroupProps) {
  // AI Output record 保持自己的 OSM ref 和 tags；role 只属于当前 relation attachment。
  const tags = Object.entries(record.tags);
  return (
    <section className="geomcp-popup-record">
      {role.length === 0 ? null : (
        <dl className="geomcp-popup-values geomcp-popup-relation-role-values">
          <div className="geomcp-popup-row geomcp-popup-relation-role-row">
            <dt className="geomcp-popup-row-key">role</dt>
            <dd className="geomcp-popup-row-value">{formatTagText(role)}</dd>
          </div>
        </dl>
      )}
      <h4 className="geomcp-popup-record-title">{osmRef(record.osmType, record.osmId)}</h4>
      {tags.length === 0 ? <p className="geomcp-popup-message">{emptyMessage}</p> : (
        <dl className="geomcp-popup-values">
          {tags.map(([key, value]) => (
            <div className="geomcp-popup-row" key={key}>
              <img className="geomcp-ui-icon geomcp-ui-icon-popup-row-dot" src={UI_SVG_ASSETS.icons.tagPopupDot} alt="" draggable={false} aria-hidden="true" />
              <dt className="geomcp-popup-row-key">{formatTagText(key)}</dt>
              <dd className="geomcp-popup-row-value">{formatTagText(value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function RelationGroups({relation}: {relation: InteractiveRelationDetailsType}) {
  if (relation.sourceRecords.length !== 0) {
    return relation.sourceRecords.map((record) => (
      <TagGroup record={record} role={relation.role} key={`${relation.featureId}/${record.osmType}/${record.osmId}`} />
    ));
  }

  // Relation AI record 缺失时仍逐个展示 Overlay 提供的 OSM ref 和成员 role，不伪造 tags。
  return relation.osmIds.map((osmId) => (
    <TagGroup
      record={{osmType: "relation", osmId, tags: {}}}
      role={relation.role}
      emptyMessage="Relation tags are unavailable."
      key={`${relation.featureId}/relation/${osmId}`}
    />
  ));
}

/** click-selected Feature 的稳定 OSM tags 详情；hover 不挂载或切换该 Popup。 */
export function OsmTagsPopup({details, onClose}: OsmTagsPopupProps) {
  const featureOsmType = details.featureType === "node" ? "node" : "way";
  return (
    <Popup
      variant="feature"
      className={`geomcp-popup-feature-${details.featureType}`}
      ariaLabel={`OSM data for ${details.featureType} feature ${details.displayId}`}
      onClose={onClose}
      header={(
        <span className="geomcp-popup-title-group">
          <span className="geomcp-ui-icon-slot geomcp-ui-icon-slot-popup-feature" aria-hidden="true">
            <img className="geomcp-ui-effect geomcp-ui-effect-feature" src={UI_SVG_ASSETS.hover.feature} alt="" draggable={false} />
            <img className={`geomcp-ui-icon geomcp-ui-icon-osm-feature geomcp-ui-icon-osm-feature-${details.featureType}`} src={FEATURE_TYPE_ICONS[details.featureType]} alt="" draggable={false} />
          </span>
          <span className="geomcp-popup-title">{details.displayId}</span>
          <img className="geomcp-ui-icon geomcp-ui-icon-osm-tag" src={UI_SVG_ASSETS.icons.tag} alt="" draggable={false} aria-hidden="true" />
        </span>
      )}
    >
      <section className="geomcp-popup-section">
        <SectionTitle>OSM Data</SectionTitle>
        {details.sourceRecords.length === 0
          ? (
              <section className="geomcp-popup-record">
                <h4 className="geomcp-popup-record-title">{details.osmIds.map((osmId) => osmRef(featureOsmType, osmId)).join(" · ")}</h4>
                <p className="geomcp-popup-message">No AI Output records are available for this map feature.</p>
              </section>
            )
          : details.sourceRecords.map((record) => <TagGroup record={record} key={`${record.osmType}/${record.osmId}`} />)}
      </section>

      {details.relations.length === 0 ? null : (
        <section className="geomcp-popup-section">
          <SectionTitle>Relations</SectionTitle>
          {details.relations.map((relation) => <RelationGroups relation={relation} key={relation.featureId} />)}
        </section>
      )}
    </Popup>
  );
}
