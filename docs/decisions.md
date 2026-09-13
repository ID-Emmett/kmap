# Nova Technical Decisions

更新日期：2026-09-12

本文件保存重大技术决策归档。低 token 决策入口见 `docs/decisions/index.md`；新增重大决策优先写入 `docs/decisions/Dxxx-*.md` 分片并在索引登记。讨论过程和废弃内容由 Git history 与 AI Session Log 保存。

## D001 — 使用 pnpm Monorepo 与 Vite

- 状态：Accepted
- 决策：使用 pnpm workspace 管理应用和 package，使用 Vite 构建 SDK 与 Playground，不使用 Turborepo。
- 原因：保持工具链精简，由 pnpm workspace filter 负责任务编排，同时支持 SDK 独立发布。

## D002 — SDK 与 Playground 分离

- 状态：Accepted
- 决策：SDK 位于 `packages/map3d`，Playground 位于 `apps/playground`。
- 约束：Playground 依赖 SDK；SDK 不依赖 Playground。

## D003 — Three.js 作为渲染基础设施

- 状态：Accepted
- 决策：使用精确锁定的 Three.js 0.185.1。
- 约束：升级 Three.js 必须通过独立 Task 完成。

## D004 — WebGPU 优先并支持 WebGL2 fallback

- 状态：Accepted
- 决策：统一使用 Three.js `WebGPURenderer`，默认尝试 WebGPU，不可用时由 Three.js 自动回退 WebGL2。
- 约束：SDK 不维护两套独立场景实现；需要提供 fallback 验证路径。

## D005 — 自定义 Shader 使用 TSL

- 状态：Accepted
- 决策：新自定义 Shader、材质节点和后处理统一使用 Three.js TSL / Node Material。
- 约束：手写 GLSL/WGSL 不是项目默认实现路径；例外需要独立决策。

## D006 — Playground 使用 Three.js Inspector

- 状态：Accepted
- 决策：开发期统一使用 Three.js Inspector。
- 约束：不创建 HTML sidebar、HTML debug panel 或自制默认调试面板；Inspector 不进入 SDK 核心依赖。

## D007 — Feature 不创建独立 Object3D

- 状态：Accepted
- 决策：地图 Feature 通过 Geometry/Batch 进入渲染，不为每个 Feature 建立独立 Object3D。
- 原因：控制对象数量、draw call 和资源开销。

## D008 — Tile 是重要运行时管理单位

- 状态：Accepted
- 决策：Tile 承担可见性、请求、解码、批次、缓存和销毁等关键生命周期边界。
- 说明：具体状态机和跨 Tile 共享策略待决策会话确认。

## D009 — TypeScript 模块化设计

- 状态：Accepted
- 决策：代码使用严格 TypeScript、现代 ESM 和单一职责模块。

## D010 — 源文件以 500 行为上限目标

- 状态：Accepted
- 决策：源代码文件超过 500 行时优先拆分；确有必要保留时在 Task 结果中说明。

## D011 — SDK 不依赖 Playground

- 状态：Accepted
- 决策：SDK 不引用 Playground 页面、HTML 调试 UI、Inspector 或业务 Demo 状态，并保持可独立 build/publish。

## D012 — Bootstrap API 只覆盖最小生命周期

- 状态：Accepted for Bootstrap
- 决策：当前 `Map3D` 只公开初始化、视口、renderer 接入、后端识别和销毁能力。
- 约束：地图数据、图层、相机语义和业务 API 必须由决策会话确认后实现。

## T002 MVP Baseline

以下决策由 T002 形成，并于 2026-09-08 获人工负责人确认。

## D013 — 收窄 MVP 为动态 Polygon/Line Tile Runtime

- 状态：Accepted
- 决策：MVP 聚焦真实 KYE 主 MVT、动态多 Tile、Polygon/Line、最小 Layer 配置、Camera、缓存、Worker、资源销毁和 WebGPU/WebGL2。
- 范围变化：文字/Glyph/Sprite、3D 建筑、Picking、Raster、业务 Overlay 和完整 Style v8 移出 MVP。
- 原因：这些能力不是验证动态 Tile Runtime 的必要条件；尤其文字链路包含 shaping、atlas、碰撞和 fallback，应独立立项。
- 影响：首个可交付版本能证明地图核心运行时，但不宣称已提供完整底图样式或业务地图 API。

