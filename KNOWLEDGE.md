# Nova Verified Knowledge

仅记录已经由 research、代码或运行结果验证的事实。日期使用验证或导入日期；证据链接指向仓库内可追溯材料。

## Data

### 2026-09-08 — KYE 主瓦片协议

- 内容：主地图瓦片是 gzip 压缩 MVT/PBF，实测 MVT version 2、extent 4096，坐标为标准 Web Mercator XYZ。
- 证据：`docs/research/kye-data.md`、`docs/research/README.md`。
- 影响范围：数据请求、解压、解码、TileKey 和坐标转换。

### 2026-09-08 — T004 真实 KYE MVT fixture

- 内容：`z15/26978/12416` 实时响应为 HTTP 200、`Content-Encoding: gzip`、压缩 `Content-Length: 17,909`；Fetch/curl 解压后为 35,594 bytes，SHA-256 为 `46f4ff67546c8ca229d76b5e31e4758cdf7b31588657dc9c89702aa62482202f`。解码结果为 water 4、landuse 39、poi_label 17、building 233、road 386、waterway 1，各 layer 为 MVT version 2、extent 4096。
- 证据：`packages/map3d/test/fixtures/kye-main-z15-26978-12416.*`、`packages/map3d/test/decodeMvt.test.ts`，以及 2026-09-08 实时请求验证。
- 影响范围：T005 Worker/Geometry 固定输入、T006 真实 Polygon 纵向链路和后续回归测试。

### 2026-09-08 — MVT 解码依赖与 bundle

- 内容：SDK 使用 `pbf` 5.1.2 和 `@mapbox/vector-tile` 3.0.0；两者均为 BSD-3-Clause、ESM 并内置 TypeScript 类型。独立 minified decoder bundle 为 15,325 bytes、gzip 4,457 bytes，未包含 Three.js。
- 证据：`packages/map3d/package.json`、`pnpm-lock.yaml`、T004 Vite 独立入口构建结果。
- 影响范围：后续 Worker bundle、发布许可清单和性能预算。

### 2026-09-08 — KYE Style 与资源

- 内容：生产 normal Style 为 Mapbox Style v8，包含 9 个 sources、51 个 layers；Glyph 使用 Microsoft YaHei Regular；Sprite 约 316 项。
- 证据：`docs/research/kye-style.md`、`docs/research/kye-glyph-sprite.md`。
- 影响范围：样式解释、文字、图标和兼容性规划。

### 2026-09-08 — 动态业务 MVT/Geobuf

- 内容：动态业务瓦片为未压缩 MVT，属性中的 `geoBuf` 是 Base64 包装的 Geobuf PBF；样本可解码为 FeatureCollection/MultiPolygon。
- 证据：`docs/research/dynamic-mvt.md`。
- 影响范围：业务数据解码、投影识别和几何类型处理。

## Tile

### 2026-09-08 — 空瓦片响应

- 内容：部分专用水系和行政区无数据瓦片会返回 HTTP 204 与空 body，不能按解析失败处理。
- 证据：`docs/research/kye-data.md`、`docs/research/kye-mvt-data-dictionary.md`。
- 影响范围：请求状态、负缓存和错误分类。

### 2026-09-08 — Nova 核心空间契约

- 内容：SDK 已实现 Float64 Web Mercator、连续 XYZ Tile、MVT Tile 局部米坐标、Canonical/Render TileKey、source zoom/overzoom 和 MapOrigin 纯函数；单元测试验证日期线 wrap、Y 越界、相邻 Tile 接缝和浮动原点重定位。
- 证据：`packages/map3d/src/spatial/`、`packages/map3d/test/mercator.test.ts`、`packages/map3d/test/tileKey.test.ts`、`packages/map3d/test/mapOrigin.test.ts`，以及 2026-09-08 `pnpm check` 结果。
- 影响范围：T004 请求键、T005 Geometry 局部坐标、T007 Camera/Tile Coverage 和 T008 Cache。

## Geometry

### 2026-09-08 — T005 Polygon batch 契约

- 内容：SDK 已实现 `==`、`!=`、`in`、`!in`、`has` 五种属性过滤，按 MVT ring winding 组织 outer/hole，并输出 Tile 局部 Float32 XYZ positions、Uint32 indices、逐顶点 featureIds、feature ranges 和 tile-local feature table；同一 public layer/material 的 Polygon Feature 合入单批次，不创建 Feature 级 Three.js 对象。
- 证据：`packages/map3d/src/geometry/`、`packages/map3d/test/filter.test.ts`、`packages/map3d/test/polygonBatch.test.ts`，以及 2026-09-08 `pnpm check` 结果。
- 影响范围：T006 固定 Polygon 渲染、T009 动态 Runtime 和后续 Picking 数据契约。

## Worker

### 2026-09-08 — T005 Worker Polygon pipeline

- 内容：SDK 已实现 `protocolVersion: 1` 的 build/cancel/success/error、jobId/generation、1 到 4 个 Worker 的 Pool、stale/dispose 拒绝挂载和输入/主要输出 ArrayBuffer transferable；受控 Node adapter 验证 transfer 后原 buffer 被 detach。
- 证据：`packages/map3d/src/worker/`、`packages/map3d/test/workerPipeline.test.ts`，以及 2026-09-08 `pnpm check` 结果。
- 影响范围：T006 Tile GPU upload、T008 Tile 生命周期和 T009 动态 Worker 调度。

### 2026-09-08 — Earcut 与 Worker bundle

- 内容：Polygon 三角化依赖 `earcut` 3.2.3，为 ISC、ESM 并内置 TypeScript 类型；Vite 生成的 `tileBuild.worker.js` 为 35,645 bytes，构建输出报告 gzip 10.86 kB，未包含 Three.js。
- 证据：`packages/map3d/package.json`、`pnpm-lock.yaml`、`packages/map3d/vite.worker.config.ts` 和 2026-09-08 Worker build 结果。
- 影响范围：发布许可清单、Worker 产物和性能预算。

## Rendering

### 2026-09-10 — T015 倾斜远景渐隐实现验证

