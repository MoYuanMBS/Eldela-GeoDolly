"""单个 OSM 对象的无状态 Filter 工具。"""

from python.utils.internal_models.overpass import TagFilterRule


def filter_include_tags(tags: dict[str, str], rules: TagFilterRule) -> bool:
    """正向筛选 tags；命中任意 pass 规则时返回原 tags。"""
    for key, value in tags.items():
        if key in rules.wildcard_keys or value in rules.values_by_key.get(key, set()):
            return True
    return False


def clean_tags(tags: dict[str, str], rules: TagFilterRule) -> dict[str, str]:
    """删除命中 remove tag 规则的 tags，并返回新的字典。"""
    cleaned_tags = tags.copy()
    for key, value in tags.items():
        if key in rules.wildcard_keys or value in rules.values_by_key.get(key, set()):
            cleaned_tags.pop(key)
    return cleaned_tags


def filter_output_tags(tags: dict[str, str], rules: TagFilterRule) -> dict[str, str] | None:
    """清洗 Output tags；无有效信息时返回 None。"""
    cleaned_tags = clean_tags(tags, rules)
    if not cleaned_tags:
        return None
    if all(value in rules.drop_if_only_tags.get(key, set()) for key, value in cleaned_tags.items()):
        return None
    return cleaned_tags
