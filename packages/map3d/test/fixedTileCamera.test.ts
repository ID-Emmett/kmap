import { PerspectiveCamera } from 'three/webgpu';
import { describe, expect, it } from 'vitest';

import { frameFixedTileCamera } from '../src/rendering/fixedTileCamera.js';

describe('frameFixedTileCamera', () => {
  it('保持北向屏幕上方并按窄边完整容纳 Tile', () => {
    const camera = new PerspectiveCamera(45, 2, 0.1, 1000);

    frameFixedTileCamera(camera, 1000, 2);
    const landscapeDistance = camera.position.y;

    expect(camera.position.x).toBe(0);
    expect(camera.position.z).toBe(0);
    expect(camera.up.toArray()).toEqual([0, 0, -1]);
    expect(camera.near).toBeGreaterThan(0);
    expect(camera.far).toBeGreaterThan(landscapeDistance);

    frameFixedTileCamera(camera, 1000, 0.5);
    expect(camera.position.y).toBeGreaterThan(landscapeDistance);
  });
});
