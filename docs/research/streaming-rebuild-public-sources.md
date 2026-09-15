# Streaming Map 公开资料

日期：2026-09-15

## 已验证资料

| 来源 | 代码已确认的机制 | 当前实现职责 |
| --- | --- | --- |
| [MapLibre covering_tiles.ts](https://github.com/maplibre/maplibre-gl-js/blob/main/src/geo/projection/covering_tiles.ts) | 视锥相交、相机与瓦片距离、投影误差影响层级 | `streaming/selection.ts` 的确定性四叉树选择 |
| [Geo-Three MapNode.ts](https://github.com/tentone/geo-three/blob/master/source/nodes/MapNode.ts) | 四叉树节点、父子显示交替、子节点资源缓存与销毁 | 已就绪父级提供覆盖，子级按就绪状态接替 |
| [Geo-Three LODRaycast.ts](https://github.com/tentone/geo-three/blob/master/source/lod/LODRaycast.ts) | Three.js 相机射线和距离驱动 LOD | 地图相机屏幕尺度作为细化依据 |
| [3DTilesRendererJS TilesRendererBase.js](https://github.com/NASA-AMMOS/3DTilesRendererJS/blob/master/src/core/renderer/tiles/TilesRendererBase.js) | 下载、解析优先级队列、LRU、祖先覆盖、每帧处理上限 | 请求、Worker、上传分阶段限额与资源回收 |
| [MapLibre camera.ts](https://github.com/maplibre/maplibre-gl-js/blob/main/src/ui/camera.ts) | van Wijk 与 Nuij 飞行路径、屏幕尺度与地理距离控制缩放 | 城市间缩小、平移和放大的可重复轨迹 |
| [Smooth and efficient zooming and panning](https://www.win.tue.nl/~vanwijk/zoompan.pdf) | 2003 年论文；MapLibre 实现引用此来源 | 飞行曲线资料索引 |

公开源码通过 GitHub HTTPS 读取。算法实现位于 `packages/map3d/src/streaming/`。

## 当前数据和渲染契约

- 输入为真实 KYE XYZ MVT。
- 图层顺序、颜色、过滤器和层级阈值来自 `apps/playground/src/mapStyle.ts`。
- Worker 使用 `@mapbox/vector-tile` 与 `pbf` 解码，OffscreenCanvas 按图层顺序填充和描边。
- 瓦片输出 512 × 512 ImageBitmap，对应 256 CSS 像素的地图数据级别。
- Three.js WebGPU 使用共享平面几何、纹理和 TSL 距离雾合成地图。
- 数据源、场景、网络、Worker 与缓存属于 SDK；测试轨迹、录像和面板属于 Playground。

## 验收定义

验收环境为 `http://127.0.0.1:5173/` 的实际 WebGPU 浏览器。以下性能阈值是本项目针对 60 FPS 体验的工程验收标准，行业实时交互的帧预算为每帧约 16.67 ms。

- 连续平移、缩放、旋转与城市飞行：实际帧间隔 P95 ≤ 18.5 ms，P99 ≤ 25 ms，超过 33.34 ms 的帧占比 ≤ 1%，单帧小于 100 ms。
- 请求并发 ≤ 12，Worker 并发 ≤ 4，CPU/GPU 和条目数均有显式预算。
- 每帧间隔记录，60 FPS WebM，10Hz 图像、相机和瓦片集合诊断构成联合证据。
- 连续图像审查覆盖初始加载、平移、缩放、旋转、倾角 0/20/40/60 度、北京→上海→北京、缓存回访和静止收敛。
- 实际画面具有正确地理方向、连续道路和水面，目标区域有完整底图，交替过程保持可见内容。
- 运动采样中至少 95% 的显示层级差不超过 2，全部不超过 3；城市到达时目标细节已就绪。连续图像同时检查粗道路放大块、海面矩形色块和瞬时空白。
- 雾区之外的瓦片选择由同一距离边界约束。
- 可见区域的覆盖缺口必须逐段解释和修复；自动指标与视觉审查共同构成验收证据。

## 已验证结果

实际 WebGPU 浏览器在 1519×1272 与 1280×720 视口完成城市往返、连续交互、缓存回访和俯仰矩阵，两次运行各 17 项断言通过。运动帧 P99 分别为 11.9 ms 与 6.0 ms。真实手势运行 P99 为 11.9 ms，覆盖缺口为 0。

1500 张 10Hz 连续图像和 192 张瞬时过渡的 60Hz 采样图像已审查。测试环境、完整时序、视觉观察与失败复跑见 [验收报告](../evidence/streaming-rebuild/README.md)。

## 待验证范围

HTTP 全冷缓存、受限公网、其他 GPU 与物理显示器逐帧呈现需要对应环境的独立证据。当前结果基于浏览器 HTTP 缓存启用的实测环境。
