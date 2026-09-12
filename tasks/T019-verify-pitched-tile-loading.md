# T019 Verify Pitched Tile Loading and LOD Baseline

## Goal

在真实目标浏览器中验证 T017 mixed LOD、T020 retained cache、T023 TileEngineV2 与 T022 fog-bounded coverage 的正确性、加载连续性、资源预算和交互性能，形成 V2 的高倾角 Tile Runtime 发布判断。T018/T021 的失败证据作为迁移输入，不把旧 Runtime A/B 对比作为体验结论。

## Scope

- 固化用户截图视角或等价 ViewState、超宽 viewport、pitch/bearing 矩阵和低/中/高 zoom 场景。
- WebGPU、强制 WebGL2 和无 WebGPU 自动 fallback。
- 逐帧 Coverage sampling、selected zoom distribution、coarse-cover 和 ideal-refinement 时间。
- Ready Cache hit/miss、canonical request histogram、重复 Fetch/Worker/upload、parent/child replacement cohort 和显示资源 churn。
- fogStart、fogEnd、loadCutoff、guard band 与有效 Coverage 边界的对照验证。
- 1500 ms 延迟、快速往返 pan/zoom/rotate、offline/recovery、节点失败和取消。
- Worker、upload、frame、input response、long task、request churn、CPU/GPU bytes、Tile/object/draw counts。
- 三轮 create/dispose 和长时间交互资源稳定性。
- 以 D030/T023 的绝对行为门槛和 T010/T016 的资源/帧时间安全门槛形成 PASS/BLOCKED 结论，并同步项目事实文档。

## Non-Goals

- 不在 Review 会话中顺带修改 T017/T018 算法、降低门槛或提高预算。
- 不扩大到 Firefox、Safari、移动端、Terrain、Globe、文字、3D 建筑或完整 Style v8。
- 不用 horizon fade 掩盖 fogEnd 之前的 Coverage 空洞；fogEnd 之后按 D029 定义为可主动停止加载的非有效显示区域。
- 不以单张截图或 FPS 数字替代逐帧 Coverage 与加载指标。

## Inputs

- T017、T020、T022 和 T023 完成版本及各自 Findings；T018/T021 的失败证据和迁移边界。
- `docs/verification-baseline.md`、`docs/experience-baseline.md`。
- `docs/research/tile-lod-scheduling.md`。
- T010/T016 环境、性能、资源和 long task 证据。
- 用户截图及人工负责人对 mixed LOD Layer 语义的确认。

## Constraints

- 必须记录 OS、浏览器、CPU、GPU、DPR、viewport、backend、commit 和网络模型。
- Coverage correctness、雾效有效边界、网络等待、Worker、GPU upload 和 renderer frame 指标必须分离。
- 资源预算继续使用已确认的 128 MiB CPU、256 MiB GPU 和 256 canonical entries，除非 Project Control 另行批准。
- 所有未复现、仅推测或仅视觉感知的问题不得写入 `KNOWLEDGE.md`。
- 发现阻断问题时返回对应 Implementation Task，不在本 Task 静默修复。

## Acceptance Criteria

- 用户截图类场景在双后端中无 fogEnd 前左右缺 Tile、背景空洞、硬切、stale 层级回挂、明显 LOD 带或 replacement 闪烁。
- pitch 0/40/60、bearing 0/45/90、标准与超宽 viewport 的有效可见距离内地面采样点逐帧完整覆盖；loadCutoff 外不产生 Tile 请求。
- 近景/远景 Tile zoom 分布符合 T017 设计；预算不足时通过低 LOD 保持覆盖。
- 1500 ms 延迟和 60 秒连续交互中 coarse cover 可持续建立，稳定后 ideal refinement 完成、后台请求归零，canonical key 不发生周期性重复请求。
- WebGPU/WebGL2/fallback、网络异常、生命周期和资源预算全部具有可追溯证据。
- T010 已确认的 worker、upload 和 frame 门槛无回归；新增 long task 或输入抖动得到定位和发布判断。
- `pnpm check` 通过，人工负责人接受高倾角加载体验。
- PROJECT、TASKS、KNOWLEDGE、architecture、decisions 和当前 Task 只同步已验证的最终事实。

## Test Plan

- 执行 `pnpm check` 和 T017/T020/T022/T023 针对性测试。
- 使用 clean harness 固定 ViewState、viewport、网络延迟和交互脚本，保存逐帧 JSON、截图/录屏和控制台日志。
- 双后端执行 screenshot view、pitch/bearing matrix、rapid zoom、same-zoom pan、rotate、offline/recovery 和节点失败。
- 采集 PerformanceObserver 与 Chrome trace，区分主线程、Worker 和 renderer 工作。
- 三轮 create/dispose 与至少一轮 60 秒连续交互；对资源峰值和最终归零做复核。
- 使用 debug cutoff/coverage overlay 或等价采样证明 fogEnd 前 Coverage 完整；记录 V2 的绝对 Tile/CPU/GPU/请求指标，资源和门槛回归只用于安全检查，不以旧 Runtime A/B 决定问题是否解决。

## Status

BACKLOG

## Findings

无。任务尚未开始。

## Open Issues

- 正式发布目标设备若不同于 T010 工作站，需要在指定设备重复完整矩阵。
- T023 未完成或 T022 未完成时，本 Task 不得开始；T018/T021 的旧路径人工验收失败不构成再次实施旧 Runtime 的前置条件。
