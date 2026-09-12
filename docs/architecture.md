# Nova Architecture Baseline

更新日期：2026-09-12

状态：T002 已确认架构基线；D031 已冻结 TileEngineV2 补丁链；D032 已确认 `TileStreamingEngine` 全新重建路线。低 token 架构入口见 `docs/architecture/index.md`。本文定义架构与实施边界，不代表未列入已完成 Task 的地图功能已经实现。

## 证据边界

- 已验证输入：KYE 主瓦片为标准 Web Mercator XYZ、gzip HTTP 响应中的 MVT v2、extent 4096；部分专用空瓦片返回 HTTP 204。
- 代码现状：`@nova/map3d` 已实现渲染后端骨架、核心空间契约、KYE MVT Fetch/Decode、Worker Polygon/Line batch pipeline、Polygon/Line GPU resource/material registry/WebGPU-WebGL2 纵向链路、ViewState 驱动的 Camera/交互/Coverage、TileEngineV2 动态多 Tile Runtime/Cache、world-wrap render instance、渐进式 Tile 替换、交互阻尼和 TSL 远景渐隐；T011-T015 已获人工体验接受。D026/T016 已完成同 Tile 重复 Line 样式 pass 的 geometry/topology 共享及双后端回归，T010 已完成当前 Windows 目标工作站的 MVP 浏览器与性能基线，发布判断为 `PASS_WITH_NON_BLOCKING_LONG_TASK_RISK`。T021 的旧 Runtime 空间 replacement 代码和浏览器脚本通过，但人工 pan/zoom 加载观感未通过；T023 已切换 `Map3D` 到唯一的 TileEngineV2 生产 authority，但人工验收失败；T024/T025 已补齐 V2 rAF Render transaction 和运动调度补丁，但人工负责人仍报告加载滞后、停止后请求波次、中心向外逐块加载、白闪、低帧率和 pan 卡顿。D031 已冻结 T026/T027 补丁链；T028 已完成重置输出；T029 将实施 `TileStreamingEngine`。
- 架构决策：本文件中的坐标、Tile、Worker、Batch、公共 API 和性能目标属于 T002 设计结论，不写入 `KNOWLEDGE.md`，直到实现和真实环境验证形成证据。
- 未验证项继续保持未验证：服务节点正式负载均衡规则、完整字段 schema、跨地域建筑数据、Raster DPR 语义、Glyph/Sprite 许可与目标设备性能。

## MVP 定义

Nova MVP 的目标是证明并交付一个最小但完整的动态矢量地图运行时：

```text
真实 KYE 主 MVT
  → 浏览器 Fetch 自动处理 HTTP gzip
  → MVT v2 / extent 4096 解码
  → Worker 中构建 Polygon / Line 批次
  → 主线程创建 Tile 级 GPU 资源
  → WebGPU 渲染，WebGL2 fallback
  → 相机驱动动态多 Tile 请求、缓存、淘汰和销毁
```

MVP 必须包含：

- 标准 XYZ TileKey、Web Mercator 坐标、经纬度公共 ViewState。
- 平面地图 Camera：平移、连续 Zoom、Bearing、Pitch 和 resize。
- Polygon 与 Line 两种几何；常量颜色、透明度、线宽、zoom 范围和最小属性过滤。
- 可见 Tile 计算、请求优先级、取消、204 空瓦片、失败分类、重试、缓存和 LRU 淘汰。
- Worker 解码与批次构建，Transferable `ArrayBuffer`，主线程只负责调度和 GPU 上传。
- Tile 级批处理、Feature 映射、GPU 资源所有权和确定性 dispose。
- WebGPU 与强制 WebGL2 两条路径、运行统计、错误事件和真实浏览器验收。
- 官方 Playground 的原创浅色底图骨架，以及无非预期 Tile 网格/接缝的视觉验收。
- Target/Display Coverage 分离、父子 Tile fallback、延迟释放和短淡入，避免已显示地图在 zoom/pan 时暴露加载空白。
- pan、bearing、pitch 的有界惯性和逐帧 wheel zoom 更新。
- 倾斜视角中 Polygon/Line 通过统一 TSL 路径平滑融入远景背景。

