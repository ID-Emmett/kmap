# T046 瓦片系统全量生命周期与流式调度修复

## Goal

在保持 `Map3D` 0.1 公共 API、MVT/Worker protocol v1、Three.js WebGPU/WebGL2 和 D033 预算基线不变的前提下，修复 NTE 生产路径的瓦片显示、请求调度、缓存、GPU/CPU 资源回收、倾斜覆盖和诊断闭环。修复后的系统在连续相机运动中持续产生有效请求，在视图离开后回收不可见资源，在停止阶段快速收敛，并通过真实 Chromium 双后端体验与性能验收。

## Task Context Packet

### Must Read

- `AGENTS.md`
- `docs/project-state.md`
- `TASKS.md`（只读 T046 行、依赖和执行顺序）
- `tasks/T046-tile-system-full-lifecycle-repair.md`
- `KNOWLEDGE.md`
- `docs/knowledge/tile-runtime.md`
- `docs/knowledge/performance.md`
- `docs/evidence/index.md`
- `docs/research/tile-system-audit-2026-09-14.md`
- `docs/evidence/T042-production-browser.json`
- `docs/evidence/T041-browser-verification.json`
- `docs/evidence/T041-webgpu-timeline.json`
- `docs/evidence/T041-webgl2-timeline.json`
- `docs/evidence/T045-production-browser.json`
- `docs/architecture/nova-tile-engine.md`
- `docs/decisions/D033-nova-tile-engine-plan.md`
- `docs/verification-baseline.md`
- `docs/experience-baseline.md`
- `packages/map3d/src/nova-tile/engine.ts`
- `packages/map3d/src/nova-tile/scheduler/requestScheduler.ts`
- `packages/map3d/src/nova-tile/fetch/fetchPipeline.ts`
- `packages/map3d/src/nova-tile/fetch/tilePipeline.ts`
- `packages/map3d/src/nova-tile/cache/tileCache.ts`
- `packages/map3d/src/nova-tile/resources/resourceRegistry.ts`
- `packages/map3d/src/nova-tile/render/renderCover.ts`
- `packages/map3d/src/nova-tile/render/coverResolver.ts`
- `packages/map3d/src/nova-tile/upload/uploadQueue.ts`
- `packages/map3d/src/nova-tile/lod/mixedLodPlanner.ts`
- `packages/map3d/src/nova-tile/coverage/groundFootprint.ts`
- `packages/map3d/src/rendering/tileRenderAdapter.ts`
- `packages/map3d/src/Map3D.ts`

### Read If Needed

- `packages/map3d/src/nova-tile/state.ts`、`tileAddress.ts`、`pyramid/tilePyramid.ts`
- `packages/map3d/src/nova-tile/diagnostics/**`
- `packages/map3d/src/interaction/**`
- `packages/map3d/test/novaTile*.test.ts`、`packages/map3d/test/map3d.test.ts`、`packages/map3d/test/tileRenderAdapter.test.ts`
- `docs/evidence/T046-*`
- `docs/research/tile-lod-scheduling.md`、`docs/research/tile-retention-display-fog.md`

### Allowed Files

- `packages/map3d/src/nova-tile/**`
- `packages/map3d/src/Map3D.ts`
- `packages/map3d/src/rendering/tileRenderAdapter.ts`
- `packages/map3d/test/novaTile*.test.ts`
- `packages/map3d/test/map3d.test.ts`
- `packages/map3d/test/tileRenderAdapter.test.ts`
- `apps/playground/src/main.ts`
- `docs/evidence/T046-*`
- `docs/research/tile-system-audit-2026-09-14.md`
- `tasks/T046-tile-system-full-lifecycle-repair.md`
- `TASKS.md`
- `PROJECT.md`
- `KNOWLEDGE.md`
- `docs/project-state.md`
- `docs/evidence/index.md`
- `docs/ai-session-log.md`
- `docs/ai-sessions/YYYY-MM-DD.md`

### Forbidden Files

- `packages/map3d/src/legacy/**`
- `packages/map3d/src/migration/**`
- `packages/map3d/src/index.ts`（公共导出）
- `package.json`、`pnpm-lock.yaml`、workspace 依赖配置和运行时依赖版本
- `docs/architecture/**`、`docs/decisions/**`（需要改变批准架构时先返回决策会话）
- `docs/records/**`

### Required Evidence

