"""专家注册表配置模型。

当前权威来源: doc/GeoMCP 技术规范文档.md
"""

from __future__ import annotations

from typing import TypeAlias

from pydantic import Field

from python.utils.models import StrictModel


class LeafletExtraTagConfig(StrictModel):
    """专家命中的 OSM tag 与 Leaflet CSS class 对应关系。"""

    tag: str = Field(min_length=1)
    css_class: str = Field(min_length=1)


class ExpertConfig(StrictModel):
    """单个专家定义。

    专家名称使用 `config/experts.yaml` 顶层 key 表示，不在模型内部重复保存。
    """

    name: str = Field(min_length=1)
    hints: list[str] = Field(default_factory=list)
    ai_focus_tags: list[str] = Field(default_factory=list)
    leaflet_extra_tags: list[LeafletExtraTagConfig] = Field(default_factory=list)


ExpertRegistryType: TypeAlias = dict[str, ExpertConfig]
