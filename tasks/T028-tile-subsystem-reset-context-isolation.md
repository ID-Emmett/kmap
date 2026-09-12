# T028 Tile Subsystem Reset and AI Context Isolation

## Goal

冻结已失败的 TileEngineV2 补丁链，确认全新 `TileStreamingEngine` 路线，建立旧实现隔离边界和后续实施任务上下文包，确保新实现会话不会被 T018/T021/T023-T027 的失败补丁路径误导。

## Task Context Packet

### Must Read

- `AGENTS.md`
- `docs/project-state.md`
- `TASKS.md`（只读 T018-T029 当前状态和执行顺序）
- `tasks/T028-tile-subsystem-reset-context-isolation.md`
- `KNOWLEDGE.md`
- `docs/knowledge/ai-governance.md`
- `docs/knowledge/tile-runtime.md`
- `docs/architecture/index.md`
- `docs/architecture/tile-system.md`
- `docs/decisions/index.md`
- `docs/decisions/D031-tile-system-reset-and-ai-context-isolation.md`
- `docs/decisions/D032-tile-streaming-engine-clean-rebuild.md`
- `docs/evidence/index.md`
- `docs/ai-session-log.md`

### Read If Needed

- `docs/ai-sessions/2026-09-12.md`：需要追溯人工验收失败原话和路线讨论时读取。
- `tasks/T018-motion-aware-tile-scheduling.md`、`tasks/T021-spatial-tile-replacement.md`、`tasks/T023-tile-engine-v2.md`、`tasks/T024-tile-engine-v2-render-transaction.md`、`tasks/T025-tile-engine-v2-motion-scheduling.md`、`tasks/T026-tile-engine-v2-coverage-prefetch-budget.md`、`tasks/T027-tile-engine-v2-manual-acceptance.md`：只为失败证据和任务关闭策略读取。
- `docs/research/tile-lod-scheduling.md`：需要核对通用瓦片调度事实时读取。
- `docs/evidence/T025-browser-regression.json`：需要核对停止后请求、request timeline 或自动证据局限时读取。

### Allowed Files

- `tasks/T028-tile-subsystem-reset-context-isolation.md`
- `tasks/T029-implement-tile-streaming-engine.md`
- `TASKS.md`
- `PROJECT.md`
- `KNOWLEDGE.md`
- `docs/project-state.md`
- `docs/architecture/index.md`
- `docs/architecture/tile-system.md`
- `docs/decisions/index.md`
- `docs/decisions/D031-tile-system-reset-and-ai-context-isolation.md`
- `docs/decisions/D032-tile-streaming-engine-clean-rebuild.md`
- `docs/knowledge/ai-governance.md`
- `docs/knowledge/tile-runtime.md`
- `docs/ai-session-log.md`
- `docs/ai-sessions/YYYY-MM-DD.md`

### Forbidden Files

- `packages/map3d/src/runtime/tileEngineV2*.ts`
- `packages/map3d/src/runtime/tileRuntime*.ts`
- `packages/map3d/src/runtime/displayCoverage*.ts`
- `packages/map3d/src/spatial/tileMotionScheduler.ts`
- `packages/map3d/src/spatial/tileCoverage*.ts`
- `packages/map3d/src/spatial/mixedLodTile*.ts`
- `packages/map3d/src/rendering/**`
- `packages/map3d/src/source/**`
- `packages/map3d/src/worker/**`
- `packages/map3d/src/geometry/**`
- `packages/map3d/src/types.ts`
- `packages/map3d/src/index.ts`
- `docs/evidence/` 全量目录
- `docs/knowledge/full.md` 默认全文

### Required Evidence

- 状态一致性检查：`pnpm ai:check`
- 文档格式检查：`git diff --check`
- 明确的后续任务拆分：创建 `TileStreamingEngine` 垂直切片实施任务。
- 正式状态同步：T028 完成，T029 成为默认下一步。

### Stop Conditions

- 需要修改源码或继续修补 TileEngineV2。
- 需要改变 Map3D 0.1 公共 API、Worker protocol、KYE Source、Three.js 后端或默认资源预算。
- 无法在不读取旧瓦片源码的情况下定义隔离边界。
- 人工负责人要求恢复 T026/T027 补丁链。

## Scope

- 冻结 T026/T027 作为默认实施路线。
- 定义旧瓦片实现、V2 补丁链和后续新实现的隔离边界。
- 确认 `TileStreamingEngine` 为全新瓦片系统命名和后续实施入口。
- 规划 legacy import guard、逐帧诊断、通用不变量测试和最终人工验收。
- 更新正式状态文件，使新 AI 会话不会继续执行已失败路线。

## Non-Goals

- 不实现新的瓦片调度、加载、缓存或渲染代码。
- 不删除旧源码；旧生产路径删除由 T029 实施。
- 不新增运行时依赖。
- 不扩大 Map3D 0.1 公共 API。

## Acceptance Criteria

- `PROJECT.md`、`TASKS.md`、`docs/project-state.md` 和 decisions 对当前下一步保持一致。
- T026/T027 不再作为默认下一步。
- 后续瓦片实施任务必须使用 T028 输出的上下文包和隔离规则。
- `pnpm ai:check` 和 `git diff --check` 通过。

## Test Plan

- 运行 `pnpm ai:check`。
- 运行 `git diff --check`。
- 人工负责人阅读 T028 输出后执行 T029。

## Status

DONE

## Findings

- D032 已确认 `TileStreamingEngine` 为新瓦片系统路线，不作为 TileEngineV2 升级或补丁。
- T029 已创建为下一个实施任务，目标是在一个垂直切片中删除或隔离旧生产瓦片路径，并接入新的流式瓦片引擎。
- T029 的测试以通用瓦片引擎不变量为准，不以旧系统症状作为实现目标。

## Open Issues

- T029 需要真实 Chromium WebGPU/WebGL2 与人工交互验收后才能解除 T022/T019 阻塞。

