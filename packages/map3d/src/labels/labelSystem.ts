import { iconCode, iconGlyphs } from './icons.js';
import { measureGlyphRun } from './glyphRun.js';
import type { MapPalette } from '../style/palette.js';
import { facesCamera, projectMapPoint, type ProjectionState } from '../globe/projection.js';
import { Vector3, type PerspectiveCamera, type Scene } from 'three/webgpu';
import type { LabelAppearance, Map3DOptions, ViewportSize, ViewState } from '../types.js';
import type { MapOrigin } from '../spatial/types.js';
import { tileBounds, type Address } from '../streaming/address.js';
import type { TileSurfaces } from '../streaming/surface.js';
import { CollisionGrid, type LabelBox } from './collision.js';
import type { LabelCandidate } from './candidates.js';
import { GlyphAtlas, type AtlasGlyph } from './glyphAtlas.js';
import { GLYPH_BORDER, GLYPH_EM } from './glyphs.js';
import { LabelSurface, type GlyphQuad } from './labelSurface.js';
import { SymbolPlacement } from './symbolPlacement.js';

interface Projected { score: number; label: LabelCandidate; id: string; x: number; y: number; worldX: number; worldY: number; endWorldX: number; endWorldY: number; angle: number; length: number }
/** 投影队列中的瓦片快照：布局跨帧进行，队列只保留投影所需的不可变输入。 */
interface LayoutTile { address: Address; cells: readonly Address[]; labels: readonly LabelCandidate[] }
/** 放置阶段的跨帧状态：碰撞网格、已选集合与字形批次在多帧间累计。 */
interface PlacementState { grid: CollisionGrid; quads: GlyphQuad[]; selected: Set<string>; runs: Map<string, GlyphQuad[]>; names: Map<string, { x: number; y: number }[]>; maxLabels: number }
/** 每帧布局预算（毫秒）：整轮布局按此预算分摊到多帧。 */
const LAYOUT_BUDGET_MS = .6;
/**
 * 每轮投影的候选总量与单个瓦片的投影上限。
 * 投影是布局的主要成本，总量决定单轮耗时；分片只改变峰值形状，不改变总量。
 */
