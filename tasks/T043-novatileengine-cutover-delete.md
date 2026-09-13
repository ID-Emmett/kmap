# T043 生产切换与旧代码删除

## Goal

完成 NTE 生产入口切换、运行时旧文件删除、测试清理和依赖边界检查。

## Task Context Packet

### Must Read

- `AGENTS.md`
- `docs/project-state.md`
- `TASKS.md`（只读 T043 行与依赖）
- `tasks/T043-novatileengine-cutover-delete.md`
- `docs/architecture/nova-tile-engine.md`
- `docs/decisions/D033-nova-tile-engine-plan.md`
- `docs/evidence/T042-*`
- `KNOWLEDGE.md`
- `docs/evidence/index.md`
- `docs/ai-session-log.md`

### Read If Needed

- `docs/architecture/index.md` 的当前入口章节。
- `docs/verification-baseline.md` 的构建和生命周期章节。

### Allowed Files

- `packages/map3d/src/nova-tile/**`
- `packages/map3d/src/Map3D.ts`
- `packages/map3d/src/runtime/**`
- `packages/map3d/src/spatial/**`
- `packages/map3d/src/rendering/**`
- `packages/map3d/test/**`
- `docs/evidence/T043-*`
- `tasks/T043-novatileengine-cutover-delete.md`

### Forbidden Files

- `packages/map3d/src/nova-tile/**` 的新模块语义变更
- `packages/map3d/src/index.ts` 公共导出变更
- 运行时依赖配置文件
- `docs/records/**`

### Required Evidence

- 生产入口单一性检查。
- 旧运行时文件删除清单。
- import graph 与测试引用扫描。
- `pnpm ai:check`、`pnpm check`、`git diff --check`。

### Stop Conditions

- NTE 仍需兼容桥接或双引擎运行。
- 删除动作影响公共 API、数据协议或新系统模块。

## Scope

- 将 `Map3D` 生产入口固定到 NTE。
- 删除旧瓦片 runtime、旧 coverage、旧 motion scheduler、旧 streaming 实现和专属测试。
- 删除只服务旧路径的适配器与导出。
- 增加新目录 import guard。

## Acceptance Criteria

- 生产图只有 NTE 一条瓦片路径。
- 旧运行时源码、测试和适配器已删除。
- 新系统模块保持独立编译。
- import guard 和全量测试通过。

## Status

DONE

## Findings

- `Map3D` 生产入口已固定使用 `NovaTileEngine`，渲染、请求、Worker、缓存、资源登记和诊断均通过 NTE 编排。
- 旧 streaming、旧 coverage/motion、旧 Tile Runtime 源码及专属测试已删除。
- `ThreeTileRenderAdapter` 和 horizon fade 已移除对旧 runtime/coverage 类型的依赖。
- `pnpm --filter @nova/map3d typecheck`、Map3D 全量测试通过；import 扫描未发现旧入口引用。

## Open Issues

- 真实 Chromium WebGPU/WebGL2/KYE 人工验收由 T042 继续执行。
