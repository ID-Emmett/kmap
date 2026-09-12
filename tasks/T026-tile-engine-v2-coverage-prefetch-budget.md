# T026 TileEngineV2 Coverage and Prefetch Budget Separation

## Goal

解除 `visible.length` 对预加载容量的硬耦合，使 visible/coarse、refinement 和 leading/ordinary prefetch 使用独立的内部配额；在不提高既有 CPU/GPU/entry 总预算的前提下恢复可感知的提前加载。

D031 已冻结本任务所属的 V2 补丁链；本文件仅保留为失败路线规格和复盘输入，不得作为默认实施入口。

## Task Context Packet

### Must Read

- `AGENTS.md`
- `docs/project-state.md`
- `PROJECT.md`（只读当前阶段、进行中、下一步、已知风险）
- `TASKS.md`（只读 T021-T028 当前状态和执行顺序）
- `tasks/T026-tile-engine-v2-coverage-prefetch-budget.md`
- `tasks/T023-tile-engine-v2.md`
- `tasks/T024-tile-engine-v2-render-transaction.md`
- `tasks/T025-tile-engine-v2-motion-scheduling.md`
- `KNOWLEDGE.md`
- `docs/knowledge/tile-runtime.md`
- `docs/knowledge/performance.md`
- `docs/evidence/index.md`
- `docs/ai-session-log.md`
- `docs/architecture/index.md`
- `docs/architecture/tile-system.md`
- `docs/decisions/index.md`
- `docs/decisions/D031-tile-system-reset-and-ai-context-isolation.md`

### Read If Needed

- `docs/research/tile-lod-scheduling.md`：需要核对 MapLibre/deck.gl coverage、best-available 或调度依据时读取。
- `docs/research/tile-retention-display-fog.md`：需要核对旧路径失败根因、retained cache 或 fog/load 边界时读取。
- `docs/evidence/T024-browser-regression.json`：需要核对 Render transaction 和初始 fallback 证据时读取。
- `docs/evidence/T025-browser-regression.json`：需要核对运动期间请求时序、requestQueue 或停止后请求指标时读取。
- `docs/evidence/T010-longtask-trace.json`、`docs/evidence/T016-browser-regression.json`：涉及资源压力或卡顿解释时读取。
- `docs/knowledge/full.md`：仅当上述分片和 evidence 索引不足时按关键词局部读取。

### Allowed Files

- `tasks/T026-tile-engine-v2-coverage-prefetch-budget.md`
- `PROJECT.md`
- `TASKS.md`
- `KNOWLEDGE.md`
- `docs/project-state.md`
- `docs/knowledge/tile-runtime.md`
- `docs/knowledge/performance.md`
- `docs/ai-session-log.md`
- `docs/ai-sessions/YYYY-MM-DD.md`

### Forbidden Files

- `packages/map3d/src/runtime/tileEngineV2*.ts`
- `packages/map3d/src/runtime/tileRuntimeBudget.ts`
- `packages/map3d/src/runtime/tileRuntimeDiagnostics.ts`
- `packages/map3d/src/spatial/tileCoverage*.ts`
- `packages/map3d/src/spatial/mixedLodTile*.ts`
- `packages/map3d/test/tileEngineV2.test.ts`
- `packages/map3d/test/mixedLodTileSelector.test.ts`
- `packages/map3d/test/tileCoverage.test.ts`
- `packages/map3d/test/helpers/controlledTileRuntime.ts`
- `packages/map3d/src/runtime/tileRuntime.ts`
- `packages/map3d/src/runtime/tileRuntimeDisplay.ts`
- `packages/map3d/src/runtime/displayCoverage*.ts`
- `packages/map3d/src/spatial/tileMotionScheduler.ts`
- `packages/map3d/test/tileMotionScheduler.test.ts`
- `packages/map3d/test/displayCoverage.test.ts`
- `packages/map3d/test/tileRuntimeProgressive.test.ts`
- `packages/map3d/src/types.ts`
- `packages/map3d/src/index.ts`
- `packages/map3d/src/source/**`
- `packages/map3d/src/worker/**`
- `packages/map3d/src/geometry/**`
- `packages/map3d/src/rendering/**`
- `docs/evidence/` 全量目录
- `docs/knowledge/full.md` 默认全文

### Required Evidence

- 当前 BLOCKED 状态下仅允许治理检查：`pnpm ai:check` 与 `git diff --check`。
- 若人工负责人要求恢复本任务，必须先返回决策会话重写 Task Context Packet 和 Required Evidence。

### Stop Conditions

- D031 已冻结 V2 补丁链。
- 需要提高默认 Fetch/Worker 并发、CPU/GPU/entry 总预算或公开 `maxTiles` 语义。
- 需要修改 Forbidden Files。
- 需要改动 Render transaction、parent/child replacement 语义或 motion priority，而不是只做预算/配额分离。
- 自动指标改善但人工体验仍报告明显白闪、停止后波次或卡顿。
- 发现问题根因不是 prefetch/coverage 预算耦合，而是更底层渲染、上传或主线程架构。

## Scope

- 将 Coverage selector 的有效可见覆盖配额与 prefetch candidate 配额分离；`maxTiles=128` 不再直接把 prefetch 截断为 `maxTiles-visible.length`。
- 为 coverage-critical、visible refinement、leading prefetch、ordinary prefetch 定义内部 high/low water mark 和淘汰顺序。
- 继续由现有 entries、CPU bytes、GPU bytes 和 256 canonical entries 预算最终约束资源；压力时优先抑制/淘汰 ordinary 与 leading prefetch，不释放当前 Render Cover。
- 增加诊断：每类配额、被抑制原因、预算压力、恢复时间和实际 cache hit。
- 保持 mixed-LOD selector 的空间完整性、Canonical/Render TileKey 和公共 API；如需改变公开 `maxTiles` 语义，先返回决策会话确认。

## Non-Goals

- 不提高默认 Fetch/Worker 并发、CPU/GPU/entry 总预算。
- 不修改 Render transaction（T024）或 motion priority（T025）。
- 不实现磁盘缓存、Service Worker、跨实例共享 Cache 或公开 prefetch API。
- 不实现 T022 fogStart/fogEnd/loadCutoff。

## Acceptance Criteria

- 当 visible 接近 128 时，运动期间仍有非零 leading/ordinary prefetch，且诊断能说明其配额而非依赖剩余 Tile 数。
- 预算未受压时 prefetch 不会因 phase 自动归零；预算受压时按明确原因抑制，并在压力解除后恢复。
- coverage-critical 与 Render Cover 始终优先，任何淘汰不得造成有效区域空洞或 parent 退出。
- 受控 A → B → A 与 1500 ms 浏览器往返 pan 在未超预算时命中 retained cache，不重新 Fetch/Worker/upload。
- 三项资源预算、LRU、dispose、offline/recovery 和现有 T017/T020 测试无回归。

## Test Plan

- selector/scheduler 单测：visible=128、visible<128、prefetch candidate 超额、pressure high/low water mark。
- controlled runtime：记录各角色队列、抑制/恢复、cache hit/eviction 和资源字节。
- WebGPU/WebGL2：超宽 viewport、高 pitch、连续 pan/zoom、1500 ms 延迟与静止 30 秒。

## Status

BLOCKED

## Open Issues

- D031 已冻结 T026/T027 的 V2 补丁链；本任务不得作为默认下一步执行。
- 若人工负责人要求恢复本任务，必须先由决策会话解释为何不执行 T028，并重写 Task Context Packet。