MVP 不包含：

- 完整 Mapbox Style v8 兼容、Glyph/Sprite、文字布局、中文名称和碰撞检测。
- 3D 建筑挤出、`min_height`、Terrain、Globe、阴影和后处理。
- Picking、业务事件、Marker、Overlay、Cluster、编辑、测量和业务 MVT/Geobuf。
- Raster、高德/百度/腾讯底图、离线包、服务端代理和持久化缓存。
- 跨 Tile 合批、跨层材质优化、自动设备丢失恢复和生产级监控。

文字名称从原 MVP 移出。原因是 Glyph 解码、字体 shaping、atlas、碰撞和多语言 fallback 是一条独立复杂链路，不是验证 Tile Runtime 的必要条件。它应在 MVP 动态矢量运行时通过后作为下一阶段能力立项。

## 模块边界

```text
Application / Playground
  → Public Map3D API
    → Map Runtime
      ├── Camera / Projection
      ├── Tile Coverage / Scheduler / Cache
      ├── Source / Fetch
      ├── Decode Worker Pool
      ├── Geometry Batch Builder
      ├── Render Adapter
      ├── Resource Registry
      └── Diagnostics / Events
            ↓
      Three.js WebGPURenderer
            ↓
       WebGPU / WebGL2
```

职责约束：

- SDK 不依赖 Playground、Inspector、页面状态或业务 Demo 状态。
- Source/Fetch 不创建 Three.js 对象；Render 不发起网络请求。
- Worker 不访问 Canvas、Renderer、Scene 或 DOM。
- Geometry Builder 输出 TypedArray 批次，不拥有 Tile 调度和 GPU 资源。
- Tile Runtime 只通过接口调用 Source、Worker Pool、Render Adapter 和 Cache，不形成万能 Manager。
- Feature 不创建独立 `Object3D`；Tile 可以拥有一个容器，容器下按渲染批次创建有限数量对象。

## TileStreamingEngine 重建边界

D030 曾确认旧 Tile Runtime 的调度与 Display Coverage 生产路径不再继续叠加补丁，并由 T023 建立 `TileEngineV2` 作为生产 authority。T024/T025 又补齐 rAF transaction 与运动调度，但人工体验仍失败。D031 已确认 T026/T027 补丁链冻结；D032 已确认后续进入 `TileStreamingEngine` 全新重建路线。

后续瓦片路线的当前入口见 `docs/architecture/tile-system.md`。默认保留边界仍是 `CanonicalTileKey`/`RenderTileKey`、KYE Source、Worker protocol v1、Polygon/Line batch、MapOrigin、Layer recipe、Three.js GPU upload、WebGPU/WebGL2、Material Registry、Map3D 0.1 公共 API 和资源 ownership。旧 Runtime、旧 Display Coverage、旧 `TileMotionScheduler` 和 `TileEngineV2` 补丁链只能为删除、断开生产路径或 import guard 读取或处理。

## 坐标与相机

### 公共坐标

- 公共位置统一为 WGS84 经纬度 `{ lng, lat }`，角度单位为 degree。
- 纬度在投影入口限制到 Web Mercator 有效范围 `±85.0511287798°`。
- 公共 `ViewState` 为 `{ center, zoom, bearing, pitch }`。
- `bearing` 从正北开始顺时针，归一化到 `[0, 360)`；`pitch` 为从垂直俯视向地平线倾斜的角度，MVP 限制到 `[0, 60]`。
- `zoom` 连续变化；Tile 数据层级使用 `clamp(floor(zoom), source.minZoom, source.maxZoom)`，超过 source maxZoom 时只做 overzoom，不请求不存在的更高层级。

### 内部坐标

- CPU 投影计算使用 Float64 Web Mercator meters：X 向东、Y 向北。
- Three.js Scene 使用 Y-up：`scene.x = east`、`scene.y = heightMeters`、`scene.z = south`。
- 地图平面为 `scene.y = 0`；MVP 不定义椭球曲面、海拔基准或 Terrain。
- MVT 顶点先从 extent 坐标转换为 Tile 局部 Web Mercator meters，再写入 Float32 TypedArray；不把全球绝对米坐标写入 GPU 顶点。

