import { BufferGeometry, DoubleSide, Float32BufferAttribute, LinearFilter, LinearMipmapLinearFilter, Mesh, MeshBasicNodeMaterial, Scene, Texture, Uint16BufferAttribute } from 'three/webgpu';
import { attribute, texture as textureNode } from 'three/tsl';
import type { MapOrigin } from '../spatial/types.js';
import type { Address } from '../streaming/address.js';
import { tileBounds } from '../streaming/address.js';
import { maskVertex } from '../streaming/maskVertex.js';
import { sourceRect } from './rasterMath.js';

export interface RasterDraw {
  key: string;
  source: Address;
  cell: Address;
  mesh: Mesh<BufferGeometry, MeshBasicNodeMaterial>;
}

/** 独立影像面使用与矢量模板相同的半设备像素边缘覆盖。 */
export function createRasterDraw(scene: Scene, key: string, source: Address, cell: Address, tile: Texture, origin: MapOrigin): RasterDraw {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(12, 3));
  geometry.setAttribute('maskPosition', new Float32BufferAttribute(12, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute([0, 0, 0, 1, 1, 0, 1, 1], 2));
  geometry.setAttribute('sourceUv', new Float32BufferAttribute(8, 2));
  geometry.setIndex(new Uint16BufferAttribute([0, 1, 2, 1, 3, 2], 1));
  const material = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false, side: DoubleSide });
  material.vertexNode = maskVertex();
  material.colorNode = textureNode(tile, attribute<'vec2'>('sourceUv', 'vec2'));
  material.toneMapped = false;
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.renderOrder = 0;
  mesh.userData.maskSpan = tileBounds(cell).span;
  const draw = { key, source, cell, mesh };
  placeRasterDraw(draw, origin);
  scene.add(mesh);
  return draw;
}

export function placeRasterDraw(draw: RasterDraw, origin: MapOrigin): void {
  const bounds = tileBounds(draw.cell);
  const left = bounds.west - origin.meters.x;
  const right = bounds.west + bounds.span - origin.meters.x;
  const top = origin.meters.y - bounds.north;
  const bottom = origin.meters.y - (bounds.north - bounds.span);
  const position = [left, 0, top, left, 0, bottom, right, 0, top, right, 0, bottom];
  for (const name of ['position', 'maskPosition']) {
    const attribute = draw.mesh.geometry.getAttribute(name) as Float32BufferAttribute;
    attribute.array.set(position); attribute.needsUpdate = true;
  }
  const rect = sourceRect(draw.source, draw.cell);
  const uv = draw.mesh.geometry.getAttribute('sourceUv') as Float32BufferAttribute;
  uv.array.set([rect.u0, 1 - rect.v0, rect.u0, 1 - rect.v1, rect.u1, 1 - rect.v0, rect.u1, 1 - rect.v1]);
  uv.needsUpdate = true;
}

export function releaseRasterDraw(draw: RasterDraw): void {
  draw.mesh.removeFromParent();
  draw.mesh.geometry.dispose();
  draw.mesh.material.dispose();
}

/** 图片翻转在解码阶段完成；mipmap 缩小采样与线性放大采样用于连续缩放。 */
export function configureRasterTexture(texture: Texture): void {
  texture.flipY = false;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
}
