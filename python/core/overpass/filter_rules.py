"""Overpass / Filter 规则加载、合并与 tag filter 编译。"""

from __future__ import annotations

import json
import logging
from pathlib import Path
import sys
from typing import Any, ClassVar

from pydantic import ValidationError

if __package__ in (None, ""):
    sys.path.append(str(Path(__file__).resolve().parents[3]))

from python.utils.config_loader import config
from python.utils.internal_models.experts import ExpertConfig
from python.utils.internal_models.overpass import CompiledOverpassFilterRules, CompiledTagRuleSet, InternalFilterRulesConfig, TagRuleMap
from python.utils.models import TransferTypes

ANY_TAG_FILTER = '[~"."~"."]'
warning_logger = logging.getLogger("geomcp.warning")


class _OverpassRuleStore:
    """Overpass / Filter 规则存储。"""

    _instance: ClassVar["_OverpassRuleStore | None"] = None

    def __new__(cls):
        """保证规则存储在当前 Python 进程内只初始化一个实例。"""
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        if getattr(self, "_initialized", False):
            return
        self._internal_rules_path = Path(__file__).resolve().with_name("internal_rules.json")
        self.internal_config = self._load_internal_config()
        self.internal_rules = CompiledOverpassFilterRules(
            deny_object_rules=self._compile_tag_rules(self.internal_config.deny_object_rules),
            remove_tag_rules=self._compile_tag_rules(self.internal_config.remove_tag_rules),
        )
        self._initialized = True

    def _load_internal_config(self) -> InternalFilterRulesConfig:
        """读取并校验 internal_rules.json。"""
        try:
            with self._internal_rules_path.open("r", encoding="utf-8") as file:
                raw_rules: Any = json.load(file)
        except FileNotFoundError as error:
            raise TransferTypes.AppError(code="config_not_found", message=f"internal rules file not found: {self._internal_rules_path}") from error
        except json.JSONDecodeError as error:
            raise TransferTypes.AppError(code="invalid_config", message="internal_rules.json must be valid JSON") from error

        try:
            return InternalFilterRulesConfig.model_validate(raw_rules)
        except ValidationError as error:
            raise TransferTypes.AppError(code="invalid_config", message="internal_rules.json format error", details=str(error)) from error

    def _compile_tag_rules(self, raw_rules: TagRuleMap) -> CompiledTagRuleSet:
        """把 `key=["*", "value"]` 格式编译成 wildcard/exact 两类规则。"""
        wildcard_keys: set[str] = set()
        exact_values_by_key: dict[str, set[str]] = {}

        for key, values in raw_rules.items():
            if "*" in values:
                wildcard_keys.add(key)
                continue
            exact_values_by_key[key] = set(values)

        return CompiledTagRuleSet(wildcard_keys=wildcard_keys, exact_values_by_key=exact_values_by_key)


_rules = _OverpassRuleStore()


def _quote_ql_string(value: str) -> str:
    """把 tag key/value 安全写成 Overpass QL 双引号字符串。"""
    return json.dumps(value, ensure_ascii=False)


def _parse_tag_rule(tag_rule: str) -> tuple[str, str] | None:
    """解析 `key=*` 或 `key=value` 格式的 Base / Expert overpass tag。"""
    key, separator, value = tag_rule.partition("=")
    key = key.strip()
    value = value.strip()
    if not separator or not key or not value:
        warning_logger.warning(
            "skip_invalid_overpass_tag_rule",
            extra={"geomcp_extra": {"status": "skipped", "reason": "invalid_overpass_tag_rule", "tag_rule": tag_rule}}
        )
        return None
    return key, value


def _merge_tag_rule(target: CompiledTagRuleSet, key: str, value: str) -> None:
    """把单条 tag rule 合并进目标规则集合。"""
    if value == "*":
        target.wildcard_keys.add(key)
        target.exact_values_by_key.pop(key, None)
        return
    if key in target.wildcard_keys:
        return
    target.exact_values_by_key.setdefault(key, set()).add(value)


def merge_overpass_tags(rule_sources: list[ExpertConfig]) -> CompiledTagRuleSet:
    """合并 Base / Expert 的正向 overpass_tags。"""
    merged_rules = CompiledTagRuleSet()
    for rule_source in rule_sources:
        for tag_rule in rule_source.overpass_tags:
            parsed_rule = _parse_tag_rule(tag_rule)
            if parsed_rule is None:
                continue
            key, value = parsed_rule
            _merge_tag_rule(merged_rules, key, value)
    return merged_rules


