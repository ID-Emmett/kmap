# T010 Verify MVP Browser and Performance Baseline

## Goal

在真实目标环境对 Nova MVP 候选版本进行浏览器兼容性、交互、网络、资源生命周期和性能专项验证，形成可复现基线与发布结论。

## Scope

- 固化低/中/高 zoom、60 秒交互和三次 create/dispose 场景。
- Windows 目标工作站当前稳定 Chromium WebGPU、强制 WebGL2 和无 WebGPU 自动 fallback。
- Worker decode/build、main upload、frame time、input response、draw calls、objects、Tile/cache bytes。
- KYE 网络请求时序、节点失败、204、4xx/5xx、取消和离线恢复。
- Memory/resource registry、Worker、animation loop、request 泄漏检查。
- 对照 `docs/verification-baseline.md` 给出 PASS/BLOCKED 和证据。
- 对 T011/T012 的无规则网格水印浅色底图做双后端、低/中/高 zoom 视觉回归。
- 对 T013 渐进式 Tile、T014 阻尼交互和 T015 远景渐隐执行连续帧/录屏与性能回归。
- 把已验证事实同步到 `KNOWLEDGE.md`、`PROJECT.md` 和当前 Task。

## Non-Goals

- 不通过修改场景、删除测试或降低门槛掩盖失败。
- 不顺带优化或重构地图实现；发现问题应新建明确 Task。
- 不扩大到 Firefox、Safari、移动端、文字、3D 建筑或完整 Style v8。

## Inputs

- T009 MVP 候选版本，以及已完成的 T011-T015 视觉与连续体验版本。
- `docs/verification-baseline.md`。
- `docs/visual-style-baseline.md`。
- `docs/experience-baseline.md`。
- `docs/architecture.md` 的性能、缓存和资源所有权。
- T003-T009 的 Findings 和 Open Issues。

## Constraints

- 必须记录浏览器、OS、CPU、GPU、内存、DPR、viewport、backend、commit 和采样方法。
- 网络与 renderer 指标分离；公网波动不能伪装成 CPU/GPU 结论。
- 未复现或仅推测的问题不得写入 `KNOWLEDGE.md`。
- 性能门槛若需改变，返回决策会话，不在本 Task 直接改决策。

## Acceptance Criteria

- 三种阻断环境/路径均有真实验证结果和可追溯证据。
- 浅色底图在双后端和低/中/高 zoom 中无非预期规则网格水印、Tile 接缝或明显色差。
- 延迟网络下 zoom/pan 无背景空洞、硬切或 stale 层级回挂；fallback、淡入和释放证据完整。
- pan/旋转阻尼及 wheel 连续更新在双后端符合停止、取消和 reduced-motion 基线。
- pitch 0/20/40/60 的远景渐隐连续，近景可读且未减少 Coverage。
- Worker P95、frame P95、upload P95、input response、resource counts 和网络时序均被记录。
- 60 秒交互和三次生命周期循环无持续资源增长或未说明泄漏。
- 所有功能门槛逐条 PASS，或项目明确 BLOCKED 并拆出修复 Task。
- `pnpm check` 通过；PROJECT、TASKS、KNOWLEDGE 和本 Task 同步。

## Test Plan

- 执行 `pnpm check`。
- 按 `docs/verification-baseline.md` 完整真实浏览器矩阵。
- 保存控制台统计、Performance/Memory 证据和关键截图位置。
- 复核 T011 Tile-bound 对照与 T012 before/after 视觉证据。
- 复核 T013-T015 的延迟加载帧序列、交互录屏、fade 对照和资源计数。
- 复跑至少一次确认结果稳定，记录波动范围。

## Status

DONE

## Findings

2026-09-10 启动 T010。T011-T015 均已完成实现、自动验证、浏览器专项证据和人工体验接受；当前进入实施会话，按 `docs/verification-baseline.md` 对 MVP 候选版本执行浏览器兼容性、连续体验、生命周期、网络异常和性能发布判断。

目标参考环境：按人工负责人“开始执行 T010”的指令，本轮先以当前 Windows 工作站和当前稳定 Chromium 作为目标参考环境采集证据；如最终发布需要另一台指定设备，需在该设备重复本 Task 的真实浏览器矩阵。

环境证据已归档到 `docs/evidence/T010-environment.json`：commit `1f213b0`，Windows 11 Pro `10.0.26100`，AMD Ryzen 9 8945HX（16C/32T），GPU 包含 AMD Radeon 610M 与 NVIDIA GeForce RTX 5060 Laptop GPU，Node `v24.9.0`，pnpm `11.19.0`。

