/** Kmap 当前支持的渲染后端。 */
export type RenderBackend = 'webgpu' | 'webgl2' | 'unknown';

/** 图层属性和 MVT 字段允许保留的原始值。 */
export type LayerPropertyValue = string | number | boolean | null;

/** WGS84 经纬度，角度单位为 degree。 */
export interface LngLat {
  /** 经度；允许超出标准世界范围以表达横向 world wrap。 */
  lng: number;
  /** 纬度；进入 Web Mercator 投影时限制到有效范围。 */
  lat: number;
}

/** 地图公共视图状态。 */
export interface ViewState {
  /** 视图中心。 */
  center: LngLat;
  /** 连续缩放级别。 */
  zoom: number;
  /** 从正北开始顺时针旋转的角度。 */
  bearing: number;
  /** 从垂直俯视向地平线倾斜的角度。 */
  pitch: number;
}

/** 网络、解码和缓存共享的标准 XYZ Tile 标识。 */
export interface CanonicalTileKey {
  /** 数据源标识。 */
  sourceId: string;
  /** 整数数据层级。 */
  z: number;
  /** 已归一化到当前层级范围内的 X。 */
  x: number;
  /** 当前层级范围内的 Y。 */
  y: number;
}

/** 单个 XYZ MVT 数据源配置。 */
export interface VectorTileSourceOptions {
  /** 数据源唯一标识。 */
  id: string;
  /** 包含 `{z}`、`{x}`、`{y}` 的 URL 模板列表。 */
  tiles: readonly string[];
  /** 数据源真实存在的最小整数层级。 */
  minZoom: number;
  /** 数据源真实存在的最大整数层级。 */
  maxZoom: number;
  /** 随主瓦片加载的补充矢量层；超出原生层级时重投影祖先几何。 */
  overlays?: readonly TileOverlaySource[];
  /** 可选 WGS84 范围。 */
  bounds?: readonly [
    west: number,
    south: number,
    east: number,
    north: number,
  ];
}

export interface TileOverlaySource {
  tiles: readonly string[];
  minZoom: number;
  maxZoom: number;
  sourceLayer: string;
  targetLayer: string;
  /** 主源为空时加载该来源，提供具有实际几何的背景覆盖。 */
  onlyWhenPrimaryEmpty?: boolean;
}

/** MVP 图层属性过滤器。 */
export type LayerFilter =
  | { operator: 'has'; property: string }
  | {
      operator: '==' | '!=';
      property: string;
      value: LayerPropertyValue;
    }
  | {
      operator: 'in' | '!in';
      property: string;
      values: readonly LayerPropertyValue[];
    };

/** 所有公开地图图层共享的配置。 */
export interface BaseLayerOptions {
  id: string;
  sourceLayer: string;
  minZoom?: number;
  maxZoom?: number;
  filters?: readonly LayerFilter[];
}

/** Polygon fill 图层。 */
export interface FillLayerOptions extends BaseLayerOptions {
  type: 'fill';
  paint: {
    color: string | number;
    opacity?: number;
  };
}

/** 地图平面线图层，支持米制宽度与连续缩放函数。 */
export interface LineLayerOptions extends BaseLayerOptions {
  type: 'line';
  paint: {
    color: string | number;
    opacity?: number;
    width?: number;
    /** 默认米制；pixel 用于兼容显式像素样式。 */
    widthUnit?: 'meters' | 'pixels';
    /** 米制宽度随 zoom 作指数插值；省略时使用固定 width。 */
    widthStops?: readonly (readonly [zoom: number, width: number])[];
    widthBase?: number;
    /** 交替实线/空白长度，单位为当前线宽；支持 2 或 4 项。 */
    dashArray?: readonly number[];
  };
}

/** 瓦片内合批建筑挤出，源高度单位为真实米。 */
export interface ExtrusionLayerOptions extends BaseLayerOptions {
  type: 'fill-extrusion';
  paint: {
    color: string | number;
    heightProperty?: string;
    minHeightProperty?: string;
    colorProperty?: string;
    categoryColors?: Readonly<Record<string, string | number>>;
  };
}

/** MVT 文字按数据优先级、跨瓦片去重和屏幕碰撞布局。 */
export interface SymbolLayerOptions extends BaseLayerOptions {
  type: 'symbol';
  layout: { textFields?: readonly string[]; textSize?: number; priority?: number; rankProperty?: string; minZoomProperty?: string;
    priorityByClass?: Readonly<Record<string, number>>; iconByClass?: Readonly<Record<string, MapIcon>>; placement?: 'point' | 'line' };
  paint: { color?: string | number; colorByClass?: Readonly<Record<string, string | number>>; haloColor?: string | number; haloWidth?: number };
}
export type MapLayerOptions = FillLayerOptions | LineLayerOptions | ExtrusionLayerOptions | SymbolLayerOptions;

