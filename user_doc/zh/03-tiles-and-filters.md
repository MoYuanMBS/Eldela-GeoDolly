# 03 · 底图与 Filter

[English](../en/03-tiles-and-filters.md) · **简体中文**

本页集中说明背景底图与输出 tag 清理。两份配置用途不同：`tiles.yaml` 选择底图提供商，`filters.yaml` 清理分析和地图属性。

## 底图 Profile

工具请求的 `basemap` 必须是 [`config/tiles.yaml`](../../config/tiles.yaml) 中已有的顶层 ID。内置 ID 为 `osm` 与 `arcgis_satellite`。要添加底图，可以复制其中一个完整条目，改成新的 ID，并填写提供商的 URL 模板、名称和版权信息。一个条目的结构如下；地址和版权信息仅是占位示例，不能直接用于真实服务：

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

ID 只能使用小写字母、数字、`_` 和 `-`，并以字母或数字开头、结尾。`upstream` 必须是 HTTP(S) 模板，包含 `{z}`、`{x}`、`{y}`；`crs` 当前只支持 `EPSG:3857`。`max_native_zoom` 表示提供商的原生瓦片最高级别。填写真实服务时，请核对其授权与署名要求。修改后重启，再在工具请求中选择新 ID。

## 修改输出 Filter

[`config/filters.yaml`](../../config/filters.yaml) 有三个独立列表。下面是格式示意；请按需要修改**现有列表**，不要直接用它覆盖原文件：

```yaml
remove_tags:
  - note=*
remove_tag_key_patterns:
  - '^contact:.*$'
drop_if_only_tags:
  - building=yes
  - '^addr:.*$'
```

| 列表 | 匹配方式 | 影响 |
| --- | --- | --- |
| `remove_tags` | `key=*` 或精确 `key=value` | 删除 AI 分析输出中的匹配 tag。 |
| `remove_tag_key_patterns` | 对完整 tag key 使用正则；建议用 `^...$` 锚定 | 同时从 AI 分析输出和最终地图 Overlay 属性中删除匹配 key。 |
| `drop_if_only_tags` | 精确 `key=value`，或不含等号的 tag key 正则 | tag 清理后，如果一个普通 AI 对象的所有剩余 tag 都命中这些规则，就从 AI 分析输出中删除该对象。 |

`drop_if_only_tags` 不负责删除单个 tag，也不删除地图中的 Overlay 要素。这里的 `key=*` 不是有效的低信息量规则；要匹配某个 key 的任意值，可以使用该 key 的正则，例如 `^addr:.*$`。`remove_tags` 也不会改变默认查询或地图要素选择。若要控制地图上出现哪些要素，请改 [Base 或 Expert](04-base-and-experts.md) 的 `overlay_rules`。

修改任一文件后请重启 GeoDolly，生成一张新地图；效果与预期不符时检查配置 warning。

[← 用户指南](00-index.md) · [配置总览](02-configuration.md) · [Base 与 Expert](04-base-and-experts.md)
