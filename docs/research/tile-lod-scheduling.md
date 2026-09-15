# 高倾角 Tile LOD 与调度方案研究

研究日期：2026-09-10

## 研究目标

为 Kmap 在高 pitch、宽视口和连续相机运动下的 Tile Coverage 与加载体验提供可追溯事实输入，重点判断：

- 当前左右区域不加载是否属于 Coverage 正确性问题。
- 业界是否存在成熟的混合 LOD、父子替换和请求调度实现。
- 哪些算法可以在不引入另一套地图 Runtime 的前提下适配 Kmap。

## Kmap 当前代码证据

状态：代码已确认，并于 2026-09-10 使用现有实现执行代表性复算。

- `calculateTileCoverage()` 使用单一 `floor(view.zoom)` 数据层级计算全部可见 Tile。
- 高 pitch 地面 footprint 按 `maxGroundDistance` 截断；该距离又由 `maxTiles` 推导。
- visible 与 prefetch 合并排序后直接执行 `entries.slice(0, maxTiles)`；visible Tile 的同级优先级主要依据 Tile 中心到屏幕中心的距离。
- T013 Display Coverage 只处理已经进入 Target Coverage 的 Tile。被 Coverage 截断的区域没有 exact target，ancestor/outgoing fallback 无法为其建立完整覆盖。

代表性复算使用 Playground 默认中心、view zoom 15、pitch 60、viewport `2555 × 1385` 和默认 `maxTiles=128`：

| 指标 | 结果 |
| --- | ---: |
| footprint 内候选 visible Tile | 334 |
| 最终 selected visible Tile | 128 |
| 被截断 Tile | 206 |
| footprint 最远一排候选/保留 | 29 / 7 |

该 ViewState 不保证与用户截图完全相同，但结果证明当前算法会确定性地删除视口左右两侧的 coverage-critical Tile。提高 `maxTiles` 也不是稳定修复，因为当前实现会同时扩大 `maxGroundDistance` 和候选 footprint。

## MapLibre GL JS

状态：已验证官方文档、官方源码和许可证。

官方入口：

- Covering Tiles 开发文档：<https://maplibre.org/maplibre-gl-js/docs/topics/developer-guides/covering-tiles/>
- `covering_tiles.ts`：<https://github.com/maplibre/maplibre-gl-js/blob/main/src/geo/projection/covering_tiles.ts>
- `setSourceTileLodParams()`：<https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/#setsourcetilelodparams>
- BSD-3-Clause License：<https://github.com/maplibre/maplibre-gl-js/blob/main/LICENSE.txt>

已确认行为：

- `coveringTiles()` 从低层级 Tile 开始进行四叉树遍历。
- 每个候选 Tile 使用包围体与 Frustum 判断是否与视图相交。
- 目标层级可根据 Tile 到 Camera 的距离分别计算；高 pitch 下允许同屏出现多个 Tile zoom，远处使用更低层级。
- 官方 API 暴露 `maxZoomLevelsOnScreen` 和 `tileCountMaxMinRatio` 两个高倾角 LOD 调校参数。
- MapLibre SourceCache 会保留可用 parent/child Tile，为尚未加载完成的理想 Tile 提供覆盖。

适用判断：

- 四叉树、Frustum/AABB、按屏幕误差细分和父子保留适合 Kmap 当前平面 Web Mercator Camera。
- MapLibre 内部代码依赖其 Transform、Projection、OverscaledTileID、SourceCache 和渲染体系，不能作为无适配的独立模块直接导入。
- 可以在遵守 BSD-3-Clause 声明的前提下参考或移植算法，但不应引入完整 `maplibre-gl` Runtime。

## deck.gl TileLayer

状态：已验证官方 API 文档。

官方入口：<https://deck.gl/docs/api-reference/geo-layers/tile-layer>

已确认行为：

- `best-available` refinement 在理想 Tile 未完成时显示已加载的最近层级 Tile。
- 支持 `maxRequests`、`debounceTime`、请求取消和视口相关 Cache 容量。
- 文档明确区分视口所需 Tile、后台请求和 Cache 保留。

适用判断：

- 可作为 Kmap 请求调度、取消迟滞、settled refinement 和 Cache 指标的参考。
- deck.gl TileLayer 自带 Layer/Viewport/Renderer 生命周期，不适合替换 Kmap 的 Three.js Tile Runtime。

## 候选方案

### 方案 A：全局降低数据 zoom

当单层级候选数超过预算时，将整个 footprint 降低一个或多个 zoom，直到能够完整覆盖。

- 优点：实现较小，可快速消除硬截断空洞。
- 缺点：近景与远景一起降级，高精细道路和建筑过早消失；不能形成长期 3D 地图体验。
- 结论：只适合作为短期安全降级，不作为目标架构。

### 方案 B：混合 LOD 四叉树选择

从完整覆盖视锥的粗层级开始，按 projected tile size 或 screen-space error 对最需要细化的节点进行 best-first refinement；预算不足时保留父 Tile，不删除 coverage-critical 区域。

- 优点：近景高精度、远景低精度；天然满足数量预算与覆盖完整性；与 T013 父子 fallback 方向一致。
- 缺点：需要重构 Coverage 选择、优先级和相关测试；需处理 LOD 邻接、迟滞和 Layer zoom 语义。
- 结论：推荐作为 Kmap 目标方案。

### 方案 C：固定屏幕分带

按屏幕近、中、远区域固定使用 `z/z-1/z-2`。

- 优点：实现直观。
- 缺点：依赖视口、FOV 和 pitch 调参，容易产生层级带、抖动和特殊场景；缺少通用误差模型。
- 结论：不推荐。

## 推荐边界

- 保留 Canonical/Render TileKey、Source/Worker/Render adapter、byte-aware Cache 和 T013 Target/Display Coverage。
- 新增内部 mixed-LOD selector，输出空间上完整、不重叠但 zoom 可不同的 Target Coverage。
- Tile 数量预算通过停止细分或 child 合并回 parent 实现，不再任意截断 visible Tile。
- Layer `minZoom/maxZoom` 继续按被选中 Tile 的 canonical zoom 生效；远景低 LOD 自然隐藏建筑等高精细内容。该语义已由人工负责人于 2026-09-10 确认。
- T015 当前实现仍只负责视觉融合；D029 已批准 T022 将 fogStart/fogEnd/loadCutoff 接入有效 Coverage 边界。fogEnd 前不得隐藏加载空洞，loadCutoff 外允许停止 Tile 请求和渲染。
- 不新增完整 `maplibre-gl` 或 deck.gl 运行时依赖；如实质移植 MapLibre 源码，保留 BSD-3-Clause 声明并记录修改。

## 待实施验证

- pitch 0/40/60、bearing 0/45/90、16:9 与超宽视口的屏幕采样覆盖不变量。
- mixed LOD 相邻区域的道路/Polygon 连续性和允许的最大 zoom 差。
- 高速 pan/zoom/rotate 下的 Retained Cache hit、coarse-cover time、full-refinement time、重复请求、取消请求和废弃 Worker 结果。
- parent/children spatial replacement cohort、same-zoom pan cache hit 和 Render instance/material churn。
- fogEnd 前 Coverage sampling、loadCutoff 外请求停止和高倾角资源 before/after。
- WebGPU/WebGL2 的 CPU/GPU bytes、frame P95、upload P95 和 long task 回归。
