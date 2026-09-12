import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
} from 'three/webgpu';

import type {
  PolygonBatchPayload,
  TileBuildPayloadV1,
  TileFeatureRecord,
} from '../geometry/types.js';
import { getTileAnchorRelativeToOrigin } from '../spatial/mapOrigin.js';
import type { MapOrigin } from '../spatial/types.js';
import type { CanonicalTileKey } from '../types.js';
import type { MaterialRegistry } from './materialRegistry.js';

export interface PolygonTileGpuStats {
  batches: number;
  features: number;
  vertices: number;
  indices: number;
  cpuBytes: number;
  gpuBytes: number;
  objects: number;
}

interface PolygonMeshResource {
  geometry: BufferGeometry;
  materialKey: string;
}

/** 单个 Tile 的 Polygon Three.js 对象、Feature 映射和释放边界。 */
export class PolygonTileGpuRecord {
  readonly container: Group;
  readonly features: readonly TileFeatureRecord[];
  readonly stats: Readonly<PolygonTileGpuStats>;
  readonly #materials: MaterialRegistry;
  readonly #key: CanonicalTileKey;
  readonly #resources: PolygonMeshResource[];
  #disposed = false;

  constructor(
    payload: TileBuildPayloadV1,
    origin: MapOrigin,
    materials: MaterialRegistry,
  ) {
    this.#materials = materials;
    this.#key = payload.key;
    this.container = new Group();
    this.container.name = `nova-tile:${payload.key.sourceId}/${payload.key.z}/${payload.key.x}/${payload.key.y}`;
    this.setOrigin(origin);
    this.features = payload.features;
    this.#resources = [];
    const polygonBatches = payload.batches.filter(
      (batch): batch is PolygonBatchPayload => batch.type === 'polygon',
    );

    try {
      polygonBatches.forEach((batch) => {
        const resource = createPolygonMesh(batch, materials);
        this.#resources.push(resource);
        this.container.add(resource.mesh);
      });
    } catch (error) {
      this.#disposeResources();
      throw error;
    }

    const indices = polygonBatches.reduce(
      (total, batch) => total + batch.indices.length,
      0,
    );
    const typedArrayBytes = polygonBatches.reduce(
      (total, batch) => total + getBatchBytes(batch),
      0,
    );
    this.stats = Object.freeze({
      batches: polygonBatches.length,
      features: polygonBatches.length > 0 ? payload.features.length : 0,
      vertices: polygonBatches.reduce(
        (total, batch) => total + batch.positions.length / 3,
        0,
      ),
      indices,
      cpuBytes: typedArrayBytes,
      gpuBytes: typedArrayBytes,
      objects: 1 + payload.batches.length,
    });
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  /** MapOrigin 重定位时只更新 Tile container，不重建局部顶点。 */
  setOrigin(origin: MapOrigin): void {
    if (this.#disposed) {
      return;
    }

    const anchor = getTileAnchorRelativeToOrigin(
      this.#key.x,
      this.#key.y,
      this.#key.z,
      origin,
    );
    this.container.position.set(anchor.x, anchor.y, anchor.z);
  }

  /** 先从 Scene 脱离，再释放 Geometry 和共享 Material 引用。 */
  dispose(): void {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;
    this.container.removeFromParent();
    this.container.clear();
    this.#disposeResources();
  }

  #disposeResources(): void {
    for (const resource of this.#resources.splice(0)) {
      resource.geometry.dispose();
      this.#materials.release(resource.materialKey);
    }
  }
}

interface CreatedPolygonMesh extends PolygonMeshResource {
  mesh: Mesh;
}

function createPolygonMesh(
  batch: PolygonBatchPayload,
  materials: MaterialRegistry,
): CreatedPolygonMesh {
  const geometry = new BufferGeometry();
  const material = materials.acquire(batch.material);

  try {
    geometry.setAttribute('position', new BufferAttribute(batch.positions, 3));
    geometry.setAttribute('featureId', new BufferAttribute(batch.featureIds, 1));
    geometry.setIndex(new BufferAttribute(batch.indices, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.userData = {
      layerId: batch.layerId,
      sourceLayer: batch.sourceLayer,
      featureRanges: batch.featureRanges,
    };

    const mesh = new Mesh(geometry, material);
    mesh.name = `nova-polygon:${batch.layerId}`;
    mesh.renderOrder = batch.renderOrder;
    mesh.userData = { materialKey: batch.material.key };
    return { geometry, materialKey: batch.material.key, mesh };
  } catch (error) {
    geometry.dispose();
    materials.release(batch.material.key);
    throw error;
  }
}

function getBatchBytes(batch: PolygonBatchPayload): number {
  return (
    batch.positions.byteLength +
    batch.indices.byteLength +
    batch.featureIds.byteLength
  );
}
