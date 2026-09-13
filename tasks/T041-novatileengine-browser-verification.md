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

DONE

## Findings

- 真实 Chromium 153.0.0.0（Windows/Win32，viewport 764×485，DPR 1，hardwareConcurrency 20，deviceMemory 16）完成 WebGPU 与强制 WebGL2 同场景验证，复跑时间为 2026-09-13。
- 两个后端初始化均提交 19 Tile 的完整 Cover；初始、连续 pan/zoom/bearing/pitch 交互和 pitch 0/20/40/60 快照均满足 `coverageComplete=true`、`blankArea=0`。
- 慢网场景使用 180ms 延迟和两个未缓存高 zoom 视图，两个后端均观察到 5 次请求取消；缓存命令的 ready hit 增加 1 且请求数增量为 0。
- 失败场景两个后端均观察到 6 次失败请求；冷却窗口内失败 key 仅有 1 次边界启动，恢复阶段回到在线并完成 Cover，失败记录归零。
- 60 秒交互实际持续 60.48～60.52 秒；CPU/GPU 峰值约 98,808 bytes；两后端 dispose 后 committed/retained、请求、Worker、GPU resource entries、CPU/GPU bytes 均归零。
- 复跑 timeline：WebGPU Frame P95 6ms、Worker P95 256.3ms、Upload P95 8.6ms；WebGL2 Frame P95 6ms、Worker P95 46.5ms、Upload P95 6.2ms。Worker P95 与 WebGPU Upload P95 超过 D033 目标，保留为后续 T042/T044 性能复核项；timeline 的 `blankArea=19` 来自初始化未提交 Cover 的早期帧，所有场景 settle 快照均为 0。
- 证据入口：`docs/evidence/T041-browser-verification.json`、`T041-webgpu-timeline.json`、`T041-webgl2-timeline.json`、双后端初始化/交互/pitch/慢网 PNG，以及 `T041-browser-harness.html`/`.ts`/runner。

## Open Issues

- 复跑长场景的 Worker P95 为 WebGPU 256.3ms、WebGL2 46.5ms，WebGPU Upload P95 为 8.6ms，均超过 D033 的性能目标；功能与生命周期断言完整通过，需在 T042/T044 性能复核中处理。
