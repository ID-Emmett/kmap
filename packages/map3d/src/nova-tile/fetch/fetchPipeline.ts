import { canonicalTileKeyToString, type CanonicalTileKey } from '../tileAddress.js';

export type TileFetchResult = { readonly status: 'data'; readonly data: ArrayBuffer; readonly attempts: number } | { readonly status: 'empty'; readonly attempts: number };
export interface TileFetchPipelineOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly maxAttempts?: number;
  readonly baseBackoffMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/** HTTP/MVT fetch 边界；同一 canonical key 共享一个 Promise。 */
export class TileFetchPipeline {
  readonly #fetch: typeof globalThis.fetch;
  readonly #maxAttempts: number;
  readonly #baseBackoffMs: number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #inflight = new Map<string, Promise<TileFetchResult>>();

  constructor(options: TileFetchPipelineOptions = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#maxAttempts = normalizePositive(options.maxAttempts ?? 3, 'maxAttempts');
    this.#baseBackoffMs = normalizeNonNegative(options.baseBackoffMs ?? 50, 'baseBackoffMs');
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  fetch(key: CanonicalTileKey, url: string, options: { readonly signal?: AbortSignal } = {}): Promise<TileFetchResult> {
    const id = canonicalTileKeyToString(key);
    const existing = this.#inflight.get(id);
    if (existing !== undefined) return existing;
    const result = this.#fetchWithRetry(key, url, options.signal);
    this.#inflight.set(id, result);
    void result.finally(() => this.#inflight.delete(id)).catch(() => undefined);
    return result;
  }

  clear(): void { this.#inflight.clear(); }
  get inFlightCount(): number { return this.#inflight.size; }

  async #fetchWithRetry(key: CanonicalTileKey, url: string, signal?: AbortSignal): Promise<TileFetchResult> {
    let attempt = 0;
    while (attempt < this.#maxAttempts) {
      attempt += 1;
      try {
        const response = await this.#fetch(url, signal === undefined ? {} : { signal });
        if (response.status === 204) return Object.freeze({ status: 'empty', attempts: attempt });
        if (response.ok) return Object.freeze({ status: 'data', data: await response.arrayBuffer(), attempts: attempt });
        if (response.status >= 500 && attempt < this.#maxAttempts) {
          await this.#sleep(this.#baseBackoffMs * 2 ** (attempt - 1));
          continue;
        }
        throw new TileFetchError(response.status >= 400 ? 'HTTP_ERROR' : 'NETWORK_ERROR', `Tile ${key.sourceId}/${key.z}/${key.x}/${key.y} 返回 HTTP ${response.status}。`, response.status >= 500);
      } catch (error) {
        if (isAbortError(error)) throw error;
        if (error instanceof TileFetchError && !error.recoverable) throw error;
        if (attempt >= this.#maxAttempts) throw error instanceof TileFetchError ? error : new TileFetchError('NETWORK_ERROR', 'Tile 网络请求失败。', true, error);
        await this.#sleep(this.#baseBackoffMs * 2 ** (attempt - 1));
      }
    }
    throw new TileFetchError('NETWORK_ERROR', 'Tile 请求重试耗尽。', false);
  }
}

export class TileFetchError extends Error {
  readonly code: 'HTTP_ERROR' | 'NETWORK_ERROR';
  readonly recoverable: boolean;
  override readonly cause: unknown;
  constructor(code: 'HTTP_ERROR' | 'NETWORK_ERROR', message: string, recoverable: boolean, cause?: unknown) {
    super(message); this.name = 'TileFetchError'; this.code = code; this.recoverable = recoverable; this.cause = cause;
  }
}

function isAbortError(error: unknown): boolean { return error instanceof DOMException && error.name === 'AbortError'; }
function normalizePositive(value: number, name: string): number { if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} 必须是正安全整数。`); return value; }
function normalizeNonNegative(value: number, name: string): number { if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} 必须是非负有限数值。`); return value; }