## D014 — 公共经纬度与 Tile 局部浮点坐标

- 状态：Accepted
- 决策：公共 API 使用 WGS84 `LngLat` 和 `ViewState`；CPU 使用 Float64 Web Mercator meters；GPU 使用 Tile 局部 Float32。
- Scene 约定：X 向东、Y 向上、Z 向南；高度单位为 meter，MVP 地图平面为 Y=0。
- 浮动原点：使用当前数据 Tile 中心，跨 Tile 或数据 zoom 变化时仅调整 Tile 容器位置，不重建局部顶点。
- Camera：bearing 从北顺时针；pitch 从俯视向地平线，MVP 限制 0-60°；Tile zoom 使用 `floor(view.zoom)` 并支持 source maxZoom overzoom。

## D015 — 分离 Canonical Tile 与 Render Tile

- 状态：Accepted
- 决策：网络、解码和缓存使用 `CanonicalTileKey(sourceId,z,x,y)`；world wrap 使用独立 `RenderTileKey(canonical,wrap)`。
- 状态机：`queued → fetching → decoding → building → ready|empty|failed → disposed`；可见性和缓存保留是正交标记。
- 请求：canonical key 去重，稳定 hash 选节点，网络/5xx 最多三次轮换重试；204 是 empty，404 不是空瓦片。
- 缓存：visible pinned 的 byte-aware LRU；初始 CPU 128 MiB、GPU 256 MiB、256 canonical entries，待 T010 真实验证。

## D016 — 主线程调度，Worker 解码和构建

- 状态：Accepted
- 决策：主线程负责 Camera、Tile Coverage、Fetch、调度、Cache 和 GPU upload；Worker 负责 MVT 解码、过滤、投影、Polygon 三角化和 Line mesh 构建。
- 协议：`protocolVersion: 1`，输入输出使用 transferable ArrayBuffer；取消使用 jobId，stale generation 结果不得挂载。
- Worker 数：默认 `clamp(hardwareConcurrency - 1, 1, 4)`，测试可注入单 Worker。
- 原因：浏览器 Fetch 不阻塞主线程，而解码/几何属于 CPU 密集工作；该边界也避免 Worker 访问 DOM/Three.js Renderer。

## D017 — Tile 内按 Layer/Material 建批次

- 状态：Accepted
- 决策：Batch 粒度为 Tile × public layer × geometry type × material key × render pass；禁止 Feature 级 Object3D。
- Polygon：识别 outer/hole ring 并三角化；Line 使用屏幕空间宽度三角带，MVP 只保证 bevel join 和 butt cap。
- Feature 映射：批次保留 Uint32 feature id 或等价范围表，为后续 Picking 保留数据契约，但 MVP 不开放 Picking API。
- 跨 Tile 合批：MVP 禁止，只有性能证据证明必要时再由决策会话决策。

## D018 — Map3D 根所有权与显式 GPU 销毁

- 状态：Accepted
- 决策：Map3D 拥有 Renderer、Scene、Worker Pool、Tile Cache、Material Registry 和 Diagnostics。
- Tile 所有权：Tile 独占 container、geometry、attributes 和 feature mapping；Material 由 registry 引用计数共享。
- 销毁顺序：停止循环和请求 → 取消 Worker → detach Tile → dispose geometry/material → terminate Worker → dispose Renderer。
- 设备丢失：MVP 报告 fatal `RENDERER_LOST`，由应用重建 Map3D；自动恢复不进入 MVP。
- 实施：T006 已验证固定 Polygon Tile 的 container/Geometry/Material 引用释放、fetch/Worker cancel、重复 dispose 和双后端资源统计归零；动态 Cache eviction 由 T008 延续该所有权模型。

## D019 — 确认 Map3D 0.1 最小公共 API

