# D034 地图始终平面：删除地球视图与世界副本

- 状态：Accepted
- 确认日期：2026-09-28
- 决策来源：人工负责人直接指令。

## 背景

- 当前 minZoom=0 的数据源在 z4.5～5.5 由平面连续过渡到球面，低缩放呈现地球视图。
- 当前横向世界副本（world wrap）支持无限左右平移，同一 canonical 瓦片在多个世界副本中重复显示。
- 人工负责人要求地图始终为平面，删除地球相关实现，并移除无限左右平移能力。

## 决策

- 删除全部球面渲染实现：`globe/` 目录（球面投影、曲面细分、球面覆盖、球体底面、球面相机）、`Map3DOptions.globe` 公共选项、球面分支及仅服务球面的测试与验收场景。
- 删除全部横向世界副本实现：副本地址归一化（`canonical`/`canonicalKey`）、请求 URL 的 X 归一化、`RenderTileKey`、覆盖选择的 ±1 世界副本根瓦片、经度环绕差值、`getDiagnostics().globe`。
- 地图始终使用单个 Web Mercator 世界平面：`ViewState.center.lng` 限制在 [-180, 180]，平移在东西边界停止；视野超出世界时显示背景色。
- 平面顶点继续使用 CPU 双精度合成的 `highpModelViewMatrix`；模板栅格化继续覆盖半个设备像素采样边界。

## 影响

- 公共 API 变化：`Map3DOptions.globe` 删除；`getDiagnostics()` 不再返回 `globe` 字段。
- 覆盖选择统一为 `selectTiles`（单世界根瓦片）；`selectGlobeTiles` 删除；`selectMapOrigin` 的 X 限制在当前层级范围内。
- Worker 不再接收球面参数；低层级球面几何细分（三角细分与线段弦长细分）删除；模板矩形不再按曲面分块。
- `pnpm check`、`pnpm ai:check`、`pnpm test` 与真实浏览器验收共同构成发布证据。
- 对应任务：`tasks/T049-flat-map-only.md`。
