"""根据最终 Identified Overlay 计算视口面积倍率。"""

from __future__ import annotations

import math

from python.utils.config_loader import config
from python.utils.models import Overpass, TransferTypes


DEFAULT_BBOX_AREA_MIN_M2 = 100_000.0
BBOX_AREA_FACTOR_MAX = 2.5
BBOX_AREA_ALPHA = 1.0
REFERENCE_COMPLEXITY = 450.0
BASE_COMPLEXITY = 20.0
GAMMA = 0.5


def calculate_recommended_viewport_area_factor(bbox_area_m2: float, overlay_output: dict[Overpass.IdentifiedOverlayFeatureType, list[Overpass.IdentifiedOverlayFeature]] | None = None ) -> float:
    """合成 bbox 面积与最终 Overlay 复杂度，返回推荐视口面积倍率。"""

    adaptive_config = config.iframe_adaptive
    bbox_area_max_m2 = max(
        config.geometry.tool_a_max_area_km2,
        config.geometry.tool_b_max_area_km2
    ) * 1_000_000.0
    if bbox_area_max_m2 <= DEFAULT_BBOX_AREA_MIN_M2: raise TransferTypes.AppError(code="invalid_config", message="bbox area normalization maximum must be greater than its minimum")

    identified_overlay = overlay_output or {}
    content_complexity = (
        adaptive_config.node_weight * len(identified_overlay.get("node", []))
        + adaptive_config.way_weight * len(identified_overlay.get("way", []))
        + adaptive_config.area_weight * len(identified_overlay.get("area", []))
        + adaptive_config.relation_weight * len(identified_overlay.get("relation", []))
    )

    try:
        bbox_area_progress = max(0.0, min(
            (
                math.log(bbox_area_m2) - math.log(DEFAULT_BBOX_AREA_MIN_M2)
            ) / (
                math.log(bbox_area_max_m2) - math.log(DEFAULT_BBOX_AREA_MIN_M2)
            ), 1.0 )
        )
        bbox_area_factor = 1.0 + (
            BBOX_AREA_FACTOR_MAX - 1.0
        ) * math.pow(bbox_area_progress, BBOX_AREA_ALPHA)
        if content_complexity == 0.0:
            content_area_factor = 1.0
        else:
            content_area_factor = max(1.0, min(
                (
                    (content_complexity + BASE_COMPLEXITY)
                    / (REFERENCE_COMPLEXITY + BASE_COMPLEXITY)
                ) ** GAMMA, adaptive_config.max_area_factor)
            )

        primary_factor = max(bbox_area_factor, content_area_factor)
        secondary_factor = min(bbox_area_factor, content_area_factor)
        raw_factor = primary_factor + adaptive_config.secondary_factor_weight * (secondary_factor - 1.0)
        recommended_factor = max(1.0, min(raw_factor, adaptive_config.max_area_factor))
    except (ArithmeticError, TypeError, ValueError) as error:
        raise TransferTypes.AppError(code="invalid_viewport_area_factor", message="viewport area factor calculation failed", details=str(error)) from error
    
    return recommended_factor


if __name__ == "__main__":
    import json
    from pathlib import Path

    file_path = Path(__file__).parent.parent.parent.parent / "test" / "test_output.json"
    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    bbox_area_m2 = 4924884.97
    overlay_output = data.get("identified_features")

    factor = calculate_recommended_viewport_area_factor(bbox_area_m2, overlay_output)
    identified_overlay = overlay_output or {}
    print(f'node count: {len(identified_overlay.get("node", []))}')
    print(f'way count: {len(identified_overlay.get("way", []))}')
    print(f'area count: {len(identified_overlay.get("area", []))}')
    print(f'relation count: {len(identified_overlay.get("relation", []))}')

    print(f"Recommended viewport area factor: {factor:.3f}")