### 浮动原点

- `MapOrigin` 使用当前中心所在数据 Tile 的中心点（Web Mercator meters）。
- 当中心进入新的数据 Tile 或数据 zoom 改变时，Runtime 更新 `MapOrigin`，只调整 Tile 容器的相对位置，不重建 Tile 局部顶点。
- Camera、Tile anchor 和可见范围计算保留 Float64；提交到 Three.js 的对象位置和顶点使用相对原点的 Float32。
- T003 必须以高 zoom 经纬度往返和相邻 Tile 接缝测试验证精度；若需调整重定位阈值，只能改变内部策略，不能改变公共坐标语义。

### Camera 约定

- 使用 PerspectiveCamera，垂直 FOV 初始为 45°；相机距离由 zoom、viewport height 和 Web Mercator scale 推导。
- 当前实现以 256 CSS pixel 的 XYZ Tile 作为 zoom scale 基准；near/far 随相机距离缩放，避免高 zoom 时裁掉视图中心并保持有限投影矩阵。
- Zoom、bearing、pitch 围绕 `ViewState.center` 计算，不允许直接从公共 API 修改 Three.js Camera。
- Pitch 视锥与地面 `y=0` 的交点用于可见范围；无法与地面相交的射线按最大可视距离截断，防止请求无限 Tile。
- Camera 控制只产生 ViewState；Tile Coverage 订阅 ViewState，不直接读取业务页面状态。

### 交互运动

- Pointer 主动拖拽保持直接跟手；pointer 正常释放后才根据最近样本进入惯性。
- 惯性使用 requestAnimationFrame 与实际 delta time 积分，pan 速度采用 Web Mercator meters/second，bearing/pitch 采用 degrees/second。
- 新输入、外部 setView、边界命中、页面失活和 dispose 必须取消旧运动；reduced-motion 禁用释放惯性。
- Wheel burst 合并为逐帧连续 zoom。MVP 不实现 zoom-to-cursor、pinch、多指旋转或公开 flyTo/easeTo。
- 阻尼参数属于实现和人工调校值，不改变公共 ViewState 语义。

## Tile 数据结构

```ts
interface CanonicalTileKey {
  sourceId: string;
  z: number;
  x: number;
  y: number;
}

interface RenderTileKey {
  canonical: CanonicalTileKey;
  wrap: number;
}
```

- `CanonicalTileKey` 用于网络、解码和缓存；X 归一化到 `[0, 2^z - 1]`，Y 越界直接忽略。
- `RenderTileKey` 额外记录横向 world wrap，用于同一 canonical 数据在多个世界副本中的放置。
- 缓存和并发去重只使用 canonical key；不同 wrap 可以共享 CPU/GPU 数据，但拥有独立的 Tile 实例变换。
- key 的稳定字符串形式为 `sourceId/z/x/y`；wrap 只出现在渲染实例 key 中。

### Tile 状态机

可见性、缓存保留和生命周期状态相互独立，不把 `visible` 或 `retained` 混入状态机。

```text
queued → fetching → decoding → building → ready
             ↘ empty
             ↘ failed

queued/fetching/decoding/building/ready/empty/failed → disposed
```

- `empty`：只用于已确认的正常空响应，例如 HTTP 204；不进入解析。
- `failed`：保存结构化错误、尝试次数和下次允许重试时间。
- `disposed`：终态；任何异步完成结果必须通过 generation token 检查后丢弃。
- 取消中的 fetch 使用 `AbortController`；Worker job 使用 `cancel(jobId)`，已无法中止的计算结果由 generation token 拒绝挂载。
- TileRecord 至少保存 key、state、priority、generation、timestamps、AbortController/jobId、CPU/GPU byte estimate、batch handles 和 error。

### 可见集与优先级

