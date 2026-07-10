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
        exact_rules: set[tuple[str, str]] = set()

        for key, values in raw_rules.items():
            if "*" in values:
                wildcard_keys.add(key)
                continue
            for value in values:
                exact_rules.add((key, value))

        return CompiledTagRuleSet(wildcard_keys=wildcard_keys, exact_rules=exact_rules)

def _quote_ql_string(value: str) -> str:
    """把 tag key/value 安全写成 Overpass QL 双引号字符串。"""
    return json.dumps(value, ensure_ascii=False)


class FilterRuleContext:
    """一次 Overpass / Filter 流程内可复用的合并规则上下文。"""

    def __init__(self, experts: list[str] | None = None, include_base: bool = True):
        self.config = config
        self.rule_store = _OverpassRuleStore()
        self.expert_names: list[str] = list(experts or [])
        self.include_base = include_base
        base_config = self.config.get_base() if include_base else None
        expert_configs = list(self.config.get_experts(self.expert_names).values()) if self.expert_names else []

        # 只缓存四组“已经合并好、后续会复用”的规则。
        self.deny_object_rules = self.rule_store.internal_rules.deny_object_rules
        self.context_overpass_rules = self._block_by_internal_rules(self._merge_base_expert_overpass_rules(base_config, expert_configs))
        self.overlay_rules = self._merge_base_expert_overlay_rules(base_config, expert_configs)
        self.output_remove_tag_rules = self._merge_output_remove_tag_rules()

    def _parse_tag_rule(self, tag_rule: str) -> tuple[str, str] | None:
        """解析 `key=*` 或 `key=value` 格式的 tag rule。"""
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

    def _merge_tag_rule(self, target: CompiledTagRuleSet, key: str, value: str) -> None:
        """把单条 tag rule 合并进目标规则集合。"""
        if value == "*":
            target.wildcard_keys.add(key)
            target.exact_rules = {rule for rule in target.exact_rules if rule[0] != key}
            return
        if key in target.wildcard_keys:
            return
        target.exact_rules.add((key, value))

    def _merge_tag_strings(self, tag_rules: list[str]) -> CompiledTagRuleSet:
        """合并 `key=*` / `key=value` 字符串规则。"""
        merged_rules = CompiledTagRuleSet()
        for tag_rule in tag_rules:
            parsed_rule = self._parse_tag_rule(tag_rule)
            if parsed_rule is None:
                continue
            key, value = parsed_rule
            self._merge_tag_rule(merged_rules, key, value)
        return merged_rules

    def _merge_compiled_rules(self, target: CompiledTagRuleSet, source: CompiledTagRuleSet) -> None:
        """把已编译规则合并进目标规则集合。"""
        for key in source.wildcard_keys:
            self._merge_tag_rule(target, key, "*")
        for key, value in source.exact_rules:
            self._merge_tag_rule(target, key, value)

    def _merge_raw_tag_rule_map(self, target: CompiledTagRuleSet, raw_rules: object) -> None:
        """合并 filters.yaml 这类 raw `key: [values]` 规则。"""
        if not isinstance(raw_rules, dict):
            return
        for key, values in raw_rules.items():
            if not isinstance(key, str) or not isinstance(values, list):
                warning_logger.warning(
                    "skip_invalid_filter_tag_rule",
                    extra={"geomcp_extra": {"status": "skipped", "reason": "invalid_filter_tag_rule", "tag_key": key}}
                )
                continue
            for value in values:
                if not isinstance(value, str):
                    warning_logger.warning(
                        "skip_invalid_filter_tag_rule",
                        extra={"geomcp_extra": {"status": "skipped", "reason": "invalid_filter_tag_value", "tag_key": key, "tag_value": value}}
                    )
                    continue
                self._merge_tag_rule(target, key, value)

    def _remove_denied_rules(self, include_rules: CompiledTagRuleSet, deny_rules: CompiledTagRuleSet) -> CompiledTagRuleSet:
        """反向屏蔽某一组 tag rules。"""
        merged_rules = CompiledTagRuleSet(
            wildcard_keys=set(include_rules.wildcard_keys),
            exact_rules=set(include_rules.exact_rules),
        )

        for key in deny_rules.wildcard_keys:
            if key in merged_rules.wildcard_keys or any(rule_key == key for rule_key, _ in merged_rules.exact_rules):
                warning_logger.warning(
                    "skip_denied_positive_overpass_tag_rule",
                    extra={"geomcp_extra": {"status": "skipped", "reason": "internal_deny_wildcard", "tag_key": key}}
                )
            merged_rules.wildcard_keys.discard(key)
            merged_rules.exact_rules = {rule for rule in merged_rules.exact_rules if rule[0] != key}

        for key, denied_value in deny_rules.exact_rules:
            denied_rule = (key, denied_value)
            if denied_rule not in merged_rules.exact_rules:
                continue
            merged_rules.exact_rules.discard(denied_rule)
            warning_logger.warning(
                "skip_denied_positive_overpass_tag_rule",
                extra={"geomcp_extra": {"status": "skipped", "reason": "internal_deny_exact", "tag_key": key, "tag_value": denied_value}}
            )

        return merged_rules

    def _merge_expert_overpass_rules(self, expert_configs: list[ExpertConfig]) -> CompiledTagRuleSet:
        """合并 Expert overpass_tags。"""
        merged_rules = CompiledTagRuleSet()
        for expert_config in expert_configs:
            self._merge_compiled_rules(merged_rules, self._merge_tag_strings(expert_config.overpass_tags))
        return merged_rules

    def _merge_base_expert_overpass_rules(self, base_config: ExpertConfig | None, expert_configs: list[ExpertConfig]) -> CompiledTagRuleSet:
        """合并 Base / Expert overpass_tags。"""
        merged_rules = CompiledTagRuleSet()
        if base_config is not None:
            self._merge_compiled_rules(merged_rules, self._merge_tag_strings(base_config.overpass_tags))
        self._merge_compiled_rules(merged_rules, self._merge_expert_overpass_rules(expert_configs))
        return merged_rules

    def _merge_base_expert_overlay_rules(self, base_config: ExpertConfig | None, expert_configs: list[ExpertConfig]) -> CompiledTagRuleSet:
        """合并 Base / Expert overlay_rules。"""
        overlay_matches: list[str] = []
        if base_config is not None:
            overlay_matches.extend(rule.match for rule in base_config.overlay_rules)
        for expert_config in expert_configs:
            overlay_matches.extend(rule.match for rule in expert_config.overlay_rules)
        return self._merge_tag_strings(overlay_matches)

    def _merge_output_remove_tag_rules(self) -> CompiledTagRuleSet:
        """合并 filters.yaml 与 internal remove_tag_rules。"""
        merged_rules = CompiledTagRuleSet()
        self._merge_raw_tag_rule_map(merged_rules, self.config.filters.raw.get("remove_tag_rules"))
        self._merge_compiled_rules(merged_rules, self.rule_store.internal_rules.remove_tag_rules)
        return merged_rules

    def _block_by_internal_rules(self, include_rules: CompiledTagRuleSet) -> CompiledTagRuleSet:
        """使用 _OverpassRuleStore 的 deny_object_rules 屏蔽正向 rules。"""
        return self._remove_denied_rules(include_rules, self.deny_object_rules)

