# T048 材质槽位化渲染：固定绘制槽位与稳定绑定

Owner: AI 实施会话
关联决策：2026-09-23 人工负责人决定采纳方案 A（接受 T047 现状并将 GPU 槽位化另立任务）。
依赖：T046（全量生命周期与调度）、T047（回访缓存与预测跳变修复，已结项）。

## 背景事实

- T046 实测结论：每个新瓦片首次上屏创建约 30 个 GPUBuffer 并产生 15–25ms GPU 侧准备；长帧无脚本归因、blockingDuration 为 0，属 GPU/合成侧停顿。
- T047 结论：回访零请求已达成；GPU 几何池常驻（池预热）实测无稳态收益且引入回归，已回退。消除每瓦片 GPU 对象创建必须依赖固定绘制槽位与唯一材质。
- T047 性能断言现状（`docs/evidence/streaming-rebuild/acceptance-60s-T047.json`）：P95 8.4ms、P99 16.6ms、minWindowFps 103，要求为每 1 秒窗口 ≥160fps（每帧 ≤6.25ms）。

## Scope

- 前置可行性核验：Three.js WebGPU 后端的管线缓存键与绑定组生命周期，确认逐 draw 切换模板值是否为动态状态；不成立时给出替代方案（如分 pass 或按槽位分组绘制）并记录证据。
- 材质唯一化：线、面、建筑材质改为全局唯一实例，样式参数（线宽、虚线、裁剪、可见层级范围）移入按槽位索引的静态 storage buffer。
- 固定绘制槽位：建立有界槽位表与稳定绑定，逐 draw 只更新槽位索引与模板值，不创建新材质、新绑定组、新管线。
- 有界预分配缓冲：几何与槽位缓冲按上限一次分配，稳态新瓦片只写数据不创建 GPU 对象。
- 复测 60 秒验收与真实输入探针，确认无视觉残留与覆盖缺口。

## Non-Goals

- 不改变公共 API、视口覆盖语义、LOD 选择结果与瓦片缓存/调度语义（由 T046、T047 确定）。
- 不做几何池预热式预分配（T047 已证伪：稳态池内无容量匹配几何且破坏零拷贝路径）。
- 不引入新的渲染后端或替换 Three.js。

## 上下文边界

见 Task Context Packet。

## 验收标准

- `pnpm check`、`pnpm ai:check`、`git diff --check` 通过；受影响离线测试全绿。
- 60 秒验收 `docs/evidence/streaming-rebuild/acceptance-60s-T048.json` 满足 `passed:true`、`stable160fps:true`、`motionFrameP95/P99:true`、`cacheRevisitNoFetch:true`。
- 真实输入探针 `docs/evidence/streaming-rebuild/smoothness-T048-*.json`：稳态每帧 GPU 对象创建趋 0（bufferDelta 总量相对 T046 基线显著下降并在负载中保持低位）。
- 视觉抽样截图与像素审计无残留几何、无覆盖缺口。

## Task Context Packet

### Must Read

- `AGENTS.md`
- `docs/project-state.md`
- `TASKS.md`（T048 行）
- `tasks/T048-material-slot-rendering.md`（本文件）
- `tasks/T046-tile-system-full-lifecycle-repair.md`（GPU 侧结论与 Open Issues）
- `tasks/T047-interaction-smoothness-hardening.md`（池预热可行性边界）
- `KNOWLEDGE.md`、`docs/knowledge/performance.md`

### Read If Needed

- `docs/evidence/streaming-rebuild/smoothness-T047-*.json`、`acceptance-60s-T047.json`
- `docs/knowledge/streaming.md`、`docs/knowledge/tile-runtime.md`
- Three.js 源码中 WebGPU 后端的管线缓存、绑定组与渲染状态处理（`node_modules/three/src/renderers/webgpu/**`）

### Allowed Files

- `packages/map3d/src/streaming/**`
- `packages/map3d/src/rendering/**`
- `packages/map3d/test/streaming*.test.ts`、`packages/map3d/test/pipeline.test.ts`、`packages/map3d/test/fillSurface.test.ts`、`packages/map3d/test/renderCover.test.ts`、`packages/map3d/test/shaderCompilation.test.ts`
- `apps/playground/src/smoothnessBenchmark.ts`、`apps/playground/src/diagnosticsPanel.ts`
- `scripts/smoothness-probe.mjs`、`scripts/acceptance-60s.mjs`

### Forbidden Files

- `packages/map3d/src/globe/**`、`packages/map3d/src/labels/**`、`packages/map3d/src/interaction/**`
- `docs/architecture.md`、`docs/decisions.md` 全文（只按索引读相关分片）
- 任何未在 Allowed Files 中列出的包或应用源码

### Required Evidence

