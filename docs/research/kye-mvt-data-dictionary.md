# KYE MVT Source-Layer 数据字典

字段覆盖率格式为“字段出现数/该样本层 feature 数”。样本来自真实 KYE 瓦片，字段集合可能随地域和 zoom 变化。

## 主地图 source-layer

| layer | 真实样本 | Geometry | 字段与样例 | zoom/Style 用途 |
| --- | --- | --- | --- | --- |
| `landcover_0` | z5/26/12：4 | Polygon | `class:string`=`crop`，4/4 | 主 MVT 低 zoom；Style 未直接列同名 layer，代码/数据已确认 |
| `hillshade` | z5/26/12：303 | Polygon | `class:string`=`shadow` 303/303；`level:number`=`89` 303/303 | 主 MVT；本次 Style 51 层未直接引用，可能由底图版本/引擎内部使用 |
| `water` | z5：12；z12：102；z15：4 | Polygon | z12：`area:number`、`level:number`、`class:string`、`waterId:number` 均 102/102；`class` 样例 river/lake | Style `water`，zoom 7-24 |
| `waterway` | z5：4；z12：1；z15：1 | LineString | 低 zoom主 MVT仅 `class:string`；高 zoom样本 `dispclass:number`、`name:string`、`class:string`、`name_en:string` | Style `waterway`/`waterway_river`/`waterway_other` |
| `landuse` | z5：119；z12：126；z15：39 | Polygon | z12/z15：`area:string`、`level:number`、`osmId:string`、`class:string` 全样本；`subclass:string` 部分出现；样例 class=grass/residential | Style `landuse`、`landuse_grass`，minzoom 5 |
| `landuse_overlay` | z12：2 | Polygon | `area:string`、`level:number`、`class:string`，样例 national_park | 在样本中出现；当前 normal Style 未列同名 layer，需确认版本差异 |
| `road` | z12：6,484；z15：386 | LineString | `class/subclass:string` 全样本；`level:number` 全样本；`name/name_en:string` z12 6100/6484，z15 129/386；`id:string` z12 6477/6484；`brunnel:string`；`oneway/layer:number`；部分 `ref:string`、`letter:string`、`ref_length:number`、`rwcolor/service:string`；本次样本未观察到独立 `type` 字段 | Style road_stroke/road/road_primary/road_link/tunnel/ferry/road-label/road shield 等，zoom 5-24 分层 |
| `transportation` | z5：5,395 | LineString | `class:string`、`subclass:string`、`layer:number` 全样本，样例 trunk | Style `road_trunk_0`/`road_motorway_0`，zoom 5-7 |
| `building` | z15：233、z15 邻瓦片：389、z16：34 | Polygon | `kind:string` 全样本；`name:string` 207/233、178/200 等；`projection:string` 全样本=`LayerBuildingProjection(name=globe)`；`buildingId:number` 全样本；`height:number` 全样本（样本值 0-66） | Style `building3D` fill-extrusion，minzoom 15.6，排除 type=building:part |
| `poi_label` | z12：70；z15：17/29；z16：10 | Point | `level:number`、`cityCode:string`、`name:string`、`subclass:string`、`rank:number`、`short_name:string`、`class:string` 全样本；`osmId:string` 全样本 | Style `poi-label`、`poi_special_subway`、`poi_tourism`，minzoom 9-13+ |
| `place` | z5：325 | Point | `class:string`、`name:string`、`rank:number` 全样本；`iso_a2:string` 1/200；`capital:number` 30/200；样例 country/CN/中华人民共和国 | Style `place_china`、`place_sea`，zoom 0-24 |
| `boundary` | z5：655 | LineString | `admin_level:number`、`disputed:number`、`maritime:number`、`ogc_fid:number` 全样本；样例 admin_level=2、ogc_fid=501 | Style boundary_foreign/China，zoom 0-24 |
| `aoi` | 本次选定样本未出现 | Polygon（由 Style 过滤/类型确认） | 未取得真实字段样本；Style 使用 `name` 等表达式的情况需按瓦片补采 | Style `aoi` fill，14-24，默认 visibility none |
| `aoi_center` | 本次选定样本未出现 | Point（由 Style source-layer/符号用法确认） | 未取得真实字段样本 | Style `aoi_center` symbol，14-24，默认 none |

