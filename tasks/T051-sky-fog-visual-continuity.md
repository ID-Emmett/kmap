# T051 天空背景与远景雾连续融合

Owner: AI 实施会话
关联决策：D036。
依赖：T046、T050。

## Goal

在不同倾斜视角中呈现高德参考图所示的蓝色渐变天空，使天空底边跟随雾吞没地图内容的位置，地面与建筑连续融入同色远景雾，并在运动和主题切换中保持逐帧对齐。

## Scope

- 在 SDK 的场景背景中绘制天空渐变，使近处地面和建筑自然遮挡天空。
- 根据当前帧相机、视口和雾完成位置确定天空可见底边；对可见天空区域完整映射地平线色至天顶色。
- 协调地面、矢量瓦片、线、建筑、卫星影像和远景标签的雾化/消失，使远景内容进入纯天空区域前自然淡出。
- `MapTheme` 增加可选 `skyZenithColor`；地平线色与雾末端色共用 `fogColor ?? backgroundColor` 的解析结果。Playground 三套主题各设天顶色，面板可编辑并可重置。
- 保持同帧参数更新和 WebGPU/WebGL2 视觉一致性；处理连续俯仰、zoom、pan、bearing、resize、MapOrigin 与底图/主题切换。
- 形成自动、前台 Chrome 画面、逐帧、性能和人工视觉验收证据。

## Non-Goals

- 地形、太阳、云层、天气动画和体积雾。
- 第三方地图运行时、独立着色器语言、后处理与额外运行时依赖。
- 瓦片调度、缓存、数据协议、默认资源预算和其他公共 API 的调整。

## Inputs

- D036 当前视觉契约。
- 人工负责人提供的高德地图视觉参考：`docs/research/T051-amap-sky-reference-1.png`、`docs/research/T051-amap-sky-reference-2.png`。图片只定义目标观感，不作为渲染实现依据。
- 当前 `MapTheme`、相机帧、雾距离、瓦片可见性、矢量表面和卫星影像渲染代码。

## Constraints

- `pitch=0` 保持俯视地图画面；`pitch=20/40/60/75` 的顶部均呈现可辨认的蓝色天空，包含平视状态。
- 天空作为背景参与深度关系；近处高楼完整遮挡天空，远处建筑在消失前逐渐变淡。
- 天空底边依据雾吞没后的可见内容边界移动；天空底边和完全雾化的地面、瓦片、建筑、影像采用同一颜色。边界以上由天空填满。
- 雾过渡连续柔和；完全雾化处无残留底图色、矩形硬块、离散轮廓或悬空清晰建筑。
- 天空、雾、相机与地图内容在同一帧对齐；连续操作中无抖动、跳动和错位。雾完成前的有效地图区域保持完整覆盖。
- WebGPU 和强制 WebGL2 共用 Three.js / TSL 路径。SDK 保持与 Playground 解耦。
- 浏览器验证仅在 Chrome 前台可见、当前激活的窗口/标签页执行。命令行自动测试及治理门禁按项目规则执行。

## Acceptance Criteria

- `pitch=0` 的画面无天空；`pitch=20/40/60/75` 和这些角度之间的连续运动中，顶部蓝色可见，天空底边随内容边界连续移动，渐变覆盖从底边到屏幕顶部的可见天空。
- 高楼与地面正常遮挡天空；远景地面、矢量瓦片、线、建筑和卫星影像在雾末端达到相同地平线色，远景建筑先渐淡再消失。
- 内容到天空的颜色剖面连续，天空侧无大片单色浅雾带；pan/zoom/bearing/pitch/resize/MapOrigin 更新和主题/底图切换均无一帧错位、色缝或突跳。
- 晴昼、深海、晴彩各有天顶色；调整天顶色或雾色后画面即时同步，雾色与天空底边保持一致；省略新字段的既有主题继续可用。
- 有雾尚未吞没的地面区域保持瓦片覆盖；天空效果不隐藏真实加载缺口。纯卫星、矢量和卫星叠加状态均通过实际画面验证。
- Chrome 前台可见窗口中的 WebGPU 与强制 WebGL2 对照、自动测试、`pnpm check`、`pnpm ai:check`、`git diff --check` 和人工负责人视觉验收均通过后更新为 DONE。

## Test Plan

