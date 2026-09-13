import { describe, expect, it } from 'vitest';
import { createCanonicalTileKey } from '../src/nova-tile/tileAddress.js';
import { TileDiagnostics, parseTileTimeline, percentile95, serializeTileTimeline, summarizeTileFrames } from '../src/nova-tile/diagnostics/index.js';
import type { TileCoverSummary } from '../src/nova-tile/diagnostics/index.js';

const key = createCanonicalTileKey('main', 'r1', 3, 1, 1)!;
const cover: TileCoverSummary = { tileCount: 1, keys: ['main/r1/3/1/1'], complete: true, blankArea: 0 };

describe('NTE TileDiagnostics and Timeline', () => {
  it('records cover, request, cache, worker, upload, commit, frame and long-task events', () => {
    const diagnostics = new TileDiagnostics({ clock: { now: () => 1000 } });
    diagnostics.beginFrame({ frameId: 1, planEpoch: 2, targetCover: cover, committedCover: cover, coverageComplete: true, blankArea: 0, cpuBytes: 10, gpuBytes: 20, frameTime: 16, phaseDurations: { bootstrap: 12 } });
    diagnostics.recordRequest({ type: 'start', key, reason: 'visible-critical', phase: 'settled', at: 1 });
    diagnostics.recordRequestFinish({ type: 'finish', key, reason: 'visible-critical', phase: 'settled', at: 4, durationMs: 3, bytes: 100 });
    diagnostics.recordCache({ type: 'hit', key, role: 'resident', at: 2 });
    diagnostics.recordWorker({ type: 'finish', jobId: 7, key, at: 8, durationMs: 5 });
    diagnostics.recordUpload({ type: 'finish', key, at: 10, bytes: 50, durationMs: 2 });
    diagnostics.recordCommit({ type: 'commit', cohortId: 1, planEpoch: 2, at: 11 });
    diagnostics.recordLongTask({ startTime: 12, durationMs: 60, name: 'layout' });
    const frame = diagnostics.endFrame();
    expect(frame.requestStarts).toHaveLength(1);
    expect(frame.workerEvents[0]?.durationMs).toBe(5);
    expect(frame.longTasks[0]?.durationMs).toBe(60);
    expect(diagnostics.timeline.version).toBe(1);
  });

  it('serializes and validates timeline schema for 60-second samples', () => {
    const diagnostics = new TileDiagnostics({ maxFrames: 3_600 });
    for (let frameId = 0; frameId < 3_600; frameId += 1) {
      diagnostics.beginFrame({ frameId, planEpoch: 1, targetCover: cover, committedCover: cover, coverageComplete: true, blankArea: 0, frameTime: 16.6 });
      diagnostics.endFrame();
    }
    const serialized = serializeTileTimeline(diagnostics.timeline);
    const parsed = parseTileTimeline(serialized);
    expect(parsed.frames).toHaveLength(3_600);
    expect(parsed.summary.frameCount).toBe(3_600);
  });

  it('aggregates cache, duplicate, cancel, worker/upload/frame P95 and resources', () => {
    const diagnostics = new TileDiagnostics();
    diagnostics.beginFrame({ frameId: 1, planEpoch: 1, targetCover: cover, committedCover: cover, coverageComplete: true, blankArea: 0, cpuBytes: 100, gpuBytes: 200, frameTime: 10 });
    diagnostics.recordCache({ type: 'hit', key, at: 1 });
    diagnostics.recordCache({ type: 'miss', key, at: 2 });
    diagnostics.recordRequest({ type: 'duplicate', key, reason: 'warm-prefetch', phase: 'idle', at: 3 });
    diagnostics.recordRequest({ type: 'cancel', key, reason: 'retry', phase: 'idle', at: 4 });
    diagnostics.recordWorker({ type: 'finish', jobId: 1, key, at: 5, durationMs: 10 });
    diagnostics.recordUpload({ type: 'finish', key, at: 6, bytes: 10, durationMs: 4 });
    diagnostics.endFrame();
    const summary = diagnostics.timeline.summary;
    expect(summary.cacheHitRate).toBe(0.5);
    expect(summary.duplicateRequestRate).toBeGreaterThan(0);
    expect(summary.cancelRate).toBeGreaterThan(0);
    expect(summary.workerP95Ms).toBe(10);
    expect(summary.uploadP95Ms).toBe(4);
    expect(summary.frameP95Ms).toBe(10);
    expect(summary.maxGpuBytes).toBe(200);
  });

  it('rejects malformed frame inputs and computes percentile deterministically', () => {
    const diagnostics = new TileDiagnostics();
    expect(() => diagnostics.beginFrame({ frameId: -1, planEpoch: 0, targetCover: cover, committedCover: cover, coverageComplete: true, blankArea: 0 })).toThrow();
    expect(percentile95([10, 1, 5, 3, 2])).toBe(10);
    expect(() => diagnostics.recordLongTask({ startTime: 1, durationMs: -1 })).toThrow();
    expect(summarizeTileFrames([]).frameCount).toBe(0);
  });
});
