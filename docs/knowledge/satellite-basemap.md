# 卫星底图已验证事实

- 当前 Playground 卫星影像源使用高德 `webst01..04` 的 `style=6` XYZ、256 像素瓦片。2026-09-28 的北京单地址抽样显示 z0 与 z19 返回同一无影像占位 PNG，z1、z6、z17、z18 返回 JPEG；四个节点样本结果一致。源配置使用有效原生层级 z1～z18 与该占位 PNG 的 SHA-256。证据：`docs/evidence/satellite-basemap/T050-source-sample.json`。
- `RasterLayer` 与 KYE MVT 分开选片、请求、解码、上传和回收。纯卫星状态不创建矢量运行时；线路或文字开启时才创建矢量运行时，卫星状态始终排除矢量面和建筑图层。已就绪祖先影像在目标瓦片加载期间覆盖视野，子级就绪后在帧更新中替换。
- z0 的单世界平面概览由四张 z1 影像组成；z20 视图使用最高有效 z18 影像采样，画质受源分辨率限制。源最大层级为公开配置项，不推断所有地区长期可用性。
- 真实 Edge Chromium WebGPU 与强制 WebGL2 各完成 z0→z18→z0 的 0.25 级步进、慢网/503 重试、快速平移/倾斜、面板预设和独立叠加验证。逐帧覆盖、资源、网络、截图与适用范围见 `docs/evidence/satellite-basemap/T050-current-verification.md`。
