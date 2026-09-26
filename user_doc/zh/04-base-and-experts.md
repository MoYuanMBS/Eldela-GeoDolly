# 04 · Base 与 Expert

[English](../en/04-base-and-experts.md) · **简体中文**

Base 是区域查询的默认规则；Expert 只有在请求中指定 ID 时才参与专题分析。二者都包含查询与 Overlay 选择规则：通用默认项放入 Base，按需启用的专题放入 Expert。

## 修改默认 Base

[`config/base.yaml`](../../config/base.yaml) 必须保留顶层 `context`。其中 `overpass_tags` 是默认正向查询条件，`overlay_rules` 决定哪些已取得的要素进入地图 Overlay。它们用于 `tool_a` 的区域查询，也用于 `tool_b` 的周边区域查询。

例如希望默认查询和显示标记为河流的水道，请在现有 `context` 下的两个列表中分别增加：

```yaml
# 加到 context.overpass_tags
- waterway=river

# 加到 context.overlay_rules
- match: "waterway=river"
```

这是**要加入现有列表的条目**，不是可直接替换整个 `base.yaml` 的文件内容。如果只增加查询条件、没有相应的 Overlay 选择规则，新取到的要素不一定会画到地图上。过宽的 `key=*` 会扩大查询量；只对部分任务需要的规则通常更适合写成[按需启用的 Expert](#按需启用的-expert)。

Base 和 Expert 的这两类规则支持 `key=*`、`key=value`、`key~=^value-regex$`。正则只匹配固定 key 的 value，必须首尾锚定；不要使用未确认兼容的正则扩展。

## 按需启用的 Expert

Expert 是按请求启用的专题规则，例如公园设施、商店或徒步路线。它可以扩大对应专题的查询范围、选择进入地图 Overlay 的要素，并为分析结果中的 tag 添加注释。**只有请求的 `attention_experts` 包含该 Expert ID 时才会启用**；添加配置本身不会让所有地图自动使用它。

## 从现有示例创建

打开 [`config/experts.yaml`](../../config/experts.yaml)。文件顶部的 `example_expert` 是可复制的完整示例。复制整个顶层条目，修改顶层键和各字段。例如新增一个图书馆专题：

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

`libraries` 是 Expert ID；`name` 是展示名，不是请求参数。重启服务后，在 `tool_a` 或 `tool_b` 请求中加入 `"attention_experts": ["libraries"]`。请先用少量明确的 tag 测试结果，再逐步增加范围。

| 字段 | 作用 |
| --- | --- |
| `hints` | 描述专题覆盖的内容，帮助调用方判断何时选择它。 |
| `overpass_tags` | 该专题的正向查询条件。 |
| `overlay_rules` | 决定哪些已取得的要素进入地图 Overlay。 |
| `tag_annotations` | 调整分析输出中匹配 tag 的文字表达；不负责查询或绘图。 |

如果希望新查询到的要素也出现在地图上，通常需要同时添加对应的 `overpass_tags` 与 `overlay_rules`。只增加 `tag_annotations` 不会自动抓取新要素。请避免不必要的 `key=*`，以免把专题查询范围扩大得过多。

## 规则写法

`overpass_tags` 和 `overlay_rules.match` 支持以下形式：

| 写法 | 含义 |
| --- | --- |
| `amenity=*` | key 为 `amenity`，任意 value。 |
| `amenity=library` | 精确 key/value。 |
| `amenity~=^(library|community_centre)$` | 固定 key 下，对 value 使用首尾锚定的正则。 |

正则写法中的 `key~=` 左侧必须是固定 tag key；value 正则应以 `^` 开始、以 `$` 结束，并使用与查询服务兼容的常见正则语法。`tag_annotations.match` 只使用精确或 `*` 匹配，不使用这类正则。无效的单条规则可能被跳过并产生 warning；整个配置结构无效则会报配置错误。

也可以创建 `config/expert/<id>.yaml` 单独存放一个 Expert，文件内容直接从 `name`、`hints` 等字段开始，不再包一层顶层 ID。同名时，单独文件优先于 `experts.yaml` 中的条目。

## 检查效果

重启服务，确认新 ID 可被选择；使用同一个地点分别调用不带和带 `attention_experts` 的工具，比较分析结果和地图。检查启动或运行日志中的配置 warning。如果要调整所有请求都适用的默认规则，请改 [Base](#修改默认-base)，不要让所有调用方都显式传入一个 Expert。

[← 用户指南](00-index.md) · [配置总览](02-configuration.md) · [底图与 Filter](03-tiles-and-filters.md)
