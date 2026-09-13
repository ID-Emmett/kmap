# T040 NovaTileEngine 集成测试

## Goal

组装 NTE 全部模块，建立固定 fixture、模拟网络、模拟 Worker 和确定性帧测试。

## Task Context Packet

### Must Read

- `AGENTS.md`
- `docs/project-state.md`
- `TASKS.md`（只读 T040 行与依赖）
- `tasks/T040-novatileengine-integration-tests.md`
- `docs/architecture/nova-tile-engine.md`
- `docs/decisions/D033-nova-tile-engine-plan.md`
- `KNOWLEDGE.md`
- `docs/evidence/index.md`
- `docs/ai-session-log.md`

### Read If Needed

- `docs/verification-baseline.md` 的自动测试矩阵。
- `docs/knowledge/data.md` 的固定 fixture 章节。

### Allowed Files

- `packages/map3d/src/nova-tile/**`
- `packages/map3d/test/novaTileEngine.integration.test.ts`
- `packages/map3d/test/helpers/nova-tile/**`
- `docs/evidence/T040-*`

### Forbidden Files

- `packages/map3d/src/legacy/**`
- `packages/map3d/src/migration/**`
- `docs/records/**`

### Required Evidence

- 初始化、pan、zoom、pitch、bearing、dispose 集成测试。
- 网络延迟、204、失败、取消、重试和缓存命中测试。
- 完整 Cover、预算、有界工作和资源归零测试。
- `pnpm ai:check`、目标测试、`pnpm check`、`git diff --check`。

### Stop Conditions

- 集成需要改动公共 API或数据协议。
- 任一核心不变量无法在确定性测试中复现。

## Scope

- 组装 NTE 主循环。
- 建立固定 MVT fixture 和 fake clock/fake network。
- 覆盖完整生命周期和异常路径。

## Acceptance Criteria

- 集成测试覆盖全部模块。
- 同一输入产生稳定 timeline。
- 预算、覆盖、缓存、资源和 dispose 不变量通过。
- 测试运行不依赖外部网络。

## Status

BACKLOG

## Findings

- 待实施。

## Open Issues

- 待实施验证。
