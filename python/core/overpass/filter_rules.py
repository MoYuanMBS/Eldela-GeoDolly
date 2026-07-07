"""Overpass / Filter 规则加载、合并与 tag filter 编译。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, ClassVar

from pydantic import ValidationError

from python.utils.internal_models.overpass import CompiledOverpassFilterRules, CompiledTagRuleSet, InternalFilterRulesConfig, TagRuleMap
from python.utils.models import TransferTypes


class OverpassRuleStore:
    """Overpass / Filter 规则存储。"""

    _instance: ClassVar["OverpassRuleStore | None"] = None

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


rules = OverpassRuleStore()
