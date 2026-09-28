# T049 地图始终平面：删除地球视图与世界副本

Owner: AI 实施会话
关联决策：D034（人工负责人 2026-09-28 直接指令）。
依赖：T046（瓦片生命周期）、T048（槽位渲染，进行中，与本任务无文件冲突）。

## 背景事实

- 删除前，minZoom=0 的数据源在 z4.5～5.5 连续过渡到球面，`globe/` 提供球面投影、曲面细分、球面覆盖、球体底面与球面相机。
- 删除前，横向世界副本通过 `canonicalKey` 归一化、`requestUrl` 的 X 归一化、覆盖选择的 ±1 根瓦片、经度环绕差值和 `RenderTileKey` 实现无限左右平移。
- 平面顶点使用 CPU 双精度合成的 `highpModelViewMatrix`；模板栅格化覆盖半个设备像素采样边界。

## Scope

- 删除 `globe/` 目录及全部球面分支（投影、覆盖、相机、材质、Worker 参数、几何细分）。
- 删除横向世界副本：副本地址归一化、请求 URL X 归一化、`RenderTileKey`、±1 根瓦片、经度环绕差值。
- `ViewState.center.lng` 限制在 [-180, 180]；覆盖选择使用单世界根瓦片；`selectMapOrigin` 的 X 限制在当前层级范围内。
- 同步修改受影响的测试、Playground 基准场景与正式文档。

## Non-Goals

- 不改变瓦片选择、缓存、调度、回收与 LOD 语义。
- 不改变平面渲染管线、主题、文字与建筑行为。
- 不改变 `Map3DOptions` 除 `globe` 之外的其他字段。

## 上下文边界

见 Task Context Packet。

## 验收标准

- `pnpm check`、`pnpm ai:check`、`git diff --check` 通过。
- `packages/map3d` 全部离线测试通过，覆盖低缩放平面选片、经度边界与槽位共享语义。
- 真实浏览器（WebGPU 与 WebGL2）人工验收：任意缩放均为平面；缩至最低层级显示单个世界，两侧为背景色；向东/西平移在 ±180 停住；平移、缩放、旋转、倾斜与文字显示无回归。

## Task Context Packet

### Must Read

- `AGENTS.md`
- `docs/project-state.md`
- `TASKS.md`（T049 行）
- `tasks/T049-flat-map-only.md`（本文件）
- `docs/decisions/D034-flat-map-only-remove-globe.md`
- `KNOWLEDGE.md`、`docs/knowledge/streaming.md`

### Read If Needed

- `docs/architecture/nova-tile-engine.md`（显示与选片契约）
- `packages/map3d/src/streaming/coveringTiles.ts`、`address.ts`、`spatial/viewState.ts`、`spatial/mercator.ts`
- `docs/evidence/streaming-rebuild/README.md`

### Allowed Files

- `packages/map3d/src/**`
- `packages/map3d/test/**`
- `apps/playground/src/**`
- `scripts/summarize-map-alignment.mjs`
- `tasks/T049-flat-map-only.md`、`TASKS.md`、`PROJECT.md`、`KNOWLEDGE.md`
- `docs/project-state.md`、`docs/decisions.md`、`docs/decisions/index.md`、`docs/decisions/D034-*.md`
- `docs/architecture/nova-tile-engine.md`、`docs/architecture.md`、`docs/knowledge/streaming.md`
- `docs/ai-session-log.md`、`docs/ai-sessions/2026-09-28.md`
- `scripts/ai-governance/check-ai-governance.mjs`

### Forbidden Files

- `packages/map3d/test/fixtures/**`、`docs/evidence/**` 历史快照
- `docs/architecture.md`、`docs/decisions.md` 全文中与本次决策无关的历史条目
- 任何未在 Allowed Files 中列出的包或应用源码

### Required Evidence

- `pnpm typecheck`、`pnpm --filter @kmap/map3d test`、`pnpm build`、`pnpm ai:check`、`git diff --check` 输出。
- 低缩放平面选片与经度边界断言（`packages/map3d/test/mapAppearance.test.ts`、`viewState.test.ts`、`mapOrigin.test.ts`）。
- 真实浏览器人工验收记录（平面世界、边界停止、平移/缩放/旋转/倾斜与文字）。

