doc_content = '''# GeoMCP 技术规范文档 v2.0

> **版本**: 2.0  
> **更新日期**: 2026-03-30  
> **状态**: 完整规范

---

## 目录

1. [项目概述](#1-项目概述)
2. [系统架构](#2-系统架构)
3. [核心数据流](#3-核心数据流)
4. [Python 模块规范](#4-python-模块规范)
5. [TypeScript 模块规范](#5-typescript-模块规范)
6. [配置文件规范](#6-配置文件规范)
7. [MCP 接口定义](#7-mcp-接口定义)
8. [错误处理](#8-错误处理)
9. [性能优化策略](#9-性能优化策略)
10. [部署与依赖](#10-部署与依赖)
11. [附录](#11-附录)

---

## 1. 项目概述


### 1.1 项目定位

GeoMCP 是一个基于 MCP (Model Context Protocol) 的地理信息分析工具集，为 AI 助手提供城市规划和地理分析能力。

### 1.2 核心设计原则

| 原则 | 说明 |
|------|------|
| **语言分工明确** | Python 负责数据处理，TypeScript 负责渲染 |
| **配置驱动** | 过滤规则、专家知识、样式均通过配置文件管理 |
| **早期退出** | 大面积区域直接返回底图预览，避免无效计算 |
| **双层过滤** | AI 数据和渲染数据分别过滤，各取所需 |

### 1.3 技术栈
┌─────────────────────────────────────────────────────────────┐
│                       技术栈分层                            │
├─────────────────────────────────────────────────────────────┤
│  MCP Server 入口    │  TypeScript + @modelcontextprotocol  │
├─────────────────────────────────────────────────────────────┤
│  TS Bridge 校验层    │  Zod (bridge 输入输出运行时校验)     │
├─────────────────────────────────────────────────────────────┤
│  数据处理层         │  Python 3.11+                        │
│                     │  ├─ httpx (异步 HTTP)                │
│                     │  ├─ Shapely (几何处理)               │
│                     │  ├─ Pillow (图片拼接)                │
│                     │  ├─ PyYAML (配置解析)                │
│                     │  └─ Pydantic (bridge 输入输出校验)   │
├─────────────────────────────────────────────────────────────┤
│  渲染层             │  TypeScript + Node.js                │
│                     │  ├─ leaflet (地图渲染)               │
│                     │  ├─ canvas (图形绑定)                │
│                     │  └─ jsdom (DOM 模拟)                 │
├─────────────────────────────────────────────────────────────┤
│  配置文件           │  YAML + CSS                          │
└────────────────────────────────────────────────────────────
---

## 2. 系统架构

### 2.1 目录结构
geomcp/
├── src/                          # TypeScript 源码
│   ├── index.ts                  # MCP Server 入口
│   ├── tools/                    # Tool 定义
│   │   ├── tool-a.ts             # Tool A: 道路/交通分析
│   │   └── tool-b.ts             # Tool B: 区域/设施分析
│   ├── renderer/                 # 渲染模块
│   │   └── leaflet-renderer.ts   # Leaflet 渲染器
│   └── utils/                    # 工具函数
│       ├── bridge-models.ts      # TS bridge 协议模型与 Zod schema
│       └── python-bridge.ts      # Python 调用桥接
│
├── python/                       # Python 源码
│   ├── main.py                   # Python 入口 (CLI)
│   ├── core/                     # 核心模块
│   │   ├── init.py
│   │   ├── nominatim.py          # Nominatim 搜索
│   │   ├── geometry.py           # 几何处理 (Shapely)
│   │   ├── area_check.py         # 面积检查
│   │   ├── overpass.py           # Overpass 查询
│   │   ├── filter_engine.py      # 数据过滤引擎
│   │   ├── tile_manager.py       # 瓦片下载拼接
│   │   └── expert_matcher.py     # 专家匹配
│   └── utils/                    # 工具函数
│       ├── config_loader.py      # 配置加载器
│       └── coord_utils.py        # 坐标工具
│
├── config/                       # 配置文件
│   ├── filters.yaml              # 过滤规则
│   ├── experts.yaml              # 专家字典
│   ├── tiles.yaml                # 瓦片源配置
│   └── styles.css                # 渲染样式
│
├── package.json                  # Node.js 依赖
├── tsconfig.json                 # TypeScript 配置
├── requirements.txt              # Python 依赖
└── README.md

### 2.2 架构图
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AI Assistant                                   │
└─────────────────────────────────┬───────────────────────────────────────────┘
│ MCP Protocol
▼
┌────────────────────────────────────────────────────────────────────────────┐
│                         MCP Server (TypeScript)                            │
│                              src/index.ts                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         Tool Handlers                               │   │
│  │              tool-a.ts                    tool-b.ts                 │   │
│  └──────────────────────────────┬──────────────────────────────────────┘   │
│                                 │                                          │
│  ┌──────────────────────────────▼──────────────────────────────────────┐   │
│  │                      python-bridge.ts                               │   │
│  │               child_process.spawn 调用 nominatim.py                 │   │
│  └──────────────────────────────┬──────────────────────────────────────┘   │
│                                 │stdin/stdout (JSON)                       │
│                                 ▼                                          │
│                       return给src/index.ts                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  返回给 AI 的候选列表:                                               │   │
│  │                                                                     │   │
│  │  {                                                                  │   │
│  │    "status": "needs_confirmation",                                  │   │
│  │    "session_id": "abc123",                                          │   │
│  │    "query": "Chicago O'Hare",                                       │   │
│  │    "candidates": [                                                  │   │
│  │      { "index": 1, "osm_type": "relation",                          │   │
│  │        "name": "O'Hare International Airport",                      │   │
│  │        "display_name": "Chicago O'Hare International Airport...",   │   │
│  │        "lat": 41.9786, "lon": -87.9048,                             │   │
│  │        "category": "aeroway", "type": "aerodrome",                  │   │
│  │        "importance": 0.82,                                          │   │
│  │        "address": {"city": "Chicago", "country_code": "us"},        │   │
│  │        "boundingbox": [41.96, 41.99, -87.93, -87.89],               │   │
│  │        "geojson": { ... } },                                        │   │
│  │      { "index": 2, "osm_type": "way",                               │   │
│  │        "name": "Terminal 1",                                        │   │
│  │        "display_name": "O'Hare Terminal 1...",                      │   │
│  │        "lat": 41.9791, "lon": -87.9042,                             │   │
│  │        "category": "building", "type": "terminal",                  │   │
│  │        "importance": 0.45,                                          │   │
│  │        "address": {"city": "Chicago", "country_code": "us"},        │   │
│  │        "boundingbox": [41.97, 41.98, -87.91, -87.90],               │   │
│  │        "geojson": null }                                            │   │
│  │    ],                                                               │   │
│  │    "instruction": "Call tool_a or tool_b with JSON containing       │   │
│  │                    session_id, selected_indices, and optional       │   │
│  │                    ai_attention_token and basemap."                 │   │
│  │  }                                                                  │   │
│  └──────────────────────────────┬──────────────────────────────────────┘   │
│     AI 调用 tool_a / tool_b:                                               │
│     {"session_id":"abc123","selected_indices":[1],"basemap":"osm"}         │
│                                 │                                          │
│                                 ▼                                          │
│     TypeScript 命中 session cache，补回 selected_candidate 后再发 Python    │
│                                 │                                          │
└─────────────────────────────────┼──────────────────────────────────────────┘
                                  │ stdin/stdout (JSON)
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Python 数据处理层                                    │
│                            python/main.py                                   │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                geometry.py → area_check.py → overpass.py             │   │
│  │                     │              │              │                  │   │
│  │                     ▼              ▼              ▼                  │   │
│  │                  几何处理       面积检查      Overpass查询            │   │
│  │                  (Shapely)     (早期退出)     (poly优化)              │   │
│  └─────────────────────────────────┬────────────────────────────────────┘   │
│                                    ▼                                        │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  filter_engine.py          expert_matcher.py         tile_manager.py │   │
│  │       │                          │                         │         │   │
│  │       ▼                          ▼                         ▼         │   │
│  │   双层过滤                  专家知识匹配              瓦片下载拼接     │   │
│  │  (AI/Leaflet)              (YAML驱动)              (Pillow合成)      │   │
│  └─────────────────────────────────┬────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│              输出 JSON: { base_image_b64, geojson_for_leaflet, ai_data }    │
└─────────────────────────────────────┬───────────────────────────────────────┘
│ stdout JSON
▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       TypeScript 渲染层                                     │
│                     src/renderer/leaflet-renderer.ts                        │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  1. 接收 Python 输出                                                  │   │
│  │  2. 加载底图图片 (base_image_b64)                                     │   │
│  │  3. 叠加 GeoJSON 数据 (Leaflet + jsdom/canvas)                        │   │
│  │  4. 应用 CSS 样式 (styles.css)                                        │   │
│  │  5. 输出最终图片 (base64)                                             │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────┬───────────────────────────────────────┘
│
▼
返回 MCP Response
---

## 3. 核心数据流

### 3.1 完整流程 (面积 ≤ 100 km²)
┌─────────────────────────────────────────────────────────────────────────────┐
│                           完整数据处理流程                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ① MCP 请求                                                                 │
│     { tool: "tool_a", query: "Chicago O'Hare", basemap: "satellite" }       │
│                              │                                              │
│                              ▼                                              │
│  ② TypeScript 入口 (index.ts)                                               │
│     解析参数，调用 python_bridge                                             │
│                              │                                              │
│                              ▼                                              │
│  ③ Python 处理 (nominatim.py)                                               │
│     ┌────────────────────────────────────────────────────────────────┐      │ 
│     │  • 搜索 "Chicago O'Hare"                                       │      │
│     │  • 获取 polygon_geojson                                        │      │
│     └────────────────────────────────────────────────────────────────┘      │
│                              │                                              │
│                              ▼                                              │
│  ② return检索信息和polygon_geojson信息 TypeScript (index.ts)                 │
│     ┌────────────────────────────────────────────────────────────────┐      │ 
│     │  • 暂存带 geojson 的 raw SearchResponse                          │      │
│     │  • 分离出检索信息给 AI 确认                                      │      │
│     └────────────────────────────────────────────────────────────────┘      │     
│     AI 调用 tool_a / tool_b 后，TS 用 session_id + selected_indices         │
│     命中缓存并组装 PythonToolQuery，再调用 python_bridge                     │
│                              │                                              │
│                              ▼                                              │
│  ③ Python 处理 (main.py)                                                    │
│     ┌────────────────────────────────────────────────────────────────┐      │
│     │                                                                │      │
│     │                                                                │      │
│     │  [geometry.py] (Shapely)                                       │      │
│     │  • 解析 GeoJSON → Shapely geometry                             │      │
│     │  • 计算 bounds, centroid                                       │      │
│     │  • 判断 is_linear (线性/面状)                                   │     │
│     │  • 确定 orientation (横版/竖版/方形)                            │     │
│     │  • 生成 poly 字符串 (用于 Overpass)                             │     │
│     │           │                                                    │     │
│     │           ▼                                                    │     │
│     │  [area_check.py]                                               │     │
│     │  • 计算面积 (km²)                                              │     │
│     │  • 判断是否超过 100 km² 上限                                    │     │
│     │  • 超限 → 快速路径 (见 3.2)                                     │     │
│     │           │ (未超限)                                           │     │
│     │           ▼                                                    │     │
│     │  [overpass.py]                                                 │     │
│     │  • 构建查询 (使用 poly 而非 bbox)                               │     │
│     │  • 请求 Overpass API                                           │     │
│     │  • 获取 elements                                               │     │
│     │           │                                                    │     │
│     │           ▼                                                    │     │
│     │  [expert_matcher.py]                                           │     │
│     │  • 根据 Nominatim 返回的 class/type 匹配专家                    │     │
│     │  • 加载对应的 expert hints                                     │     │
│     │  • 获取 ai_focus_tags 和 leaflet_extra_tags                    │     │
│     │           │                                                    │     │
│     │           ▼                                                    │     │
│     │  [filter_engine.py]                                            │     │
│     │  • 第一步: 通用清洗 (filters.yaml 去废 Tag)                     │     │
│     │  • 第二步: 双层过滤                                             │     │
│     │    ├─ for_ai: 参考 expert.ai_focus_tags                        │     │
│     │    └─ for_leaflet: 参考 expert.leaflet_extra_tags              │     │
│     │           │                                                    │     │
│     │           ▼                                                    │     │
│     │  [tile_manager.py]                                             │     │
│     │  • 根据 bounds 计算需要的瓦片                                   │     │
│     │  • 下载瓦片 (OSM 或 卫星，由 basemap 参数决定)                   │     │
│     │  • 拼接成完整底图 (Pillow)                                      │     │
│     │  • 输出 base64                                                 │     │
│     │                                                                │     │
│     └────────────────────────────────────────────────────────────────┘     │
│                              │                                              │
│                              ▼                                              │
│  ④ Python 输出 JSON (stdout)                                                │
│     {                                                                       │
│       "base_image_b64": "iVBORw0KGgo...",      // 拼接好的底图              │
│       "bounds": [minLon, minLat, maxLon, maxLat],                           │
│       "geojson_for_leaflet": { ... },          // 需要叠加渲染的数据         │
│       "ai_data": { ... },                      // 给 AI 的数据              │
│       "expert_hints": [ ... ],                 // 专家提示                  │
│       "canvas_size": [1536, 1024],             // 画布尺寸                  │
│       "is_preview_only": false                                              │
│     }                                                                       │
│                              │                                              │
│                              ▼                                              │
│  ⑤ TypeScript 渲染 (leaflet-renderer.ts)                                    │
│     • 创建 Leaflet map (headless)                                           │
│     • 加载底图为 ImageOverlay                                               │
│     • 叠加 GeoJSON 图层                                                     │
│     • 应用 styles.css 样式                                                  │
│     • 导出最终图片                                                          │
│                              │                                              │
│                              ▼                                              │
│  ⑥ 返回 MCP Response                                                        │
│     {                                                                       │
│       "image": "data:image/png;base64,...",                                 │
│       "data": { ... },                                                      │
│       "metadata": { ... }                                                   │
│     }                                                                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
### 3.2 快速路径 (面积 > 100 km²)
┌─────────────────────────────────────────────────────────────────────────────┐
│                      快速路径 (面积超限早期退出)                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  area_check.py 检测到面积 > 100 km²                                          │
│                              │                                              │
│                              ▼                                              │
│  ┌───────────────────────────────────────────────────────────────────┐      │
│  │                     跳过以下步骤                                   │      │
│  │  ❌ Overpass 查询                                                 │      │
│  │  ❌ 专家匹配                                                      │      │
│  │  ❌ 数据过滤                                                      │      │
│  │  ❌ Leaflet 叠加渲染                                              │      │
│  └───────────────────────────────────────────────────────────────────┘      │
│                              │                                              │
│                              ▼                                              │
│  [tile_manager.py]                                                          │
│  • 仅下载瓦片并拼接                                                          │
│  • 直接返回底图                                                              │
│                              │                                              │
│                              ▼                                              │
│  Python 输出 JSON:                                                          │
│  {                                                                          │
│    "base_image_b64": "...",                                                 │
│    "bounds": [...],                                                         │
│    "geojson_for_leaflet": null,      // ❌ 无叠加数据                       │
│    "ai_data": null,                  // ❌ 无 AI 数据                       │
│    "expert_hints": null,                                                    │
│    "is_preview_only": true,          // ⭐ 标记为仅预览                     │
│    "warning": "区域过大 (156.3 km²)，仅提供底图预览。请搜索更具体的地点。"     │
│  }                                                                          │
│                              │                                              │
│                              ▼                                              │
│  TypeScript 渲染层                                                          │
│  • 检测 is_preview_only = true                                              │
│  • 直接返回底图，不做 Leaflet 处理                                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
### 3.3 双层过滤详解
┌─────────────────────────────────────────────────────────────────────────────┐
│                            双层过滤逻辑                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                      Overpass 原始 elements                                 │
│                              │                                              │
│                              ▼                                              │
│  ┌────────────────────────────────────────────────────────────────────┐     │
│  │                   第一步: 通用清洗                                  │     │
│  │                  (参考 filters.yaml)                               │     │
│  │                                                                    │     │
│  │  移除:                                                             │     │
│  │  • note, source, source:* (元数据)                                 │     │
│  │  • created_by, tiger:* (编辑器/导入信息)                           │     │
│  │  • fixme, todo (待修复标记)                                        │     │
│  │  • 无实际 tags 的空元素                                            │     │
│  │  • type=multipolygon 的 relation (保留 members)                    │     │
│  └────────────────────────────────────────────────────────────────────┘     │
│                              │                                              │
│                      cleaned_elements                                       │
│                              │                                              │
│              ┌───────────────┴───────────────┐                              │
│              ▼                               ▼                              │
│  ┌─────────────────────────┐     ┌─────────────────────────┐                │
│  │      for_ai 过滤        │     │    for_leaflet 过滤     │                │
│  ├─────────────────────────┤     ├─────────────────────────┤               │
│  │ 参考:                   │     │ 参考:                   │               │
│  │ expert.ai_focus_tags    │     │ expert.leaflet_extra_   │               │
│  │                         │     │         tags            │               │
│  │ 优先保留:               │     │                         │               │
│  │ • 专家关注的 tag        │     │ 额外渲染:               │               │
│  │ • 重要设施              │     │ • OSM 不渲染但重要的    │               │
│  │ • 路网骨架              │     │   元素 (道岔/信号灯)    │               │
│  │                         │     │ • 专家指定的高亮对象    │               │
│  │ 精简:                   │     │                         │               │
│  │ • 去除冗余属性          │     │ 附加:                   │               │
│  │ • 限制数量              │     │ • CSS class 名称        │               │
│  │                         │     │ • 样式 ID               │               │
│  └─────────────────────────┘     └─────────────────────────┘               │
│              │                               │                              │
│              ▼                               ▼                              │
│       ai_data (JSON)              geojson_for_leaflet                       │
│       给 AI 分析用                   给 Leaflet 渲染用                        │
│                                                                             │
└───────────────────────────────────────────────────
---

## 4. Python 模块规范

### 4.1 入口模块 (main.py)

`main.py` 作为 Python bridge 入口，允许使用 Pydantic 对 stdin 输入 JSON 和 stdout 输出 JSON 的结构做校验、规范化和错误整理；该用途仅限协议边界层。

Pydantic 使用约束：

- 允许用于 `main.py` 的请求解析、响应序列化、错误结构校验
- 允许用于 `python/utils/` 下与 bridge 协议直接相关的模型定义
- 默认采用严格校验思路，避免 `"123"` 自动转成 `123` 这类隐式类型转换影响协议语义
- 不要求在 `geometry.py`、`overpass.py`、`filter_engine.py`、`tile_manager.py` 等核心处理模块中全面替换标准 dataclass 或普通类型
- Python 与 TypeScript 之间通信方式仍固定为 stdin/stdout JSON，不因引入 Pydantic 改变协议边界
- 如果某个内部模块只做中间数据传递、且不直接面向 bridge 输入输出，优先继续使用标准 dataclass 或普通类型

```python
#!/usr/bin/env python3
"""
GeoMCP Python 数据处理入口
通过 stdin 接收 JSON 请求，stdout 输出 JSON 结果
"""
    """
    主处理流程
    """
    # 加载配置
    
    # Step 0: Nominatim 搜索
    
    # Step 2: 几何处理 (Shapely)
    
    # Step 3: 面积检查
    
    # Step 4: 确定画布尺寸
    
    # Step 5: 瓦片管理器
        # ════════════════════════════════════════════════════
        # 🚀 快速路径: 只下载瓦片，跳过数据处理
        # ════════════════════════════════════════════════════
    
    # ════════════════════════════════════════════════════════
    # 📊 完整路径: Overpass + 数据处理
    # ════════════════════════════════════════════════════════
    
    # Step 6: 专家匹配

    # Step 7: Overpass 查询

    # Step 8: 数据过滤

    # 第一步: 通用清洗
    
    # 第二步: 双层过滤 (都参考专家配置)
      #  参考专家的 leaflet_extra_tags
    
    # Step 9: 下载并拼接瓦片
```

### 4.2 Nominatim 模块
```python
```
### 4.3 几何处理模块 (geometry.py)
```python
"""
几何处理模块 (Shapely)
"""
# 画布尺寸配置
# 纵横比阈值
# 线性几何 buffer 距离 (米)
LINEAR_BUFFER_METERS = 500


@dataclass
class GeometryResult:
    """几何处理结果"""
    geometry: Any                 # Shapely geometry
    bounds: tuple[float, float, float, float]  # (minLon, minLat, maxLon, maxLat)
    centroid: tuple[float, float]  # (lon, lat)
    is_linear: bool               # True = 线状/点状，需要 buffer
    orientation: Literal["landscape", "portrait", "square"]
    aspect_ratio: float           # width / height
    poly_string: Optional[str]    # Overpass poly 查询字符串
    buffered_bounds: Optional[tuple[float, float, float, float]]  # buffer 后的 bounds


class GeometryProcessor:
    """几何处理器"""
        """
        处理 Nominatim 返回的几何数据
        """
        """
        确定画布尺寸
        
        Args:
            orientation: "landscape" | "portrait" | "square"
            aspect_ratio: 实际纵横比
        
        Returns:
            (width, height)
        """
        return CANVAS_SIZES.get(orientation, CANVAS_SIZES["square"])
```
### 4.4 面积检查模块 (area_check.py)
```python
"""
面积检查 - 简单的上限判断
"""
    """
    检查区域面积是否超过上限
    
    Args:
        bounds: (minLon, minLat, maxLon, maxLat)
    
    Returns:
        AreaCheckResult
    """
```
### 4.5 Overpass 查询模块 (overpass.py)
```python
"""
Overpass API 查询模块
"""
        """
        执行 Overpass 查询
        
        Args:
            geometry: 几何处理结果
            tool_type: 工具类型
            use_poly: 是否使用 poly 查询 (用于线性几何)
        
        Returns:
            OverpassResult
        """
        """构建 bbox 查询"""
        
        """构建 poly 查询"""
```
### 4.6 专家匹配模块 (expert_matcher.py)
```python
"""
专家知识匹配模块
"""
    """专家匹配器"""
        """
        Args:
            config: experts.yaml 的内容
        """
        """
        根据 Nominatim 返回的 class/type 匹配专家
        
        Args:
            osm_class: e.g., "aeroway", "railway"
            osm_type: e.g., "aerodrome", "station"
            tags: extratags
        
        Returns:
            Expert or None
        """
```
### 4.7 数据过滤模块 (filter_engine.py)
```python
"""
数据过滤引擎
"""
        第一步: 通用清洗
        
        - 移除配置中指定的废 tags
        - 移除空元素
        """
        """
        第二步: 为 AI 过滤数据        

        """
        第三步: 为 Leaflet 过滤数据
        """
        # 专家指定的额外渲染 tags
            # 检查是否需要特殊渲染
            # 构建 GeoJSON Feature
        """
        将 OSM element 转换为 GeoJSON Feature
```
### 4.8 瓦片管理模块 (tile_manager.py)
```python
"""
瓦片下载与拼接模块
"""
class TileManager:
    """瓦片管理器"""
        """
        下载瓦片并拼接成底图
        
        Args:
            bounds: (minLon, minLat, maxLon, maxLat)
            canvas_size: (width, height)
            basemap: 底图类型
        
        Returns:
            base64 编码的图片
        """       
        # 获取瓦片源配置   
        # 计算合适的缩放级别        
        # 计算需要的瓦片范围
        # 并发下载瓦片
        # 拼接瓦片 
        # 裁剪到目标 bounds
        # 转换为 base64
        """计算合适的缩放级别"""
            # 计算该 zoom 级别下的瓦片范围
        """获取需要下载的瓦片列表"""
        """并发下载瓦片"""
        """拼接瓦片"""
        """裁剪图片到目标 bounds 和尺寸"""
        # 简化实现: 直接缩放到目标尺寸

```
## 5. TypeScript 模块规范
### 5.1 MCP Server 入口 (index.ts)
```typescript
/**
 * GeoMCP MCP Server 入口

// 创建 Server 实例
// 定义可用工具列表
// 处理工具调用
// 启动 Server
```
### 5.2 Python 桥接模块 (python-bridge.ts / bridge-models.ts)
```typescript
`python-bridge.ts` 负责 TypeScript 与 Python 之间的协议边界适配，`bridge-models.ts` 负责与 Python `models.py` 对齐的协议模型和 Zod schema。TypeScript 侧允许使用 Zod 对 MCP tool 入参、bridge envelope、Python 返回结果做运行时校验，但应保持最小化处理原则。

TypeScript bridge 使用约束：

- 允许在 `src/utils/python-bridge.ts` 及其直接关联的 bridge 类型模块中使用 Zod
- 允许对 `BridgeRequestType`、`BridgeResponseType`、`LocSearchQueryReqType`、`LocSearchReplyType`、`ToolInputReqType`、`PyToolReqType` 做运行时校验
- TypeScript 发送给 Python 时，必须把 MCP tool 输入包装为 `action + data`
- TypeScript 接收 Python 响应时，必须先按 `ok + data + error` envelope 解析，再还原为内部 `data`
- `location_search` 返回给 AI 时必须移除 `geojson`，除此之外不应额外改写 `SearchResponse` 语义
- `location_search` 返回后，TypeScript 必须按 `session_id` 暂存完整 `SearchResponseRaw`
- `tool_a` / `tool_b` 被调用时，TypeScript 必须先从缓存中命中原始候选，再组装 `selected_candidate` 后发给 Python
- Zod 的使用范围默认限于协议边界层；Leaflet 渲染实例、内部中间对象和非 bridge 普通处理逻辑不要求全面引入 Zod
```

#### Bridge 命名约定：
```typescript
- schema 常量统一使用 `Schema` 后缀，例如 `locSearchReplyRawSchema`
- type 别名统一使用 `Type` 后缀，例如 `LocSearchReplyRawType`
- schema 工厂函数统一使用 `SchemaFn` 后缀，例如 `bridgeRequestSchemaFn`
- bridge 协议层命名中不再使用 `Api` 字样，统一使用 `Bridge`
- `python` 在 bridge 命名中统一缩写为 `py`，例如 `pyToolReqSchema`
- `location_search` 这条链统一使用 `locSearch` 前缀
- `location_search` 的输入输出统一使用 `Query` / `Reply`
- `tool_a` / `tool_b` 的 MCP 输入统一使用 `Input`
- TypeScript 组装后发给 Python 的执行载荷统一使用 `Req`
- Python 回给 TypeScript 的工具执行结果统一使用 `Res`
- raw 版本统一把 `Raw` 放在主语之后，例如 `locSearchCandidateRawSchema`，不要`rawLocSearchCandidateSchema`
```

命名示例：

- `locSearchQuerySchema` / `LocSearchQueryType`
- `locSearchReplyRawSchema` / `LocSearchReplyRawType`
- `toolInputReqSchema` / `ToolInputReqType`
- `pyToolReqSchema` / `PyToolReqType`
- `toolResSchema`
- `bridgeRequestSchemaFn`
- `bridgeResponseSchemaFn`

Python 同步要求：

- Python `models.py` 后续补齐对应执行模型时，命名语义必须与 TypeScript bridge 对齐
- 若 Python 侧出于语言习惯不直接使用 `Schema` / `Type` 后缀，也必须保持同样的领域前缀与语义分层：`locSearch`、`tool input`、`py tool req`、`tool res`、`bridge request/response`
- 若后续需要调整 bridge 命名规则，应先更新本规范，再同步修改 TypeScript 与 Python 两端实现
### 5.3 Tool A 处理器 (tool-a.ts)
```typescript
/**
 * Tool A: 道路与交通网络分析
 */
  // 1. 调用 Python 处理数据
  // 2. 如果是预览模式，直接返回底图
  // 3. 使用 Leaflet 渲染叠加层
```
### 5.4 Tool B 处理器 (tool-b.ts)
```typescript
/**
 * Tool B: 区域设施分析
 */

  // 1. 调用 Python 处理数据
  // 2. 如果是预览模式，直接返回底图
  // 3. 使用 Leaflet 渲染叠加层
```
### 5.5 Leaflet 渲染器 (leaflet-renderer.ts)
```typescript
/**
 * Leaflet 渲染器
 * 接收 Python 输出的底图和 GeoJSON，叠加渲染后输出最终图片

// 加载 CSS 样式配置

/**
 * 解析 CSS 文件，提取样式规则
 */

      // 提取属性
/**
 * 根据 feature 的 css_classes 获取样式
 */

  // 默认样式

  // 应用 CSS class 样式 (后面的优先级更高)
/**
 * 使用 Leaflet + jsdom/canvas 渲染地图
 */
```
## 6. 配置文件规范
### 6.1 过滤规则 (filters.yaml)
```yaml
# config/filters.yaml
# 数据清洗配置

# 需要移除的 tags
remove_tags:
  # 元数据
  - note
  - source
  - description
  - fixme
  - todo
  - FIXME
  
  # 编辑器信息
  - created_by
  - converted_by
  
  # 时间戳
  - start_date
  - end_date
  - check_date
  - survey:date
  - source:date
  
  # 外部引用
  - wikidata
  - wikipedia
  - image
  - website
  - url
  - email
  - phone
  - fax

# 需要移除的 tag 前缀
remove_tag_prefixes:
  - "source:"
  - "tiger:"
  - "gnis:"
  - "ref:bag"
  - "ref:ruian"
  - "note:"
  - "is_in:"
  - "addr:country"
  - "addr:state"
  - "addr:province"
  - "KSJ2:"
  - "yh:"

# 低价值 tags (优先移除以减少数据量)
low_priority_tags:
  - bicycle
  - foot
  - horse
  - motor_vehicle
  - wheelchair
  - lit
  - smoothness
  - tracktype
  - incline
```
### 6.2 专家字典 (experts.yaml)
```yaml
# config/experts.yaml
# 专家知识配置

# 专家定义
experts:
  # ═══════════════════════════════════════════════════════════════
  # 铁路专家
  # ═══════════════════════════════════════════════════════════════
  railway:
    name: "铁路专家"
    hints:
      - "railway=rail 表示标准轨铁路，=subway 表示地铁"
      - "道岔 (switch) 是铁路的关键基础设施，允许列车变换轨道"
      - "信号机 (signal) 控制列车运行，注意 railway:signal:* 子标签"
      - "车站 (station) 和站台 (platform) 要区分"
      - "service=yard 表示编组场/调车场，=siding 表示侧线，=spur 表示支线"
      - "gauge 标签表示轨距，如 1435 (标准轨)、1067 (窄轨)"
    
    ai_focus_tags:
      - railway
      - station
      - halt
      - platform
      - switch
      - signal
      - crossing
      - bridge
      - tunnel
      - service
      - usage
      - gauge
    
    leaflet_extra_tags:
      # 道岔 - 红色标记
      - tag: "railway=switch"
        css_class: "expert-railway-switch"
      
      # 信号机 - 橙色标记
      - tag: "railway=signal"
        css_class: "expert-railway-signal"
      
      # 止冲挡 - 紫色标记
      - tag: "railway=buffer_stop"
        css_class: "expert-railway-buffer-stop"
      
      # 平交道 - 黄色标记
      - tag: "railway=level_crossing"
        css_class: "expert-railway-level-crossing"
      
      # 调车线 - 灰色虚线
      - tag: "service=yard"
        css_class: "expert-railway-yard"
      
      # 侧线 - 灰色虚线
      - tag: "service=siding"
        css_class: "expert-railway-siding"
      
      # 支线 - 灰色虚线
      - tag: "service=spur"
        css_class: "expert-railway-spur"

```
### 6.3 瓦片源配置 (tiles.yaml)
```yaml
# config/tiles.yaml
# 瓦片源配置

# 可用的底图类型
basemaps:
  osm:
    name: "OpenStreetMap"
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
    max_zoom: 19
    attribution: "© OpenStreetMap contributors"
    headers:
      User-Agent: "GeoMCP/2.0 (urban-planning-tool)"
  
  osm_carto:
    name: "OpenStreetMap Carto"
    url: "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png"
    max_zoom: 19
    attribution: "© OpenStreetMap contributors"
  
  satellite:
    name: "Esri World Imagery"
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
    max_zoom: 18
    attribution: "© Esri, Maxar, Earthstar Geographics"
  
  satellite_hybrid:
    name: "Esri Hybrid (带标注)"
    layers:
      - url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        max_zoom: 18
      - url: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
        max_zoom: 18
    attribution: "© Esri"
  
  topo:
    name: "OpenTopoMap"
    url: "https://tile.opentopomap.org/{z}/{x}/{y}.png"
    max_zoom: 17
    attribution: "© OpenTopoMap (CC-BY-SA)"

# 默认配置
defaults:
  tool_a: osm           # Tool A 默认使用 OSM
  tool_b: satellite     # Tool B 默认使用卫星图

# 下载设置
download:
  max_concurrent: 8     # 最大并发下载数
  timeout: 30           # 单个瓦片超时时间 (秒)
  retry: 3              # 重试次数
  max_tiles: 64         # 单次请求最大瓦片数
```
### 6.4 渲染样式 (styles.css)
```yaml
/* config/styles.css */
/* Leaflet 渲染样式定义 */
/* 
 * 命名规范: .expert-{domain}-{feature}
 * 
 * CSS 属性映射到 Leaflet PathOptions:
 *   stroke → color
 *   stroke-width → weight
 *   stroke-opacity → opacity
 *   fill → fillColor
 *   fill-opacity → fillOpacity
 *   stroke-dasharray → dashArray
```
## 7. MCP 接口定义
### 7.1 地点检索与确认阶段

该阶段为 `tool_a` / `tool_b` 的通用前置步骤，用于地点搜索、候选确认与工具路由。

#### 7.1.0 Python Bridge Envelope

TypeScript 通过 `stdin` 传给 Python 的请求，当前统一使用 `action + data` 结构。

请求示例：

```json
{
  "action": "search_location",
  "data": {
    "queries": [
      {
        "query": "Chicago O'Hare",
        "country_codes": ["us"]
      }
    ]
  }
}
```

约束说明：

- `action` 用于 Python `main.py` 路由分发
- `data` 承载具体业务请求结构；在地点检索阶段其内容即 `SearchRequest`
- 不使用 `ok + data` 作为请求结构；`ok` 仅用于 Python 返回给 TypeScript 的响应
- TypeScript 发送请求时不传 `error` 字段；若 TypeScript 本地构造请求前已失败，应直接在 TypeScript 侧报错，不再发送桥接请求

#### 7.1.1 Search Request

```json
{
  "queries": [
    {
      "query": "Chicago O'Hare",
      "country_codes": ["us"]
    }
  ]
}
```

字段约束：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `queries` | `list[LocationQuery]` | 是 | 查询列表，当前仅支持 1 个元素 |

`LocationQuery`:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `query` | `str` | 是 | 地点名称或检索文本 |
| `country_codes` | `list[str] \| null` | 否 | ISO 3166-1 alpha-2 国家代码过滤 |

当前限制：

- `queries` 当前必须恰好 1 项
- `query` 不可为空字符串
- `country_codes` 可省略或传空列表

#### 7.1.1.1 Python Bridge Response Envelope

Python 返回给 TypeScript 的桥接响应统一保留外层状态包装。

成功示例：

```json
{
  "ok": true,
  "data": {
    "status": "needs_confirmation",
    "session_id": "abc123",
    "query": "Chicago O'Hare",
    "candidates": []
  },
  "error": null
}
```

失败示例：

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "INVALID_INPUT",
    "message": "query is required",
    "details": null
  }
}
```

当前约定：

- 失败响应暂时保留 `data: null`
- 错误对象不再额外包含 `error: true`
- `details` 可以为简单值、列表、字典或 `null`

#### 7.1.2 Search Response

`SearchResponse` 为 Python 传给 TypeScript 的内部响应结构。
TypeScript 在回传给 AI 时，必须屏蔽 `geojson` 字段；返回给 AI 的描述性字段必须使用英文。

成功示例：

```json
{
  "status": "needs_confirmation",
  "session_id": "abc123",
  "query": "Chicago O'Hare",
  "candidates": [
    {
      "index": 1,
      "osm_type": "relation",
      "name": "O'Hare International Airport",
      "display_name": "Chicago O'Hare International Airport, Chicago, Illinois, United States",
      "lat": 41.9786,
      "lon": -87.9048,
      "category": "aeroway",
      "type": "aerodrome",
      "importance": 0.82,
      "address": {
        "city": "Chicago",
        "state": "Illinois",
        "country": "United States",
        "country_code": "us"
      },
      "boundingbox": [41.96, 41.99, -87.93, -87.89],
      "geojson": { "type": "Polygon", "coordinates": [] }
    }
  ],
  "instruction": "Call tool_a or tool_b with JSON containing session_id, selected_indices, and optional ai_attention_token and basemap."
}
```

空结果示例：

```json
{
  "status": "no_match",
  "session_id": "abc123",
  "query": "unknown place",
  "candidates": [],
  "message": "No matching location was found."
}
```

顶层字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `status` | `"needs_confirmation" \| "no_match"` | 是 | 当前搜索状态 |
| `session_id` | `str` | 是 | 本次检索会话 ID，由系统生成 |
| `query` | `str` | 是 | 原始查询文本 |
| `candidates` | `list[Candidate]` | 是 | 候选列表；TS 回传给 AI 时需移除 `geojson` |
| `instruction` | `str \| null` | 否 | 给 AI 的英文回复格式提示 |
| `message` | `str \| null` | 否 | 英文说明文本，常用于空结果或提醒 |

`Candidate`:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `index` | `int` | 是 | 候选序号，供 AI 选择 |
| `osm_type` | `str \| null` | 否 | OSM 对象类型，如 `node` / `way` / `relation` |
| `name` | `str \| null` | 否 | 简短名称 |
| `display_name` | `str \| null` | 否 | 完整显示名称 |
| `lat` | `float \| null` | 否 | 纬度 |
| `lon` | `float \| null` | 否 | 经度 |
| `category` | `str \| null` | 否 | OSM 分类 |
| `type` | `str \| null` | 否 | OSM 子类型 |
| `importance` | `float \| null` | 否 | Nominatim 重要性分数 |
| `address` | `dict[str, str] \| null` | 否 | 地址对象 |
| `boundingbox` | `list[float] \| null` | 否 | 边界框，按上游顺序保留 |
| `geojson` | `dict \| null` | 否 | Python 内部保留的几何；TS 不得将其直接回传给 AI |

字段规则：

- `index` 必须唯一且从 1 开始递增
- `boundingbox` 必须尽量保留；若上游缺失可为 `null`
- `osm_type` 应保留给 AI，帮助理解候选是点、线还是关系对象
- Python 到 TypeScript 的内部响应可以保留 `geojson`
- TypeScript 返回给 AI 时必须移除 `geojson`
- 不向 AI 返回 `licence`、`place_id`、`osm_id`

#### 7.1.3 Tool Input (AI -> TypeScript)

该结构用于约束 AI 在调用 `tool_a` / `tool_b` 时传给 MCP 的轻量输入。
工具名本身已经决定路由，因此输入 `data` 内不再重复包含 `tool` 字段。

类型别名：

- `BasemapType = "osm" | "satellite"`

```json
{
  "session_id": "abc123",
  "selected_indices": [1],
  "ai_attention_token": "schools accessibility around transit",
  "basemap": "satellite"
}
```

字段定义：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `session_id` | `str` | 是 | 对应 Search Response 返回的会话 ID |
| `selected_indices` | `list[int]` | 是 | 选中的候选序号列表 |
| `ai_attention_token` | `str \| null` | 否 | AI 关注点文本，两个工具都允许传入 |
| `basemap` | `BasemapType \| null` | 否 | 底图类型，两个工具都允许传入 |

当前限制：

- `selected_indices` 当前仅支持 1 个元素
- `tool_b` 若收到 `ai_attention_token`，可用于分析
- `tool_a` 若收到 `ai_attention_token`，直接忽略且不报错
- `tool_b` 若收到 `basemap`，按传入值选择底图；未传时使用默认值
- `tool_a` 若收到 `basemap`，当前忽略且不报错

#### 7.1.4 Python Tool Query (TypeScript -> Python)

TypeScript 收到 `tool_a` / `tool_b` 调用后，必须先按 `session_id` 命中缓存的 `SearchResponseRaw`，
再根据 `selected_indices[0]` 找到对应候选，并组装成发给 Python 的执行请求。

```json
{
  "session_id": "abc123",
  "selected_candidate": {
    "index": 1,
    "osm_type": "relation",
    "name": "O'Hare International Airport",
    "display_name": "Chicago O'Hare International Airport, Chicago, Illinois, United States",
    "lat": 41.9786,
    "lon": -87.9048,
    "category": "aeroway",
    "type": "aerodrome",
    "importance": 0.82,
    "address": {
      "city": "Chicago",
      "state": "Illinois",
      "country": "United States",
      "country_code": "us"
    },
    "boundingbox": [41.96, 41.99, -87.93, -87.89],
    "geojson": { "type": "Polygon", "coordinates": [] }
  },
  "ai_attention_token": "schools accessibility around transit",
  "basemap": "satellite"
}
```

字段定义：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `session_id` | `str` | 是 | 对应搜索会话 ID |
| `selected_candidate` | `Candidate` | 是 | TypeScript 从缓存中 join 出的完整候选 |
| `ai_attention_token` | `str \| null` | 否 | AI 关注点文本 |
| `basemap` | `BasemapType \| null` | 否 | 底图类型 |

规则说明：

- `selected_candidate` 必须来自同一个 `session_id` 对应的缓存候选，不允许 AI 直接传入自构造对象
- TypeScript 命中不到 `session_id` 或候选 index 时，应在 TypeScript 侧直接报错，不继续调用 Python
- 当前阶段 `selected_indices` 虽仍保留为数组输入，但发给 Python 时必须收敛为单个 `selected_candidate`

### 7.2 Tool A 接口
#### MCP 输入格式
```typescript
{
  "session_id": "abc123",
  "selected_indices": [1],
  "ai_attention_token": "",
  "basemap": "osm"
}
// 注意这里的 ai_attention_token 在 Tool A 中会被忽略，
// 所以可以为空字符串，也可以不传
```
### 7.3 Tool B 接口
```typescript
{
  "session_id": "abc123",
  "selected_indices": [1],
  "ai_attention_token": "focus",
  "basemap": "osm"
}
// ai_attention_token 可以不填，会按启用默认的专家模式
// 这里的 focus 表示 AI 希望强调的分析关注点
```

#### TypeScript 到 Python 的执行输入

`tool_a` / `tool_b` 在进入 Python 前，必须统一转换为 `PythonToolQuery`：

```typescript
{
  "session_id": "abc123",
  "selected_candidate": { ...Candidate },
  "ai_attention_token": "focus",
  "basemap": "osm"
}
```
## 8. 错误处理
### 8.1 错误类型
```python
# python/core/errors.py
# 错误代码定义
ERROR_CODES = {
    "LOCATION_NOT_FOUND": "未找到指定地点",
    "NOMINATIM_TIMEOUT": "Nominatim 请求超时",
    "NOMINATIM_ERROR": "Nominatim 服务错误",
    "OVERPASS_TIMEOUT": "Overpass 请求超时",
    "OVERPASS_ERROR": "Overpass 服务错误",
    "OVERPASS_TOO_MANY_ELEMENTS": "数据量过大",
    "TILE_DOWNLOAD_FAILED": "瓦片下载失败",
    "INVALID_GEOMETRY": "无效的几何数据",
}
```
### 8.2 Python 错误响应格式
```python
# Python 错误输出格式
"error": {
    "code": "...",
    "message": "...",
    "details": ...
  }
```
### 8.3 TypeScript 错误处理
```typescript
// src/utils/error_handler.ts
```
## 9. 性能优化策略
### 9.1 优化措施
阶段	        优化措施	                        效果
早期退出	面积 > 100 km² 直接返回底图	      避免无效 Overpass 查询
几何优化	使用 poly 而非 bbox 查询	      减少无关数据 ~60%
并发下载	瓦片并发下载 (8 路)	              下载速度提升 ~5x
数据精简	双层过滤	                      减少传输数据量
缓存	    瓦片本地缓存                      (可选)重复请求加速
### 9.2 响应时间目标
场景	                目标时间
小区域 (< 1 km²)	    < 3 秒
中等区域 (1-10 km²)	    < 8 秒
大区域 (10-100 km²)	    < 15 秒
超大区域 (> 100 km²)	< 5 秒 (仅底图)
### 9.3 资源限制
```yaml
# 资源限制配置
limits:
  max_area_km2: 100            # 面积上限
  max_overpass_elements: 10000 # Overpass 元素上限
  max_tiles_per_request: 64    # 单次瓦片下载上限
  nominatim_timeout: 30        # Nominatim 超时 (秒)
  overpass_timeout: 60         # Overpass 超时 (秒)
  tile_download_timeout: 30    # 瓦片下载超时 (秒)
```
## 10. 部署与依赖
### 10.1 package.json
```json
{
  "name": "geomcp",
  "version": "2.0.0",
  "description": "Geographic MCP tools for urban planning",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "leaflet": "^1.9.4",
    "canvas": "^2.11.0",
    "jsdom": "^24.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/leaflet": "^1.9.0",
    "typescript": "^5.4.0",
    "tsx": "^4.7.0"
  }
}
```
### 10.2 requirements.txt (Python)
```shell
#### Python 依赖
httpx>=0.27.0
shapely>=2.0.0
Pillow>=10.0.0
PyYAML>=6.0.0
pydantic>=2.0.0
```
#### TS 依赖
TypeScript: @modelcontextprotocol/sdk, child_process, leaflet, canvas, jsdom, zod

### 10.3 tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```
### 10.4 MCP 配置 (Claude Desktop)
```json
{
  "mcpServers": {
    "geomcp": {
      "command": "node",
      "args": ["/path/to/geomcp/dist/index.js"],
      "env": {
        "PYTHON_PATH": "/usr/bin/python3"
      }
    }
  }
}
```
## 11. 附录
### 11.1 常用 OSM Tag 参考

类别	常用 Tag
道路	highway, lanes, surface, maxspeed, oneway
铁路	railway, gauge, electrified, service, usage
航空	aeroway, iata, icao, runway, taxiway
建筑	building, height, levels, roof:shape
设施	amenity, shop, leisure, tourism
土地	landuse, natural, water

### 11.2 坐标系统
```lua
所有坐标使用 WGS84 (EPSG:4326)

bounds 格式: [minLon, minLat, maxLon, maxLat]
          = [west, south, east, north]
          = [minX, minY, maxX, maxY]

Nominatim boundingbox: [minLat, maxLat, minLon, maxLon]
                      (需要转换!)

Overpass bbox: (south, west, north, east)
             = (minLat, minLon, maxLat, maxLon)

Leaflet bounds: [[minLat, minLon], [maxLat, maxLon]]
              = [[south, west], [north, east]]
```
### 11.3 CSS → Leaflet 样式映射
CSS 属性	       Leaflet PathOptions
stroke	            color
stroke-width	    weight
stroke-opacity	    opacity
fill	            fillColor
fill-opacity	    fillOpacity
stroke-dasharray	dashArray
--marker-radius	    radius (自定义)
