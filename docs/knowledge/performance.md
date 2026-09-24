# Kmap Knowledge — Performance

更新日期：2026-09-23

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

## T046 交互抖动与真实输入实测

- 真实输入探针 `scripts/smoothness-probe.mjs` 使用 CDP 真实 pointer/wheel/shift-drag 事件驱动 `http://127.0.0.1:6661/`，逐帧采集帧间隔、主线程分阶段耗时、GPU 对象创建计数、绘制调用与 Long Animation Frame 归因；浏览器边界为 headless Edge + WebGPU、1600×900、DPR 1。
- 抖动来源已确认：新瓦片首次上屏创建约 30 个 GPUBuffer（7 秒拖拽 2148 个）；长帧无脚本归因且 `blockingDuration` 为 0，属 GPU/合成侧停顿；拖拽阶段另创建 72 个从不被采样的 1×1 纹理；`pump` 峰值 6.1ms；标签布局峰值 8.8ms。
- 优化后实测：拖拽帧间隔 P99 8.4→4.5ms、最大 83.4→20.8ms；滚轮 P99 4.6→4.5ms、最大 58.5→8.2ms；长任务 3→0；拖拽阶段纹理创建 72→5；`pump` 峰值 6.1→1.5ms；最终复测拖拽 P99 8.3ms、最大 37.5ms。
- 增量字节记账、阶段索引、按帧合并的指针提交、无纹理锚点、上传并发与时间预算、标签运动期降频、GPU 几何池与就地重写构成当前交互基线；186 项离线回归通过。
- 残留边界：每个新瓦片首次上屏仍有约 30 个 GPU 对象创建与 15–25ms GPU 侧准备，30 秒连续手势内残留 1 帧超过 16.7ms；固定绘制槽位方案未实施，需决策会话批准。
- 证据：`docs/evidence/streaming-rebuild/smoothness-baseline-gpu.json`、`smoothness-attributed-batch1.json`、`smoothness-pooled-fixed.json`、`smoothness-final-fixture.png`。

## T046 全量复核指标

- 真实 Chromium T042 生产轨迹在每个动作停止等待 12 秒后仍有 queued/fetching：WebGPU 17～37、WebGL2 10～32；资源对象与 CPU/GPU bytes 随视图变化增长，dispose 后才归零。
- 注入审计 10 次连续 ViewState 更新产生 38 次 pipeline run、34 次 abort signal；Scheduler moving active 达到 40，当前实现没有阶段 active concurrency cap。
- 这些指标用于 T046 修复前基线，不代表 D033 性能门槛已满足；修复后必须重新采集 Worker、Upload、Frame、输入响应和 60 秒资源曲线。

## T047 回访零请求与性能边界

- 回访缓存零请求已达成：验收 `docs/evidence/streaming-rebuild/acceptance-60s-T047.json` 中 `cacheRevisitNoFetch:true`，cache-B → cache-A-return 窗口内 fetch=0、`network.starts` 1963→1963。机制为预测跳变判定（单帧跨越 >0.75 瓦片、>0.25 级缩放、>3° 旋转或 >5° 倾角不做速度外推）、已确认空登记（`tileStore.resolvedEmpty`）与 8 秒回访保护窗口（`makeRoom` 两轮淘汰 + `pump` 释放/中止共用）。
- 回访请求复发的主因是预测预取把 `setView` 瞬跳放大为数十公里外的外推，请求视口外 4～7 列的瓦片；该结论由 `acceptance-60s-T047.json` 的 `revisit`/`samples` 与逐 key 状态序列确认。
- GPU 几何池常驻（池预热 + 容量择优 + 每帧预算扩容）实测无额外收益：拖拽阶段 GPUBuffer 创建 480（1426 帧）、滚轮 1698～1725（761 帧），与未预热状态一致；原因是稳态工作集由新进瓦片构成，池内没有容量匹配的空闲几何。该实现同时引入 `computeBoundingSphere` NaN 警告（预热前 0 次、预热后 10 次）并破坏 `writeAttribute` 接管 Worker 数组的零拷贝路径，已回退。
- 性能残留：60 秒验收 P95 8.4ms、P99 16.6ms、minWindowFps 103（T046 基线为 P95 8.4、P99 14.4、minWindowFps 123.98）；真实输入探针拖拽/滚轮/旋转 P95 4.3ms、P99 ≤4.7ms、long task 0。慢帧无脚本归因，属每瓦片首次上屏的 GPU 侧资源创建（约 30 个 GPUBuffer、15–25ms），消除路径为固定绘制槽位与唯一材质方案。
- 证据：`docs/evidence/streaming-rebuild/acceptance-60s-T047.json`、`acceptance-60s-T047-baseline.json`、`smoothness-T047-final.json`、`smoothness-T047-pool.json`。
- T047 人工验收结论（2026-09-23，方案 A）：接受现状并结项；上述性能残留移交 T048（材质槽位化渲染），T048 先核验 Three WebGPU 的动态模板值与绑定组复用，再实施全局唯一材质与固定绘制槽位。

## T048 固定绘制槽位与 Three WebGPU 绑定事实

- 模板编号为动态状态，逐 draw 切换不重建管线（`getRenderCacheKey` 不含 `stencilRef`）。
- 绑定组按 RenderObject 创建一次，只有 `shared` 组跨 RenderObject 复用；稳定绑定只能靠 `(object, material)` 组合长期稳定。
- 逐 draw 变化的值不能放入共享 uniform 组（`queue.writeBuffer` 在命令缓冲提交前统一生效）。
- 全局唯一材质不成立（唯一材质使所有绘制共享同一 `stencilRef`）；替代为按槽位有界复用材质。
- 实测：真实输入探针 bufferDelta 合计 2865→2379，drag compile 峰值 20.3→12.8ms，几何属性重建计数由 2278 归零；条目预算触发淘汰后 mask 槽位复用 1131 次而新建 275 次。
- 稳态限制：常规 pan/zoom 下瓦片条目不淘汰（`releases` 为 0，`entries` 只增不减），槽位与几何池无内容可复用；只有条目数触达 `maxEntries=256` 才发生淘汰与复用。这是每瓦片零新增 GPU 对象的实际阻塞点，释放策略属 T046/T047 缓存语义。
- 60 秒验收两次运行离散（`acceptance-60s-T048.json` 与 `-rerun.json`），性能断言未达标。
