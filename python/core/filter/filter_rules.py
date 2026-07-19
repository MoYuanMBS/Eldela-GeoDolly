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
from python.utils.internal_models.overpass import TagAnnotationReplacement, TagAnnotationRules, TagFilterRule, OverpassFilterRule, InternalFilterRulesConfig, TagRuleMap
from python.utils.models import TransferTypes

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
        deny_rules = self._compile_tag_rules(self.internal_config.deny_object_rules)
        deny_exact_rules: set[tuple[str, str]] = set()
        for key, values in deny_rules.values_by_key.items():
            for value in values:
                deny_exact_rules.add((key, value))
        self.deny_object_rules = OverpassFilterRule(
            deny_wildcard_keys=deny_rules.wildcard_keys,
            deny_exact_rules=deny_exact_rules,
        )
        self.remove_tag_rules = self._compile_tag_rules(self.internal_config.remove_tag_rules)
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

    def _compile_tag_rules(self, raw_rules: TagRuleMap) -> TagFilterRule:
        """把 `key=["*", "value"]` 格式编译成 filter 侧 key 聚合规则。"""
        wildcard_keys: set[str] = set()
        values_by_key: dict[str, set[str]] = {}

        for key, values in raw_rules.items():
            if "*" in values:
                wildcard_keys.add(key)
                continue
            for value in values:
                values_by_key.setdefault(key, set()).add(value)

        return TagFilterRule(wildcard_keys=wildcard_keys, values_by_key=values_by_key)

