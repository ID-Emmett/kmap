import { Vector3, type PerspectiveCamera } from 'three/webgpu';
import type { MapOrigin } from '../spatial/types.js';
import { contains, tileBounds } from './address.js';
import type { StreamingEngine } from './engine.js';

/** 显式诊断读取画布像素和原始面纹理；此操作包含同步 GPU 回读。 */
export function auditPixels(canvas: HTMLCanvasElement, camera: PerspectiveCamera, origin: MapOrigin, engine: StreamingEngine) {
  const width = 48, height = 27;
  const output = new OffscreenCanvas(width, height);
  const context = output.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(canvas, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const texture = new OffscreenCanvas(1, 1);
  const sourceContext = texture.getContext('2d', { willReadFrequently: true })!;
  const result = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const ray = new Vector3((x + .5) * 2 / width - 1, 1 - (y + .5) * 2 / height, .5).unproject(camera).sub(camera.position);
    if (ray.y >= 0) continue;
    const point = camera.position.clone().addScaledVector(ray, -camera.position.y / ray.y);
    const distance = point.distanceTo(camera.position);
    if (distance >= engine.selection.fogStart) continue;
    const world = 40075016.68557849;
    const position = { z: 23, x: Math.floor((point.x + origin.meters.x + world / 2) / world * 2 ** 23),
      y: Math.floor((world / 2 - origin.meters.y + point.z) / world * 2 ** 23) };
    const patch = engine.patches.find(p => contains(p.cell, position));
    if (!patch) continue;
    const entry = engine.entries.get(patch.key); const surface = entry?.surface;
    if (!surface) continue;
    const b = tileBounds(patch.source);
    const u = (point.x + origin.meters.x - b.west) / b.span, v = (b.north - origin.meters.y + point.z) / b.span;
    sourceContext.drawImage(surface.bitmap, Math.floor(u * surface.bitmap.width), Math.floor(v * surface.bitmap.height), 1, 1, 0, 0, 1, 1);
    const source = Array.from(sourceContext.getImageData(0, 0, 1, 1).data).slice(0, 3);
    const actual = Array.from(pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 3));
    // 蓝色面纹理被接近背景色的片元替代时，记录完整来源与材质裁剪状态。
    if (source[2]! - source[0]! > 35 && actual[0]! > 230 && actual[2]! - actual[0]! < 15) {
      const instance = engine.surfaces.instances.get(`${patch.source.z}/${patch.source.x}/${patch.source.y}`);
      result.push({ x, y, source, actual, patch, uv: [u, v], clipped: instance?.mesh.material.stencilWrite,
        stencilRef: instance?.mesh.material.stencilRef, matrix: instance?.mesh.matrixWorld.elements.slice() });
    }
  }
  return result;
}
