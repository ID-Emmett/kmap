# Nova Knowledge — Tile Runtime

更新日期：2026-09-14

## 空间契约

- SDK 已实现 Float64 Web Mercator、连续 XYZ Tile、MVT Tile 局部米坐标、Canonical/Render TileKey、source zoom/overzoom 和 MapOrigin 纯函数。
- 单元测试覆盖日期线 wrap、Y 越界、相邻 Tile 接缝和浮动原点重定位。
- 证据：`packages/map3d/src/spatial/`、`packages/map3d/test/mercator.test.ts`、`packages/map3d/test/tileKey.test.ts`、`packages/map3d/test/mapOrigin.test.ts`。

## Worker 与状态机

- Worker protocol version 1 已实现 build/cancel/success/error、jobId/generation、1 到 4 个 Worker Pool、stale/dispose 拒绝挂载和 ArrayBuffer transferable。
- Tile 状态机为 `queued → fetching → decoding → building → ready|empty|failed → disposed`；可见性、缓存保留和显示角色保持正交。
- 证据：`packages/map3d/src/worker/`、`packages/map3d/test/workerPipeline.test.ts`、`packages/map3d/test/tileRecord.test.ts`。

## Coverage 与缓存

- T017 已将单层级 visible Tile 枚举与数量硬截断替换为 mixed-LOD 四叉树 selector；使用 Camera Frustum/Tile AABB、projected tile size、best-first refinement、迟滞和邻接连续性。
- T020 已修复 Ready/empty/failed terminal record 的预算内 Retained Cache、cache hit、LRU access 刷新和 warm ancestor suppression。
- 默认预算保持 256 canonical entries、128 MiB CPU、256 MiB GPU。
- 证据：`packages/map3d/test/mixedLodTileSelector.test.ts`、`packages/map3d/test/tileRuntimeCache.test.ts`、`docs/evidence/T017-browser-regression.json`、`docs/evidence/T020-browser-regression.json`。

## TileEngineV2 状态

- D030 曾确认停止扩展旧 Tile Runtime 的调度/显示路径，建立独立 `TileEngineV2` 作为生产 authority；D031 已在人工体验失败后冻结 T026/T027 补丁链。
- T023 已把生产路径切换到 V2，并分离 Target Coverage、Render Cover、Retained Cache、请求生命周期、调度和 display/cohort 模块；自动测试、构建和真实 Chromium 回归通过。
- T024 已加入 rAF/等价帧边界 Render transaction、初始 parent fallback 请求和空间完整 Render Cover 提交。
- T025 已移除 V2 refinement idle-only debounce，加入 coverageRank、deadline/age starvation 和 requestQueue 诊断，证明慢网 pan/zoom 期间确实会启动请求。
- T024/T025 是失败路线中的局部证据，不再构成继续 T026/T027 的默认理由；后续瓦片路线默认执行 T029。
- 证据：`tasks/T023-tile-engine-v2.md`、`tasks/T024-tile-engine-v2-render-transaction.md`、`tasks/T025-tile-engine-v2-motion-scheduling.md`、`docs/evidence/T024-browser-regression.json`、`docs/evidence/T025-browser-regression.json`。

## NovaTileEngine 路线

- D033 已确认 `NovaTileEngine` 的当前契约、模块、预算、验收和 T030-T044 任务链。
- T031-T041 已完成；T043 已完成生产入口切换和旧运行时清理。
- T042 生产人工验收复跑确认首屏空白：生产 `minZoom=0`、初始 `zoom=15` 时，`MixedLODPlanner` 只产生 z=0 根 Tile，默认 SSE 细化阈值未触发。
- T045 已完成初始覆盖细化修复：Bootstrap 使用 `clamp(floor(view.zoom) - 2, minZoom, maxZoom)`，SSE 细化评分按目标层级方向计算；生产高 zoom LOD 回归和 WebGPU/WebGL2 smoke 通过，T042 待重跑完整人工验收。
- 规范：`docs/architecture/nova-tile-engine.md`。
- 决策：`docs/decisions/D033-nova-tile-engine-plan.md`。
- 证据：`docs/evidence/T042-production-browser.json`、`docs/evidence/T045-nte-initial-coverage-analysis.json`、`docs/evidence/T045-production-browser.json`。

## 人工验收失败事实

- T021/T023/T025 的自动测试和真实浏览器脚本不能替代人工体验结论。
- 人工负责人已明确报告：pan/zoom 加载慢、运动期间缺少预加载感、停止后继续出现请求波次、Tile 逐块出现、初始化中心向外水波式加载、白闪仍存在，且页面帧率和 pan 卡顿严重。
- 当前恢复顺序：T045 已完成初始覆盖细化规划修复，随后重跑 T042，再执行 T044。
- 证据：`docs/ai-sessions/2026-09-12.md`、`TASKS.md`、`PROJECT.md`。

## 旧路径隔离

- 旧 `TileMotionScheduler`、旧 Display Coverage authority 和旧 Tile Runtime 显示路径最多作为审计参考，不得进入新的生产实现候选。
- 需要读取或修改旧路径文件时，必须由当前任务的 Allowed/Forbidden Files 明确允许；否则返回决策会话。
