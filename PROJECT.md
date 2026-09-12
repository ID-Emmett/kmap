# Nova Project Status

更新日期：2026-09-12

## 项目背景

Nova 以现有 Kyemap JSAPI 和 KYE 数据研究为事实输入，建设独立、模块化、可发布的 Web 3D 地图 SDK，逐步替代对厂商地图运行时和历史适配层的强耦合。

## 项目目标

基于公司 KYE 地图数据、Three.js 和 WebGPU/WebGL2 渲染后端，为物流业务提供统一空间可视化基础能力。

## 当前阶段

T009 Line Batches and Dynamic MVP Runtime 已完成。核心功能链已经贯通，T011-T015 已完成视觉与连续体验阻断项修复并经人工接受。

Project Control 已建立 T011 规则网格水印伪影诊断/修复、T012 浅色底图、T013 渐进式 Tile 替换、T014 阻尼交互和 T015 倾斜远景渐隐。T016 已完成 Line casing/fill 几何复用并解除 T010 资源阻断；T017 已按 D027 完成 mixed-LOD Coverage，T020 已完成预算内 Retained Cache 和 warm ancestor request thrash 修复。T021 Spatial Replacement 的代码、自动测试和真实浏览器脚本虽已完成，但人工负责人明确不接受 pan/zoom 加载观感；T023 已将生产路径切换为独立 TileEngineV2，自动与真实 Chromium 回归通过，但人工验收仍明确失败。T024 已完成真实 Render transaction、初始 parent fallback 和空间完整 Render Cover 提交；当前按 T025→T026→T027 继续建立运动调度、预算配额和人工验收闭环；T018 旧调度路径保持 BLOCKED，T022/T019 等 V2 稳定后再执行。

## 当前事实基线

- TypeScript 7.0.2，strict，ESM。
- pnpm workspace 负责 Monorepo 依赖和命令编排。
- Vite 8.2.2 统一构建 SDK 与 Playground。
- Three.js 0.185.1，精确锁定。
- `WebGPURenderer` 默认 WebGPU，自动 WebGL2 fallback，可通过 `forceWebGL` 验证回退路径。
- Playground 使用 Three.js Inspector；SDK 不依赖 Playground 或 Inspector。
- 主 KYE 数据为标准 Web Mercator XYZ、gzip HTTP 响应中的 MVT v2、extent 4096。
- Polygon 三角化使用 `earcut` 3.2.3；Worker bundle 不包含 Three.js。
- 固定 `z15/26978/12416` Polygon 场景在当前 Chromium 的 WebGPU 与强制 WebGL2 中通过可视验证；三个 batch 对应 276 features、2,139 vertices、4,755 indices 和 53,244 bytes TypedArray/GPU estimate。
- Camera 使用 45° 垂直 FOV 和 256px XYZ zoom 语义；不同 viewport/resize 已通过纯数学测试，WebGPU/WebGL2 下基础 pan、连续 zoom 和 bearing/pitch 已通过真实浏览器验证。
- 当前可见集使用 Camera Frustum/Tile AABB、projected tile size 和 best-first 四叉树 refinement 生成 mixed canonical zoom Target Coverage；默认 128 Tile 数量预算通过停止细分或父级合并满足，支持日期线 world wrap、source bounds、Y 边界和 maxZoom overzoom，并与 MapOrigin/horizon fade 的 `referenceZoom` 解耦。
- 当前 TileEngineV2 按 canonical key 共享多个 render wrap consumer，默认限制 8 个 Fetch、4 个 Worker job、256 entries、128 MiB CPU 和 256 MiB GPU。T020/T021 已形成 Retained Cache 与空间 replacement 的代码证据；T023 已将这些边界接入唯一生产 authority；T024 已将 upload 完成后的显示提交收敛到 rAF transaction，并在初始无显示时请求 parent fallback。
- 已验证 KYE Style、主 MVT、水系、行政区、Raster、Glyph、Sprite、动态业务 MVT 和 Geobuf；适用范围和样本限制以 `docs/research/` 为准。

