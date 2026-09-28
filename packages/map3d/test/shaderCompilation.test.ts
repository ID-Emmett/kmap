import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Color, PerspectiveCamera, Scene, WebGPURenderer } from 'three/webgpu';
import { TileSurfaces } from '../src/streaming/surface.js';
import { createLineSurface } from '../src/streaming/lineSurface.js';
import { GlyphAtlas } from '../src/labels/glyphAtlas.js';
import { LabelSurface } from '../src/labels/labelSurface.js';
import type { Object3D } from 'three/webgpu';
import { MapPalette, paletteColors } from '../src/style/palette.js';

interface ShaderBuilder { camera: PerspectiveCamera; scene: Scene; build(): unknown; vertexShader: string; fragmentShader: string;
  updateNodes: { isBufferNode?: boolean; updateType: string; value: unknown; update(frame: unknown): unknown }[] }

describe('TSL 双后端源码生成', () => {
  it.each(['webgpu', 'webgl2'] as const)('%s 的线、字形、地面与模板节点图生成完整着色器', backend => {
    const canvas = { width: 800, height: 600, style: {}, addEventListener() {}, removeEventListener() {} } as unknown as HTMLCanvasElement;
    const renderer = new WebGPURenderer({ canvas, forceWebGL: backend === 'webgl2' });
    renderer.hasFeature = () => false;
    Object.assign(renderer.backend, { capabilities: { getUniformBufferLimit: () => 65536 }, extensions: { has: () => false } });
    const line = createLineSurface({ segments: new Float32Array([0, 0, .25, .25]), styles: new Float32Array([0, 1, 0, 24]),
      distances: new Float32Array([.25]), colors: new Float32Array([1, 1, 1]), paints: [{ color: '#fff', width: 5, dashArray: [2, 3] }] });
    const atlas = new GlyphAtlas({ glyphs: '', fontStack: '' }), label = new LabelSurface(atlas);
    // WebGPU 的最低设备规格允许最多八个顶点缓冲槽。
    const attributeBuffers = new Set(Object.values(label.mesh.geometry.attributes).map(a => 'data' in a ? a.data : a));
    expect(attributeBuffers.size).toBeLessThanOrEqual(8);
    const themedLine = createLineSurface(line.data, true);
    const surfaces = new TileSurfaces(new Scene(), new Color('#ffffff'));
    const mask = surfaces.create({ width: 1, height: 1, close() {} } as ImageBitmap, { z: 7, x: 106, y: 55 });
    const ground = surfaces.scene.children.find(o => o.renderOrder === -5)!;
    const objects = [line.mesh, themedLine.mesh, label.mesh, mask.mesh, ground];
    const palette = new MapPalette(); palette.values.fill(.25);
    for (const object of objects) {
      const backendBuilder = renderer.backend as typeof renderer.backend & { createNodeBuilder(object: Object3D, renderer: WebGPURenderer): ShaderBuilder };
      const builder = backendBuilder.createNodeBuilder(object, renderer);
      builder.camera = new PerspectiveCamera(); builder.scene = new Scene(); builder.scene.userData.mapPalette = palette;
      // 模拟一帧已绑定调色板、随后出现新材质编译的时序。
      paletteColors.value = palette.values; builder.build();
      expect(paletteColors.value).toBe(palette.values); expect(palette.values[0]).toBe(.25);
      if (process.env.KMAP_SHADER_EVIDENCE) {
        mkdirSync('../../docs/evidence/map-stability/shaders', { recursive: true });
        for (const stage of ['vertex', 'fragment'] as const) writeFileSync(`../../docs/evidence/map-stability/shaders/${backend}-${objects.indexOf(object)}-${stage}.txt`, builder[`${stage}Shader`] ?? '');
      }
      expect(builder.vertexShader).toContain('main'); expect(builder.fragmentShader).toContain('main');
      if (object === line.mesh) {
        expect(builder.fragmentShader).toContain(backend === 'webgpu' ? '@interpolate( flat )' : 'flat');
        expect(builder.fragmentShader).not.toMatch(/\[\s*uint\(/);
        line.widths[0] = .125;
        const buffers = builder.updateNodes.filter(node => node.isBufferNode && node.updateType === 'object');
        expect(buffers).toHaveLength(2);
        for (const node of buffers) node.update({ object });
        const values = buffers.map(node => node.value);
        const additional = createLineSurface(line.data);
        const next = backendBuilder.createNodeBuilder(additional.mesh, renderer);
        next.camera = builder.camera; next.scene = builder.scene; next.build();
        buffers.forEach((node, i) => expect(node.value).toBe(values[i]));
        expect(values).toContain(line.widths); expect(line.widths[0]).toBe(.125);
        additional.mesh.geometry.dispose(); additional.mesh.material.dispose();
      }
      // 地面覆盖全屏底色，必须使用 CPU 双精度合成的 modelViewMatrix。
      if (object === ground) expect(builder.vertexShader).toContain('highpModelViewMatrix');
    }
    themedLine.mesh.geometry.dispose(); themedLine.mesh.material.dispose();
    line.mesh.geometry.dispose(); line.mesh.material.dispose(); label.dispose(); atlas.dispose(); surfaces.release(mask); surfaces.dispose();
  });
});
