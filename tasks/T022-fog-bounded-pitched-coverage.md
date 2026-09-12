# T022 Implement Fog-Bounded Pitched Coverage

## Goal

在高倾角视角下将远景雾效与 mixed-LOD selector 使用同一有效可见距离，使远景先降低 LOD、再完整融合到背景，并在完全雾化区域之后停止 Tile 选择、请求、构建和渲染。

## Task Context Packet

### Must Read

- `AGENTS.md`
- `docs/project-state.md`
- `TASKS.md`（只读 T022、T019、T028）
- `tasks/T022-fog-bounded-pitched-coverage.md`
- `KNOWLEDGE.md`
- `docs/knowledge/rendering.md`
- `docs/knowledge/tile-runtime.md`
- `docs/architecture/index.md`
- `docs/architecture/tile-system.md`
- `docs/decisions/index.md`
- `docs/decisions/D031-tile-system-reset-and-ai-context-isolation.md`
- `docs/evidence/index.md`
- `docs/ai-session-log.md`

### Read If Needed

- `docs/verification-baseline.md`：需要定义浏览器矩阵时读取。
- `docs/experience-baseline.md`：需要核对远景渐隐和人工体验边界时读取。
- `docs/research/tile-retention-display-fog.md`：需要核对 fog/loadCutoff 背景时读取。

### Allowed Files

- `tasks/T022-fog-bounded-pitched-coverage.md`
- `TASKS.md`
- `PROJECT.md`
- `docs/project-state.md`
- `docs/knowledge/rendering.md`
- `docs/knowledge/tile-runtime.md`
- `docs/ai-session-log.md`
- `docs/ai-sessions/YYYY-MM-DD.md`

### Forbidden Files

- `packages/map3d/src/**`
- `docs/evidence/` 全量目录
- `docs/knowledge/full.md` 默认全文

### Required Evidence

- 当前 BLOCKED 状态下仅允许治理检查：`pnpm ai:check` 与 `git diff --check`。
- 解除阻断后必须重新指定新瓦片路线、fog/loadCutoff 指标、逐帧 coverage 证据和人工验收。

### Stop Conditions

- T028 未完成或新瓦片路线未确认。
- 需要把 fog cutoff 接回已失败 V2 补丁链。
- 需要修改源码或降低 fogEnd 前 Coverage 正确性。

## Scope

- 定义内部共享的 fogStart、fogEnd、loadCutoff 和 guard band；参数随 pitch、zoom、Camera frame 和 viewport 自动推导。
- fogStart 后逐渐降低远景 refinement 需求，使 mixed LOD 在雾区更早保留低层级 parent。
- fogEnd 达到完整背景融合；Tile 包围体完全位于 loadCutoff 外时不进入 Target Coverage。
- loadCutoff 使用空间 guard band、运动方向预测和进入/退出迟滞，避免 fog 边界随 pan、bearing 或 pitch 产生 popping。
- Shader fade、Coverage footprint、selector refinement 和诊断证据共享同一 visibility range。
- pitch 0 保持现有平面 Coverage 和视觉，不新增公开 atmosphere API。

## Non-Goals

- 不实现天空、Terrain、Globe、建筑高度雾、后处理或体积雾。
- 不降低 fogEnd 前的 Coverage 正确性，不用雾掩盖 T020/T021 未解决的请求和替换缺陷。
- 不通过简单缩短 Camera far plane 或任意按 Tile 数量截断 Coverage。
- 不提高 Cache、Fetch 或 Worker 默认预算。
- 不引入完整 Mapbox/MapLibre/deck.gl/Cesium Runtime。

## Inputs

- T015 horizon fade、T017 mixed-LOD selector、T018 motion snapshot 和 T021 spatial replacement。
- T023 TileEngineV2 的 Render Cover、请求调度和有效 Coverage 接入边界。
- D029 高倾角雾效有效 Coverage 边界。
- `packages/map3d/src/rendering/horizonFade.ts`、`materialRegistry.ts`、`spatial/tileCoverage.ts` 和 mixed LOD geometry。
- Mapbox Fog 减少远景 Tile 加载和 Cesium dynamic SSE 的行业参考。

## Constraints

- fogEnd 之前的有效可见地面必须由 selected Tile 或 ready ancestor 完整覆盖。
- loadCutoff 外不产生 Tile 请求；与边界相交的 Tile 保留，不能按 Tile 中心粗暴裁剪。
- guard band 只能用于防止相机运动暴露空白，优先使用 coarse Tile，不允许在完全雾化区域继续深度 refinement。
- WebGPU/WebGL2 继续使用共享 TSL/Node Material。
- 默认效果自动推导并保持确定性；公共 ViewState、Layer 和 renderer API 不变。

## Acceptance Criteria

- pitch 0 的 Coverage、selected zoom distribution 和截图与 T017/T021 基线一致。
- pitch 40/60 时 fogStart 到 fogEnd 平滑增强，fogEnd 后完全融合到背景，不出现硬边、Tile 矩形轮廓或明显 popping。
- Tile 包围体完全超过 loadCutoff 时不进入 Target、Fetch、Worker 或 Render；边界内 Coverage 逐帧完整。
- 与临时禁用 load cutoff 的相同高倾角场景相比，visible/ready Tile、请求数、CPU/GPU bytes 和对象数均形成可解释的下降证据。
- 快速 pan、bearing/pitch、惯性和 1500 ms 延迟下 guard band 不暴露未加载区域，稳定后多余 guard Tile 可按 Cache 规则释放。
- WebGPU、强制 WebGL2、标准与 2555×1385 超宽 viewport 验证通过。
- 针对性测试、`pnpm --filter @nova/map3d test` 与 `pnpm check` 通过，人工负责人接受远景渐隐和加载边界。

## Test Plan

- 纯数学：visibility range 单调性、pitch 0 禁用、Tile AABB 与 loadCutoff 相交、迟滞和 guard band。
- Selector：fog-weighted refinement、数量预算、邻接 LOD 与 effective footprint Coverage sampling。
- 浏览器矩阵：pitch 0/40/60、bearing 0/45/90、16:9/超宽、WebGPU/WebGL2。
- 网络与资源：记录 cutoff 内外 canonical request、Worker/upload、CPU/GPU bytes、对象数和稳定后 Cache。
- 视觉：正常 fog、debug cutoff/coverage overlay 和临时禁用 cutoff 的对照截图或录屏。

## Status

BLOCKED

## Findings

- 2026-09-10：当前 horizon fade 最大 strength 为 0.78，远景不会完全融合到背景；Coverage 仍按 Camera far 生成完整 footprint，因此现有效果不减少 Fetch、Worker 或 Render。
- 2026-09-10：人工负责人确认目标体验为高倾角远处雾效更强，完全雾化区域之后无需继续加载和渲染。

## Open Issues

- fogStart/fogEnd/loadCutoff 的最终默认曲线必须由实现会话形成多视口 before/after 证据并由人工负责人验收，不在 Task 规格中预设固定北京 z15 米数。
- 本任务必须在 T028 完成并确认新瓦片路线后重新规划；不得把 fog cutoff 接回已失败的 V2 补丁链或旧 Runtime 调度 authority。
