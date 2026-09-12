# T025 TileEngineV2 Continuous Motion Scheduling

## Goal

消除“停止后才释放 refinement”的调度闸门，使运动期间持续推进可见区域和预测区域加载，并用可解释的 deadline/coverage/age 规则避免中心 Tile 长期垄断请求。

## Scope

- 移除全局 `180 ms` refinement debounce；运动期间即可请求可见 refinement，停止后只做自然的队列重排，不产生必然的集中波次。
- 设计明确的优先级 tuple：coverage-critical、当前可见 refinement、leading prefetch、ordinary prefetch；同一角色按视口覆盖、deadline/等待时长和屏幕距离公平排序。
- 保留 leading prefetch 与一圈 ordinary prefetch；只有真实 memory/network pressure 才抑制低优先级预取。
- 增加队列 age、starvation、notBefore、request reason 诊断，证明运动期间请求持续发生且 idle 不触发额外大批量 refinement。
- 保持 Fetch/Worker 默认并发、取消迟滞、generation 和失败恢复语义不变。

## Non-Goals

- 不把提高 Fetch/Worker 并发当作主要修复手段。
- 不修改 Render transaction 或 parent/child 提交（T024）。
- 不修改 Coverage 与 prefetch 的容量预算（T026）。
- 不实现公开 scheduler/velocity API 或 fog-bounded Coverage（T022）。

## Acceptance Criteria

- fake clock 显示 active/settling 阶段 refinement 无统一的 idle-only `notBefore`；停止后不会必然新增一整批高层级请求。
- 在请求并发固定为 8、Worker 固定为 4 时，当前视区 coverage/refinement 在运动期间持续推进，leading/ordinary prefetch 不因 phase 自动归零。
- 相同 priority 下远近 Tile 均能获得服务；不存在中心 Tile 完成后才向外扩散的队列饥饿模式。
- 1500 ms 延迟真实浏览器中，连续 pan/zoom 的 request timeline 显示运动期间已有可见推进，idle 后仅保留必要未完成请求。
- cancellation、stale generation、offline/recovery 和 reduced-motion 回归通过。

## Test Plan

- Scheduler fake clock：active、settling、idle、反向运动、快速连续 ViewState、deadline/age fairness。
- Controlled source/worker：固定并发下记录 start/finish 顺序、request reason、notBefore 和取消次数。
- WebGPU/WebGL2 Chromium：冷启动、same-zoom pan、连续 zoom、bearing/pitch 60 与慢网脚本。

## Status

BACKLOG

## Open Issues

- 具体 priority tuple 的权重必须以诊断可解释性和完整 coverage 为准，不以单纯中心距离排序。