- 内容：SDK 已实现 Polygon/Line 共享的 TSL horizon fade。`horizonFade.ts` 根据 pitch、Camera target distance 和 ground footprint 推导 view-space `start/end/strength`；pitch 0 的 strength 为 0，pitch 增大时平滑启用。`MaterialRegistry` 维护共享 fade uniforms，并通过 `MeshBasicNodeMaterial.colorNode` 将远景混合到 renderer background color；Line 的屏幕空间宽度 `vertexNode` 和 T013 display opacity 继续共存。
- 自动证据：`@nova/map3d` typecheck 通过；30 个测试文件、123 项测试通过；仓库级 `pnpm check` 通过。测试覆盖 fade 参数有限/单调、zoom/viewport 相对尺度、Polygon/Line 共享节点、Tile transition opacity 组合和 dispose 后 uniform 归零。实现和测试细节见 `tasks/T015-pitched-horizon-fade.md`。
- 浏览器证据：当前 Chromium 1280×720 viewport 下，WebGPU 与强制 WebGL2 完成 pitch 0/20/40/60 截图，fresh tabs 控制台无 warning/error。pitch 60 时 Runtime 仍报告 `visible=128` 并继续请求远处 Tile，证明效果不通过减少 Coverage 或裁 far plane 实现；`?lifecycle=dispose` 双后端验证 Tile、resource 和 worker 统计归零。证据见 `docs/evidence/T015-*.png`。
- 验收：2026-09-10 人工负责人已接受 pitch 0/20/40/60 对照和交互中的远景渐隐观感；fade 常数和曲线作为当前 MVP 默认视觉调校值保留，目标参考工作站正式性能门槛和发布判断已由 T010 完成。
- 影响范围：Polygon/Line Node Material、Map3D view/resize/MapOrigin 时的 fade 参数更新和 MaterialRegistry dispose；未改变公共 Map3D API、Layer 配置、Tile Coverage、Tile 请求策略、Worker 协议或 far plane。

### 2026-09-10 — T013 渐进式 Tile 替换

- 内容：Tile 数据生命周期与显示角色保持正交；Runtime 已实现 Target/Display Coverage、exact/ancestor/完整 descendant fallback、outgoing 保留、最新目标 token、required 与低优先级 ancestor warm fallback、display pin 和 180 ms 短过渡。显示只接收完成 GPU upload 的资源，Polygon/Line render instance 使用独立 Node Material clone 承载显示 opacity，并与图层原始 opacity 相乘；`prefers-reduced-motion` 跳过长淡入但保留 fallback 覆盖。
- 自动证据：`@nova/map3d` typecheck 通过；28 个测试文件、110 项测试通过；仓库级 `pnpm check` 通过。实现和测试细节见 `tasks/T013-progressive-tile-replacement.md`。
- 浏览器证据：当前 Chromium 在 WebGPU 与强制 WebGL2、1500 ms 网络延迟下验证 zoom `14.75 ↔ 15.25`、rapid zoom `14 → 16 → 15` 和约 440 px 连续 pan；截图未出现矩形背景空洞，fresh 页面控制台无 warning/error。证据见 `docs/evidence/T013-*.png`。
- 限制：任意瞬时 `setView()` 跨越远超当前 warm ancestor 覆盖范围时，旧 Tile 可能已离开新视口并在响应前暴露背景；连续 pointer pan 与 rapid zoom 已验证，跨城 teleport 无空洞不属于当前保证。2026-09-10 人工负责人已接受 T013 zoom/pan 连续性。
- 影响范围：Tile 显示协调、Render adapter 的 per-display opacity、Cache display pin 与 Map3D reduced-motion 传递；未改变公共 Map3D API、MVT/Worker 协议和 Tile canonical key 语义。

### 2026-09-09 — T012 Playground 浅色底图配方

- 内容：官方 Playground 的样式已集中到 `apps/playground/src/mapStyle.ts`，使用 `#F5F5F2` 浅中性画布、`#A9D7E8` 水体、`#DCEBD7` 植被、`#E1E3E5` 建筑、灰白普通道路和低饱和黄色主干道路；图层按 landuse → vegetation → water/waterway → building → road casing/fill 顺序排列。
- 数据证据：固定 `z15/26978/12416` fixture 的 landuse 为 39 个（grass 30、非 grass 9），road 为 386 个（primary 42、普通分区 344）；低 zoom `transportation` 样本确认 class=trunk。测试验证绿色过滤只命中 grass，普通/主干道路过滤构成完整分区。
- 浏览器证据：当前 Windows Chromium、1280x720 CSS viewport、DPR 1.5 下，WebGPU 与强制 WebGL2 的 z15/z10/z5 截图颜色与层级一致；WebGL2 pan、bearing 30°、pitch 12° 后样式保持连续，控制台无 warning/error。详见 `tasks/T012-light-basemap-visual-style.md` 和 `docs/evidence/T012-*.png`。
- 影响范围：仅 Playground 视觉配置与示例文档；SDK 公共 Layer API、Tile Runtime、Worker、Cache 和生命周期不变。T012 最终人工验收状态保留在任务文件中。

### 2026-09-09 — T011 Polygon Tile buffer 网格伪影

- 内容：KYE 主 MVT 的 `water`、`landuse`、`building` Polygon 顶点可落在核心 extent `0..4096` 外的约 80 extent 单位 buffer（观测范围 `-80..4176`）。相邻 Tile 的 buffer 几何在半透明 landuse/building 中重复覆盖并 alpha blend，产生与 XYZ Tile 边界完全重合的规则横纵向色带；opacity 为 1 的 water 不出现同样伪影。
- 诊断：未发现 Tile Debug/Grid 或 watermark API；相邻 Tile Float32 边缘误差约 `0.000122 m`；相邻 Tile 共享同一 MaterialRegistry 材质/Uniform/Shader；Polygon/Line 的 `depthTest` 与 `depthWrite` 均为 `false`，临时 depthTest 对照无变化。因此根因不是坐标精度、材质状态差异或 Z-Fighting。
- 修复：Polygon Worker 构建阶段使用 Sutherland-Hodgman 将每个三角形裁剪到 `[0, extent]`，保持公共 API、Worker 协议、Tile transform、材质和 Line 几何不变。
- 证据：`tasks/T011-fix-global-grid-artifact.md` 及 `docs/evidence/T011-*.png`；当前 Chromium WebGPU 与强制 WebGL2 修复后截图无规则网格，自动回归和 `pnpm check` 通过。
- 影响范围：相邻 Tile 半透明 Polygon 接缝；T012-T015 的视觉与连续体验仍按各自任务执行。

### 2026-09-08 — Three.js 渲染后端

