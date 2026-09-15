# 成熟地图引擎的瓦片覆盖、LOD 与调度资料核验

日期：2026-09-16。研究类型：公开规范、作者论文页面与固定版本源码核验。

## 证据状态与适用范围

本研究核验平面 XYZ/MVT 地图、栅格地图和三维地形的机制及差异。条目标记为“代码已确认”“公开资料已确认”“待验证”或“未发现”。Kmap 的架构适配建议单独保存在 [评审方案](../ai-sessions/2026-09-16-industry-tile-proposal.md)。

本次完成公开资料读取和文档检查。Kmap 当前运行时的事实引用 [2026-09-15 审计](tile-overlap-and-pitch-audit-2026-09-15.md)；本次没有新增真实浏览器、GPU 时间或视觉连续性实验。

原始资料位于 `docs/evidence/industry-tile-research-2026-09-15/`。`sources.json`、`supplemental-sources.json`、`three-tiles-sources.json`、`3dtiles-spec-source.json` 保存下载 URL、提交号和 SHA256。研究于 09-15 开始、09-16 完成。

## 1. 固定版本与主要来源

| 来源 | 本次读取版本 / 提交 | 范围 |
| --- | --- | --- |
| MapLibre GL JS | v6.9.1 / `b044d9f8de4ee1c22430c1b79d10e004e5e86994` | 平面地图局部 LOD、父子回退、矢量裁剪、栅格过渡、LRU |
| Mapbox GL JS | v3.30.0 / `446bbe66962e288ae9b2ab8b500b92dfa4da892a` | 雾剔除条件、雾空间距离、地形例外 |
| OpenLayers | v10.10.0 / `a23f25832d9d24ded41a33881d9983ee7df4a94f` | Canvas 栅格回退、剩余区域绘制、预加载、请求优先级 |
| CesiumJS | 1.145 / `845a06b71d37a38604a8045a479dd3567453009a` | 地形 SSE、雾、祖先预加载、分级加载队列 |
| NASA-AMMOS 3DTilesRendererJS | v0.5.2 / `a46418bdc94fecd4713643287839e9562f6a6a69` | Three.js 生态的下载/解析队列、取消、LRU、三维细化 |
| 3D Tiles 公开规范源码 | `2177ba116cfeda0ff712c9a500ae14be1c6324d3` | geometric error、SSE、REPLACE / ADD |
| Losasso / Hoppe，SIGGRAPH 2004 | 作者公开论文页面 | Geometry clipmaps、增量更新与地形复杂度控制 |

固定版本源码链接：

