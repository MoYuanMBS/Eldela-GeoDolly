"""GeoMCP Python 配置加载入口。"""

from __future__ import annotations

from functools import cached_property
from pathlib import Path
import sys
from typing import Any

import yaml

if __package__ in (None, ""):
    sys.path.append(str(Path(__file__).resolve().parents[2]))

from python.utils.models import TransferTypes
from python.utils.internal_models.experts import ExpertConfig, ExpertRegistryType
from python.utils.internal_models.static import AppConfig, FiltersConfig, GeometryConfig, NominatimConfig, TilesConfig

type YamlMapType = dict[str, Any]


class _YamlStore:
    """底层 YAML 文件读取入口 """
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        # 统一从项目根目录的 config/ 读取，业务模块不直接碰 YAML 文件。
        self._config_dir = Path(__file__).resolve().parents[2] / "config"

    def _resolve_config_path(self, file_name: str) -> Path:
        """根据文件名解析配置文件绝对路径。"""
        full_path = (self._config_dir / file_name).resolve()
        if not full_path.exists():
            raise TransferTypes.AppError(code="config_not_found", message=f"config file not found: {full_path}")
        return full_path

    def load_static_yaml(self, file_name: str) -> YamlMapType:
        """全量加载轻量静态配置。"""
        path = self._resolve_config_path(file_name)
        with path.open("r", encoding="utf-8") as file:
            loaded_yaml = yaml.safe_load(file)

        if loaded_yaml is None:
            return {}

        if not isinstance(loaded_yaml, dict):
            raise TransferTypes.AppError(code="invalid_config", message=f"config file format error: {path} (expected mapping at top level)")

        return loaded_yaml

    @cached_property
    def get_dir_experts(self) -> set[str]:
        """仅获取 expert 目录中的专家名称列表。"""
        expert_name: set[str] = set()
        experts_path = self._config_dir / "expert"
        if experts_path.is_dir():
            for path in experts_path.glob("*.yaml"):
                expert_name.add(path.stem)
        return expert_name

    def load_expert_yaml(self, file_name: str, node_names: list[str] | set[str]) -> YamlMapType:
        """加载专家配置。"""
        # 如果 node_names 里有 expert/ 目录的专家名称，优先从 expert/ 目录加载对应 YAML 文件；其他名称从顶层 experts.yaml 加载。
        node_names = set(node_names)
        dir_names = node_names & self.get_dir_experts
        node_names -= dir_names
        
        result = {}
        # 从顶层 experts.yaml 加载剩余专家配置（如果有的话）。
        if node_names:
            data = self.load_static_yaml(file_name)
            result.update({name: data[name] for name in node_names if name in data})
        # 对于 expert/ 目录的专家名称，单独加载对应 YAML 文件并添加到结果里。    
        for file in dir_names:
            data = self.load_static_yaml(f"expert/{file}.yaml")
            result[file] = data
        return result

class _ConfigLoader:
    """Python 侧配置模型 loader。

    负责把 _YamlStore 读出的 raw mapping 转成内部模型；
    静态配置使用 cached_property 缓存，专家配置按请求名称即时加载。
    """

    def __init__(self):
        self._yaml_store = _YamlStore()

    @cached_property
    def app(self) -> AppConfig:
        """首次访问时加载 app.yaml，并在当前 loader 实例内缓存。"""
        raw_app_config = self._yaml_store.load_static_yaml("app.yaml")
        return AppConfig.model_validate({
            "nominatim": raw_app_config.get("nominatim"),
            "geometry": raw_app_config.get("geometry"),
        })

    @cached_property
    def filters(self) -> FiltersConfig:
        """首次访问时加载 filters.yaml，并在当前 loader 实例内缓存。"""
        raw_filters_config = self._yaml_store.load_static_yaml("filters.yaml")
        return FiltersConfig.model_validate({
            "raw": raw_filters_config
        })

    @cached_property
    def tiles(self) -> TilesConfig:
        """首次访问时加载 tiles.yaml，并在当前 loader 实例内缓存。"""
        raw_tiles_config = self._yaml_store.load_static_yaml("tiles.yaml")
        return TilesConfig.model_validate({
            "raw": raw_tiles_config
        })

    def get_experts(self, expert_names: list[str]) -> ExpertRegistryType:
        """从 YAML 按需加载 raw expert，并逐个校验成 ExpertConfig。"""
        raw_experts = self._yaml_store.load_expert_yaml("experts.yaml", expert_names)
        if not isinstance(raw_experts, dict):
            raise TransferTypes.AppError(code="invalid_config", message="config file format error: experts.yaml (expected mapping)")

        return {
            expert_name: ExpertConfig.model_validate(raw_expert)
            for expert_name, raw_expert in raw_experts.items()
        }

    def get_base(self) -> ExpertConfig:
        """从 base.yaml 加载固定的 context Base 规则，并复用 ExpertConfig 校验。"""
        raw_base_config = self._yaml_store.load_static_yaml("base.yaml")
        if "context" not in raw_base_config:
            raise TransferTypes.AppError(code="invalid_config", message="base.yaml must contain context")
        return ExpertConfig.model_validate(raw_base_config["context"])

    def reset_cache(self) -> None:
        """清除 cached_property 写入实例 __dict__ 的配置缓存。"""
        for config_name in ("app", "filters", "tiles"):
            self.__dict__.pop(config_name, None)

class ConfigHub:
    """Python 侧统一配置入口。

    业务模块通过这个 hub 读取配置，不直接访问 YAML 文件或 _YamlStore。
    """

    def __init__(self):
        self._loader = _ConfigLoader()

    @property
    def nominatim(self) -> NominatimConfig:
        return self._loader.app.nominatim

    @property
    def geometry(self) -> GeometryConfig:
        return self._loader.app.geometry

    @property
    def filters(self) -> FiltersConfig:
        return self._loader.filters

    @property
    def tiles(self) -> TilesConfig:
        return self._loader.tiles
    def get_experts(self, expert_names: list[str]) -> ExpertRegistryType:
        """按专家名称读取专家配置。"""
        return self._loader.get_experts(expert_names)

    def get_base(self) -> ExpertConfig:
        """读取固定的 Base context 规则配置。"""
        return self._loader.get_base()

    
    def reset_cache(self) -> None:
        self._loader.reset_cache()

    def warmup_app(self) -> AppConfig:
        """初始化 app 配置，触发相关配置预加载，并返回已校验的 app 配置。"""
        return self._loader.app

config = ConfigHub()

if __name__ == "__main__":
    # 简单测试加载配置
    print("Nominatim Config:", config.nominatim)
    print("Filters Config:", config.filters)
    print("Tiles Config:", config.tiles)
    print("Base Config:", config.get_base())
    print("Experts Config:", config.get_experts(["example_expert"]))
