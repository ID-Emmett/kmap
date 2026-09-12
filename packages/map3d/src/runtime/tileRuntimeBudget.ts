import type { TileRecord } from './tileRecord.js';
import type { TileConsumerGroup } from './tileRuntimePriority.js';
import type {
  TileMemoryPressureReason,
  TileRuntimeOptions,
} from './tileRuntimeTypes.js';

const DEFAULT_FETCH_CONCURRENCY = 8;
const DEFAULT_WORKER_CONCURRENCY = 4;
const DEFAULT_FAILED_COOLDOWN_MS = 1_000;
const DEFAULT_MAX_ENTRIES = 256;
const DEFAULT_MAX_CPU_BYTES = 128 * 1024 * 1024;
const DEFAULT_MAX_GPU_BYTES = 256 * 1024 * 1024;

export type NormalizedTileRuntimeOptions<Payload> =
  TileRuntimeOptions<Payload> & {
    fetchConcurrency: number;
    workerConcurrency: number;
    failedCooldownMs: number;
    maxEntries: number;
    maxCpuBytes: number;
    maxGpuBytes: number;
    clock: NonNullable<TileRuntimeOptions<Payload>['clock']>;
  };

export function normalizeTileRuntimeOptions<Payload>(
  options: TileRuntimeOptions<Payload>,
): NormalizedTileRuntimeOptions<Payload> {
  return {
    ...options,
    fetchConcurrency: requirePositiveInteger(
      options.fetchConcurrency ?? DEFAULT_FETCH_CONCURRENCY,
      'fetchConcurrency',
    ),
    workerConcurrency: requirePositiveInteger(
      options.workerConcurrency ?? DEFAULT_WORKER_CONCURRENCY,
      'workerConcurrency',
    ),
    failedCooldownMs: requireNonNegative(
      options.failedCooldownMs ?? DEFAULT_FAILED_COOLDOWN_MS,
      'failedCooldownMs',
    ),
    maxEntries: requirePositiveInteger(
      options.maxEntries ?? DEFAULT_MAX_ENTRIES,
      'maxEntries',
    ),
    maxCpuBytes: requireNonNegative(
      options.maxCpuBytes ?? DEFAULT_MAX_CPU_BYTES,
      'maxCpuBytes',
    ),
    maxGpuBytes: requireNonNegative(
      options.maxGpuBytes ?? DEFAULT_MAX_GPU_BYTES,
      'maxGpuBytes',
    ),
    clock: options.clock ?? {
      now: () =>
        typeof performance === 'undefined' ? Date.now() : performance.now(),
    },
  };
}

export function compareEvictionOrder<Payload>(
  left: TileRecord<Payload>,
  right: TileRecord<Payload>,
): number {
  const leftRank = left.state === 'ready' ? 0 : 1;
  const rightRank = right.state === 'ready' ? 0 : 1;
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }
  if (left.lastAccessedAt !== right.lastAccessedAt) {
    return left.lastAccessedAt - right.lastAccessedAt;
  }
  return left.id.localeCompare(right.id);
}

export function getPressureReasons(
  entries: number,
  cpuBytes: number,
  gpuBytes: number,
  budgets: { maxEntries: number; maxCpuBytes: number; maxGpuBytes: number },
): TileMemoryPressureReason[] {
  const reasons: TileMemoryPressureReason[] = [];
  if (entries > budgets.maxEntries) {
    reasons.push('entries');
  }
  if (cpuBytes > budgets.maxCpuBytes) {
    reasons.push('cpu');
  }
  if (gpuBytes > budgets.maxGpuBytes) {
    reasons.push('gpu');
  }
  return reasons;
}

export function getVisiblePressureReasons<Payload>(
  desired: ReadonlyMap<string, TileConsumerGroup>,
  records: ReadonlyMap<string, TileRecord<Payload>>,
  budgets: { maxEntries: number; maxCpuBytes: number; maxGpuBytes: number },
): TileMemoryPressureReason[] {
  const visibleGroups = [...desired.values()].filter((group) => group.visible);
  let cpuBytes = 0;
  let gpuBytes = 0;
  for (const group of visibleGroups) {
    const record = records.get(group.id);
    cpuBytes += record?.cpuBytes ?? 0;
    gpuBytes += record?.gpuBytes ?? 0;
  }
  return getPressureReasons(
    visibleGroups.length,
    cpuBytes,
    gpuBytes,
    budgets,
  );
}

export function getRecordPressureReasons<Payload>(
  records: ReadonlyMap<string, TileRecord<Payload>>,
  budgets: { maxEntries: number; maxCpuBytes: number; maxGpuBytes: number },
): TileMemoryPressureReason[] {
  let cpuBytes = 0;
  let gpuBytes = 0;
  for (const record of records.values()) {
    cpuBytes += record.cpuBytes;
    gpuBytes += record.gpuBytes;
  }
  return getPressureReasons(records.size, cpuBytes, gpuBytes, budgets);
}

export function uniqueReasons(
  reasons: readonly TileMemoryPressureReason[],
): TileMemoryPressureReason[] {
  return [...new Set(reasons)];
}

function requirePositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} 必须是正安全整数。`);
  }
  return value;
}

function requireNonNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} 必须是非负有限数值。`);
  }
  return value;
}
