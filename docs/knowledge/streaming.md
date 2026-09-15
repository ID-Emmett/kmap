# StreamingEngine 已验证事实

更新日期：2026-09-15

## 实现与数据

- `Map3D` 的瓦片入口为 `packages/map3d/src/streaming/engine.ts`。
- 输入为真实 KYE XYZ MVT；Worker 通过 `@mapbox/vector-tile` 和 `pbf` 解码，OffscreenCanvas 绘制 fill/line 图层，输出 512 × 512 ImageBitmap。
- Three.js WebGPU 使用共享平面几何、`MeshBasicNodeMaterial` 和共享 TSL 距离雾；每帧纹理上传上限为 1。
- 512 像素纹理与 256 CSS 像素 XYZ 语义支持整数数据层级之间的连续缩放；目标最大数据层级取视图 zoom 的整数部分。
- 相机视锥与地面截止半径共同约束选片；邻接预取使用相同截止边界。
- 当前可见需求具有完整祖先链。无底图的覆盖面立即显示，具有底图的细节执行 140 ms 淡入；缩小切换中的细层级淡出。
- 生命周期测试验证初始化复用、销毁资源、慢网并发上限、204 祖先覆盖和俯仰跳变覆盖。

## KYE 海面响应

在经度 124°、纬度 33° 的实测样本中，z5/27/12 和 z6/54/25 包含 ocean 面；z7/108/51 和 z8/216/103 返回 HTTP 204。204 目标使用有内容的祖先提供地理覆盖。

## 体验验证

公开资料与验收门槛：`docs/research/streaming-rebuild-public-sources.md`。

实际浏览器录像、帧时间、连续图像审查与回归记录：[WebGPU 验收报告](../evidence/streaming-rebuild/README.md)。

证据采用逐帧间隔、60 FPS WebM、10Hz 图像/诊断与连续画面审查。覆盖统计与细节层级差分别记录。

1519×1272 与 1280×720 的两次城市往返各通过 17 项断言，运动帧 P99 分别为 11.9 ms、6.0 ms；真实手势运行 P99 为 11.9 ms。加载完成后的交互覆盖缺口为 0，缓存回访的返回请求增量为 0。完整 10Hz 审查覆盖 1500 张图像，瞬时过渡补查覆盖 192 张 60Hz 采样图像。

本结果使用 RTX 4070 Ti、DPR 1、WebGPU 和启用 HTTP 缓存的实际浏览器。细节替换存在短暂道路线宽差异；大视口运动采样中 98.98% 的层级差 ≤2、最大为 3。
