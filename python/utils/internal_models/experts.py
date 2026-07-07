"""专家注册表配置模型。

当前权威来源: doc/GeoMCP 技术规范文档.md
"""

from __future__ import annotations

from typing import TypeAlias

from pydantic import Field

from python.utils.models import StrictModel


class OverlayRuleConfig(StrictModel):
    """Overlay 选择规则，只决定对象是否进入 Overlay。"""

    match: str = Field(min_length=1)


class TagAnnotationConfig(StrictModel):
    """AI output 中使用的 tag 注释规则。"""

    match: str = Field(min_length=1)
    annotation: str = Field(min_length=1)


class ExpertConfig(StrictModel):
    """单个专家定义。

    专家名称使用 `config/experts.yaml` 顶层 key 表示，不在模型内部重复保存。
    """

    name: str = Field(min_length=1)
    hints: list[str] = Field(default_factory=list)
    overpass_tags: list[str] = Field(default_factory=list)
    overlay_rules: list[OverlayRuleConfig] = Field(default_factory=list)
    tag_annotations: list[TagAnnotationConfig] = Field(default_factory=list)


ExpertRegistryType: TypeAlias = dict[str, ExpertConfig]
