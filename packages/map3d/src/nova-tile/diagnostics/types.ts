import type { PlanEpoch } from '../epoch.js';
import type { CanonicalTileKey } from '../tileAddress.js';

export interface TileCoverSummary {
  readonly tileCount: number;
  readonly keys: readonly string[];
  readonly complete: boolean;
  readonly blankArea: number;
}

export interface RequestEvent {
  readonly type: 'start' | 'finish' | 'cancel' | 'duplicate';
  readonly key: CanonicalTileKey;
  readonly reason: 'visible-critical' | 'visible-refinement' | 'motion-lookahead' | 'warm-prefetch' | 'retry';
  readonly phase: 'moving' | 'settling' | 'settled' | 'idle';
  readonly at: number;
  readonly durationMs?: number;
  readonly bytes?: number;
}

export interface CacheEvent {
  readonly type: 'hit' | 'miss' | 'evict' | 'pressure' | 'promote' | 'demote';
  readonly key?: CanonicalTileKey;
  readonly role?: 'resident' | 'warm' | 'cold' | 'persistent';
  readonly at: number;
  readonly cpuBytes?: number;
  readonly gpuBytes?: number;
}

export interface WorkerEvent {
  readonly type: 'start' | 'finish' | 'cancel' | 'error';
  readonly jobId: number;
  readonly key: CanonicalTileKey;
  readonly at: number;
  readonly durationMs?: number;
  readonly errorCode?: string;
}

export interface UploadEvent {
  readonly type: 'start' | 'finish' | 'defer' | 'error';
  readonly key: CanonicalTileKey;
  readonly at: number;
  readonly bytes: number;
  readonly durationMs?: number;
}

export interface CommitEvent {
  readonly type: 'queued' | 'commit' | 'reject' | 'transition-start' | 'transition-end';
  readonly cohortId: number;
  readonly planEpoch: PlanEpoch;
  readonly at: number;
  readonly durationMs?: number;
}

export interface LongTaskEvent {
  readonly startTime: number;
  readonly durationMs: number;
  readonly name?: string;
}

export interface TileFrameDiagnostics {
  readonly frameId: number;
  readonly planEpoch: PlanEpoch;
  readonly targetCover: TileCoverSummary;
  readonly committedCover: TileCoverSummary;
  readonly coverageComplete: boolean;
  readonly blankArea: number;
  readonly requestStarts: readonly RequestEvent[];
  readonly requestFinishes: readonly RequestEvent[];
  readonly cacheEvents: readonly CacheEvent[];
  readonly workerEvents: readonly WorkerEvent[];
  readonly uploadEvents: readonly UploadEvent[];
  readonly commitEvents: readonly CommitEvent[];
  readonly cpuBytes: number;
  readonly gpuBytes: number;
  readonly frameTime: number;
  readonly longTasks: readonly LongTaskEvent[];
  readonly phaseDurations: Readonly<Record<string, number>>;
}

export interface TileDiagnosticsSummary {
  readonly frameCount: number;
  readonly durationMs: number;
  readonly bootstrapTimeMs?: number;
  readonly firstCompleteCoverTimeMs?: number;
  readonly refinementTimeMs?: number;
  readonly cacheHitRate: number;
  readonly duplicateRequestRate: number;
  readonly cancelRate: number;
  readonly workerP95Ms: number;
  readonly uploadP95Ms: number;
  readonly frameP95Ms: number;
  readonly blankArea: number;
  readonly maxCpuBytes: number;
  readonly maxGpuBytes: number;
  readonly gpuResourceCount: number;
  readonly longTaskCount: number;
}

export interface TileTimeline {
  readonly version: 1;
  readonly generatedAt: number;
  readonly frames: readonly TileFrameDiagnostics[];
  readonly summary: TileDiagnosticsSummary;
}

export interface TileDiagnosticsOptions {
  readonly maxFrames?: number;
  readonly clock?: { now(): number };
}
