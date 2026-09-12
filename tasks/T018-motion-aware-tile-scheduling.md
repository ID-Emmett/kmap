# T018 Implement Motion-Aware Tile Scheduling

## Goal

在 T017 完整 mixed-LOD Coverage 基础上，建立 coverage-first、motion-aware 的 Fetch/Worker 调度和取消策略，降低连续 pan/zoom/bearing/pitch 中的请求抖动与无效构建，并缩短新视区首次完整覆盖时间。

## Scope

- 为 Target Tile 区分 coverage-critical、visible refinement 和 prefetch 三类内部调度角色。
- coverage-critical coarse Tile 优先于高精度 refinement；稳定视图最终收敛到 T017 ideal Target Coverage。
- 从 T014 交互采样中提取只供 SDK 内部使用的 center/zoom/bearing/pitch motion snapshot。
- 根据短时间预测视图生成 leading-edge prefetch，替换固定全方向一圈 prefetch 的唯一策略。
- 对仍接近当前或预测 Coverage、已取得明显进度的 Fetch/Worker job 使用有界取消迟滞。
- 新输入、外部 `setView()`、页面失活、reduced-motion 和 dispose 的调度边界。
- refinement debounce/hysteresis，避免高速输入期间反复请求高层级 Tile。
- 记录 coarse-cover、ideal-refinement、request cancellation、discarded build 和 queue age 等内部证据。
- Fake clock、延迟 Source/Worker 和真实浏览器连续交互验证。

## Non-Goals

- 不重新定义 T017 Frustum、SSE、mixed LOD 或完整覆盖算法。
- 不新增公开 velocity、scheduler、prefetch 或 debounce 参数。
- 不提高默认 Fetch/Worker 并发、Tile entry、CPU 或 GPU 预算来制造性能提升。
- 不实现 Service Worker、磁盘缓存、跨 Map3D 实例共享 Cache、HTTP/2 服务端改造或 KYE CDN 策略。
- 不修改 Worker geometry、Layer style、Tile GPU resource 或 horizon fade。

## Inputs

- T017 mixed-LOD Target Coverage 与内部优先级角色。
- T008 Tile Runtime/Cache、T013 Progressive Replacement、T014 Inertial Interaction。
- `docs/research/tile-lod-scheduling.md` 的 MapLibre/deck.gl 调度事实。
- T010/T016 60 秒交互、long task、资源和网络异常证据。

## Constraints

- 调度优化不得牺牲完整 Coverage；新视区无 ready exact 时必须优先建立可显示 coarse cover。
- 预测错误不得把 stale Tile 回挂到 Display Coverage；generation/token 规则继续有效。
- 取消迟滞必须有上限，dispose 和明确离开当前/预测区域的工作仍可确定释放。
- motion snapshot 是内部数据，不进入 Map3D 0.1 公共 API。
- reduced-motion 只限制视觉/惯性行为，不得破坏 Coverage 或导致加载停滞。
- 如需改变默认并发或 cache 预算，必须携带 T018 before/after 证据返回 Project Control。

## Acceptance Criteria

- coverage-critical Tile 在 Fetch 与 Worker 队列中始终优先于 refinement/prefetch，且稳定视图下 refinement 不发生饥饿。
- 1500 ms 延迟下连续 pan/zoom/bearing/pitch 不出现背景空洞、旧层级回挂或请求队列永久不 idle。
- 快速往返视图中，预测 Tile 只可作为 prefetch/cache 输入，不能在不属于最新 Target 时提交显示。
- 有界取消迟滞、progress 保留、stale completion 和 dispose 均有确定性测试。
- 在相同脚本与网络模型下形成 before/after 指标；若 coarse-cover time、取消请求、废弃 Worker 构建和下载浪费均无可解释改善，任务返回 Project Control，不以调参宣称完成。
- WebGPU/WebGL2 连续交互观感获得人工负责人接受；frame/upload/worker/resource 指标无未说明退化。
- `pnpm --filter @nova/map3d test` 与 `pnpm check` 通过。

## Test Plan

- Fake clock：三类队列顺序、并发占用、refinement debounce、预测进入/退出、取消迟滞和 starvation。
- Controlled Source/Worker：部分下载进度、迟到结果、快速往返 ViewState、offline/recovery 和节点失败。
- 与无 motion-aware 策略的 T017 基线执行相同脚本，记录 time-to-first-full-cover、time-to-ideal、request starts/cancels、discarded builds 和 bytes。
- Chromium WebGPU/强制 WebGL2：60 秒 pan/zoom/rotate、1500 ms 延迟、reduced-motion、页面失活和 dispose。
- 复核 T010 long task 方向，确认新增预测和队列计算没有制造新的主线程长任务。