class FilterRuleContext:
    """一次 Overpass / Filter 流程内可复用的合并规则上下文。"""

    def __init__(self, experts: list[str] | None = None, include_base: bool = True):
        self.config = config
        self.rule_store = _OverpassRuleStore()
        self.expert_names: list[str] = list(experts or [])
        self.include_base = include_base
        base_config = self.config.get_base() if include_base else None
        expert_configs = list(self.config.get_experts(self.expert_names).values()) if self.expert_names else []

        # 缓存已经合并好、后续会复用的规则。
        self.deny_object_rules = self.rule_store.deny_object_rules
        self.context_overpass_rules = self._merge_context_overpass_rules(base_config, expert_configs)
        self.parent_relation_rules = self._merge_expert_overpass_rules(expert_configs)
        self.overlay_rules = self._merge_base_expert_overlay_rules(base_config, expert_configs)
        self.output_remove_tag_rules = self._merge_output_remove_tag_rules()
        self.tag_annotations = self._merge_expert_tag_annotations(expert_configs)

    def _parse_tag_rule(self, tag_rule: str, rule_source: str) -> tuple[str, str] | None:
        """解析 `key=*` 或 `key=value` 格式的 tag rule。"""
        key, separator, value = tag_rule.partition("=")
        key = key.strip()
        value = value.strip()
        if not separator or not key or not value:
            warning_logger.warning(
                "skip_invalid_tag_rule",
                extra={"geomcp_extra": {"status": "skipped", "reason": "invalid_tag_rule", "rule_source": rule_source, "tag_rule": tag_rule}}
            )
            return None
        return key, value

    def _merge_tag_rule(self, target: TagFilterRule, key: str, value: str) -> None:
        """把单条 tag rule 合并进目标规则集合。"""
        if value == "*":
            target.wildcard_keys.add(key)
            target.values_by_key.pop(key, None)
            return
        if key in target.wildcard_keys:
            return
        target.values_by_key.setdefault(key, set()).add(value)

    def _merge_tag_strings(self, tag_rules: list[str], rule_source: str) -> TagFilterRule:
        """合并 `key=*` / `key=value` 字符串规则。"""
        merged_rules = TagFilterRule()
        for tag_rule in tag_rules:
            parsed_rule = self._parse_tag_rule(tag_rule, rule_source)
            if parsed_rule is None:
                continue
            key, value = parsed_rule
            self._merge_tag_rule(merged_rules, key, value)
        return merged_rules

    def _merge_compiled_rules(self, target: TagFilterRule, source: TagFilterRule) -> None:
        """把已编译规则合并进目标规则集合。"""
        for key in source.wildcard_keys:
            self._merge_tag_rule(target, key, "*")
        for key, values in source.values_by_key.items():
            for value in values:
                self._merge_tag_rule(target, key, value)

    def _remove_denied_rules(self, include_rules: TagFilterRule, deny_rules: TagFilterRule) -> TagFilterRule:
        """反向屏蔽某一组 tag rules。"""
        merged_rules = TagFilterRule(
            wildcard_keys=set(include_rules.wildcard_keys),
            values_by_key={key: set(values) for key, values in include_rules.values_by_key.items()},
        )

        for key in deny_rules.wildcard_keys:
            if key in merged_rules.wildcard_keys or key in merged_rules.values_by_key:
                warning_logger.warning(
                    "skip_denied_positive_overpass_tag_rule",
                    extra={"geomcp_extra": {"status": "skipped", "reason": "internal_deny_wildcard", "tag_key": key}}
                )
            merged_rules.wildcard_keys.discard(key)
            merged_rules.values_by_key.pop(key, None)

        for key, denied_values in deny_rules.values_by_key.items():
            if key not in merged_rules.values_by_key:
                continue
            before_values = set(merged_rules.values_by_key[key])
            merged_rules.values_by_key[key] -= denied_values
            skipped_values = before_values - merged_rules.values_by_key[key]
            for value in sorted(skipped_values):
                warning_logger.warning(
                    "skip_denied_positive_overpass_tag_rule",
                    extra={"geomcp_extra": {"status": "skipped", "reason": "internal_deny_exact", "tag_key": key, "tag_value": value}}
                )
            if not merged_rules.values_by_key[key]:
                merged_rules.values_by_key.pop(key)

        return merged_rules

    def _overpass_deny_as_tag_rules(self) -> TagFilterRule:
        """把 Overpass deny 规则临时转换为 tag rules，供正向规则裁剪使用。"""
        deny_values_by_key: dict[str, set[str]] = {}
        for key, value in self.deny_object_rules.deny_exact_rules:
            deny_values_by_key.setdefault(key, set()).add(value)
        return TagFilterRule(
            wildcard_keys=set(self.deny_object_rules.deny_wildcard_keys),
            values_by_key=deny_values_by_key,
        )

    def _merge_expert_overpass_rules(self, expert_configs: list[ExpertConfig]) -> TagFilterRule:
        """合并 Expert overpass_tags。"""
        merged_rules = TagFilterRule()
        for expert_config in expert_configs:
            self._merge_compiled_rules(merged_rules, self._merge_tag_strings(expert_config.overpass_tags, "expert.overpass_tags"))
        return merged_rules

    def _merge_base_expert_overpass_rules(self, base_config: ExpertConfig | None, expert_configs: list[ExpertConfig]) -> TagFilterRule:
        """合并 Base / Expert overpass_tags。"""
        merged_rules = TagFilterRule()
        if base_config is not None:
            self._merge_compiled_rules(merged_rules, self._merge_tag_strings(base_config.overpass_tags, "base.overpass_tags"))
        self._merge_compiled_rules(merged_rules, self._merge_expert_overpass_rules(expert_configs))
        return merged_rules

    def _merge_base_expert_overlay_rules(self, base_config: ExpertConfig | None, expert_configs: list[ExpertConfig]) -> TagFilterRule:
        """合并 Base / Expert overlay_rules。"""
        overlay_matches: list[str] = []
        if base_config is not None:
            overlay_matches.extend(rule.match for rule in base_config.overlay_rules)
        for expert_config in expert_configs:
            overlay_matches.extend(rule.match for rule in expert_config.overlay_rules)
        return self._merge_tag_strings(overlay_matches, "overlay_rules")

    def _merge_output_remove_tag_rules(self) -> TagFilterRule:
        """合并 filters.yaml 与 internal remove_tag_rules。"""
        merged_rules = TagFilterRule()
        self._merge_compiled_rules(merged_rules, self._merge_tag_strings(self.config.filters.remove_tags, "filters.remove_tags"))
        self._merge_compiled_rules(merged_rules, self.rule_store.remove_tag_rules)
        # drop_if_only_tags 只来自 filters.yaml，独立编译后直接放入，不参与任何 tag rules merge。
        merged_rules.drop_if_only_tags = self._compile_drop_if_only_tags(self.config.filters.drop_if_only_tags)
        return merged_rules

    def _compile_drop_if_only_tags(self, tag_rules: list[str]) -> dict[str, set[str]]:
        """独立编译低信息量对象规则；只接受精确 `key=value`。"""
        values_by_key: dict[str, set[str]] = {}
        for tag_rule in tag_rules:
            parsed_rule = self._parse_tag_rule(tag_rule, "filters.drop_if_only_tags")
            if parsed_rule is None:
                continue
            key, value = parsed_rule
            if value == "*":
                warning_logger.warning(
                    "skip_invalid_tag_rule",
                    extra={"geomcp_extra": {"status": "skipped", "reason": "wildcard_not_allowed", "rule_source": "filters.drop_if_only_tags", "tag_rule": tag_rule}}
                )
                continue
            values_by_key.setdefault(key, set()).add(value)
        return values_by_key

    def _merge_context_overpass_rules(self, base_config: ExpertConfig | None, expert_configs: list[ExpertConfig]) -> OverpassFilterRule:
        """合并 context 正向规则，并附加强制 deny_object_rules。"""
        include_rules = self._remove_denied_rules(self._merge_base_expert_overpass_rules(base_config, expert_configs), self._overpass_deny_as_tag_rules())
        include_exact_rules: set[tuple[str, str]] = set()
        for key, values in include_rules.values_by_key.items():
            for value in values:
                include_exact_rules.add((key, value))
        return OverpassFilterRule(
            include_wildcard_keys=include_rules.wildcard_keys,
            include_exact_rules=include_exact_rules,
            deny_wildcard_keys=set(self.deny_object_rules.deny_wildcard_keys),
            deny_exact_rules=set(self.deny_object_rules.deny_exact_rules),
        )

