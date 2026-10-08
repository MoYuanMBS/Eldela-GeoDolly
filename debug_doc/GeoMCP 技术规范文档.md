# GeoMCP 项目架构简介

本文依据 GeoMCP 总体技术规范 v2.6 整理，重点介绍 TypeScript 与 MCP Tool、MCP App 的对接。
本文是架构导读，不替代总体规范；Python 仅介绍跨层职责与数据边界。

## 1. 整体组成

GeoMCP 是基于 MCP 的地理信息检索、分析与地图展示工具集。
用户或 AI 先搜索并确认地点，再执行分析，最后获得结构化结果、地图 App 与对应地图产物。

系统由以下部分组成：

| 部分 | 主要职责 |
|---|---|
| TypeScript 后端 | MCP 接入、候选缓存、工具调度、Python 调用、结果整理与地图发布 |
| 浏览器地图 runtime | React 页面、Leaflet 地图、底图、Overlay 与交互 |
| MCP App | 宿主协议对接、User / AI 双地图组合、AI 视口工具 |
| Python | 地点检索、地理查询、过滤、几何处理与地理结果生成 |

MCP Server 与地图服务由同一个常驻后端提供，共用公开 HTTP/HTTPS listener。
客户端连接或退出不会启动、停止后端进程。
搜索与正式地图调用需要进入同一后端实例，因为完整地点候选暂存在该进程内。
当前 App 由现有后端交付；独立部署的工具转发包仍是待实施目标。

## 2. TypeScript 目录与依赖边界

TypeScript 将 Node 服务端、浏览器实现、共享逻辑和数据模型分开组织。

| 目录或入口 | 职责 |
|---|---|
| `src/index.ts` | 后端组合入口、Tool 注册与生命周期 |
| `src/server/tools/` | MCP Tool 适配、执行调度与地图发布编排 |
| `src/server/map-data/` | typed join、展示 ID、AI 输出与底图 profile 解析 |
| `src/server/map-session/` | 地图归档装载、截图、RAM Session、TTL 与索引保存 |
| `src/server/http/` | MCP 协议会话、地图页面、底图 endpoint 等 HTTP 边界 |
| `src/server/iframe-capture/` | 地图逻辑尺寸、投影中心与 Leaflet bounds |
| `src/server/utils/` | 配置、Bridge、文件、日志、Session ID 与用户样式 |
| `src/browser/` | React 页面与共享地图 runtime |
| `src/shared/` | 无 Node/DOM runtime 依赖的共享实现 |
| `src/models/` | Bridge、地图、App、Session 与工具输入输出模型 |
| `mcp-app/` | 宿主入口、角色地图组合与 App 工具注册 |

依赖方向为 `index.ts → server`、`server → models/shared`、`browser → models/shared`。
Browser 不导入 Server，Shared 不导入 Server 或 Browser。
Node 配置装载、文件系统、Python Bridge 与服务端 logger 只存在于 Server。
Node 与 Browser 使用各自的 TypeScript 检查入口，浏览器源码由 Vite 构建。

## 3. 后端 MCP Tool 与地点确认

后端 `tools/list` 固定包含三个地理工具：

| 工具 | 用途 |
|---|---|
| `location_search` | 检索地点，返回候选与搜索 Session ID |
| `tool_a` | 道路与交通网络分析 |
| `tool_b` | 区域与设施分析 |

`location_search` 调用 Python Nominatim 检索，再由 TS 缓存完整候选。
AI 只看到允许暴露的候选字段，不直接构造完整 `selected_candidate`。
候选确认后，TS 根据搜索 Session 与候选 index 从缓存恢复实际对象。
`needs_confirmation` 表示有候选待确认；`no_match` 是正常的无匹配结果。
没有匹配时，不能构造候选选择继续执行地图工具。
`queries` 与 `selected_indices` 保留数组接口，但当前只执行各自第一项。

搜索 Session ID 由 Python 生成，形式为 `YYMxxxxxxxx`。
正式调用 Tool A/B 前，TS 使用实际候选的 `candidate.index` 构造最终地图 ID：
`<search_session_id>-<candidate.index>`。
Python 请求与响应、地图归档、RAM 索引和公开地图地址统一使用这个最终 ID。
MCP 协议会话 ID 则用于连接路由，与上述业务 ID 分别管理。

## 4. 工具调度、执行预算与取消

三个后端工具共用 Node 侧有界调度器。
最大 worker 数、最大等待队列长度与单次执行超时来自已校验的 YAML 配置。

