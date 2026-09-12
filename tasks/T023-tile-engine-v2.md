# T023 Replace Custom Tile Runtime with TileEngineV2

## Goal

建立独立的 `TileEngineV2`，替换当前自研 Tile Runtime 的生产调度与显示路径。V2 只借鉴 MapLibre/deck.gl 已验证的状态机、best-available、parent/child retain、请求优先级和缓存规则，不引入完整第三方地图 Runtime；现有 KYE Source、Worker protocol、Polygon/Line batch 和 Three.js WebGPU/WebGL2 GPU 上传继续复用。

本任务针对 T021 人工验收暴露的架构级问题：连续 pan/zoom 时加载延迟、运动期间缺少有效预加载、Tile 逐块出现、停止后才集中显示以及白闪/背景空洞。目标是一次性建立可解释、可维护且没有旧新调度双轨的 Tile Engine 边界。

## Task Context Packet

### Must Read

- `AGENTS.md`
- `docs/project-state.md`
- `TASKS.md`（只读 T021、T023、T024、T025、T026、T027、T028）
- `tasks/T023-tile-engine-v2.md`
- `KNOWLEDGE.md`
- `docs/knowledge/tile-runtime.md`
- `docs/knowledge/performance.md`
- `docs/architecture/index.md`
- `docs/architecture/tile-system.md`
- `docs/decisions/index.md`
- `docs/decisions/D031-tile-system-reset-and-ai-context-isolation.md`
- `docs/evidence/index.md`
- `docs/ai-session-log.md`

### Read If Needed

- `docs/ai-sessions/2026-09-12.md`：需要追溯人工体验失败和冻结 V2 路线时读取。
- `docs/evidence/T023-*`、`docs/evidence/T024-browser-regression.json`、`docs/evidence/T025-browser-regression.json`：只在解释自动证据局限时按文件读取。
- `tasks/T024-tile-engine-v2-render-transaction.md`、`tasks/T025-tile-engine-v2-motion-scheduling.md`：只在复盘 V2 已完成补丁时读取。

### Allowed Files

- `tasks/T023-tile-engine-v2.md`
- `TASKS.md`
- `PROJECT.md`
- `KNOWLEDGE.md`
- `docs/project-state.md`
- `docs/knowledge/tile-runtime.md`
- `docs/knowledge/performance.md`
- `docs/ai-session-log.md`
- `docs/ai-sessions/YYYY-MM-DD.md`

### Forbidden Files

- `packages/map3d/src/runtime/tileEngineV2*.ts`
- `packages/map3d/src/runtime/tileRuntime*.ts`
- `packages/map3d/src/runtime/displayCoverage*.ts`
- `packages/map3d/src/spatial/tileMotionScheduler.ts`
- `packages/map3d/src/spatial/tileCoverage*.ts`
- `packages/map3d/src/spatial/mixedLodTile*.ts`
- `packages/map3d/src/rendering/**`
- `docs/evidence/` 全量目录
- `docs/knowledge/full.md` 默认全文

### Required Evidence

- 当前 BLOCKED 状态下仅允许治理检查：`pnpm ai:check` 与 `git diff --check`。
- 若要重新打开本任务，必须由决策会话解释为何不执行 T028，并重写上下文包。

### Stop Conditions

- 需要继续修改 `TileEngineV2`。
- 需要以自动测试或截图覆盖人工体验失败。
- 需要继续 T026/T027 补丁链。

## Scope

- 建立独立的 `TileEngineV2` 内部模块和生命周期，不继续给旧 `TileMotionScheduler`、`DisplayCoverageCoordinator` 或旧 Runtime 调度/显示路径追加补丁。
- 建立明确且正交的状态集合：
  - `Target Coverage`：最新 ViewState 的理想空间目标。
  - `Render Cover`：当前帧实际可显示、必须连续覆盖有效区域的 Tile cohort。
  - `Retained Cache`：预算内保留的 ready/empty/failed terminal record，不因离开当前视口立即释放。
- 复用 `CanonicalTileKey` / `RenderTileKey`、KYE XYZ/MVT Source、T017 mixed-LOD selector、T008 Worker/Fetch 生命周期和 T020 cache 预算语义。
- 引入 best-available 与空间 replacement 不变量：
  - 任意时刻优先保持可显示的 coarse/ancestor cover；exact 未 ready 时不得暴露背景。
  - parent 只有在空间等价 replacement children 全部 ready、资源可见且能在同一帧提交后才退出。
  - replacement 以 cohort/rAF 边界提交，禁止 Tile 到达即逐块改变画面。
  - same-zoom pan、retained cache hit 和已显示 exact 直接显示，不重新淡入。
