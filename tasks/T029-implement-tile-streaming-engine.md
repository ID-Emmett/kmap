# T029 Implement TileStreamingEngine Vertical Slice

## Goal

删除或隔离旧瓦片运行时生产路径，建立全新的 `TileStreamingEngine` 垂直切片，并在真实浏览器中验证通用瓦片流式加载、调度、缓存、上传和显示不变量。

## Task Context Packet

### Must Read

- `AGENTS.md`
- `docs/project-state.md`
- `TASKS.md`（只读 T019、T022、T028、T029 当前状态和执行顺序）
- `tasks/T029-implement-tile-streaming-engine.md`
- `KNOWLEDGE.md`
- `docs/knowledge/tile-runtime.md`
- `docs/knowledge/performance.md`
- `docs/architecture/index.md`
- `docs/architecture/tile-system.md`
- `docs/decisions/index.md`
- `docs/decisions/D031-tile-system-reset-and-ai-context-isolation.md`
- `docs/decisions/D032-tile-streaming-engine-clean-rebuild.md`
- `docs/evidence/index.md`
- `docs/ai-session-log.md`

### Read If Needed

- `docs/research/tile-lod-scheduling.md`：需要核对瓦片金字塔、best-available、调度或缓存行业规则时读取。
- `docs/verification-baseline.md`：需要核对浏览器矩阵、帧率、upload、long task 或资源门槛时读取。
- `docs/experience-baseline.md`：需要核对 pan/zoom、渐进显示或人工体验验收边界时读取。
- `docs/evidence/T010-longtask-trace.json`：需要定位 pan/zoom long task 方向时读取。
- `docs/evidence/T025-browser-regression.json`：只在需要说明旧自动证据局限时读取，不作为新实现目标。
- `packages/map3d/src/runtime/tileEngineV2*.ts`、`packages/map3d/src/runtime/tileRuntime*.ts`、`packages/map3d/src/runtime/displayCoverage*.ts`、`packages/map3d/src/spatial/tileMotionScheduler.ts`：仅为删除、断开生产 import 或建立 import guard 时读取。

### Allowed Files

- `packages/map3d/src/streaming/**`
- `packages/map3d/src/Map3D.ts`
- `packages/map3d/src/runtime/events.ts`
- `packages/map3d/src/runtime/errors.ts`
- `packages/map3d/src/runtime/viewStateStore.ts`
- `packages/map3d/src/source/**`
- `packages/map3d/src/worker/**`
- `packages/map3d/src/rendering/tileRenderAdapter.ts`
- `packages/map3d/src/rendering/polygonTile.ts`
- `packages/map3d/src/rendering/lineTile.ts`
- `packages/map3d/src/rendering/materialRegistry.ts`
- `packages/map3d/src/rendering/mapCamera.ts`
- `packages/map3d/src/rendering/viewport.ts`
- `packages/map3d/src/rendering/horizonFade.ts`
- `packages/map3d/src/spatial/tileKey.ts`
- `packages/map3d/src/spatial/mercator.ts`
- `packages/map3d/src/spatial/mapOrigin.ts`
- `packages/map3d/src/spatial/types.ts`
- `packages/map3d/src/spatial/viewState.ts`
- `packages/map3d/src/runtime/tileEngineV2*.ts`（仅删除或断开生产路径）
- `packages/map3d/src/runtime/tileRuntime*.ts`（仅删除或断开生产路径）
- `packages/map3d/src/runtime/displayCoverage*.ts`（仅删除或断开生产路径）
- `packages/map3d/src/spatial/tileMotionScheduler.ts`（仅删除或断开生产路径）
- `packages/map3d/test/tileStreamingEngine*.test.ts`
- `packages/map3d/test/map3d.test.ts`
- `packages/map3d/test/helpers/**`
- `docs/evidence/T029-*`
- `tasks/T029-implement-tile-streaming-engine.md`
- `PROJECT.md`
- `TASKS.md`
- `KNOWLEDGE.md`
- `docs/project-state.md`
- `docs/architecture/tile-system.md`
- `docs/knowledge/tile-runtime.md`
- `docs/knowledge/performance.md`
- `docs/evidence/index.md`
- `docs/ai-session-log.md`
- `docs/ai-sessions/YYYY-MM-DD.md`

### Forbidden Files

- `docs/knowledge/full.md`
- `docs/evidence/` 全量目录
- `tasks/T018-*`
- `tasks/T021-*`
- `tasks/T023-*`
- `tasks/T024-*`
- `tasks/T025-*`
- `tasks/T026-*`
- `tasks/T027-*`
- `docs/ai-sessions/` 历史记录全文
- `packages/map3d/src/index.ts`（除非公共 API 不变且仅修正内部导出）
- 任何新增运行时依赖配置文件

### Required Evidence

