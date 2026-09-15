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
- Worker 使用 `@mapbox/vector-tile` 与 `pbf` 解码，OffscreenCanvas 绘制面图层，TypedArray 保存按样式顺序排列的线段实例。
- 瓦片使用 256 CSS 像素地图数据语义；面纹理在数据源最细三级使用 512 像素，其余使用 256 像素。
- Three.js WebGPU 使用共享平面几何、纹理、实例胶囊和 TSL 距离雾合成地图；线宽按当前视图计算。
- 数据源、场景、网络、Worker 与缓存属于 SDK；测试轨迹、录像和面板属于 Playground。

## 验收定义

验收环境为 `http://127.0.0.1:5173/` 的实际 WebGPU 浏览器。以下性能阈值是本项目针对 60 FPS 体验的工程验收标准，行业实时交互的帧预算为每帧约 16.67 ms。

- 连续平移、缩放、旋转与城市飞行：实际帧间隔 P95 ≤ 18.5 ms，P99 ≤ 25 ms，超过 33.34 ms 的帧占比 ≤ 1%，单帧小于 100 ms。
- 请求并发 ≤ 12，Worker 并发 ≤ 4，CPU/GPU 瓦片预算各 ≤256 MiB，条目数 ≤384。
- 每帧间隔记录，60 FPS 目标录像（H.264 / MP4 或 VP8 / WebM），10Hz 图像、相机和瓦片集合诊断构成联合证据。
- 连续图像审查覆盖初始加载、平移、缩放、旋转、倾角 0/20/40/60 度、北京→上海→北京、缓存回访和静止收敛。
- 实际画面具有正确地理方向、连续道路和水面，目标区域有完整底图，交替过程保持可见内容。
- 运动采样中至少 95% 的显示层级差不超过 2，全部不超过 3；城市到达时目标细节已就绪。连续图像同时检查粗道路放大块、海面矩形色块和瞬时空白。
- 雾区之外的瓦片选择由同一距离边界约束。
- 可见区域的覆盖缺口必须逐段解释和修复；自动指标与视觉审查共同构成验收证据。

## 已验证结果

实际 WebGPU 浏览器在 2560×1305、DPR 1 视口完成首屏快速交互、北京→上海→北京、缓存回访、倾角矩阵和真实手势。三项最终运行分别通过 15、19、15 项断言；前两项运动帧 P99 为 17.7 ms、17.6 ms，手势前 25 秒活动段为 12.0 ms。初始加载后交互覆盖缺口为 0。运动采样层级差 ≤2 比例依次为 99.51%、97.69%、100%，最大为 3、3、2。

1155 张 10Hz 连续图像、477 张关键窗口的 60Hz 重采样图像及三张原始分辨率峰值图已完成模型视觉审查。道路宽度按当前视图稳定显示，目标细节逐步补齐，城市与海面覆盖连续。首个完整覆盖采样为 324.0 ms，目标细节就绪为 1276.9 ms。测试环境、完整时序、视觉观察与复跑索引见 [道路宽度与快速交互修复报告](../evidence/streaming-rebuild/oversized-roads-fix.md)。

## 待验证范围

HTTP 全冷缓存、受限公网、其他 GPU 与物理显示器逐帧呈现需要对应环境的独立证据。当前结果基于浏览器 HTTP 缓存启用的实测环境。
