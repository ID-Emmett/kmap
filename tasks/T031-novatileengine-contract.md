# T031 NovaTileEngine 契约与隔离目录

## Goal

建立 NTE 独立目录、类型契约、模块边界和测试基座。

## Task Context Packet

### Must Read

- `AGENTS.md`
- `docs/project-state.md`
- `TASKS.md`（只读 T031 行与依赖）
- `tasks/T031-novatileengine-contract.md`
- `docs/architecture/nova-tile-engine.md`
- `docs/decisions/D033-nova-tile-engine-plan.md`
- `KNOWLEDGE.md`
- `docs/evidence/index.md`
- `docs/ai-session-log.md`

### Read If Needed

- `docs/architecture.md` 中的公共 API、坐标和 Worker 章节。
- `docs/verification-baseline.md` 中的数据与性能契约章节。

### Allowed Files

- `packages/map3d/src/nova-tile/**`
- `packages/map3d/test/novaTileEngine*.test.ts`
- `docs/architecture/nova-tile-engine.md`
- `tasks/T031-novatileengine-contract.md`
- `docs/evidence/T031-*`

### Forbidden Files

- `packages/map3d/src/legacy/**`
- `packages/map3d/src/migration/**`
- `docs/records/**`
- `packages/map3d/src/index.ts`

### Required Evidence

- 类型检查。
- 契约单元测试。
- 模块边界测试。
- `pnpm ai:check`、`pnpm check`、`git diff --check`。

### Stop Conditions

- 公共接口、数据协议或运行时依赖出现变更需求。
- 模块边界无法由当前契约表达。

## Scope

- 创建 NTE 类型、事件和状态模型。
- 创建模块导入边界和测试基座。
- 建立 `planEpoch`、`generation`、Canonical key 和 Render key 契约。

## Acceptance Criteria

- NTE 模块可独立编译。
- 所有异步结果包含 epoch/generation/key。
- 公共 Map3D 类型保持可用。
- 测试验证状态模型和 key 稳定性。

## Status

DONE

## Findings

- 在 `packages/map3d/src/nova-tile/` 建立独立契约层，包含 Canonical/Render key、epoch/generation、生命周期状态、异步结果、事件和引擎接口。
- Canonical key 固定包含 `sourceId`、`sourceRevision`、`z/x/y`；Render key 独立保存 `wrapIndex` 与 `mapOriginId`，稳定字符串键区分数据身份和渲染实例。
- 所有异步结果类型统一携带 `jobId`、`planEpoch`、`generation` 和 canonical key；状态机验证合法转换并保持 render/cache role 独立。
- 新增 `novaTileEngine.test.ts` 的 6 个测试，覆盖 key 稳定性、epoch/generation 迟到结果判定、状态模型、引擎生命周期和模块边界。
- `pnpm --filter @nova/map3d typecheck`、目标测试、`pnpm ai:check`、`pnpm check` 和 `git diff --check` 通过。

## Open Issues

无。
