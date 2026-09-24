# T047 交互流畅度硬化：回访零请求、GPU 池常驻、材质槽位化

Owner: AI 实施会话
关联决策：2026-09-23 用户批准三项（原文摘录）

> "批准你开始。池预热：池按工作集常驻，新瓦片永远从池取、池空才按帧预算扩容 → 稳态 GPU 对象创建趋 0。不改公共 API，成本最低。材质槽位化：材质唯一 + 状态按槽位索引（线宽/虚线/裁剪表进静态 storage buffer），逐 draw 只切 stencilRef → 绑定组/管线恒定。触及渲染架构。修复回访缓存（cacheRevisitNoFetch）：命中判定的键/时效有问题，回访必须零请求。"

## 背景事实（T046 实测）

- 60 秒验收 `passed:false`：P95 8.4ms、P99 14.4ms、Max 37.6ms、`minWindowFps` 123.98、`cacheRevisitNoFetch:false`。
- 37 个 1 秒窗口中仅 4 个低于 160fps，全部位于 `beijing-to-shanghai` 长距离飞行与一次 pan 峰值段。
- 长帧无脚本归因且 `blockingDuration=0`：停顿在 GPU 侧；每新瓦片创建约 30 个 GPUBuffer；缓存未发生淘汰时几何池 `poolSize=0`、`releases=0`，池一直空转。

## Scope

1. 回访缓存零请求：修正命中判定键与时效，使已缓存视图的回访不产生任何网络请求（对应断言 `cacheRevisitNoFetch`）。
2. GPU 几何池常驻：池按可见工作集规模预热并常驻，新瓦片优先从池获取；池空时按帧预算扩容，稳态下新瓦片 GPU 对象创建趋 0。
3. 材质槽位化：渲染材质全局唯一，线宽/虚线/建筑裁剪表改为按槽位索引的静态 storage buffer，逐 draw 仅切换 `stencilRef`；绑定组与管线数量在交互期恒定。

## Non-Goals

- 不引入 Worker 离屏渲染。
- 不引入固定步长相机积分或独立帧预算调度器。
- 不恢复瓦片淡变（如需恢复必须另行决策）。
- 不修改公共 API 与 `Map3DOptions` 语义；不改变覆盖率与 LOD 选择结果。

## Task Context Packet

### Must Read

- `AGENTS.md`
- `docs/project-state.md`
- `TASKS.md`（T047 行）
- `tasks/T047-interaction-smoothness-hardening.md`（本文件）
- `KNOWLEDGE.md`、`docs/knowledge/performance.md`
- `tasks/T046-tile-system-full-lifecycle-repair.md`（Findings 与 Open Issues）

### Read If Needed

- `docs/evidence/streaming-rebuild/smoothness-*.json`、`acceptance-60s.json`
- `docs/knowledge/streaming.md`（缓存键与覆盖语义）
- `docs/architecture/` 与 `docs/decisions/` 中与渲染资源、瓦片缓存相关的分片

### Allowed Files

- `packages/map3d/src/streaming/**`
- `packages/map3d/src/rendering/**`
- `packages/map3d/test/streaming*.test.ts`、`packages/map3d/test/pipeline.test.ts`、`packages/map3d/test/fillSurface.test.ts`、`packages/map3d/test/renderCover.test.ts`
- `apps/playground/src/smoothnessBenchmark.ts`
- `scripts/smoothness-probe.mjs`、`scripts/acceptance-60s.mjs`

### Forbidden Files

- `packages/map3d/src/globe/**`、`packages/map3d/src/labels/**`、`packages/map3d/src/interaction/**`（除为槽位化必需的最小改动，且需先说明原因）
- `docs/architecture.md`、`docs/decisions.md` 全文（只按索引读相关分片）
- 任何未在 Allowed Files 中列出的包或应用源码

### Required Evidence

