import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
} from 'three/webgpu';

import type {
  LineBatchPayload,
  TileBuildPayloadV1,
  TileFeatureRecord,
} from '../geometry/types.js';
import {
  getLineGeometryBytes,
  getUniqueLineGeometryBatches,
} from '../geometry/lineGeometrySharing.js';
import { getTileAnchorRelativeToOrigin } from '../spatial/mapOrigin.js';
import type { MapOrigin } from '../spatial/types.js';
import type { CanonicalTileKey } from '../types.js';
import type { MaterialRegistry } from './materialRegistry.js';

export interface LineTileGpuStats {
  batches: number;
  features: number;
  vertices: number;
  indices: number;
  cpuBytes: number;
  gpuBytes: number;
  objects: number;
}

interface LineMeshResource {
  material: MeshBasicNodeMaterial;
  materialKey: string;
}

interface SharedLineGeometryResource {
  geometry: BufferGeometry;
}

/** 单个 Tile 的 Line 三角带 Three.js 资源和释放边界。 */
export class LineTileGpuRecord {
  readonly container: Group;
  readonly features: readonly TileFeatureRecord[];
  readonly stats: Readonly<LineTileGpuStats>;
  readonly #key: CanonicalTileKey;
  readonly #materials: MaterialRegistry;
  readonly #resources: LineMeshResource[];
  readonly #geometries = new Map<string, SharedLineGeometryResource>();
  #disposed = false;

  constructor(
    payload: TileBuildPayloadV1,
    origin: MapOrigin,
    materials: MaterialRegistry,
  ) {
    this.#key = payload.key;
    this.#materials = materials;
    this.container = new Group();
    this.container.name = `nova-line-tile:${payload.key.sourceId}/${payload.key.z}/${payload.key.x}/${payload.key.y}`;
    this.#resources = [];
    this.setOrigin(origin);
    const lineBatches = payload.batches.filter(
      (batch): batch is LineBatchPayload => batch.type === 'line',
    );
    this.features = lineBatches.length > 0 ? payload.features : Object.freeze([]);

    try {
      lineBatches.forEach((batch) => {
        const resource = createLineMesh(batch, materials, this.#geometries);
        this.#resources.push(resource);
        this.container.add(resource.mesh);
      });
    } catch (error) {
      this.#disposeResources();
      throw error;
    }

    const uniqueGeometries = getUniqueLineGeometryBatches(lineBatches);
    const indices = uniqueGeometries.reduce(
      (total, batch) => total + batch.indices.length,
      0,
    );
    const typedArrayBytes = uniqueGeometries.reduce(
      (total, batch) => total + getLineGeometryBytes(batch),
      0,
    );
    this.stats = Object.freeze({
      batches: lineBatches.length,
      features: this.features.length,
      vertices: uniqueGeometries.reduce(
        (total, batch) => total + batch.positions.length / 3,
        0,
      ),
      indices,
      cpuBytes: typedArrayBytes,
      gpuBytes: typedArrayBytes,
      objects: lineBatches.length > 0 ? 1 + lineBatches.length : 0,
    });
  }

  get disposed(): boolean {
    return this.#disposed;
  }

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
      this.#materials.release(resource.materialKey);
    }
    for (const resource of this.#geometries.values()) {
      resource.geometry.dispose();
    }
    this.#geometries.clear();
  }
}

interface CreatedLineMesh extends LineMeshResource {
  mesh: Mesh;
}

function createLineMesh(
  batch: LineBatchPayload,
  materials: MaterialRegistry,
  geometries: Map<string, SharedLineGeometryResource>,
): CreatedLineMesh {
  const geometry = getOrCreateLineGeometry(batch, geometries).geometry;
  const material = materials.acquireLine(batch.material);
  try {
    const mesh = new Mesh(geometry, material);
    mesh.name = `nova-line:${batch.layerId}`;
    mesh.renderOrder = batch.renderOrder;
    mesh.userData = {
      layerId: batch.layerId,
      sourceLayer: batch.sourceLayer,
      featureRanges: batch.featureRanges,
      lineWidth: batch.material.width,
    };
    return { material, materialKey: batch.material.key, mesh };
  } catch (error) {
    materials.release(batch.material.key);
    throw error;
  }
}

function getOrCreateLineGeometry(
  batch: LineBatchPayload,
  geometries: Map<string, SharedLineGeometryResource>,
): SharedLineGeometryResource {
  const existing = geometries.get(batch.geometryKey);
  if (existing !== undefined) {
    return existing;
  }

  const geometry = new BufferGeometry();
  try {
    geometry.setAttribute('position', new BufferAttribute(batch.positions, 3));
    geometry.setAttribute('previous', new BufferAttribute(batch.previous, 3));
    geometry.setAttribute('next', new BufferAttribute(batch.next, 3));
    geometry.setAttribute('side', new BufferAttribute(batch.sides, 1));
    geometry.setAttribute('featureId', new BufferAttribute(batch.featureIds, 1));
    geometry.setIndex(new BufferAttribute(batch.indices, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.userData = {
      geometryKey: batch.geometryKey,
      sourceLayer: batch.sourceLayer,
      featureRanges: batch.featureRanges,
    };
  } catch (error) {
    geometry.dispose();
    throw error;
  }

  const resource = { geometry };
  geometries.set(batch.geometryKey, resource);
  return resource;
}
