import { describe, expect, it } from 'vitest';

import { normalizeViewport } from '../src/rendering/viewport.js';

describe('normalizeViewport', () => {
  it('限制无效尺寸和过高像素比', () => {
    expect(
      normalizeViewport({ width: 0, height: Number.NaN, pixelRatio: 3 }),
    ).toEqual({ width: 1, height: 1, pixelRatio: 2 });
  });
});