/** 单层或分类文字的运行时样式，像素单位与屏幕布局一致。 */
export interface LabelStyle {
  color?: string | number; haloColor?: string | number; haloWidth?: number; textSize?: number; visible?: boolean;
  icon?: MapIcon | 'none' | 'auto'; iconColor?: string | number; iconSize?: number; iconGap?: number;
}
export type MapIcon = 'metro' | 'airport' | 'hospital' | 'school' | 'park' | 'museum' | 'food' | 'shop' | 'hotel';
export interface LabelAppearance {
  sizeScale?: number; haloWidth?: number; maxLabels?: number; icons?: boolean;
  layers?: Readonly<Record<string, LabelStyle>>;
  categories?: Readonly<Record<string, LabelStyle>>;
}
/** 全地图基础色映射；省略的基础色保留其原始值。 */
export interface MapElementStyle { color?: string | number; opacity?: number; visible?: boolean; widthScale?: number; heightScale?: number }
export interface MapTheme {
  backgroundColor: string | number; landColor?: string | number; fogColor?: string | number;
  colors?: Readonly<Record<string, string | number>>;
  /** 键为图层 id；建筑分类键为 `图层id/分类值`。 */
  elements?: Readonly<Record<string, MapElementStyle>>;
}

/** SDK 结构化错误代码。 */
export type MapErrorCode =
  | 'INVALID_ARGUMENT'
  | 'INITIALIZE_FAILED'
  | 'MAP_DISPOSED'
  | 'SOURCE_ERROR'
  | 'NETWORK_ERROR'
  | 'HTTP_ERROR'
  | 'DECODE_ERROR'
  | 'GEOMETRY_ERROR'
  | 'WORKER_ERROR'
  | 'RENDERER_LOST'
  | 'RESOURCE_LIMIT';

/** SDK 错误发生阶段。 */
export type MapErrorPhase =
  | 'initialize'
  | 'request'
  | 'decode'
  | 'build'
  | 'upload'
  | 'render'
  | 'dispose';

/** 可通过事件或内部错误对象传递的结构化错误。 */
export interface MapError {
  code: MapErrorCode;
  message: string;
  phase: MapErrorPhase;
  recoverable: boolean;
  tileKey?: CanonicalTileKey;
  cause?: unknown;
}

/** SDK 视口尺寸。 */
export interface ViewportSize {
  /** CSS 像素宽度。 */
  width: number;
  /** CSS 像素高度。 */
  height: number;
  /** 设备像素比，SDK 会限制到合理范围。 */
  pixelRatio?: number;
}

/** 当前运行时的最小诊断统计。 */
export interface MapRuntimeStats {
  backend: RenderBackend;
  frame: {
    lastMs: number;
    p95Ms: number;
  };
  tiles: {
    visible: number;
    queued: number;
    fetching: number;
    decoding: number;
    building: number;
    ready: number;
    empty: number;
    failed: number;
  };
  resources: {
    cpuBytes: number;
    gpuBytes: number;
    batches: number;
    features: number;
    vertices: number;
    indices: number;
    objects: number;
  };
  workers: {
    active: number;
    queued: number;
  };
}

/** Map3D 0.1 typed event 集合。 */
export interface MapEventMap {
  load: { backend: RenderBackend };
  viewchange: { view: ViewState };
  idle: { stats: MapRuntimeStats };
  error: MapError;
  stats: MapRuntimeStats;
}

/** Map3D 0.1 启动参数。 */
export interface Map3DOptions {
  /** 承载渲染结果的 Canvas。 */
  canvas: HTMLCanvasElement;
  /** 当前实例使用的单个 MVT Source。 */
  source: VectorTileSourceOptions;
  /** 按顺序渲染的 fill/line 与建筑挤出图层。 */
  layers: readonly MapLayerOptions[];
  /** 标准 SDF glyph PBF 资源；按需加载 256 字符的 range。 */
  labels?: { glyphs: string; fontStack: string; maxLabels?: number };
  /** minZoom=0 的源在低缩放显示地球；默认启用，全缩放采用球面投影。 */
  globe?: boolean;
  renderer?: {
    /** 是否强制使用 WebGL2 后端。 */
    forceWebGL?: boolean;
    /** 多重采样抗锯齿；强制 WebGL2 默认关闭，线和文字具有解析抗锯齿。 */
    antialias?: boolean;
    /** 空场景背景色。 */
    backgroundColor?: string | number;
    /** 设备像素比上限。 */
    maxPixelRatio?: number;
  };
  /** Tile Runtime byte/entry cache 预算。 */
  cache?: {
    maxCpuBytes?: number;
    maxGpuBytes?: number;
    maxTileEntries?: number;
  };
  /** 初始视图状态；未提供字段使用 SDK 默认值。 */
  view?: Partial<ViewState>;
}