- 引入可解释的请求调度：`coverage-critical → best-available fallback → visible refinement → leading prefetch`；运动中不得无条件关闭所有有效预取，预算压力时按高低水位抑制低优先级工作。
- 统一处理 generation、stale completion、取消迟滞、失败 fallback、离线恢复、预算淘汰、`dispose()` 和重复初始化；任何迟到 Fetch/Worker/upload 结果都不得挂载到过时 Render Cover。
- 保持 Render instance、display material 和 GPU resource 的稳定复用；不因 render key 短暂离开/回归而反复 clone、dispose 或触发材质管线更新。
- 将 V2 接回现有 Three.js Render adapter、Material Registry、MapOrigin、Layer recipe、Map3D 0.1 公共 API 和 WebGPU/WebGL2 后端；生产路径只能有一套调度/显示 authority。
- 在切换点隔离或删除旧生产路径，保留旧实现仅用于迁移期间的代码审计/回滚记录，不允许旧新调度同时消费同一 Map3D 实例。

## Non-Goals

- 不引入完整 MapLibre、deck.gl、Cesium 或其他第三方地图 Runtime 作为运行时依赖；只采用其公开、可验证的规则和状态机思想。
- 不改变 MVT 数据格式、KYE URL/鉴权语义、Worker protocol v1、Polygon/Line geometry、Three.js 版本、WebGPU/WebGL2 后端或 Map3D 0.1 公共 API。
- 不新增公开 scheduler、cache、transition、prefetch 或 velocity API；内部状态和诊断保持私有。
- 不在本任务实现文字、Raster、Terrain、Globe、Picking、业务 Overlay、跨 Tile 合批或完整 Style v8。
- 不实现 T022 的 fogStart/fogEnd/loadCutoff；V2 必须提供可供 T022 接入的有效 Coverage 边界，但雾效本身另行完成。
- 不执行旧 Runtime 与 V2 的 A/B 对比来判断问题是否存在；验收以绝对行为、自动证据和真实浏览器人工观感为准，基线数据只用于回归门槛和资源安全检查。
- 不通过提高默认 Fetch/Worker 并发、Tile/cache 预算、降低 Coverage 或延长无限 outgoing retention 掩盖调度/替换错误。

## Inputs

- D015/D016：Canonical/Render TileKey、Tile lifecycle、Worker ownership 和 generation 约束。
- D027/D028/D029：mixed-LOD Coverage、Retained Cache、空间替换和高倾角有效边界。
- D030：独立 TileEngineV2 迁移决策。
- T008/T009：现有 Fetch、Worker、Render adapter、GPU upload、资源销毁和 Map3D 接线。
- T017：Frustum/SSE mixed-LOD Target Coverage。
- T020：预算内 Retained Cache、cache hit、warm ancestor suppression 和请求诊断。
- T021：空间 replacement 实现及其人工验收失败证据；该任务的代码和问题记录是 V2 的输入，不是继续修补旧路径的理由。
- `docs/research/tile-lod-scheduling.md`：MapLibre/deck.gl 的公开调度与 best-available 事实。

## Constraints

- V2 的状态机、集合边界和提交顺序必须可由纯测试和诊断事件解释；不得把显示状态、缓存保留和网络状态重新耦合成一个万能 Manager。
- `Render Cover` 必须覆盖当前有效 Target 区域；任何 fallback/parent 退出都要有空间等价的 ready replacement cohort。
- 同一 canonical key 只能有一个在途 Fetch/Worker generation；多个 world wrap 继续共享 canonical 数据并拥有独立 Render instance transform。
- GPU upload 完成前不得进入 Render Cover；Render Cover 提交必须在同一 rAF/cohort 边界完成，避免逐 Tile 视觉抖动。
- WebGPU/WebGL2 继续使用相同 Three.js/TSL/Node Material 路径；不新增独立 GLSL/WGSL 或后处理。
- 默认 CPU 128 MiB、GPU 256 MiB、256 canonical entries 和现有并发上限不因“修复”自动提高；若确需改变，必须返回决策会话形成新决策。
- 任何新增依赖必须单独说明职责、许可证、bundle 影响和替代方案；MapLibre/deck.gl 不作为直接依赖。
- 源文件以 500 行为上限目标，状态机、集合、调度、提交和诊断按单一职责拆分。