- T017 已将 T007 的单层级枚举与数量硬截断替换为 mixed-LOD selector：从能够覆盖 Camera Frustum 的 source `minZoom` Tile 开始，按 Tile AABB 相交和 projected tile size 做 best-first 四叉树 refinement；Target Coverage 可以同时包含多个 canonical zoom。
- 数量预算通过停止 refinement 或将 children 合并回 parent 满足。D029 fogEnd/loadCutoff 定义的有效地面区域必须由 selected Tile 或其 selected ancestor 完整覆盖，禁止任意截断该区域内 visible Tile。
- 近景优先细分到高 zoom，远景保留低 zoom；Layer `minZoom/maxZoom` 按 selected Tile 的 canonical zoom 生效，远景可自然隐藏建筑等高精细内容。
- selected Target Coverage 在空间上保持非重叠；当前默认 refine/coarsen 阈值为 320/224 CSS px，相邻 LOD 最大 zoom 差为 1，并使用上一帧 Target Coverage 提供细分/合并迟滞。
- MapOrigin、ground footprint 和 horizon fade 使用独立 `referenceZoom`；mixed canonical zoom 只决定 Tile 数据与 Layer zoom 语义，不改变 Camera frame、far plane 或公共 ViewState。
- 旧 Runtime 曾按 coverage-critical > visible refinement > motion-direction prefetch > ordinary prefetch 实现 T018 的 240 ms motion 预测窗口、最多 24 个 leading-edge prefetch、180 ms refinement debounce 和 240/600 ms 取消迟滞；自动证据通过但人工加载观感未通过。T023 已将这些要求重新落入独立 V2，旧实现不能继续视为生产质量。
- Zoom/pan 使用独立 Display Coverage：exact 未 ready 时保留/请求最近 ancestor，或使用可覆盖的 ready descendants/outgoing Tile；exact 完成 GPU upload 后先进入 pending transaction，在帧边界形成空间完整 Render Cover 后短淡入，fallback 在过渡完成后释放。
- D028 要求 Ideal Target Coverage、Render Cover 和 Retained Cache 独立。T020 已完成 terminal record 的预算内离屏保留、cache hit 和 warm ancestor request suppression；T021 已完成旧路径的空间 replacement cohort、same-zoom/cache hit 直接显示与稳定 Render instance/material 生命周期代码，但人工 pan/zoom 加载观感未通过。T023/T024/T025 的 V2 证据作为失败路线保留；D032 要求 T029 在 `TileStreamingEngine` 中按通用不变量重新建立垂直切片。
- source maxZoom 以上复用 maxZoom canonical Tile；MVP 只实现保持连续覆盖所需的最近父子 fallback，不实现多层级长期共存或几何 morph。

### 请求与失败策略

- URL 模板列表按 canonical key 稳定 hash 选择起始节点，网络错误或 HTTP 5xx 重试时轮换到下一个节点。
- 默认最多 3 次尝试，退避为短延时指数 backoff 并带 jitter；HTTP 4xx 和解码/协议错误不自动跨节点重试。
- HTTP 204 进入 `empty`；404 保持非重试 `failed`，不能在缺乏证据时当作空 Tile。
- 浏览器 Fetch 按 HTTP `Content-Encoding` 自动处理 gzip；Worker 协议接收解压后的 MVT protobuf bytes，不在主链重复 gunzip。
- 同一 canonical key 只允许一个在途请求；无当前或预测 consumer 时先进入有界取消迟滞，快速返回可复用同一 generation。普通在途工作最多保留 240 ms；已有明显下载或构建进度时最多保留 600 ms；dispose 与 generation 失效仍确定取消/拒绝挂载。

### 缓存与预算

- Runtime 使用按最近访问排序的 LRU：visible 和 Display Cover 永远 pinned，离开 Target/Display 的 Ready、empty、failed terminal record 进入 Retained Cache；cache hit 与 Display 使用刷新 access time，预算压力淘汰最旧非 pinned candidate，并抑制当前 Coverage 内已淘汰 prefetch/warm ancestor 的立即重建。
- 初始工程预算：CPU 128 MiB、GPU 256 MiB、canonical Tile 记录 256 个。它们是待 T010 验证的可配置默认值，不是已测事实。
- visible 集本身超过预算时不强制销毁可见资源；Runtime 关闭 prefetch、触发 `memory-pressure` 统计并记录超限。
- `empty` 在当前 source 版本和当前 Map3D 实例生命周期内可缓存；失败项在 cooldown 后才允许重新排队。
- Cache 必须使用实际 TypedArray byteLength 加结构估算；禁止只按 Tile 个数声称满足内存预算。
- 当前 T008 Runtime 由 Source/Worker/Render adapter 隔离具体实现，保持内部模块；T009 负责将 render wrap 实例、Three.js GPU resource 和批准的 Map3D stats/events 接入，不扩大根入口公共类型。

