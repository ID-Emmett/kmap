# D033 — NovaTileEngine 任务化重建方案

- 状态：Accepted
- 确认日期：2026-09-13
- 关联范围：NovaTileEngine / Tile Streaming / Task Plan

## 系统名称

`NovaTileEngine`，简称 `NTE`。

## 当前接口

`Map3D` 继续提供以下公共接口：

```ts
interface Map3D {
  initialize(): Promise<void>;
  resize(width: number, height: number, devicePixelRatio?: number): void;
  start(): void;
  stop(): void;
  dispose(): Promise<void>;
  getView(): ViewState;
  setView(view: ViewState): void;
  getBackend(): 'webgpu' | 'webgl2';
  getStats(): MapStats;
  on<K extends MapEventName>(event: K, listener: MapEventListener<K>): () => void;
  getRenderer(): unknown;
}
```

`NovaTileEngine` 为 `Map3D` 内部实现接口：

```ts
interface NovaTileEngine {
  initialize(): Promise<void>;
  resize(viewport: Viewport): void;
  updateView(view: ViewState): void;
  frame(frameTime: FrameTime): void;
  getStats(): TileStats;
  dispose(): Promise<void>;
}
```

## 数据协议

- 空间：WGS84、Web Mercator、标准 XYZ。
- 数据：MVT v2、extent 4096、HTTP gzip。
- 空瓦片：HTTP 204。
- 渲染后端：Three.js WebGPU 与 WebGL2。
- 几何管线：Worker protocol v1、Polygon batch、Line batch、transferable buffers。
- 世界副本：Canonical Tile 数据与 Render Tile 实例分离。

## 架构模块

```text
TileAddress
TilePyramid
GroundFootprint
TileCoverPlanner
MotionPredictor
TileRequestScheduler
TileFetchPipeline
TileWorkerBridge
TileCache
TileUploadQueue
TileRenderCover
TileResourceRegistry
TileDiagnostics
NovaTileEngine
```

## 核心不变量

- Target Cover 与 Committed Cover 独立维护。
- Committed Cover 每帧保持完整，`blankArea = 0`。
- Tile 数量预算通过 LOD 细分深度控制。
- 相邻区域的 LOD 差值 `≤ 1`。
- Fetch、Worker、Upload、Commit 均有帧级预算。
- 同一 Canonical Tile 共享 Fetch、Decode、Build、Cache 和 GPU 数据。
- exact Tile 以 Coverage Cohort 原子提交。
- fallback 在替代区域完整提交和过渡完成前保持引用。
- CPU/GPU 资源始终位于批准预算内。

## 初始参数

| 项目 | 参数 |
| --- | ---: |
| Bootstrap Zoom | `floor(view.zoom) - 2`，按 source 边界裁剪 |
| Bootstrap Guard Band | 1 圈 |
| Exact Target 数量 | 20～96，按 viewport 与 pitch 动态计算 |
| 运动预测 | 150～500ms |
| 预取比例 | 活动 Tile 的 20%～35% |
| Fetch 并发 | 运动中 8，停止后 12 |
| Worker 并发 | 运动中 2～4，停止后 4 |
| Upload | 4～6MB 或 4ms/帧 |
| Render Commit | ≤2 Cohort/帧 |
| CPU Cache | 128MiB |
| GPU Cache | 256MiB |
| Canonical Entries | 256 |

## 任务路线

```text
T030 方案与任务冻结
  ↓
T031 契约与隔离目录
  ├─ T032 TilePyramid 与 Footprint
  │    └─ T033 Mixed LOD 与 Pitch Cover
  ├─ T034 Motion Prediction 与 Scheduler
  ├─ T035 Fetch 与 Worker Pipeline
  └─ T036 分层 Cache 与持久化
       ↓
T037 Render Cover 与 Cohort Commit
       ↓
T038 Upload Budget 与 Resource Registry
       ↓
T039 Diagnostics 与 Timeline
       ↓
T040 NTE 集成测试
       ↓
T041 双后端与慢网验证
       ↓
T042 人工体验验收
       ↓
T043 生产切换与旧代码删除
       ↓
T044 删除后回归与发布验证
```

## 验收门槛

- 初始化先提交完整 Bootstrap Cover，再进行 Exact Refinement。
- pan、zoom、bearing、pitch 期间 Committed Cover 持续完整。
- 高 pitch 使用近景高 LOD、中景混合 LOD、远景低 LOD。
- 运动方向预取具备可观测命中率。
- 停止阶段只处理有限 refinement tail。
- Worker 单 Tile P95 `≤25ms`。
- WebGPU Frame P95 `≤20ms`。
- WebGL2 Frame P95 `≤25ms`。
- Upload P95 `≤8ms`。
- View 输入到下一帧响应 P95 `≤50ms`。
- 三次 create/dispose 后请求、Worker、GPU 资源归零。
- 真实 Chromium WebGPU、强制 WebGL2、慢网和人工交互全部通过。

## 执行规则

- T031～T042 只使用 NTE 当前契约和新目录。
- T043 单独负责生产切换、旧文件删除和删除验证。
- T044 负责删除完成后的全量构建、测试、资源和发布证据。
- 每个实施任务拥有独立 Task Context Packet。
- 每个任务完成后同步状态、Findings、Open Issues 和 evidence 索引。