- 状态：Accepted
- 决策：稳定 API 只包含 constructor、initialize、resize、ViewState get/set、start/stop、backend/stats、typed events、getRenderer escape hatch 和 dispose。
- 配置：单个 MVT source、按顺序的 fill/line layers、初始 ViewState、renderer 选项和 cache 预算。
- Style：只支持常量 fill/line paint、zoom 范围和 `==/!=/in/!in/has` 属性过滤，不宣称兼容 Mapbox Style v8。
- 生命周期：initialize 幂等；dispose 幂等且为终态；当前公开 scene/camera 字段不进入 0.1 稳定 API。
- 错误：参数/fatal 初始化错误抛出，后台 Tile 错误通过 typed event；取消不作为 error。

## D020 — 采用分层测试与真实浏览器性能门槛

- 状态：Accepted
- 决策：Unit + 固定真实 KYE fixture integration + package integration + 真实浏览器人工矩阵。
- 浏览器：MVP 阻断矩阵为 Windows 目标工作站的当前稳定 Chromium WebGPU、强制 WebGL2 和无 WebGPU 自动 fallback。
- 初始门槛：worker 单 Tile decode/build P95 ≤25 ms；WebGPU frame P95 ≤20 ms；WebGL2 frame P95 ≤25 ms；单帧 upload P95 ≤8 ms。
- 内存：byte-aware cache 预算和三轮交互/生命周期无持续资源增长；网络冷启动单独记录，不为外部 KYE 服务预设 SLO。
- 依据：完整定义见 `docs/verification-baseline.md`；这些数字是待验证验收目标，不得写成已验证知识。

## D021 — 使用成熟 MVT 与三角化依赖

- 状态：Accepted
- 决策：实施会话默认评估并使用 `pbf`、`@mapbox/vector-tile` 和 `earcut`，分别承担 protobuf、MVT v2 和 Polygon hole 三角化。
- 替代方案：自研 decoder/triangulation，或导入 Three.js 非公开 Earcut 路径。
- 影响：增加三个小型运行依赖和 Worker bundle 体积，但显著降低协议与几何算法风险；对应 Task 必须核对精确版本、许可证、类型、ESM/Worker 构建和 bundle 结果。
- 实施：T004 已安装并验证 `pbf` 5.1.2 与 `@mapbox/vector-tile` 3.0.0；均为 BSD-3-Clause、ESM 并内置 TypeScript 类型。T005 已安装并验证 `earcut` 3.2.3；其为 ISC、ESM、内置 TypeScript 类型，并可构建进不含 Three.js 的独立 Worker bundle。
- 约束：Three.js 版本保持 0.185.1，不在这些 Task 中升级。

## D022 — MVP 官方演示采用浅色地图视觉基线

- 状态：Accepted
- 确认日期：2026-09-09
- 人工方向：地图效果参考 Apple Maps 的浅色、清爽和低噪声体验。
- 决策：Nova 采用原创的 Apple Maps-inspired 浅色视觉方向；不复制 Apple 的专有样式、资产、字体、图标或标识，也不宣称像素级等价。
- 语义：一般土地为浅中性色，水体为柔和浅蓝，建筑为低对比冷灰，道路通过 casing/fill 建立层级，绿色只表达经字段确认的植被类别。
- 边界：该视觉基线约束官方 Playground 和 MVP 截图验收；SDK 继续接收通用 fill/line layer 配置，不新增默认 style preset 或公共 API。
- 限制：MVP 仍不包含文字、Glyph/Sprite 和完整 Style v8，因此交付目标是无文字的浅色底图骨架。
- 依据：颜色 token、层级和验收规则见 `docs/visual-style-baseline.md`。

## D023 — Target/Display Coverage 分离并渐进替换 Tile

