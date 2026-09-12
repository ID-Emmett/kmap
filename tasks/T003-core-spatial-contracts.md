# T003 Implement Core Spatial Contracts

## Goal

实现经人工确认的 MVP 公共基础类型、Web Mercator 投影、TileKey、ViewState 归一化和浮动原点纯函数，为后续网络、Camera 和 Tile Runtime 提供唯一坐标契约。

## Scope

- `LngLat`、`ViewState`、`CanonicalTileKey`、`RenderTileKey` 和相关内部类型。
- 经纬度 ↔ Web Mercator meters、经纬度 ↔ XYZ Tile、MVT extent ↔ Tile 局部 meters。
- X wrap、Y 越界、source min/max zoom、overzoom 和稳定 key。
- ViewState 的 zoom/bearing/pitch 归一化。
- MapOrigin 选择与 Tile anchor 相对位置计算。
- 对批准公共类型的根入口导出；不接入网络或渲染。

## Non-Goals

- 不实现 Camera 控制器、可见 Tile 计算、请求、MVT 解码或 Three.js Geometry。
- 不修改 T002 已确认的坐标轴、角度、zoom 或公共字段语义。
- 不引入地球曲面、Terrain、高程基准或投影插件。

## Inputs

- `AGENTS.md`、`PROJECT.md`、`TASKS.md`。
- `docs/architecture.md` 的坐标、Camera、TileKey 和公共 API 章节。
- `docs/decisions.md` D014、D015、D019。
- `docs/research/kye-data.md` 的 Web Mercator XYZ 与 extent 4096 事实。

## Constraints

- 纯计算模块不得依赖 DOM、Playground、Inspector 或 Three.js Scene。
- CPU 投影使用 number/Float64 语义；GPU Float32 转换留给 Geometry Task。
- 公共注释和类型说明使用中文，工程命名使用英文。
- 任何坐标语义变化都返回 Project Control。

## Acceptance Criteria

- 所有坐标和 TileKey 函数具有严格类型、明确边界和无全局状态实现。
- 同一 canonical Tile 的不同 world wrap 共享 canonical key，render key 可区分位置。
- source maxZoom overzoom 不生成不存在的请求层级。
- MapOrigin 重定位不会改变同一 Tile 顶点的局部坐标。
- 根入口只导出批准的公共类型，内部投影细节不意外暴露。

## Test Plan

- 经纬度投影往返：赤道、北京、日期线、Mercator 纬度边界。
- XYZ 边界、X wrap、Y 越界、zoom clamp、稳定 key。
- MVT extent 0/4096 边界和相邻 Tile 接缝。
- ViewState bearing/pitch/zoom 归一化。
- `pnpm --filter @nova/map3d test`、`pnpm check`。

## Status

DONE

## Findings

- 新增公共 `LngLat`、`ViewState`、`CanonicalTileKey`，根入口只导出批准的公共类型；`RenderTileKey`、`MapOrigin` 和投影细节保持内部模块边界。
- 实现 WGS84 与 EPSG:3857 米坐标往返、Mercator 纬度限制、连续 XYZ Tile 坐标、MVT extent 与 Tile 西北角局部米坐标往返。
- 实现 X world wrap、Y 越界忽略、source data zoom 限制、source maxZoom overzoom 父 Tile 映射和稳定 canonical/render 字符串键。
- 实现 zoom、bearing、pitch、中心纬度归一化；`Map3D` 增加 `getView/setView`，并将 Scene/Camera 收回内部所有权。
- 实现当前数据 Tile 中心 MapOrigin、Tile 锚点相对位置和 Tile 局部点到 Three.js Y-up 场景位置转换。
- 新增 4 个测试文件，覆盖赤道、北京、日期线、Mercator 边界、XYZ 边界、wrap、Y 越界、zoom clamp、overzoom、extent 接缝、ViewState 和 MapOrigin 重定位。
- `pnpm --filter @nova/map3d test` 通过：5 个测试文件、21 个测试全部通过。
- `pnpm check` 通过：SDK/Playground 类型检查、22 个测试、SDK build 和 Playground production build 全部成功。

## Open Issues

无。
