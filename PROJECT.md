# Nova Project Status

更新日期：2026-09-14

## 项目背景

Nova 以现有 Kyemap JSAPI 和 KYE 数据研究为事实输入，建设独立、模块化、可发布的 Web 3D 地图 SDK，逐步替代对厂商地图运行时和历史适配层的强耦合。

## 项目目标

基于公司 KYE 地图数据、Three.js 和 WebGPU/WebGL2 渲染后端，为物流业务提供统一空间可视化基础能力。

## 当前阶段

T009 Line Batches and Dynamic MVP Runtime 已完成。核心功能链已经贯通，T011-T015 已完成视觉与连续体验阻断项修复并经人工接受。

T030 已完成 `NovaTileEngine` 方案、架构规范和任务依赖冻结。T031～T041 已完成 NTE 契约、空间覆盖、LOD、调度、管线、缓存、渲染、资源、诊断、集成和双后端慢网验证；T043 已完成生产入口切换与运行时清理；T045 已完成首屏覆盖规划修复；T046 已完成全量复核并建立生命周期与流式调度修复任务，T042 待 T046 后重跑完整人工验收。

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
- 当前可见集使用 Ground Footprint、Bootstrap `floor(view.zoom)-2`、SSE best-first 四叉树 refinement 生成 mixed canonical zoom Target Coverage；默认 128 Tile 数量预算通过停止细分或父级合并满足，支持日期线 world wrap、source bounds、Y 边界和 maxZoom overzoom，并与 MapOrigin/horizon fade 的 `referenceZoom` 解耦。
- NTE 使用 Canonical key 共享 Fetch、Decode、Build、Cache 和 GPU 数据；运行配额为 8～12 Fetch、2～4 Worker、256 entries、128 MiB CPU 和 256 MiB GPU。
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
- NTE 采用完整 Bootstrap Cover、SSE mixed LOD、运动预测预取、分层 Cache、Cohort Render Commit 和逐帧资源预算。
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

精确结构、错误模型和约束见 `docs/architecture.md`；修改稳定公共 API 必须返回决策会话。

## 测试与性能基线

- 自动：Unit、固定真实 KYE fixture integration、package integration、`pnpm check`。
- 人工：Windows 目标工作站当前稳定 Chromium WebGPU、强制 WebGL2、无 WebGPU 自动 fallback。
- 初始目标：Worker 单 Tile P95 ≤25 ms；WebGPU frame P95 ≤20 ms；WebGL2 frame P95 ≤25 ms；upload P95 ≤8 ms。T041 复跑中 frame P95 双后端均为 6 ms；WebGPU Worker/Upload P95 为 256.3/8.6 ms，WebGL2 为 46.5/6.2 ms，超标项保留到 T042/T044 性能复核。
- 初始 cache：CPU 128 MiB、GPU 256 MiB、256 canonical entries，按实际 byte 估算并由 T010 验证。
- 网络冷启动单独记录；当前不为外部 KYE 服务预设 SLO。

完整协议见 `docs/verification-baseline.md`。T010 已形成当前 Windows 工作站的真实性能事实；T016 后北京 city z10 双后端均低于 128 MiB CPU cache 预算，但余量仅 47,403/22,270 bytes，仍需作为贴近上限的风险持续观察。60 秒交互 long task 已通过 Chrome trace 定位为渲染帧更新、Worker 回调和 WebGL2 worker message 主线程处理方向，当前作为非阻断性能风险保留。

## 已完成

- T001：Monorepo、SDK/Playground、空场景和渲染后端骨架。
- 决策会话已依序审阅 AGENTS、PROJECT、TASKS、KNOWLEDGE、architecture、decisions 和当前 research；2026-09-10 新增高倾角 Tile LOD/调度专题研究。
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
- T025：TileEngineV2 已移除 idle-only refinement debounce，增加 coverageRank 距离带轮询、deadline/age starvation 队列公平性和 requestQueue/notBefore 诊断；自动、`pnpm check` 和真实 Chrome WebGPU/WebGL2 1500 ms pointer pan / wheel zoom / reduced-motion 回归通过。
- T028：瓦片子系统重置与 AI 上下文隔离已完成。
- T030：NovaTileEngine 方案、架构规范和任务依赖已冻结。
- T031～T041：NTE 契约、空间覆盖、混合 LOD、运动调度、数据管线、分层缓存、Render Cover、上传预算、资源登记、诊断 Timeline、集成测试和真实 Chromium 双后端/慢网验证已完成；T041 功能断言和 dispose 资源归零通过。
- T045：NTE 初始 Bootstrap/Exact 覆盖细化修复、LOD 回归和生产双后端首屏 smoke 已完成。

## 进行中

- T042：NTE 人工体验验收，待重跑完整双后端轨迹。
- T044：删除后回归与发布验证，等待 T042 重跑完成。

## 历史任务记录

- T021：按空间的 best-available replacement 和 Render instance/material 稳定化已完成代码、自动验证和真实浏览器回归，但人工负责人明确不接受 pan/zoom 加载观感，当前 BLOCKED。
- T023：独立 TileEngineV2 已切换为唯一生产调度/显示 authority，自动测试、构建和真实 Chromium 回归通过，但人工负责人验收不通过，当前 BLOCKED。
- T026/T027：V2 预算补丁与最终验收链已由 D031 冻结，当前 BLOCKED。
- T018/T022/T019：旧 Runtime motion-aware、fog-bounded coverage 和最终发布验证均等待 T029 后重新定义。

## 下一步

1. 执行 T046，完成 NTE 生命周期、资源回收、连续调度、倾斜覆盖和性能全量修复。
2. 重跑 T042，完成 NTE 双后端完整人工体验验收。
3. 执行 T044，完成删除后回归与发布验证。

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

D031 已确认 T021/T023/T025 的人工体验失败覆盖自动证据，冻结 T026/T027 的 V2 补丁链，并以 T028 作为瓦片子系统重置与 AI 上下文隔离入口。

D032 已确认 `TileStreamingEngine` 路线；D033 已确认 `NovaTileEngine` 当前契约、模块、预算、验收和 T030～T044 原任务链；T045 已完成针对 T042 首屏覆盖阻断的 LOD 修复。

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
- T017 已修复原单层级硬截断问题，T020 已消除 Ready Tile 立即释放和 warm ancestor 重复请求；T021 已在旧路径补齐 Display Coverage 空间 replacement 不变量并通过自动/浏览器回归，但人工负责人明确不接受 pan/zoom 加载观感。T023 已将这些不变量迁移到唯一 TileEngineV2 生产路径，T024/T025 又完成了局部补丁，但人工负责人仍不接受最终体验。
- T021/T023/T025 人工验收已明确不通过：加载延迟、运动期间缺少预加载感、停止后请求波次、中心向外逐块出现、白闪、低帧率和 pan 卡顿仍存在。D031 已冻结 T026/T027 补丁链，后续必须执行 T029。
- 当前 horizon fade 最大强度不会完全融合到背景，且不减少 Coverage 或请求；D029 已批准 fog-bounded coverage，但 T022 完成前高倾角 Tile 数量和远景渐隐仍不代表目标效果。
