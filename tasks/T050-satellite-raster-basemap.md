# T050 卫星 XYZ 影像底图与按需矢量叠加

Owner: AI 实施会话
关联决策：D035。
依赖：T049。

## Goal

在当前单世界平面地图上提供可配置卫星 XYZ 影像、独立线与文字叠加、一键纯卫星/矢量预设，并以真实浏览器证据确认全层级连贯性。

## Scope

- SDK 增加可配置栅格源与底图运行状态；保持现有矢量入口可用。
- 栅格路径独立选片、请求、图片解码、GPU 资源、已就绪祖先覆盖、帧边界替换、取消与有界回收。
- 纯卫星状态关闭矢量网络、Worker 和绘制；卫星叠加按线路或文字开关启动矢量路径；所有卫星状态关闭矢量面和建筑绘制。
- Playground 面板提供三个独立开关和卫星/矢量一键预设，默认影像模板使用高德 `style=6`。
- 对影像占位图片和原生有效层级提供明确处理；低缩放按屏幕像素密度选择影像地址。
- 建立自动测试与 WebGPU/WebGL2 实际画面、连续缩放、请求、Worker、内存和帧时间证据。

## Non-Goals

- 球面地图、世界副本、地形、完整 Mapbox Style Spec、离线影像包。
- 更换 Three.js、渲染后端或 KYE 矢量数据格式。
- 替 T046/T048 调整已有矢量性能验收门槛。

## Task Context Packet

### Must Read

- `AGENTS.md`、`docs/project-state.md`、`TASKS.md` 的 T050 行、本文件。
- `KNOWLEDGE.md`、`docs/evidence/index.md`、`docs/ai-session-log.md`。
- `docs/decisions/D034-flat-map-only-remove-globe.md`、`docs/decisions/D035-satellite-raster-basemap.md`。
- `docs/architecture/nova-tile-engine.md`、`docs/research/kye-raster.md`。
- `packages/map3d/src/Map3D.ts`、`types.ts`、`streaming/engine.ts`、`streaming/surface.ts`、`streaming/coveringTiles.ts`、`streaming/renderCover.ts`、`streaming/pipeline.ts`、`streaming/tileStore.ts`。
- `apps/playground/src/main.ts`、`appearanceInspector.ts`、`mapSource.ts`。

### Read If Needed

- `packages/map3d/src/streaming/**`、`packages/map3d/src/labels/**`、`packages/map3d/src/rendering/**` 与相邻测试。
- `docs/research/industry-tile-streaming-2026-09-16.md` 的栅格父子覆盖段落。
- `docs/verification-baseline.md`、`docs/experience-baseline.md` 的浏览器与连续体验段落。

### Allowed Files

- `packages/map3d/src/**` 的底图、栅格、瓦片、渲染、文字与接口相关模块。
- `packages/map3d/test/**` 的相关测试。
- `apps/playground/src/**` 的底图配置、面板与验收入口。
- `scripts/**` 的本任务浏览器证据脚本与治理任务映射。
- 本任务文件、`TASKS.md`、`PROJECT.md`、`KNOWLEDGE.md`、`docs/project-state.md`。
- D035、相关架构/知识/证据分片及索引、`docs/ai-sessions/2026-09-28.md`、`docs/ai-session-log.md`。

### Forbidden Files

- `D:\\code\\kyemap-js-api\\**` 的修改。
- `packages/map3d/test/fixtures/**` 历史样本的删除或替换。
- 无关业务模块、依赖升级与锁文件。
- T046/T048 的验收标准与历史证据快照。

### Required Evidence

- 影像有效层级、占位图、XYZ 坐标、父子 UV、边缘连续性及资源上限测试。
- 纯卫星零矢量网络/Worker/绘制、独立开关、切换取消、线与文字叠加测试。
- WebGPU 与强制 WebGL2 的真实浏览器 z0～z18 双向连续缩放、快速平移/倾斜、慢网与切换截图或视频；逐帧覆盖、网络、Worker、错误、内存和帧时间日志。
- `pnpm check`、`pnpm ai:check`、`git diff --check`。

### Stop Conditions

- 高德影像与 KYE 矢量在目标区域存在经验证的坐标错位，且无已批准的坐标契约处理。
- 栅格覆盖需要改变 D034 单世界投影或 T046 已确认的矢量覆盖语义。
- 外部影像授权或可用性阻断真实生产验收。

## Acceptance Criteria

- 纯卫星冷启动后矢量请求、Worker 构建与矢量绘制计数均为零；切入纯卫星后不再启动新矢量工作。
- 卫星模式的矢量面/建筑始终不绘制；线路和文字分别独立生效。
- 有效影像覆盖建立后，连续缩放与开关切换不出现世界范围内背景矩形空洞、整帧白屏或瓦片接缝；失败影像由已就绪祖先保持覆盖。
- z0 全球概览采用有效层级影像；z18 以上的画质边界按源有效上限说明。
- 双后端浏览器证据、自动门禁与人工体验验收共同满足后更新为 DONE。

## Findings

- 2026-09-28 方案讨论确认：平面全球概览；卫星预设进入纯卫星。
- 2026-09-28 四个高德节点的北京单地址取样：z0 与 z19 返回相同占位 PNG；z1、z6、z17、z18 返回有效 JPEG。Playground 的有效层级设为 z1～z18，z0 全球概览由 z1 四瓦片构成；z20 视图显示 z18 影像的最高原生细节。
- SDK 的 `RasterLayer` 独立管理影像选片、8 个并发请求、8 秒超时、图片解码、GPU 纹理、祖先覆盖和 192 条目上限。`setBasemap/getBasemap` 管理三个开关；卫星状态关闭矢量面与建筑，纯卫星状态不创建矢量运行时。
- WebGPU/WebGL2 连续缩放各采样 5408/5458 帧，已建立影像覆盖后的缺口帧和零影像绘制帧均为 0，矢量请求均为 0。慢网与 503 注入的 2226/2171 帧、快速平移/倾斜和真实面板预设也完成双后端验证。资源上限及原始数据见 `docs/evidence/satellite-basemap/T050-current-verification.md`。
- `pnpm check` 通过：SDK 186 测试、Playground 20 测试、类型检查和构建成功。`pnpm ai:check` 与 `git diff --check` 通过。

## Open Issues

- 人工负责人需在目标物理显示器确认连续缩放与关闭线/文字的观感；通过后可将状态更新为 DONE。
- 十轮快速开关压测的单帧 CPU 峰值为 WebGPU 173.2 ms、WebGL2 168.7 ms；覆盖与画面持续存在，操作流畅度需人工体验判断。
- 高德影像授权、长期可用性及未抽样地区的源质量需要实际部署方确认；当前浏览器证据仅覆盖所测时间与轨迹。

## Status

VERIFYING
