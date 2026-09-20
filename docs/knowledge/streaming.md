# StreamingEngine 已验证事实

更新日期：2026-09-20。

## 代码与回归已确认

- 同级邻居预热，目标资源在 GPU 管线准备完成后进入可绘制索引。主源 204 独立计入 `primaryEmpty`，辅助来源继续读取；组合包全部无内容时覆盖树使用真实祖先资源，地址关系由 `primaryFallbacks` 列出。当前设计见 `docs/architecture/maplibre-aligned-streaming.md`。

- `Map3D` 生产瓦片入口为 `packages/map3d/src/streaming/engine.ts`。数据为 KYE XYZ MVT，Three.js / TSL 绘制原生面、中心线实例和合批挤出建筑。
- 当前表面透明度固定。目标、可用祖先、已加载子级共同生成互斥地面区域；完整来源按父到子写入保守模板，所有填充与线条逐采样点测试唯一来源编号。就绪内容在帧边界接替。
- 当前目标、实际来源、限额合并、预测需求、在途预留与雾剔除分别计量。面板的编号开关显示实际来源编号和 z/x/y。
- 就绪祖先索引按资源加入/释放增量维护。过期上传产物释放后归还阶段槽位；过期构建结果关闭位图。
- 网络响应流按实际解压字节申请预算。2026-09-16 实测 z10/857/418 为 3,950,068 字节、z10/843/387 为 2,267,040 字节，HTTP 均为 200。
- CPU/GPU 各 256 MiB，条目 256，网络 12，Worker 4，当前目标 128，预测 32。CPU 包含归属数据和在途预留估算；浏览器与驱动内部内存具有独立计量边界。
- 回归覆盖互斥父子归属、直接接替、世界副本、过期上传释放、空瓦片、预算压力、快速缩小、俯仰突变、资源销毁及近处地面采样。

## 画质与数据契约

- KYE `kye_water_ocean/7/108/55` 含局部海洋几何，`7/109/55` 返回 204；`kye_water/6/54/27` 提供该区域基础水面。Playground 基础海洋持续参与合成，详细海洋独立补充，两者共享填充批次。真实数据 fixture、同级缩放与海陆像素证据见 `docs/evidence/maplibre-alignment/README.md`。

- 当前平面/地球过渡、Inspector、地名层级和逐帧冷加载证据见 [地图样式与稳定性验证](../evidence/map-inspector/README.md)。

- 最大倾角为 75°。CPU 与 TSL 使用一致的球面距离雾约束，球缘薄雾作用于地平线。目标集合保持单一层级，向下/向上 zoom 滞回分别为 0.18/0.08。
- z5.5 及以上使用平面坐标与 highpModelViewMatrix；z4.5～5.5 连续过渡到球面。完整球面朝向限定过渡可见半球，经度采用最近世界副本。九类 SDF 图标与文字共用字形 atlas，墨迹中心水平对齐。
- 晴昼、深海、晴彩覆盖地图面、线、边界、建筑、文字、图标、雾与背景；256 项颜色与参数缓冲共占 8 KiB。BufferNode 保持编译期间的调色板引用。全局平面陆地使用单批次；Inspector 按事件静默同步控件。
- 显式 WebGL2 模式默认单采样，线与文字保留解析抗锯齿；`renderer.antialias: true` 为 4x MSAA，WebGPU 默认 MSAA。同机采样对照见 `docs/evidence/map-experience/aa-comparison.json`。
- SDK 道路线宽支持米和 CSS 像素；Playground 使用 OpenFreeMap Liberty 的缩放插值，按 256/512 瓦片尺度转换后映射到地表并参加透视投影。近景保留原始 MVT 折点，线段采用共享折点挤出。
- KYE 官方 `landuse_grass` 包含 `subclass != grassland` 条件；台湾 `7/106/55` 的 173 个草地要素均属于被筛选的区域草地网格。城市绿地保留按类别绘制。
- 文字使用持久身份、世界锚点、200 ms 连续透明度、按字号和 DPR 求值的 SDF 采样核，以及单交错实例缓冲。
- 建筑按瓦片合批，使用 height、min_height 和 kind 原始属性；Playground 的显示门槛为 15.74。北京两个样本共 622 个建筑 feature，kind 在样本中全量出现；类别业务名称属于上游字典边界。
- 国界使用主源 boundary，省界使用 kye_admin_pro/border；铁路、隧道、渡轮、省界采用独立虚线/点划线样式。
- 2026-09-16 五项画质实现、真实 WebGPU 矩阵及连续交互结果见 `docs/evidence/map-quality/README.md`。

## 浏览器证据索引

- `streaming-motion` 记录 WebGPU 模板编号跨通道的定点与运动验证；两个后端分别执行 904 次相同状态重复绘制、24 个层级/倾角场景与 30 秒独立性能轨迹。实现、像素判定阈值和冷加载边界见对应报告。
- `map-inspector` 的两个后端各 35 个静态场景全部收敛；关闭文字的冷加载共 1208 帧，单帧大面积泛白检测为 0。30 秒独立连续交互 WebGL2 148.98 FPS、WebGPU 143.77 FPS，采样覆盖缺口与错误为 0。近景误差、原生视口 RAF 边界和 UI 补验见对应报告。
- 入口 `http://127.0.0.1:6661/`，双后端分别运行，2560×1305、DPR1、RTX 4070 Ti。
- `map-experience` 记录的 45 秒连续交互：WebGL2 163.58 FPS、CPU P95 6.9 ms；WebGPU 164.85 FPS、CPU P95 7.1 ms。两者帧间隔 P95 均为 6 ms，覆盖缺口、空目标、运行错误均为 0。
- `map-experience` 的两个后端各 15 个静态场景全部收敛，各 197 张图像完成模型视觉检查。独立 12 秒运动截图与 45 秒性能采样分别保存。
- 默认 1280×720 页面已通过面板主题、字号、密度、图标、类别颜色/描边与重置操作。z2 从 179.9° 大跨度真实拖动的冷加载阶段记录 2 个覆盖缺口，随后收敛为 0；网络到达时间属于详细瓦片首次显示的边界。
- 机器、轨迹、采样配置与原始 evidence 的 SHA256 见 `docs/evidence/map-experience/verification-summary.json`。截图采样、浏览器帧间隔与物理显示器观感具有独立计量边界。

## 来源与实现入口

- 固定版本公开机制：[行业资料核验](../research/industry-tile-streaming-2026-09-16.md)。
- 当前模块与预算：[StreamingEngine 架构](../architecture/nova-tile-engine.md)。
- 验收标准：`tasks/T046-tile-system-full-lifecycle-repair.md`。
- 本轮原始证据目录：`docs/evidence/streaming-rebuild/`。
