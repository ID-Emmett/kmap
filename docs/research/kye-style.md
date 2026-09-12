# KYE Style `normal.json`

## 元数据

- URL：`https://tiles.kye-erp.com/maptiles/styles/v3/normal.json`
- HTTP：200；约 93,299 bytes。
- Style version：8；name：`normal`；id：`nu83k9u`。
- Glyph：`https://tiles.kye-erp.com/maptiles/fonts/{fontstack}/{range}.pbf`。
- Sprite：`https://tiles.kye-erp.com/maptiles/styles/v3/sprite-normal`。
- 51 个 layers，类型包含 `background`、`line`、`fill`、`fill-extrusion`、`symbol`。

## Sources

| source | type | min/max zoom | source-layer/用途 |
| --- | --- | --- | --- |
| `openmaptiles` | vector | 0-17 | waterway/aoi/landuse/water/aeroway/road/building/boundary/transportation/place/poi_label/aoi_center |
| `kye_waterway` | vector | 0-6 | waterway |
| `kye_water` | vector | 0-6 | water |
| `kye_water_ocean` | vector | 7-7 | water |
| `google-image` | raster | 0-18 | 高德卫星 appmaptile style=6 |
| `admin_pro` | vector | 0-14 | border/center/gov |
| `admin_city` | vector | 0-14 | gov |
| `admin_county` | vector | 0-14 | gov |
| `admin_town` | vector | 0-14 | gov |

所有 KYE vector source 的 `tiles` 均是 tiles0..tiles3 对应路径；`google-image` 是 webst01..04 高德卫星栅格。

## 51 个 layers

表中 `z` 是实际 Style 的 minzoom-maxzoom；空值表示未设置上界/下界。filter 只列主要条件，完整 JSON 以线上 Style 为准。

| id | type | source/source-layer | z | 主要 filter/layout/paint |
| --- | --- | --- | --- | --- |
| background | background | - | - | 背景色 stops 3/10 |
| waterway_ocean | line | kye_waterway/waterway | 2.5-8.5 | class=ocean |
| waterway_river | line | openmaptiles/waterway | 7-17 | class=river |
| waterway_river_low | line | kye_waterway/waterway | 0-7 | 低 zoom 水道 |
| waterway_other | line | openmaptiles/waterway | - | class!=river |
| aoi | fill | openmaptiles/aoi | 14-24 | visibility none |
| landuse | fill | openmaptiles/landuse | 5- | class/level 过滤，match fill-color |
| landuse_grass | fill | openmaptiles/landuse | 5- | class=grass |
| waterway | line | openmaptiles/waterway | 8- | geometry-type LineString、class |
| water | fill | openmaptiles/water | 7-24 | class/area |
| water-lake | fill | kye_water/water | 4-7 | class=lake |
| water_ocean | fill | kye_water/water | 0-7 | class=ocean |
| water_ocean_high | fill | kye_water_ocean/water | 7-24 | class=ocean |
| aeroway-polygon | fill | openmaptiles/aeroway | 10- | Polygon、type |
| aeroway-line | line | openmaptiles/aeroway | 9- | LineString、type |
| road_stroke | line | openmaptiles/road | 9- | geometry/class/brunnel/zoom step |
| road | line | openmaptiles/road | 10- | class/brunnel |
| road_primary | line | openmaptiles/road | 10- | primary/urban classes |
| road_link | line | openmaptiles/road | 9- | motorway_link/trunk_link |
| road_trunk1 | line | openmaptiles/road | 7- | class=trunk |
| road_motorway1 | line | openmaptiles/road | 7- | class=motorway |
| tunnel | line | openmaptiles/road | 10- | brunnel=tunnel |
| ferry | line | openmaptiles/road | 9- | class=ferry |
| building3D | fill-extrusion | openmaptiles/building | 15.6-24 | type!=building:part；height 挤出 |
| light_rail | line | openmaptiles/road | 10- | class=light_rail |
| water_name_line | symbol | openmaptiles/waterway | 12- | $type=LineString |
| rail_border | line | openmaptiles/road | 9- | class=rail |
| rail_dash | line | openmaptiles/road | 9- | class=rail |
| boundary_foreign_inside | line | openmaptiles/boundary | 3-10 | admin_level 3/4 |
| boundary_foreign | line | openmaptiles/boundary | - | admin_level 2、ogc_fid |
| road_trunk_0 | line | openmaptiles/transportation | 6-7 | class=trunk |
| road_motorway_0 | line | openmaptiles/transportation | 5-7 | class=motorway |
| place_china | symbol | openmaptiles/place | 0-2 | class=country |
| place_sea | symbol | openmaptiles/place | 2.7-24 | class=sea |
| boundary_china | line | openmaptiles/boundary | 0-24 | admin_level=2、ogc_fid=500 |
| admin-state-province | line | admin_pro/border | 2- | level=1 |
| road_shield_motorway | symbol | openmaptiles/road | 7-24 | ref_length/class/letter |
| road-label | symbol | openmaptiles/road | 15- | zoom/class；text name；Microsoft YaHei |
| road_shield_trunk_x | symbol | openmaptiles/road | 9-24 | class=trunk、letter=X |
| road_shield_trunk | symbol | openmaptiles/road | 10-24 | class=trunk、letter in G/S |
| light_rail_name | symbol | openmaptiles/road | 12- | class=light_rail |
| place-neighborhood-suburb-label | symbol | admin_town/gov | 9-14 | tileType 41/42 |
| poi-label | symbol | openmaptiles/poi_label | 9- | class/subclass/rank/name 长度 |
| poi_special_subway | symbol | openmaptiles/poi_label | 13- | subclass subway |
| poi_tourism | symbol | openmaptiles/poi_label | 10- | subclass viewpoint/rank |
| aoi_center | symbol | openmaptiles/aoi_center | 14-24 | visibility none |
| place-town-village-hamlet-label | symbol | admin_county/gov | 8-12 | tileType 31-34 |
| state-label | symbol | admin_pro/center | 3-4 | level=1 |
| place-city-label2 | symbol | admin_pro/gov | 4-10 | 香港/澳门/台湾 |
| place-city-label | symbol | admin_city/gov | 4-10 | tileType/zoom |
| place_beijing | symbol | admin_pro/center | 2-4 | name_simple=北京 |