- 内容：项目锁定 Three.js 0.185.1；该版本 `WebGPURenderer` 默认尝试 WebGPU，不可用时自动使用 WebGL2 backend，并支持 `forceWebGL`。
- 证据：Three.js r185 `WebGPURenderer` 源码；`packages/map3d/package.json`。
- 影响范围：统一 Renderer 抽象、fallback 测试和浏览器基线。

### 2026-09-09 — T006 固定 Polygon GPU 纵向链路

- 内容：SDK 已将真实 KYE `z15/26978/12416` 的三个 Polygon layer batch 转换为 Tile `Group` 下的三个 `Mesh`；Geometry 使用 Float32 position、Uint32 featureId/index，材质按稳定 key 共享并引用计数，Tile detach/Geometry/Material dispose 均为幂等可验证边界。
- 确定统计：water、landuse、building 合计 276 features、2,139 vertices、4,755 indices、53,244 CPU TypedArray bytes、53,244 GPU estimate bytes、3 batches 和 4 个 Tile/Batch Object3D。
- 浏览器证据：2026-09-09 当前 Windows Codex Chromium、1280×720 CSS viewport、DPR 1.5 下，默认 WebGPU 与 `?renderer=webgl2` 均显示一致；截图为 `docs/evidence/T006-webgpu-2026-09-09.png` 和 `docs/evidence/T006-webgl2-2026-09-09.png`。
- 生命周期证据：双后端 dispose 后 Tile、资源和 Worker 统计全部归零；Playground 在销毁 renderer 前等待 Inspector timestamp query 完成，控制台无 warning/error。
- 自动证据：`packages/map3d/test/polygonTileGpu.test.ts`、`packages/map3d/test/fixedPolygonTile.test.ts`、`packages/map3d/test/fixedTileCamera.test.ts`、`packages/map3d/test/runtimeErrors.test.ts` 和 2026-09-09 `pnpm check`。
- 影响范围：T008 动态 Tile 生命周期和 Cache、T009 Line/GPU Runtime 集成、T010 双后端与性能验证。

### 2026-09-08 — 建筑高度样本

- 内容：已采样 building feature 的 `height` 为 number，观测范围 0..66；`min_height` 在样本中未发现，不能假设全量存在。
- 证据：`docs/research/kye-mvt-data-dictionary.md`。
- 影响范围：3D extrusion 降级、字段校验和后续采样。

## Camera

### 2026-09-09 — T007 Camera、交互与可见 Tile Coverage

- 内容：公共 ViewState 保留连续经度、限制 Web Mercator 纬度、zoom 最低 0、bearing 归一化到 `[0, 360)`、pitch 限制到 `[0, 60]`；`Map3D` 已实现 `getView/setView`、typed `viewchange`，并在 view/resize 变化时同步推导 Camera、Coverage、MapOrigin 和现有 Tile transform。
- Camera：使用 45° 垂直 FOV、256px XYZ zoom scale、Scene X 向东/Z 向南；视锥射线在近地平线时按有限距离截断，near/far 随相机距离缩放。高 zoom、pitch 60°、bearing、不同 viewport 和跨 zoom MapOrigin 的投影连续性已由 Node 测试验证。
- Coverage：按 `clamp(floor(view.zoom), source.minZoom, source.maxZoom)` 生成 visible canonical/render Tile 和一圈 prefetch；支持 world wrap、日期线/等价世界 source bounds、Y 越界忽略、默认 128 Tile 上限和 visible/屏幕距离/稳定 key 优先级。
- 交互：Canvas 已支持左键/单指 pan、Wheel 连续 zoom、右键或 Shift+左键 bearing/pitch；pointer capture、lost/cancel、ResizeObserver、事件订阅和 dispose 清理已验证。
- 浏览器证据：2026-09-09 当前 Windows Codex Chromium、1280×720 CSS viewport 下，WebGPU 和强制 WebGL2 的交互状态均正确更新且控制台无 error；WebGPU 截图为 `docs/evidence/T007-initial-webgpu-2026-09-09.png` 和 `docs/evidence/T007-interactions-webgpu-2026-09-09.png`，dispose 后全部资源与 Worker 统计归零。
- 自动证据：`packages/map3d/test/mapCamera.test.ts`、`packages/map3d/test/tileCoverage.test.ts`、`packages/map3d/test/mapInteractions.test.ts`、`packages/map3d/test/viewStateStore.test.ts`、MapOrigin/GPU/Controller 回归测试，以及 2026-09-09 `pnpm check`。
- 影响范围：T008 Tile Runtime/Cache 消费 Coverage，T009 将动态多 Tile 请求和 GPU 实例接入该 Camera/MapOrigin 契约。

### 2026-09-10 — T017 mixed-LOD Frustum Tile Selection

- 内容：SDK 已将单层级 visible Tile 枚举与数量硬截断替换为内部 mixed-LOD 四叉树 selector。选择器使用 Camera Frustum/Tile AABB 相交、projected tile size、best-first refinement、320/224 CSS px 迟滞阈值和最大 1 级邻接差；数量不足时保留或合并父 Tile，Target Coverage 保持完整且无父子空间重叠。
- 空间边界：source bounds、日期线 world wrap、Y 边界、source min/max zoom 与 overzoom 保持有效；MapOrigin、ground footprint 和 horizon fade 改用独立 `referenceZoom`，Layer `minZoom/maxZoom` 继续按 selected canonical zoom 生效。
- 自动证据：`mixedLodTileSelector.test.ts` 覆盖 Frustum/AABB、SSE 单调性、预算降级、迟滞、非重叠、邻接连续性、reference zoom、等价 FOV/viewport 和 pitch/bearing/viewport 屏幕射线矩阵；Display Coverage 新增 mixed zoom parent/child fallback 与 180 ms replacement 回归。`@nova/map3d` 32 个测试文件、146 项测试通过，仓库级 `pnpm check` 通过。
- 浏览器证据：当前 Chromium `2555 × 1385`、DPR 1、zoom 15、pitch 60 下，单层级 513 个候选由 mixed LOD 选择为 127 visible + 1 prefetch，分布为 z13=22、z14=50、z15=55，未超过默认 128 Tile。WebGPU、强制 WebGL2 及 1500 ms 延迟 settled 画面左右覆盖完整，控制台无 warning/error；双后端 dispose 后 Tile、CPU/GPU bytes、Object 和 Worker 统计归零。结构化结果见 `docs/evidence/T017-browser-regression.json`。
- 验收：代码、自动测试、实现会话浏览器检查和人工负责人视觉验收均已完成，T017 状态为 `DONE`。T020 Retained Cache 已完成；原计划的 T021/T018/T022/T019 顺序因 T021 人工观感失败改由 D030/T023 V2 迁移重新规划。
- 影响范围：内部 Tile Coverage、静态 priority role、Target/Display Coverage 适配和 horizon fade 参考 zoom；未改变 Map3D 0.1 公共 API、Canonical/Render TileKey、Worker protocol、KYE 请求语义、cache 预算或 Camera far plane。

