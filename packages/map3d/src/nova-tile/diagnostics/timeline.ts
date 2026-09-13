import type { TileFrameDiagnostics, TileDiagnosticsSummary, TileTimeline } from './types.js';

/** 计算排序数组的 P95，空输入返回 0。 */
export function percentile95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index] ?? 0;
}

/** 从逐帧诊断聚合性能、资源和覆盖统计。 */
export function summarizeTileFrames(frames: readonly TileFrameDiagnostics[]): TileDiagnosticsSummary {
  if (frames.length === 0) {
    return Object.freeze({ frameCount: 0, durationMs: 0, cacheHitRate: 0, duplicateRequestRate: 0, cancelRate: 0, workerP95Ms: 0, uploadP95Ms: 0, frameP95Ms: 0, blankArea: 0, maxCpuBytes: 0, maxGpuBytes: 0, gpuResourceCount: 0, longTaskCount: 0 });
  }
  const first = frames[0]!;
  const last = frames[frames.length - 1]!;
  const requests = frames.flatMap((frame) => [...frame.requestStarts, ...frame.requestFinishes]);
  const cache = frames.flatMap((frame) => frame.cacheEvents);
  const hits = cache.filter((event) => event.type === 'hit').length;
  const misses = cache.filter((event) => event.type === 'miss').length;
  const duplicates = requests.filter((event) => event.type === 'duplicate').length;
  const cancels = requests.filter((event) => event.type === 'cancel').length;
  const workerDurations = frames.flatMap((frame) => frame.workerEvents.filter((event) => event.type === 'finish' && event.durationMs !== undefined).map((event) => event.durationMs as number));
  const uploadDurations = frames.flatMap((frame) => frame.uploadEvents.filter((event) => event.type === 'finish' && event.durationMs !== undefined).map((event) => event.durationMs as number));
  const completeFrame = frames.find((frame) => frame.coverageComplete);
  const refinement = frames.filter((frame) => frame.phaseDurations.refinement !== undefined).reduce((sum, frame) => sum + (frame.phaseDurations.refinement ?? 0), 0);
  return Object.freeze({
    frameCount: frames.length,
    durationMs: Math.max(0, last.frameId - first.frameId),
    ...(first.phaseDurations.bootstrap !== undefined ? { bootstrapTimeMs: first.phaseDurations.bootstrap } : {}),
    ...(completeFrame === undefined ? {} : { firstCompleteCoverTimeMs: Math.max(0, completeFrame.frameId - first.frameId) }),
    ...(refinement > 0 ? { refinementTimeMs: refinement } : {}),
    cacheHitRate: hits + misses === 0 ? 0 : hits / (hits + misses),
    duplicateRequestRate: requests.length === 0 ? 0 : duplicates / requests.length,
    cancelRate: requests.length === 0 ? 0 : cancels / requests.length,
    workerP95Ms: percentile95(workerDurations),
    uploadP95Ms: percentile95(uploadDurations),
    frameP95Ms: percentile95(frames.map((frame) => frame.frameTime)),
    blankArea: Math.max(...frames.map((frame) => frame.blankArea)),
    maxCpuBytes: Math.max(...frames.map((frame) => frame.cpuBytes)),
    maxGpuBytes: Math.max(...frames.map((frame) => frame.gpuBytes)),
    gpuResourceCount: frames.reduce((max, frame) => Math.max(max, frame.uploadEvents.filter((event) => event.type === 'finish').length), 0),
    longTaskCount: frames.reduce((sum, frame) => sum + frame.longTasks.length, 0),
  });
}

/** 生成可复现、可校验的 versioned JSON timeline。 */
export function createTileTimeline(frames: readonly TileFrameDiagnostics[], generatedAt: number): TileTimeline {
  if (!Number.isFinite(generatedAt)) throw new RangeError('generatedAt 必须是有限数值。');
  return Object.freeze({ version: 1 as const, generatedAt, frames: Object.freeze([...frames]), summary: summarizeTileFrames(frames) });
}

export function serializeTileTimeline(timeline: TileTimeline): string {
  return JSON.stringify(timeline);
}

export function parseTileTimeline(serialized: string): TileTimeline {
  const value: unknown = JSON.parse(serialized);
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.frames) || !isRecord(value.summary)) throw new TypeError('Tile timeline schema version 不受支持。');
  return value as unknown as TileTimeline;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
