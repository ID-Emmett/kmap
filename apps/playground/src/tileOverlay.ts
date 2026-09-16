import type { Map3D } from '@kmap/map3d';

/** 按有效裁剪区域显示编号与 z/x/y；关闭时解除逐帧观察。 */
export function createTileOverlay(map: Map3D) {
  let canvas: HTMLCanvasElement | undefined; let unsubscribe: (() => void) | undefined;
  const close = () => { unsubscribe?.(); unsubscribe = undefined; canvas?.remove(); canvas = undefined; };
  return { close, toggle() {
    if (canvas) { close(); return false; }
    canvas = document.createElement('canvas'); canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2';
    canvas.setAttribute('aria-label', '可见瓦片编号和数据层级'); document.body.append(canvas);
    let last = -Infinity;
    unsubscribe = map.observeFrames(() => {
      const now = performance.now(); if (now - last < 80 || !canvas) return; last = now;
      const d = map.getTileDebug(); if (canvas.width !== d.width || canvas.height !== d.height) { canvas.width = d.width; canvas.height = d.height; }
      const c = canvas.getContext('2d')!; c.clearRect(0, 0, d.width, d.height); c.font = '12px monospace'; c.lineWidth = 1;
      for (const cell of d.cells) {
        c.strokeStyle = `hsl(${cell.z * 59 % 360} 85% 32%)`; c.beginPath();
        cell.polygon.forEach((p, i) => { if (i) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y); }); c.closePath(); c.stroke();
        const { x, y } = cell.center; if (x < 0 || x > d.width || y < 0 || y > d.height) continue;
        const label = `#${cell.id} z${cell.source}`; const w = c.measureText(label).width;
        c.fillStyle = '#ffffffed'; c.fillRect(x - w / 2 - 4, y - 12, w + 8, 18);
        c.fillStyle = '#163a36'; c.fillText(label, x - w / 2, y);
      }
      c.fillStyle = '#ffffffed'; c.fillRect(12, d.height - 40, 480, 28); c.fillStyle = '#163a36';
      c.fillText(`有效区域 ${d.cells.length} · 来源 ${d.sources} · 编号 / z / x / y`, 20, d.height - 21);
    });
    return true;
  } };
}
