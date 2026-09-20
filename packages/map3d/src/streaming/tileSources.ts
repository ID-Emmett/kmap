import type { VectorTile, VectorTileFeature, VectorTileLayer } from '@mapbox/vector-tile';
import type { TileOverlaySource } from '../types.js';
import type { Address } from './address.js';
import { decodeVectorTile } from './paint.js';

export function overlayAddress(address: Address, source: TileOverlaySource): Address {
  const z = Math.min(address.z, source.maxZoom), factor = 2 ** (address.z - z);
  return { z, x: Math.floor(address.x / factor), y: Math.floor(address.y / factor) };
}

/** 来源索引引用唯一响应体；同一 MVT 的多个图层共享一次拷贝与解析。 */
export function packTileSources(buffers: readonly ArrayBuffer[]): ArrayBuffer {
  const unique = [...new Set(buffers)];
  const result = new Uint8Array(8 + buffers.length * 4 + unique.reduce((sum, b) => sum + b.byteLength + 4, 0));
  const header = new DataView(result.buffer);
  header.setUint32(0, buffers.length, true); header.setUint32(4, unique.length, true);
  buffers.forEach((b, i) => header.setUint32(8 + i * 4, unique.indexOf(b), true));
  let offset = 8 + buffers.length * 4;
  for (const buffer of unique) { header.setUint32(offset, buffer.byteLength, true); offset += 4; result.set(new Uint8Array(buffer), offset); offset += buffer.byteLength; }
  return result.buffer;
}

export function decodeTileSources(buffer: ArrayBuffer, address: Address, sources: readonly TileOverlaySource[] = []): VectorTile {
  if (!sources.length) return decodeVectorTile(buffer);
  const header = new DataView(buffer), count = header.getUint32(0, true), unique = header.getUint32(4, true);
  if (count !== sources.length + 1) throw new Error('瓦片来源包数量不匹配。');
  const decoded: VectorTile[] = [], hasContent: boolean[] = []; let offset = 8 + count * 4;
  for (let i = 0; i < unique; i++) {
    const size = header.getUint32(offset, true); offset += 4;
    decoded.push(decodeVectorTile(new Uint8Array(buffer, offset, size))); hasContent.push(size > 0); offset += size;
  }
  const part = (index: number) => decoded[header.getUint32(8 + index * 4, true)]!;
  const primary = part(0), tile = Object.create(primary) as VectorTile;
  const primaryPresent = hasContent[header.getUint32(8, true)];
  tile.layers = { ...primary.layers };
  for (const [i, source] of sources.entries()) {
    // 来源优先级同时约束网络与 Worker；完整主瓦片的无水面区域保留陆地语义。
    if (source.onlyWhenPrimaryEmpty && primaryPresent) continue;
    const layer = part(i + 1).layers[source.sourceLayer]; if (!layer) continue;
    if (source.onlyWhenLayerMissing && tile.layers[source.targetLayer]?.length) continue;
    tile.layers[source.targetLayer] = reprojectLayer(layer, overlayAddress(address, source), address);
  }
  return tile;
}

/** 祖先几何按目标地址映射，包围盒预筛选保留相交要素与边缘缓冲。 */
export function reprojectLayer(layer: VectorTileLayer, ancestor: Address, address: Address): VectorTileLayer {
  const scale = 2 ** (address.z - ancestor.z);
  if (scale === 1) return layer;
  const dx = address.x - ancestor.x * scale, dy = address.y - ancestor.y * scale, e = layer.extent;
  const features: VectorTileFeature[] = [];
  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i), [minX, minY, maxX, maxY] = feature.bbox() as [number, number, number, number];
    if (maxX * scale < dx * e - 128 || minX * scale > (dx + 1) * e + 128 || maxY * scale < dy * e - 128 || minY * scale > (dy + 1) * e + 128) continue;
    features.push(feature);
  }
  return { extent: e, length: features.length, version: layer.version, name: layer.name,
    feature: (index: number): VectorTileFeature => {
      const feature = Object.create(features[index]!) as VectorTileFeature;
      const geometry = feature.loadGeometry.bind(feature);
      feature.loadGeometry = () => geometry().map(ring => ring.map(p => { p.x = p.x * scale - dx * e; p.y = p.y * scale - dy * e; return p; }));
      return feature;
    },
  } as VectorTileLayer;
}
