import { cameraPosition, float, mix, normalWorld, positionWorld, smoothstep, positionLocal, uniform } from 'three/tsl';
import { Color, Vector3, Mesh, MeshBasicNodeMaterial, Scene, SphereGeometry } from 'three/webgpu';
import type { MapPalette } from '../style/palette.js';
import type { MapTheme } from '../types.js';
import type { Map3DOptions } from '../types.js';
import type { ProjectionState } from './projection.js';

/** 球面的基础陆地色补齐 Mercator 极区，矢量瓦片在同一场景中覆盖其上。 */
export class GlobeView {
  private readonly north = uniform(new Vector3());
  private readonly land = uniform(new Color());
  private readonly water = uniform(new Color());
  private waterSource: string | number = '#A9D7E8';
  readonly mesh: Mesh<SphereGeometry, MeshBasicNodeMaterial>;
  constructor(options: Map3DOptions, readonly scene = new Scene()) {
    this.mesh = new Mesh(new SphereGeometry(1, 128, 64), new MeshBasicNodeMaterial({
      color: options.renderer?.backgroundColor ?? '#F5F5F2', depthTest: false, depthWrite: false, fog: false,
    }));
    const water = options.layers.find(layer => layer.type === 'fill' && layer.sourceLayer === 'water');
    this.waterSource = water?.paint.color ?? '#A9D7E8';
    this.land.value.set(options.renderer?.backgroundColor ?? '#F5F5F2'); this.water.value.set(this.waterSource);
    const facing = normalWorld.dot(cameraPosition.sub(positionWorld).normalize());
    this.mesh.material.colorNode = mix(mix(this.land, this.water, positionLocal.dot(this.north).greaterThan(0).select(1, 0)), this.land,
      float(1).sub(smoothstep(0, .16, facing)));
    this.mesh.renderOrder = -10; this.mesh.frustumCulled = false; this.mesh.visible = false; scene.add(this.mesh);
  }
  setTheme(theme: MapTheme, palette?: MapPalette): void {
    this.land.value.set(theme.backgroundColor); this.water.value.set(palette?.resolve(this.waterSource) ?? this.waterSource);
  }
  update(p: ProjectionState): void {
    this.mesh.visible = p.center.w >= .999;
    this.north.value.set(0, Math.sin(p.center.z), -Math.cos(p.center.z));
    this.mesh.position.set(p.center.x, -p.origin.w, p.center.y); this.mesh.scale.setScalar(p.origin.w);
  }
  dispose(): void { this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh.removeFromParent(); }
}
