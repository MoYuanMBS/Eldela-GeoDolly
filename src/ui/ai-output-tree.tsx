import type {AiOutputGroupsWithIdsType, AiOutputRecordWithIdsType} from "../models/backend/map-data-models.js";

interface AiOutputTreeProps {
  aiOutput: AiOutputGroupsWithIdsType;
}

type AiOutputGroupName = keyof AiOutputGroupsWithIdsType;

const AI_OUTPUT_GROUPS: ReadonlyArray<AiOutputGroupName> = ["node", "way", "relation"];

function AiOutputRecord({group, record}: {group: AiOutputGroupName; record: AiOutputRecordWithIdsType}) {
  // tags 是普通 JSON object；复制后排序可保证渲染稳定，又不会改写 session 数据。
  const tagEntries = Object.entries(record.tags).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  return (
    <details className="ai-output-record">
      <summary className="ai-output-record-summary">
        <span className="ai-output-record-kind">{group}</span>
        <span className="ai-output-record-id">{record.osm_id}</span>
      </summary>
      <dl className="ai-output-record-fields">
        <div className="ai-output-field-row">
          <dt>osm_id</dt>
          <dd>{record.osm_id}</dd>
        </div>
        {record.feature_id === undefined ? null : (
          <div className="ai-output-field-row">
            <dt>feature_id</dt>
            <dd>{record.feature_id}</dd>
          </div>
        )}
        {record.display_id === undefined ? null : (
          <div className="ai-output-field-row">
            <dt>display_id</dt>
            <dd>{record.display_id}</dd>
          </div>
        )}
        <div className="ai-output-field-row ai-output-tags-row">
          <dt>tags</dt>
          <dd>
            {tagEntries.length === 0 ? <span className="ai-output-empty-value">{"{}"}</span> : (
              <dl className="ai-output-tags">
                {tagEntries.map(([key, value]) => (
                  <div className="ai-output-tag-row" key={key}>
                    <dt>{key}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </dd>
        </div>
      </dl>
    </details>
  );
}

/** 直接保持后端 node → way → relation 分组；way record 不在浏览器侧推断为 area。 */
export function AiOutputTree({aiOutput}: AiOutputTreeProps) {
  return (
    <div className="ai-output-tree" aria-label="AI Output tree">
      {AI_OUTPUT_GROUPS.map((group) => {
        const records = aiOutput[group];
        return (
          <details className="ai-output-group" open key={group}>
            <summary className="ai-output-group-summary">
              <span>{group}</span>
              <span className="ai-output-group-count">{records.length}</span>
            </summary>
            <div className="ai-output-group-records">
              {records.length === 0 ? <span className="ai-output-empty-group">No records</span> : records.map((record, index) => (
                <AiOutputRecord group={group} record={record} key={`${group}/${record.osm_id}/${index}`} />
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}