### Target 与 Display Coverage

- Target Coverage 由最新 ViewState 产生，负责请求与最终目标；Display Coverage 描述当前帧实际挂载的 exact、fallback 和 outgoing Tile。
- Tile lifecycle state 与 display role 正交，不能增加 `fading` 等数据状态。
- 同一目标区域按 exact ready → 最近 ready ancestor → 可覆盖 ready descendant/outgoing 的顺序选择显示资源；缓存没有 fallback 时可低优先级请求父 Tile。
- GPU upload 完成前 Tile 不进入 Display Coverage；upload 完成后先以空 render key 保留到 pending transaction，replacement children 必须形成覆盖同一 parent 空间的 ready cohort 后同帧提交，禁止部分到达便提前释放 parent。
- Display pin 保证 fallback 在空间等价的替代覆盖成立和过渡结束前不被 LRU 释放；正常显示 cohort 限制为 exact 与一个 fallback/outgoing 层级。
- same-zoom pan 和 retained cache hit 直接完整显示；短过渡只用于明确的 LOD replacement，且不能因无关 Target signature 变化重启。
- 快速连续 zoom 只提交最新 Target Coverage；过时结果只能缓存。失败 exact 保留 fallback 并报告错误，不留下矩形空洞。
- 过渡资源计入 byte budget；短时压力先禁用 prefetch 并报告，不能销毁仍参与显示的 Tile。

详细时序、reduced-motion 和验收场景见 `docs/experience-baseline.md`。

## Source、Style 与解码

### Vector Source

MVP 只支持 `scheme: 'xyz'` 的 MVT source：source id、URL templates、minZoom、maxZoom 和可选 bounds。KYE 主 MVT 由 Playground 作为显式配置传入，SDK 不隐式注入生产 URL 或鉴权信息。

### 最小 Layer Style

MVP 不实现完整 Style v8。公共 Layer 配置只包含：

- `fill`：sourceLayer、color、opacity、minZoom、maxZoom、filters。
- `line`：sourceLayer、color、opacity、width、minZoom、maxZoom、filters。
- Layer 数组顺序即渲染顺序。
- filter 只支持 `==`、`!=`、`in`、`!in`、`has` 五种属性操作，属性值限制为 string/number/boolean/null。
- 不支持 expression、data-driven paint、sprite、text、symbol、fill-extrusion 或运行时 style 切换。

完整 KYE Style 的 51 层和表达式统计仍是后续 Style Compiler 的事实输入，不能让 MVP 的最小 Layer 配置伪装成 Style v8 兼容层。

官方 Playground 的 MVP 图层必须遵循 `docs/visual-style-baseline.md`：浅中性背景、柔和水体、低对比建筑、道路层级，以及只对真实植被分类使用绿色。该约束不改变 SDK 的通用 Layer API。

### Decoder 输出

MVT Decoder 输出与 Three.js 无关的结构：source layer、feature index、geometry type、properties 和 ring/path command 结果。字段保持原始 string/number/boolean，不擅自把行政区字符串字段转换为 number。

实现依赖：

- `pbf` 5.1.2：protobuf 读取。
- `@mapbox/vector-tile` 3.0.0：MVT v2 解码。
- `earcut` 3.2.3：Polygon ring/hole 三角化。

替代方案是自研 protobuf/MVT/三角化或从 Three.js 内部路径导入 Earcut。自研会扩大 MVP 风险；内部路径不具备稳定公共契约。T004 已验证前两个依赖的 BSD-3-Clause、内置 TypeScript 类型、ESM 和独立 decoder bundle；T005 已验证 `earcut` 3.2.3 为 ISC、ESM、内置 TypeScript 类型，并可进入不含 Three.js 的独立 Worker bundle。

