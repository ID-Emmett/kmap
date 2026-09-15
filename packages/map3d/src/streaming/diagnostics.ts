import type { StreamingEngine } from './engine.js';

/** 面板字段由实际队列、纹理与当前覆盖集合计算。 */
export function tileDiagnostics(engine: StreamingEngine) {
  const entries = [...engine.entries.values()];
  const count = (state: string) => entries.filter(e => e.state === state).length;
  const ready = count('ready'); const queued = count('queued'); const painting = count('painting'); const upload = count('upload');
  const levels: Record<string, number> = {};
  for (const leaf of engine.selection.leaves) levels[leaf.z] = (levels[leaf.z] ?? 0) + 1;
  const resident = engine.shown.size;
  const idle = queued + engine.active + painting + upload === 0;
  return {
    idle, phase: idle ? 'idle' : 'streaming', target: engine.selection.leaves.length, committed: resident,
    outgoing: [...engine.shown].filter(k => !engine.selection.leaves.some(a => `${a.z}/${a.x}/${a.y}` === k)).length,
    targetMissing: engine.targetMissing, uncoveredCells: engine.uncovered, displayZoomGap: engine.displayZoomGap, coverageComplete: engine.uncovered === 0 && engine.selection.leaves.length > 0, levels,
    maxLodDelta: Math.max(0, ...Object.keys(levels).map(Number)) - Math.min(...Object.keys(levels).map(Number), 24),
    footprint: { loadCutoff: engine.selection.cutoff, fogStart: engine.selection.fogStart },
    selection: { visited: engine.selection.visited, culled: engine.selection.culled },
    coverageDetails: engine.coverageDetails,
    phases: { plan: engine.planTime.snapshot(), cover: engine.coverTime.snapshot(), resources: engine.recycleTime.snapshot() },
    worker: engine.workerTime.snapshot(), uploadTime: engine.uploadTime.snapshot(), requestTime: engine.requestTime.snapshot(),
    scheduler: { queued, active: engine.active, requestStarts: engine.starts, requestCancels: engine.cancels },
    network: { starts: engine.starts, retries: engine.retries, cancels: 0, errors: engine.errors, bytes: engine.bytes, latency: engine.httpTime.snapshot() },
    upload: { queued: upload, active: 0 }, cacheHits: engine.hits, cacheMisses: engine.misses, cacheHitRate: engine.hits / Math.max(1, engine.hits + engine.misses),
    cache: { resident, warm: ready - resident, cold: 0, entries: entries.length, maxEntries: engine.maxEntries, evictions: engine.evictions,
      cpuBytes: engine.cpuBytes, maxCpuBytes: engine.maxCpuBytes, pressure: engine.cpuBytes > engine.maxCpuBytes || entries.length > engine.maxEntries, pressureReasons: engine.cpuBytes > engine.maxCpuBytes ? ['CPU budget'] : [] },
    resources: { entries: ready, referencedEntries: resident, releases: engine.evictions, gpuBytes: engine.gpuBytes, maxGpuBytes: engine.maxGpuBytes,
      pressureReasons: engine.gpuBytes > engine.maxGpuBytes ? ['GPU budget'] : [] },
  };
}
