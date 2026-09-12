import {
  canonicalTileKeyToString,
  renderTileKeyToString,
} from '../spatial/tileKey.js';
import type { CanonicalTileKey } from '../types.js';
import type { VectorTileSource } from '../source/types.js';
import type { ViewportSize, ViewState } from '../types.js';
import type { InteractionMotionSnapshot } from '../interaction/motionSnapshot.js';
import { TileEngineV2Scheduler } from './tileEngineV2Schedule.js';
import type { TileCoverageResult } from '../spatial/tileCoverage.js';
import type { TileEngineV2Schedule } from './tileEngineV2Schedule.js';
import { TypedEventEmitter } from './events.js';
import type { TileRecord } from './tileRecord.js';
import {
  getRecordPressureReasons,
  getVisiblePressureReasons,
  normalizeTileRuntimeOptions,
  uniqueReasons,
} from './tileRuntimeBudget.js';
import type { NormalizedTileRuntimeOptions } from './tileRuntimeBudget.js';
import {
  compareTilePriority,
  groupTileCoverage,
} from './tileRuntimePriority.js';
import type { TileConsumerGroup } from './tileRuntimePriority.js';
import type {
  TileMemoryPressureReason,
  TileRecordSnapshot,
  TileRuntimeCoverage,
  TileRuntimeEventMap,
  TileRuntimeOptions,
  TileRuntimeStats,
} from './tileRuntimeTypes.js';
import {
  createTileRecordSnapshot,
  createTileRuntimeStats,
  isTileRuntimeIdle,
} from './tileRuntimeStats.js';
import { TileEngineV2DisplayBridge } from './tileEngineV2Display.js';
import { TileRuntimeDiagnostics } from './tileRuntimeDiagnostics.js';
import { TileEngineV2CommitGate } from './tileEngineV2Commit.js';
import { TileEngineV2RequestController } from './tileEngineV2Requests.js';
import {
  applyTileEngineV2Consumers,
  createTileEngineV2Record,
  evictTileEngineV2ToBudget,
} from './tileEngineV2State.js';
import type { TileEngineV2Diagnostics } from './tileEngineV2Types.js';
import {
  isTileEngineV2GroupReady,
  scheduleTileEngineV2Wakeup,
} from './tileEngineV2Timing.js';
export type { TileEngineV2Diagnostics } from './tileEngineV2Types.js';
export {
  TILE_CANCEL_GRACE_MS,
  TILE_PROGRESS_CANCEL_GRACE_MS,
} from './tileEngineV2Timing.js';

/** V2 唯一生产 authority：分离 Target、Render Cover、Retained Cache 并编排 Tile 生命周期。 */
export class TileEngineV2<Payload> {
  readonly #options: NormalizedTileRuntimeOptions<Payload>;
  readonly #events = new TypedEventEmitter<TileRuntimeEventMap>();
  readonly #records = new Map<string, TileRecord<Payload>>();
  readonly #display: TileEngineV2DisplayBridge<Payload>;
  readonly #diagnostics: TileRuntimeDiagnostics;
  readonly #idleWaiters = new Set<() => void>();
  #desired = new Map<string, TileConsumerGroup>();
  #scheduled = new Map<string, TileConsumerGroup>();
  #suppressedPrefetch = new Set<string>();
  #prefetchEnabled = true;
  #prefetchBlockedByPressure = false;
  #pressureReasons: readonly TileMemoryPressureReason[] = Object.freeze([]);
  #nextGeneration = 1;
  #lastIdle = true;
  readonly #useRealClock: boolean;
  #wakeTimer: ReturnType<typeof setTimeout> | undefined;
  #targetSignature = '';
  #targetStartedAt = 0;
  #coarseCoverMs: number | undefined;
  #idealRefinementMs: number | undefined;
  #disposed = false;
  readonly #scheduler = new TileEngineV2Scheduler();
  readonly #requests: TileEngineV2RequestController<Payload>;
  readonly #commitGate: TileEngineV2CommitGate<Payload>;
  #lastSchedule: TileEngineV2Schedule['diagnostics'] | undefined;
  #cohortCommits = 0;

