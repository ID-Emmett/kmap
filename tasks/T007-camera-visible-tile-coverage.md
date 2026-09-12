# T007 Implement Camera and Visible Tile Coverage

## Goal

实现 ViewState 驱动的地图 Camera、基础交互和可见 Tile 覆盖计算，不依赖网络与渲染数据即可通过确定性测试验证。

## Scope

- ViewState store、`getView/setView` 和 typed `viewchange`。
- PerspectiveCamera 从 center/zoom/bearing/pitch/viewport 推导。
- Pointer pan、wheel zoom、bearing/pitch 手势的 Playground 基础控制。
- 视锥与地图平面求交、visible canonical/render Tile、world wrap 和一圈 prefetch。
- source min/max zoom、overzoom、Tile 上限和按屏幕距离的优先级输入。
- MapOrigin 跨数据 Tile/zoom 重定位时的 Camera/Tile transform 更新。

## Non-Goals

- 不请求 Tile、不实现 Scheduler/Cache/Worker/GPU upload。
- 不实现 flyTo、惯性、边界限制、触摸多指完整体验或键盘可访问性方案。
- 不改变 T002 的坐标轴、pitch 和 zoom 语义。

## Inputs

- T003 输出。
- `docs/architecture.md` 的坐标、Camera、可见集与优先级。
- `docs/decisions.md` D014、D015、D019。
- `docs/verification-baseline.md` 的低/中/高 zoom 场景。

## Constraints

- Camera 不直接读取 Tile/业务状态；Coverage 只接收 ViewState、viewport 和 source bounds。
- 视锥不与地面相交时必须有有限截断，不能生成无限或异常 Tile 集。
- 交互监听器和 ResizeObserver 必须可完全解除。
- 数学核心应可在 Node/Vitest 中无 DOM 测试。

## Acceptance Criteria

- setView 的归一化和 Camera 矩阵在 resize 后保持一致。
- pitch/bearing 下可见 Tile 覆盖视口地面区域，无越界 Y Tile。
- 世界日期线两侧 wrap 正确，共享 canonical key。
- prefetch 和 Tile 上限行为确定；优先级中心 Tile 高于远端/prefetch。
- 交互 dispose 后无事件监听器残留。

## Test Plan

- Camera/coverage 纯数学测试：pitch 0/60、bearing、多 viewport、日期线、source bounds。
- MapOrigin 重定位前后屏幕位置连续性。
- Pointer/wheel adapter 的事件绑定、归一化和 dispose。
- `pnpm --filter @nova/map3d test`、`pnpm check`。
- Playground 人工验证 pan/zoom/bearing/pitch 手感，只记录问题，不在本 Task 扩大为完整交互产品设计。

## Status

DONE

## Findings

- 已实现 `ViewStateStore` 和轻量 typed event emitter：`setView` 统一归一化并仅在实际变化时发出 `viewchange`，读取与事件值均隔离可变 `center`；`Map3D` 在 view/resize 变化时同步更新 Camera、Coverage、MapOrigin 和现有 Tile transform。
- 已实现 45° `PerspectiveCamera`：遵循 Scene X 向东、Z 向南、bearing 从北顺时针和 pitch 0-60° 约定；以 KYE 已验证的 256px XYZ zoom 语义从 viewport height 推导米/像素和相机距离，并使用与距离成比例的 near/far 保持高 zoom 矩阵有限且中心可见。
- 已实现视锥地面 footprint：四角射线不与地面相交时按有限地面距离截断；Coverage 按 source data zoom 生成 visible canonical/render Tile，支持 X world wrap、Y 越界忽略、source bounds（含日期线和等价经度世界）、source min/max zoom 与 maxZoom overzoom。
- 已实现一圈 prefetch、默认 128 Tile 上限和确定性优先级：visible 优先于 prefetch，同级按 Tile 中心到屏幕中心距离和稳定 RenderTileKey 排序；结果显式返回 `truncated`。
- 已实现基础交互：左键/单指拖拽 pan，右键或 Shift+左键拖拽调整 bearing/pitch，Wheel 连续 zoom；pointer capture、lost/cancel、contextmenu、重复 dispose 和 Playground ResizeObserver/event subscription 均可完整清理。
- 已扩展 Tile 重定位：固定 T006 Polygon GPU record 可在 MapOrigin 跨 Tile/数据 zoom 变化时只移动 container，不重建局部顶点；Worker 构建期间发生重定位时，新 record 使用最新 origin。
- 2026-09-09 在当前 Windows Codex Chromium、1280×720 CSS viewport 实测：WebGPU 下 pan、zoom 15→15.8、bearing 0→25、pitch 0→20 后 `viewchange` 与 visible coverage 持续更新；强制 WebGL2 下 Shift drag 更新到 bearing 17.5、pitch 10；两条路径控制台均无 error。截图：`docs/evidence/T007-initial-webgpu-2026-09-09.png`、`docs/evidence/T007-interactions-webgpu-2026-09-09.png`。
- `?lifecycle=dispose` 实测 visible、Tile state、CPU/GPU bytes、batches/features/vertices/indices/objects 和 Worker active/queued 全部归零，控制台无 error。
- 自动验证：`pnpm --filter @nova/map3d test` 为 19 个测试文件、65 个测试通过；`pnpm check` 全部通过。SDK 主 bundle 为 40.93 kB（gzip 12.85 kB），独立 Worker bundle 保持 35.64 kB（gzip 10.86 kB）。

## Open Issues

- pan/旋转惯性和 wheel 帧合并由 T014 实现；完整触摸手势仍后置。
- 当前仍只加载和渲染 T006 的固定 Tile；视图变化只更新 Camera、Coverage 和该 Tile transform，动态请求、调度、Cache 和多 Tile GPU 生命周期由 T008/T009 接入。
- 键盘可访问性、完整多指手势、目标工作站长时间交互和性能门槛不在本 Task，继续由后续交互设计与 T010 验证。
