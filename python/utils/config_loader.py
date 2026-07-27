"""GeoMCP Python 配置加载入口。"""

from __future__ import annotations

import logging
from functools import cached_property
from pathlib import Path
from typing import Any, TypeVar

from pydantic import ValidationError
import yaml

from python.utils.internal_models.experts import ExpertConfig, ExpertRegistryType
import python.utils.internal_models.static as static_models
from python.utils.models import StrictModel, TransferTypes

type YamlMapType = dict[str, Any]
ConfigModelType = TypeVar("ConfigModelType", bound=StrictModel)
warning_logger = logging.getLogger("geomcp.warning")


##### YAML 文件读取 #####

class _YamlStore:
    """底层 YAML 文件读取入口 """
    _instance = None

    ##### 实例与路径 #####

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

    ##### 静态配置读取 #####

    def load_static_yaml(self, file_name: str) -> YamlMapType:
        """全量加载轻量静态配置。"""
        path = self._resolve_config_path(file_name)
        try:
            with path.open("r", encoding="utf-8") as file:
                loaded_yaml = yaml.safe_load(file)
        except yaml.YAMLError as error:
            raise TransferTypes.AppError(code="invalid_config", message=f"config file YAML parse error: {path}", details=str(error)) from error
        except (OSError, UnicodeError) as error:
            raise TransferTypes.AppError(code="invalid_config", message=f"config file read error: {path}", details=str(error)) from error

        if loaded_yaml is None:
            return {}

        if not isinstance(loaded_yaml, dict):
            raise TransferTypes.AppError(code="invalid_config", message=f"config file format error: {path} (expected mapping at top level)")

        return loaded_yaml

    ##### Expert 配置读取 #####

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
            for missing_name in sorted(node_names - result.keys()):
                warning_logger.warning(
                    "skip_missing_expert_config",
                    extra={"geomcp_extra": {"status": "skipped", "reason": "expert_not_found", "expert_name": missing_name}}
                )
        # 对于 expert/ 目录的专家名称，单独加载对应 YAML 文件并添加到结果里。    
        for file in dir_names:
            data = self.load_static_yaml(f"expert/{file}.yaml")
            result[file] = data
        return result


##### 配置模型加载 #####

class _ConfigLoader:
    """Python 侧配置模型 loader。

    负责把 _YamlStore 读出的 raw mapping 转成内部模型；
    静态配置使用 cached_property 缓存，专家配置按请求名称即时加载。
    """

    ##### Loader 基础能力 #####

    def __init__(self):
        self._yaml_store = _YamlStore()

    def _validate_config_model(self, model: type[ConfigModelType], raw_config: object, source: str) -> ConfigModelType:
        """统一把配置模型校验错误转换为项目 AppError。"""
        try:
            return model.model_validate(raw_config)
        except ValidationError as error:
            raise TransferTypes.AppError(code="invalid_config", message=f"config model validation failed: {source}", details=str(error)) from error

    ##### 静态配置 #####

    @cached_property
    def app(self) -> static_models.AppConfig:
        """首次访问时加载 app.yaml，并在当前 loader 实例内缓存。"""
        raw_app_config = self._yaml_store.load_static_yaml("app.yaml")
        return self._validate_config_model(static_models.AppConfig, {
            "nominatim": raw_app_config.get("nominatim"),
            "geometry": raw_app_config.get("geometry"),
            "overpass": raw_app_config.get("overpass"),
            "feature_id": raw_app_config.get("feature_id"),
            "iframe_adaptive": raw_app_config.get("iframe_adaptive")
        }, "app.yaml")

    @cached_property
    def filters(self) -> static_models.FiltersConfig:
        """首次访问时加载 filters.yaml，并在当前 loader 实例内缓存。"""
        raw_filters_config = self._yaml_store.load_static_yaml("filters.yaml")
        return self._validate_config_model(static_models.FiltersConfig, raw_filters_config, "filters.yaml")


    ##### 规则配置 #####

    def get_base(self) -> ExpertConfig:
        """从 base.yaml 加载固定的 context Base 规则，并复用 ExpertConfig 校验。"""
        raw_base_config = self._yaml_store.load_static_yaml("base.yaml")
        if "context" not in raw_base_config:
            raise TransferTypes.AppError(code="invalid_config", message="base.yaml must contain context")
        return self._validate_config_model(ExpertConfig, raw_base_config["context"], "base.yaml:context")

    def get_experts(self, expert_names: list[str]) -> ExpertRegistryType:
        """从 YAML 按需加载 raw expert，并逐个校验成 ExpertConfig。"""
        raw_experts = self._yaml_store.load_expert_yaml("experts.yaml", expert_names)
        if not isinstance(raw_experts, dict):
            raise TransferTypes.AppError(code="invalid_config", message="config file format error: experts.yaml (expected mapping)")

        return {
            expert_name: self._validate_config_model(ExpertConfig, raw_expert, f"expert:{expert_name}")
            for expert_name, raw_expert in raw_experts.items()
        }

    ##### 缓存控制 #####

    def reset_cache(self) -> None:
        """清除 cached_property 写入实例 __dict__ 的配置缓存。"""
        for config_name in ("app", "filters"):
            self.__dict__.pop(config_name, None)


##### 统一配置入口 #####

class ConfigHub:
    """Python 侧统一配置入口。

    业务模块通过这个 hub 读取配置，不直接访问 YAML 文件或 _YamlStore。
    """

    ##### Hub 初始化 #####

    def __init__(self):
        self._loader = _ConfigLoader()

    ##### App 子配置 #####

    @property
    def nominatim(self) -> static_models.NominatimConfig:
        return self._loader.app.nominatim

    @property
    def geometry(self) -> static_models.GeometryConfig:
        return self._loader.app.geometry

    @property
    def overpass(self) -> static_models.OverpassConfig:
        return self._loader.app.overpass

    @property
    def feature_id(self) -> static_models.FeatureIdConfig:
        return self._loader.app.feature_id

    @property
    def iframe_adaptive(self) -> static_models.IframeAdaptiveConfig:
        return self._loader.app.iframe_adaptive

    ##### 独立静态配置 #####

    @property
    def filters(self) -> static_models.FiltersConfig:
        return self._loader.filters

    ##### 规则配置 #####

    def get_base(self) -> ExpertConfig:
        """读取固定的 Base context 规则配置。"""
        return self._loader.get_base()

    def get_experts(self, expert_names: list[str]) -> ExpertRegistryType:
        """按专家名称读取专家配置。"""
        return self._loader.get_experts(expert_names)

    ##### 缓存生命周期 #####

    def warmup_app(self) -> static_models.AppConfig:
        """初始化 app 配置，触发相关配置预加载，并返回已校验的 app 配置。"""
        return self._loader.app

    def reset_cache(self) -> None:
        self._loader.reset_cache()


config = ConfigHub()

if __name__ == "__main__":
    # 简单测试加载配置
    print("Nominatim Config:", config.nominatim)
    print("Filters Config:", config.filters)
    print("Base Config:", config.get_base())
    print("Experts Config:", config.get_experts(["example_expert"]))
