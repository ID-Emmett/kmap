# T039 TileDiagnostics 与 Timeline

## Goal

实现逐帧诊断、阶段耗时、资源统计和可复现 timeline evidence。

## Task Context Packet

### Must Read

- `AGENTS.md`
- `docs/project-state.md`
- `TASKS.md`（只读 T039 行与依赖）
- `tasks/T039-novatileengine-diagnostics.md`
- `docs/architecture/nova-tile-engine.md`
- `docs/decisions/D033-nova-tile-engine-plan.md`
- `KNOWLEDGE.md`
- `docs/evidence/index.md`
- `docs/ai-session-log.md`

### Read If Needed

- `docs/verification-baseline.md` 的证据和性能章节。

### Allowed Files

- `packages/map3d/src/nova-tile/diagnostics/**`
- `packages/map3d/test/novaTileDiagnostics*.test.ts`
- `docs/evidence/T039-*`

### Forbidden Files

- `packages/map3d/src/legacy/**`
- `packages/map3d/src/migration/**`
- `docs/records/**`

### Required Evidence

- timeline schema 单元测试。
- view、cover、request、worker、upload、commit、frame、long-task 事件测试。
- 60 秒采样文件格式验证。
- `pnpm ai:check`、目标测试、`pnpm check`、`git diff --check`。

### Stop Conditions

- 诊断采集影响 Frame P95。
- 关键阶段缺少可追踪事件。

## Scope

- 实现 `TileFrameDiagnostics`。
- 记录 planEpoch、Target/Committed Cover、请求、缓存、Worker、上传、Commit、Frame 和 long task。
- 输出 JSON timeline 和聚合统计。

## Acceptance Criteria

- 每帧可还原 Cover 完整性。
- 每个请求具备原因、阶段、Tile key 和耗时。
- CPU/GPU bytes、Frame P95、Upload P95 可聚合。
- 诊断开销计入性能测试。

## Status

BACKLOG

## Findings

- 待实施。

## Open Issues

- 待实施验证。
