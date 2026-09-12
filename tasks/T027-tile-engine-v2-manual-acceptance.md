# T027 TileEngineV2 Diagnostic and Manual Acceptance

## Goal

建立能捕捉时序问题的逐帧诊断，并以真实操作而非截图替代人工验收，确认 T024-T026 后的 V2 是否真正消除滞后、停止后波次、逐块显示和白闪。

D031 已冻结本任务所属的 V2 补丁链；本文件仅保留为失败路线规格和复盘输入，不得作为默认实施入口。

## Task Context Packet

### Must Read

- `AGENTS.md`
- `docs/project-state.md`
- `PROJECT.md`（只读当前阶段、进行中、下一步、已知风险）
- `TASKS.md`（只读 T021-T028 当前状态和执行顺序）
- `tasks/T027-tile-engine-v2-manual-acceptance.md`
- `tasks/T023-tile-engine-v2.md`
- `tasks/T024-tile-engine-v2-render-transaction.md`
- `tasks/T025-tile-engine-v2-motion-scheduling.md`
- `tasks/T026-tile-engine-v2-coverage-prefetch-budget.md`
- `KNOWLEDGE.md`
- `docs/knowledge/tile-runtime.md`
- `docs/knowledge/rendering.md`
- `docs/knowledge/performance.md`
- `docs/knowledge/environment.md`
- `docs/evidence/index.md`
- `docs/ai-session-log.md`
- `docs/architecture/index.md`
- `docs/architecture/tile-system.md`
- `docs/decisions/index.md`
- `docs/decisions/D031-tile-system-reset-and-ai-context-isolation.md`

### Read If Needed

- `docs/evidence/T024-browser-regression.json`、`docs/evidence/T025-browser-regression.json`、`docs/evidence/T026-*`：需要核对 T024-T026 具体时序、配额和回归证据时读取。
- `docs/evidence/T010-longtask-trace.json`、`docs/evidence/T010-view-matrix-harness.json`、`docs/evidence/T016-browser-regression.json`：需要解释卡顿、资源或 long task 时读取。
- `docs/research/tile-retention-display-fog.md`：需要追溯旧路径人工失败与诊断来源时读取。
- `docs/knowledge/full.md`：仅当知识分片缺失或冲突时按关键词局部读取。

### Allowed Files

- `tasks/T027-tile-engine-v2-manual-acceptance.md`
- `PROJECT.md`
- `TASKS.md`
- `KNOWLEDGE.md`
- `docs/project-state.md`
- `docs/knowledge/tile-runtime.md`
- `docs/knowledge/rendering.md`
- `docs/knowledge/performance.md`
- `docs/knowledge/environment.md`
- `docs/ai-session-log.md`
- `docs/ai-sessions/YYYY-MM-DD.md`

### Forbidden Files

- `packages/map3d/src/runtime/tileEngineV2*.ts`
- `packages/map3d/src/runtime/tileRuntimeDiagnostics.ts`
- `packages/map3d/src/Map3D.ts`
- `packages/map3d/test/tileEngineV2.test.ts`
- `packages/map3d/test/helpers/controlledTileRuntime.ts`
- `packages/map3d/src/runtime/tileRuntime.ts`
- `packages/map3d/src/runtime/tileRuntimeDisplay.ts`
- `packages/map3d/src/runtime/displayCoverage*.ts`
- `packages/map3d/src/spatial/tileMotionScheduler.ts`
- `packages/map3d/src/spatial/mixedLodTile*.ts`（除非诊断证明 coverage selector 是直接阻断）
- `packages/map3d/src/rendering/**`（除非诊断证明 GPU 上传或 render adapter 是直接阻断）
- `packages/map3d/src/source/**`
- `packages/map3d/src/worker/**`
- `packages/map3d/src/geometry/**`
- `packages/map3d/src/types.ts`
- `packages/map3d/src/index.ts`
- `docs/evidence/` 全量目录
- `docs/knowledge/full.md` 默认全文

### Required Evidence

- 当前 BLOCKED 状态下仅允许治理检查：`pnpm ai:check` 与 `git diff --check`。
- 新的逐帧 timeline、浏览器矩阵和人工验收必须在 T028 后重新定义。

### Stop Conditions

- D031 已冻结 V2 补丁链。
- 需要在本任务中修复调度、显示、预算、渲染或 Worker 行为。
- 需要新增公共 API、提高预算或改变验收门槛。
- 人工负责人仍报告白闪、逐块补齐、停止后异常波次、明显卡顿或加载延迟。
- 逐帧 timeline 无法解释人工观察到的问题。

## Scope

- 记录逐帧 Target Coverage、Render Cover、pending/committed cohort、request reason/priority、Fetch/Worker/upload、cache hit/eviction、CPU/GPU bytes 和 frame/input P95。
- 形成固定 Chromium 操作矩阵：WebGPU、强制 WebGL2、1500 ms 延迟、冷启动、连续 pan/zoom、same-zoom pan、rapid return、bearing/pitch 60、reduced-motion、offline/recovery、超宽 viewport。
- 人工负责人现场观看并操作；自动测试、截图和控制台无错误只能作为辅助证据，不能替代体验结论。
- 若仍失败，按逐帧 Render Cover 与 request timeline 指定下一阻断，不再以淡入参数试错。

## Non-Goals

- 不在本任务实现 Tile 调度、显示或预算修复；实现工作由 T024-T026 完成。
- 不实现 T022 fog-bounded Coverage 或最终发布签署。

## Acceptance Criteria

- 诊断能明确区分运动期间推进、idle 后必要请求和异常集中波次。
- 操作期间 Render Cover 始终覆盖有效区域；无白闪、背景空洞、旧层级回挂或明显逐块补齐。
- WebGPU/WebGL2 与慢网矩阵通过，控制台无未说明 warning/error，dispose 后资源和 Worker 归零。
- 人工负责人明确接受后，T023 才能关闭；否则保留失败证据并重新拆分阻断任务。

## Test Plan

- 运行 `pnpm --filter @nova/map3d typecheck`、`pnpm --filter @nova/map3d test`、`pnpm check`。
- 保存结构化 request/cover timeline 和人工验收记录；不以截图单独作为结论。

## Status

BLOCKED

## Open Issues

- D031 已冻结 T026/T027 的 V2 补丁链；本任务不得作为默认下一步执行。
- 新的最终人工验收必须在 T028 和后续新瓦片路线完成后重新定义，不能复用当前 V2 验收链。