const PROJECTION_BUDGET = 2000;
const CANDIDATE_LIMIT = 800;
/** 字形加载、稳定碰撞与一个全局文字批次共用有界生命周期。 */
export class LabelSystem {
  readonly atlas: GlyphAtlas; readonly surface: LabelSurface;
  private appearance: LabelAppearance = {};
  private styleRevision = 0;
  private styledCache = new WeakMap<LabelCandidate, LabelCandidate | undefined>();
  private lastView: ViewState | undefined;
  private lastTileZoom = -1;
  private lastRevision = -1;
  private lastStyleRevision = -1;
  private lastViewport = '';
  private lastLayout = -Infinity; private atlasRevision = -1;
  /** 最近一次布局输入；与 sameLayoutInputs 写入同一批数值，避免字符串签名。 */
  private readonly layoutInputs = { revision: -1, tileZoom: -1, lng: NaN, lat: NaN, zoom: NaN, bearing: NaN, pitch: NaN, width: NaN, height: NaN };
  private readonly retained = new Set<string>(); private batchOrigin = { x: 0, y: 0 };
  /** 最近一次写入顶点数据时的基准；与 batchOrigin 不一致表示渲染基准被提前切换。 */
  private readonly writtenBasis = { x: 0, y: 0 };
  private readonly births = new Map<string, number>();
  private readonly anchors = new Map<string, { x: number; y: number; at: number }>();
  private readonly retainedPoints = new Map<string, { label: LabelCandidate; x: number; y: number; seen: number }>();
  private retentionUntil = Infinity;
  private readonly placement = new SymbolPlacement();
  private readonly point = new Vector3(); private readonly end = new Vector3();
  candidates = 0; placed = 0; layoutMs = 0; layouts = 0;
  /** 分阶段累计耗时（毫秒）：投影、放置与图集刷新，用于定位布局成本来源。 */
  projectMs = 0; placeMs = 0; atlasMs = 0;
  /** 当前浮动原点；渲染基准误差以它为准核算。 */
  private readonly currentOrigin = { x: 0, y: 0 };
  /**
   * 布局分片状态：一轮布局分为投影与放置两个阶段，每阶段按每帧预算跨越若干帧。
   * 集中执行会让布局帧出现数毫秒的峰值，从而跨过刷新档位；分片后每帧只承担亚毫秒增量。
   */
  private phase: 0 | 1 | 2 = 0;
  private readonly queue: LayoutTile[] = [];
  private queueIndex = 0;
  private readonly buckets = new Map<number, Projected[]>();
  private pending: Projected[] = [];
  private pendingIndex = 0;
  private placedState: PlacementState | undefined;
  private availableIds: ReadonlySet<string> = new Set();
  private layoutPerTile = 64;
  private layoutStartedAt = 0;
  private layoutTravel = Infinity;
  private layoutOrigin = { x: 0, y: 0 };
  private layoutViewport = { width: 0, height: 0 };
  private fogEnd = Infinity;
  constructor(readonly options: NonNullable<Map3DOptions['labels']>, private readonly scene: Scene) {
    this.atlas = new GlyphAtlas(options); this.surface = new LabelSurface(this.atlas); scene.add(this.surface.mesh);
    this.atlas.pages.set(0xe0, iconGlyphs());
  }
  invalidate(): void { this.styleRevision++; this.styledCache = new WeakMap(); this.retainedPoints.clear(); this.retentionUntil = Infinity; this.placement.clear(); }
  setStyle(style: LabelAppearance): void {
    this.appearance = { ...style, sizeScale: Math.max(.5, Math.min(2, style.sizeScale ?? 1)), maxLabels: Math.max(1, Math.min(512, style.maxLabels ?? this.options.maxLabels ?? 256)) };
    this.invalidate();
  }
  /** 布局输入完全一致时可复用上一次布局结果。 */
  private sameLayoutInputs(revision: number, tileZoom: number, view: ViewState, viewport: ViewportSize): boolean {
    const inputs = this.layoutInputs;
    return inputs.revision === revision && inputs.tileZoom === tileZoom && inputs.lng === view.center.lng && inputs.lat === view.center.lat
      && inputs.zoom === view.zoom && inputs.bearing === view.bearing && inputs.pitch === view.pitch
      && inputs.width === viewport.width && inputs.height === viewport.height;
  }
  private lastLayoutInputs(revision: number, tileZoom: number, view: ViewState, viewport: ViewportSize): void {
    const inputs = this.layoutInputs;
    inputs.revision = revision; inputs.tileZoom = tileZoom; inputs.lng = view.center.lng; inputs.lat = view.center.lat;
    inputs.zoom = view.zoom; inputs.bearing = view.bearing; inputs.pitch = view.pitch;
    inputs.width = viewport.width; inputs.height = viewport.height;
  }
  private styled(label: LabelCandidate): LabelCandidate | undefined {
    if (this.styledCache.has(label)) return this.styledCache.get(label);
    const style = { ...this.appearance.layers?.[label.layerId ?? ''], ...this.appearance.categories?.[label.category ?? ''] };
    if (style.visible === false) return;
    const palette = this.scene.userData.mapPalette as MapPalette | undefined;
    const color = style.color ?? palette?.resolve(label.color) ?? label.color, haloColor = style.haloColor ?? palette?.haloColor ?? label.haloColor;
    const result = { ...label, color, haloColor,
      size: Math.max(8, Math.min(40, (style.textSize ?? label.size) * (this.appearance.sizeScale ?? 1))),
      haloWidth: Math.max(0, Math.min(4, style.haloWidth ?? this.appearance.haloWidth ?? label.haloWidth)),
      iconColor: style.iconColor ?? label.iconColor ?? color, iconSize: Math.max(8, Math.min(32, style.iconSize ?? label.iconSize ?? label.size)), iconGap: Math.max(0, Math.min(16, style.iconGap ?? 4)),
      icon: this.appearance.icons === false || style.icon === 'none' ? undefined : style.icon === 'auto' ? label.icon : style.icon ?? label.icon };
    this.styledCache.set(label, result); return result;
  }
  update(surfaces: TileSurfaces, camera: PerspectiveCamera, origin: MapOrigin, view: ViewState, tileZoom: number,
    viewport: ViewportSize, revision: number, now: number, fogEnd: number): void {
    if (this.appearance.visible === false) {
      if (this.surface.count) this.surface.write([]);
      this.placed = this.candidates = 0; this.phase = 0; return;
    }
    this.currentOrigin.x = origin.meters.x; this.currentOrigin.y = origin.meters.y;
    this.surface.origin.value.set(origin.meters.x - this.batchOrigin.x, 0, this.batchOrigin.y - origin.meters.y);
    this.surface.clock.value = now / 1000;
    this.surface.pixelRatio.value = viewport.pixelRatio ?? 1;
    this.surface.viewport.value.set(viewport.width, viewport.height);
    const atlasStarted = performance.now(); this.atlas.tick(); this.atlas.flush(); this.atlasMs += performance.now() - atlasStarted;
    this.fogEnd = fogEnd;
    // 首轮布局不分片：屏幕上还没有任何文字时，跨帧分摊会让首屏长时间空白。
    const budgetMs = this.layouts === 0 ? Infinity : LAYOUT_BUDGET_MS;
    // 一轮布局跨多帧完成：只有空闲状态才判断是否需要新一轮。
    if (this.phase === 0 && !this.needsLayout(view, tileZoom, viewport, revision, now)) return;
    if (this.phase === 0) this.beginLayout(surfaces, view, tileZoom, viewport, revision, now, origin);
    // 每帧只消耗固定预算：整轮布局的毫秒级峰值被摊平为多帧的亚毫秒增量。
    const budget = performance.now() + budgetMs;
    if (this.phase === 1) {
      const projectionStarted = performance.now();
      while (this.queueIndex < this.queue.length) {
        this.projectTile(this.queue[this.queueIndex++]!, camera, origin, viewport, fogEnd, tileZoom);
        if (performance.now() >= budget) break;
      }
      this.projectMs += performance.now() - projectionStarted;
      if (this.queueIndex < this.queue.length) return;
      this.finishProjection(camera, origin, viewport, tileZoom, now); this.phase = 2;
    }
    if (this.phase === 2) {
      const state = this.placedState!;
      const deadline = performance.now() + budgetMs;
      const placementStarted = performance.now();
      while (this.pendingIndex < this.pending.length && state.selected.size < state.maxLabels && state.quads.length < 8000) {
        this.placeCandidate(this.pending[this.pendingIndex++]!, state, now);
        if (performance.now() >= deadline) break;
      }
      this.placeMs += performance.now() - placementStarted;
      if (this.pendingIndex < this.pending.length && state.selected.size < state.maxLabels && state.quads.length < 8000) return;
      this.commitPlacement(state, origin, now); this.phase = 0;
    }
  }
  /**
   * 渲染基准诊断：`committed` 是已提交文字批次的顶点基准（米），`error` 是渲染补偿与该基准的偏差（米）。
   * 基准只在提交时随顶点数据一起切换；布局进行中必须保持，否则仍在显示的上批文字会整体错位。
   */
  get basis(): { committed: { x: number; y: number }; written: { x: number; y: number }; error: number; mismatch: number } {
    return { committed: { x: this.batchOrigin.x, y: this.batchOrigin.y }, written: { x: this.writtenBasis.x, y: this.writtenBasis.y },
      error: Math.hypot(this.surface.origin.value.x - (this.currentOrigin.x - this.batchOrigin.x),
        this.surface.origin.value.z - (this.batchOrigin.y - this.currentOrigin.y)),
      mismatch: Math.hypot(this.batchOrigin.x - this.writtenBasis.x, this.batchOrigin.y - this.writtenBasis.y) };
  }
  /** 空闲状态下判断是否需要开启新一轮布局。 */
  private needsLayout(view: ViewState, tileZoom: number, viewport: ViewportSize, revision: number, now: number): boolean {
    // 视图与依赖条件完全相同直接复用；数值比较避免逐帧拼接签名字符串。
    if (this.lastStyleRevision === this.styleRevision && this.sameLayoutInputs(revision, tileZoom, view, viewport)
      && this.atlasRevision === this.atlas.revision && now < Math.min(this.retentionUntil, this.placement.expires)) return false;
    const last = this.lastView;
    let travel = Infinity;
    if (last !== undefined) {
      travel = Math.hypot((view.center.lng - last.center.lng) * Math.cos(view.center.lat * Math.PI / 180), view.center.lat - last.center.lat) * 256 * 2 ** view.zoom / 360;
      const zoomDelta = Math.abs(view.zoom - last.zoom), bearingDelta = Math.abs(view.bearing - last.bearing), pitchDelta = Math.abs(view.pitch - last.pitch);
      // 小于碰撞安全边距的移动由顶点投影逐帧跟随，布局按累计位移更新。
      if (this.lastTileZoom === tileZoom && this.lastRevision === revision && this.lastStyleRevision === this.styleRevision
        && this.atlasRevision === this.atlas.revision && this.lastViewport === `${viewport.width}:${viewport.height}`
        && travel < 8 && zoomDelta < .025 && bearingDelta < 1 && pitchDelta < 1 && now < Math.min(this.retentionUntil, this.placement.expires)) return false;
    }
    // 快速运动期间降低布局频率，静止后恢复完整精度。
    this.layoutTravel = travel;
    if (now - this.lastLayout < (travel >= 24 ? 96 : 64)) return false;
    return true;
  }
  /** 开启新一轮：登记本轮输入与投影队列，实际工作由后续帧分片执行。 */
  private beginLayout(surfaces: TileSurfaces, view: ViewState, tileZoom: number, viewport: ViewportSize, revision: number, now: number, origin: MapOrigin): void {
    this.lastView = view; this.lastTileZoom = tileZoom; this.lastRevision = revision; this.lastStyleRevision = this.styleRevision;
    this.lastViewport = `${viewport.width}:${viewport.height}`;
    this.lastLayoutInputs(revision, tileZoom, view, viewport);
    this.layoutStartedAt = performance.now(); this.lastLayout = now; this.atlasRevision = this.atlas.revision;
    // 按可见来源公平分配投影预算；数据优先级已在 Worker 排序。快速运动时减半。
    const fullBudget = Math.max(16, Math.min(128, Math.ceil(PROJECTION_BUDGET / Math.max(1, surfaces.instances.size))));
    this.layoutPerTile = this.layoutTravel >= 24 ? Math.max(16, fullBudget >> 1) : fullBudget;
    // 只登记本轮顶点基准；渲染基准 batchOrigin 与补偿必须等到提交时与顶点数据同时切换，
    // 否则跨帧布局期间仍在显示的上批文字会被按新基准补偿，整批错位一个浮动原点跨度。
    // 只登记本轮顶点基准；渲染基准 batchOrigin 与补偿必须等到提交时与顶点数据同时切换，
    // 否则跨帧布局期间仍在显示的上批文字会被按新基准补偿，整批错位一个浮动原点跨度。
    this.layoutOrigin = { ...origin.meters };
    this.layoutViewport = { width: viewport.width, height: viewport.height };
    this.queue.length = 0; this.queueIndex = 0;
    for (const instance of surfaces.instances.values())
      this.queue.push({ address: instance.address, cells: instance.cells, labels: instance.resource.labels });
    this.buckets.clear(); this.phase = 1;
  }
  /** 单个瓦片的候选投影：逐瓦片推进使每帧投影量受预算约束。 */
  private projectTile(tile: LayoutTile, camera: PerspectiveCamera, origin: MapOrigin, viewport: ViewportSize, fogEnd: number, tileZoom: number): void {
    const address = tile.address, bounds = tileBounds(address);
    const projection = this.scene.userData.mapProjection as ProjectionState | undefined;
    const point = this.point, end = this.end, perTile = this.layoutPerTile;
    let pointCount = 0, lineCount = 0;
    for (const raw of tile.labels) {
        if (tileZoom < raw.minZoom || tileZoom >= raw.maxZoom) continue;
        const used = raw.line ? lineCount++ : pointCount++;
        if (used >= perTile && !this.retained.has(raw.key)) continue;
        const label = this.styled(raw); if (!label) continue;
        if (tileZoom < label.minZoom || tileZoom >= label.maxZoom || !ownsAnchor(address, tile.cells, label.x, label.y)) continue;
        let x = bounds.west + label.x * bounds.span, y = bounds.north - label.y * bounds.span;
        const id = label.key, previous = this.anchors.get(id);
        const endWorldX = bounds.west + label.endX * bounds.span, endWorldY = bounds.north - label.endY * bounds.span;
        if (previous && !label.line && Math.hypot(previous.x - x, previous.y - y) < bounds.span / 32) { x = previous.x; y = previous.y; }
        point.set(x - origin.meters.x, 0, origin.meters.y - y);
        if (projection) { if (!facesCamera(point, camera.position, projection)) continue; projectMapPoint(point, projection); }
        if (point.distanceTo(camera.position) > fogEnd * .9) continue;
        point.project(camera); if (point.z < -1 || point.z > 1 || Math.abs(point.x) > 1.1 || Math.abs(point.y) > 1.1) continue;
        const screenX = (point.x + 1) * viewport.width / 2, screenY = (1 - point.y) * viewport.height / 2;
        let angle = 0, length = Infinity;
        if (label.line) {
          end.set(endWorldX - origin.meters.x, 0, origin.meters.y - endWorldY);
          if (projection) projectMapPoint(end, projection); end.project(camera);
          const dx = (end.x - point.x) * viewport.width / 2, dy = -(end.y - point.y) * viewport.height / 2;
          angle = Math.atan2(dy, dx); if (angle > Math.PI / 2) angle -= Math.PI; if (angle < -Math.PI / 2) angle += Math.PI;
          length = Math.hypot(dx, dy) * 2;
          if (length < pTextWidth(label)) continue;
        }
        const score = label.priority - (this.retained.has(id) ? 1000 : 0);
        const cell = Math.floor(screenX / 48) + Math.floor(screenY / 48) * 65536;
        const bucket = this.buckets.get(cell) ?? [];
        const candidate = { score, label, id, x: screenX, y: screenY, worldX: x, worldY: y, endWorldX, endWorldY, angle, length };
        if (bucket.length < 4) bucket.push(candidate);
        else { let worst = 0; for (let i = 1; i < bucket.length; i++) if (bucket[i]!.score > bucket[worst]!.score) worst = i;
          if (score < bucket[worst]!.score || score === bucket[worst]!.score && id < bucket[worst]!.id) bucket[worst] = candidate; }
        this.buckets.set(cell, bucket);
      }
  }
  /** 投影阶段结束：汇总候选、补齐保留锚点并准备放置状态。 */
  private finishProjection(camera: PerspectiveCamera, origin: MapOrigin, viewport: ViewportSize, tileZoom: number, now: number): void {
    const point = this.point, projection = this.scene.userData.mapProjection as ProjectionState | undefined, fogEnd = this.fogEnd;
    const projected: Projected[] = [];
    for (const bucket of this.buckets.values()) for (const p of bucket) projected.push(p);
    const availableIds = new Set<string>();
    for (const p of projected) availableIds.add(p.id);
    this.availableIds = availableIds;
    // 已显示点标签在瓦片接替的短暂候选缺口中保持同一世界锚点。
    for (const [id, saved] of this.retainedPoints) {
      if (now - saved.seen >= 350 || tileZoom < saved.label.minZoom || tileZoom >= saved.label.maxZoom) {
        this.retainedPoints.delete(id); continue;
      }
      if (availableIds.has(id)) continue;
      point.set(saved.x - origin.meters.x, 0, origin.meters.y - saved.y);
      if (projection) { if (!facesCamera(point, camera.position, projection)) continue; projectMapPoint(point, projection); }
      if (point.distanceTo(camera.position) > fogEnd * .9) continue;
      point.project(camera); if (point.z < -1 || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1) continue;
      projected.push({ id, label: saved.label, score: saved.label.priority - 1000,
        x: (point.x + 1) * viewport.width / 2, y: (1 - point.y) * viewport.height / 2,
        worldX: saved.x, worldY: saved.y, endWorldX: saved.x, endWorldY: saved.y, angle: 0, length: Infinity });
    }
    const anchorDistance = (p: Projected) => { const a = this.anchors.get(p.id); return a ? Math.hypot(a.x - p.worldX, a.y - p.worldY) : 0; };
    projected.sort((a, b) => a.score - b.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : anchorDistance(a) - anchorDistance(b)));
    const candidates = projected.slice(0, CANDIDATE_LIMIT); this.candidates = candidates.length;
    const characters = new Set<number>();
    for (const p of candidates) for (const char of p.label.text) if (characters.size < 2048) characters.add(char.codePointAt(0)!);
    for (const p of candidates) if (p.label.icon) characters.add(iconCode(p.label.icon));
    const generation = this.atlas.generation; this.atlas.ensure(characters);
    if (generation !== this.atlas.generation) this.placement.invalidateGlyphs();
    this.pending = candidates; this.pendingIndex = 0;
    this.placedState = { grid: new CollisionGrid(), quads: [], selected: new Set(), runs: new Map(), names: new Map(),
      maxLabels: Math.min(512, Math.max(1, this.appearance.maxLabels ?? this.options.maxLabels ?? 256)) };
  }
  /** 单个候选的碰撞与排版：逐候选推进，放置阶段同样受每帧预算约束。 */
  private placeCandidate(p: Projected, state: PlacementState, now: number): void {
    const viewWidth = this.layoutViewport.width, viewHeight = this.layoutViewport.height;
    const originX = this.layoutOrigin.x, originY = this.layoutOrigin.y;
    const nameKey = p.label.line ? `road:${p.label.text}` : p.label.key;
    if (state.selected.has(p.id) || state.names.get(nameKey)?.some(other => Math.hypot(other.x - p.x, other.y - p.y) < 320)) return;
    const glyphs: AtlasGlyph[] = [];
    for (const char of p.label.text) { const glyph = this.atlas.glyphs.get(char.codePointAt(0)!); if (glyph) glyphs.push(glyph); }
    if (glyphs.length !== Array.from(p.label.text).length) return;
    const iconSize = p.label.icon ? p.label.iconSize ?? p.label.size : 0;
    const { scale, iconWidth, width, height: inkHeight, baseline } = measureGlyphRun(glyphs, p.label.size, iconSize, p.label.iconGap);
    if (width + 12 > p.length || width > viewWidth * .7) return;
    const height = inkHeight + 4;
    const halfX = Math.abs(Math.cos(p.angle)) * width / 2 + Math.abs(Math.sin(p.angle)) * height / 2;
    const halfY = Math.abs(Math.sin(p.angle)) * width / 2 + Math.abs(Math.cos(p.angle)) * height / 2;
    const pad = this.retained.has(p.id) ? 3 : 7;
    const box: LabelBox = { left: p.x - halfX - pad, right: p.x + halfX + pad, top: p.y - halfY - pad, bottom: p.y + halfY + pad };
    if (box.left < 0 || box.right > viewWidth || box.top < 0 || box.bottom > viewHeight || state.grid.collides(box)) return;
    state.grid.insert(box); state.selected.add(p.id); this.anchors.set(p.id, { x: p.worldX, y: p.worldY, at: now });
    const same = state.names.get(nameKey) ?? []; same.push(p); state.names.set(nameKey, same);
    if (!p.label.line && this.availableIds.has(p.id)) this.retainedPoints.set(p.id, { label: p.label, x: p.worldX, y: p.worldY, seen: now });
    const born = this.births.get(p.id) ?? now / 1000; this.births.set(p.id, born);
    const firstQuad = state.quads.length;
    let cursor = -width / 2;
    if (p.label.icon) {
      const icon = this.atlas.glyphs.get(iconCode(p.label.icon));
      const iconScale = iconSize / GLYPH_EM;
      if (icon) state.quads.push({ x: p.worldX - originX, y: originY - p.worldY,
        left: cursor - GLYPH_BORDER * iconScale, top: -iconSize / 2 - GLYPH_BORDER * iconScale,
        width: icon.w * iconScale, height: icon.h * iconScale, u: icon.u, v: icon.v, du: icon.w / this.atlas.size, dv: icon.h / this.atlas.size,
        angle: 0, color: p.label.iconColor ?? p.label.color, haloColor: p.label.haloColor, haloWidth: .6, scale: iconScale, born });
      cursor += iconWidth;
    }
    for (const glyph of glyphs) {
      if (glyph.w) state.quads.push({ x: p.worldX - originX, y: originY - p.worldY,
        left: cursor + (glyph.left - GLYPH_BORDER) * scale, top: baseline - (glyph.top + GLYPH_BORDER) * scale,
        width: glyph.w * scale, height: glyph.h * scale, u: glyph.u, v: glyph.v, du: glyph.w / this.atlas.size, dv: glyph.h / this.atlas.size,
        angle: p.angle, endX: p.label.line ? p.endWorldX - originX : undefined, endY: p.label.line ? originY - p.endWorldY : undefined, color: p.label.color, haloColor: p.label.haloColor, haloWidth: p.label.haloWidth, scale, born });
      cursor += glyph.advance * scale;
    }
    state.runs.set(p.id, state.quads.slice(firstQuad));
  }
  /** 放置阶段结束：一次性提交文字批次并更新保留集合。 */
  private commitPlacement(state: PlacementState, origin: MapOrigin, now: number): void {
    this.retained.clear(); for (const id of state.selected) this.retained.add(id);
    for (const id of this.retainedPoints.keys()) if (!state.selected.has(id)) this.retainedPoints.delete(id);
    this.retentionUntil = Infinity;
    for (const [id, saved] of this.retainedPoints) if (!this.availableIds.has(id)) this.retentionUntil = Math.min(this.retentionUntil, saved.seen + 350);
    for (const [id, anchor] of this.anchors) if (now - anchor.at > 2000) { this.anchors.delete(id); this.births.delete(id); }
    this.placed = state.selected.size;
    // 顶点数据与渲染基准在同一帧切换：两者不一致会让整批文字错位。
    this.batchOrigin = { ...this.layoutOrigin };
    this.writtenBasis.x = this.batchOrigin.x; this.writtenBasis.y = this.batchOrigin.y;
    this.surface.origin.value.set(origin.meters.x - this.batchOrigin.x, 0, this.batchOrigin.y - origin.meters.y);
    // 在场与离场字形统一按本轮顶点基准输出，避免两类符号使用不同坐标基准。
    this.surface.write(this.placement.update(state.runs, this.layoutOrigin, now / 1000));
    this.atlas.flush(); this.layoutMs = performance.now() - this.layoutStartedAt; this.layouts++;
    this.placedState = undefined; this.pending = []; this.buckets.clear();
  }
  dispose(): void { this.surface.dispose(); this.atlas.dispose(); }
}
/** 与 render cover 相同的半开区间归属，阻止父子来源同时提交同一锚点。 */
export function ownsAnchor(source: Address, cells: readonly Address[], x: number, y: number): boolean {
  return cells.some(cell => {
    const scale = 2 ** (source.z - cell.z), left = cell.x * scale - source.x, top = cell.y * scale - source.y;
    return x >= left && x < left + scale && y >= top && y < top + scale;
  });
}

/** 字形加载前的保守宽度下界用于剔除无法容纳文字的短路段。 */
function pTextWidth(label: LabelCandidate): number { return label.text.length * label.size * .35 + 12; }
