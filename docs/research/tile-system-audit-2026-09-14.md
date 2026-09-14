# 瓦片系统全量复核事实

复核日期：2026-09-14

## 复核范围

- 生产入口：`packages/map3d/src/Map3D.ts` 中的 `NovaTileEngine`、`ThreeTileRenderAdapter`、Fetch/Worker、Scheduler、Cache、Render Cover、Upload 和 Resource Registry。
- 自动证据：NTE 单元/集成测试、T041 隔离浏览器 harness、T042 生产 Chromium 轨迹、T045 首屏 smoke。
- 真实环境：Windows 目标工作站，Chromium 153，WebGPU 与强制 WebGL2，真实 KYE URL；另有固定 MVT fixture 的可控网络复核。

## 已验证

- T042 生产 Chromium 轨迹中，WebGPU 与强制 WebGL2 首屏均达到 `ready`，初始 `visible=94`、`ready=94`。连续 pan、wheel zoom、bearing、pitch 0/20/40/60 能改变 ViewState，截图中地图保持可见。
- T042 每个动作停止等待 12 秒后仍存在未收敛请求：WebGPU 代表性快照 `queued/fetching=17..37`，WebGL2 `10..32`；该状态触发人工验收阻断。
- T042 资源随轨迹单调累加。代表性 WebGPU 快照从首屏 `resources.objects=730`、`cpuBytes=29,012,200` 增长到回访前 `objects=1,810`、`cpuBytes=63,835,460`；WebGL2 达到 `objects=1,807`、`cpuBytes=62,990,224`。这些资源直到 dispose 才归零。
- `T046-lifecycle-audit.test.ts` 的注入管线复核在视图从 `(0°,0°)` 切换到 `(100°,30°)` 后，Resource Registry entries 从 7 增长到 12，`referencedEntries=0`、`releases=0`，并在 8 entry 上限下产生 `pressureReasons=["entries"]`；隐藏资源在视图切换期间没有释放。
- 同一复核执行 10 次连续 ViewState 更新，管线启动 38 次、观察到 34 次 abort signal，最终 `ready=0`、`inFlight=12`，证明每次更新都会使在途工作失效并阻碍连续运动收敛。
- `T046-scheduler-cap.json` 复核在 moving 阶段连续 10 帧消费 40 个任务后，Scheduler `active=40`；D033 moving Fetch 并发目标为 8。当前调度器限制每帧启动数，运行时活动请求没有阶段并发上限。
- T041 固定 fixture 证据中 `resources.referencedEntries=0`，而已提交 Cover 包含 ready Tile；Resource Registry 引用没有接入 Render Cover 生命周期。

## 代码已确认

- `NovaTileEngine.#refreshRenderCover()` 只更新记录状态和 Cover 签名，没有调用资源的 `setRenderKeys`、`setDisplayOpacity`、`retain` 或 `release`；`ThreeTileRenderAdapter.upload()` 创建的资源加入 Scene 后，正常视图切换路径没有移除入口。
- `NovaTileEngine.#records` 在计划替换时只删除在途记录；ready/committed/retained 且离开目标覆盖的记录保留在 Map 中。`#completeUpload()` 注册资源时 refCount 为 0，资源角色和显示角色没有同步更新。
- `TileCache` 的 ready/empty/negative 结果由引擎以 `role: resident, pinned: true` 写入；引擎没有 resident→warm→cold 降级，也没有消费 `set()` 返回的淘汰键来释放对应 GPU 资源。
- `TileResourceRegistry` 仅在 `advanceFrame()` 处理已被 release 的零引用资源；预算超限只发 pressure 事件，不执行可回收资源选择。引擎当前没有正常路径调用 `release`。
- `RequestScheduler` 只有 `maxStartsPerFrame`，`active` 集合没有 moving/settled 并发限制。引擎每帧可再启动任务，活动 Fetch 数量因此超过架构预算。
- `updateView()` 每次调用递增 `planEpoch`；`#ensureRecord()` 对旧 epoch 的在途记录执行 abort 并删除，即使 canonical key 仍在新目标中。连续 pointer move 会重复取消和重建同一批请求。
- `TileFetchPipeline` 没有请求超时；同一 canonical key 的共享 Promise 采用第一次调用的 AbortSignal。首个消费者取消后，后续消费者仍可能复用已取消或长期挂起的 Promise。
- `MixedLODPlanner` 读取 `GroundFootprint.loadCutoff` 仅用于生成 AABB，Tile 选择没有按 AABB 与 loadCutoff 做终止裁剪；架构要求的 fogStart/fogEnd/loadCutoff 仍未接入生产规划。
- `TileDiagnostics` 的 `gpuResourceCount` 由 timeline 中 upload finish 事件数量近似，不是 Resource Registry 当前可达资源数；target 不完整时 snapshot 的 `blankArea` 会被已有 committed Cover 归零，无法表达目标缺口。

## 待验证

- 修复后真实 KYE 服务的请求取消、超时、重试和节点切换时延；需在在线、慢网、断网恢复和单节点失败场景分别采样。
- WebGPU Worker P95（T041：256.3ms）、WebGL2 Worker P95（46.5ms）和 WebGPU Upload P95（8.6ms）达到 D033 门槛；需结合资源回收和调度修复重新测量。
- pitch 0/20/40/60 在 fogEnd 前完整覆盖、loadCutoff 外停止选择/请求/构建/渲染，以及资源峰值随 pitch 变化的真实证据。
- 连续拖动不松手、快速 zoom 14→16→15、bearing/pitch 拖动、返回 A→B→A 的视觉连续性和请求序列；需包含录屏、截图与逐帧 timeline。

## 未发现

- 当前源码和已读证据中没有发现把 Render Cover、Resource Registry、Cache eviction 与 Scene attach/detach 组成完整闭环的生产实现入口。

## 证据入口

- `docs/evidence/T042-production-browser.json`
- `docs/evidence/T041-browser-verification.json`
- `docs/evidence/T041-webgpu-timeline.json`
- `docs/evidence/T041-webgl2-timeline.json`
- `docs/evidence/T045-production-browser.json`
- `docs/evidence/T046-lifecycle-audit.test.ts`
- `docs/evidence/T046-lifecycle-audit.json`
- `docs/evidence/T046-scheduler-churn.json`
- `docs/evidence/T046-scheduler-cap.json`
