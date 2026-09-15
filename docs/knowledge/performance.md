# Kmap Knowledge — Performance

更新日期：2026-09-14

## T041 NovaTileEngine 双后端复跑

- 真实 Chromium 153.0.0.0（Windows/Win32，viewport 764×485，DPR 1）中，WebGPU 与强制 WebGL2 的初始化、交互、pitch、慢网、失败冷却、60 秒交互和 dispose runner 断言均通过。
- 复跑 timeline 的 Frame P95 双后端均为 6ms；WebGPU Worker/Upload P95 为 256.3/8.6ms，WebGL2 为 46.5/6.2ms。Worker 及 WebGPU Upload 超出 D033 目标，作为 T042/T044 性能复核项保留。
- 两后端 CPU/GPU 峰值约 98,808 bytes；60 秒交互持续 60.48～60.52 秒；dispose 后资源 registry entries、CPU/GPU bytes 均为 0。
- 证据：`docs/evidence/T041-browser-verification.json`、`docs/evidence/T041-webgpu-timeline.json`、`docs/evidence/T041-webgl2-timeline.json`。

## T010 浏览器与性能基线

- 当前 Windows 目标工作站的 T010 发布判断为 `PASS_WITH_NON_BLOCKING_LONG_TASK_RISK`。
- clean harness WebGPU low/city/high/pitch60 frame P95 为 1.8/3.5/2.9/9.1 ms；输入响应 P95 为 9.3/11.4/9.7/45.7 ms。
- 强制 WebGL2 low/city/high/pitch60 frame P95 为 1.6/2.9/2.8/9.4 ms；输入响应 P95 为 6.1/9.6/9.3/34.5 ms。
- 固定高 zoom tile 40 次浏览器样本中 worker total P95 9.0 ms、decode P95 3.8 ms、build P95 5.3 ms、upload adapter P95 2.2 ms。
- 证据：`docs/evidence/T010-view-matrix-harness.json`、`docs/evidence/T010-worker-upload-performance.json`、`docs/evidence/T010-longtask-trace.json`。

## 资源预算

- 默认预算仍为 CPU 128 MiB、GPU 256 MiB、256 canonical entries。
- T010 首轮 city z10 clean harness 报告 `171,828,744` bytes，超过 128 MiB CPU cache 初始预算，主因是重复 Line casing/fill topology。
- T016 通过同 Tile Line geometry/topology 共享，将独立 48 visible Tile 复算降至 `89,149,680` bytes；真实浏览器 WebGPU/WebGL2 最大 CPU resource 降至 `134,170,325` 和 `134,195,458` bytes，低于上限但余量极小。
- 证据：`docs/evidence/T016-line-resource-breakdown.json`、`docs/evidence/T016-city-z10-resource-check.json`、`docs/evidence/T016-browser-regression.json`。

## Long Task 风险

- T010 Chrome trace 60 秒交互复现 window long task：WebGPU 8 次、最大 203 ms；WebGL2 9 次、最大 146 ms。
- trace 主要指向 `CrRendererMain` 的 `RunMicrotasks`、`FireAnimationFrame`/Three.js renderer `update`、Worker timer 回调以及 WebGL2 worker message 主线程回调样本。
- 该证据未显示 MVT decode/Polygon triangulation 在主线程执行；当前为非阻断性能风险。
- 若发布目标要求更严格 long task 或输入抖动门槛，需要新建任务，不得在实施会话静默降低门槛。

## T025 调度指标边界

- T025 浏览器脚本证明 1500 ms 延迟下运动期间会启动请求：WebGPU pointer pan 16 个、WebGL2 pointer pan 16 个、WebGPU wheel zoom 24 个、reduced-motion pointer pan 17 个。
- 这只证明请求不再被统一延迟到 idle；不能证明人工观感已经改善。
- 证据：`docs/evidence/T025-browser-regression.json`、`docs/evidence/T025-*.png`。

## T046 全量复核指标

- 真实 Chromium T042 生产轨迹在每个动作停止等待 12 秒后仍有 queued/fetching：WebGPU 17～37、WebGL2 10～32；资源对象与 CPU/GPU bytes 随视图变化增长，dispose 后才归零。
- 注入审计 10 次连续 ViewState 更新产生 38 次 pipeline run、34 次 abort signal；Scheduler moving active 达到 40，当前实现没有阶段 active concurrency cap。
- 这些指标用于 T046 修复前基线，不代表 D033 性能门槛已满足；修复后必须重新采集 Worker、Upload、Frame、输入响应和 60 秒资源曲线。
