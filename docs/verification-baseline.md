# Kmap MVP Verification Baseline

更新日期：2026-09-09

状态：T002 已确认基线，并由 D022 增补浅色视觉验收。本文定义如何取得证据，不宣称当前地图功能或性能已经达到目标。

## 验证原则

- 自动测试优先使用固定 fixture，不把外部 KYE 网络可用性作为普通 CI 成功条件。
- 真实 KYE 网络、WebGPU/WebGL2、浏览器交互和性能必须在真实浏览器人工验证。
- 网络耗时、Worker 解码/构建、主线程上传和渲染帧时间分开记录，不能用单一“加载快”结论替代证据。
- 每项性能结果记录日期、浏览器、OS、CPU、GPU、内存、DPR、viewport、renderer backend、场景、采样时长和构建 commit。
- 未达到目标时保留真实结果和瓶颈，不降低测试或删除场景绕过失败。

## 自动测试矩阵

### Unit

- 经纬度与 Web Mercator meters 往返；覆盖赤道、北京、有效纬度边界和跨日期线。
- TileKey：XYZ 转换、X wrap、Y 越界、稳定 key、source maxZoom overzoom。
- ViewState：zoom/bearing/pitch clamp、resize、浮动原点重定位和相邻 Tile 接缝。
- Tile 状态机：合法转换、非法转换、取消、stale generation、204 empty、retry cooldown 和 dispose 幂等。
- Scheduler/Cache：请求去重、优先级、visible pin、LRU 顺序、CPU/GPU byte budget 和内存压力行为。
- Layer filter：`==`、`!=`、`in`、`!in`、`has` 与缺失字段。
- Error：fatal/recoverable 分类、Worker error 序列化和 event unsubscribe。
- Target/Display Coverage：exact/ancestor/descendant fallback、display pin、过时 target、过渡完成和 degraded coverage。
- Interaction motion：velocity sampling、delta-time damping、30/60/120 Hz 一致性、边界/新输入/dispose 取消和 reduced-motion。
- Horizon fade：pitch 0 恒等、参数有限/单调、zoom/viewport 相对尺度和 Tile transition 组合。

### Fixture Integration

- 从真实 KYE 样本生成固定 MVT fixture，记录原 URL、请求日期、压缩/解压 SHA-256、字节数和 source-layer 摘要。
- fixture 测试不依赖网络；至少覆盖 Polygon、Line、多个 ring/hole 候选、数值和字符串属性。
- 解码结果断言 MVT version 2、extent 4096、选定 source-layer feature count 和关键字段类型。
- Polygon batch 断言 index 不越界、三角形非退化、hole 不被填充、feature mapping 可追溯。
- Line batch 断言 width、join/cap 默认值、连续 path 和 feature mapping。
- Worker round-trip 断言输入与输出 buffer 已 transferable，协议版本错误可识别，取消后不挂载结果。

### Package Integration

- `@kmap/playground` 只能通过 workspace package 导入 `@kmap/map3d`。
- SDK build 不打包第二份 Three.js；SDK 不引用 Playground、Inspector 或 DOM 调试面板。
- Type declaration 覆盖批准的公共 API，未批准的内部类型不从根入口导出。
- `pnpm check` 必须通过：strict typecheck、Vitest、SDK/Playground production build。

## 真实浏览器矩阵

MVP 发布前至少完成：

| 环境 | Renderer | 必测项 |
| --- | --- | --- |
| Windows 目标工作站 + 当前稳定 Chromium | WebGPU | 初始化、交互、动态 Tile、内存、性能、设备信息记录 |
| 同一工作站 + `forceWebGL` | WebGL2 | 与 WebGPU 功能一致、无独立场景实现、性能记录 |
| 一台无可用 WebGPU 的受支持环境 | 自动 fallback | 自动进入 WebGL2、错误信息和后端统计正确 |

Firefox、Safari、移动端和非 Chromium 浏览器不作为 MVP 发布阻断项；进入支持矩阵前必须另立兼容性 Task。

## 场景基线

使用真实 KYE 主 MVT 和明确固定的 ViewState：

1. 全国低 zoom：验证 world wrap、低层级 Polygon/Line 和 Tile 上限。
2. 北京城市 zoom：验证多 Tile 道路、水面、土地和连续平移。
3. 北京高 zoom：使用 research 中已有 `z15/26978/12416` 及相邻瓦片，验证高 feature 密度、ring、缓存和回收。
4. 交互循环：连续 60 秒 pan/zoom/bearing/pitch，再返回起始 ViewState，等待 idle。
5. 生命周期循环：同一页面创建、initialize、交互、dispose 三次。
6. 网络异常：单节点失败、全部节点失败、HTTP 204、HTTP 4xx/5xx、请求取消和离线恢复。
7. 视觉回归：浅色底图在低、中、高 zoom 及 bearing/pitch 下的双后端截图，并对 Tile bounds 检查非预期网格。
8. 连续加载：固定延迟下执行 14.75↔15.25、14→16→15 和超出 prefetch 的 pan，采集连续帧/录屏。
9. 阻尼：快速与慢速 pan/bearing/pitch 释放、wheel burst、新输入取消、边界停止和 reduced-motion。
10. 远景：pitch 0/20/40/60 的 effect on/off 对照，确认近景清晰、远景连续融合且 Coverage 不减少。