## Acceptance Criteria

- 连续 pan/zoom/bearing/pitch（含 1500 ms 网络延迟）期间始终显示 best-available 内容；运动未结束时即可看到覆盖推进，不再出现“停下来后才开始显示”的集中补齐。
- 新视区在 exact 未 ready 时保持 coarse/ancestor Render Cover；停止前后无明显白闪、背景空洞、旧层级回挂或整片重新淡入。
- same-zoom pan、retained cache hit 和已显示 exact 无淡入；parent/child replacement 只有在空间 cohort 完整 ready 后按同帧边界提交，部分 child 到达不得导致局部闪烁。
- 请求和队列诊断能证明 coverage-critical、fallback、refinement、leading prefetch 的优先级顺序；运动期间不出现无预算压力原因的 prefetch 全部归零。
- stale generation、取消迟滞、失败 fallback、离线恢复、预算淘汰、重复 `initialize()`、`dispose()` 和迟到 Worker/upload 均有确定性行为和针对性测试。
- Render instance/material create、detach、reuse、dispose 和 pipeline update 计数稳定可解释；render key 短暂变化不会造成持续 clone/dispose 抖动。
- 生产 Map3D 路径不再引用旧 `TileMotionScheduler`、旧 Display Coverage 调度/显示 authority；不会出现双调度、重复 Fetch 或两个 Cache 同时拥有同一 Tile。
- WebGPU、强制 WebGL2、reduced-motion、离线失败 fallback/恢复、标准与超宽 viewport、三轮 create/dispose 的真实浏览器回归通过；控制台无未说明 warning/error。
- `pnpm --filter @nova/map3d typecheck`、`pnpm --filter @nova/map3d test`、`pnpm check` 和必要的构建/资源诊断通过；最终 pan/zoom 加载观感必须由人工负责人在真实浏览器中接受，截图不能替代观看和操作。

## Test Plan

- 状态机与集合纯测试：Target/Render/Retained 分离、generation 单调性、cohort 完整性、parent/child 空间覆盖、world wrap、same-zoom no-fade。
- 调度 fake clock：coverage-critical/fallback/refinement/leading-prefetch 顺序、运动中预取、预算压力、高低水位、取消迟滞、队列 age 和 starvation。
- Controlled Source/Worker/Render adapter：延迟响应、部分 child ready、stale completion、失败/恢复、cache hit、GPU upload cohort、instance/material reuse 和 dispose 计数。
- KYE fixture/package integration：canonical 请求去重、Worker protocol v1、Polygon/Line batch、Three.js upload 与现有 stats/events 接线。
- 真实 Chromium：WebGPU 与强制 WebGL2；连续 pan、same-zoom pan、rapid return、连续 zoom、bearing/pitch 60、1500 ms 延迟、reduced-motion、offline/recovery、节点失败和超宽 viewport。
- 诊断证据：逐帧 Target/Render Cover、cohort commit、request reason/priority、cache hit/eviction、CPU/GPU bytes、Tile/object/batch 数、Worker/upload/帧时间和控制台日志。
- 完成后执行 `rg`/依赖图检查旧调度 authority 是否仍进入生产路径；不以旧 Runtime A/B 作为体验结论，只保留资源、接口和发布回归门槛。

## Status

BLOCKED

## Findings