自动基线：收尾复跑 `pnpm check` 通过，包含 `@nova/map3d` typecheck、SDK build、SDK 31 个测试文件 129 项测试、Playground 2 个测试文件 4 项测试，以及 SDK/Worker/Playground production build。该结果证明本轮未通过削弱测试或修改门槛规避问题。

采集工具：新增 `docs/evidence/T010-harness.html`，用于隔离 Playground/Inspector 状态，在 1920x1080 viewport、DPR 约 1 的真实 Chromium 中采集 WebGPU 与强制 WebGL2 的固定 view matrix、截图、控制台日志和 runtime stats。`docs/evidence/T010-view-matrix-harness.json` 及 `docs/evidence/T010-harness-*.png` 作为本 Task 的权威矩阵证据；早期非 harness 截图只保留为过程证据。

浏览器矩阵：WebGPU 与强制 WebGL2 在全国低 zoom、北京城市 zoom、高 zoom 和 pitch 60 场景均渲染真实 KYE Polygon/Line，控制台 warning/error 为 0。WebGPU frame P95 分别为 1.8 ms、3.5 ms、2.9 ms、9.1 ms；WebGL2 frame P95 分别为 1.6 ms、2.9 ms、2.8 ms、9.4 ms，均低于 WebGPU 20 ms 与 WebGL2 25 ms 的帧时间门槛。

Worker/upload 性能：`docs/evidence/T010-worker-upload-performance.json` 对固定高 zoom tile `z15/26978/12416` 采集 40 次浏览器侧样本，worker total P95 9.0 ms、decode P95 3.8 ms、build P95 5.3 ms、upload adapter P95 2.2 ms；首次 warmup worker total 19.9 ms、upload 最大值 3.6 ms，均低于 worker 25 ms 与 upload 8 ms 门槛。

连续体验回归：`docs/evidence/T010-continuity-delayed.json` 在 1500 ms 延迟下覆盖 WebGPU/WebGL2 的 `14.75 -> 15.25 -> 14.75`、`14 -> 16 -> 15` 和 same-zoom pan，日志均为 0，截图未显示矩形背景空洞或 stale 层级回挂。`docs/evidence/T010-interactions.json` 与 `docs/evidence/T010-reduced-motion.json` 覆盖 pan、bearing/pitch、wheel 和 reduced-motion；本轮 CUA drag 脚本不能替代 T014 人工手感验收，但可作为 T010 无日志回归和资源统计证据。

60 秒交互：`docs/evidence/T010-60s-interaction.json` 中 WebGPU 4439 个样本、frame P95 9.4 ms、最终 ready 175/visible 45、queued/fetching/workers 均归零、max CPU/GPU 134,197,740 bytes；WebGL2 5441 个样本、frame P95 9.1 ms、最终 ready 176/visible 45、queued/fetching/workers 均归零、max CPU/GPU 134,208,716 bytes。两者按代码中的二进制 128 MiB 上限 `128 * 1024 * 1024 = 134,217,728` bytes 计算均未超过，但已贴近上限。PerformanceObserver 记录 WebGPU 50/107 ms long task 与 WebGL2 91/152/67 ms long task，未在本轮证据中定位为 Worker decode/build 导致。

生命周期：`docs/evidence/T010-lifecycle-dispose.json` 连续三次 create/initialize/dispose，WebGPU 与 WebGL2 每次最终 state 均为 `disposed`，Tile、resource 和 worker 统计均归零，日志均为 0。

Fallback 与网络异常：`docs/evidence/T010-auto-fallback-no-webgpu.json` 在禁用 `navigator.gpu`/WebGPU 的系统 Chrome 中自动进入 WebGL2，唯一日志为 Three.js 预期 fallback warning。`docs/evidence/T010-network-blocked.json` 中单节点阻断仍 ready，ready tiles 107、loadingFailed 27、responses 107、日志 0；全部节点阻断保持 initializing，failed 28、ready 0、日志 0，没有资源泄漏证据。`docs/evidence/T010-offline-recovery.json` 中离线 pan 保留既有 ready 106，恢复在线并回到起点后 ready 109、queued/fetching 为 0、日志 0。`docs/evidence/T010-http-status-samples.json` 确认主 z15 200/35,594 bytes、多组 204 空瓦片和 404 错误样本；真实 KYE 服务未被诱发 5xx，本轮 5xx 重试语义仍以已有自动测试证据为准。