- 状态：Accepted
- 确认日期：2026-09-09
- 人工方向：zoom 加载新 Tile 时静默更新，不允许整片闪白或硬切。
- 决策：Tile 数据状态保持不变，新增正交的 Target Coverage 与 Display Coverage；exact 未 ready 时使用最近 ready ancestor、可覆盖的 descendant 或 outgoing Tile。
- 提交：Tile 完成 GPU upload 后才进入显示集合；初始以 180 ms 为目标短淡入，fallback 在替代覆盖和过渡完成后才解除 display pin。
- 快速输入：只允许最新 Target Coverage 提交，过时结果可缓存但不得回挂；exact 失败时保留 fallback 并报告 degraded 状态。
- 预算：正常最多显示 exact 与一个 fallback/outgoing 层级；过渡资源计入预算，pressure 下先停 prefetch。
- 约束：不改变 canonical 请求去重、Tile lifecycle、Feature/Batch 边界和公共 Map3D API。详细基线见 `docs/experience-baseline.md`。

## D024 — MVP 交互采用基于时间的有界惯性

- 状态：Accepted
- 确认日期：2026-09-09
- 人工方向：拖动和旋转释放后具有类似常用地图的阻尼过渡。
- 决策：主动 pointer drag 保持跟手；释放后根据最近输入样本估算 pan、bearing、pitch velocity，并通过 requestAnimationFrame 和真实 delta time 指数衰减。
- Wheel：短时间事件合并到帧更新，保持连续 zoom；MVP 不增加 zoom-to-cursor、pinch 或完整触摸手势。
- 取消：新输入、外部 setView、边界、页面失活和 dispose 立即取消旧运动；reduced-motion 禁用释放惯性。
- 约束：不新增公开阻尼参数或 flyTo/easeTo API；参数由 T014 双后端人工调校。详细基线见 `docs/experience-baseline.md`。

## D025 — 倾斜视角使用 TSL 远景渐隐

- 状态：Accepted
- 确认日期：2026-09-09
- 人工方向：3D 倾斜视角下远处逐渐淡出，形成深度提示。
- 决策：Polygon/Line 共用 TSL/Node Material 路径，根据 pitch、Camera target distance 和 ground footprint 将远景平滑融合到 renderer background/haze color。
- 约束：pitch 0 不改变画面；近景保持可读；fogEnd 之前不得用渐隐掩盖加载空洞或 seam。高倾角有效 Coverage 边界和 loadCutoff 按 D029 执行，不通过简单裁短 Camera far plane 实现。
- 技术边界：WebGPU/WebGL2 使用同一节点实现，不引入 post-processing、天空、Terrain、Globe 或独立 GLSL/WGSL。
- API：MVP 使用自动推导的默认效果，不新增公开 atmosphere API。详细基线见 `docs/experience-baseline.md`。

## D026 — Line 样式 Pass 复用共享几何

- 状态：Accepted
- 确认日期：2026-09-10
- 背景：T010 北京 city z10 clean harness 在 48 个 visible tile 下报告 `171,828,744` bytes CPU/GPU resource，超过 128 MiB CPU 初始 cache 预算；复算显示约 `168,412,544` bytes 来自 Line，其中 `road-casing`/`road-fill` 与 `major-road-casing`/`major-road-fill` 重复生成相同道路 topology 是主要原因；证据见 `docs/evidence/T016-line-resource-breakdown.json`。
- 决策：同一 Tile 内 sourceLayer、filters、zoom 可见性和 line topology 规则相同的 Line 图层允许共享 Worker 生成的 geometry/topology 和 GPU BufferGeometry；每个 public line layer 仍保留独立 material、width、opacity、renderOrder 和 draw pass。
- 约束：不修改 Map3D 0.1 公共 API、Layer 配置格式、Tile lifecycle、canonical/render key、source 请求语义或 T010 128 MiB CPU 验收门槛；不得通过隐藏道路、降低 city zoom、减少 visible coverage 或提高默认 cache 预算解除阻断。
- 统计：CPU/GPU byte estimate 必须按实际持有的共享 buffer 计数，重复 draw pass 不重复计算共享 TypedArray/GPU buffer bytes；batch/pass/object 数需要保持可解释。
- 影响：D017 的 Batch/Material 粒度保留为渲染 pass 语义，但 Line 的 topology/resource 可以在多个 pass 之间共享；跨 Tile 合批仍不进入 MVP。
- 实施：T016 已完成 geometry 共享、clean harness、60 秒交互、生命周期、fallback 和网络异常矩阵；T010 的资源阻断已解除并完成最终发布判断，CPU cache 余量极小的事实继续保留。