- 单元/集成：天空底边投影与视口映射、雾末端色解析、`pitch=0` 门控、不同视口与方位连续性、主题默认/覆盖、矢量与卫星路径、资源释放。
- 在真实 Chrome 前台窗口分别验证 WebGPU 和强制 WebGL2；固定视图 `pitch=0/20/40/60/75`，每个角度保存完整截图、画面取样、相机/雾/边界参数和控制台日志。
- 对两张参考图对应的城市视角采集俯仰变化画面，并用近处高楼遮挡、远景建筑渐淡和天空完整渐变作人工对照。
- 连续执行 pan、zoom、bearing、pitch、resize、MapOrigin 变化及三主题/底图切换；采集逐帧画面和边界参数，核对同帧对齐、颜色剖面、覆盖与帧时间。
- 在前台 Chrome 中检查矢量、纯卫星和卫星叠加，包含慢网与瓦片接替期间的远景颜色和完整覆盖。
- 运行最近相关测试、`pnpm check`、`pnpm ai:check`、`git diff --check`，登记命令与结果。

## Task Context Packet

### Must Read

- `AGENTS.md`、`docs/project-state.md`、`TASKS.md` 的 T051 行与依赖、本文件。
- `KNOWLEDGE.md`、`docs/evidence/index.md`、`docs/ai-session-log.md`。
- `docs/decisions/D036-sky-fog-visual-contract.md`。
- `docs/architecture/nova-tile-engine.md` 的当前显示与选片契约、主题与渲染配置。
- `docs/knowledge/rendering.md`、`docs/knowledge/streaming.md` 的当前雾与主题事实。
- `packages/map3d/src/Map3D.ts`、`types.ts`、`rendering/mapCamera.ts`、`streaming/fog.ts`、`streaming/coveringTiles.ts`、`streaming/surface.ts`、`raster/rasterSurface.ts`。
- `apps/playground/src/themes.ts`、`styleConfiguration.ts`、`appearanceInspector.ts`。
- 两张 `docs/research/T051-amap-sky-reference-*.png` 视觉参考。

### Read If Needed

- `packages/map3d/src/streaming/{engine,groundVisibility,fillSurface,lineSurface,buildingSurface}.ts`：雾参数、覆盖或远景表面出现证据缺口时读取。
- `packages/map3d/src/raster/rasterLayer.ts`、`packages/map3d/src/labels/labelSystem.ts`：卫星或文字边界需要核对时读取。
- `docs/experience-baseline.md` 的倾斜视角远景渐隐段落、`docs/evidence/map-quality/README.md` 的雾画质证据：当前参数或性能基线需要追溯时读取。
- `docs/verification-baseline.md` 的双后端和人工体验段落：验收记录格式需要核对时读取。

### Allowed Files

- `packages/map3d/src/Map3D.ts`、`packages/map3d/src/types.ts`、`packages/map3d/src/rendering/mapCamera.ts`、`packages/map3d/src/rendering/sky*.ts`。
- `packages/map3d/src/streaming/{fog,coveringTiles,groundVisibility,surface,engine,fillSurface,lineSurface,buildingSurface}.ts`。
- `packages/map3d/src/raster/{rasterLayer,rasterSurface}.ts`、`packages/map3d/src/labels/labelSystem.ts`。
- `packages/map3d/test/*sky*.test.ts`、与上述模块直接相关的现有测试。
- `apps/playground/src/{themes,styleConfiguration,appearanceInspector}.ts`、`apps/playground/test/{themes,styleConfiguration}.test.ts`。
- `scripts/T051-*.mjs`、`scripts/ai-governance/check-ai-governance.mjs` 的 T051 登记。
- 本任务文件、`TASKS.md`、`PROJECT.md`、`docs/project-state.md`、`KNOWLEDGE.md`、`docs/decisions/D036-sky-fog-visual-contract.md`。
- `docs/architecture/nova-tile-engine.md`、`docs/knowledge/{rendering,streaming}.md`、`docs/evidence/T051-*`、`docs/evidence/index.md`、`docs/ai-sessions/YYYY-MM-DD.md`、`docs/ai-session-log.md`。

### Forbidden Files

- `D:\\code\\kyemap-js-api\\**` 及其他仓库。
- `packages/map3d/src/streaming/{pipeline,tileStore,tileRequest,paint,paint.worker,protocol,workers}.ts`、`packages/map3d/test/fixtures/**`。
- 无关业务模块、锁文件、依赖版本与既有任务的验收门槛和历史证据。
- `docs/evidence/` 全量目录的通读。