######tag annotation rules

    def _parse_tag_annotation(self, annotation: str, match_key: str, match_value: str) -> TagAnnotationReplacement | None:
        """把 annotation 编译成 key/value 替换；None 表示保留原值。"""
        annotation = annotation.strip()
        if not annotation:
            warning_logger.warning(
                "skip_invalid_tag_annotation",
                extra={"geomcp_extra": {"status": "skipped", "reason": "empty_annotation", "match": f"{match_key}={match_value}"}}
            )
            return None

        target_key, separator, target_value = annotation.partition("=")
        if separator:
            target_key = target_key.strip()
            target_value = target_value.strip()
            if not target_key or not target_value:
                warning_logger.warning(
                    "skip_invalid_tag_annotation",
                    extra={"geomcp_extra": {"status": "skipped", "reason": "invalid_replacement", "match": f"{match_key}={match_value}", "annotation": annotation}}
                )
                return None
            return target_key, target_value

        if match_value == "*":
            return annotation, None
        return None, annotation

    def _merge_expert_tag_annotations(self, expert_configs: list[ExpertConfig]) -> TagAnnotationRules:
        """合并 Expert tag_annotations；同 match 冲突时 warning 并保留先遇到的规则。"""
        merged_annotations: TagAnnotationRules = {}
        for expert_config in expert_configs:
            for annotation_config in expert_config.tag_annotations:
                parsed_match = self._parse_tag_rule(annotation_config.match, "expert.tag_annotations")
                if parsed_match is None:
                    continue
                match_key, match_value = parsed_match
                replacement = self._parse_tag_annotation(annotation_config.annotation, match_key, match_value)
                if replacement is None:
                    continue

                selector = (match_key, match_value)
                if selector not in merged_annotations:
                    merged_annotations[selector] = replacement
                    continue
                if merged_annotations[selector] == replacement:
                    continue

                kept_replacement = merged_annotations[selector]
                warning_logger.warning(
                    "skip_conflicting_tag_annotation",
                    extra={"geomcp_extra": {
                        "status": "skipped",
                        "reason": "conflicting_annotation",
                        "match": f"{match_key}={match_value}",
                        "kept_replacement": {"key": kept_replacement[0], "value": kept_replacement[1]},
                        "skipped_replacement": {"key": replacement[0], "value": replacement[1]}
                    }}
                )
        return merged_annotations


if __name__ == "__main__":
    base_context = FilterRuleContext()
    expert_context = FilterRuleContext(experts=["example_expert"])

    print("\noverlay rules:")
    print(expert_context.overlay_rules)

    print("\noutput remove tag rules:")
    print(expert_context.output_remove_tag_rules)