## D027 — 高倾角 Coverage 使用混合 LOD 四叉树选择

- 状态：Accepted
- 确认日期：2026-09-10
- 背景：当前 Coverage 在单一 `floor(view.zoom)` 层级枚举 visible Tile，随后按屏幕中心距离执行默认 128 Tile 硬截断；高 pitch 和宽视口下候选 Tile 数显著超过上限，会确定性地删除左右侧 coverage-critical Tile。代表性 `zoom 15 / pitch 60 / 2555 × 1385` 复算为 334 个候选仅保留 128 个。
- 决策：Target Coverage 改为基于 Camera Frustum、Tile 包围体和 projected tile size/screen-space error 的混合 LOD 四叉树选择；近景细分到高 zoom，远景保留低 zoom。
- 覆盖不变量：Tile 数量预算通过停止 refinement 或 child 合并回 parent 实现；不得任意删除 fogEnd/loadCutoff 定义的有效可见区域内 Tile。有效区域必须由 selected Tile 或其 selected ancestor 完整覆盖。
- Layer 语义：Layer `minZoom/maxZoom` 按被选中 Tile 的 canonical zoom 生效；人工负责人确认远景低 LOD 自然隐藏建筑等高精细内容符合目标体验。
- 调度：T017 完成 Coverage 正确性和 mixed LOD；T018 的旧 Runtime 调度实现虽有自动证据但人工观感未通过，T020 已修复 Retained Cache，T021 的旧路径空间替换代码也未通过人工观感。D030/T023 将 coverage-first、motion-aware、best-available 和提交规则迁移到独立 V2；T022 接入 V2 的雾效加载边界，最后由 T019 执行发布验证。
- 保留：Canonical/Render TileKey、canonical 请求去重、Worker protocol、byte-aware Cache、T013 Target/Display Coverage、T015 horizon fade 和 Map3D 0.1 公共 API 保持不变。
- 禁止：不通过提高默认 Tile/cache 预算、任意删除有效区域 Tile、简单缩短 Camera far plane、固定屏幕 LOD 分带或引入完整 MapLibre/deck.gl Runtime 规避问题。D029 批准的共享 fog/load cutoff 不属于任意 Coverage 截断。
- 外部依据：MapLibre GL JS `coveringTiles` 的四叉树/Frustum/距离 LOD 与 SourceCache parent/child 保留，以及 deck.gl TileLayer 的 best-available refinement 和调度参数；详见 `docs/research/tile-lod-scheduling.md`。

## D028 — Ready Tile 使用预算内 Retained Cache 与空间替换

- 状态：Accepted
- 确认日期：2026-09-10
- 背景：T017/T018 后连续 pan 仍出现闪烁和重复加载。代码审计确认无 consumer 的 Ready Tile 会在预算 LRU 之前立即释放，warm ancestor 可形成 ready → dispose → request 循环；Display Coverage 的 outgoing 也缺少 parent/children 空间替换完整性。
- 决策：Ideal Target Coverage、当前 Render Cover 和 Retained Cache 必须是三个独立集合。Ready Tile 离开 Target/Display 后继续按 byte-aware LRU 驻留；只有预算淘汰、source invalidation、失败策略或 Map3D dispose 才释放。
- 显示：parent/fallback 必须保留到同一空间区域的 replacement children 全部 ready 并可同帧提交；same-zoom pan 和 cache hit 不重新淡入。过渡仅用于明确的 LOD replacement，并保持单调。
- 渲染：Tile Render instance/material 应稳定复用，避免 render key 短暂变化造成反复 clone/dispose 或材质 pipeline 更新。
- 预算与 API：继续使用 256 entries、128 MiB CPU、256 MiB GPU 默认预算，不新增公开 Cache、scheduler 或 transition API。
- 实施：T020 已完成 Retained Cache、cache hit、warm ancestor request suppression 和请求原因诊断；T021 完成旧路径 spatial best-available replacement 代码，但人工观感未通过。T023 重新建立生产 authority，之后再接入 T022/T019。

