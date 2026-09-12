import type { TileRecord } from './tileRecord.js';
import {
  disposeTileRecord,
  transitionTileRecord,
} from './tileRecord.js';
import type { NormalizedTileRuntimeOptions } from './tileRuntimeBudget.js';
import { isAbortError, normalizeTileRuntimeError } from './tileRuntimeErrors.js';
import { compareTilePriority } from './tileRuntimePriority.js';
import type {
  TileRuntimeEventMap,
  TileRuntimeOptions,
} from './tileRuntimeTypes.js';
import { TileRuntimeDiagnostics } from './tileRuntimeDiagnostics.js';

export interface TileEngineV2RequestStats {
  readonly activeFetches: number;
  readonly activeWorkers: number;
  readonly activeUploads: number;
  readonly requestCancels: number;
  readonly workerStarts: number;
  readonly workerCancels: number;
  readonly discardedBuilds: number;
  readonly discardedDownloadBytes: number;
}

interface TileEngineV2RequestCallbacks<Payload> {
  isCurrent(record: TileRecord<Payload>, generation: number): boolean;
  synchronize(): void;
  commitCohort(): void;
  notify(): void;
  emitError(error: TileRuntimeEventMap['error']): void;
}

/** 管理单个 canonical Tile 的 Fetch、Worker、GPU upload 和 generation 释放。 */
export class TileEngineV2RequestController<Payload> {
  readonly #options: NormalizedTileRuntimeOptions<Payload>;
  readonly #records: Map<string, TileRecord<Payload>>;
  readonly #diagnostics: TileRuntimeDiagnostics;
  readonly #callbacks: TileEngineV2RequestCallbacks<Payload>;
  #activeFetches = 0;
  #activeWorkers = 0;
  #activeUploads = 0;
  #requestCancels = 0;
  #workerStarts = 0;
  #workerCancels = 0;
  #discardedBuilds = 0;
  #discardedDownloadBytes = 0;

  constructor(
    options: NormalizedTileRuntimeOptions<Payload>,
    records: Map<string, TileRecord<Payload>>,
    diagnostics: TileRuntimeDiagnostics,
    callbacks: TileEngineV2RequestCallbacks<Payload>,
  ) {
    this.#options = options;
    this.#records = records;
    this.#diagnostics = diagnostics;
    this.#callbacks = callbacks;
  }

  getStats(): TileEngineV2RequestStats {
    return {
      activeFetches: this.#activeFetches,
      activeWorkers: this.#activeWorkers,
      activeUploads: this.#activeUploads,
      requestCancels: this.#requestCancels,
      workerStarts: this.#workerStarts,
      workerCancels: this.#workerCancels,
      discardedBuilds: this.#discardedBuilds,
      discardedDownloadBytes: this.#discardedDownloadBytes,
    };
  }

  pump(): void {
    this.#pumpFetches();
    this.#pumpWorkers();
  }

  disposeRecord(
    record: TileRecord<Payload>,
    reason: 'budget' | 'cancellation' | 'retry' | 'dispose' = 'dispose',
  ): void {
    if (reason === 'budget') {
      this.#diagnostics.recordBudgetEviction(record.id);
    } else if (reason === 'cancellation') {
      this.#diagnostics.recordCancellation(record.id);
    }
    if (record.state === 'fetching') {
      this.#requestCancels += 1;
      this.#discardedDownloadBytes += record.requestLoadedBytes;
    } else if (record.state === 'decoding') {
      this.#discardedDownloadBytes += record.downloadBytes;
    } else if (record.state === 'building') {
      this.#workerCancels += 1;
      this.#discardedDownloadBytes += record.downloadBytes;
    }
    disposeTileRecord(record, this.#options.clock.now());
    if (this.#records.get(record.id) === record) {
      this.#records.delete(record.id);
    }
  }

  #pumpFetches(): void {
    const now = this.#options.clock.now();
    while (this.#activeFetches < this.#options.fetchConcurrency) {
      const record = [...this.#records.values()]
        .filter(
          (candidate) =>
            candidate.state === 'queued' && candidate.notBefore <= now,
        )
        .sort((left, right) => compareTilePriority(left, right, now))[0];
      if (record === undefined) {
        return;
      }
      this.#startFetch(record);
    }
  }

  #startFetch(record: TileRecord<Payload>): void {
    const generation = record.generation;
    record.requestLoadedBytes = 0;
    record.requestTotalBytes = undefined;
    transitionTileRecord(record, 'fetching', this.#options.clock.now());
    this.#activeFetches += 1;
    this.#diagnostics.recordRequestStart(record.id, record.requestStartReason);
    let request: ReturnType<TileRuntimeOptions<Payload>['source']['fetch']>;
    try {
      request = this.#options.source.fetch(record.key, {
        signal: record.abortController.signal,
        onProgress: (loadedBytes, totalBytes) => {
          if (!this.#callbacks.isCurrent(record, generation)) {
            return;
          }
          record.requestLoadedBytes = Math.max(
            record.requestLoadedBytes,
            loadedBytes,
          );
          record.requestTotalBytes = totalBytes;
        },
      });
    } catch (error) {
      request = Promise.reject(error);
    }
    this.#callbacks.notify();

