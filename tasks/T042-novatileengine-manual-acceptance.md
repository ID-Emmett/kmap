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

- 2026-09-14 真实 Chromium 生产 Playground 双后端轨迹已执行。WebGPU 与强制 WebGL2 均进入 `ready`，首屏均显示北京基线地图；首屏统计均为 `visible=94`、`ready=94`、`failed=0`。
- 连续 pan 真实改变中心点（WebGPU `lng=116.38577`，WebGL2 `lng=116.38591`）；连续 wheel zoom 将 `zoom` 从 `15` 提升到 `17.4`；bearing 拖拽将 `bearing` 从 `0` 变更到约 `35.9`；pitch 0/20/40/60 均达到目标值。对应截图位于 `docs/evidence/T042-webgpu-*.png` 和 `docs/evidence/T042-webgl2-*.png`。
- 停止等待 12 秒后，WebGPU 仍保持 `queued=17..37`、`fetching=17..37`，WebGL2 仍保持 `queued=10..32`、`fetching=10..32`；`failed=0` 且 workers 已归零。停止阶段存在持续请求，触发 T042 Stop Conditions，验收结论为阻断。
- 返回初始 canonical ViewState 的缓存复用场景两端 `requestDelta=0`；dispose 后两端均为 `tiles.visible=0`、`resources.cpuBytes=0`、`resources.gpuBytes=0`、`workers.active=0`、`workers.queued=0`。
- 结构化证据：`docs/evidence/T042-production-browser.json`；执行脚本：`docs/evidence/T042-production-runner.mjs`。

## Open Issues

- 生产 KYE 请求在 pan/zoom 后存在持续未完成 fetch；需要后续任务在真实网络环境核查请求生命周期、超时/取消和停止阶段调度，确认是否为服务端响应时延或运行时请求收敛问题。
- 在持续请求问题关闭并重新取得短且可控的停止尾部前，T042 保持 `BLOCKED`，不得将本次双后端轨迹标记为通过。
