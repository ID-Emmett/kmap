# Nova Evidence Index

更新日期：2026-09-17

本文件是 `docs/evidence/` 的轻量索引。默认只读本索引；需要核对具体指标、截图、trace 或脚本时，再按任务号打开具体文件。不得在普通实施会话中整目录通读 evidence。

## 读取策略

- 先按任务号查本索引，例如 `T025`。
- 再按证据类型打开：JSON 用于指标和时序，PNG 用于视觉结果，HTML/MJS 用于复现实验。
- 大型 trace、截图和脚本不默认读取；只在 Task Context Packet 或人工问题明确要求时读取。
- 新 evidence 文件应使用 `Txxx-*` 前缀，并在本索引追加一行摘要。

## 当前画质证据

[2026-09-17 平面/地球过渡、Inspector 与加载稳定性](map-inspector/README.md)：160 项测试、双后端 70 场景、1208 帧关闭文字冷加载；单帧大面积泛白检测为 0。2560×1305 连续交互 WebGL2 148.98 FPS、WebGPU 143.77 FPS；控件、近景公共边、原生视口帧调度边界和源码哈希随报告登记。

[2026-09-17 球面地图、文字、稳定性与主题](map-experience/README.md)：141 项测试、双后端 30 场景、394 张图像；2560×1305 连续交互 WebGL2 163.58 FPS、WebGPU 164.85 FPS，采样覆盖缺口和错误为 0；抗锯齿配置、真实控件操作和冷加载边界随报告登记。

[2026-09-16 球面矢量瓦片、文字和道路优化](map-refinement/README.md)：121 项自动测试与双后端 36 场景浏览器验证；包括性能范围、预算、截图及人工验收边界。

[2026-09-16 稳定性与文字/地球验证](map-stability/README.md)：海洋源补全、flat 线样式、SDF 中文、碰撞与地球视图；源码、真实数据和自动测试证据已记录，双后端浏览器验收状态随报告登记。

[2026-09-16 五项画质验证](map-quality/README.md)：75° 强雾与同级目标、合批建筑和 15.74 门槛、kind 分类色、国省界与虚线、米制道路。真实 WebGPU 15 场景矩阵通过；60 秒连续交互的覆盖和预算通过，恒定 160fps 与运动细节比例的实测限制随原始证据记录。

## 任务证据索引

公开地图引擎的固定版本覆盖、局部 LOD、雾、加载队列和缓存核验见 [2026-09-16 研究](../research/industry-tile-streaming-2026-09-16.md)。MapLibre、Mapbox、OpenLayers、Cesium、3DTilesRendererJS、3D Tiles 规范源码及论文作者页面的 URL/版本/SHA256 位于 `industry-tile-research-2026-09-15/`；该证据范围为资料核验。

当前 StreamingEngine 的道路宽度、首屏、快速交互与城市飞行证据见 [修复验证报告](streaming-rebuild/oversized-roads-fix.md)：2560×1305 WebGPU 三轮最终验收通过，1155 张 10Hz 图像与 477 张瞬时过渡采样完成模型视觉审查。原始时序、MP4、检查日志与源码 SHA256 由报告索引；公开资料与验收定义见 `docs/research/streaming-rebuild-public-sources.md`。独立重建记录见 [S001 验收报告](streaming-rebuild/README.md)。

当前父子绘制重叠与高倾角细节的专题事实见 [2026-09-15 审计报告](../research/tile-overlap-and-pitch-audit-2026-09-15.md)：当前源码的 CPU 探针确认稳定三层来源重叠及近处目标降级，已记录 WebGPU 时序与选择结果一致。编号分析图、探针与原始时序交叉检查位于 `tile-audit-2026-09-15/`；本轮浏览器连接的认证阻断在报告中登记。