## Worker 协议

- Fetch、可见性、请求优先级和 Cache 留在主线程；MVT 解码、属性过滤、投影、Polygon 三角化和 Line mesh 构建在 Worker。
- Worker 数量默认 `clamp(hardwareConcurrency - 1, 1, 4)`；测试环境允许注入 1 个 Worker 保证确定性。
- 主线程把 MVT `ArrayBuffer` 转移给 Worker，所有输出 TypedArray buffer 再转移回主线程；转移后原所有者不得继续访问。
- 协议显式携带 `protocolVersion: 1`、jobId、canonical key、layer recipes 和取消消息。

```ts
interface TileBuildPayloadV1 {
  protocolVersion: 1;
  key: CanonicalTileKey;
  batches: readonly TileBatchPayload[];
  features: FeatureIndexTable;
  stats: TileBuildStats;
}
```

- Worker error 必须序列化为 code、message、phase 和可选 details，不能依赖跨线程传递原始 Error 原型。
- 主线程收到版本不匹配、stale generation 或 disposed Tile 的结果时立即释放引用并拒绝创建 GPU 资源。

## Geometry、Batch 与 Feature 映射

- Batch key 为 `Tile × public layer × geometry type × material key × render pass`。
- 每个 Batch 生成一个渲染对象和一组 BufferGeometry；禁止每 Feature 一个 Object3D/Material/Geometry。
- 顶点位置使用 Tile 局部 Float32；索引优先 Uint32；颜色和样式优先共享 Material uniform，避免逐顶点复制常量。
- Polygon 必须识别 MVT ring winding，正确区分 outer ring 与 holes；跨 Tile 边界不做二次全局裁剪。
- Line 在 Worker 生成三角带拓扑和 prev/next/side 属性，由 TSL/Node Material 在渲染阶段按屏幕空间展开宽度；连接和端帽 MVP 只保证 bevel/butt，复杂 dash、pattern 和 round join 后置。
- D026 允许同一 Tile 内 sourceLayer、filters、zoom 可见性和 line topology 规则相同的 Line 样式 pass 共享 Worker topology 与 GPU BufferGeometry；实现通过 `geometryKey` 区分 topology 资源，并按 ArrayBuffer/BufferGeometry identity 去重资源统计和 transferable。每个 public line layer 仍保留独立 material、width、opacity、renderOrder 和 draw pass。该规则服务于道路 casing/fill 等重复样式 pass，不改变公共 Layer API。
- 每个 batch 保留 `featureIds: Uint32Array` 或等价范围映射，以及 tile-local feature table。MVP 不开放 Picking，但后续 Picking 不需要重建数据模型。
- 跨 Tile 合批禁止进入 MVP；其收益和重建成本必须由性能证据驱动。

## GPU 资源所有权

- `Map3D` 实例拥有 Renderer、Scene、Worker Pool、Tile Cache、Material Registry 和 Diagnostics。
- Tile GPU record 独占 Tile container、BufferGeometry、BufferAttribute 和 feature mapping；eviction 时先从 Scene detach，再 dispose geometry，最后清除 CPU 引用。
- Material 由 `MaterialRegistry` 按 material key 共享并引用计数；Tile 只持引用，不直接销毁共享 Material。
- MVP 没有 Glyph/Sprite/Texture cache；后续共享纹理必须进入独立 registry，不能挂到单 Tile 生命周期。
- `dispose()` 幂等且为终态：停止 render loop、取消 fetch/job、移除 Tile、释放 Geometry/Material、终止 Worker、最后 dispose Renderer。
- WebGPU device loss 或 WebGL context loss 在 MVP 中视为 fatal：停止渲染并发送 `renderer-lost` error；应用销毁并新建实例。自动恢复另立 Task。

### 远景渐隐

