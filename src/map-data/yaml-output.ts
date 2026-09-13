/**
 * 把 enrichment 后的 AI Output 投影为 AI-facing YAML。
 *
 * 本模块只消费 AI Output 与 info，不读取 Overlay 或 typed OSM context。
 */

import {Document, isSeq} from "yaml";

import type {
  AiOutputGroupsWithIdsType,
  AiOutputRecordWithIdsType,
} from "../models/backend/map-data-models.js";

/** lookup key → 按目标顺序插入且自动去重的 canonical refs。 */
type LookupRefs = Map<string, Set<string>>;

/** 该顺序同时决定 records 分组、canonical ref 前缀和每个 lookup value 的类型优先级。 */
const OSM_GROUPS = [
  {name: "node", refPrefix: "n"},
  {name: "way", refPrefix: "w"},
  {name: "relation", refPrefix: "r"},
] as const;

/** 按 Unicode scalar value 比较；逐个读取 code point，避免为每次比较创建完整数组。 */
function compareUnicodeScalarValues(left: string, right: string): number {
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftScalar = left.codePointAt(leftIndex)!;
    const rightScalar = right.codePointAt(rightIndex)!;
    const difference = leftScalar - rightScalar;
    if (difference !== 0) return difference;
    leftIndex += leftScalar > 0xffff ? 2 : 1;
    rightIndex += rightScalar > 0xffff ? 2 : 1;
  }
  if (leftIndex < left.length) return 1;
  if (rightIndex < right.length) return -1;
  return 0;
}

/** 缺少对应字段时不建立 lookup；Set 只消除完全相同的 canonical ref。 */
function addLookupRef(lookup: LookupRefs, key: string | undefined, ref: string): void {
  if (key === undefined) return;
  const refs = lookup.get(key);
  if (refs === undefined) {
    lookup.set(key, new Set([ref]));
  } else {
    refs.add(ref);
  }
}

/** 只排序 lookup 的动态 key，不重新排列已经按 OSM 类型和 ID 插入的 refs。 */
function sortLookup(lookup: LookupRefs): Map<string, Array<string>> {
  return new Map(
    [...lookup.entries()]
      .sort(([left], [right]) => compareUnicodeScalarValues(left, right))
      // 主遍历已按 node → way → relation、同类型 osm_id 升序，Set 保持该插入顺序并负责去重。
      .map(([key, refs]) => [key, [...refs]]),
  );
}

/** osm_id 提升为外层 mapping key；内部字段固定为 display_id → feature_id → tags。 */
function projectRecord(record: AiOutputRecordWithIdsType): {
  display_id?: string;
  feature_id?: string;
  tags: Record<string, string>;
} {
  return {
    ...(record.display_id === undefined ? {} : {display_id: record.display_id}),
    ...(record.feature_id === undefined ? {} : {feature_id: record.feature_id}),
    tags: {...record.tags},
  };
}

/**
 * 生成只包含 lookup、records 与 info 的 YAML 文本。
 * records 的 osm_id 被提升为 mapping key；输入对象及其 records/tags 均不会被修改。
 */
export function generateAiOutputYaml(aiOutput: AiOutputGroupsWithIdsType, info: string): string {
  const displayLookup: LookupRefs = new Map();
  const nameLookup: LookupRefs = new Map();
  const featureLookup: LookupRefs = new Map();
  const records = {
    node: new Map<string, ReturnType<typeof projectRecord>>(),
    way: new Map<string, ReturnType<typeof projectRecord>>(),
    relation: new Map<string, ReturnType<typeof projectRecord>>(),
  };

  for (const group of OSM_GROUPS) {
    // 在副本上排序，既保证 records 数值顺序，也不修改调用方持有的原始数组。
    const sortedRecords = [...aiOutput[group.name]].sort((left, right) => left.osm_id - right.osm_id);
    for (const record of sortedRecords) {
      const canonicalRef = `${group.refPrefix}/${record.osm_id}`;
      records[group.name].set(String(record.osm_id), projectRecord(record));
      addLookupRef(displayLookup, record.display_id, canonicalRef);
      addLookupRef(nameLookup, record.tags.name, canonicalRef);
      addLookupRef(featureLookup, record.feature_id, canonicalRef);
    }
  }

  const lookup = {
    display: sortLookup(displayLookup),
    name: sortLookup(nameLookup),
    feature: sortLookup(featureLookup),
  };
  // Map 保留上述构造顺序，并安全承载任意字符串 lookup key。
  const document = new Document({lookup, records, info});

  // 只把 lookup value 标记为 flow sequence；records 和 tags 继续使用普通 block mapping。
  for (const lookupName of ["display", "name", "feature"] as const) {
    for (const key of lookup[lookupName].keys()) {
      const sequence = document.getIn(["lookup", lookupName, key], true);
      if (isSeq(sequence)) sequence.flow = true;
    }
  }

  // 禁止 flow list 内侧填充和普通长字符串的自动折行，字符串样式仍交由 YAML 库决定。
  return document.toString({flowCollectionPadding: false, lineWidth: 0});
}
