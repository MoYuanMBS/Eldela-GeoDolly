# 07 · User Map Styles

**English** · [简体中文](../zh/07-user-styles.md)

A GeoDolly user style has two parts: a YAML rule maps an OSM tag to a CSS class, and CSS controls the appearance of the matching map Overlay. The entry points are [`config/style/style-rules.yaml`](../../config/style/style-rules.yaml) and [`config/style/style.css`](../../config/style/style.css). The main CSS file already imports examples from `config/style/layers/`.

## Add a road style

To draw `highway=tertiary` ways in green, **append** this entry to the existing `rules` list in `style-rules.yaml`:

```yaml
  - id: user-tertiary-road
    kind: css
    renderLayer: base
    featureType: way
    priority: 100
    key: highway
    value: tertiary
    className: geomcp-user-tertiary-road
```

Then add the matching class to [`config/style/layers/roads.css`](../../config/style/layers/roads.css):

```css
.geomcp-user-overlay.geomcp-user-tertiary-road {
  fill: none;
  stroke: #238b45;
  stroke-width: 4px;
}
```

The existing `style.css` already imports `layers/roads.css`. If you create `layers/custom.css` instead, add `@import "./layers/custom.css";` to `style.css`. Restart the service and generate a **new map** to check the result. Existing WebP snapshots are not regenerated when a style changes.

## YAML rule fields

| Field | Requirement |
| --- | --- |
| `id` | A unique rule ID; avoid conflicts with existing built-in or user rules. |
| `kind` | Always `css`. |
| `renderLayer` | `base`, `border`, or `translucent`; the latter two also require a nonempty `effectType`. |
| `featureType` | `node`, `way`, or `area`; user rules do not support relations. |
| `priority` | A nonnegative integer used when resolving multiple matches. |
| `key` / `value` | An exact OSM tag key; the value is an exact string or a regex object such as `value: {regex: "^(tertiary|secondary)$"}`. |
| `className` | Must begin with `geomcp-user-` and exist in the loaded CSS. |

For a Node icon, add `nodeIcon` to a rule with **`featureType: node` and `renderLayer: base`**, for example `nodeIcon: {asset: "icon/custom.svg", sizePx: 12}`. Local asset paths are relative to `assets/leaflet/`; a valid URL is also supported. The matching CSS class still controls the icon's presentation.

## CSS limits and troubleshooting

User CSS selectors must stay within `.geomcp-user-overlay`. They cannot refer to built-in classes or use ID selectors. CSS accepts stable SVG presentation properties such as `fill`, `stroke`, `stroke-width`, opacity, and dash patterns. Geometry, `transform`, animations, `filter`, `mask`, custom properties, and `url()` are unsupported. `@import` can load only local CSS files under `config/style/layers/`.

User styles affect CSS-capable map Overlays. They do not rewrite built-in Canvas features, Core drawing, or fixed page UI. Invalid CSS can prevent startup. An invalid individual YAML rule, a missing class, or an ID collision may instead skip that rule with a warning. Check the logs and compare your changes with the supplied airport, station, road, and area examples.

[← User Guide](00-index.md) · [Base and Experts](06-base-and-experts.md)