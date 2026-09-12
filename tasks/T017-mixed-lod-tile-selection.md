# T017 Implement Mixed-LOD Frustum Tile Selection

## Goal

将当前单层级 Tile Coverage 与硬数量截断替换为基于 Frustum 和屏幕误差的混合 LOD 四叉树选择，在高 pitch、宽视口和数量预算下保持完整地面覆盖，同时让近景使用高层级、远景使用低层级。

## Scope

- 固化用户截图对应的高倾角左右缺 Tile 复现场景，并记录现有 candidate/selected/uncovered 证据。
- 新增单一职责的内部 Tile selector，输出可混合 canonical zoom 的非重叠 Target Coverage。
- Tile AABB/平面包围体与 Camera Frustum 相交测试。
- 基于 projected tile size 或 screen-space error 的 best-first 四叉树 refinement。
- 数量预算通过停止 refinement 或 child 合并回 parent 实现；禁止任意删除 coverage-critical Tile。
- source bounds、日期线 world wrap、source min/max zoom 和 maxZoom overzoom。
- LOD refinement/coarsening 迟滞，以及相邻区域层级差的连续性约束。
- 将 MapOrigin、ground footprint 和 horizon fade 使用的参考 zoom 与混合数据 zoom 解耦。
- 扩展内部 Tile priority 输入，使 coverage、refinement 和 prefetch 可被后续调度区分。
- 适配 T013 Target/Display Coverage、ancestor/descendant fallback、transition、display pin 和 stale target 抑制。
- WebGPU/WebGL2 高倾角、超宽视口、慢网和生命周期验证。

## Non-Goals

- 不实现运动方向预测、请求取消迟滞或 settled refinement；由 T018 负责。
- 不改变 Map3D 0.1 公共 API、Canonical/Render TileKey 公共结构、Worker protocol version 或 KYE 请求语义。
- 不引入完整 `maplibre-gl`、deck.gl、Terrain、Globe、3D Tiles、Raster 或持久化缓存。
- 不通过提高默认 `maxTiles`、CPU/GPU cache 预算、减少 Camera far plane或增强 horizon fade 隐藏空洞。
- 不实现 Mapbox Style v8 的 camera zoom 表达式语义；Layer `minZoom/maxZoom` 按被选中 Tile 的 canonical zoom 生效。

## Inputs

- D027 混合 LOD Tile Coverage 决策。
- `docs/research/tile-lod-scheduling.md`。
- T007 Camera/Tile Coverage、T008 Runtime/Cache、T013 Progressive Replacement、T015 Horizon Fade、T016 Geometry Reuse 输出。
- `docs/architecture.md` 的坐标、Tile、Target/Display Coverage、Cache 和资源所有权。
- 用户截图与 2026-09-10 代表性复算：默认中心、zoom 15、pitch 60、`2555 × 1385` 下 334 个候选仅保留 128 个。

## Constraints

- 任意数量预算下，视口地面区域必须由 selected Tile 或其 selected ancestor 完整覆盖。
- selected Target Coverage 在空间上不得存在父子重叠；T013 transition 期间的短时 Display overlap 除外。
- near/far LOD 必须由 Camera 与投影误差推导，不使用只适配北京或固定 viewport 的屏幕分带常数。
- visible coverage 优先于 refinement 和 prefetch；数量不足时降低细节，不制造空洞。
- 混合 LOD 必须保持 canonical 请求去重、world wrap consumer 共享和 byte-aware Cache 语义。
- 如需改变公共 API、Layer zoom 语义或 D015-D019/D023/D025/D027，返回决策会话。

## Acceptance Criteria

