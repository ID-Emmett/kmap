import type { StreamingEngine } from './engine.js';
import { geometryPoolStats } from './geometryPool.js';

/** 面板字段由实际队列、纹理与当前覆盖集合计算。 */
export function tileDiagnostics(engine: StreamingEngine) {
  const entries = [...engine.entries.values()];
  const slots = engine.surfaces.slotStats;
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
    // 每个绘制实例的线段数据与渲染状态：空线段表示该瓦片没有可画的道路内容（数据侧）；
    // 隐藏、模板编号不一致或槽位未初始化表示线路在渲染上被丢弃。
    lineInstances: (() => {
      let empty = 0, hidden = 0, mismatch = 0, uninit = 0, faint = 0, clear = 0; const samples: string[] = [];
      for (const instance of engine.surfaces.instances.values()) {
        const key = `${instance.address.z}/${instance.address.x}/${instance.address.y}`;
        const lines = instance.lines;
        if (!lines || !lines.data?.segments?.length) { empty++; if (samples.length < 6) samples.push(`${key}:empty`); continue; }
        if (lines.mesh.visible === false) { hidden++; if (samples.length < 6) samples.push(`${key}:hidden`); }
        if (instance.mesh.material.stencilRef !== lines.mesh.material.stencilRef) { mismatch++; if (samples.length < 6) samples.push(`${key}:stencil`); }
        if ((lines.viewZoom?.value ?? 0) < 0) { uninit++; if (samples.length < 6) samples.push(`${key}:uninit`); }
        // 宽度与透明度：任一为零都会让线路在渲染上不可见，但网格与数据都正常。
        const widths = lines.widths;
        if (widths && widths.length > 1 && !((widths[0] ?? 0) > 0) && !((widths[1] ?? 0) > 0)) { faint++; if (samples.length < 6) samples.push(`${key}:faint`); }
        if ((lines.mesh.material.opacity ?? 1) === 0) { clear++; if (samples.length < 6) samples.push(`${key}:clear`); }
      }
      return { count: engine.surfaces.instances.size, empty, hidden, mismatch, uninit, faint, clear, samples };
    })(),
    // 逐格线路诊断：列出没有线段可画的格子及其来源瓦片，用于定位"线路整块消失"。
    noLineCells: (() => {
      let count = 0; const samples: string[] = [];
      for (const patch of engine.patches) {
        const surface = engine.entries.get(patch.key)?.surface;
        if (surface?.lines?.data?.segments?.length) continue;
        count++;
        if (samples.length < 8) samples.push(`${patch.cell.z}/${patch.cell.x}/${patch.cell.y}<-${patch.source.z}/${patch.source.x}/${patch.source.y}${surface ? '' : ':nosurface'}`);
      }
      return { count, samples };
    })(),
    cache: { resident, warm: ready - resident, cold: count('decoded') + upload, entries: entries.length, maxEntries: engine.maxEntries, evictions: engine.evictions,
      cpuBytes: engine.cpuBytes, maxCpuBytes: engine.maxCpuBytes, pressure: engine.cpuBytes > engine.maxCpuBytes || entries.length > engine.maxEntries, pressureReasons: engine.cpuBytes > engine.maxCpuBytes ? ['CPU budget'] : [] },
    resources: { entries: ready, referencedEntries: resident, releases: engine.evictions, gpuBytes: engine.gpuBytes, maxGpuBytes: engine.maxGpuBytes,
      poolSize: engine.surfaces.poolSize, poolBytes: engine.surfaces.poolBytes,
      slots, geometryPool: { ...geometryPoolStats },
      pressureReasons: engine.gpuBytes > engine.maxGpuBytes ? ['GPU budget'] : [] },
  };
}