## D029 — 高倾角雾效定义有效 Coverage 与加载边界

- 状态：Accepted
- 确认日期：2026-09-10
- 人工方向：高 pitch 时远景雾效更强，完全雾化区域之后无需继续加载和渲染，体验参考成熟地图引擎的自然渐隐和受控 Tile 数量。
- 决策：Shader 和 mixed-LOD selector 共用自动推导的 fogStart、fogEnd、loadCutoff 与 guard band。fogStart 后逐渐降低 refinement，fogEnd 完全融合到背景，Tile 包围体完全超过 loadCutoff 后不进入 Target、Fetch、Worker 或 Render。
- 覆盖：fogEnd 之前仍必须由 selected Tile 或 ready ancestor 完整覆盖；与 loadCutoff 相交的 Tile 保留。guard band、运动预测和迟滞用于避免边界 popping，不允许在完全雾化区域继续高精度 refinement。
- 平面视角：pitch 0 保持现有 Coverage 和视觉；不改变公共 ViewState、Layer、renderer 或 atmosphere API。
- 技术边界：继续使用 Three.js TSL/Node Material 和 WebGPU/WebGL2 共享实现，不引入天空、Terrain、Globe、后处理或完整第三方地图 Runtime。
- 实施：T023 稳定 V2 生产路径后执行 T022；T019 负责量化 Tile、请求、CPU/GPU、对象和视觉绝对验收指标。
- 依据：`docs/research/tile-retention-display-fog.md`。

## D030 — 采用独立 TileEngineV2 替换旧 Tile Runtime 生产路径

- 状态：Superseded by D031
- 确认日期：2026-09-11
- 背景：T021 的自动测试和真实浏览器脚本通过，但人工负责人确认连续 pan/zoom 仍然慢，Tile 在停止交互后才集中出现，运动期间没有可感知的有效预加载，Tile 以先后顺序逐块显示，并且仍有白闪。代码审计显示问题横跨运动调度、Target/Display 提交时序、fallback 空间覆盖、Retained Cache 生命周期和 Render instance/material 复用，继续给旧 Runtime 打补丁不能提供清晰的架构边界或可维护的行为保证。
- 决策：建立独立的 `TileEngineV2`，作为后续唯一的生产调度与显示 authority。V2 明确分离 `Target Coverage`、`Render Cover` 和 `Retained Cache`，采用 best-available coarse cover、parent/child 空间 replacement cohort、同帧提交、same-zoom/cache hit 直接显示、coverage-first 请求优先级、预算内预取和确定性的 generation/cancel/failure/dispose 规则。
- 借鉴边界：只借鉴 MapLibre/deck.gl 已验证的状态机、best-available、parent/child retain、请求调度和缓存规则；不直接引入完整 MapLibre/deck.gl/Cesium Runtime，不新增其 Runtime 依赖。
- 保留边界：继续使用现有 `CanonicalTileKey`/`RenderTileKey`、KYE XYZ/MVT Source、Worker protocol v1、Polygon/Line batch、MapOrigin、Layer recipe、Three.js GPU upload、WebGPU/WebGL2、Material Registry、Map3D 0.1 公共 API 和资源 ownership。除非后续决策会话单独确认，V2 不改变这些公共契约。
- 迁移规则：旧 `TileMotionScheduler`、旧 Display Coverage 调度/显示 authority 不再继续追加功能补丁，也不得与 V2 双轨消费同一 Map3D 实例。迁移期间旧代码最多作为隔离的参考/回滚记录；切换完成后生产路径必须只有 V2。
- 验收规则：不以旧 Runtime 与 V2 的 A/B 对比决定问题是否存在；以绝对行为、可追溯调度/提交诊断、自动测试和真实浏览器人工 pan/zoom 观感作为阻断验收。T022 fog-bounded Coverage 和 T019 发布验证在 V2 稳定后重新接入/规划。
- 对应任务：`tasks/T023-tile-engine-v2.md`。

## D031 — 冻结 V2 补丁链并建立瓦片子系统重置与 AI 上下文隔离

