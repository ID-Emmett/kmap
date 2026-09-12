# T011 Diagnose and Fix Regular Grid Watermark Artifact

## Goal

复现用户在 T009 动态地图中报告的规则网格水印，确定它属于材质/纹理、样式语义、Tile 边界、Polygon/Line 几何、transform、透明叠加还是渲染排序问题，并修复已验证根因。

## Scope

- 使用 T009 初始与交互场景，在 WebGPU 和强制 WebGL2 下稳定复现并截图，记录达到可见状态的 zoom、viewport、pitch 和 bearing。
- 通过逐层隔离 water、landuse、building、road，并对比绿色/白色地表与水面，确认水印实际覆盖范围和触发条件。
- 将规则线位置与 XYZ Tile bounds 对照，检查相邻 Tile anchor、Float32 局部坐标、world wrap 和 MapOrigin 重定位；不得仅因规则而认定它是 Tile seam。
- 检查材质纹理/UV、重复采样、透明 Polygon 叠加、render order、抗锯齿、Polygon 边缘以及 Line 的 Tile 边缘端点。
- 修复经证据确认的最小根因；补充自动回归和真实浏览器证据。
- 若根因仅为当前 Playground 的错误颜色或错误图层映射，修复该映射并将完整浅色层级留给 T012；不得把颜色调整当作水印根因结论。

## Non-Goals

- 不在本 Task 完成整套浅色地图设计。
- 不用换成背景同色、隐藏所有 landuse/road/water 或关闭抗锯齿掩盖规则水印、真实 seam 或几何缺陷。
- 不实现文字、完整 Style v8、3D 建筑、跨 Tile 合批或新公共 API。
- 不顺带执行 T010 性能发布验收。

## Inputs

- T009 输出及 `docs/evidence/T009-*.png`。
- 用户自测报告及会话截图：规则网格水印覆盖绿色和白色地表，水面没有该效果；放大到一定程度后持续可见。
- `apps/playground/src/main.ts` 当前深色配置。
- `docs/visual-style-baseline.md` 的规则网格水印边界。
- `docs/architecture.md` 的 Tile 局部坐标、render instance 和 Batch 约束。
- `docs/research/kye-mvt-data-dictionary.md` 的 landuse/road 字段事实。

## Constraints

- 先形成可复现证据和根因，再选择修复；不得把推测写入 `KNOWLEDGE.md`。
- 必须保持 canonical/render Tile、Worker payload和 `Map3D` 公共 API 不变；若根因要求改变这些契约，返回决策会话。
- Feature 仍不创建独立 Object3D，跨 Tile 合批仍不进入 MVP。
- 临时 Tile bounds/debug color 只能存在于测试或验收过程，不进入默认 Playground UI。

## Acceptance Criteria

- Findings 明确记录复现 viewport、ViewState、backend、涉及图层和根因证据。
- Findings 明确区分规则网格水印与真实 Tile seam，并记录绿色/白色地表有水印而水面无水印的复现矩阵。
- 默认场景及 pan/zoom/bearing/pitch 后，不再出现覆盖非水面地表的非预期规则网格水印，也不出现与 XYZ Tile 边界对齐的接缝伪影。
- 单层隔离证明修复没有通过隐藏全部道路、土地或相邻 Tile 达成。
- WebGPU 与强制 WebGL2 均通过；相邻 Tile 接缝、world wrap 和 MapOrigin 重定位无回归。
- 动态加载、cache eviction 和 dispose 仍符合 T009/T008，`pnpm check` 通过。

## Test Plan

- 相邻 Tile anchor/边缘投影和 MapOrigin 重定位回归。
- Polygon/Line Tile-edge fixture 或最小合成几何测试。
- layer isolation 与 Tile-bound overlay 截图对比。
- 当前 Chromium WebGPU、强制 WebGL2 的初始、交互和 seam 放大截图。
- `pnpm --filter @nova/map3d test`、`pnpm check`。

## Status

DONE

## Findings

- 复现参数：当前 Chromium Windows，1280x720 CSS viewport，DPR 1.5，中心点 `116.3946533203125, 39.90552253972854`，zoom 15，bearing 0，pitch 0；默认 WebGPU 与 `?renderer=webgl2` 强制 WebGL2 均复现。
- 复现矩阵：单 Tile 基本无规则网格；多 Tile 时规则色带沿 XYZ Tile 边界出现。landuse（绿色、opacity 0.85）和 building（白色、opacity 0.92）可见，water（opacity 1）不可见；临时将相关 Polygon 改为不透明后色带消失。
- 诊断结论：未发现 `GridHelper`、debug grid 或 watermark API；色带与 Tile 边界完全重合。KYE MVT Polygon 顶点范围为 `-80..4176`，核心 extent 为 `0..4096`，相邻 Tile buffer 在半透明 Polygon 中重复覆盖并进行 alpha blend，形成规则网格伪影。
- 已排除：相邻 Tile Float32 世界边缘误差约 `0.000122 m`（小于 1 mm）；相邻 Tile 使用同一 MaterialRegistry 材质、Uniform 和 Shader 状态；Polygon/Line 均为 `depthTest: false`、`depthWrite: false`，临时关闭 depthTest 无变化，因此不是 Z-Fighting。
- 最小修复：在 Polygon Worker 构建阶段按 source-layer extent 使用 Sutherland-Hodgman 将每个三角形裁剪到 `[0, extent]`，不改变公共 API、Tile transform、Worker 协议、材质或 Line 几何。
- 回归：新增 `polygonClip` 单元测试、Polygon 顶点范围与相邻 Tile Float32 边缘误差断言、共享材质/depth 状态断言；WebGPU/WebGL2 修复后截图不再出现规则网格，用户已确认最终视觉结果。
- 证据：`docs/evidence/T011-before-webgpu-z15.png`、`T011-diagnostic-landuse-single-webgpu.png`、`T011-diagnostic-landuse-multi-webgpu.png`、`T011-diagnostic-landuse-opaque-multi-webgpu.png`、`T011-diagnostic-water-multi-webgpu.png`、`T011-diagnostic-building-multi-webgl2.png`、`T011-diagnostic-building-opaque-multi-webgl2.png`、`T011-diagnostic-full-opaque-webgl2.png`、`T011-after-webgpu-z15.png`、`T011-after-webgl2-z15.png`。

## Open Issues

- T012 仍负责浅色底图视觉收敛；T013-T015 仍负责渐进式 Tile 替换、交互阻尼和倾斜远景渐隐。本 Task 未扩大这些任务范围。
