# 04 · web.yaml

[English](../en/04-web-yaml.md) · **简体中文**

[`config/web.yaml`](../../config/web.yaml) 控制 HTTP 地址、工具容量、Session 有效期和 Snapshot 资源限制。修改现有字段后重启 GeoDolly。下文解释当前字段；实际数值请以部署文件为准。

## 本页目录

[HTTP 地址](#http) · [工具执行](#tool_execution) · [Session](#session) · [Snapshot](#snapshot)

### http

| 字段 | 用途与调整 |
| --- | --- |
| `listen_host` | 地图服务和 warning 服务共用的非空监听地址。`127.0.0.1` 仅接受本机连接；通过代理或其他网络部署时应选择可达的监听地址。 |
| `warning.port` | Browser warning 上报服务的正整数 TCP 端口，最大 65535；与地图端口分开。 |
| `warning.max_body_bytes` | 解析 JSON 前允许的单次 warning 请求体字节数上限，正整数。 |
| `warning.rate_limit_window_seconds` | 共享 warning 上报限流窗口的正整数时长，单位秒。 |
| `warning.max_requests_per_window` | 全服务每个窗口允许的 warning 请求数，正整数。 |
| `map.port` | 地图页面、数据、截图和瓦片服务的正整数 TCP 端口，最大 65535。 |
| `map.public_origin` | 工具返回地图链接时使用的外部可达 HTTP(S) origin；包含协议、主机和需要的公开端口，不带路径、账号信息、query 或 fragment。只改 `map.port` 不会自动更新它。 |

公开部署时，让 `map.public_origin` 指向用户浏览器能访问的地址，并将请求转发到配置的监听服务。附带的 localhost 地址适用于浏览器能访问同一台机器的情况。使用反向代理时也应为互动浏览器诊断配置 warning 上报路由。

### tool_execution

`location_search`、`tool_a` 和 `tool_b` 共用这些限制。排队时间与执行超时分开计算。

| 字段 | 用途与调整 |
| --- | --- |
| `max_workers` | 同时执行的工具调用数，正整数；调大也会增加同时发出的上游请求和截图负载。 |
| `max_queue_length` | 等待 worker 的请求数，非负整数；设为 `0` 时，worker 全忙就立即返回 busy。 |
| `timeout_seconds` | 取得 worker 后单次调用的正数总时限，单位秒；覆盖分析、渲染及发布。`app.yaml` 中各单次请求超时不会延长它。 |

### session

互动地图在设定的有效期内可用。过期检查周期性运行，实际关闭可能晚于精确 TTL；重新打开或刷新不会续期。关闭后页面展示已保存的 Snapshot。地图归档文件仍按项目的归档行为保留。

| 字段 | 用途与调整 |
| --- | --- |
| `ttl_seconds` | 活跃互动地图的正数有效期，单位秒；`86400` 为 24 小时。 |
| `expiry_check_interval_seconds` | 过期检查的正数间隔，单位秒；`1800` 允许约 30 分钟关闭延迟。 |
| `flush_interval_seconds` | 保存 Session 索引的正数间隔，单位秒；调小会更频繁保存。 |
| `max_timer_delay_ms` | Node 单次 timer delay 的正整数上限，单位毫秒；应保持在运行时支持范围内，更长的检查间隔会在每次计时中封顶。 |

新地图各自计算有效期。改动此配置不会延长已有地图的使用时间；重启并生成新地图后再核对效果。

### snapshot

| 字段 | 用途与调整 |
| --- | --- |
| `max_wrapper_physical_pixels` | 完整 Snapshot wrapper（含 MapSurface 和参考栏）的正整数物理像素上限。当前设备缩放因子固定为 1，因此限制截图宽 × 高；调大可能增加内存占用。 |

[← 用户指南](00-index.md) · [app.yaml](03-app-yaml.md) · [Basemap & Filter](05-tiles-and-filters.md)
