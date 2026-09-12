import {
  Color,
  DoubleSide,
  MeshBasicNodeMaterial,
  TSL,
} from 'three/webgpu';

import type {
  LineMaterialDescriptor,
  PolygonMaterialDescriptor,
} from '../geometry/types.js';
import type { HorizonFadeParameters } from './horizonFade.js';
import { DISABLED_HORIZON_FADE } from './horizonFade.js';

interface MaterialEntry {
  descriptor: PolygonMaterialDescriptor | LineMaterialDescriptor;
  material: MeshBasicNodeMaterial;
  references: number;
}

export interface MaterialRegistryStats {
  materials: number;
  references: number;
}

/** 按稳定 material key 共享平面 Polygon 材质并维护引用计数。 */
export class MaterialRegistry {
  readonly #entries = new Map<string, MaterialEntry>();
  readonly #horizonFade = createHorizonFadeUniforms();

  acquire(descriptor: PolygonMaterialDescriptor): MeshBasicNodeMaterial {
    const existing = this.#entries.get(descriptor.key);

    if (existing !== undefined) {
      assertDescriptorMatches(existing.descriptor, descriptor);
      existing.references += 1;
      return existing.material;
    }

    const material = new MeshBasicNodeMaterial({
      color: descriptor.color,
      opacity: descriptor.opacity,
      transparent: descriptor.opacity < 1,
      side: DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    material.name = `nova-polygon:${descriptor.key}`;
    applyHorizonFadeNode(material, this.#horizonFade);
    this.#entries.set(descriptor.key, {
      descriptor,
      material,
      references: 1,
    });
    return material;
  }

  acquireLine(descriptor: LineMaterialDescriptor): MeshBasicNodeMaterial {
    const existing = this.#entries.get(descriptor.key);

    if (existing !== undefined) {
      assertDescriptorMatches(existing.descriptor, descriptor);
      existing.references += 1;
      return existing.material;
    }

    const material = new MeshBasicNodeMaterial({
      color: descriptor.color,
      opacity: descriptor.opacity,
      transparent: descriptor.opacity < 1,
      side: DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    material.name = `nova-line:${descriptor.key}`;
    material.vertexNode = createLineVertexNode(descriptor.width);
    applyHorizonFadeNode(material, this.#horizonFade);
    this.#entries.set(descriptor.key, {
      descriptor,
      material,
      references: 1,
    });
    return material;
  }

  release(key: string): void {
    const entry = this.#entries.get(key);

    if (entry === undefined) {
      throw new Error(`Material ${key} 没有可释放的引用。`);
    }

    entry.references -= 1;

    if (entry.references === 0) {
      entry.material.dispose();
      this.#entries.delete(key);
    }
  }

  setHorizonFade(parameters: HorizonFadeParameters, color: Color): void {
    this.#horizonFade.start.value = parameters.start;
    this.#horizonFade.end.value = parameters.end;
    this.#horizonFade.strength.value = parameters.strength;
    this.#horizonFade.color.value.copy(color);
  }

  getHorizonFade(): HorizonFadeParameters & {
    color: { r: number; g: number; b: number };
  } {
    return {
      start: this.#horizonFade.start.value,
      end: this.#horizonFade.end.value,
      strength: this.#horizonFade.strength.value,
      color: {
        r: this.#horizonFade.color.value.r,
        g: this.#horizonFade.color.value.g,
        b: this.#horizonFade.color.value.b,
      },
    };
  }

  dispose(): void {
    for (const entry of this.#entries.values()) {
      entry.material.dispose();
    }
    this.#entries.clear();
    this.setHorizonFade(DISABLED_HORIZON_FADE, new Color(0));
  }

  getStats(): MaterialRegistryStats {
    let references = 0;

    for (const entry of this.#entries.values()) {
      references += entry.references;
    }

    return { materials: this.#entries.size, references };
  }
}

function createHorizonFadeUniforms() {
  const { uniform } = TSL;

  return {
    start: uniform(DISABLED_HORIZON_FADE.start).setName('novaHorizonFadeStart'),
    end: uniform(DISABLED_HORIZON_FADE.end).setName('novaHorizonFadeEnd'),
    strength: uniform(DISABLED_HORIZON_FADE.strength).setName(
      'novaHorizonFadeStrength',
    ),
    color: uniform(new Color(0), 'color').setName('novaHorizonFadeColor'),
  };
}

function applyHorizonFadeNode(
  material: MeshBasicNodeMaterial,
  uniforms: ReturnType<typeof createHorizonFadeUniforms>,
): void {
  const { materialColor, mix, positionView, smoothstep } = TSL;
  const viewDepth = positionView.z.negate();
  const factor = smoothstep(uniforms.start, uniforms.end, viewDepth)
    .mul(uniforms.strength)
    .clamp(0, 1);
  material.colorNode = mix(materialColor, uniforms.color, factor);
}

function assertDescriptorMatches(
  expected: PolygonMaterialDescriptor | LineMaterialDescriptor,
  received: PolygonMaterialDescriptor | LineMaterialDescriptor,
): void {
  if (
    expected.color !== received.color ||
    expected.opacity !== received.opacity ||
    ('width' in expected ? expected.width : undefined) !==
      ('width' in received ? received.width : undefined)
  ) {
    throw new Error(`Material key ${received.key} 对应了不同的材质参数。`);
  }
}

function createLineVertexNode(width: number) {
  const {
    attribute,
    cameraProjectionMatrix,
    modelViewMatrix,
    screenDPR,
    vec2,
    vec4,
    viewport,
  } = TSL;
  const current = attribute<'vec3'>('position', 'vec3');
  const previous = attribute<'vec3'>('previous', 'vec3');
  const next = attribute<'vec3'>('next', 'vec3');
  const side = attribute<'float'>('side', 'float');
  const currentClip = cameraProjectionMatrix.mul(
    modelViewMatrix.mul(vec4(current, 1)),
  );
  const previousClip = cameraProjectionMatrix.mul(
    modelViewMatrix.mul(vec4(previous, 1)),
  );
  const nextClip = cameraProjectionMatrix.mul(
    modelViewMatrix.mul(vec4(next, 1)),
  );
  const currentNdc = currentClip.xy.div(currentClip.w);
  const previousNdc = previousClip.xy.div(previousClip.w);
  const nextNdc = nextClip.xy.div(nextClip.w);
  const aspect = viewport.z.div(viewport.w);
  const incoming = currentNdc.sub(previousNdc).mul(vec2(aspect, 1)).normalize();
  const outgoing = nextNdc.sub(currentNdc).mul(vec2(aspect, 1)).normalize();
  const tangentSum = incoming.add(outgoing);
  const tangent = tangentSum
    .length()
    .greaterThan(1e-6)
    .select(tangentSum.normalize(), outgoing);
  const normal = vec2(tangent.y.negate(), tangent.x);
  const denominator = normal
    .dot(vec2(incoming.y.negate(), incoming.x))
    .abs()
    .max(0.5);
  const pixelOffset = normal.mul(side).mul(width * 0.5).div(denominator);
  const ndcOffset = pixelOffset
    .mul(vec2(screenDPR.div(viewport.z), screenDPR.div(viewport.w)))
    .mul(2);
  return currentClip.add(vec4(ndcOffset.mul(currentClip.w), 0, 0));
}
