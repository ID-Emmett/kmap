# KYE 文字系统：数据依据与实现

## 已验证的数据

北京 `z15/26978/12416` 中，386 条道路有 129 条包含 `name/name_en`；17 个 POI 全部包含 `name/short_name/class/subclass/rank/level/osmId`。POI 的 rank 样本同时出现 7 和 519，level 表示数据可显示级别。根瓦片包含 `place` 地名及 `name/class/rank`。完整字段计数与样例见 [数据审计](../evidence/map-stability/label-data.json)。

字体 URL 为 `https://tiles.kye-erp.com/maptiles/fonts/{fontstack}/{range}.pbf`，fontstack 为 `Microsoft YaHei Regular`。中文 `19968-20223.pbf` 返回 HTTP 200，208,806 字节；解析测试核验“中”的 advance、bitmap、宽高和 3 像素 SDF 边界。源字体使用 24px em 与 8px 距离范围。

## 成熟机制依据

参考 MapLibre GL JS v5.6.2 的 glyph range 加载、GlyphManager、GlyphAtlas、CollisionIndex、Placement：256 字符一组、请求与缓存复用、atlas 留边、屏幕空间碰撞、跨瓦片标识和历史放置状态。URL、版本和 SHA256 见 [来源清单](../evidence/map-stability/references.json)。实现使用项目的 TypeScript、Three.js TSL 和 Worker；依赖沿用 `pbf`、`@mapbox/vector-tile`。

## 当前实现

1. Worker 从 symbol 图层提取候选。文字优先采用 `short_name/name`，道路采用 `name/name_en`。每瓦片分别保留最多 512 个点候选与 512 个道路候选，名称最多 48 个 UTF-16 单元。
2. 排序由图层 priority、class 优先级、`log2(rank+1)` 和已显示标签的保留加权共同确定。POI 结合数据 level 控制出现层级；地铁、机场、医院和学校具有显式类别优先级。
3. 候选先按视图层级、覆盖归属、视锥和球面背向裁剪；48px 屏幕单元保留 4 个高优先候选，全屏最多布局 2,000 个候选，默认显示 256 个标签，上限 512 个。碰撞使用 64px 网格，布局间隔至少 64ms，静止时复用结果。
4. 标签归属采用 render cover 的半开区间，父子瓦片在边缘锚点上保持互斥。同名道路在 320px 范围内去重。候选 key、世界锚点保留、2 秒淡入状态缓存和保留加权提供跨瓦片稳定性。
5. 道路从保留形状的简化中心线中选择最长直段。文字宽度与该段的投影长度比较，通过后按道路方向绘制，朝向保持可读。
6. 一个 2048² 单通道 SDF atlas 占 4 MiB。字体最多 4 个并发请求、32 个 range 缓存；请求超时 8 秒，失败重试间隔 30 秒。atlas 字形记录保留度量和 UV，PBF 缓冲由 range 缓存管理。
7. 全屏字形在一个实例批次内绘制，上限 8,192 个字形。锚点通过浮动原点与相机每帧投影；SDF 导数抗锯齿、描边及 160ms 淡入在 TSL 中计算。文字尺寸使用 CSS 像素，道路线宽使用地图米制。
8. diagnostics 提供候选数、已放置标签数、字形数、字体请求/错误、布局耗时和缓存范围数。实例销毁会取消字体请求并释放 atlas 与几何。

## 当前覆盖范围与验证边界

当前支持中文/拉丁地名、POI 和直段道路名称。沿曲线逐字排版、图标/盾牌混排、多锚点避让、复杂文字 shaping 和本地缺字替补属于后续能力范围。缺字计入诊断，该标签等待完整字形集合。

真实数据解析、碰撞、放置保留、浮动原点和资源释放已通过自动测试。WGSL/GLSL 节点源码生成以及双后端 36 场景实际浏览器验证已完成；当前实测指标和验收边界见 [验证记录](../evidence/map-refinement/README.md)。

2026-09-16 数据审计确认主源 z7 缺少 place，Playground 从有界缓存复用 z6 地名。POI 按数据 level 显示，样本包含 z8 机场、z10 景点和 z12 地铁站。来源与字段见 [数据核验](../evidence/map-refinement/data-audit.json)。
