import {
  compareEvictionOrder,
  getRecordPressureReasons,
} from './tileRuntimeBudget.js';
import type { NormalizedTileRuntimeOptions } from './tileRuntimeBudget.js';
import {
  createTileRecord,
  isTileRecordInFlight,
  isTileRecordTerminal,
} from './tileRecord.js';
import type { TileRecord } from './tileRecord.js';
import type { TileConsumerGroup } from './tileRuntimePriority.js';
import { applyConsumerGroup } from './tileRuntimePriority.js';
import { TileRuntimeDiagnostics } from './tileRuntimeDiagnostics.js';

interface ConsumerSyncInput<Payload> {
  readonly desired: ReadonlyMap<string, TileConsumerGroup>;
  readonly records: Map<string, TileRecord<Payload>>;
  readonly suppressedPrefetch: ReadonlySet<string>;
  readonly isFallbackRecord: (id: string) => boolean;
  readonly allowPrefetch: boolean;
  readonly now: number;
  readonly disposeRecord: (
    record: TileRecord<Payload>,
    reason: 'cancellation' | 'retry',
  ) => void;
  readonly createRecord: (group: TileConsumerGroup, retry?: boolean) => void;
}

/** 应用 Target/Display consumer，保留取消迟滞与可恢复失败重试规则。 */
export function applyTileEngineV2Consumers<Payload>(
  input: ConsumerSyncInput<Payload>,
): void {
  const activeGroups = new Map<string, TileConsumerGroup>();
  for (const [id, group] of input.desired) {
    if (
      group.visible ||
      group.priorityRole === 'coverage' ||
      input.isFallbackRecord(id) ||
      (input.allowPrefetch && !input.suppressedPrefetch.has(id))
    ) {
      activeGroups.set(id, group);
    }
  }

  for (const record of [...input.records.values()]) {
    const group = activeGroups.get(record.id);
    if (group === undefined && isTileRecordInFlight(record.state)) {
      applyConsumerGroup(record, undefined, input.now);
      record.retainUntil ??= input.now + getCancellationGraceMs(record);
      if (input.now < record.retainUntil) {
        continue;
      }
      input.disposeRecord(record, 'cancellation');
      continue;
    }

    applyConsumerGroup(record, group, input.now);
    if (
      group !== undefined &&
      record.state === 'failed' &&
      record.error?.recoverable === true &&
      input.now >= (record.retryAt ?? Number.POSITIVE_INFINITY)
    ) {
      input.disposeRecord(record, 'retry');
      input.createRecord(group, true);
    }
  }

  for (const group of activeGroups.values()) {
    if (!input.records.has(group.id)) {
      input.createRecord(group);
    }
  }
}

interface TileEngineV2EvictionInput<Payload> {
  readonly records: Map<string, TileRecord<Payload>>;
  readonly options: NormalizedTileRuntimeOptions<Payload>;
  readonly suppressedPrefetch: Set<string>;
  readonly markPressure: () => void;
  readonly disposeRecord: (
    record: TileRecord<Payload>,
    reason: 'budget',
  ) => void;
}

/** 在预算压力下优先淘汰非可见 terminal 或低优先级在途预取。 */
export function evictTileEngineV2ToBudget<Payload>(
  input: TileEngineV2EvictionInput<Payload>,
): void {
  while (getRecordPressureReasons(input.records, input.options).length > 0) {
    const terminalCandidate = [...input.records.values()]
      .filter(
        (record) =>
          !record.visible &&
          record.priorityRole !== 'coverage' &&
          record.displayConsumers.size === 0 &&
          isTileRecordTerminal(record.state),
      )
      .sort(compareEvictionOrder)[0];
    if (terminalCandidate !== undefined) {
      input.suppressedPrefetch.add(terminalCandidate.id);
      input.disposeRecord(terminalCandidate, 'budget');
      continue;
    }

    const inFlightCandidate = [...input.records.values()]
      .filter(
        (record) =>
          !record.visible &&
          record.priorityRole !== 'coverage' &&
          record.displayConsumers.size === 0 &&
          record.consumers.size > 0 &&
          isTileRecordInFlight(record.state),
      )
      .sort(compareEvictionOrder)[0];
    if (inFlightCandidate === undefined) {
      return;
    }
    input.markPressure();
    input.suppressedPrefetch.add(inFlightCandidate.id);
    input.disposeRecord(inFlightCandidate, 'budget');
  }
}

interface TileEngineV2RecordInput<Payload> {
  readonly records: Map<string, TileRecord<Payload>>;
  readonly diagnostics: TileRuntimeDiagnostics;
  readonly group: TileConsumerGroup;
  readonly now: number;
  readonly generation: number;
  readonly retry: boolean;
}

export function createTileEngineV2Record<Payload>(
  input: TileEngineV2RecordInput<Payload>,
): void {
  const record = createRecordBase(input);
  applyConsumerGroup(record, input.group, input.now);
  input.records.set(input.group.id, record);
}

function createRecordBase<Payload>(input: TileEngineV2RecordInput<Payload>): TileRecord<Payload> {
  // 保持 generation 分配和 request history 由 V2 authority 统一控制。
  return createTileRecord<Payload>(
    input.group.id,
    input.group.key,
    input.generation,
    input.now,
    input.diagnostics.classifyRequestStart(input.group.id, input.retry),
  );
}

function getCancellationGraceMs<Payload>(record: TileRecord<Payload>): number {
  const hasProgress =
    record.state === 'decoding' ||
    record.state === 'building' ||
    record.requestLoadedBytes >= TILE_PROGRESS_MIN_BYTES ||
    (record.requestTotalBytes !== undefined &&
      record.requestTotalBytes > 0 &&
      record.requestLoadedBytes / record.requestTotalBytes >= 0.5);
  return hasProgress ? TILE_PROGRESS_CANCEL_GRACE_MS : TILE_CANCEL_GRACE_MS;
}

const TILE_CANCEL_GRACE_MS = 240;
const TILE_PROGRESS_CANCEL_GRACE_MS = 600;
const TILE_PROGRESS_MIN_BYTES = 16 * 1024;