- 自动回归：生命周期状态转换、Render Cover 引用计数、Render instance attach/detach、transition 延迟释放、Cache role/pin/eviction、Resource Registry budget、Fetch timeout/abort/dedupe、Scheduler active cap、plan epoch 复用、Upload backpressure、fog-bounded Coverage 和 diagnostics schema。
- 固定 fixture 集成：连续 ViewState 更新期间仍能完成新目标请求；过时结果不提交；停止后队列、活动 Fetch、Worker、Upload 和 transition 在有界时间内归零；A→B→A 命中 retained cache 且不重复请求。
- 资源证据：每个视图变更前后 `entries/refCount/cpuBytes/gpuBytes/objects/batches`，淘汰和 `dispose` 回调计数，3 次 create/initialize/交互/dispose 后全部归零且每个资源只释放一次。
- 调度证据：moving Fetch active≤8、settled active≤12、Worker≤4；连续拖动 1500ms 期间每个目标覆盖变化均产生请求或命中缓存；停止 1s 后不再启动新请求，2s 内进入 idle（固定 180ms 慢网 fixture）。
- 真实 Chromium：Windows 目标工作站、稳定 Chromium，WebGPU 与强制 WebGL2；真实 KYE URL 执行连续拖动不松手、快速 pan、wheel burst、bearing/pitch、pitch 0/20/40/60、超出预取环、停止等待 12s、A→B→A 回访和 60s 交互。采集录屏/截图、Network/CDP 请求序列、逐帧 NTE timeline、Chrome performance trace、Frame/Worker/Upload P95、输入响应和 CPU/GPU/Scene 资源。
- 运行门禁：`pnpm --filter @nova/map3d test`、`pnpm --filter @nova/map3d typecheck`、`pnpm check`、`pnpm ai:check`、`git diff --check`。

### Stop Conditions

- 修复需要修改 `Map3D` 0.1 公共 API、MVT/Worker protocol、Three.js 后端、默认 CPU/GPU/Tile/Upload 预算、核心坐标语义或引入运行时依赖。
- Render Cover 完整覆盖与有限资源回收无法同时满足，或资源所有权需要跨 Tile 合批/独立 Object3D。
- 真实 KYE 服务行为无法通过超时、取消和节点切换形成可复现证据，导致验收门槛需要变更。
- 自动测试、固定 fixture、真实 Chromium 画面或人工操作结论发生冲突。
- 必须修改 Forbidden Files 或需要扩展 Allowed Files；停止实现并返回决策会话更新范围与上下文包。

## Scope

### A. Render Cover 与资源所有权闭环

- 为每个 Render candidate 维护唯一 resource id 和 render role；`committed`、`outgoing`、`transition`、`upload` 引用分别 retain/release，引用状态在每帧与 Cover 快照一致。
- 将 `setRenderKeys`、`setDisplayOpacity` 接入 cohort commit/transition/advance；只有 committed/outgoing 实例挂载 Scene，替代范围完整且过渡结束后移除隐藏实例。
- 视图离开后将记录从 resident 降级为 warm/cold；在无 display/cache/in-flight 引用且延迟帧到期时从 records、Scene、Resource Registry 和 CPU payload 同步移除。
- 保证 GPU geometry、材质、clone、Group 和 adapter 资源只释放一次；迟到的 Worker/Upload/Fetch 结果不得重新挂载资源。

### B. Cache、预算与回收

- 建立 resident/warm/cold/persistent 的角色同步和独立 pin 位；visible/display pin 不等同于 cache pin。
- 处理 `TileCache.set()` 返回的淘汰键，释放对应 Resource Registry/Render Adapter 资源；预算超限时按批准顺序淘汰可回收项并发出 pressure 诊断。
- 对 ready、empty、negative、retryable 记录执行统一 TTL/冷却与 LRU 访问刷新；保留短距离回访所需的 retained cache，淘汰后不再次提交已失效 payload。
- 资源统计以 Resource Registry 当前可达条目为准，修正 `gpuResourceCount`、objects、CPU/GPU bytes 与 scene attach 数的口径。

### C. 请求与连续运动调度

- 在 Scheduler 增加 moving/settling/settled/idle 的 active concurrency 限制、取消配额和 in-flight 统计；Fetch active 不超过 D033 阶段预算。
- 将 ViewState 变化的 plan epoch 与可复用的 canonical 请求身份分离；同一 canonical key 仍在目标覆盖时复用在途 Fetch/Decode/Build，目标离开后按迟滞策略取消。
- 保持连续 pointer move 的请求机会，不在每次相机采样时 abort/recreate 同一批任务；为新覆盖区域设置可观测的 visible-critical/refinement/lookahead 角色和公平配额。
- Fetch 增加可配置超时、AbortSignal 传播和每消费者取消语义；共享 Promise 的首个消费者取消不会使其他有效消费者永久复用已取消/挂起任务。
- 使 retry/cooldown、stale generation、worker/upload cancel 和 scheduler finish 全部闭环；`whenIdle()` 覆盖 queued/active Fetch、Worker、Upload、transition、prefetch 和维护任务。
- 停止阶段保留有限 refinement tail，禁止停止后新请求波次；请求失败、断网、恢复和 HTTP 204 均保持状态可观测。

### D. Coverage、LOD 与倾斜远景

