import { decodeVectorTile, paintVectorTile } from './paint.js';
import { buildLines } from './lines.js';
import type { PaintRequest, PaintResponse } from './protocol.js';
const scope = self as unknown as { onmessage: ((event: MessageEvent<PaintRequest>) => void) | null; postMessage: (message: PaintResponse, transfer: Transferable[]) => void };
scope.onmessage = ({ data }) => {
  const started = performance.now();
  try {
    const canvas = new OffscreenCanvas(data.size, data.size);
    const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true })!;
    const features = paintVectorTile(context, data.buffer, data.layers.filter(layer => layer.type === 'fill'), data.address.z, data.size, data.background);
    const lines = buildLines(decodeVectorTile(data.buffer), data.layers);
    const bitmap = canvas.transferToImageBitmap();
    scope.postMessage({ id: data.id, bitmap, lines, features: features + lines.features, paintMs: performance.now() - started, empty: data.buffer.byteLength === 0 }, [bitmap, lines.segments.buffer, lines.styles.buffer, lines.colors.buffer]);
  } catch (error) {
    scope.postMessage({ id: data.id, error: String(error), features: 0, paintMs: performance.now() - started, empty: false }, []);
  }
};
