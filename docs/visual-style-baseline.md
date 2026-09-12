# Nova MVP Visual Style Baseline

更新日期：2026-09-09

状态：D022 已确认的 MVP 视觉基线。它约束官方 Playground 和 MVP 验收场景，不改变 `@nova/map3d` 的通用 Layer API。

## 目标

MVP 使用原创的浅色矢量底图，参考 Apple Maps 的清爽、低噪声和层级清晰感，但不复制 Apple 的专有样式、资产、标识或完整视觉细节。

当前 MVP 没有文字、Glyph/Sprite、完整 Style v8 和数据驱动表达式，因此验收目标是“无文字的浅色底图骨架”，不是 Apple Maps 等价实现。

## 视觉原则

- 背景与一般土地使用浅中性灰白，不使用深色画布。
- 水体使用柔和浅蓝，作为除道路外最清晰的地理层级。
- 绿色只表达公园、草地等已由字段证据支持的植被类别，不把全部 `landuse` 统一染绿。
- 建筑使用接近背景的冷灰，保持城市密度但不压过道路。
- 道路使用 casing + fill 形成层级；普通道路以白色为主，主干道路可使用低饱和暖黄色。
- 行政边界和水道保持低对比，不形成覆盖全图的视觉网格。
- WebGPU 与 WebGL2 使用同一配置并保持肉眼一致。

## 起始色板

以下 token 是 T012 的实现起点；实现会话可基于真实截图做小幅明度/对比调整，但不得改变浅色、低饱和和语义用色方向。

| Token | 初始值 | 用途 |
| --- | --- | --- |
| `canvas` | `#F5F5F2` | 未被 Polygon 覆盖的一般土地/画布 |
| `water` | `#A9D7E8` | 湖泊、河面 |
| `waterway` | `#8CCBE2` | 河流线 |
| `landuseNeutral` | `#ECEDEB` | residential/commercial/industrial 等非植被 landuse |
| `vegetation` | `#DCEBD7` | grass/park 等已确认植被类别 |
| `building` | `#E1E3E5` | 建筑平面 |
| `roadCasing` | `#D4D7DA` | 普通道路外沿 |
| `roadFill` | `#FFFFFF` | 普通道路主体 |
| `majorRoadCasing` | `#E1C875` | motorway/trunk/primary 外沿 |
| `majorRoadFill` | `#F8E7AE` | motorway/trunk/primary 主体 |
| `boundary` | `#B9BEC4` | 行政边界候选色 |

## 图层层级

官方 Playground 至少按以下语义组织，数组顺序即渲染顺序：

1. 中性 landuse。
2. 植被 landuse。
3. water fill 与 waterway。
4. building fill，建议从高 zoom 显示。
5. 道路 casing。
6. 道路 fill，主干道路与普通道路分层。

T012 必须先从固定 fixture 和真实样本列出实际 `class/subclass/brunnel` 值，再确定过滤集合。research 只证明字段和部分样例存在，不能把未观察值写成已验证 schema。低 zoom 如需使用 `transportation`，必须记录对应样本和 zoom 行为。

## 规则网格水印边界

用户在 T009 自测中补充了截图证据：规则、重复的网格状水印覆盖绿色和白色地表，在水面区域没有该效果；放大到一定程度后持续可见。仓库代码未发现 `GridHelper`、显式 debug grid 或 watermark API，当前唯一大面积绿色配置是 Playground 的未过滤 `landuse: #365314`。

这些是用户观察和初步代码事实，不是根因结论。T011 必须在改变最终色板前区分：

- 材质纹理/UV、重复采样或透明叠加形成的规则水印；
- MVT Tile 边界裂缝或覆盖差异；
- 相邻 Tile transform/浮点精度问题；
- 透明 Polygon 叠加、render order 或抗锯齿伪影；
- Line 在 Tile 边缘的重复、断裂或错误连接；
- 全量 landuse 绿色造成的语义/视觉问题。

禁止仅把绿色改成背景色来宣称修复规则网格水印或 Tile seam。

## 视觉验收

- 在低、中、高 zoom 以及 pitch/bearing 场景中，画面整体为浅色且层级可辨。
- 不存在覆盖绿色/白色地表、与 XYZ Tile 边界对齐或贯穿视图的非预期规则网格水印或其他颜色网格。
- 绿色只对应经字段过滤的植被区域，不支配整个城市底图。
- 水体、建筑、普通道路和主干道路可在无文字条件下相互区分。
- WebGPU 与强制 WebGL2 截图在颜色、图层顺序和 seam 表现上肉眼一致。
- T012 保留 before/after 和双后端截图，最终视觉接受由人工负责人确认。
