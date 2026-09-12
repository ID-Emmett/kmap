import { Group, Mesh, MeshBasicNodeMaterial } from 'three/webgpu';
import type { Scene } from 'three/webgpu';

import type { TileBuildPayloadV1 } from '../geometry/types.js';
import type { MapOrigin, RenderTileKey } from '../spatial/types.js';
import { getTileSpanMeters } from '../spatial/mercator.js';
import { getTileAnchorRelativeToOrigin } from '../spatial/mapOrigin.js';
import type {
  TileRuntimeRenderAdapter,
  TileRuntimeRenderInput,
} from '../runtime/tileRuntimeTypes.js';
import type {
  TileResourceStats,
  TileRuntimeResource,
} from '../runtime/tileRecord.js';
import { LineTileGpuRecord } from './lineTile.js';
import { MaterialRegistry } from './materialRegistry.js';
import { PolygonTileGpuRecord } from './polygonTile.js';

/** 将 Worker payload 转换为 Scene 中的 Tile 级 Polygon/Line 资源。 */
export class ThreeTileRenderAdapter
implements TileRuntimeRenderAdapter<TileBuildPayloadV1> {
  readonly #scene: Scene;
  readonly #materials: MaterialRegistry;
  readonly #resources = new Set<ThreeTileResource>();
  #origin: MapOrigin;
  #disposed = false;

  constructor(
    scene: Scene,
    materials: MaterialRegistry,
    origin: MapOrigin,
  ) {
    this.#scene = scene;
    this.#materials = materials;
    this.#origin = origin;
  }

  upload(
    input: TileRuntimeRenderInput<TileBuildPayloadV1>,
  ): TileRuntimeResource {
    if (this.#disposed) {
      throw new Error('Tile Render adapter 已销毁。');
    }

    const resource = new ThreeTileResource(
      input.renderKeys,
      input.payload,
      this.#origin,
      this.#materials,
    );
    this.#scene.add(resource.container);
    this.#resources.add(resource);
    resource.onDispose = () => this.#resources.delete(resource);
    return resource;
  }

  setOrigin(origin: MapOrigin): void {
    this.#origin = origin;
    for (const resource of this.#resources) {
      resource.setOrigin(origin);
    }
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    for (const resource of [...this.#resources]) {
      resource.dispose();
    }
    this.#resources.clear();
  }
}

class ThreeTileResource implements TileRuntimeResource {
  readonly container = new Group();
  readonly cpuBytes: number;
  readonly gpuBytes: number;
  onDispose: (() => void) | undefined;
  #polygon: PolygonTileGpuRecord | undefined;
  #line: LineTileGpuRecord | undefined;
  readonly #renderInstances = new Map<number, Group>();
  readonly #activeRenderKeys = new Set<number>();
  readonly #displayMaterials = new Map<MeshBasicNodeMaterial, number>();
  readonly #key: TileBuildPayloadV1['key'];
  readonly #batches: number;
  readonly #features: number;
  readonly #vertices: number;
  readonly #indices: number;
  #origin: MapOrigin;
  #displayOpacity = 1;
  #disposed = false;

  constructor(
    renderKeys: readonly RenderTileKey[] | undefined,
    payload: TileBuildPayloadV1,
    origin: MapOrigin,
    materials: MaterialRegistry,
  ) {
    this.#key = payload.key;
    this.#origin = origin;
    this.container.name = `nova-tile:${payload.key.sourceId}/${payload.key.z}/${payload.key.x}/${payload.key.y}`;
    const polygonBatches = payload.batches.some((batch) => batch.type === 'polygon');
    const lineBatches = payload.batches.some((batch) => batch.type === 'line');

    try {
      if (polygonBatches) {
        this.#polygon = new PolygonTileGpuRecord(payload, origin, materials);
      }
      if (lineBatches) {
        this.#line = new LineTileGpuRecord(payload, origin, materials);
      }
    } catch (error) {
      this.#polygon?.dispose();
      this.#line?.dispose();
      throw error;
    }

    const polygonStats = this.#polygon?.stats;
    const lineStats = this.#line?.stats;
    this.#batches = (polygonStats?.batches ?? 0) + (lineStats?.batches ?? 0);
    this.#features = payload.features.length;
    this.#vertices =
      (polygonStats?.vertices ?? 0) + (lineStats?.vertices ?? 0);
    this.#indices = (polygonStats?.indices ?? 0) + (lineStats?.indices ?? 0);
    this.cpuBytes = (polygonStats?.cpuBytes ?? 0) + (lineStats?.cpuBytes ?? 0);
    this.gpuBytes = (polygonStats?.gpuBytes ?? 0) + (lineStats?.gpuBytes ?? 0);
    this.setRenderKeys(renderKeys ?? [{ canonical: payload.key, wrap: 0 }]);
  }

  get stats(): Readonly<TileResourceStats> {
    return {
      batches: this.#batches,
      features: this.#features,
      vertices: this.#vertices,
      indices: this.#indices,
      objects:
        this.#batches === 0
          ? 0
          : 1 + this.#activeRenderKeys.size * (1 + this.#batches),
    };
  }

  setOrigin(origin: MapOrigin): void {
    this.#origin = origin;
    for (const [wrap, instance] of this.#renderInstances) {
      setRenderInstancePosition(instance, this.#key, origin, wrap);
    }
  }

  setDisplayOpacity(opacity: number): void {
    if (this.#disposed) {
      return;
    }
    const nextOpacity = Math.max(0, Math.min(1, opacity));
    this.#displayOpacity = nextOpacity;
    for (const [material, baseOpacity] of this.#displayMaterials) {
      const materialOpacity = baseOpacity * this.#displayOpacity;
      if (material.opacity !== materialOpacity) {
        material.opacity = materialOpacity;
      }
      // 过渡首次启用后保持 transparent，避免每次回到 1 又触发材质管线重建。
      if (materialOpacity < 1 && !material.transparent) {
        material.transparent = true;
        material.needsUpdate = true;
      }
    }
  }

  setRenderKeys(renderKeys: readonly RenderTileKey[]): void {
    if (this.#disposed) {
      return;
    }
    const keys = uniqueRenderKeys(renderKeys, this.#key);
    const desired = new Set(keys.map((key) => key.wrap));

    for (const [wrap, instance] of this.#renderInstances) {
      if (!desired.has(wrap)) {
        instance.removeFromParent();
        this.#activeRenderKeys.delete(wrap);
      }
    }
    for (const key of keys) {
      const existing = this.#renderInstances.get(key.wrap);
      if (existing !== undefined) {
        if (existing.parent !== this.container) {
          this.container.add(existing);
        }
        this.#activeRenderKeys.add(key.wrap);
        continue;
      }
      const instance = createRenderInstance(
        this.#key,
        this.#origin,
        key.wrap,
        this.#polygon,
        this.#line,
        this.#displayMaterials,
      );
      this.#renderInstances.set(key.wrap, instance);
      this.#activeRenderKeys.add(key.wrap);
      this.container.add(instance);
    }
    this.setDisplayOpacity(this.#displayOpacity);
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    for (const instance of this.#renderInstances.values()) {
      instance.removeFromParent();
      instance.clear();
    }
    this.#renderInstances.clear();
    this.#activeRenderKeys.clear();
    for (const material of this.#displayMaterials.keys()) {
      material.dispose();
    }
    this.#displayMaterials.clear();
    this.#polygon?.dispose();
    this.#line?.dispose();
    this.container.removeFromParent();
    this.container.clear();
    this.onDispose?.();
    this.onDispose = undefined;
  }
}

function createRenderInstance(
  key: TileBuildPayloadV1['key'],
  origin: MapOrigin,
  wrap: number,
  polygon: PolygonTileGpuRecord | undefined,
  line: LineTileGpuRecord | undefined,
  displayMaterials: Map<MeshBasicNodeMaterial, number>,
): Group {
  const instance = new Group();
  instance.name = `nova-render-tile:${key.sourceId}/${key.z}/${key.x}/${key.y}@${wrap}`;
  for (const child of polygon?.container.children ?? []) {
    instance.add(cloneRenderObject(child, displayMaterials));
  }
  for (const child of line?.container.children ?? []) {
    instance.add(cloneRenderObject(child, displayMaterials));
  }
  setRenderInstancePosition(instance, key, origin, wrap);
  return instance;
}

function cloneRenderObject(
  source: Group['children'][number],
  displayMaterials: Map<MeshBasicNodeMaterial, number>,
): Group['children'][number] {
  const clone = source.clone(true);
  clone.traverse((object) => {
    if (!(object instanceof Mesh)) {
      return;
    }
    if (Array.isArray(object.material)) {
      object.material = object.material.map((material) => {
        const displayMaterial = material.clone() as MeshBasicNodeMaterial;
        displayMaterials.set(displayMaterial, displayMaterial.opacity);
        return displayMaterial;
      });
      return;
    }
    const displayMaterial = object.material.clone() as MeshBasicNodeMaterial;
    displayMaterials.set(displayMaterial, displayMaterial.opacity);
    object.material = displayMaterial;
  });
  return clone;
}

function setRenderInstancePosition(
  instance: Group,
  key: TileBuildPayloadV1['key'],
  origin: MapOrigin,
  wrap: number,
): void {
  const anchor = getTileAnchorRelativeToOrigin(
    key.x,
    key.y,
    key.z,
    origin,
  );
  const worldSpan = getTileSpanMeters(key.z) * 2 ** key.z;
  instance.position.set(anchor.x + wrap * worldSpan, anchor.y, anchor.z);
}

function uniqueRenderKeys(
  renderKeys: readonly RenderTileKey[],
  canonical: TileBuildPayloadV1['key'],
): readonly RenderTileKey[] {
  const seen = new Set<number>();
  const result: RenderTileKey[] = [];
  for (const renderKey of renderKeys) {
    if (
      renderKey.canonical.sourceId !== canonical.sourceId ||
      renderKey.canonical.z !== canonical.z ||
      renderKey.canonical.x !== canonical.x ||
      renderKey.canonical.y !== canonical.y ||
      seen.has(renderKey.wrap)
    ) {
      continue;
    }
    seen.add(renderKey.wrap);
    result.push(renderKey);
  }
  return Object.freeze(result);
}
