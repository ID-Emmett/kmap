import { describe, expect, it, vi } from 'vitest';

import { TileRequestError } from '../src/source/errors.js';
import { fetchVectorTile } from '../src/source/fetchTile.js';
import type { FetchLike } from '../src/source/types.js';
import {
  getTileRequestUrl,
  normalizeVectorTileSourceOptions,
} from '../src/source/vectorTileSource.js';

const SOURCE = normalizeVectorTileSourceOptions({
  id: 'main',
  tiles: [
    'https://tiles0.example.test/{z}/{x}/{y}.pbf',
    'https://tiles1.example.test/{z}/{x}/{y}.pbf',
    'https://tiles2.example.test/{z}/{x}/{y}.pbf',
  ],
  minZoom: 0,
  maxZoom: 17,
});
const KEY = { sourceId: 'main', z: 15, x: 26978, y: 12416 } as const;

describe('fetchVectorTile', () => {
  it('将 HTTP 200 读取为浏览器已解压的 ArrayBuffer', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    );

    const result = await fetchVectorTile(SOURCE, KEY, { fetch: fetchImpl });

    expect(result.status).toBe('data');
    if (result.status === 'data') {
      expect([...new Uint8Array(result.data)]).toEqual([1, 2, 3]);
      expect(result.attempt).toBe(1);
    }
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('将 HTTP 204 返回为 typed empty 且不读取 body', async () => {
    const arrayBuffer = vi.fn();
    const fetchImpl = vi.fn<FetchLike>(async () =>
      ({ status: 204, arrayBuffer }) as unknown as Response,
    );

    await expect(
      fetchVectorTile(SOURCE, KEY, { fetch: fetchImpl }),
    ).resolves.toMatchObject({ status: 'empty', attempt: 1 });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('流式读取时报告累计下载字节和 Content-Length', async () => {
    const progress = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3, 4, 5]));
        controller.close();
      },
    });
    const fetchImpl = vi.fn<FetchLike>(async () =>
      new Response(body, {
        status: 200,
        headers: { 'content-length': '5' },
      }),
    );

    const result = await fetchVectorTile(SOURCE, KEY, {
      fetch: fetchImpl,
      onProgress: progress,
    });

    expect(result.status).toBe('data');
    if (result.status === 'data') {
      expect([...new Uint8Array(result.data)]).toEqual([1, 2, 3, 4, 5]);
    }
    expect(progress.mock.calls).toEqual([[2, 5], [5, 5]]);
  });

  it('网络错误和 5xx 最多三次并按节点轮换', async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn<FetchLike>(async (input) => {
      urls.push(String(input));
      if (urls.length === 1) {
        return new Response(null, { status: 500 });
      }
      if (urls.length === 2) {
        throw new TypeError('network down');
      }
      return new Response(new Uint8Array([9]), { status: 200 });
    });

    const result = await fetchVectorTile(SOURCE, KEY, {
      fetch: fetchImpl,
      retryBaseDelayMs: 0,
      random: () => 0.5,
    });

    expect(result).toMatchObject({ status: 'data', attempt: 3 });
    expect(urls).toEqual([
      getTileRequestUrl(SOURCE, KEY, 0).url,
      getTileRequestUrl(SOURCE, KEY, 1).url,
      getTileRequestUrl(SOURCE, KEY, 2).url,
    ]);
  });

  it('404 不作为 empty 且不跨节点重试', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      new Response(null, { status: 404 }),
    );

    await expect(
      fetchVectorTile(SOURCE, KEY, { fetch: fetchImpl }),
    ).rejects.toMatchObject({
      name: 'TileRequestError',
      kind: 'http',
      code: 'HTTP_ERROR',
      status: 404,
      recoverable: false,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('区分 timeout 与用户 AbortSignal 取消', async () => {
    const pendingFetch: FetchLike = async (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(init.signal?.reason),
          { once: true },
        );
      });

    await expect(
      fetchVectorTile(SOURCE, KEY, {
        fetch: pendingFetch,
        timeoutMs: 5,
        maxAttempts: 1,
      }),
    ).rejects.toMatchObject({
      name: 'TileRequestError',
      kind: 'timeout',
      code: 'NETWORK_ERROR',
    });

    const controller = new AbortController();
    const request = fetchVectorTile(SOURCE, KEY, {
      fetch: pendingFetch,
      signal: controller.signal,
      timeoutMs: 0,
    });
    controller.abort(new DOMException('用户取消。', 'AbortError'));

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await request.catch((error: unknown) => {
      expect(error).not.toBeInstanceOf(TileRequestError);
    });
  });
});
