import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import type { LayerFilter, MapLayerOptions } from '../types.js';

export function matches(properties: Record<string, unknown>, filters: readonly LayerFilter[] = []): boolean {
  return filters.every(f => {
    const value = properties[f.property];
    switch (f.operator) {
      case 'has': return Object.hasOwn(properties, f.property);
      case '==': return value === f.value;
      case '!=': return value !== f.value;
      case 'in': return f.values.some(v => v === value);
      case '!in': return f.values.every(v => v !== value);
    }
  });
}

export const decodeVectorTile = (buffer: ArrayBuffer | Uint8Array): VectorTile => new VectorTile(new PbfReader(buffer));

/** MVT 数据直接交由 Canvas 路径填充和描边；图层按配置顺序合成。 */
export function paintVectorTile(context: OffscreenCanvasRenderingContext2D, buffer: ArrayBuffer, layers: readonly MapLayerOptions[], zoom: number, size: number, background: string): number {
  context.fillStyle = background; context.fillRect(0, 0, size, size);
  if (buffer.byteLength === 0) return 0;
  const tile = decodeVectorTile(buffer);
  let features = 0;
  for (const layer of layers) {
    if (zoom < (layer.minZoom ?? 0) || zoom > (layer.maxZoom ?? 24)) continue;
    const source = tile.layers[layer.sourceLayer];
    if (!source) continue;
    const scale = size / source.extent;
    context.save(); context.scale(scale, scale);
    const color = typeof layer.paint.color === 'number' ? `#${layer.paint.color.toString(16).padStart(6, '0')}` : layer.paint.color;
    context.fillStyle = color; context.strokeStyle = color;
    context.globalAlpha = layer.paint.opacity ?? 1;
    context.lineCap = 'round'; context.lineJoin = 'round';
    if (layer.type === 'line') context.lineWidth = (layer.paint.width ?? 1) * source.extent / 256;
    for (let i = 0; i < source.length; i++) {
      const feature = source.feature(i);
      if ((layer.type === 'fill' && feature.type !== 3) || (layer.type === 'line' && feature.type !== 2) || !matches(feature.properties, layer.filters)) continue;
      context.beginPath();
      for (const ring of feature.loadGeometry()) {
        if (ring.length < 2) continue;
        context.moveTo(ring[0]!.x, ring[0]!.y);
        for (let j = 1; j < ring.length; j++) context.lineTo(ring[j]!.x, ring[j]!.y);
        if (layer.type === 'fill') context.closePath();
      }
      if (layer.type === 'fill') context.fill('evenodd'); else context.stroke();
      features++;
    }
    context.restore();
  }
  return features;
}
