# T015 Implement Pitched Horizon Fade

## Goal

在倾斜地图视角中，让远处 Polygon/Line 平滑融合到浅色背景，增强深度提示并降低远景视觉噪声，同时保持近景清晰和 Tile Coverage 完整。

## Scope

- 从 pitch、Camera target distance 和 ground footprint 推导按帧 fade start/end/strength。
- Polygon/Line 共享的 TSL/Node Material 远景颜色融合。
- pitch 0 禁用，pitch 增大时平滑启用；近景保持原色，远景融合到 renderer background/haze color。
- 与 T013 Tile transition opacity 的组合顺序和 MaterialRegistry 生命周期。
- resize、zoom、bearing、MapOrigin 和 background color 变化的参数更新。
- WebGPU/WebGL2 视觉一致性、性能采样和 dispose 验证。
- Playground pitch 0/20/40/60 的对照证据。

## Non-Goals

- 不实现 Three.js post-processing、天空、太阳、大气散射、Terrain、Globe、阴影或体积雾。
- 不通过减少 Coverage、缩短 camera far plane 或隐藏未加载 Tile 制造渐隐。
- 不新增公开 atmosphere/style API；MVP 使用随 background 自动推导的默认效果。
- 不修改浅色色板语义、交互惯性或 Tile 请求策略。

## Inputs

- T012 浅色底图视觉基线。
- T013 渐进式 Tile transition/material 结果。
- `docs/experience-baseline.md` 的远景渐隐规则。
- `docs/visual-style-baseline.md` 的浅色背景与层级。
- 用户要求：3D 倾斜视角下远处渐隐。

## Constraints

- 自定义渲染只使用 TSL / Node Material，WebGPU/WebGL2 共用一条材质路径。
- Fade 距离按当前 Camera frame 相对推导，不得使用只适配北京 zoom 15 的固定世界米数。
- 渐隐不得掩盖 T011 seam 或 T013 loading gap，专项验收必须可临时禁用效果作对照。
- 共享 Material/transition resource 必须有明确所有权，dispose 后 uniform/animation 引用归零。
- 公共 API 保持不变；若 background 无法满足效果配置需求，返回 Project Control。

## Acceptance Criteria

- pitch 0 与未启用效果的基线肉眼一致。
- pitch 20→60 时远处对比度连续降低并融入浅色背景，无硬截断带、闪烁或 Tile 级渐变差异。
- 近景 water/building/road/landuse 保持可辨，bearing/zoom/resize/MapOrigin 变化时 fade 连续。
- 远处 Tile 仍在 Coverage/Runtime 统计中，证明效果不是少请求或裁 far plane。
- WebGPU 与强制 WebGL2 肉眼一致；专项性能没有未说明的显著退化，最终门槛由 T010 判断。
- 人工负责人接受 pitch 0/20/40/60 对照和交互录屏。

## Test Plan

- Fade 参数纯函数：pitch threshold、zoom/viewport invariance、start/end 单调和有限值。
- Material 节点/统一参数、Polygon/Line 一致性、Tile transition 组合和 dispose。
- 同一场景 effect on/off 像素对比；远景变化显著、近景变化受限。
- Chromium WebGPU/强制 WebGL2 的 pitch 0/20/40/60 截图与连续旋转/缩放录屏。
- 记录启用前后 frame P95、draw calls 和 material/resource counts。
- `pnpm --filter @nova/map3d test`、`pnpm check`。

## Status

DONE

## Findings

环境判断：T015 依赖 T012/T013，二者均已完成并经人工接受；T014 已于 2026-09-10 完成人工手感验收。T015 的 Scope 独立于 T014 交互阻尼实现，未修改 Coverage 或 Tile 请求策略。

已实现 `horizonFade.ts` 纯函数，根据当前 `ViewState.pitch`、`MapCameraFrame.distance` 和 Tile Coverage ground footprint 推导 `start/end/strength`。pitch 0 时 strength 为 0；pitch 增大时使用 smoothstep 平滑启用；fade 距离跟随 camera frame 和 viewport/zoom 相对缩放，不使用固定北京 z15 米数。

已在 `MaterialRegistry` 中为 Polygon/Line 共享 horizon fade uniforms，并通过 `MeshBasicNodeMaterial.colorNode` 将材质颜色按 view-space depth 混合到 renderer background color。Line 仍保留既有屏幕空间宽度 `vertexNode`；T013 display opacity 继续通过 Node Material 的 material opacity 路径叠加，未改变 Tile transition、Coverage、请求、far plane 或公共 API。

`Map3D` 现在在构造、`setView()`、交互更新、resize、bearing/pitch/zoom 和 MapOrigin 变化时同步更新 fade 参数；dispose 时释放 MaterialRegistry 并将 fade uniform 归零。共享材质与每个 render instance clone 继续由 adapter/resource 生命周期管理。

自动验证：`pnpm --filter @nova/map3d typecheck` 通过；`pnpm --filter @nova/map3d test` 通过，30 个测试文件、123 项测试；仓库级 `pnpm check` 通过。新增覆盖 fade 参数 pitch threshold、start/end 有序、zoom/viewport 相对缩放、Polygon/Line 共享 TSL fade node、display opacity 与 colorNode 共存、dispose 后 fade uniform 归零。

浏览器验证：当前 Chromium 1280×720 viewport 下完成 WebGPU 与强制 WebGL2 的 pitch 0/20/40/60 截图，fresh tabs 控制台无 warning/error。pitch 0 双后端 `visible=25`、`queued/fetching=0`；pitch 60 双后端仍为 `visible=128` 且继续请求/构建远处 Tile，证明渐隐未通过减少 Coverage 或裁 far plane 实现。证据：`docs/evidence/T015-webgpu-pitch-0.png`、`T015-webgpu-pitch-20.png`、`T015-webgpu-pitch-40.png`、`T015-webgpu-pitch-60.png`、`T015-webgl2-pitch-0.png`、`T015-webgl2-pitch-20.png`、`T015-webgl2-pitch-40.png`、`T015-webgl2-pitch-60.png`。

专项对照：临时将 fade strength 设为 0 截取 pitch 60 对照，随后恢复最终实现；对照证据为 `docs/evidence/T015-webgpu-pitch-60-fade-off.png` 与 `docs/evidence/T015-webgl2-pitch-60-fade-off.png`。双后端 `?lifecycle=dispose` 验证 dispose 后 Tile、resource 和 worker 统计归零，证据为 `docs/evidence/T015-webgpu-dispose.png` 与 `docs/evidence/T015-webgl2-dispose.png`。

人工验收：2026-09-10 人工负责人已接受 pitch 0/20/40/60 对照和交互中的远景渐隐观感，T015 完成。pitch 启用阈值和 fade 曲线作为当前 MVP 默认视觉调校值保留，最终目标工作站性能和发布判断由 T010 完成。

## Open Issues

- 无。
