# Nova Knowledge — Rendering

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

## 当前渲染风险

- T024 虽然修复了逐 Tile upload 直接提交的问题，但人工体验仍需 T027 逐帧诊断验证。
- 截图、控制台无错误和脚本统计不能独立证明 pan/zoom 视觉体验已通过。