阶段判断：首轮 T010 因 clean harness 北京城市 zoom 场景在 WebGPU/WebGL2 下均报告 `171,828,744` bytes、超过 128 MiB CPU 初始 cache 预算而进入 `BLOCKED`。T016 未修改预算、Coverage、公共 API 或 Worker protocol version，通过同 Tile 重复 Line 样式 pass 的 TypedArray/BufferGeometry 共享解除该阻断。

T016 后 clean harness：Chrome 151、1920x1080、DPR 1 下，city z10 的 WebGPU/WebGL2 最大 CPU resource 分别为 `134,170,325` 和 `134,195,458` bytes，低于 `134,217,728` bytes 上限，但余量仅 `47,403` 和 `22,270` bytes；最大 GPU resource 分别为 `132,527,696` 和 `132,259,356` bytes，低于 256 MiB。city z10 frame P95 分别为 4.6/4.5 ms，pitch60 分别为 8.4/8.0 ms。资源门槛已通过，但 CPU cache 余量极小，不能描述为宽裕。证据见 `docs/evidence/T016-browser-regression.json`。

T016 后 Worker/upload：固定 Tile 40 次样本的 worker total P95 为 8.6 ms、decode P95 为 4.2 ms、build P95 为 4.7 ms、upload P95 为 1.9 ms；output bytes 从 `497,592` 降至 `295,064`。双后端 60 秒交互、1500 ms 延迟 zoom/pointer pan、三轮 dispose、自动 WebGL2 fallback、节点失败和离线恢复回归均通过。证据见 `docs/evidence/T016-worker-upload-performance.json` 和 `docs/evidence/T016-browser-regression.json`。

long task 诊断收尾：新增 `docs/evidence/T010-longtask-trace-runner.mjs` 和 `docs/evidence/T010-longtask-trace.json`，在当前 Chrome `152.0.7977.76`、1920x1080、DPR 1、T016 clean harness 下对 WebGPU/WebGL2 各执行 60 秒交互并采集 Chrome trace。PerformanceObserver 仍可复现 50 ms 以上 window long task：WebGPU 8 次、最大 203 ms；WebGL2 9 次、最大 146 ms。trace 分类显示高耗时事件主要来自 `CrRendererMain` 的 `RunMicrotasks`、`FireAnimationFrame`/Three.js renderer `update`，以及 `DedicatedWorker thread` 的 `worker/runtime.ts` timer 回调；WebGL2 另有 `slot.worker.onmessage` 主线程回调 102 ms 样本。诊断运行日志为 0，最终 queued/fetching/decoding/building/workers 均归零，WebGPU/WebGL2 trace 运行最大 CPU resource 分别为 `134,213,700` 和 `134,191,637` bytes，均低于 `134,217,728` bytes。

long task 解释：现有 trace 没有显示 MVT decode/Polygon triangulation 在主线程执行；较长 Worker 回调发生在 `DedicatedWorker thread`，不违反“解码/构建不得在主线程制造 Long Task”的架构边界。WebGL2 的 `slot.worker.onmessage` 主线程长回调和 Three.js `update` 长帧保留为非阻断性能风险；若后续发布目标要求“零 long task”或更严格输入抖动，应由决策会话新建优化任务，而不是在 T010 静默降低门槛。

最终发布判断：T010 对当前 Windows 目标工作站的 MVP 浏览器与性能基线判定为 `PASS_WITH_NON_BLOCKING_LONG_TASK_RISK`，任务状态更新为 `DONE`。WebGPU、强制 WebGL2 和无 WebGPU 自动 fallback 均有真实证据；视觉、连续加载、阻尼、远景渐隐、生命周期、网络异常、worker/upload、frame/input response、resource budget 均满足已确认门槛。CPU cache 余量极小和 long task 样本需要后续持续观察，但不再阻断当前 MVP 基线发布判断。

## Open Issues

- 非阻断：CPU cache 在 city z10 和 60 秒交互中仍贴近 128 MiB 初始预算；后续复杂样式、目标设备变更或更大 viewport 需要重复资源矩阵。
- 非阻断：60 秒交互 long task 已定位到渲染帧更新、Worker 回调和 WebGL2 worker message 主线程处理等方向；当前不作为 T010 阻断，后续若要求零 long task 应新建专项优化任务。
- 非阻断：真实 KYE 服务未被诱发 HTTP 5xx；本轮记录了 200/204/404、节点阻断、全部阻断和离线恢复，5xx retry 语义仍依赖自动测试覆盖。
- 条件项：如最终发布指定另一台目标设备或 GPU/浏览器版本，需在该设备重复真实浏览器矩阵。