def _remove_denied_positive_rules(include_rules: CompiledTagRuleSet, deny_rules: CompiledTagRuleSet) -> CompiledTagRuleSet:
    """用 internal deny_object_rules 裁剪正向 overpass_tags，deny 永远优先。"""
    merged_rules = CompiledTagRuleSet(
        wildcard_keys=set(include_rules.wildcard_keys),
        exact_values_by_key={key: set(values) for key, values in include_rules.exact_values_by_key.items()},
    )

    for key in deny_rules.wildcard_keys:
        if key in merged_rules.wildcard_keys or key in merged_rules.exact_values_by_key:
            warning_logger.warning(
                "skip_denied_positive_overpass_tag_rule",
                extra={"geomcp_extra": {"status": "skipped", "reason": "internal_deny_wildcard", "tag_key": key}}
            )
        merged_rules.wildcard_keys.discard(key)
        merged_rules.exact_values_by_key.pop(key, None)

    for key, denied_values in deny_rules.exact_values_by_key.items():
        if key not in merged_rules.exact_values_by_key:
            continue
        before_values = set(merged_rules.exact_values_by_key[key])
        merged_rules.exact_values_by_key[key] -= denied_values
        skipped_values = before_values - merged_rules.exact_values_by_key[key]
        for value in sorted(skipped_values):
            warning_logger.warning(
                "skip_denied_positive_overpass_tag_rule",
                extra={"geomcp_extra": {"status": "skipped", "reason": "internal_deny_exact", "tag_key": key, "tag_value": value}}
            )
        if not merged_rules.exact_values_by_key[key]:
            merged_rules.exact_values_by_key.pop(key)

    return merged_rules


def _build_deny_filter_fragment(deny_rules: CompiledTagRuleSet) -> str:
    """把 internal deny_object_rules 编译成可追加到 selector 的负向 filters。"""
    filters: list[str] = []
    for key in sorted(deny_rules.wildcard_keys):
        filters.append(f'[!{_quote_ql_string(key)}]')
    for key in sorted(deny_rules.exact_values_by_key):
        for value in sorted(deny_rules.exact_values_by_key[key]):
            filters.append(f'[{_quote_ql_string(key)}!={_quote_ql_string(value)}]')
    return "".join(filters)


def _build_positive_filter_fragments(include_rules: CompiledTagRuleSet) -> tuple[str, ...]:
    """把 Base / Expert 正向 overpass_tags 编译成 selector filter 片段。"""
    filters: list[str] = []
    for key in sorted(include_rules.wildcard_keys):
        filters.append(f'[{_quote_ql_string(key)}]')
    for key in sorted(include_rules.exact_values_by_key):
        values = include_rules.exact_values_by_key[key]
        if len(values) == 1:
            value = next(iter(values))
            filters.append(f'[{_quote_ql_string(key)}={_quote_ql_string(value)}]')
        else:
            filters.append(f'[{_quote_ql_string(key)}]')
    return tuple(filters)


def build_core_tag_filters() -> tuple[str, ...]:
    """构建 Core 查询使用的 Overpass tag filters。"""
    return (ANY_TAG_FILTER + _build_deny_filter_fragment(_rules.internal_rules.deny_object_rules),)


def build_bbox_tag_filters(experts: list[str] | None = None, include_base: bool = True) -> tuple[str, ...]:
    """构建 BBox / context 查询使用的 Overpass tag filters。"""
    rule_sources: list[ExpertConfig] = []
    if include_base:
        rule_sources.append(config.get_base())
    if experts:
        rule_sources.extend(config.get_experts(experts).values())
    if not rule_sources:
        raise TransferTypes.AppError(code="overpass_invalid_query", message="bbox Overpass query requires base or expert overpass tags")

    positive_rules = _remove_denied_positive_rules(merge_overpass_tags(rule_sources), _rules.internal_rules.deny_object_rules)
    positive_filters = _build_positive_filter_fragments(positive_rules)
    if not positive_filters:
        raise TransferTypes.AppError(code="overpass_invalid_query", message="bbox Overpass query requires at least one positive tag filter")

    deny_filter = _build_deny_filter_fragment(_rules.internal_rules.deny_object_rules)
    return tuple(f"{positive_filter}{deny_filter}" for positive_filter in positive_filters)

if __name__ == "__main__":
    print("Core tag filters:")
    print(build_core_tag_filters())

    print("\nBBox tag filters with base only:")
    print(build_bbox_tag_filters())

    print("\nBBox tag filters with base + example_expert:")
    print(build_bbox_tag_filters(experts=["example_expert"]))

    print("\nBBox tag filters with example_expert only:")
    print(build_bbox_tag_filters(experts=["example_expert"], include_base=False))