- `pnpm --filter @kmap/map3d typecheck`、`pnpm check`、`pnpm ai:check`、`git diff --check` 输出。
- 离线回归：受影响测试文件全绿。
- 真实输入探针报告：`docs/evidence/streaming-rebuild/smoothness-T047-*.json`（含每帧 GPU 对象创建计数与落帧归因）。
- 60 秒验收：`docs/evidence/streaming-rebuild/acceptance-60s-T047.json`，需 `passed:true`、`stable160fps:true`、`motionFrameP95/P99:true`、`cacheRevisitNoFetch:true`。
- 视觉抽样截图与 `pixelAudits` 结果，确认槽位化后无残留几何与覆盖缺口。

### Stop Conditions

- 材质槽位化需要改变公共 API、覆盖语义或 LOD 选择结果。
- 池常驻内存超出 `maxGpuBytes` 预算且无法通过池上限约束收敛。
- 真实输入探针出现覆盖缺口、视觉残留或网络错误。
- 验收断言与人工观感冲突。

## 实施顺序与验收

1. 回访缓存零请求（缺陷修复，先做）：命中键与时效修正 + 回归测试 + 回访阶段的请求计数证据。
2. GPU 池常驻（不改公共 API）：预热策略 + 扩容预算 + GPU 对象创建计数证据。
3. 材质槽位化（架构项）：唯一材质 + 槽位状态缓冲 + 绑定组/管线数恒定证据。

## Findings

- 2026-09-23 启用了验收脚本的请求归因能力：`scripts/acceptance-60s.mjs` 支持 `--out` 指定证据文件名，并以 1 Hz 采样条目集合，输出 `revisit` 字段（cache-B → cache-A-return 窗口内的 fetch 事件、key 来源分类与 starts/evictions 前后值）。
- 回访请求的实测归因（`acceptance-60s-T047.json` 的 `revisit` 与 `samples`）：窗口内请求的 key 在窗口前全部 `absent`，且 60 秒会话中它们从未在缓存里长期驻留；请求集中在 setView 跳变后的第一帧。
- 根因（主）：`predict()` 用 `dt = now - lastPlan` 作为速度窗口。静置后 `setView` 跳变时该值很小，位移被放大成"几十公里外的运动"，预测预取随即请求视口外 4～7 列的瓦片（回访窗口的 8～10 个请求即为这些视口外 key）。
- 根因（次）：短时间失去需求的条目不设保护地走淘汰与流水线释放路径（`makeRoom`、`pump` 的 queued/upload 清理），高 pitch 与低 pitch 视图切换（cache 阶段）会把对侧视图刚用过的瓦片淘汰，回访需要重载。
- 根因（次）：空响应（`empty=true`）只标记条目，条目淘汰后"该区域已确认无内容"的事实丢失，`fallbackDemand` 的 `empty()` 判据随之失效，空区域会再次走祖先回退。
- 已实施并验证的修复（步骤 1，全部保留）：
  1. `engine.predict()` 增加跳变判定（单帧跨越 >0.75 瓦片、>0.25 级缩放、>3° 旋转或 >5° 倾角时不外推），跳变不再产生视口外预取；
  2. `tileStore` 增加已确认空登记（`resolvedEmpty`/`markEmpty`/`isEmpty`），条目淘汰后登记保留；`engine` 的覆盖重解判定与 `fallbackDemand` 的空判据改查该登记；
  3. `makeRoom` 两轮淘汰（第一轮跳过 8 秒内仍有需求的条目，第二轮兜底）与 `pump` 的 queued/upload 释放、fetching 中止共用同一保护窗口（`REVISIT_PROTECT_MS`）。
