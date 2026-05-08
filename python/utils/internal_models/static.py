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
    timeout_seconds: float = Field(gt=0)


class AppConfig(StrictModel):
    """`config/app.yaml` 中 Python 侧会使用的轻量配置。"""

    nominatim: NominatimConfig


class FiltersConfig(StrictModel):
    """`config/filters.yaml` 配置模型占位。

    清洗规则格式等实现 filter_engine 时再正式补齐。
    """

    raw: dict[str, Any] = Field(default_factory=dict)


class TilesConfig(StrictModel):
    """`config/tiles.yaml` 配置模型占位。

    瓦片源格式等实现 tile_manager 时再正式补齐。
    """

    raw: dict[str, Any] = Field(default_factory=dict)
