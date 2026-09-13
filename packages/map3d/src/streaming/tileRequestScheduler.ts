import type { TileCoverageEntry, TilePriorityRole } from '../spatial/tileCoverage.js';
import { renderTileKeyToString } from '../spatial/tileKey.js';
import type { CanonicalTileKey } from '../types.js';

export interface TileRequestTask {
  id: string;
  key: CanonicalTileKey;
  role: TilePriorityRole;
  visible: boolean;
  screenDistance: number;
  coverageRank: number;
  notBefore: number;
  queuedAt: number;
  attempt: number;
}

export interface TileRequestSchedulerOptions {
  maxStartsPerFrame?: number;
  maxCancelsPerFrame?: number;
  starvationMs?: number;
}

export interface TileRequestSchedulerStats {
  queued: number;
  active: number;
  requestStarts: number;
  requestCancels: number;
  oldestQueueAgeMs: number;
}

/** 有界、具备空间公平性的请求队列；调度器不执行网络或 Worker 工作。 */
export class TileRequestScheduler {
  readonly #maxStartsPerFrame: number;
  readonly #maxCancelsPerFrame: number;
  readonly #starvationMs: number;
  readonly #queue = new Map<string, TileRequestTask>();
  readonly #active = new Set<string>();
  #startsThisFrame = 0;
  #cancelsThisFrame = 0;
  #totalStarts = 0;
  #totalCancels = 0;
  #frame = 0;
  #now = 0;

  constructor(options: TileRequestSchedulerOptions = {}) {
    this.#maxStartsPerFrame = normalizePositive(options.maxStartsPerFrame ?? 8, 'maxStartsPerFrame');
    this.#maxCancelsPerFrame = normalizeNonNegative(options.maxCancelsPerFrame ?? 8, 'maxCancelsPerFrame');
    this.#starvationMs = normalizeNonNegative(options.starvationMs ?? 250, 'starvationMs');
  }

  beginFrame(now: number): void {
    if (!Number.isFinite(now)) throw new RangeError('now 必须是有限数值。');
    this.#now = now;
    this.#frame += 1;
    this.#startsThisFrame = 0;
    this.#cancelsThisFrame = 0;
  }

  replace(entries: readonly TileCoverageEntry[], now = this.#now): readonly string[] {
    const desired = new Map<string, TileCoverageEntry>();
    for (const entry of entries) {
      const id = renderTileKeyToString(entry.key);
      desired.set(id, entry);
    }
    const cancelled: string[] = [];
    for (const id of this.#queue.keys()) {
      if (desired.has(id) || this.#cancelsThisFrame >= this.#maxCancelsPerFrame) continue;
      this.#queue.delete(id);
      this.#cancelsThisFrame += 1;
      this.#totalCancels += 1;
      cancelled.push(id);
    }
    for (const [id, entry] of desired) {
      if (this.#active.has(id)) continue;
      const existing = this.#queue.get(id);
      const priority = entry.priority;
      if (existing === undefined) {
        this.#queue.set(id, {
          id,
          key: entry.key.canonical,
          role: priority.role,
          visible: priority.visible,
          screenDistance: Number.isFinite(priority.screenDistance) ? priority.screenDistance : Number.MAX_VALUE,
          coverageRank: priority.coverageRank ?? Number.MAX_SAFE_INTEGER,
          notBefore: priority.notBefore ?? now,
          queuedAt: now,
          attempt: 0,
        });
      } else {
        existing.role = priority.role;
        existing.visible = priority.visible;
        existing.screenDistance = priority.screenDistance;
        existing.coverageRank = priority.coverageRank ?? existing.coverageRank;
        existing.notBefore = priority.notBefore ?? existing.notBefore;
      }
    }
    return Object.freeze(cancelled);
  }

  take(now = this.#now): TileRequestTask | undefined {
    if (this.#startsThisFrame >= this.#maxStartsPerFrame) return undefined;
    const candidates = [...this.#queue.values()].filter((task) => task.notBefore <= now);
    candidates.sort((left, right) => compareTasks(left, right, now, this.#frame));
    const task = candidates[0];
    if (task === undefined) return undefined;
    this.#queue.delete(task.id);
    this.#active.add(task.id);
    this.#startsThisFrame += 1;
    this.#totalStarts += 1;
    task.attempt += 1;
    return { ...task };
  }

  finish(id: string): void {
    this.#active.delete(id);
  }

  requeue(task: TileRequestTask, notBefore: number): void {
    if (this.#active.delete(task.id)) {
      this.#queue.set(task.id, { ...task, notBefore, queuedAt: this.#now });
    }
  }

  cancel(id: string): boolean {
    if (!this.#queue.delete(id)) return false;
    this.#totalCancels += 1;
    return true;
  }

  clear(): void {
    this.#queue.clear();
    this.#active.clear();
  }

  getStats(now = this.#now): TileRequestSchedulerStats {
    let oldestQueueAgeMs = 0;
    for (const task of this.#queue.values()) oldestQueueAgeMs = Math.max(oldestQueueAgeMs, Math.max(0, now - task.queuedAt));
    return {
      queued: this.#queue.size,
      active: this.#active.size,
      requestStarts: this.#totalStarts,
      requestCancels: this.#totalCancels,
      oldestQueueAgeMs,
    };
  }

  get maxStartsPerFrame(): number { return this.#maxStartsPerFrame; }
  get maxCancelsPerFrame(): number { return this.#maxCancelsPerFrame; }
  get starvationMs(): number { return this.#starvationMs; }
}

function compareTasks(left: TileRequestTask, right: TileRequestTask, now: number, frame: number): number {
  const roleDifference = roleRank(left.role) - roleRank(right.role);
  const leftStarved = now - left.queuedAt >= 250;
  const rightStarved = now - right.queuedAt >= 250;
  if (leftStarved !== rightStarved) return leftStarved ? -1 : 1;
  if (roleDifference !== 0) return roleDifference;
  const leftBucket = (left.key.x + left.key.y + frame) % 4;
  const rightBucket = (right.key.x + right.key.y + frame) % 4;
  if (leftBucket !== rightBucket) return leftBucket - rightBucket;
  if (left.coverageRank !== right.coverageRank) return left.coverageRank - right.coverageRank;
  if (left.screenDistance !== right.screenDistance) return left.screenDistance - right.screenDistance;
  return left.id.localeCompare(right.id);
}

function roleRank(role: TilePriorityRole): number {
  if (role === 'coverage') return 0;
  if (role === 'refinement') return 1;
  if (role === 'leading-prefetch') return 2;
  return 3;
}

function normalizePositive(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} 必须是正安全整数。`);
  return value;
}

function normalizeNonNegative(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} 必须是非负安全整数。`);
  return value;
}
