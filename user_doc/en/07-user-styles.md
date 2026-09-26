# 07 · User Map Styles

**English** · [简体中文](../zh/07-user-styles.md)

A GeoDolly user style matches OSM tags with a YAML rule. CSS styles supported map Overlays; a Node Base rule can also render a local SVG or PNG image through `nodeIcon`. The entry points are [`config/style/style-rules.yaml`](../../config/style/style-rules.yaml), [`config/style/style.css`](../../config/style/style.css), and local image files under `assets/leaflet/`. The main CSS file already imports examples from `config/style/layers/`.

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

## Add a local SVG or PNG Node icon

Place your image under `assets/leaflet/`, for example `assets/leaflet/icon/my-place.svg` or `assets/leaflet/icon/my-place.png`. In `style-rules.yaml`, append a Node Base rule to the existing `rules` list:

```yaml
  - id: user-my-place-node
    kind: css
    renderLayer: base
    featureType: node
    priority: 100
    key: amenity
    value: library
    className: geomcp-user-my-place-node
    nodeIcon:
      asset: icon/my-place.svg
      sizePx: 8
```

`nodeIcon.asset` is relative to `assets/leaflet/`, so the example points to `assets/leaflet/icon/my-place.svg`. For a PNG, put `my-place.png` in the same directory and change the `asset` value to `icon/my-place.png`. Other supported local image formats are JPG/JPEG, WebP, GIF, AVIF, BMP, and ICO. `sizePx` is a positive base size in logical pixels. `nodeIcon` works only on a rule with `featureType: node` and `renderLayer: base`; a valid `nodeIcon.url` can also reference an external image instead of a local `asset`.

Add the required class to [`config/style/layers/nodes.css`](../../config/style/layers/nodes.css):

```css
.geomcp-user-overlay.geomcp-user-my-place-node {
  opacity: 1;
}
```

The class styles the SVG `<image>` element, for example its opacity; it does not recolor pixels inside an SVG or PNG file. Edit the image itself to change its artwork or colors. Local images are included in the browser build, so run `npm run build:web`, restart GeoDolly, and generate a new map after adding or changing one. A missing or unloadable image is skipped with a browser warning.

## CSS limits and troubleshooting

User CSS selectors must stay within `.geomcp-user-overlay`. They cannot refer to built-in classes or use ID selectors. For vector map paths, CSS accepts stable SVG presentation properties such as `fill`, `stroke`, `stroke-width`, opacity, and dash patterns. A `nodeIcon` image also accepts applicable outer-element properties such as opacity; CSS does not edit the image content. Geometry, `transform`, animations, `filter`, `mask`, custom properties, and CSS `url()` are unsupported. `@import` can load only local CSS files under `config/style/layers/`.

User styles affect CSS-capable map Overlays. They do not rewrite built-in Canvas features, Core drawing, or fixed page UI. Invalid CSS can prevent startup. An invalid individual YAML rule, a missing class, or an ID collision may instead skip that rule with a warning. Check the logs and compare your changes with the supplied airport, station, road, and area examples.

[← User Guide](00-index.md) · [Base and Experts](06-base-and-experts.md)