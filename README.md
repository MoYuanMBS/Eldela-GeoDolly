# GeoMCP

Current authority source: `doc/GeoMCP 技术规范文档.md`.

## Dependency Note

TypeScript side currently declares the initial npm packages required by the specification:

- `@modelcontextprotocol/sdk`
- `leaflet`
- `canvas`
- `jsdom`

Rendering is planned around standard `leaflet` running in a Node environment with `jsdom` and `canvas`, instead of the outdated `leaflet-headless` package.

`child_process` is a built-in Node.js module, so it is part of the runtime and does not belong in `package.json` dependencies.

Python side currently declares the initial required packages in `requirements.txt`:

- `httpx`
- `shapely`
- `pillow`
- `pyyaml`

This is the initial scaffold, not the final dependency list. More packages may be added as implementation proceeds.
