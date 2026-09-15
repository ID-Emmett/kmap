import { paintVectorTile } from './paint.js';
import type { PaintRequest, PaintResponse } from './protocol.js';
const scope = self as unknown as { onmessage: ((event: MessageEvent<PaintRequest>) => void) | null; postMessage: (message: PaintResponse, transfer: Transferable[]) => void };
scope.onmessage = ({ data }) => {
  const started = performance.now();
  try {
    const canvas = new OffscreenCanvas(data.size, data.size);
    const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true })!;
    const features = paintVectorTile(context, data.buffer, data.layers, data.address.z, data.size, data.background);
    const bitmap = canvas.transferToImageBitmap();
    scope.postMessage({ id: data.id, bitmap, features, paintMs: performance.now() - started, empty: data.buffer.byteLength === 0 }, [bitmap]);
  } catch (error) {
    scope.postMessage({ id: data.id, error: String(error), features: 0, paintMs: performance.now() - started, empty: false }, []);
  }
};
