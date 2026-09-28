import { cameraProjectionMatrix, highpModelViewMatrix, vec4 } from 'three/tsl';
import type { Node } from 'three/webgpu';

/** 平面顶点变换使用 CPU 双精度合成的 modelViewMatrix，避免高倍缩放时相减消减。 */
export function mapVertex(position: Node<'vec3'>): Node<'vec4'> {
  return cameraProjectionMatrix.mul(highpModelViewMatrix).mul(vec4(position, 1));
}