### Required Evidence

- 底边映射、主题解析、雾末端收敛、遮挡/远景消失和资源释放的自动测试命令与结果。
- Chrome 前台激活状态、浏览器版本、后端、视口、DPR、主题、底图和视图参数记录。
- WebGPU/WebGL2 的角度矩阵截图与连续交互录屏/逐帧取样；包含高楼遮挡、远景渐淡、天空完整渐变、颜色剖面和接缝检查。
- 慢网与底图切换的覆盖、边界、控制台和帧时间记录；人工负责人视觉验收结论。
- `pnpm check`、`pnpm ai:check`、`git diff --check` 的结果与 `docs/evidence/index.md` 索引。

### Stop Conditions

- T046 或 T050 尚未完成依赖验收。
- 需要改变 D036 的背景/边界/主题语义、既有公共 API（除可选 `skyZenithColor` 外）、核心架构或技术基线。
- 需要修改 Forbidden Files、调整瓦片调度/缓存/预算、降低覆盖或调整既有性能验收门槛。
- 自动证据与人工视觉验收冲突，或 Chrome 前台真实画面无法建立所需证据。

## Findings

- 初始 `MapTheme` 提供 `backgroundColor`、`landColor`、`fogColor`；`Map3D` 使用场景背景色，`TileSurfaces` 设置 Three.js `fogNode`，纯卫星状态由独立 `RasterLayer` 绘制影像。代码入口见本任务 Must Read。
- 高德 Chrome 参考截图呈现蓝色上方天空、浅色雾边界及不同俯仰角的城市视图，保存于 `docs/research/T051-amap-sky-reference-*.png`。
- 人类负责人 2026-09-29 直接要求执行 T051；T046 仍为 IN_PROGRESS、T050 仍为 VERIFYING，本次按人工指令在依赖未结项状态下实施，并在证据中记录该边界。

## 实施结果

- 新增 `packages/map3d/src/rendering/sky.ts`：`MapSky` 持有地平线色、天顶色、天空底边、雾中心与起止距离；场景背景节点与场景雾节点共用同一渐变颜色，因此雾末端色等于当前屏幕位置的地平线色，内容不会以异色块进入天空。
- 雾距离改为按屏幕高度求解（`fogBoundaryFraction`、`fogBandFraction`、`fogDistanceAtScreen`）：边界固定在屏幕上且随俯仰角连续移动；pitch 0～10 屏幕内无雾无天空，20° 边界位于顶部 6%，75° 位于顶部 40% 并保持原有 T015/T046 调参（起点约 0.92d、终点约 1.45d）。
- 天空可见底边由相机水平前向上三维距离等于 `fogEnd` 的地面点投影得到，与雾几何严格一致；`pitch=0` 与水平前向退化时底边为 0，屏幕内没有天空。
- `MapTheme` 新增可选 `skyZenithColor`；地平线色与雾末端色共用 `fogColor ?? backgroundColor`；Playground 三套主题各设天顶色，Inspector 新增“天空天顶色”控件并随主题重置。
- 远景文字启用场景雾；地面批次、瓦片、线、建筑与影像全部收敛到同一地平线色，远景建筑先渐淡再消失。
- 覆盖结果按当前选择与就绪集合解析（`coverFor`）：相机与雾边界变化导致的可见裁剪变化会更新已提交分区，避免新进入边界的地面缺少覆盖。

## 验证

