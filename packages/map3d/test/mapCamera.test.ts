import {
  PerspectiveCamera,
  Vector3,
} from 'three/webgpu';
import { describe, expect, it } from 'vitest';

import {
  intersectCameraRayWithGround,
  mercatorPointToScene,
  updateMapCamera,
} from '../src/rendering/mapCamera.js';
import { projectLngLat } from '../src/spatial/mercator.js';
import { selectMapOrigin } from '../src/spatial/mapOrigin.js';
import { normalizeViewState } from '../src/spatial/viewState.js';

describe('Map camera', () => {
  it('保持 ViewState center 位于屏幕中心并按 zoom/viewport 缩放', () => {
    const view = normalizeViewState({
      center: { lng: 116.4, lat: 39.9 },
      zoom: 12,
      bearing: 0,
      pitch: 0,
    });
    const origin = selectMapOrigin(view.center, 12);
    const camera = new PerspectiveCamera();
    const frame = updateMapCamera(
      camera,
      view,
      { width: 800, height: 600 },
      origin,
    );
    const target = mercatorPointToScene(projectLngLat(view.center), origin);
    const projected = new Vector3(target.x, target.y, target.z).project(camera);

    expect(projected.x).toBeCloseTo(0, 10);
    expect(projected.y).toBeCloseTo(0, 10);
    expect(camera.up.toArray()).toEqual([0, 0, -1]);

    const taller = updateMapCamera(
      camera,
      view,
      { width: 800, height: 1200 },
      origin,
    );
    const zoomed = updateMapCamera(
      camera,
      { ...view, zoom: 13 },
      { width: 800, height: 600 },
      origin,
    );

    expect(taller.distance).toBeCloseTo(frame.distance * 2, 10);
    expect(zoomed.distance).toBeCloseTo(frame.distance / 2, 10);

    const extreme = updateMapCamera(
      camera,
      { ...view, zoom: 1000 },
      { width: 800, height: 600 },
      origin,
    );
    expect(extreme.distance).toBeGreaterThan(0);
    expect(Number.isFinite(extreme.distance)).toBe(true);
    expect(camera.near).toBeLessThan(extreme.distance);
    expect(camera.far).toBeGreaterThan(extreme.distance);
    expect(camera.projectionMatrix.elements.every(Number.isFinite)).toBe(true);
  });

  it('bearing/pitch 推导有限矩阵且地面射线有界', () => {
    const view = normalizeViewState({
      center: { lng: 179.8, lat: 10 },
      zoom: 4,
      bearing: 90,
      pitch: 60,
    });
    const origin = selectMapOrigin(view.center, 4);
    const camera = new PerspectiveCamera();
    const frame = updateMapCamera(
      camera,
      view,
      { width: 1920, height: 1080 },
      origin,
    );
    const top = intersectCameraRayWithGround(camera, 0, 1, 10_000_000);

    expect(frame.position.x).toBeLessThan(frame.target.x);
    expect(frame.position.y).toBeGreaterThan(0);
    expect(frame.up.x).toBeCloseTo(0.5, 10);
    expect(frame.up.y).toBeCloseTo(Math.sin(Math.PI / 3), 10);
    expect(top.y).toBeCloseTo(0, 10);
    expect(top.toArray().every(Number.isFinite)).toBe(true);
    expect(
      Math.hypot(
        top.x - camera.position.x,
        top.z - camera.position.z,
      ),
    ).toBeLessThanOrEqual(10_000_000.1);
  });

  it('MapOrigin 跨 Tile/zoom 重定位不改变全局点屏幕位置', () => {
    const view = normalizeViewState({
      center: { lng: 116.4074, lat: 39.9042 },
      zoom: 12.5,
      bearing: 28,
      pitch: 42,
    });
    const point = projectLngLat({ lng: 116.41, lat: 39.906 });
    const originA = selectMapOrigin(view.center, 12);
    const originB = selectMapOrigin(view.center, 13);
    const cameraA = new PerspectiveCamera();
    const cameraB = new PerspectiveCamera();
    updateMapCamera(cameraA, view, { width: 1280, height: 720 }, originA);
    updateMapCamera(cameraB, view, { width: 1280, height: 720 }, originB);
    const sceneA = mercatorPointToScene(point, originA);
    const sceneB = mercatorPointToScene(point, originB);
    const screenA = new Vector3(sceneA.x, 0, sceneA.z).project(cameraA);
    const screenB = new Vector3(sceneB.x, 0, sceneB.z).project(cameraB);

    expect(screenB.x).toBeCloseTo(screenA.x, 10);
    expect(screenB.y).toBeCloseTo(screenA.y, 10);
    expect(screenB.z).toBeCloseTo(screenA.z, 10);
  });
});
