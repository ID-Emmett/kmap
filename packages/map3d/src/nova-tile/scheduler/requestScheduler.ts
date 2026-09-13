import { canonicalTileKeyToString, type CanonicalTileKey } from '../tileAddress.js';

export type SchedulerPhase = 'moving' | 'settling' | 'settled' | 'idle';
export type RequestRole = 'visible-critical' | 'visible-refinement' | 'motion-lookahead' | 'warm-prefetch' | 'retry';

export interface RequestTask {
  readonly id: string;
  readonly key: CanonicalTileKey;
  readonly role: RequestRole;
  readonly spatialBucket: string;
  readonly coverageDeficit: number;
  readonly screenError: number;
  readonly motionAlignment: number;
  readonly cacheReuseProbability: number;
  readonly queuedAt: number;
  readonly notBefore: number;
  attempt: number;
}

export interface RequestSchedulerOptions {
  readonly maxStartsPerFrame?: number;
  readonly maxCancelsPerFrame?: number;
  readonly starvationMs?: number;
  readonly bucketCount?: number;
}

export interface SchedulerStats {
  readonly phase: SchedulerPhase;
  readonly queued: number;
  readonly active: number;
  readonly requestStarts: number;
  readonly requestCancels: number;
  readonly bucketStarts: Readonly<Record<string, number>>;
  readonly oldestQueueAgeMs: number;
}

/** 带 canonical 去重、空间 bucket 轮询和阶段预算的 NTE 请求调度器。 */
export class RequestScheduler {
  readonly #maxStarts: number;
  readonly #maxCancels: number;
  readonly #starvationMs: number;
  readonly #bucketCount: number;
  readonly #queue = new Map<string, RequestTask>();
  readonly #active = new Set<string>();
  readonly #bucketStarts = new Map<string, number>();
  #phase: SchedulerPhase = 'idle';
  #now = 0;
  #startsFrame = 0;
  #cancelsFrame = 0;
  #startsTotal = 0;
  #cancelsTotal = 0;

  constructor(options: RequestSchedulerOptions = {}) {
    this.#maxStarts = positive(options.maxStartsPerFrame ?? 4, 'maxStartsPerFrame');
    this.#maxCancels = nonNegative(options.maxCancelsPerFrame ?? 8, 'maxCancelsPerFrame');
    this.#starvationMs = nonNegative(options.starvationMs ?? 250, 'starvationMs');
    this.#bucketCount = positive(options.bucketCount ?? 8, 'bucketCount');
  }

  beginFrame(now: number, phase: SchedulerPhase = this.#phase): void {
    if (!Number.isFinite(now)) throw new RangeError('now 必须是有限数值。');
    this.#now = now;
    this.#phase = phase;
    this.#startsFrame = 0;
    this.#cancelsFrame = 0;
    this.#bucketStarts.clear();
  }

