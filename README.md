# Nova 3D Map SDK

Nova 是面向公司物流业务的新一代 Web 3D 地图基础设施。项目以真实 KYE 地图数据为事实输入，基于 TypeScript、Three.js 与 WebGPU/WebGL2 构建可独立发布的模块化 SDK。

## 项目背景

现有 Kyemap JSAPI 同时承载 Mapbox、AMap 与业务适配逻辑，已经验证了 KYE Style、MVT、Raster、Glyph、Sprite 和动态业务 MVT/Geobuf 等数据入口。Nova 不直接复制旧运行时，而是在这些已验证事实之上建立可维护的 Three.js 3D 地图 SDK。

## 项目目标

建设模块化、可扩展、高性能的 Web 3D 地图 SDK，为物流站点、车辆、轨迹、设备、围栏、天气专题和自定义 3D 场景提供统一空间可视化基础能力。

## 核心能力

长期能力方向包括基础地图、动态 Tile、LOD、道路、水系、土地、行政区、建筑、名称、Layer、Marker、海量点、Cluster、围栏、点线面编辑、测量、业务 MVT/GeoJSON/Geobuf、3D 建筑、glTF 模型和空间专题。

当前仓库已包含最小动态 Polygon/Line Tile Runtime；文字、完整样式和业务图层仍不在 MVP 范围内。

## 技术栈

- TypeScript 7.0.2，严格类型检查与现代 ESM。
- pnpm 11.19.0 workspace 负责 Monorepo 依赖和任务编排。
- Vite 8.2.2 统一构建 SDK 与 Playground。
- Three.js 0.185.1，版本精确锁定。
- Three.js `WebGPURenderer`，默认 WebGPU，运行时自动回退到 WebGL2。
- 自定义 Shader、材质节点和后处理统一使用 TSL / Node Material。
- Three.js Inspector 作为 Playground 的唯一默认开发调试 GUI。

## 架构概览

```text
Application
    ↓
Nova Map3D SDK
    ├── Camera
    ├── Tile Runtime
    ├── Data Decode
    ├── Geometry
    ├── Label
    ├── Render
    ├── Interaction
    └── Resource Management
             ↓
          Three.js
             ↓
      WebGPU / WebGL2
```

SDK 与 Playground 保持单向依赖：Playground 通过 workspace 依赖 `@nova/map3d`，SDK 不引用 Playground、Inspector 或页面状态。详细边界见 [架构基线](./docs/architecture.md)。

## KYE 数据说明

会话 A 的 10 份研究资料已原样导入 `docs/research/`。当前确认的事实包括：

- 主地图数据为 gzip 压缩的 MVT v2，extent 4096，使用标准 Web Mercator XYZ。
- KYE Style 为 Mapbox Style v8，包含 9 个 source 和 51 个 layer。
- 已验证主 MVT、水系、行政区、Raster、Glyph、Sprite 与动态业务 MVT/Geobuf 入口。
- 已采样建筑包含数值型 `height`；`min_height` 尚未在样本中发现。
- KYE Raster 实测为 512×512 PNG，而现有配置声明 `tileSize: 256`，需要后续验证缩放和 DPR 行为。

研究索引与证据状态见 [Research Index](./docs/research/README.md)。未经验证的内容不得升级为正式项目事实。

## Monorepo 结构

```text
nova/
├── apps/playground/       # SDK 官方开发、调试与演示应用
├── packages/map3d/        # 可独立构建和发布的 Nova Map3D SDK
├── docs/                  # 架构、决策与研究事实
├── tasks/                 # 单任务实施规格
├── skills/                # AI research/implementation/debug/performance 流程
├── AGENTS.md              # 项目级 AI Coding 规则
├── PROJECT.md             # 当前有效项目状态
├── TASKS.md               # 任务总表
└── KNOWLEDGE.md           # 已验证知识
```

根命令通过 pnpm workspace filter 按依赖顺序执行各 package 的 Vite、TypeScript 和测试脚本。

## SDK 使用方式

```ts
import { Map3D } from '@nova/map3d'

const canvas = document.querySelector<HTMLCanvasElement>('#map')!
const map = new Map3D({
  canvas,
  source: {
    id: 'main',
    tiles: ['https://tiles.example/{z}/{x}/{y}.pbf'],
    minZoom: 0,
    maxZoom: 17,
  },
  layers: [
    {
      type: 'fill',
      id: 'landuse-neutral',
      sourceLayer: 'landuse',
      filters: [{ operator: '!=', property: 'class', value: 'grass' }],
      paint: { color: '#ECEDEB' },
    },
    {
      type: 'line',
      id: 'road-casing',
      sourceLayer: 'road',
      paint: { color: '#D4D7DA', width: 4 },
    },
    {
      type: 'line',
      id: 'road-fill',
      sourceLayer: 'road',
      paint: { color: '#FFFFFF', width: 2 },
    },
  ],
})

await map.initialize()
map.resize({
  width: canvas.clientWidth,
  height: canvas.clientHeight,
  pixelRatio: window.devicePixelRatio,
})
```

