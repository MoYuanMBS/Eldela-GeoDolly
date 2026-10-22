# GeoDolly

**English** · [简体中文](README.zh.md)

**GeoDolly** is an MCP toolkit for exploring places with OpenStreetMap data. It helps you confirm a location, analyze what is mapped there and nearby, and inspect or measure the result on an interactive map. Use it to ask what features surround a place or how its roads and railways are arranged.

![GeoDolly cover](assets/logo/cover.webp)

## What GeoDolly provides

| Capability | What it does |
| --- | --- |
| Place confirmation | Searches for a place and lets you verify the right candidate before analysis. |
| Area and network analysis | Examines wider road and rail networks or a bounded place and its nearby facilities. |
| Map output | Provides structured YAML and full interactive browser maps, with WebP images delivered through compatible MCP app hosts. |
| Feature inspection and measurement | Shows mapped feature details and supports line, polygon, and circle measurements. |
| AI map controls | Lets the AI adjust its own map view, capture it, or fit it to the user's current view in a compatible host. |

## How it works

1. Call `location_search` and confirm one returned candidate.
2. Call `tool_a` or `tool_b` with the search session ID, that candidate's index, a basemap, and `visual_output`.
3. Read the analysis, inspect the User map, and use the AI map or screenshot when the chosen mode and host support them.

| Tool | Use it for |
| --- | --- |
| `location_search` | Finding and confirming a place. |
| `tool_a` | Roads, railways, transport connections, and broader regional context. |
| `tool_b` | A bounded place, such as a park, campus, or district, and its surroundings. |

`visual_output` controls the AI view in the MCP app: `none` shows the User map, `interactive` adds an independent AI map, and `screenshot` also delivers WebP images. The App provides an open/copy link to the full browser map. Image delivery and the four App map tools depend on host support. See [Map Output](user_doc/en/01-getting-started.md#reading-the-result) and [AI Map Tools](user_doc/en/01-getting-started.md#ai-map-tools).

## Get started

- [Quick Start](user_doc/en/01-getting-started.md) — install dependencies, choose a deployment, build, and make a first map.
- [Host installation](user_doc/en/01-getting-started.md#install-in-your-mcp-host) — add the Streamable HTTP URL and check MCP Apps, App-tool, and image support.
- [User Guide](user_doc/en/00-index.md) — browse the numbered guide.
- [Configuration](user_doc/en/02-configuration.md#environment-overrides) — configure `app.yaml` and `web.yaml` overrides in `deploy/geomcp.env`.
- [Tools](user_doc/en/01-getting-started.md#map-tool-inputs) — choose an analysis and fill in its request fields.

Use a single `deploy/geomcp.env` for **both browser builds and backend startup**; the guide uses explicit `node --env-file=deploy/geomcp.env ...` commands because npm scripts do not load it automatically. Choose the public address before building:

| Deployment | Guide |
| --- | --- |
| Local HTTP, when the Host permits it | [Local setup](user_doc/en/01-getting-started.md#local-http) |
| Localhost exposed over HTTPS | [Cloudflare named tunnel](user_doc/en/01-getting-started.md#localhost-through-cloudflare-tunnel) |
| Server with a domain and HTTPS | [DNS, reverse proxy, certificates, and persistent service](user_doc/en/04-web-yaml.md#server-deployment-with-a-domain-and-https) |

Some Hosts require public HTTPS for remote MCP/Apps; a hosted client cannot reach your computer's localhost. Use a stable named tunnel for local HTTPS: Cloudflare Quick Tunnels do not support the SSE used by this backend. Details and official references are in the deployment guides.

GeoDolly relies on online place, feature, and basemap services, and results depend on OpenStreetMap coverage. It does not provide routing or live traffic. The backend tool names are `location_search`, `tool_a`, and `tool_b`.

## License and policies

GeoDolly is source-available under the [License](LICENSE), which permits specified noncommercial and research uses and reserves project artwork and branding rights. Commercial and operational military use are prohibited. Read the bilingual [Use and Data Policy](POLICY.md) before redistribution or deployment.