- 有空闲 worker 时开始执行；没有空闲 worker 时进入有限等待队列。
- 队列已满时立即返回结构化 `busy`，不建立队列外无限等待。
- 每次调用独立排队、独立计时，排队时间不计入执行超时。
- 搜索预算覆盖 Nominatim 与候选处理。
- Tool A/B 预算覆盖 Python 分析、TS 整理、截图、文件交付与发布。
- 搜索后的确认或思考间隔，不计入下一次工具调用。

执行超时需要停止当前 Python/Browser 任务与后续发布，并回收执行名额。
客户端显式取消通过 `requestContext.mcpReq.signal` 接入调度器和业务执行路径。
普通 HTTP/SSE 断线不自动等同于取消工具，也不触发全局关闭。
截图或底图子流程可以有自己的超时，但不能突破当前工具剩余的总预算。

## 5. 从地理结果到地图发布

`src/server/tools/tools.ts` 位于 MCP 注册层与内部地图 Flow 之间。
它恢复候选、组装 Python query、解析 basemap，并调用对应 Python action。
随后将 `requestedFlow` 交给 `src/server/tools/tool-flow.ts`。
后者只处理地图数据整理和发布，不识别公开 Tool 名称。

| 条件 | TS 地图流程 |
|---|---|
| 请求 `tool_a` | Non-core |
| 请求 `tool_b` | Core |
| Python 返回 `effective_query_mode=basemap_only` | Basemap-only |

Core / Non-core 由请求的 Tool 决定。
Tool B 在 Python 内降级到 Tool A 查询模式时，TS 仍保留 Core 地图模式。
Basemap-only 跳过普通 Overlay、Core Overlay、Relation、Label 与地图交互。
Core 模式的 `core_visual=null` 只跳过独立 Core Overlay，不改变整体地图模式。

TS 对 Python 结果执行一次统一整理：

1. 保持 AI Output 与 Identified Overlay 两条独立数据路径。
2. 为 Overlay records 补充 `display_id`，并检查同类型内的展示 ID 冲突。
3. 按 typed OSM identity，将 canonical `feature_id` 与展示 ID 补入匹配的 AI records。
4. 建立 relation 到已匹配空间 Feature 的索引，以及 Feature 到 relation 的反向索引。
5. 根据权威 bbox 与面积倍率计算逻辑尺寸、center 和 `leaflet_bbox`。
6. 从同一次整理结果构造网页归档、AI 输出与 App 共享业务数据。

canonical `feature_id` 由 Python 生成，TS 不改写。
relation 自身不生成 Overlay Feature，只关联最终 Overlay 中已有的空间对象。
Interactive、Snapshot 与 App 复用同一次 enrichment，不在各分支重新编号。

## 6. MCP App 资源与工具结果交付

后端使用 `@modelcontextprotocol/ext-apps` 注册地图 App 资源。
资源标识为 `ui://geomcp/interactive/map-launcher.html`。
Vite 将 React、Leaflet、JS、CSS、资源、用户样式和渲染配置构建为单文件 HTML。
后端负责提供构建好的资源，宿主 iframe 负责承载 App。

App 的宿主入口位于 `mcp-app/interactive-map-launcher.ts`。
交付模型位于 `src/models/web/map-app-models.ts`。
地图工具结果的 `_meta["io.geomcp/interactiveMap"]` 携带三个顶层字段：

| 字段 | 内容 |
|---|---|
| `data` | 两个角色共享的地图业务数据 |
| `user_payload` | User 地图的逻辑尺寸、中心、范围和必需的独立页面地址 |
| `ai_payload` | AI 地图布局，地址可省略；无 AI 视觉时为 null |

`data` 包含最终 Session ID、`visual_output`、`render_mode` 与 Browser-safe basemap。
它还包含 Overlay、Core geometry、relation 索引、AI Output、展示 ID 映射与地点名。
Basemap-only 的 AI Output、展示 ID 映射和 Feature 到 relation 的反向索引为 null。
`data` 不包含角色布局、Leaflet 配置、用户样式或 `close_time`。

角色布局使用 `map_size=[width,height]`、`center=[lat,lng]`。
`leaflet_bbox` 使用 `[[south,west],[north,east]]`。
尺寸是正整数 CSS 逻辑像素，只描述地图区域，不含信息栏或宿主显示缩放。
契约允许角色布局独立；当前发布层为两角色使用同一初始视口。