- `pnpm ai:check`
- `pnpm --filter @nova/map3d test -- tileStreamingEngine`
- `pnpm --filter @nova/map3d test`
- `pnpm check`
- `git diff --check`
- `docs/evidence/T029-tile-streaming-engine-timeline.json`：记录 view、selected cover、render cover、request start/finish、worker、upload、cache、commit、frame 和 long task 摘要。
- 真实 Chromium WebGPU 与强制 WebGL2 交互验证：初始化、连续 pan、连续 wheel zoom、pan 后停止 3 秒、zoom 后停止 3 秒、dispose。
- 人工负责人验收记录：确认通用瓦片流式体验是否可接受。

### Stop Conditions

- 需要改变 Map3D 0.1 公共 API、Worker protocol、KYE Source 协议、Three.js 后端或默认资源预算。
- 需要新增运行时依赖。
- 需要以旧 TileEngineV2、旧 Tile Runtime、旧 Display Coverage 或旧 Motion Scheduler 行为作为实现模板。
- 无法在资源预算内维持完整 Render Cover、best-available fallback、帧预算和有界请求调度。
- 自动证据通过但人工负责人交互验收失败。

## Scope

- 删除或隔离旧瓦片运行时生产路径，保证 `Map3D` 只接入 `TileStreamingEngine`。
- 新建 `TileStreamingEngine` 内部模块：`TilePyramid`、`TileCoverSelector`、`TileRequestScheduler`、`TileCache`、`TileUploadBudget`、`TileRenderCover`、`TileDiagnostics`。
- 复用低层已验证边界：KYE XYZ/MVT Source、Worker protocol v1、Polygon/Line geometry build、Three.js GPU upload、WebGPU/WebGL2 后端、Map3D 0.1 公共 API。
- 建立 legacy import guard，禁止新引擎 import 旧 runtime、旧 display coverage、旧 motion scheduler 或 TileEngineV2 模块。
- 替换或删除依赖旧运行时语义的测试，新增通用不变量测试。
- 输出逐帧 timeline evidence，支持人工验收与后续性能定位。

## Non-Goals

- 不复刻 MapLibre、Mapbox 或 deck.gl 源码。
- 不引入完整第三方地图 Runtime。
- 不新增公开 API、公开配置或默认资源预算。
- 不实现 T022 fog-bounded pitched coverage。
- 不继续修补 TileEngineV2。
- 不以旧系统症状作为新系统唯一验收目标。

## Architecture Rules

- `TilePyramid`：维护 canonical tile 的 parent/children、coverage relation、wrap consumer 和 overzoom relation。
- `TileCoverSelector`：基于视口地面 footprint、投影尺寸或 screen-space error、迟滞和 guard band 生成目标覆盖。
- `TileRequestScheduler`：区分 visible、cover-critical、prefetch 和 retry 角色；按帧限制 request starts、worker starts 和取消数量。
- `TileCache`：区分 pinned、hot、warm、cold、negative record；同时受 entry、CPU byte 和 GPU byte 预算约束。
- `TileUploadBudget`：限制每帧 GPU upload 和 render resource commit，避免主线程长任务集中爆发。
- `TileRenderCover`：始终提交完整 best-available cover；exact 子瓦片只有在可原子替换同一区域时才替换 parent/fallback。
- `TileDiagnostics`：记录调度、请求、worker、upload、cache、render cover、frame 和 long task 的可追溯事件。

## Acceptance Criteria

- `Map3D` 生产路径不再使用 TileEngineV2、旧 Tile Runtime、旧 Display Coverage 或旧 Motion Scheduler 作为瓦片调度/显示 authority。
- 新引擎在初始化、pan、zoom、停止后和 dispose 场景中保持完整 Render Cover；无未解释空洞提交。
- best-available fallback 在 exact 未 ready、failed、empty 或被预算延迟时可解释地覆盖目标区域。
- 请求、Worker、upload 和 render commit 每帧有明确上限；停止交互后不得产生无界新增工作。
- 调度具备空间公平性，不以固定中心向外单一路径作为唯一加载顺序。
- Cache 命中、negative record、失败冷却和预算淘汰均有自动测试覆盖。
- 双后端真实浏览器验证和人工交互验收通过。

## Test Plan

- 新增 `tileStreamingEngine` 单元测试覆盖 cover selector、scheduler、cache、upload budget、render cover 和 legacy import guard。
- 执行 `pnpm --filter @nova/map3d test -- tileStreamingEngine`。
- 执行 `pnpm --filter @nova/map3d test`。
- 执行 `pnpm check`。
- 执行 `pnpm ai:check`。
- 执行 `git diff --check`。
- 运行真实 Chromium WebGPU/WebGL2 交互验证并写入 `docs/evidence/T029-*`。

## Status

BACKLOG

## Findings

无。任务尚未开始。

## Open Issues

- T029 通过前，T022 fog-bounded coverage 与 T019 最终发布验证保持阻塞。
