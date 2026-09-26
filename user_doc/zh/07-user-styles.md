# 07 · 用户地图样式

[English](../en/07-user-styles.md) · **简体中文**

GeoDolly 用 YAML 规则匹配 OSM tag。CSS 可以设置地图 Overlay 的外观；Node Base 规则还可以通过 `nodeIcon` 显示本地 SVG 或 PNG 图片。配置入口包括 [`config/style/style-rules.yaml`](../../config/style/style-rules.yaml)、[`config/style/style.css`](../../config/style/style.css)，以及 `assets/leaflet/` 下的本地图片。主 CSS 已导入 `config/style/layers/` 下的示例文件。

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

## 添加本地 SVG 或 PNG Node 图标

先把图片放到 `assets/leaflet/` 下，例如 `assets/leaflet/icon/my-place.svg` 或 `assets/leaflet/icon/my-place.png`。然后在 `style-rules.yaml` 现有的 `rules` 列表里追加 Node Base 规则：

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

`nodeIcon.asset` 相对于 `assets/leaflet/`，所以上例实际引用 `assets/leaflet/icon/my-place.svg`。如果使用 PNG，把 `my-place.png` 放在相同目录，并把 `asset` 改为 `icon/my-place.png`。本地还支持 JPG/JPEG、WebP、GIF、AVIF、BMP、ICO。`sizePx` 是正数基础尺寸，单位为逻辑像素。`nodeIcon` 只适用于 `featureType: node` 且 `renderLayer: base` 的规则；代码也支持用合法的 `nodeIcon.url` 引用外部图片，和本地 `asset` 是两种写法。

在 [`config/style/layers/nodes.css`](../../config/style/layers/nodes.css) 中添加必需的 class：

```css
.geomcp-user-overlay.geomcp-user-my-place-node {
  opacity: 1;
}
```

这个 class 可以控制 SVG `<image>` 元素本身的透明度等外层属性，不能改写 SVG 或 PNG 图片内部的颜色；要改变图案或颜色，请编辑图片文件。本地图片会被打包进浏览器资源，因此新增或修改图片后要运行 `npm run build:web`、重启 GeoDolly，并生成新地图检查。图片不存在或加载失败时，浏览器会记录 warning 并跳过图标。

## CSS 边界与排查

用户 CSS selector 必须位于 `.geomcp-user-overlay` 作用域内，且不能引用内置 class 或使用 ID selector。矢量地图路径可以使用 `fill`、`stroke`、`stroke-width`、透明度与虚线等稳定的 SVG 外观属性；`nodeIcon` 图片还可使用透明度等适用的外层属性，但 CSS 不会改写图片内容。几何、`transform`、动画、`filter`、`mask`、自定义属性及 CSS `url()` 等不受支持。`@import` 只允许指向 `config/style/layers/` 内的本地 CSS 文件。

用户样式作用于支持 CSS 的地图 Overlay；它不改写内置 Canvas 要素、Core 绘制或固定页面 UI。若 CSS 不合法，服务可能无法启动；若 YAML 单条规则无效、class 缺失或 ID 冲突，规则可能被跳过并记录 warning。检查日志，并对照仓库已有机场、车站、道路和区域样式逐项修改。

[← 用户指南](00-index.md) · [Base & Expert](06-base-and-experts.md)