### Stop Conditions

- 需要保留球面渲染或世界副本能力。
- 需要改变瓦片选择、缓存、调度或 LOD 语义。
- 真实浏览器验收出现覆盖缺口、文字错位或平移无法停止。

## Findings

- 删除 `globe/` 全部 5 个文件与 `Map3DOptions.globe`；新增 `rendering/mapVertex.ts` 承接平面高精度顶点变换。
- 覆盖选择统一为单世界根瓦片 `{ z: 0, x: 0, y: 0 }`；`selectMapOrigin` 的 X 限制在 `[0, 2^z-1]`。
- `canonical`/`canonicalKey` 删除，资源与需求键统一使用 `keyOf`；`requestUrl` 不再归一化 X。
- `RenderTileKey` 删除；`normalizeViewState` 使用 `clampMercatorLongitude` 限制经度。
- 邻居预取增加 X 边界过滤；预测外推的经度按单世界限制。
- 世界副本场景的测试改写为父来源覆盖多子区域的单世界语义；`sphericalAppearance` 测试替换为 `mapAppearance` 平面覆盖测试。
- 离线回归：`pnpm typecheck` 通过，`packages/map3d` 32 个测试文件 / 176 个测试全部通过。
- 人工验收第一轮在 zoom 0、pitch 0、中心位于 `(180, -85.051129)` 的边界视角发现左键平移瞬移：该视角相机距离约 1.76e8 米，超过固定射线截断距离 `WORLD * 4`（约 1.60e8 米），中心射线与移动射线先后退化为水平截断，位移被放大到 1.6e8 米并立即触发经度钳制。
- 修复：`panViewByPixels` 与 `locationAtPixel` 的射线截断距离改为 `max(WORLD * 4, frame.distance * 4)`，覆盖低缩放与大视口下的正常向下射线；新增回归测试「最低缩放边界视角的水平平移按像素尺度移动，不产生瞬移」与「最低缩放边界视角的中心像素锚点等于视图中心」，回退修复后前者失败。
- 修复后回归：`pnpm typecheck` 通过，`packages/map3d` 32 个测试文件 / 178 个测试全部通过。
- 人工验收第二轮发现最低层级平移后「飞往广州」飞行异常：Playground 的 `flightView` 仍使用经度环绕差值（`+540 % 360 - 180`），从西经或边界视角出发时中间经度超出 `[-180, 180]`，被单世界钳制后相机停在世界边缘，飞行结束时才跳回目标。
- 修复：`flightView` 的经度差值改为直接差值（单世界语义），路径必然落在起终点之间；新增回归测试「从西经与边界视角飞往广州时路径不越出单世界」，回退修复后该测试失败。
- 修复后回归：`pnpm check`（map3d 178 个测试 + playground 20 个测试 + 构建）通过。
- 人工验收结论（2026-09-28）：人工负责人确认通过。平移瞬移与城市飞行越界两轮缺陷修复后，地图始终为单世界平面，交互与飞行行为符合预期。
- 验收后清理：删除空目录 `packages/map3d/src/globe/` 与无引用的临时脚本 `scripts/_tmp-line-diag.mjs`、`scripts/_tmp-stages.mjs`。
- Fixture 引用核查：`kye-stanley-z16-53560-28620`/`53561-28621` 由 `coastAuthority.test.ts` 以模板字符串动态引用（静态搜索会漏判）；`kye-boundaries.json`、`kye-kye_admin_pro-z5-26-12.mvt`、`kye-ocean-z7-104-55`、`kye-ocean-z7-108-55`、`kye-water-z6-52-27`、`kye-water-z6-53-27` 均被测试或文档引用；`kye-main-z15-26978-12416.json` 属 `docs/knowledge/data.md` 的数据证据链。全部 fixture 保留。

## Open Issues

- 无阻塞项。缩至最低层级时世界两侧显示背景色是单世界平面的预期表现。
- `lngLatToTilePosition` 仍返回连续 XYZ 坐标（`lng = 180` 时为 `x = 2^z`），属于纯数学转换；`selectMapOrigin` 与覆盖选择已限制在单世界范围。

## Status

DONE
