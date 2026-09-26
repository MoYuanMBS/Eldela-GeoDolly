# GeoDolly

**English** · [简体中文](README.zh.md)

**GeoDolly** is an MCP toolkit for exploring places with OpenStreetMap data. It helps you confirm a location, analyze what is mapped there and nearby, and view the result on a map. Use it to ask what features surround a place or how its roads and railways are arranged.

![GeoDolly cover](assets/logo/cover.webp)

## What GeoDolly provides

| Capability | What it does |
| --- | --- |
| Place confirmation | Searches for a place and lets you verify the right candidate before analysis. |
| Area and network analysis | Examines wider road and rail networks or a bounded place and its nearby facilities. |
| Map output | Provides structured analysis, a WebP snapshot, and a browser map; supported MCP app clients can also show the full interactive map. |

## How it works

1. Call `location_search` and confirm one returned candidate.
2. Call `tool_a` or `tool_b` with the search session ID and that candidate's index.
3. Choose a basemap and `visual_output`, then read the analysis and open the map.

| Tool | Use it for |
| --- | --- |
| `location_search` | Finding and confirming a place. |
| `tool_a` | Roads, railways, transport connections, and broader regional context. |
| `tool_b` | A bounded place, such as a park, campus, or district, and its surroundings. |

The map tools can return structured YAML, a WebP snapshot URL, or a simplified map page URL, depending on the analysis and `visual_output`. A supported MCP app client can display the full interactive map separately. See [Map Output](user_doc/en/01-getting-started.md#reading-the-result) for the distinctions.

## Get started

- [Quick Start](user_doc/en/01-getting-started.md) — install, build, connect an MCP client, and make a first map.
- [User Guide](user_doc/en/index.md) — browse the numbered guide.
- [Configuration](user_doc/en/02-configuration.md) — find the main settings and linked customization topics.
- [Tools](user_doc/en/01-getting-started.md#map-tool-inputs) — choose an analysis and fill in its request fields.

GeoDolly relies on online place, feature, and basemap services, and results depend on OpenStreetMap coverage. It does not provide routing or live traffic. The public tool names are `location_search`, `tool_a`, and `tool_b`.

## License and policies

GeoDolly is source-available under the [License](LICENSE), which permits specified noncommercial and research uses and reserves project artwork and branding rights. Commercial and operational military use are prohibited. Read the bilingual [Use and Data Policy](POLICY.md) before redistribution or deployment.