## MVP 基线

目标：使用真实 KYE 主 MVT，在 Three.js 中交付最小动态 Polygon/Line Tile Runtime。

纵向链路：

```text
KYE Tile
→ Browser Fetch / HTTP gzip
→ MVT decode
→ Worker Polygon/Line batches
→ Tile GPU resources
→ WebGPU / WebGL2
→ Camera-driven dynamic tile lifecycle
```

范围：

- WGS84 `ViewState`、Web Mercator meters、Tile 局部 Float32 和浮动原点。
- Camera 平移、连续 Zoom、Bearing、Pitch 和可见 Tile Coverage。
- Canonical/Render TileKey、请求去重、取消、204 empty、重试、byte-aware LRU。
- Polygon/Line、常量样式、最小属性过滤和 Tile 内批处理。
- Worker 协议、transferable buffers、Feature 映射和 GPU 资源所有权。
- typed events/errors/stats、WebGPU/WebGL2、真实浏览器和性能验证。
- 官方 Playground 使用原创的 Apple Maps-inspired 浅色底图骨架，不存在非预期规则网格水印或 Tile 接缝。
- zoom/pan 的目标架构由 T023-T026 TileEngineV2 负责使用 Ideal Target、原子 Render Cover、连续运动调度和 Retained Cache；T024 已完成 Render transaction 与稳定 coarse cover，T025/T026 继续处理运动调度和预加载配额。
- pan 与 bearing/pitch 旋转在释放后具有基于帧时间的有界惯性；wheel zoom 合并为连续帧更新。
- pitch 增大时，远处 Polygon/Line 使用统一 TSL 效果渐隐到浅色背景；D029 进一步要求 fogEnd 完全融合，loadCutoff 外停止 Tile 选择、请求、构建和渲染，由 T022 实施。

Non-Goals：

- 文字/Glyph/Sprite、完整 Mapbox Style v8。
- 3D 建筑、Terrain、Globe、Picking、Overlay 和业务 MVT/Geobuf。
- Raster、离线包、跨 Tile 合批和自动设备丢失恢复。

文字名称相对原 MVP 被移出，避免在 Tile Runtime 证据形成前引入 shaping、atlas、碰撞和多语言 fallback。该范围变化由 D013 确认。

## 公共 API 基线

`@nova/map3d` 0.1 API 包含：

- constructor：Canvas、单 MVT source、fill/line layers、初始 ViewState、renderer/cache options。
- 生命周期：`initialize/resize/start/stop/dispose`。
- 视图：`getView/setView`。
- 诊断：`getBackend/getStats/on`。
- `getRenderer` 仅作为 Inspector/高级集成 escape hatch，所有权仍属于 Map3D。
- 当前公开 `scene/camera` 不进入 0.1 稳定 API。

精确结构、错误模型和约束见 `docs/architecture.md`；修改稳定公共 API 必须返回 Project Control。

## 测试与性能基线

- 自动：Unit、固定真实 KYE fixture integration、package integration、`pnpm check`。
- 人工：Windows 目标工作站当前稳定 Chromium WebGPU、强制 WebGL2、无 WebGPU 自动 fallback。
- 初始目标：Worker 单 Tile P95 ≤25 ms；WebGPU frame P95 ≤20 ms；WebGL2 frame P95 ≤25 ms；upload P95 ≤8 ms。
- 初始 cache：CPU 128 MiB、GPU 256 MiB、256 canonical entries，按实际 byte 估算并由 T010 验证。
- 网络冷启动单独记录；当前不为外部 KYE 服务预设 SLO。