## Status

BLOCKED

## Findings

- 2026-09-10：已实现 `TileMotionScheduler`。T017 ideal Target Coverage 保持权威目标；调度层补充最低 selected zoom ancestor 作为 coverage-critical 请求，细粒度目标作为 refinement。相机运动期间只生成预测视野 leading-edge prefetch，idle 时恢复普通 prefetch；预测 Tile 始终为非 visible consumer，不能进入最新 Target Display Coverage。
- 2026-09-10：T014 pointer/wheel/inertia 现在产生内部 `active/settling/idle` motion snapshot，按 240 ms 恒速窗口预测 center/zoom/bearing/pitch；外部 `setView()`、页面失活、reduced-motion 和 dispose 保持确定的 idle/reset 边界。该数据不进入 Map3D 0.1 公共 API。
- 2026-09-10：Runtime 队列按 coverage > refinement > leading-prefetch > ordinary prefetch 排序，refinement 在最后运动后 debounce 180 ms。无 consumer 的在途请求保留 240 ms；下载至少 16 KiB、完成比例至少 50% 或已进入 Worker 阶段时最多保留 600 ms，之后确定取消。Fetch 的流式 reader 记录实际下载进度，stale Worker/upload 继续由 generation 拒绝挂载。
- 2026-09-10：固定 fake-clock/controlled-adapter 对照证据显示：旧策略离开 Coverage 即取消，当前策略在 240 ms 内快速返回时保持 1 次 request start、0 次 cancel 并复用同一 generation；已有 20 KiB/32 KiB 进度的请求在 240 ms 不取消、600 ms 达到上限后取消并记入 discarded bytes。固定 milestone 场景记录 coarse cover 50 ms、ideal refinement 180 ms，并验证队列优先级、stale completion、dispose 和压力抑制。
- 2026-09-10：自动验证通过：`pnpm --filter @nova/map3d typecheck`；`pnpm --filter @nova/map3d test` 通过 33 个测试文件、156 项测试；仓库级 `pnpm check` 的类型检查、SDK/Playground 测试和生产构建全部通过。
- 2026-09-10：当前 Codex Chromium 1280×720、DPR 1.5 的默认 WebGPU 与强制 WebGL2 完成 pan、wheel zoom、bearing/pitch 和 pitch 60 连续交互；1500 ms 延迟下运动帧保持地图覆盖，无 stale 层级回挂，控制台无 warning/error。WebGPU/WebGL2 交互后 frame P95 分别为 10.1/7.4 ms，延迟场景均为 4.8 ms。reduced-motion 下直接 pan 与 Tile 加载正常；双后端 dispose 后 Tile、CPU/GPU、Object、Worker 全部归零。证据见 `docs/evidence/T018-browser-regression.json` 和 `docs/evidence/T018-*.png`。
- 2026-09-10：人工负责人未接受连续 pan 的实际加载观感，报告 Tile 闪烁、疑似重新加载以及远处从中心向两侧逐步出现。Project Control 复核确认该问题不是 T017 mixed-LOD Coverage 缺口，而是 Ready Cache、warm ancestor 和 Display Coverage 生命周期问题。
- 2026-09-10：本地 pitch 60 往返平移诊断中，同一 canonical PBF 路径在约 9 秒窗口内重复发起最高 17 次请求，去程与回程请求集合存在 19 个相同路径；请求具有不同 requestId 且不是 redirect。诊断摘要见 `docs/research/tile-retention-display-fog.md`。

## Open Issues

- T020 已修复 Retained Cache 和 warm ancestor 请求循环，T021 已完成空间 replacement 代码，但人工负责人仍未接受连续 pan/zoom 加载观感；旧 Runtime 的调度/显示路径不再继续追加补丁。
- T023 `TileEngineV2` 已承接本任务的唯一生产 authority，但人工验收仍失败。T018 保持 `BLOCKED`，不在旧 Runtime 上重新实施；其运动中连续调度与公平性由 T025 重新定义，待 T027 通过后由 Project Control 关闭或标记为被替代。
- 2555×1385 高倾角完整矩阵、双后端 60 秒交互、long task、资源上限和最终发布判断由 V2 稳定后的 T019 负责。
