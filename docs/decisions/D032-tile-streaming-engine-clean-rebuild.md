# D032 — TileStreamingEngine 全新瓦片系统重建

- 状态：Accepted
- 确认日期：2026-09-12
- 关联范围：T028 / T029 / Tile Runtime / Tile Streaming / AI Context Isolation

## 背景

D031 已冻结 TileEngineV2 补丁链。后续路线需要避免从旧运行时、旧显示覆盖、旧运动调度和 V2 补丁语义继续派生实现。

## 决策

- 新系统命名为 `TileStreamingEngine`。
- `TileStreamingEngine` 是全新瓦片系统，不是 TileEngineV2 的升级、补丁或 V3 续作。
- T029 作为下一步实施任务，一次性交付可运行的垂直切片。
- 旧瓦片生产路径可在 T029 中删除或隔离；旧实现不得作为新算法模板。
- 新实现采用业界通用架构规则，而不复刻 MapLibre、Mapbox 或 deck.gl 源码。

## 架构边界

- 新引擎内部必须显式分离 TilePyramid、TileCoverSelector、TileRequestScheduler、TileCache、TileUploadBudget、TileRenderCover 和 TileDiagnostics。
- 默认保留 KYE XYZ/MVT Source、Worker protocol v1、Polygon/Line geometry build、Three.js GPU upload、WebGPU/WebGL2 后端、Map3D 0.1 公共 API 和资源 ownership。
- 引入新运行时依赖、改变公共 API、改变默认资源预算或改变 Worker protocol 必须返回决策会话。

## 验收原则

- 新系统按通用瓦片流式引擎不变量验收，不按旧系统症状列表验收。
- 必须验证完整 Render Cover、best-available fallback、原子替换、有界请求、有界 Worker、有界 upload、空间公平调度、缓存复用和资源预算。
- 自动测试、timeline evidence、真实 Chromium WebGPU/WebGL2 验证和人工交互验收共同构成阻断门槛。
- 自动证据与人工体验冲突时，以人工验收为阻断事实。

## 对应任务

- `tasks/T029-implement-tile-streaming-engine.md`
