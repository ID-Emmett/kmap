# T032 TilePyramid 与 GroundFootprint

## Goal

实现 XYZ 四叉树关系、地面 Footprint、视锥相交和世界副本计算。

## Task Context Packet

### Must Read

- `AGENTS.md`
- `docs/project-state.md`
- `TASKS.md`（只读 T032 行与依赖）
- `tasks/T032-novatileengine-pyramid-footprint.md`
- `docs/architecture/nova-tile-engine.md`
- `docs/decisions/D033-nova-tile-engine-plan.md`
- `KNOWLEDGE.md`
- `docs/evidence/index.md`
- `docs/ai-session-log.md`

### Read If Needed

- `docs/research/tile-lod-scheduling.md`
- `docs/verification-baseline.md` 的坐标与覆盖章节

### Allowed Files

- `packages/map3d/src/nova-tile/pyramid/**`
- `packages/map3d/src/nova-tile/coverage/**`
- `packages/map3d/test/novaTilePyramid*.test.ts`
- `packages/map3d/test/novaGroundFootprint*.test.ts`
- `docs/evidence/T032-*`

### Forbidden Files

- `packages/map3d/src/legacy/**`
- `packages/map3d/src/migration/**`
- `docs/records/**`

### Required Evidence

- parent/children、邻接、wrap、Y 边界测试。
- pitch 0/20/40/60 的 Footprint 数学测试。
- 视锥与地面相交测试。
- `pnpm ai:check`、目标测试、`pnpm check`、`git diff --check`。

### Stop Conditions

- 坐标语义需要公共接口变化。
- Ground Footprint 无法形成有限边界。

## Scope

- 实现 TilePyramid。
- 实现屏幕采样和地面反投影。
- 输出完整 Footprint、loadCutoff 和 guard band 输入。

## Acceptance Criteria

- 所有有效视图生成有限 Ground Footprint。
- wrap 与日期线场景保持 Canonical key 稳定。
- 高 pitch Footprint 覆盖左右边缘。
- Tile AABB 相交判断可复现。

## Status

DONE

## Findings

- 在 `src/nova-tile/pyramid/` 建立带 source revision 的 TilePyramid，覆盖 parent/children、ancestor、neighbors、Y 边界和 world wrap。
- 在 `src/nova-tile/coverage/` 建立有限 GroundFootprint、pitch 采样、guard band、loadCutoff、Tile AABB 相交和 footprint Tile bounds。
- 新增 9 个空间覆盖测试，pitch 0/20/40/60、边界和 wrap 关系通过。
- `pnpm --filter @nova/map3d typecheck`、目标测试、`pnpm ai:check`、`pnpm check` 和 `git diff --check` 通过。

## Open Issues

无。