### 2026-09-10 — T018 motion-aware Tile 调度

- 内容：T017 ideal Target Coverage 继续作为最终显示目标；内部调度补充最低 selected zoom ancestor coarse coverage，按 coverage > refinement > leading-prefetch > ordinary prefetch 排序。T014 交互产生 center/zoom/bearing/pitch 的内部 motion snapshot，按 240 ms 窗口预测 leading edge，最多加入 24 个非 visible Tile；refinement 在最后运动后 debounce 180 ms。
- 取消：无 consumer 的在途请求使用 240 ms 有界迟滞；下载达到 16 KiB、完成比例至少 50% 或进入 Worker 后使用 600 ms 上限。快速返回复用同一 generation；迟到 Worker/upload 继续被 generation token 拒绝挂载。Fetch 使用流式 reader 记录下载进度，不改变 source 响应语义。
- 自动证据：`@nova/map3d` typecheck 通过；33 个测试文件、156 项测试通过；仓库级 `pnpm check` 通过。固定 controlled-adapter 场景记录 coarse cover 50 ms、ideal refinement 180 ms，并验证快速返回 0 取消、20 KiB/32 KiB progress 延迟取消、stale completion 和 dispose。
- 浏览器证据：当前 Codex Chromium 1280×720、DPR 1.5 下，WebGPU/强制 WebGL2 的 pan、zoom、bearing/pitch、1500 ms 延迟与 dispose 回归通过，控制台无 warning/error；reduced-motion 下直接交互和 Coverage 正常。结构化结果与截图见 `docs/evidence/T018-browser-regression.json`、`docs/evidence/T018-*.png`。
- 影响范围：内部交互采样、Tile 请求/Worker 优先级、prefetch、取消与诊断；未改变 Map3D 0.1 公共 API、默认并发、cache 预算、Worker protocol、geometry 或 style。人工交互观感验收未通过，任务保持 `BLOCKED`；T020 cache 修复已完成，等待 T021 后重新验证。

### 2026-09-10 — T020 Retained Tile Cache 与请求抖动修复

- 内容：无 Target consumer、无 Display pin 的 Ready、empty、failed terminal record 现在进入预算内 Retained Cache，不再在 LRU 前立即释放。Ready/empty cache hit 复用同一 generation，并刷新最近访问时间；visible、coverage-critical 和 Display Cover 继续 pinned。
- 预算：entries、CPU、GPU 任一超限时继续淘汰非 pinned candidate；被预算淘汰的 prefetch/warm ancestor 在当前 Coverage 内保持 suppression，避免 eviction 后立即重新请求。默认 256 entries、128 MiB CPU、256 MiB GPU 未改变。
- 诊断：内部统计区分 initial、retry、eviction reload、cancellation reload 和无解释 duplicate request start，并报告 retained Ready/empty/failed、cache hit 与 budget eviction；请求历史按 `maxEntries × 4` 且最少 16 项有界保留。
- 自动证据：受控 adapter 的 A → B → A 验证 Fetch、Worker、GPU upload 和 dispose 次数不增加；fake clock 覆盖 LRU access 刷新、warm ancestor、30 秒稳定、预算抑制、empty/failed retention、retry、取消、stale completion 和 lifecycle。`@nova/map3d` 33 个测试文件、163 项测试及仓库级 `pnpm check` 通过。
- 浏览器证据：Codex Chromium 1280×720、DPR 1.5 的 WebGPU/WebGL2 zoom 15、pitch 60 往返 pan 各记录 32 个 canonical request、32 个唯一 key、0 个重复 key；返回后静止 30 秒均为 0 个新请求。settled CPU/GPU 均为 103,635,528 bytes，双后端 dispose 后 Tile、资源、Object 和 Worker 归零。证据见 `docs/evidence/T020-browser-regression.json`。
- 影响范围：内部 Tile retention、LRU access、预算抑制与诊断；未改变 Map3D 0.1 公共 API、Canonical/Render TileKey、Worker protocol、默认预算、Coverage selector、geometry 或 style。空间 replacement 和 Render instance/material 稳定性已由 T021 在旧路径完成代码和浏览器回归，但人工观感未通过，后续由 T023 重新建立生产 authority。

### 2026-09-11 — T021 spatial best-available Tile replacement

- 内容：Display Coverage 已从全局 Target signature 淡入淡出改为按空间区域判断。outgoing 只在仍与当前 visible Target 空间重叠时保留；parent/fallback 仅在当前有效 Target 区域具备 ready replacement cohort 后退出；same-zoom ready exact、retained cache hit 和已显示 exact 直接以 opacity 1 显示。
- 过渡：短 alpha transition 只在明确的 LOD parent/child replacement 上启动；replacement cohort 的 `transitionStartedAt` 沿用原始提交时间，快速无关 Target 更新不会重置进度。部分 child ready 时继续显示 parent/fallback，不提交局部 replacement cohort。
- 渲染资源：`ThreeTileRenderAdapter` 在 render key 暂时移除时 detach 既有 render instance，但不 dispose 克隆 display material；render key 恢复时复用原 `Group`/`Mesh`/material。display opacity 首次低于 1 后保持 `transparent=true`，避免 opacity 跨 1 反复触发 material pipeline update；`stats.objects` 统计 active render keys。
- 自动证据：`@nova/map3d` typecheck 通过；33 个测试文件、169 项测试通过；仓库级 `pnpm check` 通过；`git diff --check` 通过。新增/更新测试覆盖 same-zoom no-fade、partial child cohort、unrelated target 不重启过渡、retained cache hit、parent replacement 完整性、render instance/material 复用和半透明期间恢复 key 的 opacity 应用。
- 浏览器证据：Codex Chromium 1280×720、DPR 1.5 下，WebGPU 与强制 WebGL2 在 1500 ms 延迟的 initial、same-zoom pan、rapid return、rapid zoom、bearing 35/pitch 60 和 dispose 场景通过，控制台 warning/error 为 0；reduced-motion 和离线失败 fallback/恢复场景通过，所有截图均可解码为 1280×720。结构化结果见 `docs/evidence/T021-browser-regression.json`，截图见 `docs/evidence/T021-*.png`。
- 人工验收：2026-09-11 人工负责人明确不通过 pan/zoom 加载观感，反馈为加载明显延迟、停止交互后才看到 Tile、运动期间缺少预加载感、Tile 逐块补齐且仍有白闪；自动测试和截图通过不能替代该结论。
- 状态边界：T021 当前为 `VERIFYING`，不能标记 `DONE`；该任务未实现 T022 的 fogStart/fogEnd/loadCutoff，也未证明旧 Runtime 的生产调度/显示路径达到发布质量。D030/T023 将该失败作为架构迁移输入。