## `building3D` 细节

线上 Style 的完整关键片段：

```json
{
  "type": "fill-extrusion",
  "source": "openmaptiles",
  "source-layer": "building",
  "minzoom": 15.6,
  "maxzoom": 24,
  "filter": ["all", ["!=", ["get", "type"], "building:part"]],
  "paint": {
    "fill-extrusion-color": "#FFFFFF",
    "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 15, ["*", ["get", "height"], 1], 16, ["*", ["get", "height"], 1]],
    "fill-extrusion-opacity": ["interpolate", ["linear"], ["zoom"], 13.5, 0, 15, 0.2, 15.5, 0.2, 16, 0.25],
    "fill-extrusion-vertical-gradient": false
  }
}
```

Style 使用 `height` 只能证明表达式依赖该字段，真实字段覆盖率见 [kye-mvt-data-dictionary.md](./kye-mvt-data-dictionary.md)。

## 表达式统计

对线上 Style JSON 递归统计到的实际操作符：

| 操作符 | 次数 | 操作符 | 次数 |
| --- | ---: | --- | ---: |
| `get` | 228 | `match` | 156 |
| `==` | 54 | `all` | 51 |
| `zoom` | 51 | `interpolate` | 31 |
| `step` | 19 | `<=` | 19 |
| `geometry-type` | 10 | `!=` | 9 |
| `literal` | 8 | `case` | 7 |
| `in` | 5 | `<` | 5 |
| `!in` | 4 | `any` | 4 |
| `>=` | 5 | `>` | 未发现 |
| `has` | 未发现 | `id` | 未发现 |

线上 Style 还实际使用了任务列表未列出的 `+`、`length`、`coalesce`、`exponential`、`cubic-bezier` 等。这里的次数是该 Style 的使用统计，不是 Mapbox 表达式引擎的理论支持列表。

## Style 加载代码

- `src/mapbox/utils/utils.js:getKyemapStyle` 选择生产/测试 URL、内置对象和高德/卫星样式。
- `src/mapbox/core/Map.js` 构造 `style`、`minZoom/maxZoom`、projection、accessToken，并由父类 Mapbox GL JS 加载 Style。
- `src/mapbox/core/Map.js:resetMapStyle` 在样式切换后重新挂载业务 Overlay、交通层和 KYE 建筑模型。