- 2026-09-11：实施会话已按仓库治理顺序恢复上下文并启动 T023；迁移保持 Map3D 0.1、Worker protocol v1、Three.js GPU ownership、默认并发与 cache 预算不变，生产切换目标为单一 TileEngineV2 authority。
- 2026-09-11：T021 自动测试和浏览器脚本通过，但人工负责人明确反馈 pan/zoom 仍慢、停下后才出现 Tile、缺少预加载、Tile 逐块出现并伴随白闪；T021 保持 `VERIFYING`，不能作为发布质量完成。
- 2026-09-11：代码已确认问题横跨运动调度、Target/Display 提交时序、fallback 空间覆盖、cache 生命周期和材质/实例复用，不是单个淡入时长或并发参数可以可靠修复的局部缺陷。
- 2026-09-11：具体代码证据包括：运动中旧 `tileMotionScheduler.ts` 关闭普通预取并只保留有限 leading prefetch，refinement 延迟 180 ms；旧预算默认 Fetch 8/Worker 4；`tileRuntime.ts` 在单个 Tile upload 后立即同步提交显示，未形成同帧 cohort；`displayCoverage.ts` 在 exact/ancestor 尚未 ready 时可能暂时暴露背景；`materialRegistry.ts` 的 Polygon/Line depth test/write 关闭会放大 parent/child 透明叠加的白闪风险。V2 必须从状态集合、调度和提交边界同时解决，而不是只调淡入或并发。
- 2026-09-11：MapLibre/deck.gl 研究提供可借鉴的 best-available、parent/child retain、优先级调度和缓存规则；项目选择复用规则而不是导入完整 Runtime，详见 D030。
- 2026-09-12：`TileEngineV2` 已落地为 `runtime/tileEngineV2.ts`，请求生命周期、状态/预算处理、调度和显示协调分别由 `tileEngineV2Requests.ts`、`tileEngineV2State.ts`、`tileEngineV2Schedule.ts`、`tileEngineV2Display.ts` 和 `tileEngineV2DisplayCoordinator.ts` 承担；`tileEngineV2.ts` 已从 772 行拆分至 524 行。V2 明确维护 Target Coverage、Render Cover、Retained Cache，统一 coverage/refinement/leading-prefetch/ordinary-prefetch 优先级，保留取消迟滞、generation、失败恢复、预算淘汰、same-zoom/cache-hit no-fade 和 parent/child cohort 提交规则。
- 2026-09-12：`Map3D.ts` 已切换为直接实例化 `TileEngineV2`；生产入口不再实例化 `TileMotionScheduler`、旧 `DisplayCoverageCoordinator` 或旧 `TileRuntimeDisplayBridge`。`runtime/tileRuntime.ts` 仅保留 `TileEngineV2 as TileRuntime` 兼容导出，旧实现文件不再拥有生产调度/显示 authority。
- 2026-09-12：自动验证通过：`pnpm --filter @nova/map3d typecheck`；`pnpm --filter @nova/map3d test`（34 个测试文件、171 项测试）；`pnpm check`（SDK/Playground typecheck、test、production build）。
- 2026-09-12：真实 Chromium 已验证 WebGPU、强制 WebGL2、真实 KYE、1500 ms 延迟、高 pitch 和连续平移；V2 在运动期间保持 best-available mixed-LOD 覆盖（代表性状态 `visible=128`，z13/z14/z15 混合），控制台 warning/error 为 0，dispose 后 Tile/resource/worker 统计归零。该证据用于进入人工验收，不替代人工负责人实际 pan/zoom 观看。
- 2026-09-12：人工负责人验收不通过。实际体验仍为 pan/zoom 加载滞后、运动停止后继续请求并从中心向外补齐、高层级 refinement 集中出现、初始化水波式逐块加载和白闪；该结论覆盖 V2 的核心验收标准，T023 不得标记 `DONE`。
- 2026-09-12：代码审计确认失败具有确定性根因：`TILE_ENGINE_V2_REFINEMENT_DEBOUNCE_MS=180` 将 refinement 闸门推迟到最后一次运动后；`commitCohort()` 仍同步调用 `#synchronizeCoverage()`，没有 rAF/上传收集窗口；请求与显示均按 `screenDistance`、8 Fetch/4 Worker 产生中心优先扩散；初始无 active/outgoing 时不请求 fallback；`tileCoverage.ts` 将 visible 与 prefetch 共用 `maxTiles=128`，visible 接近上限时预加载预算近似归零。
- 2026-09-12：T024/T025 完成后人工负责人仍报告体验极差、低帧率和 pan 卡顿。D031 已确认冻结 T026/T027 补丁链，后续先执行 T028 瓦片子系统重置与 AI 上下文隔离。

## Open Issues

- 人工负责人已在真实浏览器中明确不接受连续 pan/zoom 的加载观感；当前不能仅凭自动测试、截图或脚本将 T023 标记 `DONE`。
- T023 保持 `BLOCKED`；T024/T025 作为失败路线中的局部证据保留，不再导向 T026/T027。
- `TILE_ENGINE_V2_REFINEMENT_DEBOUNCE_MS`、同步伪 cohort 提交、中心优先排序和 visible/prefetch 共用预算等旧阻断只作为 T028 的失败输入，不再作为继续打补丁的实施清单。
- 旧 `spatial/tileMotionScheduler.ts`、`runtime/displayCoverage.ts` 和 `runtime/tileRuntimeDisplay.ts` 仍保留在仓库中供兼容测试/审计使用；它们不进入 `Map3D` 生产路径。是否删除或归档由后续决策会话单独决定。
- T022/T019 必须在 T028 完成并确认新瓦片路线后重新规划。
