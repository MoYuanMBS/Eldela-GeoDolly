"""轻量静态配置模型。
"""

from __future__ import annotations
from typing import Annotated, Any, Literal
from pydantic import Field, StringConstraints, field_validator

from python.utils.models import StrictModel

OverpassEndpoint = Annotated[str, Field(min_length=1)]


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
    relation_member_depth: Annotated[int, Field(ge=0)] | Literal["all"] = 2
    overlay_skel_id_batch_size: int = Field(default=1000, gt=0)
    overlay_skel_concurrency: int = Field(default=1, gt=0)
    overlay_skel_batch_delay_seconds: float = Field(default=3.00, ge=0, multiple_of=0.01)
    endpoint: str = Field(min_length=1)
    endpoints: list[OverpassEndpoint] = Field(default_factory=list)
    endpoint_strategy: Literal["failover", "round_robin"] = "failover"
    user_agent: str = Field(min_length=1)
    timeout_seconds: float = Field(gt=0, multiple_of=1)
    retry_attempts: int = Field(ge=0)
    retry_delay_seconds: float = Field(ge=0, multiple_of=0.01)


class FeatureIdScheme(StrictModel):
    """单个 Feature ID 命名空间的生成配置。"""

    template: Annotated[str, StringConstraints(
        min_length=1, 
        pattern=(
            r"^(?:"
            r"\{alpha\}|"
            r"\{num\}|"
            r"\{alpha\}[-*~=]?\{num\}|"
            r"\{num\}[-*~=]?\{alpha\}"
            r")$")
    )]
    mode: Literal["global", "grouped", "round"]
    group: Annotated[int, Field(gt=0)] | None = None


class FeatureIdSchemes(StrictModel):
    """各 Feature 类型共用结构、相互独立的 ID scheme。"""

    node: FeatureIdScheme
    way: FeatureIdScheme
    area: FeatureIdScheme
    relation: FeatureIdScheme


class FeatureIdConfig(StrictModel):
    """共享 Feature ID 配置；Python 不解释 TypeScript render skin。"""

    alphabet_pool: Annotated[str, StringConstraints(strip_whitespace=True, to_upper=True, min_length=1)]
    id_scheme: FeatureIdSchemes
    render: Any = Field(default=None, exclude=True, repr=False)

    @field_validator("alphabet_pool")
    @classmethod
    def validate_alphabet_pool(cls, value: str) -> str:
        """保证 canonical ID 字母池为有序且不重复的 ASCII 大写字母。"""
        if any(character < "A" or character > "Z" for character in value):
            raise ValueError("feature ID alphabet_pool must contain only ASCII A-Z")
        if len(set(value)) != len(value):
            raise ValueError("feature ID alphabet_pool must not contain duplicate characters")
        return value


class AppConfig(StrictModel):
    """`config/app.yaml` 中 Python 侧会使用的轻量配置。"""

    nominatim: NominatimConfig
    geometry: GeometryConfig
    overpass: OverpassConfig
    feature_id: FeatureIdConfig


class FiltersConfig(StrictModel):
    """`config/filters.yaml` 的 AI Output 清理规则。"""

    remove_tags: list[str] = Field(default_factory=list)
    drop_if_only_tags: list[str] = Field(default_factory=list)


class TilesConfig(StrictModel):
    """`config/tiles.yaml` 配置模型占位。

    瓦片源格式等实现 tile_manager 时再正式补齐。
    """

    raw: dict[str, Any] = Field(default_factory=dict)
