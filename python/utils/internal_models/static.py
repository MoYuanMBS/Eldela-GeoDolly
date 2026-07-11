"""轻量静态配置模型。
"""

from __future__ import annotations
from typing import Any
from pydantic import Field
from python.utils.models import StrictModel


class NominatimConfig(StrictModel):
    """Nominatim 运行配置。"""

    location_limit: int = Field(gt=0, le=50)
    user_agent: str = Field(min_length=1)
    timeout_seconds: float = Field(gt=0, multiple_of=0.01)


class GeometryConfig(StrictModel):
    """Geometry 模块统一运行配置。"""

    line_buffer_meter: float = Field(ge=0, multiple_of=0.01)
    tool_a_bbox_expand_meter: float = Field(ge=0, multiple_of=0.01)
    tool_b_bbox_expand_meter: float = Field(ge=0, multiple_of=0.01)
    base_tolerance_meter: float = Field(ge=0, multiple_of=0.01)
    max_tolerance_meter: float = Field(gt=0, multiple_of=0.01)
    max_node: int = Field(gt=0)
    max_retry: int = Field(ge=0)
    tool_a_max_area_km2: float = Field(gt=0, multiple_of=0.01)
    tool_b_max_area_km2: float = Field(gt=0, multiple_of=0.01)
    max_core_area_km2: float = Field(gt=0, multiple_of=0.01)


class OverpassConfig(StrictModel):
    """Overpass 运行配置。"""

    relation_parent_depth: int = Field(ge=0)
    endpoint: str = Field(min_length=1)
    user_agent: str = Field(min_length=1)
    timeout_seconds: float = Field(gt=0, multiple_of=1)
    retry_attempts: int = Field(ge=0)
    retry_delay_seconds: float = Field(ge=0, multiple_of=0.01)


class AppConfig(StrictModel):
    """`config/app.yaml` 中 Python 侧会使用的轻量配置。"""

    nominatim: NominatimConfig
    geometry: GeometryConfig
    overpass: OverpassConfig


class FiltersConfig(StrictModel):
    """`config/filters.yaml` 的 AI Output 清理规则。"""

    remove_tags: list[str] = Field(default_factory=list)
    drop_if_only_tags: list[str] = Field(default_factory=list)


class TilesConfig(StrictModel):
    """`config/tiles.yaml` 配置模型占位。

    瓦片源格式等实现 tile_manager 时再正式补齐。
    """

    raw: dict[str, Any] = Field(default_factory=dict)
