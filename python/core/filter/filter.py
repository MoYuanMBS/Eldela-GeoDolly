"""单个 OSM 对象的无状态 Filter 工具。"""

from typing import cast, TypeVar

from python.utils.internal_models.overpass import TagFilterRule

TagValue = TypeVar("TagValue", str, list[str])


def filter_include_tags(tags: dict[str, str], rules: TagFilterRule) -> bool:
    """正向筛选 tags；命中任意 pass 规则时返回原 tags。"""
    for key, value in tags.items():
        if key in rules.wildcard_keys or value in rules.values_by_key.get(key, set()):
            return True
    return False


def clean_tags(tags: dict[str, TagValue], rules: TagFilterRule) -> dict[str, TagValue]:
    """删除命中 remove tag 规则的 tags，并返回新的字典。"""
    cleaned_tags = tags.copy()
    for key, value in tags.items():
        if key in rules.wildcard_keys:
            cleaned_tags.pop(key)
            continue
        removed_values = rules.values_by_key.get(key, set())
        if isinstance(value, str):
            if value in removed_values:
                cleaned_tags.pop(key)
            continue
        remaining_values = [item for item in value if item not in removed_values]
        if remaining_values:
            cleaned_tags[key] = cast(TagValue, remaining_values)
        else:
            cleaned_tags.pop(key)
    return cleaned_tags


def clean_regex_tags(tags: dict[str, TagValue], rules: TagFilterRule) -> dict[str, TagValue]:
    """删除 key 被任一 regex 完整命中的 tags，并返回新的字典。"""
    cleaned_tags = tags.copy()
    for key in tags:
        if any(pattern.fullmatch(key) for pattern in rules.remove_tag_key_patterns):
            cleaned_tags.pop(key)
    return cleaned_tags


def filter_overlay_tags(tags: dict[str, TagValue], rules: TagFilterRule) -> dict[str, TagValue] | None:
    """清洗 Overlay 来源 tags；不执行低信息量对象删除。"""
    cleaned_tags = clean_regex_tags(clean_tags(tags, rules), rules)
    return cleaned_tags or None


def filter_output_tags(tags: dict[str, str], rules: TagFilterRule) -> dict[str, str] | None:
    """清洗 Output tags；无有效信息时返回 None。"""
    cleaned_tags = clean_regex_tags(clean_tags(tags, rules), rules)
    if not cleaned_tags:
        return None
    if all(value in rules.drop_if_only_tags.get(key, set()) for key, value in cleaned_tags.items()):
        return None
    return cleaned_tags