### 2026-09-11 — T021 人工失败触发 TileEngineV2 迁移

- 已验证事实：T021 的人工失败与代码审计结果一致，问题跨越 `tileMotionScheduler.ts` 的运动调度、`tileRuntime.ts` 的逐 Tile upload/display 提交、`displayCoverage.ts` 的空间 fallback/cohort、`tileRuntimeBudget.ts` 的并发/预算以及 `materialRegistry.ts` 的 parent/child 叠加状态；不是单个淡入时长参数的独立缺陷。
- 已验证事实：T021 证据中记录 62 个 visible Tile、98 个 coverage Tile、1500 ms 延迟和 settled CPU resource `127,477,480` bytes，接近 128 MiB 默认预算；这些是旧 Runtime 的诊断输入，不代表 V2 目标已实现。
- 已验证事实：旧 `tileMotionScheduler.ts` 在运动中关闭普通预取并把 refinement 延迟 180 ms；旧 `tileRuntime.ts` 按单 Tile upload 同步提交显示而非 cohort；旧 `displayCoverage.ts` 在 exact/ancestor 未 ready 时可能短暂暴露背景；`materialRegistry.ts` 的 Polygon/Line depth test/write 关闭会增加 parent/child 透明叠加的白闪风险。这些事实共同解释了人工看到的延迟、逐块出现和白闪，不能归结为单一淡入参数。
- 项目决策：人工负责人已确认采用 D030，建立独立 `TileEngineV2`，借鉴 MapLibre/deck.gl 的公开 best-available、parent/child retain、优先级调度和缓存规则，保留现有 Three.js GPU 上传及 Map3D 0.1 公共契约；任务规格见 `tasks/T023-tile-engine-v2.md`。

### 2026-09-12 — T023 TileEngineV2 生产路径迁移

- 代码已确认：`Map3D.ts` 只实例化 `TileEngineV2`；`runtime/tileRuntime.ts` 仅保留 `TileEngineV2 as TileRuntime` 兼容导出。旧 `TileMotionScheduler`、旧 `DisplayCoverageCoordinator` 和旧 `TileRuntimeDisplayBridge` 没有进入 Map3D 生产路径。
- 代码已确认：V2 将 Target Coverage、Render Cover、Retained Cache 分离；请求生命周期由 `tileEngineV2Requests.ts` 管理，状态/预算由 `tileEngineV2State.ts` 管理，调度由 `tileEngineV2Schedule.ts` 管理，显示与 parent/child cohort 由 `tileEngineV2Display*.ts` 管理。`tileEngineV2.ts` 已从 772 行拆分至 524 行。
- 自动证据：`pnpm --filter @nova/map3d typecheck` 通过；`pnpm --filter @nova/map3d test` 为 34 个测试文件、171 项测试通过；仓库级 `pnpm check` 的 SDK/Playground typecheck、test 和 production build 全部通过。
- 浏览器证据：真实 Chromium 的 WebGPU、强制 WebGL2、KYE、1500 ms 延迟、高 pitch 和连续平移场景通过；代表性 V2 状态为 `visible=128` 的 mixed LOD（z13/z14/z15），控制台 warning/error 为 0，dispose 后 Tile、resource、worker 统计归零。该证据对应 T023 进入 `VERIFYING`，不替代人工负责人对 pan/zoom 加载观感的最终验收。
- 状态边界：T023 当前为 `VERIFYING`；T022 fogStart/fogEnd/loadCutoff 尚未实现，T019 发布验证尚未执行，旧 Runtime 文件是否删除/归档待后续 Project Control 决定。

### 2026-09-12 — T023 人工验收失败与 V2 后续拆分

- 已验证事实：人工负责人实际 pan/zoom 体验与 T023 自动/脚本证据不一致，仍存在加载滞后、停止后 refinement 波次、中心向外扩散、初始化水波式逐块出现和白闪；截图与控制台无错误不能替代该结论。
- 代码已确认：`tileEngineV2Schedule.ts` 的 `TILE_ENGINE_V2_REFINEMENT_DEBOUNCE_MS=180` 把 refinement 统一延迟到最后一次运动后；`Map3D.#applyMotion()` 在 idle 立即重排，使停下后必然释放一批详细 Tile。
- 代码已确认：`tileEngineV2Requests.ts` 每个 upload 完成都会调用 `commitCohort()`，但 `TileEngineV2.#queueCohortCommit()` 同步执行 `#synchronizeCoverage()`，没有 rAF 收集窗口或空间 cohort 原子提交，因此仍按 Tile 逐个改变 Render Cover。
- 代码已确认：Fetch/Worker 与 coverage 选择主要按 `screenDistance` 排序，默认 8 Fetch/4 Worker；有限并发叠加中心优先会确定性地产生中心向外扩散。初始 `DisplayCoordinator` 在没有 active/outgoing 时不请求 fallback，无法先建立稳定 coarse cover。
- 代码已确认：`tileCoverage.ts` 用 `remaining = maxTiles - visible.length` 截断 prefetch；默认 `maxTiles=128` 且 visible 接近上限时，普通预取空间近似为零。该限制来自 T017 的预算模型，T023 未解除。
- 项目结论：T023 不标记 `DONE`，也不回到旧 Runtime 继续打补丁。T024/T025 已完成，后续按 T026（Coverage/prefetch 预算解耦）→T027（逐帧诊断与人工验收）执行；T022 fog-bounded Coverage 与 T019 发布验证顺延到 T027 通过后。

### 2026-09-12 — T024 TileEngineV2 Render transaction

