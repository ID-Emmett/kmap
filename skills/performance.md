# Performance Skill

## 目标

以可重复测量数据优化 Kmap，而不是依赖主观流畅度判断。

## 流程

```text
建立基线
→ 采集指标
→ 定位瓶颈
→ 优化
→ 再测量
→ 对比结果
```

## 基线要求

- 固定 KYE 数据样本、视口、相机路径、zoom、设备、浏览器和 Three.js 版本。
- 分别记录 WebGPU 与 WebGL2 fallback。
- 至少采集 FPS/frame time、CPU/GPU 时间、draw calls、三角形、可见 Tile、请求/解码/构建耗时和 CPU/GPU 内存代理指标。
- 记录冷启动、稳定运行、快速平移、Zoom 和 Tile 回收场景。

## 执行规则

1. 优先使用 Three.js Inspector 和浏览器性能工具。
2. 一次只验证一个主要假设，保留对照组。
3. 不以降低正确性、移除功能或隐藏加载作为优化结果。
4. Geometry/Batch、Worker、缓存和 GPU 资源优化必须同时检查生命周期正确性。
5. 优化前后使用相同基线重复测量，并报告平均值、波动和样本次数。
6. 已验证的稳定结论写入 `KNOWLEDGE.md` 的 Performance 分类。

## 输出

- 测试环境与场景。
- 基线指标。
- 瓶颈证据和优化假设。
- 修改内容。
- 前后对比与回归结果。
- 适用范围、代价和后续任务。
