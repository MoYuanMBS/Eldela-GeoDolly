# 04 · web.yaml

[English](../en/04-web-yaml.md) · **简体中文**

[`config/web.yaml`](../../config/web.yaml) 控制 MCP/地图共用入口、独立 warning 服务、工具容量、Session 有效期和 App 截图预算。修改后重启后端；地址与截图构建设置还需要使用同一 `deploy/geomcp.env` 执行两次浏览器构建，详见[配置总览](02-configuration.md#何时需要重新构建)。

## 本页目录

[HTTP 地址](#http) · [服务器 HTTPS](#域名与-https-服务器部署) · [直接 TLS](#node-直接提供-https) · [工具执行](#tool_execution) · [Session](#session) · [Snapshot](#snapshot)

### http

| 字段 | 用途与调整 |
| --- | --- |
| `listen_host` | MCP/地图与独立 warning 服务的非空绑定地址。`127.0.0.1` 只接受本机连接，同机代理或隧道可以向它回源。 |
| `listen_protocol` | 本机 MCP/地图监听协议，可选 `http` 或 `https`；省略时沿用规范化后的公开地址协议。代理或隧道在外部终止 HTTPS 时使用 `http`。 |
| `warning.port` | Browser warning 服务的正整数 TCP 端口，最大 65535，与 MCP/地图端口分开。 |
| `warning.max_body_bytes` | 解析 JSON 前允许的单次 warning 请求体字节数上限，正整数。 |
| `warning.rate_limit_window_seconds` | 共享 warning 上报限流窗口的正整数时长，单位秒。 |
| `warning.max_requests_per_window` | 全服务每个窗口允许的 warning 请求数，正整数。 |
| `map.port` | MCP、完整地图页面、地图数据、assets、App 字体和瓦片共用的正整数 TCP 端口，最大 65535。 |
| `map.public_origin` | 公开基础 URL，可包含部署路径。localhost/IP 规范化为 HTTP，域名规范化为 HTTPS，并移除尾斜杠；拒绝账号信息、wildcard 绑定地址、query、fragment 和不安全路径。 |
| `tls.cert_file` | 本机 HTTPS listener 使用的服务器证书链文件，默认 `config/key/fullchain.pem`；本机 HTTP 不读取。 |
| `tls.key_file` | 本机 HTTPS listener 使用的匹配私钥文件，默认 `config/key/privkey.pem`；HTTPS 证书或私钥配置错误会使启动失败。 |

绑定地址、本机端口、本机协议与公开 URL 相互独立，修改 `map.port` 不会自动修改公开地址。代理或隧道可以在外部使用 HTTPS 443，回源到本机 HTTP `23336`。

有部署路径时，该路径本身就是 MCP 入口；没有路径时使用 `/mcp`：

| `map.public_origin` | 客户端 MCP URL | 完整互动网页 |
| --- | --- | --- |
| `http://127.0.0.1:23336` | `http://127.0.0.1:23336/mcp` | `http://127.0.0.1:23336/session/<id>/interactive` |
| `https://maps.example.com` | `https://maps.example.com/mcp` | `https://maps.example.com/session/<id>/interactive` |
| `https://maps.example.com/geomcp` | `https://maps.example.com/geomcp` | `https://maps.example.com/geomcp/session/<id>/interactive` |

远程使用时，MCP 客户端和地图浏览器/App 沙箱都需要能访问公开地址。HTTPS 可由反向代理或外部管理的隧道提供，GeoDolly 不负责启动隧道。公开地址变化后，使用[相同环境](02-configuration.md#环境变量覆盖)重新构建并启动；后端启动时会核对 App 构建地址与当前配置。

如需收集完整网页诊断，可选地使用同一环境文件启动独立 warning listener：

```sh
node --env-file=deploy/geomcp.env dist/server/http/browser-warning-service-main.js
```

另将同源 `POST /browser-warnings` 转发到 warning 端口（仓库值为 `23446`）；主 listener 不处理此入口。下文最小 Caddy 示例未包含该可选路由。MCP App 的 warning 保留在浏览器中，不依赖该上报服务。

#### 域名与 HTTPS 服务器部署

以下示例在服务器使用 **Caddy** 提供公网 443 HTTPS，再回源到 GeoDolly 的本机 23336 HTTP；其他反向代理也可使用相同结构。

1. 将 `maps.example.com` 的 A/AAAA 记录指向服务器；仅在 IPv6 确实可用时发布 AAAA。确保公网 **80、443** 端口可达。按[快速开始](01-getting-started.md#安装依赖与准备配置)安装 Node/Python 与项目依赖，再[安装 Caddy](https://caddyserver.com/docs/install)。下文示例域名均替换为自己的域名。
2. 在服务器的 `deploy/geomcp.env` 中替换 web 覆盖行：

   ```dotenv
   GEOMCP_WEB_CONFIG_JSON={"http":{"listen_host":"127.0.0.1","listen_protocol":"http","map":{"port":23336,"public_origin":"https://maps.example.com"}}}
   ```

   `public_origin` 是 Host 与 App 使用的公开地址；`listen_protocol=http` 显式指定内部 HTTP 回源。最终合并配置中若未设置 `listen_protocol`，会沿用公开域名的 HTTPS 协议并要求本机证书。同机 Caddy 可以访问回环监听；代理位于其他容器或机器时，需要使用其能够访问的绑定地址与上游地址。
3. 在仓库根目录使用同一文件构建并启动后端：

   ```sh
   npm run build
   node --env-file=deploy/geomcp.env node_modules/vite/bin/vite.js build
   node --env-file=deploy/geomcp.env node_modules/vite/bin/vite.js build --config vite.launcher.config.ts
   node --env-file=deploy/geomcp.env dist/index.js
   ```

4. 在 `/etc/caddy/Caddyfile` 中添加以下站点块，保留已有站点：

   ```caddyfile
   maps.example.com {
       reverse_proxy 127.0.0.1:23336
   }
   ```

   使用官方 Linux systemd 安装包时，在另一终端校验并启动/重载：

   ```sh
   sudo caddy validate --config /etc/caddy/Caddyfile
   sudo systemctl enable --now caddy
   sudo systemctl reload caddy
   ```

   DNS 和证书验证入口可达时，Caddy 会自动申请和续期域名证书；HTTP 回源保留公开 `Host`，SSE 响应按流转发。参见[自动 HTTPS](https://caddyserver.com/docs/quick-starts/https)、[代理行为](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)与[服务运行](https://caddyserver.com/docs/running)。
5. 按下节让后端常驻，再[安装 Host 连接](01-getting-started.md#在-mcp-host-中安装)，填写 `https://maps.example.com/mcp`。生成地图，检查内嵌 App 和完整互动网页链接均可访问。

代理应转发**整个公开站点**，包括 MCP、`/session/...`、`/basemap/...`、`/front/fonts/...`、`/assets/...`；只转发 `/mcp` 会导致地图无法加载。保留 `Host`、`Mcp-Session-Id`、`MCP-Protocol-Version` 和流式响应；代理与 Host 超时需容纳工具执行和排队时间，不缓存 MCP 与 Session mapdata 响应。使用 `/geomcp` 等部署前缀时，回源应保留该前缀，不要剥离；入口规则见上表。

##### 保持后端常驻运行

Linux systemd 示例假定已有服务账号 `geomcp`，仓库及已安装依赖位于 `/opt/geomcp`，Node 22.22.2 位于 `/usr/bin/node`。按实际账号和路径替换；`command -v node` 可查看当前 Node 路径。服务账号需能访问 Python 环境，并对项目运行时目录具有写权限。

创建 `/etc/systemd/system/geomcp.service`：

```ini
[Unit]
Description=GeoDolly MCP and map backend
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=geomcp
WorkingDirectory=/opt/geomcp
ExecStart=/usr/bin/node --env-file=/opt/geomcp/deploy/geomcp.env /opt/geomcp/dist/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

先停止前台 Node 进程以释放监听端口，再执行：

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now geomcp
sudo systemctl status geomcp --no-pager
sudo journalctl -u geomcp -n 50 --no-pager
```

服务读取与浏览器构建相同的 `geomcp.env`，不会自动构建。构建期配置变化后，在仓库根目录重做两次 Vite 构建，再执行 `sudo systemctl restart geomcp`。Caddy 保持独立服务。本地隧道需要长期运行时，也应按 cloudflared 的[服务说明](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/as-a-service/)保持其运行。

#### Node 直接提供 HTTPS

也可以由 Node 自行终止 TLS。准备服务账号可读的域名证书链和匹配私钥。例如直接开放 HTTPS 23336 端口时，在 `deploy/geomcp.env` 中设置：

```dotenv
GEOMCP_WEB_CONFIG_JSON={"http":{"listen_host":"0.0.0.0","listen_protocol":"https","map":{"port":23336,"public_origin":"https://maps.example.com:23336"},"tls":{"cert_file":"/absolute/path/to/fullchain.pem","key_file":"/absolute/path/to/privkey.pem"}}}
```

按上文使用同一文件构建两个浏览器产物并启动。DNS 指向服务器、放行 23336，在 Host 安装 `https://maps.example.com:23336/mcp`。证书必须覆盖该域名并受 Host/浏览器信任，自签证书不能作为通用远程 Host 方案。此方式需自行管理证书申请、续期及更换证书后的 Node 重启；使用 Caddy 的方案由 Caddy 管理证书。没有额外端口转发时，公开端口与监听端口需一致。

### tool_execution

`location_search`、`tool_a`、`tool_b` 共用有界 worker 和队列，每次调用独立计时；排队时间与执行时间分开。

| 字段 | 用途与调整 |
| --- | --- |
| `max_workers` | 同时执行的工具调用数，正整数；调大也会增加并发上游请求和后端负载。 |
| `max_queue_length` | 等待 worker 的请求数，非负整数；设为 `0` 时，worker 全忙就立即返回 busy。 |
| `timeout_seconds` | 取得 worker 后单次调用的正数总预算，单位秒，覆盖 Python 处理、TypeScript 数据整理、文件核验和发布；`app.yaml` 中单次请求超时不会延长它。 |

worker 与队列都满时返回结构化 busy 错误。取消或超时会停止对应工作及后续发布。浏览器地图初始化和 App 截图发生在后端结果返回以后，使用独立的 [`browser_map.ready_timeout_seconds`](03-app-yaml.md#browser_map) 预算；客户端自身的超时也独立计算。

### session

地图数据与新的瓦片请求共享有效期。过期检查周期性执行；已过期 Session 返回 HTTP 410，重新加载网页会显示“已过期”。已加载地图不会自动关闭，但过期后拒绝新请求。落盘数据保留；截图由 App 交付，不在后端归档。

| 字段 | 用途与调整 |
| --- | --- |
| `ttl_seconds` | 活跃地图的正数有效期，单位秒；`86400` 为 24 小时。 |
| `expiry_check_interval_seconds` | 过期检查的正数间隔，单位秒；`1800` 允许约 30 分钟生效延迟。 |
| `flush_interval_seconds` | 保存 Session 索引的正数间隔，单位秒；调小会更频繁保存。 |
| `max_timer_delay_ms` | Node 单次 timer delay 的正整数上限，单位毫秒；应保持在运行时支持范围内，更长的检查间隔会在每次计时中封顶。 |

访问、刷新和后端重启不续期；成功重新生成同一搜索/候选对应的地图才替换记录并重置有效期。重新打开过期地图不会延期，当前没有续期入口。新配置不会追溯延长已保存的地图记录。闲置 MCP 协议会话复用这些计时配置，但按各自活动独立计算，不与地图过期状态混用。

### snapshot

这些值由后端校验，并在构建期冻结进 MCP App；修改后使用 `deploy/geomcp.env` 重做两次浏览器构建并重启。

| 字段 | 用途与调整 |
| --- | --- |
| `max_wrapper_physical_pixels` | 原始 AI 地图捕获的正整数像素上限，包含 MapSurface 与参考栏。捕获固定 `dpr=1`、`scale=1`，原图超限会在编码前失败；宿主实际屏幕 DPR 独立。 |
| `max_base64_bytes` | 最终 Base64 `image.data` 必须严格小于此正整数字节数，不含 Data URL 前缀。随附值为 2000000 字节，这是应用预算，不是二进制 WebP 大小或宿主协议上限。 |
| `max_encode_retries` | 首次编码后的非负整数重试次数，由降质量与缩图共享，随附值为 3；之后最多还有一次小图兜底。 |

App 只捕获一次，合成白底后输出不透明、静态、有损 WebP。为满足字节预算，会先降低质量，再对已捕获图片等比缩图，保留完整构图和地理视野。质量边界与兜底尺寸属于浏览器内置值，不是 YAML 字段；最终兜底最长边为 640px，小原图不放大。仍失败时返回 warning 并保留可用地图，编码重试不延长 App 作业超时。

[← 用户指南](00-index.md) · [app.yaml](03-app-yaml.md) · [Basemap & Filter](05-tiles-and-filters.md)
