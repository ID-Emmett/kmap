import type { Frustum } from 'three/webgpu';

/** 地面矩形逐平面裁剪后计算雾距离，精确处理视锥与雾边界的共同可见域。 */
export function groundVisibility(frustum: Frustum, camera: Readonly<{ x: number; y: number; z: number }>, cutoff: number) {
  let input = new Float64Array(32); let output = new Float64Array(32);
  const radiusSquared = cutoff * cutoff - camera.y * camera.y;
  return (x: number, z: number, span: number): boolean => {
    input.set([x, z, x + span, z, x + span, z + span, x, z + span]); let count = 4;
    for (const plane of frustum.planes) {
      let length = 0;
      for (let i = 0; i < count; i++) {
        const j = (i + count - 1) % count;
        const ax = input[j * 2]!; const az = input[j * 2 + 1]!;
        const bx = input[i * 2]!; const bz = input[i * 2 + 1]!;
        const da = plane.normal.x * ax + plane.normal.z * az + plane.constant;
        const db = plane.normal.x * bx + plane.normal.z * bz + plane.constant;
        if ((da >= 0) !== (db >= 0)) {
          const t = da / (da - db); output[length++] = ax + (bx - ax) * t; output[length++] = az + (bz - az) * t;
        }
        if (db >= 0) { output[length++] = bx; output[length++] = bz; }
      }
      count = length / 2; if (!count) return false;
      const temp = input; input = output; output = temp;
    }
    let inside = true;
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count; const ax = input[i * 2]!; const az = input[i * 2 + 1]!;
      const dx = input[j * 2]! - ax; const dz = input[j * 2 + 1]! - az;
      const px = camera.x - ax; const pz = camera.z - az;
      if (dx * pz - dz * px < 0) inside = false;
      const length = dx * dx + dz * dz;
      const t = length ? Math.max(0, Math.min(1, (px * dx + pz * dz) / length)) : 0;
      if ((px - t * dx) ** 2 + (pz - t * dz) ** 2 < radiusSquared) return true;
    }
    return inside && radiusSquared > 0;
  };
}
