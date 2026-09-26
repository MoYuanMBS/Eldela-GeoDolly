# 04 · Base and Experts

**English** · [简体中文](../zh/04-base-and-experts.md)

Base rules apply by default to regional queries. Experts add a subject only when a request names their ID. Both use query rules and Overlay selection rules; use the Base for shared defaults and an Expert for optional topics.

## Edit the default Base

[`config/base.yaml`](../../config/base.yaml) must retain its top-level `context`. Its `overpass_tags` are positive query conditions; `overlay_rules` select fetched features for the map Overlay. These defaults apply to `tool_a` regional queries and the surrounding-area query used by `tool_b`.

For example, to fetch and show mapped rivers by default, add one entry to each existing list under `context`:

```yaml
# Add under context.overpass_tags
- waterway=river

# Add under context.overlay_rules
- match: "waterway=river"
```

These are **entries to add**, not a replacement for the entire `base.yaml` file. A query rule without a corresponding Overlay rule does not ensure the newly fetched feature appears on the map. A broad `key=*` can greatly expand a query; a rule needed for only some tasks usually belongs in an [optional Expert](#optional-experts).

Base and Expert query and Overlay rules support `key=*`, `key=value`, and `key~=^value-regex$`. A value regex matches a fixed key and must be anchored at both ends. Avoid regex extensions whose compatibility with the query service is uncertain.

## Optional Experts

An Expert is a set of subject-specific rules enabled by a request, for example for park facilities, shops, or hiking routes. It can extend the subject query, select features for the map Overlay, and annotate tags in the analysis result. **An Expert is used only when its ID appears in the request's `attention_experts`.** Adding it to the configuration does not apply it to every map.

## Create one from the supplied example

Open [`config/experts.yaml`](../../config/experts.yaml). The `example_expert` entry at the top is a complete example you can copy. Duplicate the entire top-level entry, then change its key and fields. For a library subject:

```yaml
libraries:
  name: "Libraries"
  hints:
    - "Libraries and nearby information features"
  overpass_tags:
    - amenity=library
  overlay_rules:
    - match: "amenity=library"
  tag_annotations:
    - match: "amenity=library"
      annotation: "Library"
```

`libraries` is the Expert ID; `name` is its display name, not the value used in a request. Restart the service, then add `"attention_experts": ["libraries"]` to a `tool_a` or `tool_b` request. Test a small, specific rule set before expanding it.

| Field | Purpose |
| --- | --- |
| `hints` | Describes the subject so callers can choose it when relevant. |
| `overpass_tags` | Positive query conditions for the subject. |
| `overlay_rules` | Selects fetched features for the map Overlay. |
| `tag_annotations` | Changes the wording of matching tags in analysis output; it does not query or draw features. |

If newly fetched features should appear on the map, you will normally add corresponding `overpass_tags` and `overlay_rules`. Adding only `tag_annotations` does not fetch more features. Avoid an unnecessary `key=*` rule, which can greatly broaden a query.

## Rule syntax

`overpass_tags` and `overlay_rules.match` accept:

| Form | Meaning |
| --- | --- |
| `amenity=*` | Any value for the fixed `amenity` key. |
| `amenity=library` | An exact key and value. |
| `amenity~=^(library|community_centre)$` | An anchored value regex for a fixed key. |

For `key~=`, the left side must be a fixed tag key; anchor the value pattern with `^` and `$` and use ordinary regex syntax compatible with the query service. `tag_annotations.match` accepts exact or `*` matching, not this value-regex form. An invalid individual rule may be skipped with a warning; an invalid file structure produces a configuration error.

Alternatively, place one Expert in `config/expert/<id>.yaml`. That file begins directly with `name`, `hints`, and the other fields, without a surrounding ID key. If the same ID exists in both places, the individual file takes precedence over `experts.yaml`.

## Check the result

Restart the service and confirm the new ID is available. Use the same place with and without `attention_experts` to compare the analysis and map, and check configuration warnings in the logs. For rules that should apply to every request, edit [Base](#edit-the-default-base) instead of requiring every caller to select an Expert.

[← User Guide](00-index.md) · [Configuration](02-configuration.md) · [Basemaps and Filters](03-tiles-and-filters.md)
