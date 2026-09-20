import { describe, expect, it } from 'vitest';
import { PatchGeometry } from '../src/streaming/patchGeometry.js';
import { selectMapOrigin } from '../src/spatial/mapOrigin.js';

describe('模板公共边坐标', () => {
  it('父级剩余区域与邻接子级使用逐位相同的世界坐标', () => {
    const parent = new PatchGeometry(), child = new PatchGeometry();
    parent.update({ z: 6, x: 53, y: 27 }, [{ z: 7, x: 106, y: 55 }]);
    child.update({ z: 7, x: 107, y: 55 }, [{ z: 7, x: 107, y: 55 }]);
    for (const zoom of [7, 10, 17, 20]) {
      const origin = selectMapOrigin({ lng: 121.3, lat: 23.5 }, zoom);
      parent.updateWorld(origin); child.updateWorld(origin);
      const a = parent.getAttribute('maskPosition'), b = child.getAttribute('maskPosition');
      expect([a.getX(2), a.getZ(2), a.getX(3), a.getZ(3)]).toEqual([b.getX(0), b.getZ(0), b.getX(1), b.getZ(1)]);
    }
    parent.dispose(); child.dispose();
  });
});