- Polygon/Line Material、Coverage footprint 和 mixed-LOD selector 共享按帧更新的 visibility range，根据 pitch、Camera frame 和 viewport 推导 fogStart、fogEnd、loadCutoff 与 guard band。
- pitch 0 时 fade strength 为 0 且 Coverage 不变；pitch 增大时近景保持样式颜色，fogStart 后降低 refinement，fogEnd 完整融合到 renderer background/haze color。
- Tile transition opacity 与 horizon fade 在同一 TSL/Node Material 路径组合；WebGPU/WebGL2 不维护分叉 Shader。
- fogEnd 之前的 Coverage 不得依赖渐隐掩盖空洞或 seam；Tile 包围体完全超过 loadCutoff 后可停止选择、请求、构建和渲染。该边界不通过简单修改 Camera far plane 实现。
- MVP 不引入 post-processing、天空、大气散射、Terrain 或公开 atmosphere API。

## 公共 API 基线

以下是 `@nova/map3d` 0.1 MVP 的最小稳定面：

```ts
export type RenderBackend = 'webgpu' | 'webgl2' | 'unknown';
export type LayerPropertyValue = string | number | boolean | null;

export interface LngLat {
  lng: number;
  lat: number;
}

export interface ViewState {
  center: LngLat;
  zoom: number;
  bearing: number;
  pitch: number;
}

export interface ViewportSize {
  width: number;
  height: number;
  pixelRatio?: number;
}

export interface CanonicalTileKey {
  sourceId: string;
  z: number;
  x: number;
  y: number;
}

export interface VectorTileSourceOptions {
  id: string;
  tiles: readonly string[];
  minZoom: number;
  maxZoom: number;
  bounds?: readonly [west: number, south: number, east: number, north: number];
}

export type LayerFilter =
  | { operator: 'has'; property: string }
  | {
      operator: '==' | '!=';
      property: string;
      value: LayerPropertyValue;
    }
  | {
      operator: 'in' | '!in';
      property: string;
      values: readonly LayerPropertyValue[];
    };

export interface BaseLayerOptions {
  id: string;
  sourceLayer: string;
  minZoom?: number;
  maxZoom?: number;
  filters?: readonly LayerFilter[];
}

export interface FillLayerOptions extends BaseLayerOptions {
  type: 'fill';
  paint: {
    color: string | number;
    opacity?: number;
  };
}

export interface LineLayerOptions extends BaseLayerOptions {
  type: 'line';
  paint: {
    color: string | number;
    opacity?: number;
    width?: number;
  };
}

export type MapLayerOptions = FillLayerOptions | LineLayerOptions;

export interface MapRuntimeStats {
  backend: RenderBackend;
  frame: {
    lastMs: number;
    p95Ms: number;
  };
  tiles: {
    visible: number;
    queued: number;
    fetching: number;
    decoding: number;
    building: number;
    ready: number;
    empty: number;
    failed: number;
  };
  resources: {
    cpuBytes: number;
    gpuBytes: number;
    batches: number;
    features: number;
    vertices: number;
    indices: number;
    objects: number;
  };
  workers: {
    active: number;
    queued: number;
  };
}

export interface Map3DOptions {
  canvas: HTMLCanvasElement;
  source: VectorTileSourceOptions;
  layers: readonly MapLayerOptions[];
  view?: Partial<ViewState>;
  renderer?: {
    forceWebGL?: boolean;
    antialias?: boolean;
    backgroundColor?: string | number;
    maxPixelRatio?: number;
  };
  cache?: {
    maxCpuBytes?: number;
    maxGpuBytes?: number;
    maxTileEntries?: number;
  };
}

export interface MapEventMap {
  load: { backend: RenderBackend };
  viewchange: { view: ViewState };
  idle: { stats: MapRuntimeStats };
  error: MapError;
  stats: MapRuntimeStats;
}

export class Map3D {
  constructor(options: Map3DOptions);
  initialize(): Promise<void>;
  resize(size: ViewportSize): void;
  getView(): ViewState;
  setView(view: Partial<ViewState>): void;
  start(): void;
  stop(): void;
  getBackend(): RenderBackend;
  getStats(): MapRuntimeStats;
  getRenderer(): WebGPURenderer;
  on<K extends keyof MapEventMap>(
    type: K,
    listener: (event: MapEventMap[K]) => void,
  ): () => void;
  dispose(): void;
}
```

API 约束：

