import { decodeVectorTile } from '../streaming/paint.js';

/** 根瓦片的陆地覆盖、水面与积雪在 Worker 栅格化为有界的 Mercator 图集。 */
self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
  try {
    const tile = decodeVectorTile(event.data), size = 2048;
    const canvas = new OffscreenCanvas(size, size), context = canvas.getContext('2d', { alpha: false })!;
    context.fillStyle = '#BDCDAF'; context.fillRect(0, 0, size, size);
    for (const name of ['landcover_0', 'landcover', 'water']) {
      const layer = tile.layers[name]; if (!layer) continue;
      for (let i = 0; i < layer.length; i++) {
        const feature = layer.feature(i); if (feature.type !== 3) continue;
        const kind = String(feature.properties.class);
        context.fillStyle = name === 'water' ? '#417D98' : ['snow', 'ice'].includes(kind) ? '#E9F1EE' : kind === 'wood' ? '#96B49D' : '#C5D3B8';
        context.beginPath();
        for (const ring of feature.loadGeometry()) {
          ring.forEach((p, j) => { const x = p.x / layer.extent * size, y = p.y / layer.extent * size; if (!j) context.moveTo(x, y); else context.lineTo(x, y); });
          context.closePath();
        }
        context.fill('evenodd');
      }
    }
    const bitmap = canvas.transferToImageBitmap(); self.postMessage({ bitmap }, { transfer: [bitmap] });
  } catch (error) { self.postMessage({ error: String(error) }); }
};
