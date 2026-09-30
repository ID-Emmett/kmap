# Kmap Knowledge — Rendering

更新日期：2026-09-12

## Three.js 后端

- 项目锁定 Three.js 0.185.1；`WebGPURenderer` 默认尝试 WebGPU，不可用时自动使用 WebGL2 backend，并支持 `forceWebGL`。
- SDK 不维护两套独立场景实现；WebGPU/WebGL2 必须共享渲染抽象。
- 证据：`packages/map3d/package.json`、Three.js r185 源码验证、浏览器回归 evidence。

## Polygon/Line GPU 纵向链路

- T006 已将真实 KYE `z15/26978/12416` 的 water、landuse、building 转换为 Tile `Group` 下的三个 `Mesh`。
- 固定统计：276 features、2,139 vertices、4,755 indices、53,244 CPU TypedArray bytes、53,244 GPU estimate bytes、3 batches 和 4 个 Tile/Batch Object3D。
- T009 已接入动态多 Tile Polygon/Line Runtime、world-wrap render instance 和公共 stats/idle/error。
- 证据：`docs/evidence/T006-webgpu-2026-09-09.png`、`docs/evidence/T006-webgl2-2026-09-09.png`、`docs/evidence/T009-*.png`。

## 网格伪影

- T011 已确认规则网格伪影根因是 KYE MVT Polygon 的 `-80..4176` buffer 几何在相邻 Tile 重叠区域对半透明 landuse/building 重复 alpha blend。
- 修复为 Polygon Worker 构建阶段将每个三角形裁剪到 `[0, extent]`，保持公共 API、Worker 协议、Tile transform、材质和 Line 几何不变。
- WebGPU/WebGL2 修复后截图无规则网格，人工负责人已接受。
- 证据：`tasks/T011-fix-global-grid-artifact.md`、`docs/evidence/T011-*.png`。

## 视觉与交互体验

- T012 Playground 浅色底图使用浅中性画布、柔和水体、植被、低对比建筑和道路层级；仅影响 Playground 配置，不改变 SDK 公共 Layer API。
- T013 已实现 Target/Display Coverage、fallback、outgoing/display pin 和短过渡；双后端慢网截图无矩形背景空洞，人工负责人已接受当时观感。
- T014 已实现 pointer release 惯性、rAF delta-time 阻尼、wheel 帧合并和 reduced-motion 禁用释放惯性。
- T015 已实现 Polygon/Line 共享 TSL horizon fade，pitch 0 strength 为 0，pitch 增大时平滑启用。
- 证据：`docs/evidence/T012-*.png`、`docs/evidence/T013-*.png`、`docs/evidence/T014-*.png`、`docs/evidence/T015-*.png`。

## 天空背景与远景雾

- 天空为场景背景：`MapSky` 的 `backgroundNode` 按屏幕高度绘制渐变，底边为过渡色 `floor`，屏幕顶部为天顶色（`skyZenithColor`，省略时为 SDK 蓝色默认值）。近处地面、瓦片、线、建筑与影像按正常顺序遮挡天空。
- 场景雾与天空共用同一渐变节点，因此完全入雾的内容与所在屏幕位置的颜色一致；远景文字使用同一场景雾，远景建筑先渐淡再消失，内容边界与天空之间没有色缝。
- 雾值取「相机距离」与「屏幕行换算地面距离」的较小值，再按距离曲线 `smoothstep(fogStart, fogEnd, ·)` 求值。相机距离保证近处高楼不会被高屏幕行当成远景而整体吞掉；屏幕行距离保证同一屏幕行整行一致，过渡线是水平线，广角相机下左右角不出现圆弧。`rowStart`/`rowEnd` 由起止距离连续换算，雾仍随俯仰角缓慢进入视野。
- 过渡带与天空底边共用 `floor = mix(地平线色, 天顶色, 0.35)`；地平线色是主题 `fogColor ?? backgroundColor`，固定混合后压掉纯背景色在过渡带形成的亮光带，同时保持零色缝。
- 过渡带按 `FOG_BAND_SCALE`（当前 .4）收窄：完全入雾位置不变，开始入雾更靠近它，雾不扩散到远处物体上。60° 过渡带约占 6.3% 屏高，75° 约占 3.8% 屏高。
- 选片半径 = 98% 入雾距离（`FOG_CUTOFF_ROOT`）× `fogCornerCoverage`；`MAP_CAMERA_HALF_FOV_TANGENT` 由 `mapCamera.ts` 统一导出，天空与雾共用同一值。CPU 行换算与着色器行换算互为反函数，二者一致性由单元测试保护。
- 颜色注意：天空渐变与主题色在**线性色空间**混合，跨空间比对颜色（例如用截图核对渐变）必须先把 sRGB 转线性再混合，否则整段天空都会被判为不匹配。
- 天空可见底边取完全入雾行（`rowEnd`），逐帧随俯仰角、缩放、平移和视口更新；`rowEnd` 落在屏幕上方时屏幕内没有天空，75° 时位于屏幕顶部 40%。
- 双后端前台 Chrome 证据（角度矩阵截图、中心列颜色剖面、逐帧边界、主题与底图切换）见 `docs/evidence/T051-sky-fog/`。

## 当前渲染风险

- T024 虽然修复了逐 Tile upload 直接提交的问题，但人工体验仍需 T027 逐帧诊断验证。
- 截图、控制台无错误和脚本统计不能独立证明 pan/zoom 视觉体验已通过。