- 代码已确认：`TileEngineV2CommitGate` 将 Worker/Render upload 完成事件合并到 rAF/等价帧边界；`tileEngineV2Requests.ts` 上传完成后先以空 `renderKeys` 持有 resource，未经过 commit gate 的 ready record 不会进入 Display Coordinator 或 Scene Render Cover。
- 代码已确认：`TileEngineV2DisplayCoordinator` 在初始无 active/outgoing 显示时会派生 required parent fallback 请求；若 next selection 不能完整覆盖当前 visible Target，则拒绝提交部分 exact。ready ancestor 只有在其覆盖范围内全部 target child 具备 ready replacement cohort 后才退出。
- 自动证据：`pnpm --filter @nova/map3d typecheck` 通过；`pnpm --filter @nova/map3d test` 为 34 个测试文件、176 项测试通过；仓库级 `pnpm check` 通过。新增/更新测试覆盖多 upload 同帧提交、单 Tile upload 不改变不完整 Render Cover、初始 coarse cover、真实 rAF flush 前非 idle/不挂载资源和 parent 不叠加部分 child。
- 浏览器证据：Chrome 152 headless 中 WebGPU、强制 WebGL2 和 reduced-motion 的 1500 ms pan 回归通过，console issue 为 0，dispose 后 Tile/resource/worker 归零，pan settled 请求无重复 canonical；WebGPU offline fallback/recovery 也完成恢复与 dispose 归零。证据见 `docs/evidence/T024-browser-regression.json` 与 `docs/evidence/T024-*.png`。
- 状态边界：T024 已完成且未改变 Three.js、Worker protocol、Map3D 0.1 公共 API、默认并发或 cache 预算。T025 已完成运动中 refinement 调度与公平队列；T026/T027 仍需解决 prefetch 预算分离和最终人工 pan/zoom 验收。

### 2026-09-12 — T025 TileEngineV2 continuous motion scheduling

- 代码已确认：`tileEngineV2Schedule.ts` 已移除 V2 的 `TILE_ENGINE_V2_REFINEMENT_DEBOUNCE_MS=180` 闸门；active、settling 和 idle 阶段的当前可见 refinement 不再被统一 `notBefore` 延迟到运动结束后，ordinary prefetch 与 leading prefetch 仍保留，预算压力抑制规则未改变。
- 代码已确认：V2 schedule 为 coverage、refinement、leading-prefetch 和 ordinary prefetch 生成 `coverageRank`，使用 4 条屏幕距离带轮询打散近/中/远候选；`compareTilePriority()` 在角色和 visible 优先后加入 deadline/starvation 判定，未过期时按 `coverageRank` 与 `screenDistance` 排序，过期 queued/decoding 记录按 deadline/等待时长抢占。
- 诊断已确认：V2 内部 diagnostics 增加 scheduler `delayedByNotBefore`、requestQueue `coverageRank/deadlineAt/queueAgeMs/starved`，runtime scheduling stats 增加 `queuedNotBeforeCount/starvedQueueCount/oldestStarvedQueueAgeMs`；请求原因分类、取消迟滞、stale generation、失败恢复和默认 8 Fetch / 4 Worker 并发未改变。
- 自动证据：`pnpm --filter @nova/map3d typecheck` 通过；`pnpm --filter @nova/map3d test` 为 34 个测试文件、179 项测试通过；仓库级 `pnpm check` 通过。新增测试覆盖 active/settling 无 idle-only refinement `notBefore`、同角色距离带轮询、deadline/age 防饥饿以及既有取消、stale、cache、progressive 回归。
- 浏览器证据：真实 Chrome 152 headless、1500 ms 延迟下，WebGPU/WebGL2 pointer pan 分别记录运动期间 16 个请求启动和 ready +7；WebGPU wheel zoom 记录运动期间 24 个请求启动；WebGPU reduced-motion pointer pan 记录运动期间 17 个请求启动和 ready +7。所有场景 console warning/error 为 0，`maxPerCanonical=1`，dispose 后 Tile/resource/worker 归零。证据见 `docs/evidence/T025-browser-regression.json` 与 `docs/evidence/T025-*.png`。
- 状态边界：T025 已完成且未改变 Render transaction、parent/child 提交、Coverage/prefetch 容量预算、Map3D 0.1 公共 API、Three.js、Worker protocol、默认并发或 cache 预算。T026 仍需解决 Coverage/prefetch 预算解耦，T027 仍需执行最终人工 pan/zoom 观感验收。

### 2026-09-10 — T014 交互阻尼实现验证

- 内容：`MapInteractionController` 已实现 pointer sample、release velocity、rAF/delta-time 指数阻尼、pan/rotate release 惯性、wheel 帧合并、外部 `setView()`/新输入/页面失活/dispose 取消，以及 reduced-motion 下禁用释放惯性；未改变 `Map3D` 公共 API 和 ViewState 语义。
- 自动证据：`@nova/map3d` typecheck 通过；`packages/map3d/test/mapInteractions.test.ts` 覆盖 pan/rotate release、30/60/120 Hz 终点一致性、边界停止、外部取消、页面失活、wheel burst 和 reduced-motion；仓库级 `pnpm check` 通过。实现和测试细节见 `tasks/T014-inertial-map-interaction.md`。
- 浏览器证据：当前 Chromium 1280×720 viewport 下，WebGPU 与强制 WebGL2 完成 no-preference 模式的 pan release、Shift+drag bearing/pitch release 和 wheel zoom 验证，控制台无 warning/error；reduced-motion 模式验证 WebGPU pan release 不启动惯性。证据见 `docs/evidence/T014-*.png`。
- 验收：2026-09-10 人工负责人确认 T013/T014 执行状态无异常，并接受 pan、bearing/pitch 和 wheel 手感；阻尼常数、采样窗口和停止阈值作为当前 MVP 默认交互调校值保留，最终发布判断已由 T010 统一完成。
- 影响范围：Canvas pointer/wheel 交互、内部运动调度和 `Map3D.setView()` 对交互动效的取消边界；未改变 Tile lifecycle、MVT、Geometry、Style 或公共 Layer API。

## T008 Tile Runtime 与 Cache 证据

