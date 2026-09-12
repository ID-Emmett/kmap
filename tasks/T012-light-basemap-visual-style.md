# T012 Implement Light Basemap Visual Baseline

## Goal

在不扩大 Map3D 0.1 公共 API 的前提下，为官方 Playground 建立原创的 Apple Maps-inspired 浅色矢量底图，并形成 MVP 可视验收基线。

## Scope

- 将 Playground 深色背景和临时高对比配色替换为 `docs/visual-style-baseline.md` 的浅色 token。
- 从 fixture/真实 KYE 样本统计实际 landuse 与 road 分类值并记录证据。
- 使用多个现有 fill/line layer 和 filters 建立中性 landuse、植被、水体、建筑、普通道路、主干道路的层级。
- 道路使用 casing + fill；绿色只用于经字段确认的植被类别。
- 视需要覆盖低 zoom `transportation`，但必须有样本证据。
- 将 Playground 样式配置从 bootstrap 职责中分离为单一职责模块，并同步 README 示例。
- 保存低、中、高 zoom 和双后端 before/after 证据。

## Non-Goals

- 不复制 Apple 的专有样式、标识、字体、图标或资产，不承诺像素级一致。
- 不实现文字/Glyph/Sprite、完整 Mapbox Style v8、运行时换肤或公开 style preset API。
- 不修改 Tile Runtime、Worker 协议、坐标模型、Cache 或资源生命周期。
- 不通过样式颜色掩盖 T011 未解决的 Tile seam。

## Inputs

- T011 已完成的根因与回归结论。
- `docs/visual-style-baseline.md`。
- `docs/research/kye-style.md`、`kye-mvt-data-dictionary.md`。
- T009 动态 Polygon/Line Runtime 与现有公共 Layer options。

## Constraints

- SDK 保持通用，KYE URL 和官方视觉 recipe 仍由 Playground 显式配置。
- 新硬编码颜色和分类映射必须在视觉基线/Task Findings 中记录来源与含义。
- 只使用已批准的 fill/line、zoom、filters 能力；若需要表达式或公共 API 扩展，返回 Project Control。
- 自定义材质变化仍使用 TSL / Node Material，Three.js 版本不变。

## Acceptance Criteria

- 默认画面为浅色中性底图，不再是深色主题或大面积深绿。
- 绿色只落在已验证的植被分类；residential/commercial/industrial 等非植被区域保持中性色。
- water、building、普通道路、主干道路有清晰但克制的视觉层级，道路不形成压过底图的高亮网格。
- 低、中、高 zoom 和 pan/zoom/bearing/pitch 下样式连续，无明显 Tile 边界色差。
- WebGPU 与强制 WebGL2 肉眼一致，自动测试和 `pnpm check` 通过。
- 人工负责人完成最终视觉接受；未通过时保留为 VERIFYING，不直接进入 T010。

## Test Plan

- Playground style recipe 的 layer order、id、filter、zoom 和 token 单元测试。
- 对固定 fixture 验证各分类命中数，防止过滤器把全部道路/landuse 隐藏。
- 低、中、高 zoom 的 Chromium WebGPU/强制 WebGL2 截图。
- 初始、pitch/bearing 和连续 pan/zoom 人工视觉检查。
- `pnpm check`。

## Status

DONE

## Findings

- 样式职责已从 `apps/playground/src/main.ts` 分离到 `apps/playground/src/mapStyle.ts`，包含固定浅色 token、图层顺序和过滤器；SDK 公共 API、Tile Runtime、Worker 协议、坐标模型、Cache 与资源生命周期均未修改，也未新增依赖。
- 当前配方按中性 landuse、植被 landuse、水体、水道、建筑、普通道路 casing/fill、主干道路 casing/fill、低 zoom `transportation` trunk casing/fill 排列，共 11 个 Playground 图层。绿色仅由 `landuse.class == grass` 命中；`class != grass` 的 landuse 保持中性。
- 固定真实 fixture `z15/26978/12416` 统计：landuse 39 个，其中 grass 30 个、非 grass 9 个（`viewpoint`、`parking_entrance`、`yes`、`public_building`）；road 386 个，其中主干过滤命中 42 个（样本实际为 `primary`），普通过滤命中 344 个（`unclassified`、`pedestrian`、`tertiary`、`secondary`、`service`、`light_rail` 等）。低 zoom `transportation.class == trunk` 来自真实 z5 样本研究证据。
- 浏览器验证环境：当前 Windows Chromium，1280x720 CSS viewport，DPR 1.5，中心点 `116.3946533203125, 39.90552253972854`；WebGPU 与强制 WebGL2 均检查 z15、z10、z5。画面为浅中性背景，水体浅蓝，建筑冷灰，植被仅呈浅绿，道路通过灰色/白色 casing + fill 与低饱和黄色主干层级区分；无控制台 warning/error。
- 交互验证：WebGL2 在 z10 完成 pan，并以 Shift 拖拽验证 bearing 30°、pitch 12°，配色与层级保持连续；WebGPU 的 z15/z10/z5 截图与 WebGL2 肉眼一致。
- 证据：T009/T011 深色 before 参考为 `docs/evidence/T009-webgpu-initial-2026-09-09.png`、`T009-webgl2-initial-2026-09-09.png`、`T011-before-webgpu-z15.png`；T012 after 为 `T012-after-webgpu-z15.png`、`T012-after-webgpu-z10.png`、`T012-after-webgpu-z5.png`、`T012-after-webgl2-z15.png`、`T012-after-webgl2-z10.png`、`T012-after-webgl2-z5.png`、`T012-after-webgl2-bearing-pitch.png`。
- 自动验证：`apps/playground/src/mapStyle.test.ts` 覆盖 token、图层顺序、fixture 分类命中和 road 分区；Playground 2 个测试文件共 4 项通过，`pnpm check` 全部通过。

## Open Issues

- 当前 MVP 无文字，因此视觉目标是浅色地图骨架，不是完整 Apple Maps 体验。
- 人工负责人已确认本轮视觉结果，T012 验收完成。
- T013 仍负责渐进式 Tile 替换；T014/T015 仍负责阻尼交互和倾斜远景渐隐。
