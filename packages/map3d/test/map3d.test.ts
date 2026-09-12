import { readFile } from 'node:fs/promises';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const rendererInstances: MockWebGPURenderer[] = [];

class MockWebGPURenderer {
  readonly backend = { isWebGPUBackend: true };
  animationLoop: (() => void) | null = null;
  initCount = 0;
  disposeCount = 0;
  pixelRatio = 1;
  size = { width: 0, height: 0 };

  constructor() {
    rendererInstances.push(this);
  }

  async init(): Promise<void> {
    this.initCount += 1;
  }

  setPixelRatio(value: number): void {
    this.pixelRatio = value;
  }

  setSize(width: number, height: number): void {
    this.size = { width, height };
  }

  setAnimationLoop(callback: (() => void) | null): void {
    this.animationLoop = callback;
  }

  render(): void {}

  dispose(): void {
    this.disposeCount += 1;
  }
}

vi.mock('three/webgpu', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three/webgpu')>();
  return {
    ...actual,
    WebGPURenderer: MockWebGPURenderer,
  };
});

const { Map3D } = await import('../src/Map3D.js');
const { createTileBuildWorkerRuntime } = await import(
  '../src/worker/runtime.js'
);
type MapInstance = InstanceType<typeof Map3D>;

class MockCanvas {
  readonly #listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListener): void {
    let listeners = this.#listeners.get(type);
    if (listeners === undefined) {
      listeners = new Set();
      this.#listeners.set(type, listeners);
    }
    listeners.add(listener);
  }

  removeEventListener(type: string, listener: EventListener): void {
    const listeners = this.#listeners.get(type);
    listeners?.delete(listener);
    if (listeners?.size === 0) {
      this.#listeners.delete(type);
    }
  }

  setPointerCapture(): void {}

  hasPointerCapture(): boolean {
    return false;
  }

  releasePointerCapture(): void {}
}

class MockWorker {
  static readonly instances: MockWorker[] = [];
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  readonly #runtime = createTileBuildWorkerRuntime((message, transfer) => {
    const cloned = structuredClone(message, { transfer });
    queueMicrotask(() => {
      this.onmessage?.({ data: cloned } as MessageEvent<unknown>);
    });
  });

  constructor() {
    MockWorker.instances.push(this);
  }

  postMessage(message: unknown, transfer: Transferable[] = []): void {
    if (this.terminated) {
      throw new Error('Worker 已终止。');
    }
    const cloned = structuredClone(message, { transfer });
    this.#runtime.handleMessage(cloned);
  }

  terminate(): void {
    this.terminated = true;
  }
}

const SOURCE = {
  id: 'test-source',
  tiles: ['https://tiles.example.test/{z}/{x}/{y}.pbf'],
  minZoom: 15,
  maxZoom: 15,
} as const;

const VIEW = {
  center: { lng: 116.3946533203125, lat: 39.90552253972854 },
  zoom: 15,
  bearing: 0,
  pitch: 0,
} as const;

function createMap(): MapInstance {
  return new Map3D({
    canvas: new MockCanvas() as unknown as HTMLCanvasElement,
    source: SOURCE,
    layers: [
      {
        type: 'fill',
        id: 'water-fill',
        sourceLayer: 'water',
        paint: { color: '#155e75' },
      },
      {
        type: 'line',
        id: 'road-line',
        sourceLayer: 'road',
        paint: { color: '#f8fafc', width: 2 },
      },
    ],
    view: VIEW,
  });
}

async function readFixture(): Promise<ArrayBuffer> {
  const bytes = await readFile(
    new URL('./fixtures/kye-main-z15-26978-12416.mvt', import.meta.url),
  );
  return new Uint8Array(bytes).slice().buffer;
}

describe('Map3D dynamic runtime integration', () => {
  beforeEach(() => {
    rendererInstances.length = 0;
    MockWorker.instances.length = 0;
    vi.stubGlobal('Worker', MockWorker as unknown as typeof Worker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('提交初始 Coverage，转发 idle/stats，并动态响应 setView', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const map = createMap();
    const load = vi.fn();
    const idle = vi.fn();
    const stats = vi.fn();
    const viewchange = vi.fn();
    map.on('load', load);
    map.on('idle', idle);
    map.on('stats', stats);
    map.on('viewchange', viewchange);

    map.resize({ width: 800, height: 600, pixelRatio: 2 });
    await map.initialize();

    expect(load).toHaveBeenCalledWith({ backend: 'webgpu' });
    expect(idle).toHaveBeenCalled();
    expect(stats).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalled();
    expect(map.getStats().tiles.visible).toBeGreaterThan(0);

    map.setView({ zoom: 15.5, bearing: 25, pitch: 20 });
    expect(viewchange).toHaveBeenCalledWith({ view: map.getView() });
    expect(map.getView()).toMatchObject({ zoom: 15.5, bearing: 25, pitch: 20 });

    map.dispose();
    expect(rendererInstances[0]?.disposeCount).toBe(1);
    expect(map.getStats()).toMatchObject({
      tiles: { visible: 0 },
      resources: {
        cpuBytes: 0,
        gpuBytes: 0,
        batches: 0,
        features: 0,
        vertices: 0,
        indices: 0,
        objects: 0,
      },
      workers: { active: 0, queued: 0 },
    });
    expect(() => map.setView({ zoom: 14 })).toThrowError('Map3D 已销毁。');
    await expect(map.initialize()).rejects.toMatchObject({ code: 'MAP_DISPOSED' });
  });

  it('转发不可恢复 Tile 错误，且错误 Tile 不阻塞 initialize', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    const map = createMap();
    const errors = vi.fn();
    map.on('error', errors);

    await map.initialize();

    expect(errors).toHaveBeenCalled();
    expect(errors.mock.calls[0]?.[0]).toMatchObject({
      code: 'HTTP_ERROR',
      phase: 'request',
      recoverable: false,
    });
    expect(map.getStats().tiles.failed).toBeGreaterThan(0);
    map.dispose();
  });

  it('通过真实 Worker runtime 构建 Polygon/Line batch 并在 dispose 时终止 Worker', async () => {
    const fixture = await readFixture();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(fixture.slice(0), {
          status: 200,
          headers: { 'content-type': 'application/x-protobuf' },
        })),
    );
    const map = createMap();

    await map.initialize();

    const stats = map.getStats();
    expect(stats.resources.batches).toBeGreaterThan(0);
    expect(stats.resources.vertices).toBeGreaterThan(0);
    expect(stats.resources.indices).toBeGreaterThan(0);
    expect(stats.resources.features).toBeGreaterThan(0);
    expect(MockWorker.instances.length).toBeGreaterThan(0);

    map.dispose();
    expect(MockWorker.instances.every((worker) => worker.terminated)).toBe(true);
  });
});
