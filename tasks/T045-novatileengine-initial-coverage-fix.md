# T045 NovaTileEngine 初始覆盖细化修复

## Goal

修复生产 NTE 在高 zoom 初始视图下的 Bootstrap Cover 与 Exact Refinement 规划，使首屏计划进入视图对应层级并保持完整覆盖。

## Task Context Packet

### Must Read

- `AGENTS.md`
- `docs/project-state.md`
- `TASKS.md`（只读 T045 行、依赖和当前恢复顺序）
- `tasks/T045-novatileengine-initial-coverage-fix.md`
- `KNOWLEDGE.md`
- `docs/evidence/index.md`
- `docs/evidence/T042-production-browser.json`
- `docs/evidence/T045-nte-initial-coverage-analysis.json`
- `docs/ai-session-log.md`
- `docs/architecture/nova-tile-engine.md`（初始化计划、LOD 与 Render Cover 章节）
- `docs/decisions/D033-nova-tile-engine-plan.md`（初始化、预算和验收门槛）

### Read If Needed

- `docs/verification-baseline.md` 的初始化、LOD、真实浏览器和功能验收章节。
- `docs/evidence/T041-*` 当需要对照隔离 NTE harness 的覆盖与性能证据时。
- `packages/map3d/src/nova-tile/engine.ts` 当需要确认 planner 输出与请求/提交边界时；仅限只读。

### Allowed Files

- `packages/map3d/src/nova-tile/lod/**`
- `packages/map3d/test/novaTileLod*.test.ts`
- `docs/evidence/T045-*`
- `tasks/T045-novatileengine-initial-coverage-fix.md`

### Forbidden Files

- `packages/map3d/src/nova-tile/engine.ts`
- `packages/map3d/src/Map3D.ts`
- `packages/map3d/src/index.ts`
- `apps/playground/**`
- `packages/map3d/src/legacy/**`
- `packages/map3d/src/migration/**`
- 运行时依赖配置文件
- `docs/records/**`

### Required Evidence

- 生产形态 `minZoom=0`、`maxZoom=17`、`zoom=15`、默认阈值的 LOD 回归测试。
- Bootstrap zoom 按 D033 规则计算为 `floor(view.zoom) - 2` 并按 source 边界裁剪的测试。
- 初始计划进入 Bootstrap/Exact 细化层级，避免只返回 z=0 根 Tile；覆盖完整、预算有效、相邻层级差值保持 `≤1`。
- 低 zoom、source maxZoom、pitch 0/20/40/60、previous cover 和预算场景回归测试。
- 生产 runner 的 WebGPU 与强制 WebGL2 初始 smoke 证据，确认首屏计划不再是 root-only；T042 负责随后完整人工轨迹验收。
- `pnpm --filter @nova/map3d test -- novaTileLod.test.ts`、`pnpm --filter @nova/map3d typecheck`、`pnpm check`、`pnpm ai:check`、`git diff --check`。

### Stop Conditions

- 修复需要修改 `engine.ts`、`Map3D.ts`、公共 API、渲染后端、数据协议、预算或 D033 验收门槛。
- Bootstrap Cover 与预算/完整覆盖无法同时成立。
- planner 输出与 Render Cover 的空间完整性不变量无法通过自动测试确认。
- 生产 smoke 与 planner 单元证据出现冲突。

## Scope

- 修正 `MixedLODPlanner` 的 Bootstrap 层级选择和 SSE 细化评分方向。
- 保持 source 边界、maxZoom、预算、相邻 LOD 约束、完整覆盖和 previous cover 语义。
- 增加生产高 zoom 回归测试与可复现 smoke 证据。

## Non-Goals

- 修改 `Map3D` 公共 API、Three.js 渲染适配器、Worker/Fetch/Cache/Upload 管线或 Playground 入口。
- 调整 D033 已确认的资源预算、渲染后端或人工验收门槛。
- 承担 T042 的完整 pan、zoom、bearing、pitch、停止阶段和 dispose 人工验收。

## Acceptance Criteria

- 生产形态初始 view `zoom=15` 计划包含 Bootstrap/Exact 细化层级，结果不再是单个 z=0 根 Tile。
- 首次计划 `coverageComplete=true`，计划数量位于批准预算内，相邻 Tile 的 LOD 差值 `≤1`。
- 既有 mixed LOD、pitch、budget、previous cover 和 maxZoom 测试保持通过。
- 生产 WebGPU/WebGL2 smoke 记录初始化状态为 ready 且首屏计划包含目标区域；完整体验结论由 T042 重跑产生。

## Status

BACKLOG

## Findings

- 2026-09-13 代码检查确认生产 `zoom=15`、`minZoom=0` 场景从 z=0 根 Tile 开始，当前评分约为 `9.375`，低于默认 `320px` 细化阈值，导致规划器保持 root-only 计划。
- T042 WebGPU 与强制 WebGL2 生产证据均为 `ready`、`visible=1`、`ready=1`、`batches=1`，初始截图为空；证据见 `docs/evidence/T042-production-browser.json` 与 `docs/evidence/T045-nte-initial-coverage-analysis.json`。
- 现有 `novaTileLod.test.ts` 的 7 个测试未覆盖生产高 zoom 与默认阈值组合。

## Open Issues

- 修复完成后必须重跑 T042 生产双后端人工轨迹，并继续复核 T041 已记录的 Worker/WebGPU Upload 性能超标项。