完整协议见 `docs/verification-baseline.md`。T010 已形成当前 Windows 工作站的真实性能事实；T016 后北京 city z10 双后端均低于 128 MiB CPU cache 预算，但余量仅 47,403/22,270 bytes，仍需作为贴近上限的风险持续观察。60 秒交互 long task 已通过 Chrome trace 定位为渲染帧更新、Worker 回调和 WebGL2 worker message 主线程处理方向，当前作为非阻断性能风险保留。

## 已完成

- T001：Monorepo、SDK/Playground、空场景和渲染后端骨架。
- Project Control 已依序审阅 AGENTS、PROJECT、TASKS、KNOWLEDGE、architecture、decisions 和当前 research；2026-09-10 新增高倾角 Tile LOD/调度专题研究。
- T002 已形成 D013-D021 候选决策、架构/验证文档和 T003-T010 Task 规格。
- T003：公共空间类型、Web Mercator、TileKey、ViewState 归一化、浮动原点和 21 个 SDK 单元测试。
- T004：MVT Source、Fetch/重试/取消、错误分类、MVT v2 解码、真实 KYE fixture 和 `pbf`/`@mapbox/vector-tile` ESM 依赖验证。
- T005：Worker version 1 协议、transferable、Polygon ring/hole 三角化、Tile 批次、Feature 映射、属性过滤和 `earcut` 依赖验证。
- T006：固定 KYE Polygon Tile 的 Three.js GPU 资源、材质 registry、WebGPU/WebGL2 显示、统计与确定性释放验证。
- T007：ViewState store、typed `viewchange`、45° PerspectiveCamera、基础交互、有限视锥地面覆盖、visible/prefetch Tile Coverage 和跨 zoom MapOrigin 重定位。
- T008：canonical Tile 状态机、请求/Worker 调度、取消与 stale generation、failed cooldown、byte-aware LRU、visible pin、pressure/idle/stats/error 事件和 adapter 释放编排。
- T009：Worker Line batch、fill/line 统一 feature table、动态多 Tile Map3D、Polygon/Line Render adapter、world-wrap 渲染实例、公共 API/README 和 WebGPU/WebGL2 浏览器功能验证。
- T010：当前 Windows 目标工作站的 WebGPU/WebGL2/fallback、视觉、连续体验、生命周期、网络异常、worker/upload、frame/input response 和资源预算验证完成；发布判断为 `PASS_WITH_NON_BLOCKING_LONG_TASK_RISK`。
- T011-T015：规则网格伪影修复、浅色底图、渐进式 Tile 替换、阻尼交互和倾斜远景渐隐，均已完成自动、浏览器和人工体验验收。
- T016：同 Tile 重复 Line 样式 pass 共享 Worker TypedArray 与主线程 BufferGeometry，保持独立材质、宽度、opacity、renderOrder 和 draw pass；双后端资源、性能、连续体验、生命周期和网络异常回归通过。
- T017：Frustum/AABB 与 projected-size 驱动的 mixed-LOD Target Coverage、预算父级降级、LOD 迟滞/邻接连续性、reference zoom 解耦和静态 priority role 已完成自动、双后端、慢网、生命周期与人工视觉验收。
- T020：Ready/empty/failed Retained Cache、LRU access 刷新、warm ancestor 抑制、请求原因诊断和双后端 A → B → A canonical request histogram 已完成；静止 30 秒无新请求。
- T024：TileEngineV2 Render transaction、rAF commit gate、初始 parent fallback 请求、空间完整 Render Cover 提交和 parent/child 原子 replacement 已完成；自动、`pnpm check` 和真实 Chrome 双后端/延迟/reduced-motion/offline/dispose 回归通过。

## 进行中

