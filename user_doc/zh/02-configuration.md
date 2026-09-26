# 02 · 配置总览

[English](../en/02-configuration.md) · **简体中文**

GeoDolly 从仓库的 `config/` 目录读取配置。先找到负责该功能的文件，在现有 YAML 层级内修改字段，然后重启服务并生成一张新地图核对结果。运行中的服务不会自动热更新配置。

## 配置顺序

1. 按下表定位文件，只修改需要的现有字段，并保留其他必填配置。
2. 重启 GeoDolly。如果修改了 `app.yaml` 的 `ui.decorations_enabled`，需先运行 `npm run build:web`；该开关在构建浏览器页面时读取。
3. 用受影响的功能生成新地图，检查启动或调用时的 warning。整个文件格式错误可能阻止启动；单条无效规则则可能被跳过。

| 需要调整的内容 | 文件或指南 |
| --- | --- |
| 地点搜索、Overpass、地图行为或输出开关 | [`config/app.yaml`](../../config/app.yaml)，见下文 |
| 地图地址、工具执行或 Session 有效期 | [`config/web.yaml`](../../config/web.yaml)，见下文 |
| 底图提供商或输出 tag 清理 | [03 · 底图与 Filter](03-tiles-and-filters.md) |
| 默认查询或按需启用的专题规则 | [04 · Base 与 Expert](04-base-and-experts.md) |
| Overlay CSS、tag 样式规则或 Node 图标 | [05 · 用户地图样式](05-user-styles.md) |

## app.yaml

[`config/app.yaml`](../../config/app.yaml) 按用途划分配置。请修改现有 section，不要用局部示例覆盖整个文件。

| Section | 常见调整 |
| --- | --- |
| `nominatim` | 地点搜索的候选数量、请求超时和 User-Agent。 |
| `overpass` | 地图要素查询的服务地址池、请求超时、重试和 User-Agent。 |
| `basemap` | 瓦片请求的 User-Agent、超时及截图所需的最低成功瓦片比例。底图地址和署名在 [`tiles.yaml`](03-tiles-and-filters.md#底图-profile) 配置。 |
| `output` | `allow_overlay_geojson` 控制是否允许返回独立 Overlay JSON。请求还需设置 `include_overlay_geojson: true`，并且本次确有 Overlay 数据。 |
| `ui` | `decorations_enabled` 控制可选页面装饰；修改后需重新构建浏览器页面。 |
| `geometry`、`iframe_adaptive`、`leaflet` | 地理范围与地图显示参数；调整时保留现有字段结构。 |

正式部署时，应将 `nominatim.user_agent`、`overpass.user_agent` 和 `basemap.user_agent` 的测试值改为适合该服务的标识。

## web.yaml

[`config/web.yaml`](../../config/web.yaml) 控制地图地址与运行限制：

| Section | 作用 |
| --- | --- |
| `http.listen_host`、`http.map.port` | 地图服务的监听地址与端口。本地地图端口为 `23336`。 |
| `http.map.public_origin` | 返回地图链接使用的基础地址；必须能被用户浏览器访问。仅修改监听端口不会自动改变返回链接。 |
| `tool_execution` | 工具调用的 worker 数、等待队列长度和单次超时。 |
| `session` | 互动地图有效期、过期检查和索引保存间隔。本地默认有效期为 24 小时，每 30 分钟检查一次。 |
| `snapshot` | 截图容器的最大像素预算。 |

公开部署时，让 `http.map.public_origin` 指向外部可访问的地图地址，并将请求转发到配置的监听服务。当前 `127.0.0.1` 地址只适用于浏览器能在本地访问服务的情况。

[← 用户指南](index.md) · [快速开始](01-getting-started.md) · [底图与 Filter](03-tiles-and-filters.md)
