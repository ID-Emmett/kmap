# T037 Render Cover 与 Cohort Commit

## Goal

实现完整 Committed Cover、Best Available fallback、Coverage Cohort 原子提交和过渡生命周期。

## Task Context Packet

### Must Read

- `AGENTS.md`
- `docs/project-state.md`
- `TASKS.md`（只读 T037 行与依赖）
- `tasks/T037-novatileengine-render-cover.md`
- `docs/architecture/nova-tile-engine.md`
- `docs/decisions/D033-nova-tile-engine-plan.md`
- `KNOWLEDGE.md`
- `docs/evidence/index.md`
- `docs/ai-session-log.md`

### Read If Needed

- `docs/experience-baseline.md` 的渲染连续性章节。
- `docs/verification-baseline.md` 的视觉章节。

### Allowed Files

- `packages/map3d/src/nova-tile/render/**`
- `packages/map3d/test/novaTileRenderCover*.test.ts`
- `docs/evidence/T037-*`

### Forbidden Files

- `packages/map3d/src/legacy/**`
- `packages/map3d/src/migration/**`
- `docs/records/**`

### Required Evidence

- exact/ancestor/descendant fallback 测试。
- Cohort 完整性和 atomic commit 测试。
- `coverageComplete = true`、`blankArea = 0` 不变量测试。
- transition 引用生命周期测试。
- `pnpm ai:check`、目标测试、`pnpm check`、`git diff --check`。

### Stop Conditions

- Render Cover 无法在每帧保持完整。
- 提交需要改变公共渲染接口。

## Scope

- 实现 Target Cover、Committed Cover、Outgoing Cover。
- 实现 Coverage Cell 和 Cohort 提交。
- 实现 120～180ms exact/fallback 过渡。

## Acceptance Criteria

- 首个 Bootstrap Cover 完整提交。
- exact Tile 按 Cohort 原子替换。
- fallback 在替换完成前保持引用。
- 过时 epoch 结果不进入当前画面。

## Status

DONE

## Findings

- 在 `src/nova-tile/render/` 建立 Target/Committed/Outgoing Cover、Coverage Cell、exact/ancestor/descendant fallback 和 Cohort 提交模型。
- Cohort 仅在完整 Coverage Cell 集合上提交；提交验证 planEpoch，过时结果不会进入当前画面。
- 过渡默认 150ms，范围约束为 120～180ms；Outgoing 引用在过渡完成前持续保留，完成后释放。
- 新增 `novaTileRenderCover.test.ts` 的 4 个测试，覆盖 fallback 优先级、descendant 完整性、atomic commit、transition 生命周期和 stale epoch。
- `pnpm --filter @nova/map3d typecheck`、目标测试、`pnpm ai:check`、`pnpm check` 和 `git diff --check` 通过。

## Open Issues

无。
