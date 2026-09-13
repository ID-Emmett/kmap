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

DONE

## Findings

- 在 `src/nova-tile/diagnostics/` 建立逐帧 TileDiagnostics、事件类型、Timeline schema v1、JSON 序列化/解析和性能资源聚合。
- 每帧记录 planEpoch、Target/Committed Cover、coverageComplete、blankArea、请求、缓存、Worker、上传、Commit、CPU/GPU bytes、frameTime 和 long task。
- 聚合 Bootstrap/Refinement、cache hit、duplicate/cancel、Worker/Upload/Frame P95、资源峰值和 long-task 统计。
- 新增 `novaTileDiagnostics.test.ts` 的 4 个测试，覆盖事件采集、60 秒 3600 帧 timeline、schema 校验、P95 和非法输入。
- `pnpm --filter @nova/map3d typecheck`、目标测试、`pnpm ai:check`、`pnpm check` 和 `git diff --check` 通过。

## Open Issues

无。
