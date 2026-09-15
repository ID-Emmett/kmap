# Nova Streaming Map Architecture

更新日期：2026-09-15

## 生产入口

`Map3D` 使用 `packages/map3d/src/streaming/engine.ts` 中的 `StreamingEngine`。Playground 通过 `@nova/map3d` workspace 依赖接入 SDK。

```text
ViewState + PerspectiveCamera
→ 视锥与距离约束四叉树
→ 当前可见需求 + 相邻预取 + 飞行预取
→ 有界请求队列
→ KYE XYZ MVT
→ Worker / VectorTile / OffscreenCanvas
→ ImageBitmap
→ Three.js Texture / MeshBasicNodeMaterial
→ WebGPU / 共享 TSL 雾
```

## 模块职责

| 模块 | 当前职责 |
| --- | --- |
| `address.ts` | XYZ 地址、世界副本、祖先关系和 URL 归一化 |
| `selection.ts` | 视锥剔除、地面距离限制、投影尺度 LOD |
| `engine.ts` | 需求优先级、请求生命周期、缓存、显示覆盖和回收 |
| `paint.ts`、`paint.worker.ts`、`workers.ts` | MVT 解码、图层过滤与 CPU Canvas 路径绘制、可转移位图 |
| `surface.ts` | 共享平面、纹理资源、TSL 距离雾与确定性销毁 |
| `diagnostics.ts`、`samples.ts` | 队列、内存、覆盖、实际采样与时间序列 |

## 数据与资源

- 输入为标准 XYZ MVT；经度世界副本在网络地址中归一化。
- Worker 按公共 fill/line 图层配置绘制颜色、透明度、宽度、过滤器和层级范围。
- 每张纹理为 512 × 512 像素，数据层级按 256 CSS 像素地图瓦片语义计算。
- CPU Canvas 上下文采用 `willReadFrequently: true`；输出 ImageBitmap 通过转移所有权交给主线程。
- 网络请求并发上限为 12，Worker 并发上限为 4，单帧上传上限为 1 张纹理。
- 默认 CPU 与 GPU 瓦片预算各 256 MiB，条目上限 384；需求准入根据纹理字节预算保留回收余量。
- 纹理提交前回收未被显示或需求保护的 LRU 资源。纹理、材质和位图均有销毁路径。
- 204 响应登记为空数据；显示覆盖继续寻找有内容的祖先。
- 请求失败具有有限重试与结构化错误事件。

## 显示与交互

- 已就绪祖先在子级加载期间提供底图；子级显示采用 140 ms 淡入。
- 可见需求包含完整祖先链；邻接粗层级覆盖俯仰和方位变化形成的新视锥。
- 缩小切换使用就绪粗层级作为底层，细层级在交替期间淡出。
- 相机按浮动原点更新。地面距离与 TSL 雾使用同一中心和截止半径。
- 倾斜画面的远方层级由投影尺度降低，距离截止范围约束选片和邻接预取。
- `Map3D.prefetchViews(views, options)` 接受未来视图、预取时效与优先级。
- Playground 城市飞行采用 van Wijk / Nuij 双曲函数路径；路线概览与目的地细节在飞行期间有显式预取时效。
- 面板保留帧、请求、Worker、上传、缓存、资源、覆盖和相机指标，提供城市飞行、60 秒验收、手势录像和 JSON 导出。

## 验证入口

- 公共资料与验收定义：`docs/research/streaming-rebuild-public-sources.md`。
- 实际浏览器：`http://127.0.0.1:5173/`，WebGPU。
- 自动与视觉证据：`docs/evidence/streaming-rebuild/`。
- 录像审查工具：`scripts/inspect-streaming-video.py`。
- SDK 测试：`packages/map3d/test/streaming.test.ts`、`map3d.test.ts`。
- 城市飞行测试：`apps/playground/src/cityFlight.test.ts`。