## 专用水系数据集

| dataset / layer | 样本 | Geometry | 字段与样例 | 状态 |
| --- | --- | --- | --- | --- |
| `kye_waterway/waterway` | z5：3 | LineString | `maxLevel:number`=5、`level:number`=4、`class:string`=river，均 3/3 | 已验证 |
| `kye_water/water` | z5：6 | Polygon | `maxLevel:number`=6、`level:number`=5、`class:string`=ocean，均 6/6 | 已验证 |
| `kye_water_ocean/water` | z7：47 | Polygon | `level:number`=7、`class:string`=ocean、`waterId:number`，均 47/47 | 已验证 |

无数据的专用瓦片可返回 HTTP 204；这是已观察到的正常响应。

## 行政区数据集

四个 dataset 的子图层结构一致：`area` Polygon、`border` LineString、`center` Point、`gov` Point。以下字段在真实样本中均出现，覆盖率为各样本子图层的 100%，但字段类型存在字符串/数字差异，不能强制统一为单一类型。

| dataset | level/tileType 样例 | area 主字段 | border 字段 | center/gov 字段 |
| --- | --- | --- | --- | --- |
| `kye_admin_pro` | level 1，tileType 10-12 | `admin_code:string`、`key_id:string`、`level:string`、`zone_code:string`、`district_name:string`、`tileType:number`、`full_name:string`、`depth:string`、`gov_x/gov_y:string`、`admin_name:string`、`district_id:string`、`name_simple:string`、`center_x/center_y:string` | `tileType:number`、`level:string` | `district_name`、`admin_code`、`tileType`、`level`、`admin_name`、`district_id`、`name_simple` |
| `kye_admin_city` | level 2，tileType 20/22 | 同上，样例 `admin_code=110100`、`full_name=北京北京市` | `tileType`、`level` | 同上 |
| `kye_admin_county` | level 3，tileType 30/31 | 同上，样例 `admin_code=110114`、`district_name=昌平区` | `tileType`、`level` | 同上 |
| `kye_admin_town` | level 4，tileType 40-43 | 同上，样例 `admin_code=110114004000`、`district_name=沙河地区` | `tileType`、`level` | 同上 |

## building 专项

- 样本瓦片：`z15/26978/12416`（233）、`z15/26979/12416`（389）、`z16/53957/24832`（34）等。
- `height`：在已采样建筑中 100% 出现，类型 number；观测值范围 `0..66`，常见 3/6/9，另见 18/26/30/34.5/43/47。
- `min_height`：已采样建筑中 0 个出现，类型/覆盖率因此为“未发现”，不是全量不存在证明。
- 顶层 MVT feature `id`：已采样建筑 0 个有值；业务唯一标识由 `buildingId:number` 提供。
- Geometry：MVT type=3（Polygon）。一个样本 feature 的 `loadGeometry()` 返回多个 ring，表示洞/多环编码可存在；未观察到独立 MultiPolygon 类型。
- `projection`：已采样全量均为 `LayerBuildingProjection(name=globe)` 字符串。

## Style 与数据字段映射

- 道路样式读取 `class`、`brunnel`、`ref_length`、`letter`、`ref`、`name` 等字段控制颜色、宽度、盾牌和文字。
- POI 样式读取 `class`、`subclass`、`rank`、`name`、`short_name`、`cityCode`。
- 行政区符号样式读取 `tileType`、`admin_name`、`district_name`、`name_simple`、`level`。
- 建筑 3D 样式只把 `height` 作为挤出高度来源，并过滤 `type != building:part`；样本 building 没有 `type` 字段，因此该过滤行为需继续核对服务器字段。
