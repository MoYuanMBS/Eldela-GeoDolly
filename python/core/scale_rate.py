"""根据最终 Identified Overlay 计算视口面积倍率。"""

from __future__ import annotations

from python.utils.config_loader import config
from python.utils.models import Overpass


REFERENCE_COMPLEXITY = 450.0
BASE_COMPLEXITY = 20.0
GAMMA = 0.5


def calculate_recommended_viewport_area_factor(
    overlay_output: dict[
        Overpass.IdentifiedOverlayFeatureType,
        list[Overpass.IdentifiedOverlayFeature]
    ]
) -> float:
    """按最终 node / way / area / relation 数量计算推荐视口面积倍率。"""
    adaptive_config = config.iframe_adaptive
    content_complexity = (
        adaptive_config.node_weight * len(overlay_output.get("node", []))
        + adaptive_config.way_weight * len(overlay_output.get("way", []))
        + adaptive_config.area_weight * len(overlay_output.get("area", []))
        + adaptive_config.relation_weight * len(overlay_output.get("relation", []))
    )
    raw_factor = (
        (content_complexity + BASE_COMPLEXITY)
        / (REFERENCE_COMPLEXITY + BASE_COMPLEXITY)
    ) ** GAMMA
    return max(adaptive_config.min_area_factor, min(raw_factor, adaptive_config.max_area_factor))


if __name__ == "__main__":
    import json
    from pathlib import Path

    file_path = Path(__file__).parent.parent.parent.parent / "test" / "test_output.json"
    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    overlay_output = data["identified_features"]

    factor = calculate_recommended_viewport_area_factor(overlay_output)
    print(f'node count: {len(overlay_output.get("node", []))}')
    print(f'way count: {len(overlay_output.get("way", []))}')
    print(f'area count: {len(overlay_output.get("area", []))}')
    print(f'relation count: {len(overlay_output.get("relation", []))}')

    print(f"Recommended viewport area factor: {factor:.3f}")
