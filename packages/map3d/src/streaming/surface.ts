import { Color, Mesh, MeshBasicNodeMaterial, PlaneGeometry, SRGBColorSpace, Texture, Vector2, type Scene } from 'three/webgpu';
import { fog, positionWorld, smoothstep, uniform } from 'three/tsl';
import type { MapOrigin } from '../spatial/types.js';
import { tileBounds, type Address } from './address.js';
import { createLineSurface } from './lineSurface.js';
import { lineBytes, type LineData } from './lines.js';

/** 所有瓦片共享平面几何和雾参数，每张纹理对应一个绘制对象。 */
export class TileSurfaces {
  readonly geometry = new PlaneGeometry(1, 1);
  readonly fogCenter = uniform(new Vector2());
  readonly fogStart = uniform(1);
  readonly fogEnd = uniform(2);
  readonly fogColor;
  constructor(readonly scene: Scene, background: Color) {
    this.fogColor = uniform(background);
    scene.fogNode = fog(this.fogColor, smoothstep(this.fogStart, this.fogEnd, positionWorld.xz.sub(this.fogCenter).length()));
    this.geometry.rotateX(-Math.PI / 2);
    const uv = this.geometry.attributes.uv!;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  }
  create(bitmap: ImageBitmap, address: Address, data?: LineData) {
    const map = new Texture(bitmap); map.colorSpace = SRGBColorSpace;
    map.flipY = false; map.generateMipmaps = true; map.anisotropy = 4; map.needsUpdate = true;
    const material = new MeshBasicNodeMaterial({ map, depthTest: false, depthWrite: false, transparent: true });
    material.opacity = 1;
    const mesh = new Mesh(this.geometry, material);
    mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = address.z * 2;
    const lines = data?.segments.length ? createLineSurface(data) : undefined;
    if (lines) { lines.mesh.renderOrder = address.z * 2 + 1; mesh.add(lines.mesh); }
    this.scene.add(mesh);
    return { mesh, map, bitmap, lines, bytes: Math.ceil(bitmap.width * bitmap.height * 4 * 4 / 3) + lineBytes(data), cpuBytes: bitmap.width * bitmap.height * 4 + lineBytes(data) };
  }
  place(mesh: Mesh, address: Address, origin: MapOrigin): void {
    const b = tileBounds(address);
    mesh.position.set(b.west + b.span / 2 - origin.meters.x, 0, origin.meters.y - b.north + b.span / 2);
    mesh.scale.set(b.span, 1, b.span);
    mesh.updateMatrix();
  }
  release(surface: Surface): void {
    surface.lines?.mesh.geometry.dispose(); surface.lines?.mesh.material.dispose();
    this.scene.remove(surface.mesh); surface.mesh.material.dispose(); surface.map.dispose(); surface.bitmap.close();
  }
  dispose(): void { this.geometry.dispose(); }
}
export type Surface = ReturnType<TileSurfaces['create']>;
