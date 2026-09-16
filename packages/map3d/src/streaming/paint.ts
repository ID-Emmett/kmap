import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import type { LayerFilter } from '../types.js';

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
