# T041 双后端与慢网验证

## Goal

在真实 Chromium 环境验证 NTE 的初始化、交互、倾斜视角、缓存、预算和生命周期。

## Task Context Packet

### Must Read

- `AGENTS.md`
- `docs/project-state.md`
- `TASKS.md`（只读 T041 行与依赖）
- `tasks/T041-novatileengine-browser-verification.md`
- `docs/architecture/nova-tile-engine.md`
- `docs/decisions/D033-nova-tile-engine-plan.md`
- `docs/verification-baseline.md`
- `KNOWLEDGE.md`
- `docs/evidence/index.md`
- `docs/ai-session-log.md`

### Read If Needed

- `docs/experience-baseline.md` 的交互和 pitch 章节。

### Allowed Files

- `packages/map3d/**`
- `packages/playground/**`
- `docs/evidence/T041-*`
- `tasks/T041-novatileengine-browser-verification.md`

### Forbidden Files

- `packages/map3d/src/legacy/**`
- `packages/map3d/src/migration/**`
- `docs/records/**`

### Required Evidence

- Chromium WebGPU 初始化、连续 pan、连续 wheel zoom、pitch、idle、dispose。
- 强制 WebGL2 同场景验证。
- 慢网、缓存命中、请求取消、失败冷却和 60 秒交互。
- 截图、timeline、Frame/Upload/Worker/资源统计。
- `pnpm ai:check`、`pnpm check`、`git diff --check`。

### Stop Conditions

- 浏览器环境缺失或无法记录可复现证据。
- 自动证据与真实画面结果出现冲突。

## Scope

- 运行真实 Chromium WebGPU/WebGL2 矩阵。
- 采集 NTE timeline、截图、Frame P95、Upload P95、CPU/GPU bytes 和请求序列。
- 验证慢网和资源压力行为。

## Acceptance Criteria

- 双后端初始化和交互结果一致。
- 高 pitch 左右覆盖完整。
- 60 秒交互资源保持稳定。
- dispose 后请求、Worker 和 GPU 资源归零。

## Status

BACKLOG

## Findings

- 待实施。

## Open Issues

- 待实施验证。