  replace(tasks: readonly Omit<RequestTask, 'id' | 'spatialBucket' | 'queuedAt' | 'attempt'>[], now = this.#now): readonly string[] {
    const desired = new Map<string, Omit<RequestTask, 'id' | 'spatialBucket' | 'queuedAt' | 'attempt'>>();
    for (const task of tasks) {
      const id = canonicalTileKeyToString(task.key);
      const existing = desired.get(id);
      if (existing === undefined) {
        desired.set(id, task);
      } else {
        desired.set(id, {
          ...task,
          role: roleRank(task.role) < roleRank(existing.role) ? task.role : existing.role,
          coverageDeficit: Math.max(existing.coverageDeficit, task.coverageDeficit),
          screenError: Math.max(existing.screenError, task.screenError),
          motionAlignment: Math.max(existing.motionAlignment, task.motionAlignment),
          cacheReuseProbability: Math.max(existing.cacheReuseProbability, task.cacheReuseProbability),
          notBefore: Math.min(existing.notBefore, task.notBefore),
        });
      }
    }
    const cancelled: string[] = [];
    for (const id of [...this.#queue.keys()]) {
      if (desired.has(id) || this.#cancelsFrame >= this.#maxCancels) continue;
      this.#queue.delete(id); this.#cancelsFrame += 1; this.#cancelsTotal += 1; cancelled.push(id);
    }
    for (const [id, task] of desired) {
      if (this.#active.has(id)) continue;
      const existing = this.#queue.get(id);
      if (existing === undefined) {
        this.#queue.set(id, { ...task, id, spatialBucket: this.bucketFor(task.key), queuedAt: now, attempt: 0 });
      } else {
        const merged = roleRank(task.role) < roleRank(existing.role) ? task : existing;
        Object.assign(existing, {
          ...task,
          role: merged.role,
          coverageDeficit: Math.max(existing.coverageDeficit, task.coverageDeficit),
          screenError: Math.max(existing.screenError, task.screenError),
          motionAlignment: Math.max(existing.motionAlignment, task.motionAlignment),
          cacheReuseProbability: Math.max(existing.cacheReuseProbability, task.cacheReuseProbability),
          notBefore: Math.min(existing.notBefore, task.notBefore),
        });
      }
    }
    return Object.freeze(cancelled);
  }

  take(now = this.#now): RequestTask | undefined {
    const limit = this.#phase === 'moving' ? Math.min(this.#maxStarts, 4) : this.#phase === 'settled' ? this.#maxStarts : this.#phase === 'idle' ? Math.min(this.#maxStarts, 2) : this.#maxStarts;
    if (this.#startsFrame >= limit) return undefined;
    const candidates = [...this.#queue.values()].filter((task) => task.notBefore <= now);
    candidates.sort((a, b) => this.compare(a, b, now));
    const task = candidates[0];
    if (task === undefined) return undefined;
    this.#queue.delete(task.id); this.#active.add(task.id); this.#startsFrame += 1; this.#startsTotal += 1; task.attempt += 1;
    this.#bucketStarts.set(task.spatialBucket, (this.#bucketStarts.get(task.spatialBucket) ?? 0) + 1);
    return { ...task };
  }

  finish(id: string): void { this.#active.delete(id); }
  requeue(task: RequestTask, notBefore: number): void { this.#active.delete(task.id); this.#queue.set(task.id, { ...task, notBefore, queuedAt: this.#now }); }
  cancel(id: string): boolean { const removed = this.#queue.delete(id); if (removed) this.#cancelsTotal += 1; return removed; }
  clear(): void { this.#queue.clear(); this.#active.clear(); }
  bucketFor(key: CanonicalTileKey): string { return `${Math.abs((key.x * 31 + key.y * 17 + key.z * 7) % this.#bucketCount)}`; }
  getStats(now = this.#now): SchedulerStats {
    let oldest = 0; for (const task of this.#queue.values()) oldest = Math.max(oldest, Math.max(0, now - task.queuedAt));
    return Object.freeze({ phase: this.#phase, queued: this.#queue.size, active: this.#active.size, requestStarts: this.#startsTotal, requestCancels: this.#cancelsTotal, bucketStarts: Object.fromEntries(this.#bucketStarts), oldestQueueAgeMs: oldest });
  }

  private compare(a: RequestTask, b: RequestTask, now: number): number {
    const aStarved = now - a.queuedAt >= this.#starvationMs;
    const bStarved = now - b.queuedAt >= this.#starvationMs;
    if (aStarved !== bStarved) return aStarved ? -1 : 1;
    const role = roleRank(a.role) - roleRank(b.role); if (role !== 0) return role;
    const bucket = (this.#bucketStarts.get(a.spatialBucket) ?? 0) - (this.#bucketStarts.get(b.spatialBucket) ?? 0); if (bucket !== 0) return bucket;
    const scoreA = a.coverageDeficit * 100 + a.screenError * 10 + a.motionAlignment * 5 + a.cacheReuseProbability;
    const scoreB = b.coverageDeficit * 100 + b.screenError * 10 + b.motionAlignment * 5 + b.cacheReuseProbability;
    return scoreB - scoreA || a.id.localeCompare(b.id);
  }
}

function roleRank(role: RequestRole): number { return role === 'visible-critical' ? 0 : role === 'visible-refinement' ? 1 : role === 'motion-lookahead' ? 2 : role === 'retry' ? 3 : 4; }
function positive(value: number, name: string): number { if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} 必须是正安全整数。`); return value; }
function nonNegative(value: number, name: string): number { if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} 必须是非负安全整数。`); return value; }
