import { decodeTileSources } from './tileSources.js';
import { buildBuildings } from './buildings.js';
import { buildLines } from './lines.js';
import { buildFills } from './fills.js';
import { buildLabels } from '../labels/candidates.js';
import type { PaintRequest, PaintResponse } from './protocol.js';
const scope = self as unknown as { onmessage: ((event: MessageEvent<PaintRequest>) => void) | null; postMessage: (message: PaintResponse, transfer: Transferable[]) => void };
scope.onmessage = ({ data }) => {
  const started = performance.now();
  try {
    const tile = decodeTileSources(data.buffer, data.address, data.overlays);
    const fills = buildFills(tile, data.layers); const lines = buildLines(tile, data.layers);
    const buildings = buildBuildings(tile, data.layers, data.address);
    const labels = buildLabels(tile, data.layers);
    // 一像素背景纹理使区域面与数据几何拥有统一的资源生命周期。
    const canvas = new OffscreenCanvas(1, 1); const context = canvas.getContext('2d', { alpha: false })!;
    context.fillStyle = data.background; context.fillRect(0, 0, 1, 1);
    const bitmap = canvas.transferToImageBitmap();
    scope.postMessage({ id: data.id, bitmap, lines, fills, buildings, labels, features: fills.features + lines.features + buildings.features + labels.length, paintMs: performance.now() - started, empty: data.buffer.byteLength === 0 },
      [bitmap, lines.segments.buffer, lines.styles.buffer, lines.colors.buffer, lines.distances.buffer, buildings.positions.buffer, buildings.normals.buffer, buildings.colors.buffer, buildings.styles.buffer, buildings.indices.buffer, fills.positions.buffer, fills.colors.buffer, fills.styles.buffer, fills.indices.buffer]);
  } catch (error) {
    scope.postMessage({ id: data.id, error: String(error), features: 0, paintMs: performance.now() - started, empty: false }, []);
  }
};