具体经纬度、viewport 和脚本轨迹由 T010 固化到 Playground 验证说明；使用新硬编码样本时必须记录来源。

## 功能验收

- 真实 KYE Polygon 和 Line 在 WebGPU、WebGL2 两条路径显示，Tile 接缝无明显裂缝或重复填充。
- 平移、连续 zoom、bearing、pitch 不产生持续空白、无限请求或越界 Tile。
- HTTP 204 不记录为 decode error；取消不产生用户 error；重试耗尽产生结构化 error。
- 同一 canonical Tile 不重复 fetch/decode；world wrap 共享 canonical 数据。
- Feature 不创建独立 Object3D；批次和 render order 与 Layer 配置一致。
- dispose 后没有在途请求、Worker、animation loop 或可达 Tile GPU 资源。
- 默认 Playground 符合 `docs/visual-style-baseline.md`，绿色只表达植被，不存在贯穿视图或与 XYZ Tile 边界对齐的非预期网格。
- WebGPU 与强制 WebGL2 的色板、图层顺序和 Tile seam 表现肉眼一致。
- 首次可用显示覆盖建立后，zoom/pan 不出现 Scene background 矩形空洞；新 Tile 完整上传后渐进替换，过时 zoom 不回挂。
- pan 和 bearing/pitch 释放后的惯性单调、有界、可取消，常规手势约 0.2-1.2 秒停止且极端输入不超过 1.5 秒。
- pitch 0 不受远景效果影响；pitch 增大时 Polygon/Line 远景平滑融入背景，无固定截断带或 Tile 级渐变差异。

## 初始性能门槛

以下是 T002 的工程验收目标，尚未测量。T010 首次测量后，若目标与目标设备明显不匹配，必须回到决策会话调整，不能由实施会话静默修改。

### Worker Pipeline

- 固定高 zoom fixture 的 MVT decode + Polygon/Line build：单 Tile P95 不超过 25 ms。
- 任务运行在 Worker；地图交互期间不得由解码/三角化在主线程制造超过 50 ms 的 Long Task。
- Worker round-trip 的复制字节应为 0；输入与主要输出 buffer 使用 transferable。

### Main Thread 与渲染

- 1920×1080、DPR 1、北京城市基线场景：WebGPU steady-state frame time P95 不超过 20 ms。
- 同场景强制 WebGL2：steady-state frame time P95 不超过 25 ms。
- Tile GPU upload 采用每帧预算，单帧主线程 upload/build 工作 P95 不超过 8 ms。
- ViewState 输入到下一帧可见响应 P95 不超过 50 ms。
- Tile transition、交互 inertia 和 horizon fade 启用后仍需满足 frame/upload 门槛；不得以降低效果采样率换取通过。
- 不允许由每 Feature Object3D 导致对象数与 feature 数线性增长；draw call 以 Tile batch 数量解释并记录。

### 内存与生命周期

- CPU/GPU 估算分别遵守 128 MiB / 256 MiB 初始 cache 预算；visible 超限必须产生统计信号。
- 60 秒交互循环返回起点并 idle 后，第二、第三轮的可达 Tile/TypedArray/GPU resource 数不得持续单调增长。
- 三次 create/dispose 循环后，Worker 数、animation loop 和网络请求归零。
- 浏览器内存指标受 GC 和驱动影响时，以资源 registry 计数为硬证据，浏览器内存快照作为辅助证据。

### 网络

- 网络冷启动单独报告 DNS/connect/TTFB/download，不把公网或企业网络波动归因于 renderer。
- MVP 不为 KYE 服务响应时间设固定 SLO；必须记录首次可见 Tile 时间和失败率，为后续服务基线提供事实。
- 缓存命中 Tile 不得再次网络请求；返回已缓存视图后应在下一渲染调度周期恢复显示。

## 结果记录

T010 完成后应把已验证环境和结果摘要写入：

- 当前 Task 的 Findings：命令、场景、数值、截图/日志位置和未解决问题。
- `KNOWLEDGE.md`：只写可复现且已验证的性能/兼容性事实。
- `PROJECT.md`：MVP 是否满足发布门槛以及仍被哪些环境问题阻断。
- `docs/decisions.md`：只有性能证据导致架构或公共 API 改变时才新增/更新决策。