    void request
      .then((result) => {
        if (!this.#callbacks.isCurrent(record, generation)) {
          return;
        }
        if (result.status === 'empty') {
          transitionTileRecord(record, 'empty', this.#options.clock.now());
          record.lastAccessedAt = this.#options.clock.now();
          this.#callbacks.synchronize();
          return;
        }
        record.data = result.data;
        record.downloadBytes = result.data.byteLength;
        record.requestLoadedBytes = Math.max(
          record.requestLoadedBytes,
          result.data.byteLength,
        );
        record.cpuBytes = result.data.byteLength;
        transitionTileRecord(record, 'decoding', this.#options.clock.now());
        this.#callbacks.synchronize();
      })
      .catch((error: unknown) => {
        if (!this.#callbacks.isCurrent(record, generation) || isAbortError(error)) {
          return;
        }
        this.#failRecord(record, error, 'request');
      })
      .finally(() => {
        this.#activeFetches = Math.max(0, this.#activeFetches - 1);
        this.#pumpFetches();
        this.#callbacks.notify();
      });
  }

  #pumpWorkers(): void {
    const now = this.#options.clock.now();
    while (this.#activeWorkers < this.#options.workerConcurrency) {
      const record = [...this.#records.values()]
        .filter((candidate) => candidate.state === 'decoding')
        .sort((left, right) => compareTilePriority(left, right, now))[0];
      if (record === undefined) {
        return;
      }
      this.#startWorker(record);
    }
  }

  #startWorker(record: TileRecord<Payload>): void {
    const data = record.data;
    if (data === undefined) {
      this.#failRecord(record, new Error('Tile Worker 缺少输入数据。'), 'build');
      return;
    }

    const generation = record.generation;
    transitionTileRecord(record, 'building', this.#options.clock.now());
    record.data = undefined;
    this.#activeWorkers += 1;
    this.#workerStarts += 1;

    let job;
    try {
      job = this.#options.worker.enqueue({
        key: record.key,
        generation,
        data,
        signal: record.abortController.signal,
        isGenerationCurrent: (candidate) =>
          candidate === generation && this.#callbacks.isCurrent(record, generation),
      });
      record.job = job;
    } catch (error) {
      this.#activeWorkers -= 1;
      this.#failRecord(record, error, 'build');
      this.#pumpWorkers();
      return;
    }

    this.#callbacks.notify();
    void job.result.then(
      (payload) => {
        this.#releaseWorkerSlot(record, job);
        void this.#finishWorker(record, generation, payload);
      },
      (error: unknown) => {
        this.#releaseWorkerSlot(record, job);
        if (!this.#callbacks.isCurrent(record, generation) || isAbortError(error)) {
          return;
        }
        this.#failRecord(record, error, 'build');
      },
    );
  }

  #releaseWorkerSlot(
    record: TileRecord<Payload>,
    job: NonNullable<TileRecord<Payload>['job']>,
  ): void {
    this.#activeWorkers = Math.max(0, this.#activeWorkers - 1);
    if (record.job === job) {
      record.job = undefined;
    }
    this.#pumpWorkers();
    this.#callbacks.notify();
  }

  async #finishWorker(
    record: TileRecord<Payload>,
    generation: number,
    payload: Payload,
  ): Promise<void> {
    if (!this.#callbacks.isCurrent(record, generation)) {
      this.#discardedBuilds += 1;
      return;
    }

    this.#activeUploads += 1;
    this.#callbacks.notify();
    try {
      const resource = await this.#options.render.upload({
        key: record.key,
        renderKeys: [],
        generation,
        payload,
        signal: record.abortController.signal,
      });
      if (!this.#callbacks.isCurrent(record, generation)) {
        this.#discardedBuilds += 1;
        resource.dispose();
        return;
      }
      record.resource = resource;
      record.cpuBytes = resource.cpuBytes;
      record.gpuBytes = resource.gpuBytes;
      record.lastAccessedAt = this.#options.clock.now();
      transitionTileRecord(record, 'ready', this.#options.clock.now());
      this.#callbacks.commitCohort();
    } catch (error) {
      if (!this.#callbacks.isCurrent(record, generation) || isAbortError(error)) {
        return;
      }
      this.#failRecord(record, error, 'upload');
    } finally {
      this.#activeUploads = Math.max(0, this.#activeUploads - 1);
      this.#callbacks.notify();
    }
  }

  #failRecord(
    record: TileRecord<Payload>,
    error: unknown,
    phase: 'request' | 'build' | 'upload',
  ): void {
    const normalized = normalizeTileRuntimeError(error, record.key, phase);
    record.data = undefined;
    record.cpuBytes = 0;
    record.gpuBytes = 0;
    record.error = normalized;
    record.retryAt = normalized.recoverable
      ? this.#options.clock.now() + this.#options.failedCooldownMs
      : undefined;
    transitionTileRecord(record, 'failed', this.#options.clock.now());
    this.#callbacks.emitError(normalized);
    if (this.#callbacks.isCurrent(record, record.generation)) {
      this.#callbacks.synchronize();
    }
  }
}
