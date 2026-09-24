# T046 成熟瓦片调度与 WebGPU 高帧率改造

## Goal

使用 MapLibre 平面地图选片、可用父子覆盖与裁剪机制，提供无淡变的快速瓦片加载、局部 LOD、雾剔除、分阶段调度和有界缓存。真实浏览器入口为 `http://127.0.0.1:6661/`，验收后端为 WebGPU，稳定帧率目标为至少 160 fps。

## Task Context Packet

### Must Read

- `AGENTS.md`、`docs/project-state.md`、`TASKS.md` T046 行、本文件。
- `KNOWLEDGE.md`、`docs/evidence/index.md`、`docs/ai-session-log.md`。
- `docs/research/industry-tile-streaming-2026-09-16.md`。
- `docs/ai-sessions/2026-09-16-industry-tile-proposal.md`。
- `packages/map3d/src/streaming/**`、`packages/map3d/src/Map3D.ts`。
- `apps/playground/src/diagnosticsPanel.ts`、当前浏览器验收模块。

### Read If Needed

- `packages/map3d/src/rendering/**`、`src/interaction/**`、`src/types.ts`：相机、输入与契约。
- `packages/map3d/test/**`、`apps/playground/src/*.test.ts`：回归测试。
- `node_modules/**/three/src/**`：WebGPU、TSL、stencil 行为核验。
- `docs/evidence/industry-tile-research-2026-09-15/**`：固定版本公开参考。

### Allowed Files

- `packages/map3d/src/**`、`packages/map3d/test/**` 的瓦片、相机、渲染与诊断模块。
- `apps/playground/**` 的面板、调试、浏览器验收和本地证据存储。
- 本任务文件、`TASKS.md`、`PROJECT.md`、`KNOWLEDGE.md`、`docs/project-state.md`。
- 相关 architecture、decisions、research、knowledge、evidence、ai-sessions 及其索引。
- `scripts/**` 的专项证据分析脚本。

### Forbidden Files

- 归档瓦片实现、无关业务模块、运行时依赖升级和锁文件。

### Required Evidence

- 视锥、局部 LOD、日期线、雾边界、互斥区域覆盖测试。
- 有界准入、网络/Worker/上传、取消、乱序、失败重试、空数据与释放测试。
- 首屏、快速 pan/zoom/rotate/pitch、城市往返、缓存回访的真实 WebGPU 录像、帧时间和覆盖/质量日志。
- `pnpm check`、`pnpm ai:check`、`git diff --check`。

### Stop Conditions

- 浏览器自动化安全校验阻断时停止相应 UI 操作，源码实施与离线验证继续进行。
- 业务范围或运行时依赖选型超出用户批准的瓦片改造范围。

## Scope

- 数据源为当前 KYE XYZ MVT；Three.js / TSL / WebGPU 渲染。
- 视图相关局部 LOD、可见与雾剔除、可用父子补足、区域裁剪和帧边界直接替换。
- 瓦片透明度不随就绪时间变化；面板展示实际来源、数量、队列、内存与覆盖质量。
- 请求、Worker 和 GPU 上传独立调度；当前可见需求与预测需求分别计量。
- 有界条目与字节预算、canonical 请求复用、显示依赖保护和确定性释放。
- 已知城市路径预加载与真实输入验收。

## Non-Goals

- 地形、球面、文字布局、业务图层、发布与依赖升级。

## Acceptance Criteria

- 同一 source 的目标区域具有明确可用来源；就绪内容在帧边界直接接替，父子重复贡献受到裁剪限制。
- 完全入雾且无近期显示用途的瓦片没有独立当前可见需求。
- 理想层级、预算限制与实际来源分别可观测；近处细节通过连续画面对照。
- 当前可见与预测分别服从数量预算，CPU/GPU 与在途数据服从字节预算；dispose 后资源归零。
- WebGPU 运动每个完整 1 秒窗口平均帧率 ≥160 fps，帧间隔 P95/P99 ≤6.25 ms；原始尖峰、丢帧和呈现限制完整报告。此项为用户性能要求。
- 无浏览器刷新率/录制能力证据时，性能验收保持待验证；CPU 耗时不等同实际 FPS。
- 录像连续检查替换白块、粗块、道路变化、闪动与近处质量；逐帧覆盖日志与视觉证据联合验收。
- 冷启动、持续运动、缓存回访、静止收敛分别记录；全部自动门禁通过。

## Status

IN_PROGRESS

## Findings

- 用户于 2026-09-16 批准架构适配、剔除瓦片淡变及其指标、严格数量控制和 160 fps WebGPU 验收。
- 成熟公开机制及固定版本来源见行业资料核验报告。
- Playground 生产构建固定输出 `index.html` 与 `playground.js`；样式、动态模块和瓦片 Worker 均进入主包。真实 WebGPU Preview 收敛为 15/15 瓦片，覆盖缺口、待就绪目标、网络错误和控制台错误均为 0。
- 2026-09-23 真实输入探针（headless Edge + WebGPU、1600×900、DPR 1）确认抖动来源：每个新瓦片首次上屏创建约 30 个 GPUBuffer、7 秒拖拽阶段合计 2148 个；长帧无脚本归因且 blockingDuration 为 0，属 GPU/合成侧停顿；每个瓦片另创建 1 个从不被采样的 1×1 纹理（拖拽阶段 72 个）；指针事件逐事件提交视图并逐事件序列化 DOM 状态；快速平移期标签接近逐帧全量重布局（峰值 8.8ms）；每帧多次全量条目扫描（`pump` 峰值 6.1ms）。
- 已实施并通过 186 项离线回归：指针位移按渲染帧合并提交、相机与射线临时对象复用、滚轮矩形缓存；移除 1×1 纹理创建与上传；阶段索引与增量字节记账；上传并发上限 `prepares=2` 与时间预算；标签快速运动期降频降预算；选择与覆盖规划去除字符串签名与重复覆盖解析；GPU 几何池与就地重写。
- 真实输入实测：拖拽帧间隔 P99 8.4→4.5ms、最大 83.4→20.8ms；滚轮 P99 4.6→4.5ms、最大 58.5→8.2ms；长任务 3→0；拖拽阶段纹理创建 72→5；`pump` 峰值 6.1→1.5ms。最终复测拖拽 P99 8.3ms、最大 37.5ms，滚轮 P99 4.8ms、最大 19.6ms，旋转阶段全部低于 6ms。
- 几何池的收益边界：单次手势内缓存未发生淘汰（`releases=0`）时池为空，复用不生效；长距离浏览触发淘汰后按布局键复用缓冲。证据：`docs/evidence/streaming-rebuild/smoothness-*.json`、`smoothness-final-fixture.png`（视觉抽样无残留几何，覆盖缺口 0）。

## Open Issues

- 每个新瓦片首次上屏仍需创建约 30 个 GPU 对象并产生 15–25ms GPU 侧准备；30 秒连续手势内残留 1 帧超过 16.7ms。彻底消除需要固定绘制槽位（有界预分配缓冲与稳定绑定），属核心渲染架构变更，需决策会话批准后新建任务。
- 当前改造的源码、离线回归与真实浏览器联合验收正在执行。