def _build_deny_filter_fragment(deny_rules: CompiledTagRuleSet) -> str:
    """把 deny_object_rules 编译成可追加到 selector 的负向 filters。"""
    filters: list[str] = []
    for key in sorted(deny_rules.wildcard_keys):
        filters.append(f'[!{_quote_ql_string(key)}]')
    for key, value in sorted(deny_rules.exact_rules):
        filters.append(f'[{_quote_ql_string(key)}!={_quote_ql_string(value)}]')
    return "".join(filters)


def _build_positive_filter_fragments(include_rules: CompiledTagRuleSet) -> tuple[str, ...]:
    """把正向 rules 编译成 selector filter 片段。"""
    filters: list[str] = []
    for key in sorted(include_rules.wildcard_keys):
        filters.append(f'[{_quote_ql_string(key)}]')
    for key, value in sorted(include_rules.exact_rules):
        filters.append(f'[{_quote_ql_string(key)}={_quote_ql_string(value)}]')
    return tuple(filters)


def build_overpass_tag_filters(rule_context: FilterRuleContext, use_any_tag: bool = False, use_context_rules: bool = False) -> tuple[str, ...]:
    """构建 Overpass selector tag filters；deny_object_rules 强制追加。"""
    deny_filter = _build_deny_filter_fragment(rule_context.deny_object_rules)

    if use_any_tag:
        return (ANY_TAG_FILTER + deny_filter,)

    if not use_context_rules:
        return (deny_filter,)

    positive_filters = _build_positive_filter_fragments(rule_context.context_overpass_rules)
    if not positive_filters:
        raise TransferTypes.AppError(code="overpass_invalid_query", message="context Overpass query requires at least one positive tag filter")
    return tuple(f"{positive_filter}{deny_filter}" for positive_filter in positive_filters)

if __name__ == "__main__":
    base_context = FilterRuleContext()
    expert_context = FilterRuleContext(experts=["example_expert"])

    print("Core tag filters:")
    print(build_overpass_tag_filters(base_context, use_any_tag=True))

    print("\nBBox tag filters with base only:")
    print(build_overpass_tag_filters(base_context, use_context_rules=True))

    print("\nBBox tag filters with base + example_expert:")
    print(build_overpass_tag_filters(expert_context, use_context_rules=True))

    print("\nParent relation tag filters:")
    print(build_overpass_tag_filters(expert_context))
