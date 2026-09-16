import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { PerspectiveCamera, Scene, WebGPURenderer } from 'three/webgpu';
import { createLineSurface } from '../src/streaming/lineSurface.js';
import { GlyphAtlas } from '../src/labels/glyphAtlas.js';
import { LabelSurface } from '../src/labels/labelSurface.js';
import { GlobeView } from '../src/globe/globeView.js';
import type { Map3DOptions } from '../src/types.js';
import type { Object3D } from 'three/webgpu';

interface ShaderBuilder { camera: PerspectiveCamera; scene: Scene; build(): unknown; vertexShader: string; fragmentShader: string }

describe('TSL 双后端源码生成', () => {
  it.each(['webgpu', 'webgl2'] as const)('%s 的线、字形与地球节点图生成完整着色器', backend => {
    const canvas = { width: 800, height: 600, style: {}, addEventListener() {}, removeEventListener() {} } as unknown as HTMLCanvasElement;
    const renderer = new WebGPURenderer({ canvas, forceWebGL: backend === 'webgl2' });
    renderer.hasFeature = () => false;
    Object.assign(renderer.backend, { capabilities: { getUniformBufferLimit: () => 65536 }, extensions: { has: () => false } });
    const line = createLineSurface({ segments: new Float32Array([0, 0, .25, .25]), styles: new Float32Array([0, 1, 0, 24]),
      distances: new Float32Array([.25]), colors: new Float32Array([1, 1, 1]), paints: [{ color: '#fff', width: 5, dashArray: [2, 3] }] });
    const atlas = new GlyphAtlas({ glyphs: '', fontStack: '' }), label = new LabelSurface(atlas);
    const globe = new GlobeView({ canvas, source: { id: 'test', tiles: ['https://example.test/{z}/{x}/{y}'], minZoom: 0, maxZoom: 17 }, layers: [] } as Map3DOptions);
    const curvedLine = createLineSurface(line.data, true);
    const themedLine = createLineSurface(line.data, true, true);
    const objects = [line.mesh, curvedLine.mesh, themedLine.mesh, label.mesh, ...globe.scene.children];
    for (const object of objects) {
      const backendBuilder = renderer.backend as typeof renderer.backend & { createNodeBuilder(object: Object3D, renderer: WebGPURenderer): ShaderBuilder };
      const builder = backendBuilder.createNodeBuilder(object, renderer);
      builder.camera = new PerspectiveCamera(); builder.scene = new Scene(); builder.build();
      if (process.env.KMAP_SHADER_EVIDENCE) {
        mkdirSync('../../docs/evidence/map-stability/shaders', { recursive: true });
        for (const stage of ['vertex', 'fragment'] as const) writeFileSync(`../../docs/evidence/map-stability/shaders/${backend}-${objects.indexOf(object)}-${stage}.txt`, builder[`${stage}Shader`] ?? '');
      }
      expect(builder.vertexShader).toContain('main'); expect(builder.fragmentShader).toContain('main');
      if (object === line.mesh) {
        expect(builder.fragmentShader).toContain(backend === 'webgpu' ? '@interpolate( flat )' : 'flat');
        expect(builder.fragmentShader).not.toMatch(/\[\s*uint\(/);
      }
    }
    themedLine.mesh.geometry.dispose(); themedLine.mesh.material.dispose();
    curvedLine.mesh.geometry.dispose(); curvedLine.mesh.material.dispose();
    line.mesh.geometry.dispose(); line.mesh.material.dispose(); label.dispose(); atlas.dispose(); globe.dispose();
  });
});