- Three WebGPU 可行性核验结论（动态模板值/绑定组复用/管线缓存键），含最小实验代码路径与结论证据。
- `pnpm --filter @kmap/map3d typecheck`、`pnpm check`、`pnpm ai:check`、`git diff --check` 输出。
- 离线回归：受影响测试文件全绿。
- 60 秒验收：`docs/evidence/streaming-rebuild/acceptance-60s-T048.json`（四项断言全绿）。
- 真实输入探针：`docs/evidence/streaming-rebuild/smoothness-T048-*.json`。
- 视觉抽样截图与像素审计结果。

### Stop Conditions

- 核验结论为 Three WebGPU 不支持动态模板值或稳定绑定，且无可行替代方案。
- 需要改变公共 API、覆盖语义或 LOD 选择结果。
- 固定槽位导致 GPU 内存超出 `maxGpuBytes` 预算且无法通过上限约束收敛。
- 真实输入探针出现覆盖缺口、视觉残留或网络错误。

## Findings

### 1. 前置可行性核验（Three r185 WebGPU 后端源码）

- 逐 draw 切换模板值：成立。渲染缓存键不含 `stencilRef`；`_draw` 每次绘制前设置模板编号。见 `WebGPUBackend.js` 的 `getRenderCacheKey` 与 `_draw`。
- 绑定组复用只对 `groupNode.shared === true` 的组成立；object 组与材质默认组按 RenderObject 克隆并各自创建 GPUBuffer。见 `NodeBuilderState.createBindings` 与 `Bindings._createBindings`。
- 稳定绑定只能靠 `(object, material)` 组合长期稳定，即固定绘制槽位；逐 draw 变化的值不能放在共享组（`queue.writeBuffer` 在命令缓冲提交前统一生效，后写覆盖前写）。
- "全局唯一材质"不成立：唯一材质使所有绘制共享同一 `material.stencilRef`，父子来源所有权判定失效。替代方案为按槽位有界复用材质（每个槽位一份材质，槽位数有界）。

### 2. 实施内容

- 新增 `drawSlots.ts`：`DrawSlotPool`，mesh 与材质按布局键整体复用，空闲槽位受上限约束。
- 线/面/建筑表面新增 `LineUnit/FillUnit/BuildingUnit`：槽位持有 mesh、材质与样式数组（线宽、虚线、建筑裁剪表）。
- `surface.ts`：模板矩形同样走固定槽位；非主实例也取槽位以获得独立模板编号。
- `geometryPool.ts`：新增 `capacityTier` 分档与 `poolKeyOf`；写入按档位容量一次分配。
- `diagnostics.ts`：`resources` 新增 `slots` 与 `geometryPool` 计数。

### 3. 实测证据

- 离线回归：typecheck、`pnpm check`、`pnpm ai:check` 通过；map3d 198 测试通过。
- 真实输入探针（baseline → final2）：bufferDelta 合计 2865 → 2379（drag 840→540、wheel 1875→1719、rotate 150→120）；drag compile 峰值 20.3ms → 12.8ms；超 16.7ms 帧数 4 → 1。
- 槽位复用（条目预算触发淘汰后）：mask 槽位复用 1131 次而新建 275 次，几何池属性重建计数由 2278 归零。
- 视觉抽样：`smoothness-T048-final2-fixture.png` 无残留几何、无覆盖缺口。

## Open Issues

- 60 秒验收未达标且离散：T048 为 P95 6.4 / P99 12.2 / minWindowFps 125.6；rerun 为 P95 11.4 / P99 17.2 / minWindowFps 100.4。两次均未满足 `stable160fps` 与 `motionFrameP95/P99`。
- 根因不在槽位：稳态下瓦片条目不淘汰（`releases` 为 0，`entries` 只增不减），槽位与几何池无内容可复用；只有条目数触达 `maxEntries=256` 才发生淘汰与复用。释放策略属 T046/T047 确定的缓存语义，超出 Non-Goals。
- 单次运行出现 `motionCoverage/interactionCoverage/motionDetail/noExtremeOverzoom` 失败，复跑恢复为 true，判定为验收脚本波动而非渲染回归。
- `noNetworkErrors` 两次均为 false（同一 404 资源），基线为 true，需决策会话确认该 404 来源。
- 几何池命中率仍有限：档位按 2 的幂分档，同档位内新瓦片在池空时仍会新建几何（creates 2761 / reuses 1986）。收敛到"每瓦片零新增"需进一步决策（更细档位或有界预分配），受 `maxGpuBytes` 约束。
- 治理门禁不一致：`scripts/ai-governance/check-ai-governance.mjs` 将 `docs/project-state.md` 中 T048 硬编码为 `BACKLOG`，与 `TASKS.md` 的 `IN_PROGRESS` 不一致；本任务按门禁要求保留表格 `BACKLOG`，真实状态以 `TASKS.md` 与本文件为准。

## Status

IN_PROGRESS