Map3D 会根据 ViewState 自动请求可见/预取 Tile，并在 WebGPU 不可用时回退到 WebGL2。

## Playground 使用方式

Playground 页面只提供全屏 Canvas 与 Three.js Inspector，不创建 HTML 侧边栏或自制调试面板。它通过 `workspace:*` 直接依赖 SDK，并负责将 Inspector 挂载到 SDK 提供的 Three.js renderer。

官方 Playground 的浅色视觉配方集中在 [`apps/playground/src/mapStyle.ts`](./apps/playground/src/mapStyle.ts)，包括固定 token、植被/中性 landuse 过滤和普通/主干道路 casing + fill 层级；SDK 本身不注入这套视觉配置。

```bash
pnpm dev
```

默认访问 `http://127.0.0.1:5173`。浏览器控制台会输出实际启用的 `webgpu` 或 `webgl2` 后端。
使用 `?renderer=webgl2` 可强制走 WebGL2，用于验证 fallback 路径，不增加页面调试控件。

## 本地开发

环境基线：Node.js 22.12 或更高版本，推荐 Node.js 24；pnpm 11。

```bash
pnpm install
pnpm dev
pnpm build
pnpm typecheck
pnpm test
pnpm check
```

新增依赖必须说明职责。Three.js 升级必须作为独立任务执行，不能在普通功能任务中顺带升级。

## 测试

`pnpm check` 依次执行严格类型检查、自动测试和生产构建。后续每个具体 Task 必须在任务文件中声明自动测试与人工验证方案，禁止删除测试来绕过失败。

## 当前项目阶段

当前阶段为 **MVP release verification complete**。T003-T009 已完成空间契约、Fetch/Decode、Worker Polygon/Line、Camera/Coverage、Tile Runtime 和动态 Map3D 集成；T011-T015 已完成视觉与连续体验加固并经人工接受。T016 已完成 Line casing/fill 几何复用及双后端浏览器回归，北京 city z10 在未修改 128 MiB CPU cache 预算的前提下通过；T010 已完成当前 Windows 目标工作站的浏览器与性能基线，发布判断为 `PASS_WITH_NON_BLOCKING_LONG_TASK_RISK`。

## Roadmap

1. T003-T009 已建立坐标、请求/解码、Worker Polygon/Line、Camera/Coverage、Tile Runtime 和动态多 Tile Map3D。
2. T011 诊断并修复规则网格水印伪影，T012 建立原创的 Apple Maps-inspired 浅色底图骨架。
3. T013 建立无闪白的渐进式 Tile 替换，T014 增加交互阻尼并完成人工手感验收，T015 增加倾斜远景渐隐并完成人工视觉验收。
4. T016 已复用重复 Line 样式 pass 的共享几何，双后端 city z10 资源回归低于 128 MiB CPU 预算。
5. T010 已完成 WebGPU/WebGL2、连续体验、生命周期、视觉回归、long task trace 和性能发布判断。
6. 在 MVP 证据充分后再规划文字、3D 建筑、Picking、完整 Style 和业务 SDK 能力。

## AI Coding 开发方式

项目采用 Human-Governed + Spec-Driven + Task-Driven + Evidence-Driven AI Coding。所有会话先读取 [AGENTS.md](./AGENTS.md)，通过 [PROJECT.md](./PROJECT.md)、[TASKS.md](./TASKS.md)、任务文件、架构、决策、知识和 research 恢复上下文。聊天记录不是项目事实源，Git 仓库及当前有效项目文件才是事实源。

## 项目限制和浏览器基线

- 源代码文件以 500 行为上限目标，模块保持单一职责。
- 禁止创建承载多个独立子系统的万能 Manager。
- SDK 核心不得依赖 Inspector、Playground 页面或 HTML 调试 UI。
- 新自定义 Shader 不使用手写 GLSL/WGSL 作为默认路径，统一采用 TSL。
- 首选支持 WebGPU 的当前稳定版 Chromium 浏览器；WebGPU 不可用时依赖 Three.js 的 WebGL2 fallback。
- WebGL2、跨域、企业网络策略、KYE 数据授权和各浏览器兼容性需要在目标环境持续验证。
