import { isTileRecordTerminal } from './tileRecord.js';
import type { TileRecord, TileState } from './tileRecord.js';

export type TileRequestStartReason =
  | 'initial'
  | 'retry'
  | 'eviction-reload'
  | 'cancellation-reload'
  | 'duplicate';

type TileRequestReleaseReason = 'eviction' | 'cancellation';

interface TileRequestHistory {
  releaseReason: TileRequestReleaseReason | undefined;
}

export interface TileRuntimeDiagnosticSnapshot {
  requestStarts: number;
  initialRequestStarts: number;
  retryRequestStarts: number;
  evictionReloadStarts: number;
  cancellationReloadStarts: number;
  duplicateRequestStarts: number;
  readyCacheHits: number;
  emptyCacheHits: number;
  budgetEvictions: number;
}

/** 记录有界的请求来源和缓存复用诊断，避免历史 key 无限增长。 */
export class TileRuntimeDiagnostics {
  readonly #historyLimit: number;
  readonly #requestHistory = new Map<string, TileRequestHistory>();
  #requestStarts = 0;
  #initialRequestStarts = 0;
  #retryRequestStarts = 0;
  #evictionReloadStarts = 0;
  #cancellationReloadStarts = 0;
  #duplicateRequestStarts = 0;
  #readyCacheHits = 0;
  #emptyCacheHits = 0;
  #budgetEvictions = 0;

  constructor(maxEntries: number) {
    this.#historyLimit = Math.max(16, maxEntries * 4);
  }

  classifyRequestStart(id: string, retry: boolean): TileRequestStartReason {
    if (retry) {
      return 'retry';
    }
    const history = this.#requestHistory.get(id);
    if (history === undefined) {
      return 'initial';
    }
    if (history.releaseReason === 'eviction') {
      return 'eviction-reload';
    }
    if (history.releaseReason === 'cancellation') {
      return 'cancellation-reload';
    }
    return 'duplicate';
  }

  recordRequestStart(id: string, reason: TileRequestStartReason): void {
    this.#requestStarts += 1;
    if (reason === 'initial') {
      this.#initialRequestStarts += 1;
    } else if (reason === 'retry') {
      this.#retryRequestStarts += 1;
    } else if (reason === 'eviction-reload') {
      this.#evictionReloadStarts += 1;
    } else if (reason === 'cancellation-reload') {
      this.#cancellationReloadStarts += 1;
    } else {
      this.#duplicateRequestStarts += 1;
    }
    this.#touchHistory(id, { releaseReason: undefined });
  }

  recordCacheHit(state: TileState): void {
    if (state === 'ready') {
      this.#readyCacheHits += 1;
    } else if (state === 'empty') {
      this.#emptyCacheHits += 1;
    }
  }

  recordBudgetEviction(id: string): void {
    this.#budgetEvictions += 1;
    this.#recordRelease(id, 'eviction');
  }

  recordCancellation(id: string): void {
    this.#recordRelease(id, 'cancellation');
  }

  synchronizeRetention<Payload>(
    records: Iterable<TileRecord<Payload>>,
    now: number,
  ): void {
    for (const record of records) {
      if (!isTileRecordTerminal(record.state)) {
        record.retained = false;
        continue;
      }
      const active =
        record.consumers.size > 0 || record.displayConsumers.size > 0;
      if (active) {
        if (record.retained) {
          this.recordCacheHit(record.state);
          record.lastAccessedAt = now;
        }
        record.retained = false;
        continue;
      }
      record.retainUntil = undefined;
      record.retained = true;
    }
  }

  snapshot(): TileRuntimeDiagnosticSnapshot {
    return {
      requestStarts: this.#requestStarts,
      initialRequestStarts: this.#initialRequestStarts,
      retryRequestStarts: this.#retryRequestStarts,
      evictionReloadStarts: this.#evictionReloadStarts,
      cancellationReloadStarts: this.#cancellationReloadStarts,
      duplicateRequestStarts: this.#duplicateRequestStarts,
      readyCacheHits: this.#readyCacheHits,
      emptyCacheHits: this.#emptyCacheHits,
      budgetEvictions: this.#budgetEvictions,
    };
  }

  dispose(): void {
    this.#requestHistory.clear();
  }

  #recordRelease(id: string, reason: TileRequestReleaseReason): void {
    if (!this.#requestHistory.has(id)) {
      return;
    }
    this.#touchHistory(id, { releaseReason: reason });
  }

  #touchHistory(id: string, history: TileRequestHistory): void {
    this.#requestHistory.delete(id);
    this.#requestHistory.set(id, history);
    while (this.#requestHistory.size > this.#historyLimit) {
      const oldest = this.#requestHistory.keys().next().value as
        | string
        | undefined;
      if (oldest === undefined) {
        return;
      }
      this.#requestHistory.delete(oldest);
    }
  }
}
