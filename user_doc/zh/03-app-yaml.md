# 03 · app.yaml

[English](../en/03-app-yaml.md) · **简体中文**

[`config/app.yaml`](../../config/app.yaml) 控制地点搜索、要素查询、编号、地图尺寸与显示。多个组件共用这份文件。请在原有 section 内修改字段，并重启 GeoDolly；`ui.decorations_enabled` 还需要重新运行 `npm run build:web`。

## 本页目录

[工具文案](#prompts) · [地点搜索](#nominatim) · [Overpass](#overpass) · [Geometry](#geometry) · [Feature ID](#feature_id) · [地图尺寸](#iframe_adaptive) · [浏览器启动](#browser_map) · [MCP app](#mcp_apps) · [底图请求](#basemap) · [输出](#output) · [UI](#ui) · [Leaflet](#leaflet)

### prompts

`location_search`、`tool_a`、`tool_b` 各有 `title` 和 `description`。`title` 是 MCP 客户端显示的工具名；`description` 向 AI 说明工具用途和调用方式。部署时可调整文案，但保留工具 key 和 YAML 结构。文案只负责引导客户端；实际使用边界见[使用政策](../../POLICY.md)。

### nominatim

| 字段 | 用途与调整 |
| --- | --- |
| `location_limit` | 每次地点搜索最多返回的候选数，整数 1–50。调大可提供更多选择，也会增加辨认负担。 |
| `user_agent` | 发给地点搜索提供商的非空部署标识；正式部署应使用合适的可识别值。 |
| `timeout_seconds` | 单次地点搜索 HTTP 请求的正数超时，单位秒；超时会使该次搜索失败。 |

### overpass

#### 服务地址与请求限制

[`config/app.yaml`](../../config/app.yaml) 的 `overpass` 部分决定地图要素查询发往哪些 Overpass API 实例。下面是当前单实例配置的片段；修改时保留文件中其他 `overpass` 字段：

```yaml
overpass:
  endpoint: "https://overpass-api.de/api/interpreter"
  endpoints: []
  endpoint_strategy: "round_robin"
```

- `endpoint` 为必填项。`endpoints: []` 时，**只使用**这个地址；只有一个地址时，选择策略没有实际区别。
- `endpoints` 是可选的有序实例地址列表。列表非空时，查询**只使用列表中的地址**，不会自动把 `endpoint` 作为备用。如果也希望使用 `endpoint`，必须把它加入列表。例如，先把下列示意地址替换为可用且允许你使用的实例地址：

  ```yaml
  endpoints:
    - "https://your-overpass-1.example/api/interpreter"
    - "https://your-overpass-2.example/api/interpreter"
  ```

- `endpoint_strategy: "failover"` 使每次查询都从列表首项开始，发生重试时才依次切换；`"round_robin"` 在不同查询间轮换起始地址，重试时继续切换。如果关闭重试，`failover` 就会一直使用首项。
- `retry_attempts` 是**额外重试次数**：设为 `3` 时，一次查询最多尝试四次。连接失败、超时、HTTP 429/5xx 及无效 JSON 可能触发重试；普通 HTTP 4xx 和成功响应中报告的 Overpass 查询错误不会。`retry_delay_seconds` 是首次重试的基础等待时间，后续等待翻倍；提供商返回更长的 `Retry-After` 时优先遵守。`timeout_seconds` 限制单次 Overpass 请求，不是整次地图工具调用的总时限。
- `user_agent` 用于向 Overpass 标识当前部署。正式使用时应设置适合服务的可识别值；`nominatim.user_agent` 和 `basemap.user_agent` 也分别用于对应的提供商。

其余 Overpass 字段控制复杂查询的范围与节奏：

| 字段 | 作用 |
| --- | --- |
| `relation_parent_depth` | 为命中要素向上查找 parent relation 的层数；设为 `0` 则不查找。 |
| `relation_member_depth` | 地图 Overlay 向下展开嵌套 relation member 的深度；非负整数限定层数，`"all"` 表示继续展开嵌套关系。 |
| `overlay_skel_id_batch_size` | 单次后续要素查询的最大 ID 数；也限制单次缺失 area way 补查。 |
| `overlay_skel_concurrency` | 后续查询批次的最大并发数。 |
| `overlay_skel_batch_delay_seconds` | 后续批次开始请求之间的最短间隔。 |

这些值会影响上游负载和查询耗时。建议先使用随附配置，仅在明确需要调整服务负载或数据覆盖时再修改。

### geometry

这些字段控制查询范围和几何复杂度。距离单位见字段名，面积上限单位为平方千米（`km²`）。修改后会改变数据量、分析耗时和细节，请注意overpass限制。

| 字段 | 用途与调整 |
| --- | --- |
| `line_buffer_meter` | LineString/MultiLineString 周围的缓冲距离，单位米，非负；调大可覆盖更宽的走廊。 |
| `tool_a_bbox_expand_km` | Tool A 查询 bbox 的扩展距离，单位千米，非负。 |
| `tool_b_bbox_expand_km` | Tool B 瓦片 bbox 的扩展距离，单位千米，非负。 |
| `base_tolerance_meter` | 几何简化 tolerance 的下界，单位米，非负。 |
| `max_tolerance_meter` | 简化 tolerance 上界，单位米，正数；建议保持不小于 `base_tolerance_meter`；调大可能减少细节。 |
| `max_node` | 简化后外环节点数的正整数上限；调小会减少几何细节。 |
| `max_retry` | 初次尝试后最多进行的反馈修正次数，非负整数。 |
| `tool_a_max_area_km2` | Tool A 分析模式允许的正数面积上限。 |
| `tool_b_max_area_km2` | Tool B 核心区域分析的正数面积上限；超限时可能改为更广的 bbox 查询或纯底图预览。 |
| `max_core_area_km2` | Overpass core polygon 的独立正数面积上限，不等同于瓦片 bbox 面积限制。 |

### feature_id

#### 编号格式与显示字符

`feature_id` 分两层：`id_scheme` 决定生成的 **canonical `feature_id`**；`render` 可以改变地图与分析输出中展示的 **`display_id`**。生成的 Feature ID 不是 OpenStreetMap element ID。`node`、`way`、`area`、`relation` 各有独立命名空间，因此不同类型可以出现相同文本的 ID。

当前配置完整展示了这一部分的写法：

```yaml
feature_id:
  alphabet_pool: "DFHJPWXYKC"
  id_scheme:
    node: {template: "{num}", mode: global}
    way: {template: "{alpha}{num}", mode: grouped, group: 20}
    area: {template: "{num}{alpha}", mode: global}
    relation: {template: "{alpha}-{num}", mode: round}
  render:
    active_skins: default_skin
    skins:
      alphabet:
        ganzhi: "甲乙丙丁庚辛壬癸子丑"
      digits:
        chinese: "〇一二三四五六七八九"
```

- `alphabet_pool` 是按顺序排列、互不重复的 ASCII 字母 `A`–`Z`。字母顺序决定生成 ID 的字母部分，也决定 alphabet 显示皮肤逐字符映射的位置。
- `id_scheme` 分别为四种类型设置 `template` 和 `mode`。`{num}` 是数字，`{alpha}` 来自字母池。默认配置的**形式示例**分别是 node 的 `1`、way 的 `D1`、area 的 `1D`、relation 的 `D-1`；如果与要素 `ref` 冲突，实际首个 ID 可能不同。`global` 在类型内持续递增数字；`grouped` 每经过 `group` 个编号再换字母；`round` 先轮换字母，再递增数字。使用 `grouped` 时，`group` 必须为正整数。
- `template` 可以只写 `{num}` 或 `{alpha}`，也可以按任一顺序组合两者，中间可选一个 `-`、`_`、`~` 或 `=`；不能添加任意前后缀。
- `render.active_skins: default_skin` 保持生成 ID 原有的字符。要启用示例中已登记的皮肤，在 `render` 下把该值改为：

  ```yaml
  active_skins:
    alphabet: ganzhi
    digits: chinese
  ```

  可以只选其中一组；省略的组保持 `default_skin`。alphabet 皮肤需要按 `alphabet_pool` 顺序提供等长、互不重复的字符；digits 皮肤需要为 `0`–`9` 提供十个互不重复的字符。选用的皮肤必须已在对应的 `render.skins` 分组中登记。
- 要素有可用 `ref` 时，显示 ID 优先使用 `ref`，而不是生成的 ID；皮肤不会改写 `ref`。重复的 `ref` 会经过消歧。更改皮肤只影响展示；更改 `alphabet_pool` 或 `id_scheme` 会改变**新地图**生成的 canonical ID。如果没有明确需要改变编号形式，建议保留现有 scheme。

### iframe_adaptive

这些参数决定地图画布的建议尺寸。地图持续过小、过大或被裁切时再调整；大截图通常需要更多时间和内存。如果最大尺寸或像素预算不足以满足最小约束，浏览器侧可能自动提高有效上限并记录 warning。

| 字段 | 用途与调整 |
| --- | --- |
| `node_weight`、`way_weight`、`area_weight`、`relation_weight` | 各类最终要素对内容复杂度的数值权重；调大使密集地图影响更明显。 |
| `secondary_factor_weight` | 次级因子超过基础倍率后的数值贡献。 |
| `max_area_factor` | 建议面积倍率的上限。 |
| `min_screenshot_width`、`max_screenshot_width` | MapSurface 逻辑像素宽度的最小/最大值，正整数；为满足下限或宽高比，上限可能被提高。 |
| `min_screenshot_height`、`max_screenshot_height` | MapSurface 逻辑像素高度的最小/最大值，正整数。 |
| `max_screenshot_pixels` | MapSurface 逻辑像素面积上限（宽 × 高），正整数；与 `web.yaml` 的物理 wrapper 预算不同。 |
| `reference_screenshot_area` | 建议面积倍率为 1 时的正数参考逻辑像素面积。 |
| `min_aspect_ratio`、`max_aspect_ratio` | 正数宽高比下限/上限；下限不得高于上限。 |
| `padding.top`、`padding.right`、`padding.bottom`、`padding.left` | 初始视口 bbox 四周的正数逻辑像素留白；左右相等、上下相等，且须为画布留下可用空间。 |
| `min_map_display_width`、`min_map_display_height` | MapSurface 最小可读尺寸，正整数逻辑像素；可能提高有效截图下限。 |

Snapshot 参考栏高度单独测量；完整截图 wrapper 还受 [web.yaml](04-web-yaml.md#snapshot) 限制。

### browser_map

| 字段 | 用途与调整 |
| --- | --- |
| `ready_timeout_seconds` | 等待浏览器初始地图及视觉部分就绪的正数总时限，单位秒；只在经常超时时调大，仍受 `web.yaml` 工具总时限约束。 |

### mcp_apps

| 字段 | 用途与调整 |
| --- | --- |
| `interactive_map_launcher.preferred_height_px` | MCP Host 没有指定固定高度时，完整互动地图请求的首选 CSS 高度，正整数；Host 仍可限制高度。 |
| `interactive_map_launcher.load_notice_delay_ms` | iframe 尚未可用时，更新手动打开/复制链接提示的非负等待时长，单位毫秒。 |

### basemap

这里控制所选底图的服务端请求。提供商地址、名称和版权署名在 [`tiles.yaml`](05-tiles-and-filters.md#basemap-profile) 中配置。

| 字段 | 用途与调整 |
| --- | --- |
| `user_agent` | GeoDolly 请求上游瓦片时发送的非空部署标识。 |
| `upstream_timeout_seconds` | 单次上游瓦片请求的正数超时，单位秒。 |
| `snapshot_min_tile_success_ratio` | Snapshot 首屏所需瓦片的最低成功比例，范围 `0`–`1`。`1` 要求全部成功；`0` 允许空底图。缺失瓦片但达到阈值时会记录 warning。 |

### output

| 字段 | 用途与调整 |
| --- | --- |
| `allow_overlay_geojson` | 是否允许返回独立 Overlay JSON 的布尔部署开关；工具请求还需设置 `include_overlay_geojson: true`，且本次确有 Overlay 数据。 |

### ui

| 字段 | 用途与调整 |
| --- | --- |
| `decorations_enabled` | 是否挂载 Interactive 可选装饰的布尔开关；修改后运行 `npm run build:web`，因为它在构建期读取。 |
| `max_scale_width_px` | 公制 Scale 的正整数最大逻辑像素宽度。 |
| `feature_ui_max_height_px` | Feature UI 展开内容的正整数最大逻辑像素高度；超过时在内部滚动。 |
| `measurement_preview_refresh_interval_ms` | 鼠标移动时测量预览的正整数最小刷新间隔，单位毫秒；调大可减少刷新频率。 |

### leaflet

这些字段控制可见地图与交互尺寸。这里的像素均指屏幕逻辑像素；修改命中尺寸会影响相邻要素的选取难易。

| 字段 | 用途与调整 |
| --- | --- |
| `viewport.max_zoom` | 正整数视觉 zoom 上限；与底图提供商的 `max_native_zoom` 独立。 |
| `render_batch_size` | 浏览器每渲染多少个要素让出一次执行权，正整数；调小可提高加载期间响应性，但增加调度次数。 |
| `node_zoom.hidden_max_zoom` | 小于或等于此正整数 zoom 时隐藏 Node 要素。 |
| `node_zoom.compact_max_zoom`、`node_zoom.medium_max_zoom` | Node 紧凑档/中档的正整数 zoom 边界；三个边界必须严格递增。 |
| `node_zoom.compact_scale`、`node_zoom.medium_scale` | Node 半径倍率，大于 0 且不超过 1；紧凑档倍率不得高于中档，高 zoom 恢复原半径。 |
| `relation_membership.node_radius_px`、`node_stroke_width_px`、`way_width_px`、`area_band_total_width_px` | Relation 成员点、线和区域边带的正数逻辑像素尺寸，必须处于下方视觉上限内。 |
| `interaction.node_extra_radius_px`、`way_extra_width_px`、`area_edge_width_px` | 可见 Node、Way、Area 指针选取范围的正数逻辑像素补量。 |
| `interaction.min_node_radius_px`、`max_node_radius_px`、`min_way_width_px`、`max_way_width_px`、`max_area_edge_width_px` | 正数命中尺寸上下限；各下限不得高于上限，`area_edge_width_px` 不得超过对应上限。不可见要素不会恢复交互。 |
| `visual_limits.max_canvas_node_radius_px`、`max_canvas_stroke_width_px` | Canvas/Relation 视觉尺寸的正数逻辑像素上限。超限的 Canvas/Relation 配置可能校验失败；用户 CSS 超限会 warning，命中层仍受上限约束。 |

[← 用户指南](00-index.md) · [配置总览](02-configuration.md) · [web.yaml](04-web-yaml.md)
