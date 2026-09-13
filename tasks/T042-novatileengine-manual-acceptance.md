# T042 NovaTileEngine 人工体验验收

## Goal

完成 NTE 初始化、pan、zoom、bearing、pitch、停止阶段和缓存复用的人工验收。

## Task Context Packet

### Must Read

- `AGENTS.md`
- `docs/project-state.md`
- `TASKS.md`（只读 T042 行与依赖）
- `tasks/T042-novatileengine-manual-acceptance.md`
- `docs/architecture/nova-tile-engine.md`
- `docs/decisions/D033-nova-tile-engine-plan.md`
- `docs/verification-baseline.md`
- `docs/evidence/index.md`
- `docs/ai-session-log.md`

### Read If Needed

- `docs/experience-baseline.md`
- `docs/evidence/T041-*`

### Allowed Files

- `packages/playground/**`
- `docs/evidence/T042-*`
- `tasks/T042-novatileengine-manual-acceptance.md`

### Forbidden Files

- `packages/map3d/src/legacy/**`
- `packages/map3d/src/migration/**`
- `docs/records/**`

### Required Evidence

- 人工操作记录和录屏/截图。
- 初始化、连续 pan、连续 zoom、停止等待、pitch 0/20/40/60、dispose 结果。
- WebGPU 与 WebGL2 结果。
- 明确的通过/阻断结论。

### Stop Conditions

- 任一关键场景出现空白覆盖、明显卡顿或持续请求。
- 人工结果与自动指标冲突。

## Scope

- 按固定操作轨迹执行双后端人工验收。
- 对画面连续性、跟手性、加载时序、远景层级和停止阶段进行记录。
- 将问题绑定到 T041 timeline 事件。

## Acceptance Criteria

- 首次画面稳定。
- pan 和 zoom 过程中地图持续跟手。
- Tile 替换按空间 Cohort 发生。
- 停止后加载尾部短且可控。
- 高 pitch 近中远 LOD 连续。

## Status

BLOCKED

## Findings

- 2026-09-13 生产 NTE 双后端复跑：真实 Chromium WebGPU 与强制 WebGL2 均进入 `ready`，但首屏截图为空；两端统计均为 `visible=1`、`ready=1`、`resources.batches=1`。
- 当前生产 `MixedLODPlanner` 在 `zoom=15`、`minZoom=0` 场景仅计划单个 `z=0` 根 Tile；SSE 使用 `2 ** (key.z - targetZoom)`，根 Tile 得分约 `9.375`，低于默认细化阈值 `320px`。
- T043 生产入口检查确认 `Map3D` 当前实例化 `NovaTileEngine`；T042 阻断点位于初始覆盖规划。
- 证据：`docs/evidence/T042-production-browser.json`、`docs/evidence/T042-webgpu-initial.png`、`docs/evidence/T042-webgl2-initial.png`、`docs/evidence/T045-nte-initial-coverage-analysis.json`。

## Open Issues

- 修复任务 T045 负责修正 `MixedLODPlanner` 的 Bootstrap 层级和细化评分方向；该修改超出 T042 的 Allowed Files（`packages/playground/**`），当前任务停止于阻断证据。
- 修复后重新执行 T042 的 WebGPU/WebGL2 人工轨迹，补齐初始化、pan、zoom、bearing、pitch 0/20/40/60、停止等待、缓存复用、dispose 的截图与操作记录。
