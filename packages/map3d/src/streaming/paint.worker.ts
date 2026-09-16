import { decodeVectorTile } from './paint.js';
import { buildLines } from './lines.js';
import { buildFills } from './fills.js';
import type { PaintRequest, PaintResponse } from './protocol.js';
const scope = self as unknown as { onmessage: ((event: MessageEvent<PaintRequest>) => void) | null; postMessage: (message: PaintResponse, transfer: Transferable[]) => void };
scope.onmessage = ({ data }) => {
  const started = performance.now();
  try {
    const tile = decodeVectorTile(data.buffer);
    const fills = buildFills(tile, data.layers); const lines = buildLines(tile, data.layers);
    // 一像素背景纹理使区域面与数据几何拥有统一的资源生命周期。
    const canvas = new OffscreenCanvas(1, 1); const context = canvas.getContext('2d', { alpha: false })!;
    context.fillStyle = data.background; context.fillRect(0, 0, 1, 1);
    const bitmap = canvas.transferToImageBitmap();
    scope.postMessage({ id: data.id, bitmap, lines, fills, features: fills.features + lines.features, paintMs: performance.now() - started, empty: data.buffer.byteLength === 0 },
      [bitmap, lines.segments.buffer, lines.styles.buffer, lines.colors.buffer, fills.positions.buffer, fills.colors.buffer, fills.styles.buffer, fills.indices.buffer]);
  } catch (error) {
    scope.postMessage({ id: data.id, error: String(error), features: 0, paintMs: performance.now() - started, empty: false }, []);
  }
};
