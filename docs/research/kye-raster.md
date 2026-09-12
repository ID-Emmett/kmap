# Raster 数据与样式

## KYE Raster

生产配置：`src/mapbox/base_config/normal_raster_prod.js`。

```text
https://tiles.kye-erp.com/maptile-dispatch/data/kye_raster_tiles?tileTemplateName=normal&z={z}&x={x}&y={y}
https://tiles0.kye-erp.com/maptile-dispatch/data/kye_raster_tiles?tileTemplateName=normal&z={z}&x={x}&y={y}
https://tiles1.kye-erp.com/maptile-dispatch/data/kye_raster_tiles?tileTemplateName=normal&z={z}&x={x}&y={y}
https://tiles2.kye-erp.com/maptile-dispatch/data/kye_raster_tiles?tileTemplateName=normal&z={z}&x={x}&y={y}
https://tiles3.kye-erp.com/maptile-dispatch/data/kye_raster_tiles?tileTemplateName=normal&z={z}&x={x}&y={y}
```

Style source `kye_raster_road_source` 为 `raster`、`tileSize:256`、zoom 0-18，layer `kye_raster_road_layer` 为 raster。

真实请求 `z5/26/12`：HTTP 200，`Content-Type: image/png; charset=UTF-8`，56,014 bytes，PNG 尺寸 512x512。tiles0、tiles1、tiles2、tiles3 节点均返回成功。配置的 256 tileSize 与实际 512 PNG 需在 nova 中保留并验证 DPR/缩放表现。

## 高德道路 Raster

`src/mapbox/base_config/gaode_base.js`（桌面）和 `gaode_base_mobile.js` 使用：

```text
//webrd01..04.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}
```

样式名称 `gaode`，raster layer zoom 0-18。Map.js 将 `styleType: 'gaode'` 视为 AMap 混合引擎初始化条件之一；默认仍会先创建 Mapbox Map，再由 `CreateAMap`/`resetMapStyle` 切换。

## 高德简洁与卫星

- `gaode_simp.js`：`webst01..04`，`appmaptile`，style=7，道路/简洁底图。
- `weixing_base.js`：两组栅格叠加：
  - `webst01..04`，style=6，卫星影像；
  - `wprd01..04`，style=8，道路覆盖；
  两个 raster layer 均 zoom 0-22。
- `normal-preload.js` 的 `google-image` source：`webst01..04` style=6，zoom 0-18，作为 normal 预加载样式中的卫星源。

上述高德 appmaptile URL 均为代码已确认；本次真实验证集中在 KYE Raster，未对每一个高德节点和 style 逐一取图。

## 其他外部 Raster 配置

- `src/mapbox/base_config/tencent_base.js`：`//apis.map.qq.com/maptile/base/hdmt?x={x}&y={y}&z={z}&key=...`，raster，zoom 0-18；配置内含腾讯 key，使用前需重新确认凭证管理与授权。
- `src/mapbox/base_config/baidu_base.js`：`//maponline0..3.bdimg.com/tile/?qt=vtile&x={x}&y={y}&z={z}&styles=pl&scaler=1&udt=20220913&from=jsapi2_0`，raster，zoom 0-18。

两者均为代码已确认，未在本次网络验证中取图；它们不是 KYE 原始矢量数据入口。

## Raster 选择与切换

`src/mapbox/utils/utils.js:getKyemapStyle`：

- `normal-raster` -> `normal_raster_prod.js`；
- `gaode` -> `gaode_base.js`/移动端变体；
- `weixing` -> `weixing_base.js`/移动端变体；
- `normal-preload` -> 内置 Style 对象；
- `normal` -> 生产 Style URL。

`src/mapbox/core/Map.js:resetMapStyle` 在切换样式后重新挂载业务图层；`RASTER_STYLE_LIST=['gaode','weixing']` 会影响云层/KYE 建筑模型等附加能力。

## 复用建议

- nova 若需要可离线缓存，优先复用 KYE Raster URL 模板并按 z/x/y 做 HTTP 缓存；不要把 512 PNG 误当成 MVT。
- Raster 不携带可查询属性；Picking、建筑高度和 POI 必须使用 MVT/业务数据或独立接口。
- 高德底图的许可、跨域、配额和长期可用性在当前环境中仍属待验证。
