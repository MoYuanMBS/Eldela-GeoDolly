# 05 · Basemaps and Filters

**English** · [简体中文](../zh/05-tiles-and-filters.md)

This page covers the available background maps and the tag cleanup applied to analysis and map properties. These files solve different tasks: `tiles.yaml` selects a provider, while `filters.yaml` cleans output.

## Basemap profiles

A tool request's `basemap` must match a top-level ID in [`config/tiles.yaml`](../../config/tiles.yaml). The bundled IDs are `osm` and `arcgis_satellite`. To add a basemap, copy a complete entry and provide a new ID, the provider's tile URL template, display name, and attribution. This example uses placeholder addresses and cannot fetch real tiles:

```yaml
my_tiles:
  name: "My Tiles"
  upstream: "https://tiles.example.invalid/{z}/{x}/{y}.png"
  max_native_zoom: 18
  crs: EPSG:3857
  attribution: "My Tiles"
  attribution_url: "https://example.invalid/attribution"
  full_attribution:
```

IDs may contain lowercase letters, digits, `_`, and `-`, and must begin and end with a letter or digit. `upstream` must be an HTTP(S) template with `{z}`, `{x}`, and `{y}` in the request path or query; optional `{s}` is expanded to an `a`/`b`/`c` subdomain and `{r}` to an empty string. Unknown placeholders fail validation. The current CRS is `EPSG:3857`. Check the provider's use and attribution terms before using a real service. Restart after editing, then select the new ID in a tool request.

`max_native_zoom` limits the provider's native tiles, while [`leaflet.viewport.max_zoom`](03-app-yaml.md#leaflet) controls the map view independently. Above the native limit, tiles are enlarged while Overlay geometry still follows the map zoom. `attribution` is the compact User-map credit; the AI screenshot displays `full_attribution` when present. Keep the required credit text intact.

Browsers fetch tiles through the GeoDolly backend; the provider template is consumed there. Removing an ID from the registry can make existing maps using that ID fail to load. The choice of basemap does not change the geographic analysis or Overlay selection.

## Edit output Filters

[`config/filters.yaml`](../../config/filters.yaml) contains three independent lists. This shows their format; edit the **existing lists** rather than replacing the whole file with this abbreviated example:

```yaml
remove_tags:
  - note=*
remove_tag_key_patterns:
  - '^contact:.*$'
drop_if_only_tags:
  - building=yes
  - '^addr:.*$'
```

| List | Match form | Effect |
| --- | --- | --- |
| `remove_tags` | `key=*` or exact `key=value` | Removes matching tags from AI analysis output. |
| `remove_tag_key_patterns` | Regex against the complete tag key; use `^...$` anchors | Removes matching keys from both AI analysis output and final map Overlay properties. |
| `drop_if_only_tags` | Exact `key=value`, or a tag-key regex without `=` | After tag cleanup, removes an ordinary AI output object if **all** its remaining tags match these rules. |

`drop_if_only_tags` does not remove individual tags or map Overlay features. `key=*` is not a valid low-information rule here; use a key regex such as `^addr:.*$` to match any value for a key. `remove_tags` also does not change default queries or map feature selection. To control which features appear on the map, edit [Base or Expert](06-base-and-experts.md) `overlay_rules`.

After editing either file, restart GeoDolly and make a new map. Check configuration warnings if the result differs from what you expected.

[← User Guide](00-index.md) · [web.yaml](04-web-yaml.md) · [Base and Experts](06-base-and-experts.md)
