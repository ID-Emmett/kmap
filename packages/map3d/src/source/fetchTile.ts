import type { CanonicalTileKey } from '../types.js';
import { requireFiniteNumber } from '../spatial/validation.js';
import { getAbortReason, TileRequestError } from './errors.js';
import { assertKeyMatchesSource, getTileRequestUrl } from './vectorTileSource.js';
import type {
  TileFetchOptions,
  TileFetchResult,
  VectorTileSource,
} from './types.js';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 100;
const DEFAULT_RETRY_JITTER_RATIO = 0.2;

/** 请求 canonical MVT；浏览器负责按 Content-Encoding 解压响应体。 */
export async function fetchVectorTile(
  source: VectorTileSource,
  key: CanonicalTileKey,
  options: TileFetchOptions = {},
): Promise<TileFetchResult> {
  assertKeyMatchesSource(source, key);
  const fetchImpl = options.fetch ?? globalThis.fetch;

  if (fetchImpl === undefined) {
    throw new TileRequestError({
      kind: 'source',
      code: 'SOURCE_ERROR',
      message: '当前环境不提供 Fetch API。',
      recoverable: false,
      tileKey: key,
    });
  }

  const requestOptions = normalizeFetchOptions(options);

  for (let attemptIndex = 0; attemptIndex < requestOptions.maxAttempts; attemptIndex += 1) {
    throwIfAborted(options.signal);
    const attempt = attemptIndex + 1;
    const { url } = getTileRequestUrl(source, key, attemptIndex);
    const attemptSignal = createAttemptSignal(
      options.signal,
      requestOptions.timeoutMs,
    );

    try {
      const response = await fetchImpl(url, { signal: attemptSignal.signal });

      if (response.status === 204) {
        return { status: 'empty', key, url, attempt };
      }

      if (response.status === 200) {
        return {
          status: 'data',
          key,
          url,
          attempt,
          data: await readResponseData(response, options.onProgress),
        };
      }

      const httpError = new TileRequestError({
        kind: 'http',
        code: 'HTTP_ERROR',
        message: `Tile 请求返回 HTTP ${response.status}。`,
        recoverable: response.status >= 500,
        tileKey: key,
        url,
        attempt,
        status: response.status,
      });

      if (response.status < 500 || attempt === requestOptions.maxAttempts) {
        throw httpError;
      }

      await waitBeforeRetry(attemptIndex, requestOptions, options.signal);
    } catch (cause) {
      if (cause instanceof TileRequestError) {
        throw cause;
      }

      const abortKind = attemptSignal.getAbortKind();

      if (abortKind === 'external') {
        throw getAbortReason(options.signal!);
      }

      const requestError = new TileRequestError({
        kind: abortKind === 'timeout' ? 'timeout' : 'network',
        code: 'NETWORK_ERROR',
        message:
          abortKind === 'timeout'
            ? `Tile 请求在 ${requestOptions.timeoutMs}ms 后超时。`
            : 'Tile 网络请求失败。',
        recoverable: true,
        tileKey: key,
        url,
        attempt,
        cause,
      });

      if (attempt === requestOptions.maxAttempts) {
        throw requestError;
      }

      await waitBeforeRetry(attemptIndex, requestOptions, options.signal);
    } finally {
      attemptSignal.cleanup();
    }
  }

  throw new TileRequestError({
    kind: 'network',
    code: 'NETWORK_ERROR',
    message: 'Tile 请求未产生结果。',
    recoverable: true,
    tileKey: key,
  });
}

async function readResponseData(
  response: Response,
  onProgress: TileFetchOptions['onProgress'],
): Promise<ArrayBuffer> {
  if (onProgress === undefined || response.body === null) {
    const data = await response.arrayBuffer();
    onProgress?.(data.byteLength, parseContentLength(response));
    return data;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  const totalBytes = parseContentLength(response);
  let loadedBytes = 0;

  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    chunks.push(result.value);
    loadedBytes += result.value.byteLength;
    onProgress(loadedBytes, totalBytes);
  }

  const data = new Uint8Array(loadedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data.buffer;
}

function parseContentLength(response: Response): number | undefined {
  const header = response.headers.get('content-length');
  if (header === null || header.trim().length === 0) {
    return undefined;
  }
  const value = Number(header);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

interface NormalizedFetchOptions {
  timeoutMs: number;
  maxAttempts: number;
  retryBaseDelayMs: number;
  retryJitterRatio: number;
  random: () => number;
}

function normalizeFetchOptions(
  options: TileFetchOptions,
): NormalizedFetchOptions {
  const timeoutMs = requireNonNegative(
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    'timeoutMs',
  );
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError('maxAttempts 必须是正安全整数。');
  }

  const retryJitterRatio = requireNonNegative(
    options.retryJitterRatio ?? DEFAULT_RETRY_JITTER_RATIO,
    'retryJitterRatio',
  );

  if (retryJitterRatio > 1) {
    throw new RangeError('retryJitterRatio 不能大于 1。');
  }

  return {
    timeoutMs,
    maxAttempts,
    retryBaseDelayMs: requireNonNegative(
      options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS,
      'retryBaseDelayMs',
    ),
    retryJitterRatio,
    random: options.random ?? Math.random,
  };
}

function createAttemptSignal(
  externalSignal: AbortSignal | undefined,
  timeoutMs: number,
): {
  signal: AbortSignal;
  getAbortKind: () => 'external' | 'timeout' | undefined;
  cleanup: () => void;
} {
  const controller = new AbortController();
  let abortKind: 'external' | 'timeout' | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const onExternalAbort = (): void => {
    if (abortKind === undefined) {
      abortKind = 'external';
      controller.abort(getAbortReason(externalSignal!));
    }
  };

  if (externalSignal?.aborted === true) {
    onExternalAbort();
  } else {
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
  }

  if (timeoutMs > 0) {
    timeout = setTimeout(() => {
      if (abortKind === undefined) {
        abortKind = 'timeout';
        controller.abort(new DOMException('请求超时。', 'TimeoutError'));
      }
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    getAbortKind: () => abortKind,
    cleanup: () => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      externalSignal?.removeEventListener('abort', onExternalAbort);
    },
  };
}

async function waitBeforeRetry(
  attemptIndex: number,
  options: NormalizedFetchOptions,
  signal: AbortSignal | undefined,
): Promise<void> {
  const random = requireFiniteNumber(options.random(), 'random()');

  if (random < 0 || random > 1) {
    throw new RangeError('random() 必须返回 0 到 1。');
  }

  const exponentialDelay =
    options.retryBaseDelayMs * 2 ** attemptIndex;
  const jitterMultiplier =
    1 + (random * 2 - 1) * options.retryJitterRatio;
  const delay = Math.max(0, exponentialDelay * jitterMultiplier);

  if (delay === 0) {
    throwIfAborted(signal);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delay);
    const onAbort = (): void => {
      clearTimeout(timeout);
      reject(getAbortReason(signal!));
    };

    if (signal?.aborted === true) {
      onAbort();
      return;
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw getAbortReason(signal);
  }
}

function requireNonNegative(value: number, name: string): number {
  const normalized = requireFiniteNumber(value, name);

  if (normalized < 0) {
    throw new RangeError(`${name} 不能为负数。`);
  }

  return normalized;
}