- 状态：代码已确认；2026-09-09 自动验证。
- 内容：SDK 内部已实现 canonical Tile 状态机与 Runtime 级单调 generation、visible/prefetch consumer 合并、优先级队列、Fetch/Worker 并发、取消、failed cooldown、204 empty、byte-aware LRU、visible pin 和 pressure 抑制策略；generation 不保留无界历史 key 表。
- 请求证据：同一 canonical key 的多个 world wrap consumer 只触发一次 Fetch/Worker/upload；T004 Source adapter 在 Runtime 中验证了 network/5xx 最多三次重试、204 empty 和 404 非重试语义。
- 生命周期证据：迟到 Worker 结果不进入 upload，迟到 GPU resource 立即释放；Runtime dispose 按 Tile → Worker → Render → Source 顺序幂等执行，三轮创建/销毁后记录、job、事件与 adapter 计数归零。
- Cache 基线：默认 256 entries、128 MiB CPU、256 MiB GPU；CPU/GPU 数值由 Render adapter 报告，T010 已用真实多 Tile GPU resource 复核当前目标工作站精度与阈值。
- 事件边界：Runtime 内部提供 error/idle/stats/memorypressure typed events，`idle` 只等待 visible Tile；D019 公共 `MapEventMap` 未改变，映射由 T009 完成。
- 验证：T008 针对性 22 项测试通过；完整 `pnpm check` 通过 SDK 87 项、Playground 1 项、类型检查及生产构建。T008 不创建真实 GPU 对象，未新增浏览器人工验证。
- 影响范围：T009 真实 Polygon/Line Render adapter、world wrap 实例、动态 Map3D 集成和公共诊断；T010 cache/并发性能校准。

## T009 Line 与动态 MVP Runtime 证据

- 状态：代码与当前 Chromium 功能环境已验证；2026-09-09。
- Line：Worker 已生成 Tile-local Float32 三角带中心点、`previous/next/side`、Uint32 index/featureId、feature ranges 和共享 feature table，支持常量 width/color/opacity、受限尖角、butt cap、zoom 范围和最小属性 filter；共享 TSL Node Material 在裁剪空间按 CSS pixel 展开，浏览器双后端已验证。
- 动态集成：Map3D 已将 Camera/Coverage、visible/prefetch Runtime、KYE Fetch、Worker、Polygon/Line GPU adapter、byte-aware Cache 和公共 stats/idle/error 串联；同一 canonical Tile 的多个 world wrap 共享批次资源并使用独立 render transform。
- 浏览器证据：当前 Windows Codex Chromium 中，默认 WebGPU 与强制 WebGL2 均显示真实 KYE water/landuse/building/road；pan、连续 zoom、bearing、pitch 会动态更新 ViewState 和 Tile 资源。截图为 `docs/evidence/T009-webgpu-initial-2026-09-09.png`、`docs/evidence/T009-webgpu-interactions-2026-09-09.png`、`docs/evidence/T009-webgl2-initial-2026-09-09.png` 和 `docs/evidence/T009-webgl2-interactions-2026-09-09.png`。
- 生命周期证据：双后端 `?lifecycle=dispose` 后 visible/queued/fetching/building/ready、CPU/GPU bytes、batches/features/vertices/indices/objects 和 Worker active/queued 均归零，控制台无 warning/error。
- 自动证据：SDK 25 个测试文件共 95 项测试、Playground 1 项测试、严格类型检查、SDK/Worker/Playground 生产构建和完整 `pnpm check` 通过。目标参考工作站上的正式性能与发布判断已由 T010 完成。
- 影响范围：T010 浏览器、异常网络、生命周期和性能基线。

## Label

### 2026-09-08 — KYE 文字资源入口

- 内容：KYE Style 使用 Glyph PBF 模板，实测 Microsoft YaHei Regular 的 0-255 与 256-511 范围可下载。
- 证据：`docs/research/kye-glyph-sprite.md`。
- 影响范围：字体加载、缓存、中文覆盖和许可核对。

## Performance

### 2026-09-10 — T016 Line geometry reuse 复算

- 内容：同一 Tile 内 sourceLayer、filters、zoom 可见性和 topology 规则一致的 Line style pass 已共享 Worker TypedArray 与主线程 BufferGeometry；每个 public layer 仍保留独立 material、width、opacity、renderOrder 和 draw pass。T010 北京 city z10 场景的 48 个 visible Tile 重新执行当前 `buildTilePayload()` 后，Line 资源由原始 `168,412,544` bytes 去重为 `85,733,480` bytes，总 output/resource bytes 由 `171,828,744` 降为 `89,149,680` bytes，约 85.0 MiB，低于 128 MiB CPU 和 256 MiB GPU 初始预算。
- 细节：共 131 个唯一 Line geometry、227 个 Line render pass，96 个 pass 共享；共享组为 `road-casing`/`road-fill` 48 组和 `major-road-casing`/`major-road-fill` 48 组。Worker transferable 列表按 ArrayBuffer identity 去重，render adapter 的 shared geometry dispose 幂等。
- 证据：`docs/evidence/T016-city-z10-resource-check.json`、`packages/map3d/src/geometry/lineGeometrySharing.ts`、`packages/map3d/src/rendering/lineTile.ts`、`packages/map3d/test/lineBatch.test.ts`、`packages/map3d/test/tileRenderAdapter.test.ts` 和 `packages/map3d/test/workerPipeline.test.ts`。
- 浏览器验证：Chrome 151、1920x1080、DPR 1 下，city z10 的 WebGPU/WebGL2 最大 CPU resource 分别为 `134,170,325` 和 `134,195,458` bytes，低于 `134,217,728` bytes 上限但仅余 `47,403` 和 `22,270` bytes；GPU 最大值分别为 `132,527,696` 和 `132,259,356` bytes。city z10 frame P95 为 4.6/4.5 ms，pitch60 为 8.4/8.0 ms。60 秒交互、1500 ms 延迟 zoom/pointer pan、三轮 dispose、自动 fallback、节点失败和离线恢复均通过，证据见 `docs/evidence/T016-browser-regression.json`。
- Worker/upload：固定 Tile 40 次样本的 worker total/build/upload P95 分别为 8.6/4.7/1.9 ms，output bytes 从 T010 的 `497,592` 降至 `295,064`，证据见 `docs/evidence/T016-worker-upload-performance.json`。
- 结论：T016 已完成，T010 的 city z10 资源阻断已解除，T010 随后完成最终发布判断。当前 cache 会在 visible geometry 降低后继续填充至接近配置预算，因此浏览器最大资源值与 48 个 visible Tile 独立复算的 `89,149,680` bytes 不能混为同一指标，且实际余量必须描述为极小。

### 2026-09-10 — T010 当前工作站浏览器与性能基线

