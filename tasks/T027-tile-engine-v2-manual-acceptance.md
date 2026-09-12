# T027 TileEngineV2 Diagnostic and Manual Acceptance

## Goal

建立能捕捉时序问题的逐帧诊断，并以真实操作而非截图替代人工验收，确认 T024-T026 后的 V2 是否真正消除滞后、停止后波次、逐块显示和白闪。

## Scope

- 记录逐帧 Target Coverage、Render Cover、pending/committed cohort、request reason/priority、Fetch/Worker/upload、cache hit/eviction、CPU/GPU bytes 和 frame/input P95。
- 形成固定 Chromium 操作矩阵：WebGPU、强制 WebGL2、1500 ms 延迟、冷启动、连续 pan/zoom、same-zoom pan、rapid return、bearing/pitch 60、reduced-motion、offline/recovery、超宽 viewport。
- 人工负责人现场观看并操作；自动测试、截图和控制台无错误只能作为辅助证据，不能替代体验结论。
- 若仍失败，按逐帧 Render Cover 与 request timeline 指定下一阻断，不再以淡入参数试错。

## Non-Goals

- 不在本任务实现 Tile 调度、显示或预算修复；实现工作由 T024-T026 完成。
- 不实现 T022 fog-bounded Coverage 或最终发布签署。

## Acceptance Criteria

- 诊断能明确区分运动期间推进、idle 后必要请求和异常集中波次。
- 操作期间 Render Cover 始终覆盖有效区域；无白闪、背景空洞、旧层级回挂或明显逐块补齐。
- WebGPU/WebGL2 与慢网矩阵通过，控制台无未说明 warning/error，dispose 后资源和 Worker 归零。
- 人工负责人明确接受后，T023 才能关闭；否则保留失败证据并重新拆分阻断任务。

## Test Plan

- 运行 `pnpm --filter @nova/map3d typecheck`、`pnpm --filter @nova/map3d test`、`pnpm check`。
- 保存结构化 request/cover timeline 和人工验收记录；不以截图单独作为结论。

## Status

BACKLOG

## Open Issues

- 需要人工负责人在真实 Chromium 中完成最终操作验收；本任务不能由自动化代理代替观看体验。