- 回访零请求已达成：`acceptance-60s-T047.json` 中 `cacheRevisitNoFetch:true`，回访窗口 fetch=0、starts 1963→1963。
- 步骤 2（GPU 池常驻）已实现"池预热 + 容量择优 + 每帧预算扩容"并实测，**随后回退**：
  - 收益：拖拽阶段 GPUBuffer 创建与未预热基线持平（480/1426 帧），轮盘缩放 1725/755 帧，无额外收益；原因是稳态工作集由"新进瓦片"构成，池内没有容量匹配的空闲几何；
  - 代价：预热几何破坏 `writeAttribute` 的"直接接管 Worker 数组"零拷贝路径，出现 `computeBoundingSphere` NaN 警告（预热前后验收对比：预热前 0 次、预热后 10 次），并出现 `targetMissing` 类断言退化（`cityArrivalsReady`/`noExtremeOverzoom` 曾失败，收敛预热后恢复）；
  - 结论：在"固定绘制槽位 / 有界预分配缓冲与稳定绑定"落地前，单独做几何池预热无法降低稳态 GPU 对象创建，且引入回归风险。证据：`smoothness-T047-pool.json`（预热实验）与 `smoothness-T047-final.json`（回退后）。
- 步骤 3（材质槽位化：唯一材质 + 槽位静态 storage buffer + 逐 draw 仅切 stencilRef）**未实施**：需要 Three WebGPU 后端的管线/绑定/动态 stencil 行为核验与渲染资源生命周期重构，属 T046 Open Issues 已标注的核心渲染架构变更。
- 性能断言现状（真实 Chromium headless Edge + WebGPU，1600×900）：`motionFrameP95 8.4ms`、`motionFrameP99 16.6ms`、`minWindowFps 103`，`stable160fps/motionFrameP95/motionFrameP99/passed` 未达标；与之对照 T046 基线为 P95 8.4、P99 14.4、minWindowFps 123.98。探针 `smoothness-T047-final.json` 中拖拽/滚轮/旋转 P95 均为 4.3ms、P99 ≤4.7ms、long task 0，仅落帧归因显示慢帧无脚本占用（cpu/engine/label/render 峰值合计 <40ms 中的主要等待在 GPU/合成侧）。

## Open Issues

- 160fps 与 P95/P99 断言未达标：慢帧无脚本归因，属每瓦片首次上屏的 GPU 侧资源创建与准备（约 30 个 GPUBuffer、15–25ms GPU 时间）。消除路径为"固定绘制槽位 / 有界预分配缓冲与稳定绑定 + 唯一材质与槽位状态缓冲"，需决策会话确认后作为独立渲染架构任务执行。
- 几何池预热的可行性边界已记录：无淘汰时池内没有容量匹配几何，预热要么破坏零拷贝路径、要么无收益；若后续继续该方向，需先落地槽位/绑定方案或改为"离开显示的瓦片显式归还几何"。
- 探针 `smoothness-T047-final.json` 中拖拽阶段仍有 1 帧超过 16.7ms（max 29.2ms），与 T046 的残留边界一致。
- 会话期间观测到 `computeBoundingSphere(): radius is NaN` 警告在池预热版本出现、回退后消失；未在最终版本复现，作为池预热回退的依据之一记录。

## 验收状态

- 人工验收结论（2026-09-23，方案 A）：接受现状并结项。回访零请求交付通过；性能类断言不再作为本任务门槛，GPU 槽位化（原步骤 3）移交 T048。
- `cacheRevisitNoFetch`：通过（验收证据 `docs/evidence/streaming-rebuild/acceptance-60s-T047.json`，回访窗口 fetch=0、starts 1963→1963）。
- `passed`、`stable160fps`、`motionFrameP95/P99`：未通过（同证据文件断言列表），由 T048 承接。
- 离线回归：`pnpm --filter @kmap/map3d typecheck` 通过；map3d 全量 189 项测试通过（含新增 `streamingRevisit.test.ts` 3 项）；`pnpm check`、`pnpm ai:check`、`git diff --check` 通过。
- 步骤 2 实验后回退（可行性边界见 Findings）；步骤 3 未实施，移交 T048。

## Status

DONE