- 环境：当前 Windows 11 Pro `10.0.26100` 工作站，AMD Ryzen 9 8945HX（16C/32T），GPU 包含 AMD Radeon 610M 与 NVIDIA GeForce RTX 5060 Laptop GPU；浏览器矩阵主证据为 Chrome/151，long task trace 收尾证据为 Chrome/152.0.7977.76，viewport 1920x1080，DPR 约 1，commit `1f213b0`。证据见 `docs/evidence/T010-environment.json` 和 `docs/evidence/T010-longtask-trace.json`。
- 自动验证：收尾复跑 `pnpm check` 通过，包含 `@nova/map3d` typecheck、SDK build、SDK 31 个测试文件 129 项测试、Playground 2 个测试文件 4 项测试，以及 SDK/Worker/Playground production build。
- 浏览器帧时间与输入响应：clean harness 的 WebGPU low/city/high/pitch60 frame P95 分别为 1.8/3.5/2.9/9.1 ms，input response P95 分别为 9.3/11.4/9.7/45.7 ms；强制 WebGL2 frame P95 分别为 1.6/2.9/2.8/9.4 ms，input response P95 分别为 6.1/9.6/9.3/34.5 ms。证据见 `docs/evidence/T010-view-matrix-harness.json` 与 `docs/evidence/T010-harness-*.png`。
- Worker/upload：固定高 zoom tile `z15/26978/12416` 的 40 次浏览器侧样本中，worker total P95 9.0 ms、decode P95 3.8 ms、build P95 5.3 ms、upload adapter P95 2.2 ms。证据见 `docs/evidence/T010-worker-upload-performance.json`。
- 连续体验、fallback 与生命周期：1500 ms 延迟下的连续 zoom/pan、双后端交互回归、reduced-motion、三次 create/dispose、无 WebGPU 自动 fallback、节点阻断、全部节点阻断和离线恢复均已归档；控制台无未说明 warning/error，dispose 后 Tile/resource/worker 统计归零。证据见 `docs/evidence/T010-continuity-delayed.json`、`docs/evidence/T010-interactions.json`、`docs/evidence/T010-reduced-motion.json`、`docs/evidence/T010-lifecycle-dispose.json`、`docs/evidence/T010-auto-fallback-no-webgpu.json`、`docs/evidence/T010-network-blocked.json` 和 `docs/evidence/T010-offline-recovery.json`。
- 资源结论：首轮 clean harness 北京城市 zoom 场景的 `171,828,744` bytes 超过 128 MiB CPU cache 初始预算，已确认主因为重复 Line casing/fill topology。T016 后 WebGPU/WebGL2 最大 CPU resource 降至 `134,170,325` 和 `134,195,458` bytes，在未修改门槛或 Coverage 的前提下通过，但余量极小。
- long task 结论：Chrome trace 收尾运行在 WebGPU/WebGL2 各 60 秒交互中复现 window long task，WebGPU 8 次、最大 203 ms，WebGL2 9 次、最大 146 ms；trace 分类指向 `CrRendererMain` 的 `RunMicrotasks`、`FireAnimationFrame`/Three.js renderer `update`，`DedicatedWorker thread` 的 `worker/runtime.ts` timer 回调，以及 WebGL2 `slot.worker.onmessage` 主线程回调样本。该证据未显示 MVT decode/Polygon triangulation 在主线程执行；当前作为非阻断性能风险记录。证据见 `docs/evidence/T010-longtask-trace.json`。
- 发布判断：T010 对当前 Windows 目标工作站的 MVP 浏览器与性能基线结论为 `PASS_WITH_NON_BLOCKING_LONG_TASK_RISK`，状态为 `DONE`。若发布目标换到另一台设备、浏览器/GPU 版本或更严格 long task 门槛，需要重复真实浏览器矩阵或新建性能优化任务。

## Bug

### 2026-09-10 — Ready Tile 未形成真实 Retained Cache（已修复）

- 原问题：T017/T018 后的代码审计确认，`TileRuntime.#applyDesiredConsumers()` 会在无 active group、非 in-flight 且无 display consumer 时立即释放 terminal record；因此 Ready Tile 完全离开 Target/Display 后不会等待 byte-aware LRU 淘汰。
- 请求证据：本地 WebGPU、1280×720、DPR 1.5、zoom 15、pitch 60 往返平移诊断中，同一 canonical PBF 路径在约 9 秒窗口内重复请求最高 17 次，去程与回程有 19 个相同路径；不同 requestId 且非 redirect。诊断见 `docs/research/tile-retention-display-fog.md`。
- 循环：ready exact 会触发 warm ancestor 请求；ancestor ready 后移出 requested fallback，旧 Runtime 立即释放，下一轮同步再次请求。旧 ready cache hit 测试主要验证 outgoing/display transition 保留，没有覆盖真正离屏 reuse。
- 修复：T020 已建立预算内 terminal retention、真实 cache hit、warm ancestor suppression 和请求原因诊断；双后端相同往返脚本从旧证据最高单 key 17 次重复请求变为 0 个重复 canonical key。
- 影响范围：T018 因 pan 加载观感保持 `BLOCKED`，且旧路径不再追加补丁；T021 的代码和浏览器回归通过但人工观感失败，问题和证据已转入 D030/T023。

### 2026-09-10 — T010 资源预算阻断已解除

- 内容：北京城市 zoom 首轮 clean harness 的 `171,828,744` bytes 资源阻断由重复 Line casing/fill topology 引起。T016 通过同 Tile geometry 共享将独立 48 visible Tile 复算降至 `89,149,680` bytes；真实浏览器 cache 运行最大值降至 WebGPU `134,170,325`、WebGL2 `134,195,458` bytes，均低于未修改的 128 MiB CPU 上限。
- 证据：`docs/evidence/T016-line-resource-breakdown.json`、`docs/evidence/T016-city-z10-resource-check.json`、`docs/evidence/T016-browser-regression.json`。
- 影响范围：T010 资源阻断已解除并完成发布判断；CPU cache 余量极小，后续仍需监控，但无需修改公共 stats、默认预算或 Coverage 策略。

## Environment

### 2026-09-08 — KYE Raster 尺寸差异

- 内容：KYE Raster 样本实际为 512×512 PNG，现有样式配置声明 tileSize 256。
- 证据：`docs/research/kye-raster.md`。
- 影响范围：DPR、纹理采样、缓存预算和缩放验证。
