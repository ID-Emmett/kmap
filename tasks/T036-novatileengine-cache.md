# T036 分层 Cache 与持久化

## Goal

实现 Resident、Warm、Cold、Persistent 四层缓存、负缓存和字节预算。

## Task Context Packet

### Must Read

- `AGENTS.md`
- `docs/project-state.md`
- `TASKS.md`（只读 T036 行与依赖）
- `tasks/T036-novatileengine-cache.md`
- `docs/architecture/nova-tile-engine.md`
- `docs/decisions/D033-nova-tile-engine-plan.md`
- `KNOWLEDGE.md`
- `docs/evidence/index.md`
- `docs/ai-session-log.md`

### Read If Needed

- `docs/knowledge/data.md` 的 source revision 章节。
- `docs/verification-baseline.md` 的内存章节。

### Allowed Files

- `packages/map3d/src/nova-tile/cache/**`
- `packages/map3d/test/novaTileCache*.test.ts`
- `docs/evidence/T036-*`

### Forbidden Files

- `packages/map3d/src/legacy/**`
- `packages/map3d/src/migration/**`
- `docs/records/**`

### Required Evidence

- Cache hit、source revision、LRU/2Q 和 entry budget 测试。
- CPU/GPU byte budget 和 pressure 测试。
- empty、negative、retry cooldown 测试。
- Persistent cache 读写和失效测试。
- `pnpm ai:check`、目标测试、`pnpm check`、`git diff --check`。

### Stop Conditions

- 持久化数据需要新增公开 API。
- 预算无法同时容纳 Resident 和 Warm 资源。

## Scope

- 实现四层缓存和 Canonical key 索引。
- 实现 128MiB CPU、256MiB GPU、256 entries 预算。
- 实现淘汰、负缓存、失败冷却和 source revision 隔离。

## Acceptance Criteria

- Resident 资源持续可用。
- Warm 资源支持运动方向复用。
- Cold 资源按访问顺序淘汰。
- Persistent 数据能在下一渲染周期命中。
- Cache 统计包含命中、淘汰和压力事件。

## Status

BACKLOG

## Findings

- 待实施。

## Open Issues

- 待实施验证。