| Task | 文件数 | 关键证据 | 结论用途 |
| --- | ---: | --- | --- |
| T006 | 2 | `T006-webgpu-2026-09-09.png`, `T006-webgl2-2026-09-09.png` | 固定 KYE Polygon Tile 双后端纵向显示 |
| T007 | 2 | `T007-initial-webgpu-2026-09-09.png`, `T007-interactions-webgpu-2026-09-09.png` | Camera、交互和基础 Coverage 浏览器验证 |
| T009 | 4 | `T009-webgpu-*.png`, `T009-webgl2-*.png` | 动态多 Tile Polygon/Line Runtime 双后端验证 |
| T010 | 73 | `T010-view-matrix-harness.json`, `T010-worker-upload-performance.json`, `T010-longtask-trace.json` | MVP 浏览器、资源、性能和 long task 基线 |
| T011 | 11 | `T011-before-webgpu-z15.png`, `T011-after-webgpu-z15.png`, `T011-after-webgl2-z15.png` | 规则网格伪影诊断与修复验证 |
| T012 | 8 | `T012-after-webgpu-z*.png`, `T012-after-webgl2-*.png` | Playground 浅色底图视觉验证 |
| T013 | 12 | `T013-*-delayed-*.png` | 渐进式 Tile 替换慢网截图验证 |
| T014 | 7 | `T014-*-pan-inertia.png`, `T014-*-wheel-merged.png` | 惯性交互与 wheel 合并验证 |
| T015 | 12 | `T015-*-pitch-*.png`, `T015-*-dispose.png` | 倾斜远景渐隐和 dispose 验证 |
| T016 | 32 | `T016-browser-regression.json`, `T016-city-z10-resource-check.json`, `T016-line-resource-breakdown.json` | Line geometry 复用、资源预算和浏览器回归 |
| T017 | 2 | `T017-browser-regression.json`, `T017-browser-harness.html` | mixed-LOD Coverage 浏览器回归 |
| T018 | 10 | `T018-browser-regression.json`, `T018-*.png` | 旧 motion-aware 调度自动/浏览器证据；人工观感仍失败 |
| T020 | 1 | `T020-browser-regression.json` | Retained Cache 与 request thrash 修复回归 |
| T021 | 20 | `T021-browser-regression.json`, `T021-*-early.png`, `T021-*-initial.png` | 旧路径 best-available replacement 脚本证据；人工验收失败 |
| T024 | 4 | `T024-browser-regression.json`, `T024-*-1500ms-initial.png` | V2 Render transaction、fallback 和稳定 cover 回归 |
| T025 | 6 | `T025-browser-regression.json`, `T025-browser-regression-runner.mjs`, `T025-*.png` | V2 运动中连续调度脚本证据；不替代人工观感 |
| T029 | 1 | `T029-tile-streaming-engine-timeline.json` | 新引擎自动不变量、timeline schema 和浏览器验证阻断记录 |
| T031 | 1 | `T031-contract.json` | NTE 契约、独立命名空间、类型检查和目标测试证据 |
| T032 | 1 | `T032-ground-footprint.json` | TilePyramid、GroundFootprint、pitch 采样和 AABB 覆盖证据 |
| T033 | 1 | `T033-lod-cover.json` | Mixed LOD、SSE 细分、预算和倾斜视角覆盖证据 |
| T034 | 1 | `T034-scheduler.json` | MotionPredictor、空间公平调度和阶段预算证据 |
| T035 | 1 | `T035-pipeline.json` | Fetch、204/重试、Worker stale 和 transferable 证据 |
| T036 | 1 | `T036-cache.json` | 分层缓存、字节预算、淘汰、压力和持久化证据 |
| T037 | 1 | `T037-render-cover.json` | Render Cover、fallback、Cohort 原子提交和过渡生命周期证据 |
| T038 | 1 | `T038-upload-resources.json` | UploadQueue 双预算、backpressure、资源 ownership 和延迟释放证据 |
| T039 | 1 | `T039-diagnostics.json` | 逐帧诊断、Timeline schema、60 秒采样和性能聚合证据 |
| T040 | 1 | `T040-novatileengine-integration.json` | NTE 确定性集成测试、异常路径、Cover、缓存和资源归零证据 |
| T041 | 13 | `T041-browser-verification.json`, `T041-webgpu-timeline.json`, `T041-webgl2-timeline.json`, `T041-*-initial.png`, `T041-*-interaction.png`, `T041-*-pitch60.png`, `T041-*-slow-network.png` | 真实 Chromium WebGPU/强制 WebGL2、慢网取消、缓存命中、失败冷却、60 秒交互和 dispose 验证 |
| T043 | 1 | `T043-cutover-deletion.json` | NTE 生产入口切换、旧运行时删除、import guard 与类型/测试证据 |
| T042 | 4 | `T042-production-browser.json`, `T042-webgpu-initial.png`, `T042-webgl2-initial.png`, `T042-production-runner.mjs` | 生产入口双后端人工验收复跑；最新证据通过初始化、连续交互、pitch 矩阵、缓存回访和 dispose 验证 |
| T045 | 5 | `T045-nte-initial-coverage-analysis.json`, `T045-production-browser.json`, `T045-webgpu-initial.png`, `T045-webgl2-initial.png`, `T045-production-runner.mjs` | Bootstrap/Exact 初始覆盖修复的 LOD 回归、生产 WebGPU/WebGL2 smoke 和首屏截图；双后端 ready 且目标区域覆盖完整 |
| T046 | 5 | `T046-lifecycle-audit.json`, `T046-scheduler-churn.json`, `T046-scheduler-cap.json`, `T046-lifecycle-audit.test.ts`, `T046-production-browser.json` | 生命周期引用/回收、连续请求复用、moving active cap、Fetch 取消/超时和真实双后端停止收敛证据；最新真实 KYE 复跑通过 |

## 当前高风险证据

- T021/T023/T025 的自动证据与人工体验冲突，后续瓦片任务必须同时追踪逐帧 timeline 和人工验收。
- T010/T016 资源证据显示 128 MiB CPU cache 预算虽通过但余量极小，任何预取或 retained cache 改动都必须重新核对资源。
- T010 long task trace 是当前 pan/zoom 卡顿风险的重要入口；优化卡顿时优先读取 `T010-longtask-trace.json` 与相关运行脚本。
