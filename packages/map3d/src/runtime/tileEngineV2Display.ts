import { canonicalTileKeyToString } from '../spatial/tileKey.js';
import type { TileCoverageEntry } from '../spatial/tileCoverage.js';
import { TileEngineV2DisplayCoordinator } from './tileEngineV2DisplayCoordinator.js';
import type {
  TileEngineV2DisplayPlan,
  TileEngineV2DisplayRecord,
} from './tileEngineV2DisplayCoordinator.js';
import { isTileRecordInFlight } from './tileRecord.js';
import type { TileRecord } from './tileRecord.js';
import { groupTileCoverage } from './tileRuntimePriority.js';
import type { TileConsumerGroup } from './tileRuntimePriority.js';

interface DisplaySyncResult {
  desired: Map<string, TileConsumerGroup>;
  animating: boolean;
}

/** 将 Display Coverage 计划应用到 TileRecord，并生成 fallback 请求 consumer。 */
export class TileEngineV2DisplayBridge<Payload> {
  readonly #coordinator: TileEngineV2DisplayCoordinator;
  readonly #fallbackIds = new Set<string>();
  readonly #useRealClock: boolean;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #target: readonly TileCoverageEntry[] = Object.freeze([]);

  constructor(reducedMotion: boolean, useRealClock: boolean, minZoom: number) {
    this.#coordinator = new TileEngineV2DisplayCoordinator({ reducedMotion, minZoom });
    this.#useRealClock = useRealClock;
  }

  setTargetCoverage(coverage: readonly TileCoverageEntry[]): void {
    this.#target = Object.freeze([...coverage]);
  }

  isFallbackRecord(id: string): boolean {
    return this.#fallbackIds.has(id);
  }

  synchronize(
    records: ReadonlyMap<string, TileRecord<Payload>>,
    now: number,
    onAnimationFrame: () => void,
    isDisplayEligible: (record: TileRecord<Payload>) => boolean = () => true,
  ): DisplaySyncResult {
    const plan = this.#coordinator.update(
      this.#target,
      this.#getCandidates(records, isDisplayEligible),
      now,
    );
    this.#fallbackIds.clear();
    for (const key of plan.requiredFallbacks) {
      this.#fallbackIds.add(canonicalTileKeyToString(key.canonical));
    }
    const requiredFallbackIds = new Set(
      plan.requiredFallbacks.map((key) => canonicalTileKeyToString(key.canonical)),
    );
    const fallbackEntries = plan.requestedFallbacks.map((key) => ({
      key,
      kind: 'prefetch' as const,
      priority: {
        role: requiredFallbackIds.has(canonicalTileKeyToString(key.canonical))
          ? 'coverage' as const
          : 'prefetch' as const,
        visible: false,
        screenDistance: Number.MAX_VALUE,
      },
    }));
    this.#applyPlan(plan, records);
    if (plan.animating && this.#useRealClock && this.#timer === undefined) {
      this.#timer = setTimeout(() => {
        this.#timer = undefined;
        onAnimationFrame();
      }, 16);
    }
    return {
      desired: groupTileCoverage([...this.#target, ...fallbackEntries]),
      animating: plan.animating,
    };
  }

  dispose(): void {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    this.#coordinator.dispose();
    this.#fallbackIds.clear();
    this.#target = Object.freeze([]);
  }

  #getCandidates(
    records: ReadonlyMap<string, TileRecord<Payload>>,
    isDisplayEligible: (record: TileRecord<Payload>) => boolean,
  ): Map<string, TileEngineV2DisplayRecord> {
    const candidates = new Map<string, TileEngineV2DisplayRecord>();
    for (const record of records.values()) {
      candidates.set(record.id, {
        id: record.id,
        key: record.key,
        ready:
          record.resource !== undefined &&
          record.state === 'ready' &&
          isDisplayEligible(record),
        fallbackEligible:
          record.resource !== undefined || isTileRecordInFlight(record.state),
        renderKeys: [
          ...record.consumers.values(),
          ...record.displayConsumers.values(),
        ].map((consumer) => consumer.key),
      });
    }
    return candidates;
  }

  #applyPlan(
    plan: TileEngineV2DisplayPlan,
    records: ReadonlyMap<string, TileRecord<Payload>>,
  ): void {
    const selections = new Map(
      plan.selections.map((selection) => [selection.recordId, selection]),
    );
    for (const record of records.values()) {
      const selection = selections.get(record.id);
      record.displayConsumers = new Map(
        selection?.keys.map((key) => {
          const id = canonicalTileKeyToString(key.canonical) + `@${key.wrap}`;
          return [
            id,
            {
              id,
              key,
              priorityRole: 'coverage' as const,
              visible: true,
              screenDistance: 0,
              coverageRank: 0,
              notBefore: 0,
            },
          ];
        }) ?? [],
      );
      record.resource?.setRenderKeys?.(selection?.keys ?? []);
      record.resource?.setDisplayOpacity?.(selection?.opacity ?? 1);
    }
  }
}