- `initialize()` 可重复调用但只执行一次初始化；fatal 初始化错误通过 rejected Promise 返回。
- `dispose()` 后实例不可重新 initialize；其他方法返回或抛出 `MAP_DISPOSED`。
- `setView()` 同步更新归一化 ViewState，渲染和 Tile 加载异步发生。
- `getRenderer()` 只作为 Three.js Inspector/高级集成 escape hatch；所有权仍属于 Map3D，调用方不得替换或 dispose。
- 当前公开的 `scene` 和 `camera` 字段不是 0.1 稳定 API，批准 D019 后应收回内部；应用通过 ViewState 控制地图。
- MVP 不提供 `addLayer/removeLayer/setStyle/queryRenderedFeatures/flyTo`，避免在实现证据不足前冻结完整地图 API。

## 错误与事件

```ts
export type MapErrorCode =
  | 'INVALID_ARGUMENT'
  | 'INITIALIZE_FAILED'
  | 'MAP_DISPOSED'
  | 'SOURCE_ERROR'
  | 'NETWORK_ERROR'
  | 'HTTP_ERROR'
  | 'DECODE_ERROR'
  | 'GEOMETRY_ERROR'
  | 'WORKER_ERROR'
  | 'RENDERER_LOST'
  | 'RESOURCE_LIMIT';

export interface MapError {
  code: MapErrorCode;
  message: string;
  phase: 'initialize' | 'request' | 'decode' | 'build' | 'upload' | 'render' | 'dispose';
  recoverable: boolean;
  tileKey?: CanonicalTileKey;
  cause?: unknown;
}
```

- 参数错误和 fatal initialize 错误直接抛出/reject；后台 Tile 错误通过 typed `error` event 报告。
- 用户主动取消不发送 error；重试耗尽才报告 Tile error。
- 事件最小集合：`load`、`viewchange`、`idle`、`error`、`stats`。
- `idle` 表示当前可见 Tile 没有 queued/fetching/decoding/building 工作，不代表网络或全局 Cache 永久静止。

## 验证与性能

自动测试、真实浏览器矩阵、场景、指标定义和初始性能门槛见 `docs/verification-baseline.md`；Tile 连续性、阻尼和远景渐隐见 `docs/experience-baseline.md`。性能数字是验收目标而不是已验证事实；只有真实设备结果才能写入 `KNOWLEDGE.md`。

## 实施依赖顺序

```text
T003 Core types / projection / TileKey
  ├── T004 KYE fetch and MVT decode
  │     └── T005 Worker polygon batch pipeline
  │            └── T006 Fixed-tile KYE polygon vertical slice
  └── T007 Camera and visible tile coverage

T004 + T007
  └── T008 Tile scheduler, cache and lifecycle

T005 + T006 + T008
  └── T009 Line batches and dynamic MVP integration
          └── T011 Regular grid watermark artifact diagnosis/fix
                ├── T012 Light basemap style
                │     └── T015 Pitched horizon fade
                └── T013 Progressive tile replacement
                      ├── T014 Inertial interaction
                      └── T015 Pitched horizon fade

T012 + T013 + T014 + T015
  └── T010 Browser compatibility and performance baseline
        └── T016 Line geometry reuse for repeated style passes
              └── T010 rerun / release decision

T007 + T008 + T013 + T015 + T016
  └── T017 Mixed-LOD frustum tile selection
        ├── T020 Retained tile cache and request thrash
        │     └── T021 Spatial best-available replacement (old path; human acceptance failed)
        └── T023 TileEngineV2 migration (human acceptance failed; blocked by D031)
              └── T028 Tile subsystem reset and AI context isolation
                    └── T029 TileStreamingEngine vertical slice
                          └── T022 Fog-bounded pitched coverage
                                └── T019 Pitched tile loading and LOD verification

T018/T021/T023/T026/T027 remain BLOCKED for the failed V2/old Runtime route; T024/T025 remain DONE as evidence only; T029 is the next implementation entry.
```

所有 实施任务 必须保持公共契约和本文件边界；需要改变 MVP 范围、坐标语义、Tile 状态、Worker 协议或公共 API 时，返回决策会话确认。