- T023：独立 TileEngineV2 已切换为唯一生产调度/显示 authority，自动测试、构建和真实 Chromium 回归通过，但人工负责人验收不通过，当前 `VERIFYING`。
- T025-T026：针对运动中连续调度/公平性、Coverage 与 prefetch 预算解耦的修复任务已建立，按顺序执行。
- T027：待 T025-T026 完成后执行逐帧诊断与真实 Chromium 人工验收。
- T021：按空间的 best-available replacement 和 Render instance/material 稳定化已完成代码、自动验证和真实浏览器回归，但人工负责人明确不接受 pan/zoom 加载观感，当前 VERIFYING。
- T018：旧 Runtime 的 coverage-first/motion-aware 路径保持 BLOCKED，不再追加补丁，待 T023 完成后由 Project Control 关闭或重新定义。
- T022：fogStart/fogEnd/loadCutoff 保持 BACKLOG，必须接入 V2 后再实施。

## 下一步

1. 按 T025→T026 顺序修复运动调度和预加载配额。
2. 执行 T027，使用逐帧诊断和真实 Chromium 人工操作重新验收；通过后关闭/更新 T023，并关闭或重新定义 T018。
3. 执行 T022，实现高倾角 fogStart/fogEnd/loadCutoff。
4. 执行 T019，复核 V2 的双后端、慢网、资源、long task 和最终加载体验并形成发布判断。
5. 如最终发布指定另一台目标设备，在该设备重复真实浏览器矩阵。

## 已确认架构约束

D001-D012 继续有效：

- Monorepo，SDK 与 Playground 分离，SDK 可独立构建发布。
- Three.js 0.185.1、WebGPURenderer、WebGPU/WebGL2 和 TSL。
- Inspector 只在 Playground / 开发环境。
- Feature 不创建独立 Object3D；Tile 是重要运行时管理单位。
- TypeScript 模块化设计，源文件以 500 行为上限目标。

D013-D021 已确认并作为 T003-T010 的实施基线。

D022 已确认官方 MVP 使用原创的 Apple Maps-inspired 浅色视觉方向，不改变通用 SDK Layer API，并由 T011-T012 完成缺陷修复与视觉收敛。

D023-D025 已确认渐进式 Tile 展示、交互阻尼和倾斜远景渐隐为 MVP 阻断能力；现有 Map3D 0.1 公共 API 暂不扩大。

D026 已确认同一 Tile 内重复 Line 样式 pass 可共享 geometry/topology 和 GPU BufferGeometry，每个 public line layer 仍保留独立 material、width、opacity、renderOrder 和 draw pass；由 T016 实施。

D027 已确认高倾角 Target Coverage 使用 Frustum/SSE 驱动的 mixed LOD 四叉树选择；数量预算通过停止细分或回退父 Tile 满足，不得删除有效可见区域内 coverage-critical Tile。Layer `minZoom/maxZoom` 按 selected canonical Tile zoom 生效，远景低 LOD 自然隐藏建筑等高精细内容；T017 已完成 selector，T020 已完成 retained cache，T021 已完成旧路径空间显示替换代码和浏览器回归但人工观感失败，T023 已重新建立唯一生产调度/显示 authority，之后再执行 T022/T019。

D028 已确认 Ideal Target Coverage、Render Cover 与 Retained Cache 分离；T020 已完成离屏 terminal record 的 byte-aware LRU 驻留和真实 cache hit，T021 已完成 parent/fallback 的空间等价 replacement cohort 退出条件、same-zoom/cache hit 直接显示和 render instance/material 稳定化；T024 已在 V2 生产路径补齐 rAF Render transaction 与初始 parent fallback。

D029 已确认高倾角 fogStart/fogEnd/loadCutoff 定义有效 Coverage 边界；fogEnd 前保持完整覆盖，loadCutoff 外可停止 Tile 选择、请求、构建和渲染，由 T022/T019 在 T023 V2 生产路径上实施和验证。

D030 已确认停止扩展旧 Tile Runtime 的调度/显示路径，建立独立 `TileEngineV2`；只借鉴 MapLibre/deck.gl 的已验证规则，不引入完整第三方 Runtime，现有 Three.js GPU 上传、WebGPU/WebGL2、Worker protocol 和 Map3D 0.1 公共 API 保持不变。

