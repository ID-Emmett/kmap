# T044 删除后回归与发布验证

## Goal

验证 NTE 完成生产切换后的功能、性能、资源和发布状态。

## Task Context Packet

### Must Read

- `AGENTS.md`
- `docs/project-state.md`
- `TASKS.md`（只读 T044 行与依赖）
- `tasks/T044-novatileengine-release-verification.md`
- `docs/architecture/nova-tile-engine.md`
- `docs/decisions/D033-nova-tile-engine-plan.md`
- `docs/evidence/T043-*`
- `docs/evidence/T041-*`
- `KNOWLEDGE.md`
- `docs/evidence/index.md`
- `docs/ai-session-log.md`

### Read If Needed

- `docs/verification-baseline.md`
- `docs/evidence/T042-*`

### Allowed Files

- `packages/map3d/**`
- `packages/playground/**`
- `docs/evidence/T044-*`
- `PROJECT.md`
- `TASKS.md`
- `docs/project-state.md`
- `KNOWLEDGE.md`
- `tasks/T044-novatileengine-release-verification.md`

### Forbidden Files

- `packages/map3d/src/migration/**`
- `docs/records/**`
- 运行时依赖配置文件

### Required Evidence

- `pnpm ai:check`。
- `pnpm --filter @nova/map3d test`。
- `pnpm check`。
- `git diff --check`。
- WebGPU/WebGL2、慢网、60 秒交互、dispose 和资源报告。
- 发布判断与剩余 Open Issues。

### Stop Conditions

- 任一发布门槛缺少真实证据。
- 性能、资源或人工验收存在未解释阻断。

## Scope

- 执行删除后的全量自动回归。
- 汇总双后端、慢网、性能、资源和人工证据。
- 更新项目状态、知识索引和发布结论。

## Acceptance Criteria

- 所有自动检查通过。
- 所有双后端和人工门槛通过。
- CPU/GPU、Frame、Upload、Worker 和生命周期指标满足预算。
- 项目状态与发布证据一致。

## Status

BACKLOG

## Findings

- 待实施。

## Open Issues

- 待实施验证。
