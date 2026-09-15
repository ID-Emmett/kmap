import { Map3D } from '@kmap/map3d';
import { describe, expect, it } from 'vitest';

describe('Playground workspace dependency', () => {
  it('从 @kmap/map3d 导入 SDK 入口', () => {
    expect(Map3D).toBeTypeOf('function');
  });
});
