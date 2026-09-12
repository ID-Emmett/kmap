import type { CanonicalTileKey, MapError } from '../types.js';
import type { RenderTileKey } from '../spatial/types.js';
import type { TilePriorityRole } from '../spatial/tileCoverage.js';
import type { TileRequestStartReason } from './tileRuntimeDiagnostics.js';

export type TileState =
  | 'queued'
  | 'fetching'
  | 'decoding'
  | 'building'
  | 'ready'
  | 'empty'
  | 'failed'
  | 'disposed';

export interface TileConsumer {
  id: string;
  key: RenderTileKey;
  priorityRole: TilePriorityRole;
  visible: boolean;
  screenDistance: number;
  coverageRank: number;
  notBefore: number;
}

export interface TileResourceStats {
  batches: number;
  features: number;
  vertices: number;
  indices: number;
  objects: number;
}

export interface TileRuntimeResource {
  cpuBytes: number;
  gpuBytes: number;
  stats: Readonly<TileResourceStats>;
  setRenderKeys?(keys: readonly RenderTileKey[]): void;
  setDisplayOpacity?(opacity: number): void;
  dispose(): void;
}

export interface TileRuntimeJob<Payload> {
  result: Promise<Payload>;
  cancel(reason?: unknown): void;
}

export interface TileRecord<Payload> {
  readonly id: string;
  readonly key: CanonicalTileKey;
  readonly generation: number;
  readonly requestStartReason: TileRequestStartReason;
  state: TileState;
  readonly createdAt: number;
  stateChangedAt: number;
  lastAccessedAt: number;
  consumers: Map<string, TileConsumer>;
  /** 当前帧实际显示的 Render Tile consumer，与目标 consumer 正交。 */
  displayConsumers: Map<string, TileConsumer>;
  retained: boolean;
  priorityRole: TilePriorityRole;
  visible: boolean;
  screenDistance: number;
  coverageRank: number;
  notBefore: number;
  retainUntil: number | undefined;
  requestLoadedBytes: number;
  requestTotalBytes: number | undefined;
  downloadBytes: number;
  abortController: AbortController;
  job: TileRuntimeJob<Payload> | undefined;
  data: ArrayBuffer | undefined;
  resource: TileRuntimeResource | undefined;
  cpuBytes: number;
  gpuBytes: number;
  error: MapError | undefined;
  retryAt: number | undefined;
}

const LEGAL_TRANSITIONS: Readonly<Record<TileState, ReadonlySet<TileState>>> = {
  queued: new Set(['fetching', 'disposed']),
  fetching: new Set(['decoding', 'empty', 'failed', 'disposed']),
  decoding: new Set(['building', 'failed', 'disposed']),
  building: new Set(['ready', 'failed', 'disposed']),
  ready: new Set(['disposed']),
  empty: new Set(['disposed']),
  failed: new Set(['disposed']),
  disposed: new Set(),
};

/** 创建新的 canonical Tile generation。 */
export function createTileRecord<Payload>(
  id: string,
  key: CanonicalTileKey,
  generation: number,
  now: number,
  requestStartReason: TileRequestStartReason = 'initial',
): TileRecord<Payload> {
  return {
    id,
    key,
    generation,
    requestStartReason,
    state: 'queued',
    createdAt: now,
    stateChangedAt: now,
    lastAccessedAt: now,
    consumers: new Map(),
    displayConsumers: new Map(),
    retained: false,
    priorityRole: 'prefetch',
    visible: false,
    screenDistance: Number.MAX_VALUE,
    coverageRank: Number.MAX_SAFE_INTEGER,
    notBefore: now,
    retainUntil: undefined,
    requestLoadedBytes: 0,
    requestTotalBytes: undefined,
    downloadBytes: 0,
    abortController: new AbortController(),
    job: undefined,
    data: undefined,
    resource: undefined,
    cpuBytes: 0,
    gpuBytes: 0,
    error: undefined,
    retryAt: undefined,
  };
}

/** 集中验证 Tile 状态转换，禁止运行时分散写入非法状态。 */
export function transitionTileRecord<Payload>(
  record: TileRecord<Payload>,
  next: TileState,
  now: number,
): void {
  if (!LEGAL_TRANSITIONS[record.state].has(next)) {
    throw new Error(`Tile 不能从 ${record.state} 转换到 ${next}。`);
  }

  record.state = next;
  record.stateChangedAt = now;
}

/** 取消单个 generation，并确定性释放其 Worker 与渲染资源。 */
export function disposeTileRecord<Payload>(
  record: TileRecord<Payload>,
  now: number,
): void {
  if (record.state === 'disposed') {
    return;
  }

  record.abortController.abort(
    new DOMException('Tile generation 已取消。', 'AbortError'),
  );
  record.job?.cancel(
    new DOMException('Tile Worker job 已取消。', 'AbortError'),
  );
  record.job = undefined;
  record.data = undefined;
  record.retainUntil = undefined;
  record.requestLoadedBytes = 0;
  record.requestTotalBytes = undefined;
  record.downloadBytes = 0;
  record.displayConsumers.clear();
  record.retained = false;
  record.resource?.dispose();
  record.resource = undefined;
  record.cpuBytes = 0;
  record.gpuBytes = 0;
  transitionTileRecord(record, 'disposed', now);
}

export function isTileRecordInFlight(state: TileState): boolean {
  return (
    state === 'queued' ||
    state === 'fetching' ||
    state === 'decoding' ||
    state === 'building'
  );
}

export function isTileRecordTerminal(state: TileState): boolean {
  return state === 'ready' || state === 'empty' || state === 'failed';
}
