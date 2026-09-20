import type { StreamingEngine } from './engine.js';

/** 面板字段由实际队列、纹理与当前覆盖集合计算。 */
export function tileDiagnostics(engine: StreamingEngine) {
  const entries = [...engine.entries.values()];
  const count = (state: string) => entries.filter(e => e.state === state).length;
  const ready = entries.filter(e => e.state === 'ready' && e.surface).length; const queued = count('queued'); const upload = count('upload');
  const levels: Record<string, number> = {};
  for (const leaf of engine.selection.leaves) levels[leaf.z] = (levels[leaf.z] ?? 0) + 1;
  const resident = engine.shown.size;
  const idle = entries.filter(e => Number.isFinite(e.priority) && !['ready', 'failed'].includes(e.state)).length === 0;
  return {
    buildings: { batches: [...engine.surfaces.instances.values()].filter(i => i.buildings?.mesh.visible).length,
      features: [...engine.surfaces.instances.values()].reduce((sum, i) => sum + (i.buildings?.mesh.visible ? i.buildings.features : 0), 0) },
    idle, phase: idle ? 'idle' : 'stream', target: engine.selection.leaves.length, committed: resident,
    drawnLevels: Object.fromEntries([...new Set(engine.patches.map(p => p.source.z))].map(z => [z, new Set(engine.patches.filter(p => p.source.z === z).map(p => p.key)).size])),
    idealCount: engine.selection.ideal.length, budgetReduced: engine.selection.budgetReduced, patches: engine.patches.length,
    targetMissing: engine.targetMissing, uncoveredCells: engine.uncovered, displayZoomGap: engine.displayZoomGap, pendingDetailGap: engine.pendingDetailGap, coverageComplete: engine.uncovered === 0 && engine.selection.leaves.length > 0, levels,
    primaryFallbacks: engine.coverageDetails.filter(p => engine.entries.get(p.target)?.empty).map(p => ({ target: p.target, source: p.source })),
    primaryEmpty: entries.filter(e => e.primaryEmpty).map(e => ({ key: e.key, drawable: engine.store.available.has(e.key) })),
    maxLodDelta: Math.max(0, ...Object.keys(levels).map(Number)) - Math.min(...Object.keys(levels).map(Number), 24),
    footprint: { loadCutoff: engine.selection.cutoff, fogStart: engine.selection.fogStart },
    selection: { visited: engine.selection.visited, culled: engine.selection.culled, fogCulled: engine.selection.fogCulled },
    coverageDetails: engine.coverageDetails,
    phases: { plan: engine.planTime.snapshot(), cover: engine.coverTime.snapshot(), resources: engine.recycleTime.snapshot() },
    worker: engine.workerTime.snapshot(), uploadTime: engine.uploadTime.snapshot(), requestTime: engine.requestTime.snapshot(),
    scheduler: { queued, active: engine.active, requestStarts: engine.starts, requestCancels: engine.cancels },
    network: { starts: engine.pipeline.httpStarts, retries: engine.retries, cancels: engine.pipeline.cancels, errors: engine.errors, bytes: engine.bytes, latency: engine.httpTime.snapshot() },
    recentErrors: [...engine.pipeline.recentErrors],
    responseCache: { bytes: engine.pipeline.overlays.bytes, pendingBytes: engine.pipeline.overlays.pendingBytes,
      maxBytes: engine.pipeline.overlays.maxBytes, maxPendingBytes: engine.pipeline.overlays.maxPendingBytes },
    inFlightReservedBytes: entries.reduce((sum, e) => sum + e.reservedBytes, 0), decoded: count('decoded'), discardedBytes: engine.pipeline.discardedBytes,
    demand: { visible: entries.filter(e => e.kind === 'visible' && engine.wanted.has(e.key)).length, fallback: entries.filter(e => e.kind === 'fallback' && engine.wanted.has(e.key)).length, predicted: entries.filter(e => e.kind === 'predicted' && engine.wanted.has(e.key)).length },
    upload: { queued: upload, active: count('preparing') }, cacheHits: engine.hits, cacheMisses: engine.misses, cacheHitRate: engine.hits / Math.max(1, engine.hits + engine.misses),
    cache: { resident, warm: ready - resident, cold: count('decoded') + upload, entries: entries.length, maxEntries: engine.maxEntries, evictions: engine.evictions,
      cpuBytes: engine.cpuBytes, maxCpuBytes: engine.maxCpuBytes, pressure: engine.cpuBytes > engine.maxCpuBytes || entries.length > engine.maxEntries, pressureReasons: engine.cpuBytes > engine.maxCpuBytes ? ['CPU budget'] : [] },
    resources: { entries: ready, referencedEntries: resident, releases: engine.evictions, gpuBytes: engine.gpuBytes, maxGpuBytes: engine.maxGpuBytes,
      pressureReasons: engine.gpuBytes > engine.maxGpuBytes ? ['GPU budget'] : [] },
  };
}
