import type { VectorTile, VectorTileFeature, VectorTileLayer } from '@mapbox/vector-tile';
import type { TileOverlaySource } from '../types.js';
import type { Address } from './address.js';
import { decodeVectorTile } from './paint.js';

export function overlayAddress(address: Address, source: TileOverlaySource): Address {
  const z = Math.min(address.z, source.maxZoom), factor = 2 ** (address.z - z);
  return { z, x: Math.floor(address.x / factor), y: Math.floor(address.y / factor) };
}

/** 长度前缀包保留原始 MVT，主线程与 Worker 通过一个 ArrayBuffer 转移所有权。 */
export function packTileSources(buffers: readonly ArrayBuffer[]): ArrayBuffer {
  const result = new Uint8Array(buffers.reduce((sum, b) => sum + b.byteLength + 4, 0));
  const header = new DataView(result.buffer); let offset = 0;
  for (const buffer of buffers) { header.setUint32(offset, buffer.byteLength, true); offset += 4; result.set(new Uint8Array(buffer), offset); offset += buffer.byteLength; }
  return result.buffer;
}

export function decodeTileSources(buffer: ArrayBuffer, address: Address, sources: readonly TileOverlaySource[] = []): VectorTile {
  if (!sources.length) return decodeVectorTile(buffer);
  const header = new DataView(buffer); let offset = 0;
  const next = (): VectorTile => {
    const size = header.getUint32(offset, true); offset += 4;
    const tile = decodeVectorTile(new Uint8Array(buffer, offset, size)); offset += size; return tile;
  };
  const tile = next();
  for (const source of sources) {
    const layer = next().layers[source.sourceLayer]; if (!layer) continue;
    const ancestor = overlayAddress(address, source), scale = 2 ** (address.z - ancestor.z);
    const dx = address.x - ancestor.x * scale, dy = address.y - ancestor.y * scale;
    // 祖先面补充层只保留与子瓦片相交的 Feature；线保留缓冲段与累计长度。
    const features: VectorTileFeature[] = [];
    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i); const [minX, minY, maxX, maxY] = feature.bbox() as [number, number, number, number];
      const e = layer.extent;
      if (scale > 1 && feature.type === 3 && (maxX * scale < dx * e || minX * scale > (dx + 1) * e || maxY * scale < dy * e || minY * scale > (dy + 1) * e)) continue;
      features.push(feature);
    }
    tile.layers[source.targetLayer] = {
      extent: layer.extent, length: features.length, version: layer.version, name: source.targetLayer,
      feature: (index: number): VectorTileFeature => {
        const feature = Object.create(features[index]!) as VectorTileFeature;
        const geometry = feature.loadGeometry.bind(feature);
        feature.loadGeometry = () => geometry().map(ring => ring.map(p => { p.x = p.x * scale - dx * layer.extent; p.y = p.y * scale - dy * layer.extent; return p; }));
        return feature;
      },
    } as VectorTileLayer;
  }
  return tile;
}