## 已知风险

- KYE 服务鉴权、CORS、缓存、节点降级和长期版本策略尚未完整验证。
- 完整字段 schema、Polygon hole、跨地域建筑数据和 source-layer 版本兼容仍只有有限样本。
- Raster 512×512 与 tileSize 256 的关系未验证，但 Raster 已移出 MVP。
- 设备丢失和真实目标设备性能尚未实现/测量；当前 GPU byte 仍为 adapter 报告的可解释估算。
- T011 已确认规则网格伪影根因是 KYE MVT Polygon 的 `-80..4176` buffer 几何在相邻 Tile 重叠区域对半透明 landuse/building 重复 alpha blend；Polygon Worker 现将每个三角形裁剪到 `[0, 4096]` 核心 extent。Float32 相邻 Tile 边缘误差约 `0.000122 m`，材质/Shader 状态一致，且 Polygon/Line 禁用 depthTest/depthWrite，已排除坐标精度、材质差异和 Z-Fighting。修复后 WebGPU/WebGL2 截图无规则网格，自动回归通过且用户已确认结果，详见 T011 任务证据。
- T012 浅色底图代码与双后端低/中/高 zoom 证据已完成，人工负责人已确认视觉结果，任务已完成。
- T013 已完成 Target/Display Coverage、两层 ancestor warm fallback、outgoing/display pin 和短过渡；双后端 1500 ms 延迟下的连续 zoom/pan 截图无矩形背景空洞，且 2026-09-10 已获人工负责人接受。
- 任意瞬时 `setView()` 跨越远超 warm ancestor 范围时仍可能在网络响应前露出背景；这不等同于连续 pointer pan，后续若要求跨城 teleport 无空洞需单独确认更低层级 overview 或相机策略。
- T014 已实现 pointer release 惯性、rAF delta-time 阻尼、wheel 帧合并和 reduced-motion 禁用释放惯性；自动验证与双后端浏览器验证通过，且 2026-09-10 已获人工负责人接受。
- T015 已实现按 pitch、camera target distance 和 ground footprint 推导的 Polygon/Line 共享 TSL 远景渐隐；自动验证、双后端 pitch 0/20/40/60 截图、临时禁用对照和 dispose 验证通过，且 2026-09-10 已获人工负责人接受。
- T016 后北京 city z10 clean harness 的 WebGPU/WebGL2 最大 CPU resource 分别为 `134,170,325` 和 `134,195,458` bytes，低于 128 MiB 上限但仅余 `47,403` 和 `22,270` bytes；资源阻断已解除，但 cache 余量极小。T010 Chrome trace 复现 60 秒交互 long task，并将方向定位到渲染帧更新、Worker 回调和 WebGL2 worker message 主线程处理；当前为非阻断性能风险。如最终发布需要另一台指定设备，仍需重复真实浏览器矩阵。
- T017 已修复原单层级硬截断问题，T020 已消除 Ready Tile 立即释放和 warm ancestor 重复请求；T021 已在旧路径补齐 Display Coverage 空间 replacement 不变量并通过自动/浏览器回归，但人工负责人明确不接受 pan/zoom 加载观感。T023 已将这些不变量迁移到唯一 TileEngineV2 生产路径，当前仍需人工确认最终加载体验，不再重新实施旧 T018 路径。
- T021/T023 人工验收已明确不通过：加载延迟、运动期间缺少预加载感、Tile 逐块出现和白闪仍存在。T024 已修复 V2 Render Cover 逐 Tile 提交和初始 fallback 缺口；运动调度、公平队列和预加载预算仍由 T025/T026/T027 继续验证。
- 当前 horizon fade 最大强度不会完全融合到背景，且不减少 Coverage 或请求；D029 已批准 fog-bounded coverage，但 T022 完成前高倾角 Tile 数量和远景渐隐仍不代表目标效果。
