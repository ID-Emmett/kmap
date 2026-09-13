import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

import {
  NovaTileEngine,
  MixedLODPlanner,
  TileResourceRegistry,
  canonicalTileKeyToString,
} from '../src/nova-tile/index.js';
import { TileCache } from '../src/nova-tile/cache/index.js';
import { TileFetchPipeline, NovaTilePipeline } from '../src/nova-tile/fetch/index.js';
import type { CanonicalTileKey } from '../src/nova-tile/index.js';
import type { ViewState } from '../src/types.js';

const source = {
  sourceId: 'fixture',
  sourceRevision: 'fixture-v1',
  minZoom: 0,
  maxZoom: 2,
  url: (key: CanonicalTileKey) => `fixture://${key.z}/${key.x}/${key.y}`,
} as const;

const initialView: ViewState = { center: { lng: 0, lat: 0 }, zoom: 1, bearing: 0, pitch: 0 };
const fixedMvtFixture = new Uint8Array(await readFile(new URL('./fixtures/kye-main-z15-26978-12416.mvt', import.meta.url)));

class FakeClock {
  value = 0;
  now(): number { return this.value; }
  advance(ms: number): void { this.value += ms; }
}

function planner(): MixedLODPlanner {
  return new MixedLODPlanner({ ...source, tileBudget: 4, refineThresholdPx: 1e9, mergeThresholdPx: 1e8 });
}

function createPipeline(options: { fetch?: typeof globalThis.fetch; workerDelayMs?: number } = {}) {
  const fetch = new TileFetchPipeline({
    fetch: options.fetch ?? (async () => new Response(fixedMvtFixture, { status: 200, headers: { 'content-type': 'application/x-protobuf' } })),
    baseBackoffMs: 0,
    sleep: async () => undefined,
  });
  return new NovaTilePipeline<{ fixture: string }, { fixture: string; bytes: number }>({
    fetch,
      worker: {
      run: async ({ data, signal }) => {
        if (options.workerDelayMs !== undefined) await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, options.workerDelayMs);
          signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal?.reason); }, { once: true });
        });
        return { fixture: 'ok', bytes: data.byteLength };
      },
    },
  });
}

async function settle(engine: NovaTileEngine<any, any, any>, clock: FakeClock, frame = 1): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    clock.advance(16);
    engine.frame({ frameId: frame + index, timeMs: clock.now(), deltaMs: 16 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
  }
}

describe('NovaTileEngine integration', () => {
  it('runs initialize, pan, zoom, pitch, bearing and dispose with complete cover', async () => {
    const clock = new FakeClock();
    const cache = new TileCache<{ fixture: string; bytes: number }>();
    const resources = new TileResourceRegistry<{ disposed: boolean }>({ releaseDelayFrames: 0 });
    const disposed: string[] = [];
    const engine = new NovaTileEngine({
      clock,
      source,
      planner: planner(),
      pipeline: createPipeline(),
      cache,
      resources,
      workerInput: () => ({ fixture: 'fixed' }),
      upload: (key, payload) => ({ resource: { disposed: false }, cpuBytes: payload.bytes, gpuBytes: payload.bytes * 2, dispose: () => disposed.push(canonicalTileKeyToString(key)) }),
      uploadBytes: (payload) => payload.bytes,
    });

    const plans: number[] = [];
    engine.on('plan', (event) => plans.push(event.planEpoch));
    await engine.initialize();
    engine.resize({ width: 640, height: 480 });
    engine.updateView(initialView);
    await settle(engine, clock);

    expect(engine.getStats().committed).toBe(1);
    expect(engine.getRenderCover()?.coverageComplete).toBe(true);
    expect(engine.getRenderCover()?.blankArea).toBe(0);

    for (const view of [
      { ...initialView, center: { lng: 0.1, lat: 0.05 } },
      { ...initialView, zoom: 1.5 },
      { ...initialView, pitch: 45 },
      { ...initialView, bearing: 30 },
    ]) {
      clock.advance(20);
      engine.updateView(view);
      await settle(engine, clock, plans.length + 2);
      expect(engine.getRenderCover()?.blankArea).toBe(0);
    }

    expect(plans.length).toBe(5);
    expect(engine.getTimeline().frames.length).toBeGreaterThan(0);
    await engine.dispose();
    expect(resources.stats.entries).toBe(0);
    expect(resources.stats.cpuBytes).toBe(0);
    expect(resources.stats.gpuBytes).toBe(0);
    expect(disposed.length).toBeGreaterThanOrEqual(1);
    expect(() => engine.updateView(initialView)).toThrow('已销毁');
  });

  it('keeps deterministic timeline and obtains a cache hit on a second engine', async () => {
    const clock = new FakeClock();
    const cache = new TileCache<{ fixture: string; bytes: number }>();
    const first = new NovaTileEngine({ clock, source, planner: planner(), pipeline: createPipeline(), cache, workerInput: () => ({ fixture: 'fixed' }) });
    await first.initialize();
    first.resize({ width: 320, height: 240 });
    first.updateView(initialView);
    await settle(first, clock);
    const firstTimeline = first.getTimeline();
    await first.dispose();

    const second = new NovaTileEngine({ clock, source, planner: planner(), pipeline: createPipeline(), cache, workerInput: () => ({ fixture: 'fixed' }) });
    await second.initialize();
    second.resize({ width: 320, height: 240 });
    second.updateView(initialView);
    await settle(second, clock, 20);
    expect(cache.stats.readyHits).toBeGreaterThan(0);
    expect(second.getRenderCover()?.coverageComplete).toBe(true);
    expect(second.getTimeline().summary.cacheHitRate).toBeGreaterThan(0);
    expect(firstTimeline.summary.frameCount).toBe(5);
    expect(second.getTimeline().summary.frameCount).toBe(5);
    expect(second.getTimeline().frames.map((frame) => frame.targetCover.keys)).toEqual(firstTimeline.frames.map((frame) => frame.targetCover.keys));
    await second.dispose();
  });

  it('covers delayed network, 204 empty, retry, failure and cancellation without external network', async () => {
    let attempts = 0;
    const retry = new TileFetchPipeline({
      baseBackoffMs: 0,
      sleep: async () => undefined,
      fetch: async () => {
        attempts += 1;
        return attempts === 1 ? new Response('', { status: 503 }) : new Response(new Uint8Array([7]), { status: 200 });
      },
    });
    const key = { sourceId: 'fixture', sourceRevision: 'fixture-v1', z: 0, x: 0, y: 0 } as CanonicalTileKey;
    await expect(retry.fetch(key, 'fixture://retry')).resolves.toMatchObject({ status: 'data', attempts: 2 });
    const empty = new TileFetchPipeline({ fetch: async () => new Response(null, { status: 204 }) });
    await expect(empty.fetch(key, 'fixture://empty')).resolves.toMatchObject({ status: 'empty', attempts: 1 });
    const failed = new TileFetchPipeline({ fetch: async () => new Response('', { status: 404 }), baseBackoffMs: 0 });
    await expect(failed.fetch(key, 'fixture://failed')).rejects.toMatchObject({ code: 'HTTP_ERROR', recoverable: false });

    const controller = new AbortController();
    const delayed = new TileFetchPipeline({ fetch: async (_url, options) => new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(options.signal?.reason ?? new DOMException('cancelled', 'AbortError')), { once: true });
    }) });
    const pending = delayed.fetch(key, 'fixture://delayed', { signal: controller.signal });
    controller.abort(new DOMException('cancelled', 'AbortError'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