- 状态：Accepted
- 确认日期：2026-09-12
- 背景：T021、T023 和 T025 均出现自动测试与真实浏览器脚本通过但人工体验失败。人工负责人明确反馈初始化水波式加载、pan/zoom 加载滞后、停止后请求波次、逐块显示、白闪、低帧率和 pan 卡顿仍存在。
- 决策：冻结 T026/T027 的 V2 补丁链，不再把它们作为默认下一步；T021/T023 的人工失败结论升级为正式阻断状态；新增 T028 作为瓦片子系统重置与 AI 上下文隔离入口。
- 保留边界：KYE XYZ/MVT Source、Worker protocol v1、Polygon/Line geometry build、Three.js GPU upload、WebGPU/WebGL2、Map3D 0.1 公共 API 和资源 ownership 继续作为默认保留边界，除非后续决策单独改变。
- AI 隔离：新瓦片实施任务必须使用 `Task Context Packet`，显式隔离旧 Runtime、旧 Display Coverage、旧 Motion Scheduler 和 TileEngineV2 补丁链；任何需要突破隔离墙的实现行为都必须返回决策会话。
- 对应分片：`docs/decisions/D031-tile-system-reset-and-ai-context-isolation.md`。
- 对应任务：`tasks/T028-tile-subsystem-reset-context-isolation.md`。

## D032 — TileStreamingEngine 全新瓦片系统重建

- 状态：Accepted
- 确认日期：2026-09-12
- 背景：D031 已冻结 TileEngineV2 补丁链，后续路线需要避免从旧运行时、旧显示覆盖、旧运动调度和 V2 补丁语义继续派生实现。
- 决策：新系统命名为 `TileStreamingEngine`；它是全新瓦片系统，不是 TileEngineV2 的升级、补丁或 V3 续作。
- 实施：T029 作为下一步实施任务，一次性交付可运行垂直切片，并删除或隔离旧瓦片生产路径。
- 架构：新引擎内部显式分离 TilePyramid、TileCoverSelector、TileRequestScheduler、TileCache、TileUploadBudget、TileRenderCover 和 TileDiagnostics。
- 验收：按完整 Render Cover、best-available fallback、原子替换、有界请求、有界 Worker、有界 upload、空间公平调度、缓存复用和资源预算等通用不变量验收。
- 对应分片：`docs/decisions/D032-tile-streaming-engine-clean-rebuild.md`。
- 对应任务：`tasks/T029-implement-tile-streaming-engine.md`。

## D033 — NovaTileEngine 任务化重建方案

- 状态：Accepted
- 确认日期：2026-09-13
- 决策：系统名称为 `NovaTileEngine`（NTE），采用 TileAddress、TilePyramid、GroundFootprint、TileCoverPlanner、MotionPredictor、TileRequestScheduler、TileFetchPipeline、TileWorkerBridge、TileCache、TileUploadQueue、TileRenderCover、TileResourceRegistry、TileDiagnostics 和 NovaTileEngine 模块。
- 契约：使用当前 Map3D 0.1 公共接口、WGS84/Web Mercator、XYZ/MVT v2、gzip、HTTP 204、Worker protocol v1、Polygon/Line batch、Three.js WebGPU/WebGL2。
- 运行：初始化先提交完整 Bootstrap Cover，再执行 Exact Refinement 和 Motion Lookahead；混合 LOD 使用 SSE、迟滞、相邻层级差值 `≤1` 和完整 Ground Footprint。
- 预算：Fetch、Worker、Upload、Commit 采用帧级预算；CPU Cache 128MiB、GPU Cache 256MiB、Canonical Entries 256、Worker P95 `≤25ms`、WebGPU Frame P95 `≤20ms`、WebGL2 Frame P95 `≤25ms`、Upload P95 `≤8ms`。
- 验收：双后端真实 Chromium、慢网、60 秒交互、dispose、自动测试、timeline 和人工体验共同构成发布证据。
- 任务：T031～T044 按契约、覆盖、调度、管线、缓存、渲染、资源、诊断、集成、浏览器、人工、切换和发布顺序执行。
- 对应分片：`docs/decisions/D033-nova-tile-engine-plan.md`。
