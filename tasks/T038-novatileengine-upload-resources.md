# T038 Upload Budget 与 Resource Registry

## Goal

实现 GPU 上传预算、backpressure、资源登记、引用计数和延迟释放。

## Task Context Packet

### Must Read

- `AGENTS.md`
- `docs/project-state.md`
- `TASKS.md`（只读 T038 行与依赖）
- `tasks/T038-novatileengine-upload-resources.md`
- `docs/architecture/nova-tile-engine.md`
- `docs/decisions/D033-nova-tile-engine-plan.md`
- `KNOWLEDGE.md`
- `docs/evidence/index.md`
- `docs/ai-session-log.md`

### Read If Needed

- `docs/knowledge/performance.md`
- `docs/verification-baseline.md` 的 GPU 与生命周期章节

### Allowed Files

- `packages/map3d/src/nova-tile/upload/**`
- `packages/map3d/src/nova-tile/resources/**`
- `packages/map3d/test/novaTileUpload*.test.ts`
- `packages/map3d/test/novaTileResource*.test.ts`
- `docs/evidence/T038-*`

### Forbidden Files

- `packages/map3d/src/legacy/**`
- `packages/map3d/src/migration/**`
- `docs/records/**`

### Required Evidence

- 每帧字节/时间双预算测试。
- backpressure 和优先级测试。
- CPU/GPU ownership、refCount 和延迟释放测试。
- WebGPU/WebGL2 资源计数测试。
- `pnpm ai:check`、目标测试、`pnpm check`、`git diff --check`。

### Stop Conditions

- GPU ownership 无法从 Render Cover 解耦。
- 上传预算无法维持当前画面。

## Scope

- 实现 UploadQueue 和时间/字节双预算。
- 实现 TileResourceRegistry。
- 实现 GPU resource 延迟释放和 pressure 事件。

## Acceptance Criteria

- `frameUploadBytes ≤ 4～6MB`。
- `frameUploadTime ≤ 4ms`。
- 当前显示和 transition 资源持续有效。
- 三次 dispose 后资源计数归零。

## Status

DONE

## Findings

- 在 `src/nova-tile/upload/` 建立 TileUploadQueue，按 5MB/4ms/2 commits 默认预算执行 reserve、commit、release、优先级和 backpressure。
- 在 `src/nova-tile/resources/` 建立 TileResourceRegistry，管理 CPU/GPU ownership、refCount、resident/warm/cold role、延迟释放和 pressure 事件。
- 延迟释放默认 2 帧；资源在 Render Cover 或 transition 引用存在时保持有效，释放后执行 dispose 并归零统计。
- 新增 `novaTileUpload.test.ts` 与 `novaTileResource.test.ts`，共 6 个测试覆盖双预算、优先级、backpressure、ownership、pressure 和三次 dispose 周期。
- `pnpm --filter @nova/map3d typecheck`、目标测试、`pnpm ai:check`、`pnpm check` 和 `git diff --check` 通过。

## Open Issues

无。