- 用户截图类场景在 WebGPU 与强制 WebGL2 中左右两侧无未加载背景缺口。
- pitch 0/40/60、bearing 0/45/90、16:9/超宽 viewport 的确定性屏幕采样点全部被 selected Tile 覆盖。
- 默认 Tile 数量上限下 `selected.length <= maxTiles`；预算不足时出现可解释的低层级 Tile，而不是 uncovered 区域。
- 高 pitch 场景同时存在近景高 zoom 与远景低 zoom Tile；远景建筑等高精细内容按 canonical LOD 自然隐藏。
- selected Target Coverage 无空间父子重叠，world wrap、source bounds、Y 边界和 overzoom 正确。
- T013 exact/fallback/outgoing、180 ms transition、display pin、rapid zoom stale 抑制和 dispose 无回归。
- T011 seam、T015 fade、T016 geometry sharing、CPU/GPU byte 统计和公共 API 无回归。
- `pnpm --filter @nova/map3d test` 与 `pnpm check` 通过，并完成人工浏览器视觉验收。

## Test Plan

- 纯数学 selector 测试：Frustum/AABB、SSE 单调性、best-first refinement、预算 coarsening、LOD hysteresis。
- 以规则屏幕采样网格发射地面射线，验证每个有效交点存在 selected Tile/ancestor 覆盖。
- 日期线、source bounds、min/max zoom、maxZoom overzoom、不同 FOV 等价 Camera frame 与 viewport resize。
- Fake Runtime：mixed zoom target、parent/child replacement、stale result、budget pressure 和 dispose。
- Chromium WebGPU/强制 WebGL2：用户截图场景、pitch/bearing 矩阵、`2555 × 1385` 或等价超宽 viewport、1500 ms 延迟。
- 记录每帧 selected Tile zoom 分布、candidate/refined/coarsened 数量、coverage sampling 结果和资源统计。

## Status

DONE

## Findings

- 2026-09-10：实施会话已启动，正在复核 D027、现有单层级 Coverage、T013 Display Coverage 与相关测试边界。
- 2026-09-10：新增 `mixedLodTileSelector.ts` 与 `mixedLodTileGeometry.ts`，使用 Camera Frustum/Tile AABB、projected tile size 和 best-first 四叉树 refinement 生成完整、非重叠的 mixed canonical zoom Target Coverage；预算通过停止细分或父级合并满足。
- 2026-09-10：默认 refine/coarsen 阈值确定为 320/224 CSS px，相邻 LOD 最大 zoom 差为 1；上一帧 Target Coverage 用于迟滞。source bounds、日期线 wrap、Y 边界、min/max zoom、overzoom 与 prefetch 均已适配。
- 2026-09-10：MapOrigin、ground footprint 与 horizon fade 改用 `referenceZoom`，与 mixed canonical data zoom 解耦；Runtime 增加 `coverage`、`refinement`、`prefetch` 静态 priority role，并保持 canonical 请求去重、cache 与 Display Coverage 语义。
- 2026-09-10：新增 selector 数学/屏幕射线矩阵、等价 FOV/viewport 测试与 mixed LOD Display Coverage parent/child replacement 回归。`pnpm --filter @nova/map3d test` 为 32 个文件、146 项测试通过；`pnpm check`、`git diff --check` 通过。
- 2026-09-10：代表性 `2555 × 1385`、DPR 1、zoom 15、pitch 60 场景由 513 个单层级候选选择为 127 visible + 1 prefetch，zoom 分布为 z13=22、z14=50、z15=55，`budgetExceeded=false`，屏幕采样完整覆盖。
- 2026-09-10：WebGPU、强制 WebGL2 及双后端 1500 ms 延迟 settled 画面左右覆盖完整且控制台无 warning/error；资源均为 CPU/GPU 119,552,544 bytes。双后端 lifecycle dispose 后 Tile、资源、Object 和 Worker 统计归零。结构化证据见 `docs/evidence/T017-browser-regression.json`。
- 2026-09-10：人工负责人已验收 WebGPU/WebGL2 高倾角超宽画面，确认 mixed LOD 视觉连续性，任务完成。

## Open Issues

- 连续相机运动中的 motion-direction priority、请求取消迟滞和 coarse-cover/full-refinement 时间由 T018/T019 继续验证，不属于 T017 的剩余实现。
