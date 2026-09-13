import { describe, expect, it } from 'vitest';
import { createCanonicalTileKey } from '../src/nova-tile/tileAddress.js';
import { TileFetchPipeline } from '../src/nova-tile/fetch/index.js';
import { NovaTilePipeline } from '../src/nova-tile/fetch/index.js';
import { TileWorkerStaleError, collectTransferables } from '../src/nova-tile/worker/index.js';

const tileKey = createCanonicalTileKey('main', 'r1', 2, 1, 1)!;

describe('NTE fetch and worker pipeline', () => {
  it('handles HTTP 204 and retries 5xx while sharing in-flight work', async () => {
    let calls = 0;
    const fetch = async () => {
      calls += 1;
      if (calls < 2) return new Response('', { status: 503 });
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    };
    const pipeline = new TileFetchPipeline({ fetch, baseBackoffMs: 0, sleep: async () => undefined });
    const first = pipeline.fetch(tileKey, 'https://example.test/tile');
    const second = pipeline.fetch(tileKey, 'https://example.test/tile');
    expect(first).toBe(second);
    expect(await first).toMatchObject({ status: 'data', attempts: 2 });
    calls = 0;
    const empty = new TileFetchPipeline({ fetch: async () => new Response(null, { status: 204 }) });
    expect(await empty.fetch(tileKey, 'https://example.test/empty')).toMatchObject({ status: 'empty', attempts: 1 });
  });

  it('classifies 4xx as non-retryable and propagates cancellation', async () => {
    const missing = new TileFetchPipeline({ fetch: async () => new Response('', { status: 404 }), baseBackoffMs: 0 });
    await expect(missing.fetch(tileKey, 'https://example.test/missing')).rejects.toMatchObject({ code: 'HTTP_ERROR', recoverable: false });

    const controller = new AbortController();
    const pending = new TileFetchPipeline({
      fetch: async (_url, options) => new Promise<Response>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(options.signal?.reason ?? new DOMException('aborted', 'AbortError')), { once: true });
      }),
    });
    const request = pending.fetch(tileKey, 'https://example.test/slow', { signal: controller.signal });
    controller.abort(new DOMException('cancelled', 'AbortError'));
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('runs one worker job per canonical key and rejects stale identity', async () => {
    let runCount = 0;
    const worker = new NovaTilePipeline<{ mode: string }, number>({
      fetch: new TileFetchPipeline({ fetch: async () => new Response(new Uint8Array([1]), { status: 200 }) }),
      worker: { run: async ({ data }) => { runCount += 1; return data.byteLength; } },
    });
    const input = { key: tileKey, url: 'https://example.test/tile', dataInput: { mode: 'decode' }, planEpoch: 1, generation: 1 };
    const result = await Promise.all([worker.run(input), worker.run(input)]);
    expect(result[0]).toEqual(result[1]);
    expect(runCount).toBe(1);
    await expect(worker.run({ ...input, planEpoch: 2, current: () => ({ planEpoch: 3, generation: 1 }) })).rejects.toBeInstanceOf(TileWorkerStaleError);
    worker.dispose();
  });

  it('collects transferable buffers without duplicates', () => {
    const buffer = new ArrayBuffer(8);
    const payload = { one: new Uint8Array(buffer), two: new Uint8Array(buffer) };
    expect(collectTransferables(payload)).toEqual([buffer]);
  });
});