- 自动：`pnpm --filter @kmap/map3d test`（34 文件 194 项）、`pnpm --filter @kmap/playground test`（7 文件 22 项）、`pnpm check`、`pnpm ai:check`、`git diff --check` 全部通过。新增 `packages/map3d/test/sky.test.ts` 覆盖底边投影与雾带比例一致、低倾角无天空、主题颜色解析、地面覆盖范围一致、远景文字随雾收敛与双后端着色器生成。
- 前台 Chrome 152：`scripts/T051-browser-probe.mjs` 双后端证据位于 `docs/evidence/T051-sky-fog/`，包含 pitch 0/20/40/60/75 截图与中心列颜色剖面、14 秒连续俯仰/平移/缩放/方位逐帧边界（最大单帧变化 0.0059）、resize、MapOrigin 变化、三主题与天顶色/雾色编辑及重置、纯卫星与卫星叠加底图、控制台与网络记录。断言全部通过，运行期覆盖缺口 0 帧。
- 2026-09-30 修复后复验：双后端各 20 张截图（新增 pitch 26）与 JSON 断言全部通过；连续交互 WebGPU 2516 帧 240 FPS、WebGL2 3356 帧 239.6 FPS，覆盖缺口 0 帧；`pnpm --filter @kmap/map3d test` 195 项、`pnpm check` 通过。
- 人工验收：2026-09-30 人工负责人视觉验收通过（平面过渡、无亮光带、高楼不被吞、过渡带宽度可接受）。
- 方案 A 复验（2026-09-30）：`pnpm --filter @kmap/map3d test` 196 项、`pnpm check` 通过；双后端前台 Chrome 证据全部断言为真，新增“雾等值线是水平线”检查（pitch 75 左中右三列过渡行同为 0.4283，卫星 60° 为 0.208/0.208/0.196）；连续交互 WebGPU 3189 帧 227.7 FPS / CPU P95 4.5 ms，WebGL2 3134 帧 223.8 FPS / CPU P95 4.0 ms，覆盖缺口 0 帧，边界单帧最大变化 0.022。
- 性能：连续交互 2491～3189 帧，WebGPU 平均 179.7～227.7 FPS / CPU P95 3.5～4.5 ms，WebGL2 平均 177.9～223.8 FPS / CPU P95 2.8～4.0 ms；帧间隔 P95 均为 6.1 ms，GPU 字节峰值约 105 MiB。

## Open Issues

- 雾值取「相机距离」与「屏幕行换算地面距离」的较小值，再按距离曲线求值：近处高楼按自身距离计算，不会被高屏幕行当成远景吞掉；同一屏幕行整行一致，过渡线是水平线，广角相机下左右角不出现圆弧。`rowStart`/`rowEnd` 由起止距离连续换算（`fogRows`），逐帧随视角移动。
- 选片半径 = 98% 入雾距离 × `fogCornerCoverage`（`sqrt(1 + tanH²)`，1280×720 为 1.2417），边缘在完全入雾前不会被剔除。
- 过渡带按 `FOG_BAND_SCALE`（人工负责人 2026-09-30 视觉调优为 .4，已导出常量）收窄：完全入雾位置不变，开始入雾更靠近它；60° 过渡带约占 6.3% 屏高，75° 约占 3.8%。
- 收尾清理（2026-09-30）：删除不再使用的 `rowStart` uniform、`MIN_ROW_BAND` 与 `fogRows`；`MAP_CAMERA_HALF_FOV_TANGENT` 与 `FOG_CUTOFF_ROOT` 提取为共享常量并去掉硬编码 22.5；地面底板半径改为取雾完成距离与选片半径的较大者，去掉与选片半径的隐式耦合；`MapSky` 类注释同步为当前 `min(相机距离, 屏幕行距离)` 语义。
- 清理后新增保护测试：CPU 行换算与着色器行换算互为反函数（`sky.test.ts`）；选片放大系数覆盖同行边缘与中心的最大距离比且随宽高比单调；过渡带宽度断言改为关系式 `end - start = (end - wide) × FOG_BAND_SCALE`，不再硬编码数字。
- 过渡色 `floor = mix(地平线色, 天顶色, 0.35)`，天空底边与雾末端共用该色，保持零色缝并去掉纯背景色形成的亮光带。
- D036 实现落点差异：雾末端色不再是 `fogColor ?? backgroundColor` 原值；选片半径不再是 98% 入雾距离原值，而是再乘横向展宽系数。
- 性能观察（2026-09-30，1600×900 DPR 1、Chrome 152 前台，240 Hz 显示器）：连续交互 WebGPU 3163 帧 225.9 FPS / CPU P95 4.6 ms，WebGL2 3078 帧 219.8 FPS / CPU P95 4.1 ms；buildings zoom 17 场景 draw call 最高 333，FPS 最低 168。CPU/GPU 字节峰值 198.7/167.6 MiB，entry 缓存多次达到 256 上限。FPS 受 240 Hz vsync 限制，不能作为余量结论。
- T046 仍为 IN_PROGRESS、T050 仍为 VERIFYING；本次未改变其状态与既有验收门槛。T048 的 160fps/P95/P99 性能断言未在本次复跑，仍为既有遗留问题。
- 证据 PNG/JSON 位于 `.gitignore` 覆盖的 `docs/evidence/` 下，未强制纳入版本控制；索引与报告已登记。

## Status

DONE
