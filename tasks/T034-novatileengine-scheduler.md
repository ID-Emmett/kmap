# T034 Motion Prediction 与 Request Scheduler

## Goal

实现运动预测、空间公平调度、请求去重和阶段预算。

## Task Context Packet

### Must Read

- `AGENTS.md`
- `docs/project-state.md`
- `TASKS.md`（只读 T034 行与依赖）
- `tasks/T034-novatileengine-scheduler.md`
- `docs/architecture/nova-tile-engine.md`
- `docs/decisions/D033-nova-tile-engine-plan.md`
- `KNOWLEDGE.md`
- `docs/evidence/index.md`
- `docs/ai-session-log.md`

### Read If Needed

- `docs/research/tile-lod-scheduling.md` 的调度章节。
- `docs/verification-baseline.md` 的网络与性能章节。

### Allowed Files

- `packages/map3d/src/nova-tile/motion/**`
- `packages/map3d/src/nova-tile/scheduler/**`
- `packages/map3d/test/novaTileScheduler*.test.ts`
- `docs/evidence/T034-*`

### Forbidden Files

- `packages/map3d/src/legacy/**`
- `packages/map3d/src/migration/**`
- `docs/records/**`

### Required Evidence

- 速度采样和预测 Footprint 测试。
- visible-critical、refinement、lookahead、prefetch、retry 队列测试。
- 空间 Bucket 公平性和 starvation 测试。
- moving/settling/settled/idle 预算测试。
- `pnpm ai:check`、目标测试、`pnpm check`、`git diff --check`。

### Stop Conditions

- 请求预算无法满足完整可见覆盖。
- 调度器需要业务页面状态。

## Scope

- 实现 150～500ms 运动预测。
- 实现 Token Bucket、加权轮询、空间 Bucket 和请求去重。
- 实现每帧请求启动、并发和取消预算。

## Acceptance Criteria

- 运动方向预测区域进入计划。
- 每个空间 Bucket 获得调度配额。
- 相同 Canonical key 共享一个请求。
- settled 和 idle 阶段请求量受预算约束。

## Status

BACKLOG

## Findings

- 待实施。

## Open Issues

- 待实施验证。
