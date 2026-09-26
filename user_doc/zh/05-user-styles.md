# 05 · 用户地图样式

[English](../en/05-user-styles.md) · **简体中文**

GeoDolly 的用户样式由两部分配合完成：YAML 规则把 OSM tag 映射到 CSS class，CSS 决定匹配到的地图 Overlay 如何显示。现有入口是 [`config/style/style-rules.yaml`](../../config/style/style-rules.yaml) 和 [`config/style/style.css`](../../config/style/style.css)；主 CSS 已导入 `config/style/layers/` 下的示例文件。

## 为道路添加一种样式

假设要把 `highway=tertiary` 的 way 绘成绿色。在现有 `style-rules.yaml` 的 `rules` 列表中**追加**一个规则：

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

再在 [`config/style/layers/roads.css`](../../config/style/layers/roads.css) 中添加对应 class：

```css
.geomcp-user-overlay.geomcp-user-tertiary-road {
  fill: none;
  stroke: #238b45;
  stroke-width: 4px;
}
```

现有 `style.css` 已导入 `layers/roads.css`。如果改为新建 `layers/custom.css`，还需在 `style.css` 添加 `@import "./layers/custom.css";`。保存后重启服务，生成一张**新地图**检查效果；已有 WebP 截图不会因样式改动自动重做。

## YAML 规则要点

| 字段 | 要求 |
| --- | --- |
| `id` | 每条规则的唯一 ID，不要与现有内置或用户规则冲突。 |
| `kind` | 固定填写 `css`。 |
| `renderLayer` | `base`、`border` 或 `translucent`；后两种还必须提供非空 `effectType`。 |
| `featureType` | `node`、`way` 或 `area`；用户规则不支持 relation。 |
| `priority` | 非负整数，用于多条匹配规则的优先级处理。 |
| `key` / `value` | 精确的 OSM tag key；value 可以是精确字符串，也可以写成 `value: {regex: "^(tertiary|secondary)$"}`。 |
| `className` | 以 `geomcp-user-` 开头，并且必须在已加载的 CSS 中实际出现。 |

需要 Node 图标时，可在 **`featureType: node` 且 `renderLayer: base`** 的规则中增加 `nodeIcon`，例如 `nodeIcon: {asset: "icon/custom.svg", sizePx: 12}`。本地素材路径相对于 `assets/leaflet/`；也可使用合法 URL。图标的颜色等外观仍由对应 CSS class 控制。

## CSS 边界与排查

用户 CSS selector 必须位于 `.geomcp-user-overlay` 作用域内，且不能引用内置 class 或使用 ID selector。CSS 只允许稳定的 SVG 外观属性，例如 `fill`、`stroke`、`stroke-width`、透明度与虚线；几何、`transform`、动画、`filter`、`mask`、自定义属性及 `url()` 等不受支持。`@import` 只允许指向 `config/style/layers/` 内的本地 CSS 文件。

用户样式作用于支持 CSS 的地图 Overlay；它不改写内置 Canvas 要素、Core 绘制或固定页面 UI。若 CSS 不合法，服务可能无法启动；若 YAML 单条规则无效、class 缺失或 ID 冲突，规则可能被跳过并记录 warning。检查日志，并对照仓库已有机场、车站、道路和区域样式逐项修改。

[← 用户指南](00-index.md) · [配置总览](02-configuration.md) · [快速开始](01-getting-started.md)
