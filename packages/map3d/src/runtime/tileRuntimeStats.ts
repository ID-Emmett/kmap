import { isTileRecordInFlight } from './tileRecord.js';
import type { TileRecord, TileState } from './tileRecord.js';
import { isTilePriorityStarved } from './tileRuntimePriority.js';
import type { NormalizedTileRuntimeOptions } from './tileRuntimeBudget.js';
import type {
  TileMemoryPressureReason,
  TileRecordSnapshot,
  TileRuntimeStats,
} from './tileRuntimeTypes.js';
import type { TileRuntimeDiagnosticSnapshot } from './tileRuntimeDiagnostics.js';

export function createTileRecordSnapshot<Payload>(
  record: TileRecord<Payload>,
): TileRecordSnapshot {
  return {
    key: record.key,
    generation: record.generation,
    state: record.state,
    visible: record.visible,
    consumers: record.consumers.size,
    retained: record.retained,
    cpuBytes: record.cpuBytes,
    gpuBytes: record.gpuBytes,
    ...(record.retryAt === undefined ? {} : { retryAt: record.retryAt }),
    ...(record.error === undefined ? {} : { error: record.error }),
  };
}

type DiagnosticSchedulingKey =
  | 'requestStarts'
  | 'initialRequestStarts'
  | 'retryRequestStarts'
  | 'evictionReloadStarts'
  | 'cancellationReloadStarts'
  | 'duplicateRequestStarts';

interface TileRuntimeStatsInput<Payload> {
  records: ReadonlyMap<string, TileRecord<Payload>>;
  options: NormalizedTileRuntimeOptions<Payload>;
  disposed: boolean;
  activeFetches: number;
  activeWorkers: number;
  activeUploads: number;
  prefetchEnabled: boolean;
  pressureReasons: readonly TileMemoryPressureReason[];
  diagnostics: TileRuntimeDiagnosticSnapshot;
  now: number;
  scheduling: Omit<
    TileRuntimeStats['scheduling'],
    | 'oldestQueueAgeMs'
    | 'queuedNotBeforeCount'
    | 'starvedQueueCount'
    | 'oldestStarvedQueueAgeMs'
    | DiagnosticSchedulingKey
  >;
}

export function createTileRuntimeStats<Payload>(
  input: TileRuntimeStatsInput<Payload>,
): TileRuntimeStats {
  const stateCounts = createStateCounts();
  let visibleTiles = 0;
  let prefetchTiles = 0;
  let visibleConsumers = 0;
  let prefetchConsumers = 0;
  let cpuBytes = 0;
  let gpuBytes = 0;
  let batches = 0;
  let features = 0;
  let vertices = 0;
  let indices = 0;
  let objects = 0;
  let oldestQueueAgeMs = 0;
  let queuedNotBeforeCount = 0;
  let starvedQueueCount = 0;
  let oldestStarvedQueueAgeMs = 0;
  let retainedEntries = 0;
  let retainedReady = 0;
  let retainedEmpty = 0;
  let retainedFailed = 0;

  for (const record of input.records.values()) {
    stateCounts[record.state] += 1;
    if (record.retained) {
      retainedEntries += 1;
      if (record.state === 'ready') {
        retainedReady += 1;
      } else if (record.state === 'empty') {
        retainedEmpty += 1;
      } else if (record.state === 'failed') {
        retainedFailed += 1;
      }
    }
    if (record.visible) {
      visibleTiles += 1;
    } else if (record.consumers.size > 0) {
      prefetchTiles += 1;
    }
    for (const consumer of record.consumers.values()) {
      if (consumer.visible) {
        visibleConsumers += 1;
      } else {
        prefetchConsumers += 1;
      }
    }
    cpuBytes += record.cpuBytes;
    gpuBytes += record.gpuBytes;
    if (record.resource !== undefined) {
      batches += record.resource.stats.batches;
      features += record.resource.stats.features;
      vertices += record.resource.stats.vertices;
      indices += record.resource.stats.indices;
      objects += record.resource.stats.objects;
    }
    if (record.state === 'queued' || record.state === 'decoding') {
      const queueAgeMs = Math.max(0, input.now - record.stateChangedAt);
      oldestQueueAgeMs = Math.max(
        oldestQueueAgeMs,
        queueAgeMs,
      );
      if (record.state === 'queued' && record.notBefore > input.now) {
        queuedNotBeforeCount += 1;
      }
      if (isTilePriorityStarved(record, input.now)) {
        starvedQueueCount += 1;
        oldestStarvedQueueAgeMs = Math.max(oldestStarvedQueueAgeMs, queueAgeMs);
      }
    }
  }

  const idle = isTileRuntimeIdle(input);
  return {
    disposed: input.disposed,
    idle,
    consumers: { visible: visibleConsumers, prefetch: prefetchConsumers },
    tiles: {
      total: input.records.size,
      visible: visibleTiles,
      prefetch: prefetchTiles,
      queued: stateCounts.queued,
      fetching: stateCounts.fetching,
      decoding: stateCounts.decoding,
      building: stateCounts.building,
      ready: stateCounts.ready,
      empty: stateCounts.empty,
      failed: stateCounts.failed,
    },
    requests: { active: input.activeFetches, queued: stateCounts.queued },
    workers: { active: input.activeWorkers, queued: stateCounts.decoding },
    uploads: { active: input.activeUploads },
    resources: {
      cpuBytes,
      gpuBytes,
      batches,
      features,
      vertices,
      indices,
      objects,
    },
    cache: {
      entries: input.records.size,
      retainedEntries,
      retainedReady,
      retainedEmpty,
      retainedFailed,
      readyHits: input.diagnostics.readyCacheHits,
      emptyHits: input.diagnostics.emptyCacheHits,
      evictions: input.diagnostics.budgetEvictions,
      maxEntries: input.options.maxEntries,
      maxCpuBytes: input.options.maxCpuBytes,
      maxGpuBytes: input.options.maxGpuBytes,
      prefetchEnabled: input.prefetchEnabled,
      pressure: input.pressureReasons.length > 0,
      pressureReasons: input.pressureReasons,
    },
    scheduling: {
      ...input.scheduling,
      requestStarts: input.diagnostics.requestStarts,
      initialRequestStarts: input.diagnostics.initialRequestStarts,
      retryRequestStarts: input.diagnostics.retryRequestStarts,
      evictionReloadStarts: input.diagnostics.evictionReloadStarts,
      cancellationReloadStarts: input.diagnostics.cancellationReloadStarts,
      duplicateRequestStarts: input.diagnostics.duplicateRequestStarts,
      oldestQueueAgeMs,
      queuedNotBeforeCount,
      starvedQueueCount,
      oldestStarvedQueueAgeMs,
    },
  };
}

export function isTileRuntimeIdle<Payload>(
  input: Pick<
    TileRuntimeStatsInput<Payload>,
    'records' | 'disposed'
  >,
): boolean {
  if (input.disposed) {
    return true;
  }
  return ![...input.records.values()].some(
    (record) => record.visible && isTileRecordInFlight(record.state),
  );
}

function createStateCounts(): Record<TileState, number> {
  return {
    queued: 0,
    fetching: 0,
    decoding: 0,
    building: 0,
    ready: 0,
    empty: 0,
    failed: 0,
    disposed: 0,
  };
}
