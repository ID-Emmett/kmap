import type { CanonicalTileKey } from '../tileAddress.js';

export type UploadPriority = 'visible-critical' | 'exact-visible' | 'motion-lookahead' | 'warm-prefetch' | 'cache-maintenance';

export interface UploadQueueOptions {
  readonly maxBytesPerFrame?: number;
  readonly maxTimeMsPerFrame?: number;
  readonly maxCommitsPerFrame?: number;
  readonly clock?: { now(): number };
}

export interface UploadRequest<Result = unknown> {
  readonly id: string;
  readonly key: CanonicalTileKey;
  readonly bytes: number;
  readonly priority: UploadPriority;
  readonly upload: () => Promise<Result> | Result;
}

export interface UploadReservation {
  readonly bytes: number;
  readonly estimatedTimeMs: number;
  commit(actualTimeMs?: number): boolean;
  release(): boolean;
}

export interface UploadQueueStats {
  readonly queued: number;
  readonly active: number;
  readonly usedBytes: number;
  readonly usedTimeMs: number;
  readonly commitsThisFrame: number;
  readonly totalCommits: number;
  readonly deferred: number;
  readonly backpressure: boolean;
  readonly maxBytesPerFrame: number;
  readonly maxTimeMsPerFrame: number;
  readonly maxCommitsPerFrame: number;
}

/** 带字节/时间/提交次数双预算的 GPU UploadQueue。 */
export class TileUploadQueue<Result = unknown> {
  readonly #maxBytes: number;
  readonly #maxTimeMs: number;
  readonly #maxCommits: number;
  readonly #clock: { now(): number };
  readonly #queue = new Map<string, UploadRequest<Result>>();
  readonly #active = new Set<string>();
  readonly #reservations = new Map<string, UploadReservation>();
  #usedBytes = 0;
  #usedTimeMs = 0;
  #commitsFrame = 0;
  #totalCommits = 0;
  #deferred = 0;
  #frame = 0;

  constructor(options: UploadQueueOptions = {}) {
    this.#maxBytes = positiveNumber(options.maxBytesPerFrame ?? 5 * 1024 * 1024, 'maxBytesPerFrame');
    this.#maxTimeMs = positiveNumber(options.maxTimeMsPerFrame ?? 4, 'maxTimeMsPerFrame');
    this.#maxCommits = positive(options.maxCommitsPerFrame ?? 2, 'maxCommitsPerFrame');
    this.#clock = options.clock ?? { now: () => performance.now() };
  }

  beginFrame(): void {
    this.#frame += 1;
    this.#usedBytes = 0;
    this.#usedTimeMs = 0;
    this.#commitsFrame = 0;
    this.#deferred = 0;
  }

  reserve(bytes: number, estimatedTimeMs = 0): UploadReservation | undefined {
    validateBudgetValue(bytes, 'upload bytes');
    validateBudgetValue(estimatedTimeMs, 'upload time');
    if (this.#usedBytes + bytes > this.#maxBytes || this.#usedTimeMs + estimatedTimeMs > this.#maxTimeMs || this.#commitsFrame >= this.#maxCommits) {
      this.#deferred += 1;
      return undefined;
    }
    this.#usedBytes += bytes;
    this.#usedTimeMs += estimatedTimeMs;
    let settled = false;
    return {
      bytes,
      estimatedTimeMs,
      commit: (actualTimeMs = estimatedTimeMs): boolean => {
        if (settled) return false;
        validateBudgetValue(actualTimeMs, 'upload time');
        settled = true;
        this.#usedTimeMs += actualTimeMs - estimatedTimeMs;
        this.#commitsFrame += 1;
        this.#totalCommits += 1;
        return true;
      },
      release: (): boolean => {
        if (settled) return false;
        settled = true;
        this.#usedBytes -= bytes;
        this.#usedTimeMs -= estimatedTimeMs;
        return true;
      },
    };
  }

  enqueue(request: UploadRequest<Result>): boolean {
    validateRequest(request);
    if (this.#queue.has(request.id) || this.#active.has(request.id)) return false;
    this.#queue.set(request.id, request);
    return true;
  }

  take(): UploadRequest<Result> | undefined {
    const request = [...this.#queue.values()].sort(comparePriority)[0];
    if (request === undefined) return undefined;
    const reservation = this.reserve(request.bytes);
    if (reservation === undefined) return undefined;
    this.#queue.delete(request.id);
    this.#active.add(request.id);
    this.#reservations.set(request.id, reservation);
    return request;
  }

  async processNext(): Promise<Result | undefined> {
    const request = this.take();
    if (request === undefined) return undefined;
    const startedAt = this.#clock.now();
    try {
      const result = await request.upload();
      const elapsed = Math.max(0, this.#clock.now() - startedAt);
      this.#active.delete(request.id);
      const reservation = this.#reservations.get(request.id);
      this.#reservations.delete(request.id);
      reservation?.commit(elapsed);
      return result;
    } catch (error) {
      this.#active.delete(request.id);
      this.#reservations.get(request.id)?.release();
      this.#reservations.delete(request.id);
      throw error;
    }
  }

  cancel(id: string): boolean { return this.#queue.delete(id); }
  clear(): void { for (const reservation of this.#reservations.values()) reservation.release(); this.#reservations.clear(); this.#queue.clear(); this.#active.clear(); }
  get frame(): number { return this.#frame; }
  get stats(): UploadQueueStats { return this.getStats(); }
  getStats(): UploadQueueStats { return Object.freeze({ queued: this.#queue.size, active: this.#active.size, usedBytes: this.#usedBytes, usedTimeMs: this.#usedTimeMs, commitsThisFrame: this.#commitsFrame, totalCommits: this.#totalCommits, deferred: this.#deferred, backpressure: this.#queue.size > 0 || this.#usedBytes >= this.#maxBytes || this.#usedTimeMs >= this.#maxTimeMs || this.#commitsFrame >= this.#maxCommits, maxBytesPerFrame: this.#maxBytes, maxTimeMsPerFrame: this.#maxTimeMs, maxCommitsPerFrame: this.#maxCommits }); }
}

function comparePriority(left: UploadRequest, right: UploadRequest): number { return priorityRank(left.priority) - priorityRank(right.priority) || left.id.localeCompare(right.id); }
function priorityRank(priority: UploadPriority): number { return priority === 'visible-critical' ? 0 : priority === 'exact-visible' ? 1 : priority === 'motion-lookahead' ? 2 : priority === 'warm-prefetch' ? 3 : 4; }
function validateRequest(request: UploadRequest): void { if (request.id.length === 0 || request.key.sourceId.length === 0 || !Number.isFinite(request.bytes) || request.bytes < 0) throw new RangeError('UploadRequest 参数无效。'); }
function positive(value: number, name: string): number { if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} 必须是正安全整数。`); return value; }
function positiveNumber(value: number, name: string): number { if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} 必须是正数。`); return value; }
function validateBudgetValue(value: number, name: string): void { if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} 必须是非负有限数值。`); }