后端发布层与 App 接收层分别校验自己的传输边界。
App 只解析一份共享业务数据，再创建两个角色的容器。
共享数据或 User 布局失败时清理两图；AI 局部失败只关闭 AI 并保留 User。
交付地址必须匹配构建期后端 origin、部署前缀与最终 Session 的固定 route。
App 直接从工具结果初始化地图，不请求 Session data route 或页面/图片地址。
旧 `{url, session_id, map_data}` 只作为 User-only 兼容，不启用 AI 工具。

## 7. User / AI 双地图与视觉输出

App 复用 `src/browser/` 的地图与 UI 源码。
User 使用完整 Interactive，AI 使用精简 Snapshot 视觉 adapter。
Overlay、Core geometry、relation 索引和构建期样式保持共享引用。
两张地图的 Leaflet 实例、layer、事件与生命周期各自独立。
Leaflet runtime 对象不进入 Bridge、JSON 归档或 React state。

| 界面 | 职责 |
|---|---|
| User Standard UI | 实时比例尺、空间 Feature 或测量摘要、Attribution |
| User Feature UI | 折叠式详情区，展开后显示 Enriched AI Output JSON 树 |
| User Tool UI / Popup | 缩放、线/面与圆测量入口、Feature 或测量详情 |
| AI Reference UI | 实时比例尺与 Attribution，不读取交互详情树 |

`visual_output` 是必填枚举，决定 AI-facing 视觉地址与 App AI 是否创建。
它与 `render_mode` 独立，不传给 Python，也不改变 User 完整数据交付。

| 值 | AI-facing 视觉地址 | App 地图 |
|---|---|---|
| `none` | 无 | 仅 User，AI payload 为 null |
| `screenshot` | 固定 WebP 截图 route | User + 动态 AI |
| `interactive` | Snapshot Interactive route | User + 动态 AI |

三种模式都会按后端流程生成 WebP 和归档。
AI App 的动态视口与静态 WebP 独立，后续视口调整不覆盖初始布局或服务端图片。
宿主控制 iframe 的最终尺寸、显示与卸载；App 不按 Session 到期时间主动关闭地图。

## 8. 宿主到 App 的 AI 视口工具

一个 SDK `App` 在 connect 前通过 `mcp-app/register-tools.ts` 注册两个工具。
它们属于宿主到已挂载 App 的 RPC，不加入后端三个地理工具的列表。
两个工具使用严格输入/输出 schema，annotations 为 `readOnlyHint=false`、`idempotentHint=true`。

| 工具 | 输入 | 行为 |
|---|---|---|
| `geomcp_fit_ai_map_bbox` | `{session_id, bbox:{south,west,north,east}}` | 用现有 padding 将完整目标范围放入 AI 画布 |
| `geomcp_set_ai_map_center_zoom` | `{session_id, center:{longitude,latitude}, zoom}` | 设置 AI 中心与非负整数 Leaflet zoom |

经纬度单位为度，zoom 表示 Leaflet 地图级别，不是比例尺或宿主显示缩放。
工具每次读取当前 ready 绑定，并核对最终地图 Session ID。
工具初始禁用，AI 首屏瓦片/视觉、Scale 成功或省略、Reference UI 布局完成后才启用。
新结果到达时，即使 Session ID 相同，也按新代次撤销旧绑定。
none、旧交付形状、失败或 teardown 同样禁用工具，迟到回调不能恢复旧绑定。

经度保持靠近初始 center 的连续世界副本，跨日期变更线的 bbox 保留完整跨度。
输入纬度允许 `[-90,90]`，adapter 在修改前拒绝超过 Mercator 可投影范围的目标。
视觉 zoom 受配置上限约束，结果必须读取实际采用值。

成功时，`structuredContent` 与唯一 JSON text 共用同一份结果：
`{session_id, center:{longitude,latitude}, zoom, visible_bounds:{south,west,north,east}, logical_size:{width,height}}`。
`visible_bounds` 是当前可见范围，区别于查询 bbox 与初始布局。
成功表示视口已应用，不保证新瓦片、实时信息栏或新截图已就绪。
命令关闭动画，不查询 Overpass、不扩大业务数据范围、不生成截图、不改变 User 地图。
当前没有 App 当前视口截图或图片上传工具。