- 将 `loadCutoff`、fogStart/fogEnd、运动方向 guard band 和迟滞接入 TileCoverPlanner；fogEnd 前保持空间完整覆盖，完全超过 loadCutoff 的 Tile 停止选择/请求/构建/渲染。
- 用相邻区域关系验证 LOD 差值，不以全局层级差替代邻接不变量；预算通过父子合并维持覆盖完整性。
- 保持 exact/ancestor/descendant Cohort 的空间替代原子性，避免中心向外逐块出现、白闪和过时层级回挂；目标缺口与 committed 覆盖在 diagnostics 中分开报告。

### E. 诊断、可复现验证与性能

- 扩展逐帧 timeline：target/committed/outgoing、blankArea、queue active、cancel reason、cache role、eviction/release、scene resources、Fetch/Worker/Upload/Commit 时长与 idle tail。
- 在 Playground/runner 中加入连续拖动不松手、快速 zoom、bearing/pitch、慢网、停止 12s、缓存回访、3 次 dispose 和 pitch 0/20/40/60 的统一脚本；保留 WebGPU/WebGL2 成对截图与 trace。
- 对 T041 已知超标项重新测量：Worker 单 Tile P95≤25ms、WebGPU frame P95≤20ms、WebGL2 frame P95≤25ms、Upload P95≤8ms、输入到下一帧≤50ms；未达标时记录瓶颈并按 Stop Conditions 返回决策会话。

## Non-Goals

- 调整 `Map3D` 0.1 公共 API、MVT/Worker protocol v1、Three.js 渲染后端和 D033 默认预算。
- 引入 MapLibre/deck.gl/Cesium 完整运行时、跨 Tile 合批、Feature 级 Object3D、Terrain/Globe、Picking、Overlay、Raster/Glyph/Sprite 或设备丢失恢复。
- 以降低 Coverage、关闭过渡/渐隐、跳过请求或删除测试作为性能达标方式。

## Acceptance Criteria

- 任意目标视图的 committed Cover 在交互和异步加载期间保持 `coverageComplete=true`、`blankArea=0`；target 缺口单独可观测。
- A→B→A 轨迹中，离开视图的 Tile 在过渡/延迟帧结束后从 Scene 和 Resource Registry 移除；CPU/GPU bytes、objects、batches 不单调增长，cache 命中不产生重复 Fetch。
- 资源 registry 的 `refCount` 与 committed/outgoing/transition 角色一致；每个 GPU/CPU 资源 dispose 恰好一次；三次生命周期循环后请求、Worker、Upload、Scene、Registry、Cache 临时引用全部归零。
- 连续拖动不松手 1500ms 期间，视图中心持续跟手且每次新覆盖变化有请求启动或 cache hit；同一 canonical key 不重复 Fetch/Decode/Build；停止 1s 后无新请求启动，固定慢网 2s 内进入 idle。
- moving/settled active Fetch 分别≤8/≤12，Worker≤4；请求取消、超时、重试、204、失败冷却和 stale 结果均有结构化诊断且无未处理 Promise rejection。
- pitch 0/20/40/60 下近景/中景/远景 LOD 连续；fogEnd 前完整覆盖，loadCutoff 外停止选择、请求、构建和渲染；WebGPU/WebGL2 画面无 Tile seam、白闪、固定截断带和中心向外水波。
- CPU/GPU cache 与 Resource Registry 遵守 128MiB/256MiB、256 entries 预算；压力时保留可见和过渡引用并优先淘汰 cold/warm，pressure 原因可追踪。
- 双后端真实 Chromium 的 Frame、Worker、Upload、输入响应和 60s 资源曲线达到 D033 门槛；所有自动命令、截图、trace、timeline、人工操作结论齐全。

## Status

BACKLOG

## Findings

- 2026-09-14 复核结果详见 `docs/research/tile-system-audit-2026-09-14.md`；当前生产 NTE 具备首屏和基础交互能力，资源回收、在途请求收敛、活动并发限制、Render Cover 资源引用和 loadCutoff 仍缺少闭环。
- T042 真实 Chromium 证据在两后端停止 12 秒后保留 queued/fetching 请求；生产资源对象与字节在多次视图变化后持续增长。
- T046 注入管线审计证明视图切换后 Resource Registry entries 由 7 增至 12、`refCount=0`、`releases=0` 并触发 entry pressure；连续 10 次 ViewState 更新产生 38 次 pipeline run 与 34 次 abort；Scheduler moving active 达到 40。
- T041 固定 fixture 的自动功能和 dispose 断言通过；该证据覆盖模块单测与隔离 harness，不能替代 T046 的生产人工体验和资源回收验收。

## Open Issues

- T041 的 Worker/WebGPU Upload 超标项需要在生命周期与调度修复后重新测量；若仍超标，返回决策会话处理性能方向或门槛。
- 真实 KYE 网络的服务端响应、超时、取消和节点降级需要双后端在线证据；固定 fixture 仅用于确定性回归。
- T042 保持 `BLOCKED`，直到 T046 完成并重跑完整人工轨迹；T044 在 T046/T042 完成后执行发布回归。