  constructor(options: TileRuntimeOptions<Payload>) {
    this.#options = normalizeTileRuntimeOptions(options);
    this.#useRealClock = options.clock === undefined;
    this.#display = new TileEngineV2DisplayBridge(
      options.reducedMotion ?? false,
      options.clock === undefined,
      options.minFallbackZoom ?? 0,
    );
    this.#diagnostics = new TileRuntimeDiagnostics(this.#options.maxEntries);
    this.#commitGate = new TileEngineV2CommitGate({
      records: this.#records,
      onCommit: () => {
        if (!this.#disposed) {
          this.#cohortCommits += 1;
          this.#synchronizeCoverage();
        }
      },
    });
    this.#requests = new TileEngineV2RequestController(
      this.#options,
      this.#records,
      this.#diagnostics,
      {
        isCurrent: (record, generation) => this.#isCurrent(record, generation),
        synchronize: () => {
          if (!this.#disposed) {
            this.#synchronizeCoverage();
          }
        },
        commitCohort: () => this.#commitGate.schedule(),
        notify: () => this.#notify(),
        emitError: (error) => this.#events.emit('error', error),
      },
    );
  }

  on<Type extends keyof TileRuntimeEventMap>(
    type: Type,
    listener: (event: TileRuntimeEventMap[Type]) => void,
  ): () => void {
    this.#requireActive();
    return this.#events.on(type, listener);
  }

  /** 更新内部运动快照，运动中的 leading prefetch 仍由 V2 负责。 */
  setMotion(snapshot: InteractionMotionSnapshot): void {
    this.#requireActive();
    this.#scheduler.setMotion(snapshot);
  }

  /** 根据最新 ViewState 生成 Target Coverage 和 V2 请求计划。 */
  setViewContext(
    view: ViewState,
    viewport: ViewportSize,
    source: VectorTileSource,
    coverage: TileCoverageResult,
    now: number,
  ): void {
    this.#requireActive();
    const schedule = this.#scheduler.createSchedule(
      view,
      viewport,
      source,
      coverage,
      now,
    );
    this.#lastSchedule = schedule.diagnostics;
    this.setCoverage(schedule.entries);
  }

  /** 返回 V2 内部诊断快照，不扩大 Map3D 公开 API。 */
  getDiagnostics(): TileEngineV2Diagnostics {
    return Object.freeze({
      targetCoverage: Object.freeze([...this.#scheduled.keys()]),
      renderCover: Object.freeze(
        [...this.#records.values()]
          .filter((record) => record.displayConsumers.size > 0)
          .map((record) => record.id),
      ),
      retainedCache: Object.freeze(
        [...this.#records.values()]
          .filter((record) => record.retained)
          .map((record) => record.id),
      ),
      scheduler: this.#lastSchedule,
      cohortCommits: this.#cohortCommits,
      requestQueue: Object.freeze(
        [...this.#records.values()]
          .filter((record) => record.state === 'queued')
          .sort(compareTilePriority)
          .map((record) => ({
            id: record.id,
            role: record.priorityRole,
            visible: record.visible,
            screenDistance: record.screenDistance,
            notBefore: record.notBefore,
          })),
      ),
    });
  }

  /** 使用完整 visible/prefetch consumer 快照更新 canonical Tile 需求。 */
  setCoverage(coverage: TileRuntimeCoverage): void {
    this.#requireActive();
    this.#display.setTargetCoverage(coverage);
    this.#scheduled = groupTileCoverage(coverage);
    this.#desired = new Map(this.#scheduled);
    const signature = coverage
      .filter((entry) => entry.priority.visible)
      .map((entry) => renderTileKeyToString(entry.key))
      .sort()
      .join('|');
    if (signature !== this.#targetSignature) {
      this.#targetSignature = signature;
      this.#targetStartedAt = this.#options.clock.now();
      this.#coarseCoverMs = signature.length === 0 ? 0 : undefined;
      this.#idealRefinementMs = signature.length === 0 ? 0 : undefined;
    }
    this.#suppressedPrefetch.clear();
    this.#prefetchBlockedByPressure = false;
    this.#synchronizeCoverage();
  }

  /** 重新评估 cooldown、优先级和预算，不改变 consumer 快照。 */
  refresh(): void {
    this.#requireActive();
    this.#synchronizeCoverage();
  }

  getTile(key: CanonicalTileKey): TileRecordSnapshot | undefined {
    const record = this.#records.get(canonicalTileKeyToString(key));
    if (record === undefined) {
      return undefined;
    }
    return createTileRecordSnapshot(record);
  }

  getStats(): TileRuntimeStats {
    const diagnostics = this.#diagnostics.snapshot();
    const requestStats = this.#requests.getStats();
    const stats = createTileRuntimeStats({
      records: this.#records,
      options: this.#options,
      disposed: this.#disposed,
      activeFetches: requestStats.activeFetches,
      activeWorkers: requestStats.activeWorkers,
      activeUploads: requestStats.activeUploads,
      prefetchEnabled: this.#prefetchEnabled,
      pressureReasons: this.#pressureReasons,
      diagnostics,
      now: this.#options.clock.now(),
      scheduling: {
        ...(this.#coarseCoverMs === undefined
          ? {}
          : { coarseCoverMs: this.#coarseCoverMs }),
        ...(this.#idealRefinementMs === undefined
          ? {}
          : { idealRefinementMs: this.#idealRefinementMs }),
        requestCancels: requestStats.requestCancels,
        workerStarts: requestStats.workerStarts,
        workerCancels: requestStats.workerCancels,
        discardedBuilds: requestStats.discardedBuilds,
        discardedDownloadBytes: requestStats.discardedDownloadBytes,
      },
    });
    return this.#commitGate.scheduled && !this.#disposed
      ? { ...stats, idle: false }
      : stats;
  }

  whenIdle(): Promise<void> {
    if (this.#isIdle()) {
      return Promise.resolve();
    }
    return new Promise((resolve) => this.#idleWaiters.add(resolve));
  }

  /** 取消全部 generation，并按 Tile → Worker → Render → Source 顺序释放。 */
  dispose(): void {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;
    this.#desired.clear();
    this.#scheduled.clear();
    if (this.#wakeTimer !== undefined) {
      clearTimeout(this.#wakeTimer);
      this.#wakeTimer = undefined;
    }
    this.#display.dispose();
    this.#commitGate.dispose();
    for (const record of [...this.#records.values()]) {
      this.#requests.disposeRecord(record);
    }
    this.#options.worker.dispose();
    this.#options.render.dispose();
    this.#options.source.dispose();
    this.#diagnostics.dispose();
    this.#prefetchEnabled = false;
    this.#prefetchBlockedByPressure = false;
    this.#pressureReasons = Object.freeze([]);
    this.#suppressedPrefetch.clear();
    for (const resolve of this.#idleWaiters) {
      resolve();
    }
    this.#idleWaiters.clear();
    this.#events.clear();
    this.#lastIdle = true;
  }

  #synchronizeCoverage(): void {
    const now = this.#options.clock.now();
    this.#synchronizeDisplay(now);
    const visibleReasons = getVisiblePressureReasons(
      this.#desired,
      this.#records,
      this.#options,
    );
    if (visibleReasons.length > 0) {
      this.#prefetchBlockedByPressure = true;
    }
    let allowPrefetch =
      visibleReasons.length === 0 && !this.#prefetchBlockedByPressure;

    this.#applyDesiredConsumers(now, allowPrefetch);
    this.#diagnostics.synchronizeRetention(this.#records.values(), now);
    this.#evictToBudget();
    let pressureReasons = uniqueReasons([
      ...visibleReasons,
      ...getRecordPressureReasons(this.#records, this.#options),
    ]);

    if (allowPrefetch && pressureReasons.length > 0) {
      allowPrefetch = false;
      this.#prefetchBlockedByPressure = true;
      this.#applyDesiredConsumers(now, false);
      this.#diagnostics.synchronizeRetention(this.#records.values(), now);
      this.#evictToBudget();
      pressureReasons = uniqueReasons([
        ...visibleReasons,
        ...getRecordPressureReasons(this.#records, this.#options),
      ]);
    }

    this.#prefetchEnabled = allowPrefetch && !this.#prefetchBlockedByPressure;
    this.#setPressureReasons(pressureReasons);
    this.#synchronizeDisplay(this.#options.clock.now());
    this.#diagnostics.synchronizeRetention(
      this.#records.values(),
      this.#options.clock.now(),
    );
    if (this.#disposed) {
      return;
    }
    this.#requests.pump();
    this.#updateMilestones(this.#options.clock.now());
    scheduleTileEngineV2Wakeup({
      useRealClock: this.#useRealClock,
      disposed: this.#disposed,
      now: this.#options.clock.now(),
      records: this.#records,
      getTimer: () => this.#wakeTimer,
      setTimer: (timer) => {
        this.#wakeTimer = timer;
      },
      onWake: () => this.#synchronizeCoverage(),
    });
    this.#notify();
  }

  #applyDesiredConsumers(now: number, allowPrefetch: boolean): void {
    applyTileEngineV2Consumers({
      desired: this.#desired,
      records: this.#records,
      suppressedPrefetch: this.#suppressedPrefetch,
      isFallbackRecord: (id) => this.#display.isFallbackRecord(id),
      allowPrefetch,
      now,
      disposeRecord: (record, reason) => this.#requests.disposeRecord(record, reason),
      createRecord: (group, retry = false) => this.#createRecord(group, now, retry),
    });
  }

  #createRecord(
    group: TileConsumerGroup,
    now: number,
    retry = false,
  ): void {
    const generation = this.#nextGeneration;
    this.#nextGeneration += 1;
    this.#commitGate.resetRecord(group.id);
    createTileEngineV2Record({
      records: this.#records,
      diagnostics: this.#diagnostics,
      group,
      now,
      generation,
      retry,
    });
  }

  #evictToBudget(): void {
    evictTileEngineV2ToBudget({
      records: this.#records,
      options: this.#options,
      suppressedPrefetch: this.#suppressedPrefetch,
      markPressure: () => {
        this.#prefetchBlockedByPressure = true;
      },
      disposeRecord: (record) => this.#requests.disposeRecord(record, 'budget'),
    });
  }

  #setPressureReasons(reasons: readonly TileMemoryPressureReason[]): void {
    const signature = reasons.join(',');
    const previous = this.#pressureReasons.join(',');
    this.#pressureReasons = Object.freeze([...reasons]);
    if (signature.length > 0 && signature !== previous) {
      const stats = this.getStats();
      this.#events.emit('memorypressure', {
        reasons: this.#pressureReasons,
        stats,
      });
    }
  }

  #isCurrent(record: TileRecord<Payload>, generation: number): boolean {
    return (
      !this.#disposed &&
      record.generation === generation &&
      record.state !== 'disposed' &&
      this.#records.get(record.id) === record
    );
  }

  #isIdle(): boolean {
    if (this.#commitGate.scheduled) {
      return false;
    }
    return isTileRuntimeIdle({
      records: this.#records,
      disposed: this.#disposed,
    });
  }

  #notify(): void {
    if (this.#disposed) {
      return;
    }
    const stats = this.getStats();
    this.#events.emit('stats', stats);
    if (this.#disposed) {
      return;
    }
    if (stats.idle && !this.#lastIdle) {
      this.#events.emit('idle', { stats });
      if (this.#disposed) {
        return;
      }
      for (const resolve of this.#idleWaiters) {
        resolve();
      }
      this.#idleWaiters.clear();
    }
    this.#lastIdle = stats.idle;
  }
  #requireActive(): void {
    if (this.#disposed) {
      throw new Error('TileRuntime 已销毁。');
    }
  }

  #synchronizeDisplay(now: number): void {
    const result = this.#display.synchronize(this.#records, now, () => {
      if (!this.#disposed) {
        this.#synchronizeDisplay(this.#options.clock.now());
        this.#notify();
      }
    }, (record) => this.#commitGate.isEligible(record));
    this.#desired = result.desired;
  }

  #updateMilestones(now: number): void {
    if (this.#coarseCoverMs === undefined) {
      const coverage = [...this.#scheduled.values()].filter(
        (group) => group.priorityRole === 'coverage',
      );
      if (
        coverage.length > 0 &&
        coverage.every((group) => isTileEngineV2GroupReady(this.#records.get(group.id)))
      ) {
        this.#coarseCoverMs = Math.max(0, now - this.#targetStartedAt);
      }
    }
    if (this.#idealRefinementMs === undefined) {
      const ideal = [...this.#scheduled.values()].filter((group) => group.visible);
      if (
        ideal.length > 0 &&
        ideal.every((group) => isTileEngineV2GroupReady(this.#records.get(group.id)))
      ) {
        this.#idealRefinementMs = Math.max(0, now - this.#targetStartedAt);
      }
    }
  }

}