业务失败返回 `isError=true` 与 `{code,message,details}` JSON text，不附成功 structuredContent。
常见错误包括 `ai_map_session_mismatch`、`ai_map_not_ready`、`ai_map_unavailable`、
`ai_map_bbox_uncovered`、`ai_map_projection_unsupported` 与 `ai_map_view_failed`。
无效 schema 和禁用工具的分发由 SDK 拒绝。

## 9. 底图、初始视口与截图

后端根据权威 bbox 与 Python 面积倍率确定 MapSurface 尺寸、center 和 Leaflet bounds。
Leaflet 在固定画布上根据 bounds 与 padding 求初始 zoom，Playwright 不参与视口决策。
Interactive、Snapshot 与 App 共享地图视觉 runtime；底图与 Overlay 是解耦的异步子流程。

MCP Tool 的 `basemap` 是 `config/tiles.yaml` 中的动态 profile ID。
Node 解析为 Browser-safe profile，Provider upstream、凭据与请求配置不进入浏览器。
App 使用构建期后端基础地址与最终 Session ID 拼接底图 endpoint。
底图请求由 Node 转发，不调用 Tool worker 或 Python pipeline。
底图原生最大 zoom 不限制 Overlay 视觉 zoom，超过时放大原生瓦片。
GeoMCP 应用代码不实现内存或磁盘瓦片 Cache。

服务端通过有界 Playwright browser/page 资源生成无损 `snapshot.webp`。
截图等待初始视图、适用 Overlay/Core/Relation、首屏瓦片终态和 Reference UI 布局稳定。
首屏瓦片按配置成功率判定，允许的字体、装饰或 Scale 失败按既定规则恢复或省略。
地图初始化、必要 Overlay、完整 Attribution 或最终布局失败仍使截图失败。
截图覆盖 MapSurface 与 Reference UI 的完整 wrapper，并核验物理像素预算。

## 10. 发布、Session 与 HTTP 生命周期

发布先准备最终 ID 的固定目录，写入候选、互动地图归档和实际存在的快速产物。
快速产物完成后临时登记 RAM，让 Playwright 能读取 Snapshot 页面。
WebP 写入及全部必需文件核验后，再正式登记并向 AI 返回地址和 App metadata。
失败或取消撤销登记并清理同 ID 目录。
当前采用删除同名旧目录再直接重建的策略，不提供旧归档回滚或同 ID 并发写入保证。

`sessions.json` 是 RAM 索引的定时 checkpoint，不是单次工具调用的提交点。
地图 Session 从 active 转为 archived 后，后端停止新的底图供应。
完整 Interactive 页面及数据仍可读；Snapshot Interactive 降级显示缓存截图，其动态数据返回 410。
普通访问、刷新和后端重启不续期；当前没有 Session reopen 工具。
cache/output 不整体静态公开，地图与产物只通过 Session manager 授权的固定 route 访问。

MCP 使用 `NodeStreamableHTTPServerTransport`，每个协议会话拥有独立 Server 与 transport。
首次初始化分配 `Mcp-Session-Id`，后续 POST、GET/SSE、DELETE 按该 ID 路由。
搜索缓存、调度器、地图 Session manager 与 Snapshot service 由 index 创建并共享。
DELETE 仅结束对应协议会话；后端退出或启动失败才执行全局资源清理。

## 11. 配置、校验与 Python 边界

TS 配置由 Zod 在 loader 边界校验，注册工具前预载当前使用的配置与专家名称。
`app.yaml` 管理地图与 App 展示配置，`web.yaml` 管理执行、HTTP、Session 和截图部署配置。
App 用户样式、资源和渲染配置在 Vite 构建时冻结，运行时不从后端热加载。
后端注册资源时校验预载的公开基础地址，资源 CSP 允许后端 origin 的底图资源。
错误通过 `AppError.toJSON()` 统一为 `{code,message,details}`，不暴露 stack 或 cause。
MCP 业务响应走 HTTP transport；Python stdout 只用于 Bridge JSON，日志走 stderr。

Python 负责 Nominatim、Overpass、过滤、几何处理、canonical ID 与视口面积倍率。
`python/main.py` 只解析 Bridge、整理错误与分发，Tool A/B pipeline 由各自 runner 编排。
TS 请求使用 `{action,data}`，Python 响应使用 `{ok,data,error}`。
Tool 成功 data 为 `session_id + result`，result 包含权威 bbox、两路地理结果与有效查询模式。
Python 不下载或拼合底图、不初始化 Leaflet，也不生成最终地图图片。
