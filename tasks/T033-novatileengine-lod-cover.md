# T033 Mixed LOD 与 Pitch Cover

## Goal

实现基于屏幕空间误差的混合 LOD Cover Planner。

## Task Context Packet

### Must Read

- `AGENTS.md`
- `docs/project-state.md`
- `TASKS.md`（只读 T033 行与依赖）
- `tasks/T033-novatileengine-lod-cover.md`
- `docs/architecture/nova-tile-engine.md`
- `docs/decisions/D033-nova-tile-engine-plan.md`
- `KNOWLEDGE.md`
- `docs/evidence/index.md`
- `docs/ai-session-log.md`

### Read If Needed

- `docs/research/tile-lod-scheduling.md`
- `docs/verification-baseline.md` 的高 pitch 验证章节

### Allowed Files

- `packages/map3d/src/nova-tile/coverage/**`
- `packages/map3d/src/nova-tile/lod/**`
- `packages/map3d/test/novaTileLod*.test.ts`
- `docs/evidence/T033-*`

### Forbidden Files

- `packages/map3d/src/legacy/**`
- `packages/map3d/src/migration/**`
- `docs/records/**`

### Required Evidence

- SSE 细分与合并测试。
- 相邻 LOD 差值测试。
- viewport、pitch、bearing 矩阵测试。
- 数量预算下的完整覆盖测试。
- `pnpm ai:check`、目标测试、`pnpm check`、`git diff --check`。

### Stop Conditions

- 数量预算与完整覆盖无法同时成立。
- loadCutoff 需要新增公开配置。

## Scope

- 实现 SSE 计算、迟滞、best-first 四叉树细分和兄弟合并。
- 实现近景、中景、远景 LOD 规则。
- 实现高 pitch 的 loadCutoff 和相邻层级约束。

## Acceptance Criteria

- 目标 Cover 空间完整。
- 相邻 Tile LOD 差值 `≤1`。
- 预算通过细分停止和父级合并满足。
- pitch 0/20/40/60 生成稳定 Cover。

## Status

DONE

## Findings

- 在 `src/nova-tile/lod/` 建立 MixedLODPlanner，按 SSE、pitch 区域和 tile budget 执行 best-first 四叉树细分、兄弟合并与层级平衡。
- 使用 T032 GroundFootprint 的有限 loadCutoff 和 guard band 生成完整目标覆盖，并保持 Canonical key/source revision 稳定。
- 高 pitch 使用 near/middle/far 区域策略；输出每 Tile SSE、distance、region 和覆盖完整性诊断。
- 新增 7 个混合 LOD 测试，覆盖 pitch 0/20/40/60、SSE 细分、预算和 LOD 差值约束。
- `pnpm --filter @nova/map3d typecheck`、目标测试、`pnpm ai:check`、`pnpm check` 和 `git diff --check` 通过。

## Open Issues

无。