- [M1：MapLibre TileManager](https://github.com/maplibre/maplibre-gl-js/blob/b044d9f8de4ee1c22430c1b79d10e004e5e86994/src/tile/tile_manager.ts)：`_updateRetainedTiles` 669–722，退出视图的缓存/取消 815–833。
- [M2：MapLibre Painter](https://github.com/maplibre/maplibre-gl-js/blob/b044d9f8de4ee1c22430c1b79d10e004e5e86994/src/render/painter.ts)：矢量 stencil 292–351、399–401，栅格重叠 stencil 404–436。
- [M3：MapLibre draw_raster](https://github.com/maplibre/maplibre-gl-js/blob/b044d9f8de4ee1c22430c1b79d10e004e5e86994/src/webgl/draw/draw_raster.ts)：76–77、108–180；[栅格 shader](https://github.com/maplibre/maplibre-gl-js/blob/b044d9f8de4ee1c22430c1b79d10e004e5e86994/src/shaders/glsl/raster.fragment.glsl) 18–28。
- [M4：MapLibre covering_tiles](https://github.com/maplibre/maplibre-gl-js/blob/b044d9f8de4ee1c22430c1b79d10e004e5e86994/src/geo/projection/covering_tiles.ts)：130–177、268–385；[推导文档](https://github.com/maplibre/maplibre-gl-js/blob/b044d9f8de4ee1c22430c1b79d10e004e5e86994/developer-guides/covering-tiles.md)。
- [M5：Mercator LOD 启用条件](https://github.com/maplibre/maplibre-gl-js/blob/b044d9f8de4ee1c22430c1b79d10e004e5e86994/src/geo/projection/mercator_covering_tiles_details_provider.ts) 44–47。
- [B1：Mapbox 雾剔除参数](https://github.com/mapbox/mapbox-gl-js/blob/446bbe66962e288ae9b2ab8b500b92dfa4da892a/src/render/painter.ts) 488–512；[Transform 选片过滤](https://github.com/mapbox/mapbox-gl-js/blob/446bbe66962e288ae9b2ab8b500b92dfa4da892a/src/geo/transform.ts) 1644–1704；[CPU 雾函数](https://github.com/mapbox/mapbox-gl-js/blob/446bbe66962e288ae9b2ab8b500b92dfa4da892a/src/style/fog_helpers.ts) 21–35。
- [O1：OpenLayers Canvas TileLayer](https://github.com/openlayers/openlayers/blob/a23f25832d9d24ded41a33881d9983ee7df4a94f/src/ol/renderer/canvas/TileLayer.js) 639–730、815–855；[TileQueue](https://github.com/openlayers/openlayers/blob/a23f25832d9d24ded41a33881d9983ee7df4a94f/src/ol/TileQueue.js)。
- [C1：Cesium QuadtreePrimitive](https://github.com/CesiumGS/cesium/blob/845a06b71d37a38604a8045a479dd3567453009a/packages/engine/Source/Scene/QuadtreePrimitive.js) 108–152、894–966、1248–1273、1311–1384；[GlobeSurfaceTileProvider](https://github.com/CesiumGS/cesium/blob/845a06b71d37a38604a8045a479dd3567453009a/packages/engine/Source/Scene/GlobeSurfaceTileProvider.js) 749–759。
- [C2：Cesium Fog 文档](https://cesium.com/learn/cesiumjs/ref-doc/Fog.html)；[固定版本 Fog 源码](https://github.com/CesiumGS/cesium/blob/845a06b71d37a38604a8045a479dd3567453009a/packages/engine/Source/Scene/Fog.js) 26–82、122–159。
- [T1：3DTilesRendererJS TilesRendererBase](https://github.com/NASA-AMMOS/3DTilesRendererJS/blob/a46418bdc94fecd4713643287839e9562f6a6a69/src/core/renderer/tiles/TilesRendererBase.js) 37–110、330–343、1553–1612、1641–1758；[PriorityQueue](https://github.com/NASA-AMMOS/3DTilesRendererJS/blob/a46418bdc94fecd4713643287839e9562f6a6a69/src/core/renderer/utilities/PriorityQueue.js)。
- [S1：3D Tiles 规范公开源码](https://github.com/CesiumGS/3d-tiles/blob/2177ba116cfeda0ff712c9a500ae14be1c6324d3/specification/README.adoc#core-refinement) 169–206。
- [P1：Geometry clipmaps: Terrain rendering using nested regular grids](https://hhoppe.com/proj/geomclipmap/)，Frank Losasso、Hugues Hoppe，ACM Transactions on Graphics 23(3)，SIGGRAPH 2004。

## 2. 父子瓦片的保留与覆盖

### 2.1 平面地图中的可用回退

**代码已确认，M1、O1：** MapLibre 根据当前视图计算 ideal tiles 并请求目标。对缺数据的目标，寻找已加载的子级覆盖；子级覆盖不足时寻找父级。祖先搜索有层级范围、请求状态判断和去重，遇到可用父级时停止该向上的搜索。OpenLayers 同样寻找缓存的替代瓦片、子级和父级。

因此，父子回退是实际生产地图使用的连续显示机制。其范围由当前目标、可用数据和过渡依赖决定。“每个目标无条件加载多级祖先”“每一级依次完整加载后才加载下一层”属于独立策略。Cesium 对后一策略的代价有明确说明：`loadingDescendantLimit=0` 会显著增加总体加载时间（C1 123–129）。

**代码已确认，C1：** Cesium 提供 `preloadAncestors` 和 `preloadSiblings` 开关，并记录缩小/平移收益及增加加载量的成本。本版本默认祖先预加载开启、兄弟预加载关闭。该默认值属于地形引擎的选择。

### 2.2 矢量地图的 stencil 裁剪

**代码已确认，M2：** MapLibre 为瓦片分配 stencil ID，按通常的 z 升序写入瓦片区域遮罩。子级区域后写入，覆盖该区域的父级 ID。矢量绘制使用 stencil `EQUAL` 测试。

调用点已核对：`src/webgl/draw/draw_fill.ts:179` 与 `draw_line.ts:251` 均使用 `stencilModeForClipping(coord)`。面、线各自保持正常样式绘制关系。

父级网格和子级网格可以同时存在于提交列表。父级在已被子级接替区域的片元受到遮罩限制。因此以下计数含义不同：

| 计数 | 含义 |
| --- | --- |
| 驻留层级数 | 内存里保存了多少级数据 |
| 提交层级数 | GPU 收到了哪些层级的绘制指令 |
| 有效来源数 | 同一来源/样式图层、同一空间区域由哪些数据版本贡献画面 |
| fragment / pass 数 | 实际绘制工作，包含面、线、抗锯齿和透明叠加 |

“父级只覆盖尚未被子级接替区域”可以描述这个机制的有效贡献范围。GPU stencil 能实现这一范围，CPU 无需每帧将所有父级几何切成碎片。Stencil 仍有遮罩、提交和几何处理成本；具体收益需要 GPU 测量。

### 2.3 栅格地图中的过渡

**代码已确认，M3：** MapLibre 的平面 raster 路径按 z 降序绘制，并通过重叠 stencil 限制低层级区域。父纹理与当前纹理同时绑定，父级 UV 根据层级差变换；fragment shader 采样两张纹理并 `mix`。这里的双来源过渡可以发生在一次瓦片绘制中。

**代码已确认，O1：** OpenLayers 对稳态较低 z 瓦片计算被高 z 覆盖后剩余的矩形区域。目标瓦片处于淡入时，fallback 保持在下面，目标瓦片进入第二遍绘制。源码 829–830 明确描述只绘制尚未被更高 z 覆盖的部分。

这些实现共同支持连续覆盖，实际提交与混合方式各有区别。MapLibre 的 raster 父子淡变与矢量图层的 pattern crossfade、symbol fading 具有不同语义。

### 2.4 三维数据的 REPLACE 与 ADD

**公开规范已确认，S1：** `REPLACE` 表示子级替换父级；`ADD` 表示父级和子级同时构成内容。二者由 tileset 声明，可在同一树中组合。

**代码已确认，C1、T1：** 三维引擎的替换遍历会考虑子树可渲染性、上一帧显示和祖先依赖。Cesium 存在“所需后代尚未全就绪且上一帧没有后代显示时，选择父级”的分支。3DTilesRendererJS 也区分 ADD 和 REPLACE。

地形网格可能有拼缝、裙边或拓扑连续性要求；MVT 平面裁剪具有不同条件。S1 的两种细化模式不能直接作为 Kmap 平面瓦片的唯一替换算法。

## 3. 大倾角选片与雾

### 3.1 MapLibre 的局部层级

**代码已确认，M4、M5：** MapLibre 四叉树遍历先测试包围体与视锥/投影裁剪平面，再根据局部距离计算所需层级。是否启用可变层级取决于地形、pitch、FOV 和 roll。层级计算使用相机至瓦片包围体的地面距离、相机高度、相机至中心距离及 FOV。

该版本 `createCalculateTileZoomFunction` 还使用 `maxZoomLevelsOnScreen`、`tileCountMaxMinRatio` 控制倾角产生的细节范围与瓦片数量变化。局部目标经过 round/floor，并由数据源最大层级限制；`canonical.z` 与 `overscaledZ` 分开处理。

局部层级可以随视图位置变化，其上限并非统一的 `floor(viewZoom)+2`。256/512 tile size 会参与中心 zoom 换算；源码明确按 `transform.tileSize / options.tileSize` 修正。

**公开资料已确认，M4 推导文档：** 文档从地面条带面积、斜距和投影尺度分析瓦片量；同时明确把尺度公式描述为具有有用性质的可调公式。等屏幕宽度、面积和高度对应不同取舍。文档中的 b=1 默认说明和源码按配置计算 b 的表达分开保留，运行默认以固定版本源码为核验对象。

成熟引擎包含生产验证的启发式和可调参数。数学推导与运行策略共同构成方案，来源本身没有宣称全场景最优。

### 3.2 Mapbox 的雾剔除条件

**代码已确认，B1：** 平面地图的 fog culling 由真实雾参数推导距离。当前分支要求投影和雾满足条件，例如 fog opacity 足够、horizon-blend 达到门槛；globe 使用另一条处理路径。

`Painter._updateFog` 注释说明采用约 98% 雾不透明度作为不可察觉变化阈值，随后计算 fog cull distance。`Transform` 将候选瓦片转换到 fog space，计算 AABB 最近距离并过滤。地形高出地平线时存在保留例外，以维持山体纹理。

CPU 的 `getFogOpacity` 注释要求与 shader 匹配。这里的 98%、pitch 和 horizon 条件属于该版本的工程参数，适配至另一雾模型需要重新核对。

### 3.3 Cesium 的雾与误差放宽

**代码/官方文档已确认，C1、C2：** 地形完全入雾时返回不可见。部分入雾时从计算出的 SSE 中减去与雾相关的项，使远处更容易满足误差门槛、采用较粗地形。该算法有实际 geometric error 输入。

Cesium 还暴露 `renderable` 与 `visualDensityScalar`，允许将视觉雾强度和加载优化分开控制。这说明“渲染雾和选片数学完全相同”并非所有引擎的 API 规定；画面与剔除边界的一致性仍需要产品验证。

**待验证：** Kmap 雾颜色、渐变、截止与默认最大 pitch 对应的最佳配置；近处纹理采样、MVT 几何细节和性能之间的可接受误差。MVT 层级并不自动携带 3D Tiles 的米制 geometric error。

## 4. 调度、预加载、缓存与回收

**代码已确认：**

| 机制 | 来源中的实际做法 |
| --- | --- |
| 当前需求和替代显示分开 | MapLibre 先计算 ideal，再保留可用父子与过渡依赖（M1） |
| 优先队列 | OpenLayers 根据需要集合、分辨率和距焦点距离排序，过期需求返回 DROP（O1） |
| 加载并发有界 | OpenLayers `loadMoreTiles(maxTotalLoading, maxNewLoads)`（O1） |
| 下载与解析独立 | 3DTilesRendererJS 下载、解析、节点展开分别排队，有独立并发与优先级（T1） |
| 每次执行前重排 | 3DTilesRendererJS PriorityQueue `tryRunJobs` 先 sort（T1） |
| 取消关联回收 | 3DTilesRendererJS 卸载时 AbortController.abort，并移除下载和解析队列项（T1） |
| 按帧时间处理 | Cesium High/Medium/Low 加载队列有 time slice，并保证至少一次加载进度（C1） |
| 退出视图缓存 | MapLibre 有数据的非 reloading 瓦片转入 LRU；未就绪瓦片取消并卸载（M1） |
| 预测与预加载 | OpenLayers 使用 nextExtent/nextResolution；较粗层级 preload 可配置（O1）；Cesium 祖先/兄弟预加载可配置（C1） |
| 回收保护 | Cesium 文档说明上一帧仍用于绘制的瓦片受保护，实际数量可超 nominal cache size（C1） |

并发数字、优先级比较公式、祖先/兄弟预热默认值均为各引擎策略。分阶段缓存的准确划分也各不相同。Kmap 的 HTTP/编码数据、CPU 构建产物、GPU 驻留三层独立预算属于需要验证的适配设计。

## 5. 公开论文提供的依据

**公开资料已确认，P1：** Losasso / Hoppe 的 Geometry clipmaps 在观察者周围缓存嵌套规则地形网格，在视点移动时增量填充；作者摘要说明视觉连续性、帧率一致性、复杂度控制和渐进降级。摘要报告的 60 fps 对应论文的实验系统。

本次读取作者页面的摘要与后续说明。该资料支持“有界工作集、复用、增量更新”的地形设计依据，其数据结构面向高度场。对 XYZ MVT 的道路、面样式、异步网络和跨瓦片裁剪，M1–M5 与 O1 的实现更直接。

## 6. 结论的证据边界

- **已确认：** 层级化数据、视图相关 LOD、可用父子回退、按类型裁剪/混合、有界加载、缓存回收在所核验的成熟引擎中有实际实现。
- **已确认：** 雾能参与远处剔除及地形细节放宽；剔除条件取决于具体雾、投影和地形处理。
- **已确认：** 保留父子资源、提交父子指令、让父子片元同时贡献画面具有不同含义。
- **未发现：** 本次资料中没有要求所有平面地图永久绘制一层独立基础瓦片，或无条件加载所有祖先。
- **未发现：** 本次资料中没有“所有瓦片场景均采用最多两层 / 140 ms”“顶部固定 15%”“近处固定加两级”的统一规范，也没有“LOD + 视锥 + 预加载 + 卸载全场景最高效”的证明。
- **待验证：** Kmap 中 stencil 与其 Three.js WebGPU 管线、面纹理/线实例、透明度、AA 和雾的组合性能；新覆盖、队列、缓存方案的实际视觉与帧率。
- **未核验：** 高德内部调度与渲染实现。本报告的来源归属限于表中资料。

OGC 发布页与 Mapbox fog 网页读取出现网络失败，NVIDIA GPU Gems 页面返回不完整响应；这些页面未作为正文事实依据。3D Tiles 条文使用规范公开仓库固定提交，Mapbox 机制使用固定版本源码，论文使用作者页面。

## 7. 复用边界

MapLibre 根许可证为 BSD 3-Clause 条款；源码移植需要保留相应版权和许可说明。3DTilesRendererJS 根许可证为 Apache-2.0。Mapbox 当前根许可证限定相关产品与服务使用，适合作为行为研究材料；源码复用范围需要依据实际授权确定。具体第三方文件依赖和头部许可需在移植时逐项核对。

本次仅保存研究证据，运行时依赖数量与生产代码保持进入时状态。
