# T035 Fetch 与 Worker Pipeline

## Goal

实现 MVT Fetch、Decode、Geometry Build、取消和异步结果校验。

## Task Context Packet

### Must Read

- `AGENTS.md`
- `docs/project-state.md`
- `TASKS.md`（只读 T035 行与依赖）
- `tasks/T035-novatileengine-pipeline.md`
- `docs/architecture/nova-tile-engine.md`
- `docs/decisions/D033-nova-tile-engine-plan.md`
- `KNOWLEDGE.md`
- `docs/evidence/index.md`
- `docs/ai-session-log.md`

### Read If Needed

- `docs/knowledge/data.md`
- `docs/verification-baseline.md` 的 Worker 章节

### Allowed Files

- `packages/map3d/src/nova-tile/fetch/**`
- `packages/map3d/src/nova-tile/worker/**`
- `packages/map3d/test/novaTilePipeline*.test.ts`
- `docs/evidence/T035-*`

### Forbidden Files

- `packages/map3d/src/legacy/**`
- `packages/map3d/src/migration/**`
- `docs/records/**`

### Required Evidence

- gzip MVT、204、4xx/5xx、重试和取消测试。
- Worker protocol、transferable buffer、generation/epoch 测试。
- Polygon/Line batch round-trip 测试。
- Worker P95 记录。
- `pnpm ai:check`、目标测试、`pnpm check`、`git diff --check`。

### Stop Conditions

- Worker protocol 或 KYE 数据协议需要变化。
- 解码或几何构建需要回到主线程。

## Scope

- 创建独立 Fetch Pipeline。
- 连接当前 MVT 数据和 Worker geometry build。
- 实现请求取消、失败分类、重试冷却和结果校验。

## Acceptance Criteria

- 同一 Canonical key 只运行一条数据管线。
- 204 生成 empty record。
- 过时 generation/epoch 结果进入缓存并跳过显示提交。
- 主要 buffer 使用 transferable。

## Status

DONE

## Findings

- 在 `src/nova-tile/fetch/` 建立 HTTP Fetch Pipeline，支持 canonical 去重、204 empty、5xx 重试、4xx 错误、AbortSignal 和指数退避。
- 在 `src/nova-tile/worker/` 建立 WorkerBridge、protocol v1、generation/epoch stale 校验和 transferable buffer 收集。
- 新增 Fetch→Worker 管线组合器，确保同一 canonical key 只运行一条在途数据管线。
- 新增 4 个数据管线测试，覆盖 204、4xx、5xx 重试、取消、去重、stale 结果和 transferable buffer。
- `pnpm --filter @nova/map3d typecheck`、目标测试、`pnpm ai:check`、`pnpm check` 和 `git diff --check` 通过。

## Open Issues

无。
