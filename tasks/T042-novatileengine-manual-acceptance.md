# T042 NovaTileEngine 人工体验验收

## Goal

完成 NTE 初始化、pan、zoom、bearing、pitch、停止阶段和缓存复用的人工验收。

## Task Context Packet

### Must Read

- `AGENTS.md`
- `docs/project-state.md`
- `TASKS.md`（只读 T042 行与依赖）
- `tasks/T042-novatileengine-manual-acceptance.md`
- `docs/architecture/nova-tile-engine.md`
- `docs/decisions/D033-nova-tile-engine-plan.md`
- `docs/verification-baseline.md`
- `docs/evidence/index.md`
- `docs/ai-session-log.md`

### Read If Needed

- `docs/experience-baseline.md`
- `docs/evidence/T041-*`

### Allowed Files

- `packages/playground/**`
- `docs/evidence/T042-*`
- `tasks/T042-novatileengine-manual-acceptance.md`

### Forbidden Files

- `packages/map3d/src/legacy/**`
- `packages/map3d/src/migration/**`
- `docs/records/**`

### Required Evidence

- 人工操作记录和录屏/截图。
- 初始化、连续 pan、连续 zoom、停止等待、pitch 0/20/40/60、dispose 结果。
- WebGPU 与 WebGL2 结果。
- 明确的通过/阻断结论。

### Stop Conditions

- 任一关键场景出现空白覆盖、明显卡顿或持续请求。
- 人工结果与自动指标冲突。

## Scope

- 按固定操作轨迹执行双后端人工验收。
- 对画面连续性、跟手性、加载时序、远景层级和停止阶段进行记录。
- 将问题绑定到 T041 timeline 事件。

## Acceptance Criteria

- 首次画面稳定。
- pan 和 zoom 过程中地图持续跟手。
- Tile 替换按空间 Cohort 发生。
- 停止后加载尾部短且可控。
- 高 pitch 近中远 LOD 连续。

## Status

BLOCKED

## Findings

- 2026-09-13 生产入口探测：`http://127.0.0.1:5174/` 的 `apps/playground/src/main.ts` 创建 `Map3D`；`packages/map3d/src/Map3D.ts` 导入并实例化 `TileStreamingEngine`。
- Chromium 153 WebGPU 与强制 WebGL2 探测均返回 `window.__novaMap3D.constructor.name = Map3D`；后端分别为 `webgpu`、`webgl2`；状态统计使用 `tiles.visible/ready` 与 `resources.batches/features` 结构。
- T041 的 Chromium WebGPU/WebGL2、慢网、缓存、失败冷却、60 秒交互和 dispose 证据对应独立 NTE harness（`docs/evidence/T041-browser-harness.html`）；该证据范围是 NTE 隔离实现。
- T042 生产人工轨迹的前置条件是 Playground 入口切换到 NovaTileEngine；当前生产验收结论为 BLOCKED。

## Open Issues

- T043 需要先完成 `Map3D` 生产入口切换到 `NovaTileEngine`，并删除 `TileStreamingEngine` 运行时及其专属引用。
- T043 完成后重新执行 T042 的 WebGPU/WebGL2 人工轨迹，补齐初始化、pan、zoom、bearing、pitch 0/20/40/60、停止等待、缓存复用、dispose 的截图与操作记录。
