# T014 Implement Inertial Map Interaction

## Goal

为 pan 和 bearing/pitch 旋转增加跟手输入后的有界惯性与阻尼，并合并 wheel zoom 更新，使地图交互接近常用地图引擎的连续手感。

## Scope

- timestamped pointer sample、平移/bearing/pitch release velocity 估算。
- 基于 requestAnimationFrame 和 delta time 的指数阻尼积分。
- pointer drag 直接跟手，release 后平移与旋转惯性。
- wheel 事件合并为逐帧连续 zoom 更新。
- 新输入、外部 setView、边界命中、页面失活和 dispose 的动画取消。
- `prefers-reduced-motion` 下禁用释放惯性。
- 可注入 clock/frame scheduler 的确定性测试，以及双后端人工调校。
- 与 T013 Display Coverage 的 rapid coverage 更新和 stale target 规则联调。

## Non-Goals

- 不实现 flyTo/easeTo 公共 API、zoom-to-cursor、双击缩放、键盘导航或完整触摸手势。
- 不实现 pinch、多指 bearing/pitch、边界弹簧或地图中心业务 bounds。
- 不增加公开的阻尼参数 API；MVP 先形成一个经人工接受的默认行为。
- 不修改 Tile lifecycle、MVT、Geometry、Style 或远景渐隐。

## Inputs

- T007/T009 交互与 ViewState 实现。
- T013 渐进式 Tile 替换。
- `docs/experience-baseline.md` 的运动状态、取消和阻尼范围。
- 用户要求：旋转与拖动具有阻尼过渡效果。

## Constraints

- 运动积分基于真实 delta time，不能假设固定 60 FPS。
- 慢速精确操作不得因最低速度或 smoothing 产生持续漂移。
- pitch/纬度 clamp 后停止对应速度分量，bearing 继续使用既有归一化。
- Map3D dispose 后不得保留 rAF、pointer capture、listener 或 viewchange。
- 公共 ViewState 语义和 Map3D API 保持不变；需要新增公共 API 时返回决策会话。

## Acceptance Criteria

- 快速 pan、bearing 和 pitch 释放后具有可感知、单调衰减且不反弹的惯性；慢速释放稳定停止。
- 常规惯性约 0.2-1.2 秒停止，极端输入不超过 1.5 秒。
- 30/60/120 Hz 模拟下同初速度的终点在已记录容差内，无 frame-rate 依赖。
- 新手势、wheel、外部 setView、边界和 dispose 会立即取消旧惯性。
- wheel 连续输入不逐事件突跳，且不会造成 stale zoom Tile 回挂或闪白。
- WebGPU/强制 WebGL2 手感和状态一致，人工负责人接受录屏/现场体验。

## Test Plan

- Fake clock/rAF：velocity sampling、指数衰减、stop threshold、frame-rate invariance。
- pan/bearing/pitch clamp、pointerup/pointercancel/lostcapture 和新输入取消。
- wheel burst 合并、external setView、dispose 与 reduced-motion。
- 与 T013 联调 rapid pan/zoom 的 target generation、Display Coverage 和资源释放。
- Chromium WebGPU/强制 WebGL2 实际拖动/旋转/zoom 录屏。
- `pnpm --filter @nova/map3d test`、`pnpm check`。

## Status

DONE

## Findings

已实现 `MapInteractionController` 的 pointer sample 采样、release velocity 估算、基于 `requestAnimationFrame` 与真实 delta time 的指数阻尼积分。pan 速度以 Web Mercator meters/second 积分；bearing/pitch 以 degrees/second 积分；pitch/纬度 clamp 后清除对应速度分量，bearing 保持既有归一化。

已将交互拆分为 `inertia.ts`、`pointerVelocity.ts` 和 `viewTransforms.ts`，使 `mapInteractions.ts` 保持 500 行以内；未改变 `Map3D` 公共 API、ViewState 语义、Tile lifecycle、MVT、Geometry 或 Style。

已实现 wheel burst 合并到逐帧 zoom 更新；新 pointer、wheel、外部 `Map3D.setView()`、页面失活和 dispose 会取消旧惯性。`prefers-reduced-motion: reduce` 下禁用释放惯性，但保留直接拖拽与 Tile fallback。

自动验证：`pnpm --filter @nova/map3d typecheck` 通过；`pnpm --filter @nova/map3d test` 通过，28 个测试文件、119 项测试；仓库级 `pnpm check` 通过。新增覆盖 pan/rotate release、30/60/120 Hz 终点一致性、边界停止、外部取消、页面失活、wheel burst 和 reduced-motion。

浏览器验证：当前 Chromium 1280×720 viewport 下，WebGPU 与强制 WebGL2 均完成 no-preference 模式的 pan release、Shift+drag bearing/pitch release 和 wheel zoom 验证；两后端控制台无 warning/error。WebGPU pan release 后中心从 `116.36816623366909` 继续衰减到 `116.36208943628715`；WebGL2 从 `116.3688531779517` 继续衰减到 `116.36209084694292`。Shift+drag 后 WebGPU bearing 从 `150.1194413934516` 继续到 `177.2748090969142`，WebGL2 从 `129.56560900477` 继续到 `177.30798211847642`，pitch 均 clamp 于 `60`。Wheel 后双后端 zoom 从 `15` 到 `16`。证据：`docs/evidence/T014-webgpu-pan-inertia.png`、`T014-webgpu-rotate-inertia.png`、`T014-webgpu-wheel-merged.png`、`T014-webgl2-pan-inertia.png`、`T014-webgl2-rotate-inertia.png`、`T014-webgl2-wheel-merged.png`。

Reduced-motion 验证：通过浏览器媒体模拟确认 `prefers-reduced-motion: reduce` 为 true 时，WebGPU pan release 后中心停在 drag 释放位置 `116.38349533081055`，未继续惯性；证据：`docs/evidence/T014-webgpu-reduced-motion-pan.png`。

人工验收：2026-09-10 人工负责人确认 T013/T014 执行状态无异常，并接受 pan、bearing/pitch 和 wheel 手感，T014 完成。

## Open Issues

- 无。
