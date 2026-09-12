# T013 Implement Progressive Tile Replacement

## Goal

消除已建立显示覆盖后的 zoom/pan Tile 闪白：分离 Target/Display Coverage，以 parent/child fallback、display pin、过时目标抑制和短过渡完成渐进式 Tile 替换。

## Scope

- 复现 T009 在跨整数 zoom 和超出 prefetch pan 时的背景暴露，记录帧序列与 Runtime 状态。
- 新增独立 Display Coverage/Tile Transition 协调模块，不把显示角色塞入 Tile lifecycle state。
- exact、ancestor、descendant/outgoing fallback 解析和必要的低优先级父 Tile 调度。
- ready + GPU upload 完成后才显示；fallback/outgoing 保留到替代覆盖成立并完成过渡。
- 最新 Target Coverage token，拒绝过时 zoom 结果回挂。
- 初始 180 ms、可依据证据在 120-250 ms 调校的 Tile 淡入。
- Display pin、fallback/outgoing 资源统计、budget pressure 和确定性释放。
- WebGPU/WebGL2、延迟网络、rapid zoom、same-zoom pan 和 dispose 验证。

## Non-Goals

- 不实现交互惯性、远景渐隐、视觉色板或完整父子 LOD morph。
- 不改变 MVT decode、Worker geometry、Canonical/Render TileKey 和公共 Layer API。
- 不用增加无限 cache、延迟所有 eviction 或隐藏 Canvas 来规避闪白。
- 不实现跨 Tile 合批、Raster fallback 或持久化缓存。

## Inputs

- T009 输出、T011 修复结论。
- `docs/experience-baseline.md` 的 Target/Display Coverage 和 fallback 规则。
- `docs/architecture.md` 的 Tile 状态、Cache、GPU ownership。
- 用户自测报告：zoom 时新层级加载会闪白且整片出现。
- T008/T009 Runtime、Render adapter 与 stats tests。

## Constraints

- Tile data state 与 display role 正交；现有合法 lifecycle transitions 不因过渡动画被扩展为 UI 状态。
- 正常同时显示最多 exact + 一个 fallback/outgoing 层级；快速输入合并到最新目标。
- 过渡资源计入预算，参与显示者 pinned；pressure 下先停 prefetch，不释放仍可见 fallback。
- 自定义过渡材质必须使用 TSL/Node Material，并保持 Feature 不创建独立 Object3D。
- 如需改变 D015-D019 公共契约，返回决策会话；本 Task 默认不扩大根入口 API。

## Acceptance Criteria

- 首次可用 Display Coverage 建立后，跨整数 zoom 不露出 Scene background；目标 Tile 未 ready 时继续显示正确放置的 fallback。
- same-zoom pan 超出 prefetch 时有 ancestor fallback，不出现矩形空洞。
- exact Tile 仅在完整 upload 后淡入，替代过程无整片硬切或逐 batch 半成品。
- rapid zoom 只提交最新 target；旧异步结果不造成层级回跳。
- fallback/outgoing 在过渡后解除 pin 并可由 LRU 淘汰；dispose 后 target/display records、过渡动画和 GPU resources 全归零。
- WebGPU 与强制 WebGL2 行为一致，动态 Cache、world wrap、MapOrigin 和 T011 seam 修复无回归。
- 人工负责人接受 zoom/pan 录屏中的连续性。

## Test Plan

- Fake clock/source/worker/render：exact/ancestor/descendant fallback、显示提交、失败降级、stale target、budget 和 dispose。
- 相邻 zoom 的 parent/child key、world wrap 和 render transform。
- 固定 500 ms request delay + 100 ms build delay 的帧级背景暴露检测。
- Chromium WebGPU/强制 WebGL2：14.75↔15.25、14→16→15、超出 prefetch pan 的录屏或连续截图。
- `prefers-reduced-motion`：无长淡入但 fallback 仍保持连续覆盖。
- `pnpm --filter @nova/map3d test`、`pnpm check`。

## Status

DONE

## Findings

已实现 Target/Display Coverage 协调、exact/ancestor/完整 descendant fallback、outgoing 保留、最新目标 token、required 与低优先级 warm fallback 请求、display pin 和 180 ms 短过渡。显示 fallback 的预热覆盖当前 visible + prefetch 的两层 ancestor；实际显示仍限制为 exact 与一个 fallback/outgoing cohort。Polygon/Line render instance 使用独立 Node Material clone 承载资源级 opacity，并按图层原始 opacity 相乘；系统 `prefers-reduced-motion` 通过 Map3D 传入 Runtime。

自动验证：`pnpm --filter @nova/map3d typecheck` 通过；28 个测试文件、110 项测试通过；仓库级 `pnpm check` 在本轮实现前后均通过。

浏览器验证：全新 Chromium 页面在 WebGPU 与强制 WebGL2 下，以 1500 ms 网络延迟执行 zoom `14.75 ↔ 15.25`、rapid zoom `14 → 16 → 15` 和约 440 px 连续 pan；两后端均保持可见覆盖，截图无矩形背景空洞，fresh WebGPU/WebGL2 页面无控制台 warning/error。证据：`docs/evidence/T013-webgpu-delayed-14-75.png`、`T013-webgpu-delayed-15-25.png`、`T013-webgpu-delayed-rapid-Out.png`、`T013-webgpu-delayed-rapid-In.png`、`T013-webgpu-delayed-rapid-Final.png`、`T013-webgpu-delayed-drag-frame.png`，以及对应 `T013-webgl2-delayed-*.png`。

人工验收：2026-09-10 人工负责人已接受 zoom/pan 连续性，T013 完成。

## Open Issues

- 任意瞬时 `setView()` 跨越远超当前 warm ancestor 覆盖范围时，旧 Tile 可能已离开新视口，在网络响应前露出背景；本 Task 的连续 pointer pan 与 rapid zoom 已验证，任意跨城 teleport 不作为无空洞保证。
- `tileRuntime.ts` 当前为 524 行；显示协调已拆分到独立模块，剩余超出 500 行目标的生命周期编排将在不扩大本 Task 行为范围的后续重构中处理。
