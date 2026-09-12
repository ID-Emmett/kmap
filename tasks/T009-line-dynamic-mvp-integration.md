# T009 Integrate Line Batches and Dynamic MVP Runtime

## Goal

实现 Line 批次并把 Camera、Coverage、Tile Runtime、Worker、Polygon/Line Renderer 和批准公共 API 集成为可交互的 Nova MVP 候选版本。

## Scope

- Worker 中屏幕空间 Line 三角带，MVP bevel join、butt cap、width/color/opacity。
- fill/line 公共 Layer options、最小属性 filter 和 render order。
- `Map3DOptions` 的 source/layers/view/renderer/cache 结构。
- `getView/setView/getStats/on` 与批准错误模型。
- 当前 scene/camera 公共字段收回内部；`getRenderer` 保留受限 escape hatch。
- 动态 visible/prefetch Tile 接入 Fetch、Worker、GPU、Cache 和 overzoom。
- Playground 使用真实 KYE 主 source 和最小水面/土地/道路 Layer 配置。
- API declaration、README 示例和迁移说明同步。

## Non-Goals

- 不实现文字、完整 Style v8、3D 建筑、Picking、Overlay、flyTo、Raster 或业务 MVT。
- 不引入跨 Tile 合批、复杂 line dash/pattern/round join。
- 不调整 Three.js 版本或 TSL 技术方向。

## Inputs

- T005、T006、T008 输出。
- `docs/architecture.md` 的 MVP、Layer style、公共 API、错误与资源边界。
- `docs/decisions.md` D013-D020。
- `docs/verification-baseline.md` 的功能场景。

## Constraints

- 公共 API 必须与人工批准版本一致；任何字段或生命周期变化返回决策会话。
- KYE URL 由 Playground 显式配置，SDK 不隐式硬编码生产服务。
- render loop、交互、requests、workers 和 resources 必须由 dispose 统一释放。
- SDK 不依赖 Inspector；Playground 只通过 `getRenderer` 挂载 Inspector。

## Acceptance Criteria

- 真实 KYE Polygon/Line 随 pan/zoom/bearing/pitch 动态加载，WebGPU/WebGL2 功能一致。
- Tile 接缝、overzoom、world wrap、204、取消、错误和缓存命中行为符合基线。
- 公共类型与 README 示例一致，未批准内部类型不从根入口导出。
- 对象数与 batch 数相关而非 feature 数；stats 能解释请求、缓存、worker、batch 和 bytes。
- 自动测试与 `pnpm check` 通过，真实浏览器功能验证完成。

## Test Plan

- Line mesh 几何、width、join/cap、feature mapping。
- Map3D 生命周期、API、events、errors、source/layers validation。
- 动态多 Tile 集成：pan/zoom、wrap、overzoom、cache hit、204/failure。
- `pnpm check`。
- 当前稳定 Chromium WebGPU、强制 WebGL2 人工功能矩阵；性能只采样，正式门槛由 T010 验收。

## Status

DONE

## Findings

- Worker 新增 LineString 清洗、三角带拓扑、`previous/next/side`、butt cap、width/color/opacity、zoom/filter 和 feature range；共享 TSL Node Material 在裁剪空间按 CSS pixel 展开并限制尖角，Polygon/Line 共享 tile-local feature table 与 version 1 transferable payload。
- `ThreeTileRenderAdapter` 将 Polygon/Line batch 转换为 Tile 级 GPU 资源，按 MaterialRegistry 共享材质，并为同一 canonical Tile 的多个 world-wrap consumer 建立独立 transform 实例；对象数随 batch/render instance 增长，不随 feature 数增长。
- `Map3D` 已使用批准的 `source/layers/view/renderer/cache` options，动态提交 Coverage，转发 `stats/idle/error`，并通过 Runtime 统一释放 fetch、Worker、Geometry、Material、Scene 和 Renderer。
- 自动验证：SDK 25 个测试文件、95 项测试和 Playground workspace import 测试通过；`pnpm check`、`git diff --check` 和 500 行源码上限审计通过。
- 浏览器验证：2026-09-09 当前 Windows Codex Chromium 中，默认 WebGPU 与 `?renderer=webgl2` 均显示真实 KYE water/landuse/building/road，pan/zoom/bearing/pitch 动态更新 Tile；双后端 `?lifecycle=dispose` 后 tiles/resources/workers 均归零。证据见 `docs/evidence/T009-*.png`。

## Open Issues

- T010 仍需按目标参考工作站固化 60 秒交互、三轮生命周期、异常网络矩阵和正式性能阈值；T009 浏览器数据仅作为功能证据，不作为性能发布结论。
- 用户自测确认 zoom 层级替换仍可能闪白，当前实现也没有释放惯性与倾斜远景渐隐；分别由 T013、T014、T015 在 T010 前完成。
