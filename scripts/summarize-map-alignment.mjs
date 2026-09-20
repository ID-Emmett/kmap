import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';

const directory = 'docs/evidence/streaming-rebuild';
const chosen = new Map();
for (const file of (await readdir(directory)).filter(f => f.endsWith('.json')).sort()) {
  const data = JSON.parse(await readFile(`${directory}/${file}`, 'utf8'));
  if (!['maplibre-alignment-real', 'maplibre-alignment-seams', 'label-subpixel-motion', 'cold-continuity', 'pointer-anchor-ui'].includes(data.kind)) continue;
  if (data.at < '2026-09-20T00:40:00Z') continue;
  const key = `${data.kind}:${data.backend}:${data.viewport?.width}:${data.viewport?.pixelRatio}`;
  chosen.set(key, { file: `${directory}/${file}`, data });
}
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const evidence = [];
for (const { file, data } of chosen.values()) {
  const record = { file, sha256: sha256(await readFile(file)), kind: data.kind, backend: data.backend, viewport: data.viewport };
  if (data.kind === 'maplibre-alignment-real') Object.assign(record, {
    scenes: data.scenes.map(s => ({ name: s.name, settled: s.settled, missing: s.diagnostics.tiles.targetMissing,
      uncovered: s.diagnostics.tiles.uncoveredCells, labels: s.diagnostics.labels.placed })),
    motionFrames: data.frames.length, motionUncovered: data.frames.filter(f => f.uncovered).length,
    performance: data.performance, errors: data.errors,
    screenshots: await Promise.all(data.visualFrames.map(async f => ({ name: f.name, file: `docs/evidence/${f.image}`, sha256: sha256(await readFile(`docs/evidence/${f.image}`)) }))),
  });
  if (data.kind === 'maplibre-alignment-seams') Object.assign(record, { frames: data.frames.length, requests: data.requests, settled: data.settled,
    anomalies: data.anomalies.length, maxHoles: Math.max(...data.frames.map(f => f.holes)), uncoveredFrames: data.frames.filter(f => f.uncovered).length, errors: data.errors });
  if (data.kind === 'label-subpixel-motion') Object.assign(record, { frames: data.frames.length, settled: data.settled,
    glyphRange: [Math.min(...data.frames.map(f => f.glyphs)), Math.max(...data.frames.map(f => f.glyphs))], relativeRange: data.relativeRange, maxStep: data.maxStep });
  if (data.kind === 'cold-continuity') Object.assign(record, { network: data.network, completed: data.completed, frames: data.frames.length,
    reversions: data.reversions, maxRepeatedRenderDifference: data.maxChanged, seenOceanSamples: data.seen, errors: data.errors });
  if (data.kind === 'pointer-anchor-ui') Object.assign(record, { errorPixels: data.errorPixels, before: data.before, after: data.after });
  evidence.push(record);
}
const references = [
  ['../map-continuity/kye-ocean-7-107-55.mvt', 'https://tiles0.kye-erp.com/v2/maptile-dispatch/data/kye_water_ocean/7/107/55.pbf'],
  ['line.vertex.glsl', 'https://raw.githubusercontent.com/maplibre/maplibre-gl-js/b044d9f8de4ee1c22430c1b79d10e004e5e86994/src/shaders/line.vertex.glsl'],
  ['line.fragment.glsl', 'https://raw.githubusercontent.com/maplibre/maplibre-gl-js/b044d9f8de4ee1c22430c1b79d10e004e5e86994/src/shaders/line.fragment.glsl'],
  ['line_bucket.ts', 'https://raw.githubusercontent.com/maplibre/maplibre-gl-js/b044d9f8de4ee1c22430c1b79d10e004e5e86994/src/data/bucket/line_bucket.ts'],
  ['symbol_sdf.fragment.glsl', 'https://raw.githubusercontent.com/maplibre/maplibre-gl-js/b044d9f8de4ee1c22430c1b79d10e004e5e86994/src/shaders/symbol_sdf.fragment.glsl'],
  ['style-spec-v8.json', 'https://raw.githubusercontent.com/maplibre/maplibre-style-spec/main/src/reference/v8.json'],
  ['liberty.json', 'https://tiles.openfreemap.org/styles/liberty'],
  ['kye-normal.json', 'https://tiles.kye-erp.com/maptiles/styles/v3/normal.json'],
];
const sources = await Promise.all(references.map(async ([name, url]) => ({ url, file: `docs/evidence/maplibre-alignment/${name}`,
  sha256: sha256(await readFile(`docs/evidence/maplibre-alignment/${name}`)) })));
const implementation = [];
for (const dir of ['packages/map3d/src/streaming', 'packages/map3d/src/labels', 'packages/map3d/src/interaction']) {
  for (const name of (await readdir(dir)).filter(f => f.endsWith('.ts'))) {
    const file = `${dir}/${name}`; implementation.push({ file, sha256: sha256(await readFile(file)) });
  }
}
for (const file of ['packages/map3d/src/globe/projection.ts', 'apps/playground/src/mapStyle.ts', 'apps/playground/src/roadStyle.ts', 'apps/playground/src/main.ts']) {
  implementation.push({ file, sha256: sha256(await readFile(file)) });
}
await writeFile('docs/evidence/maplibre-alignment/verification-summary.json', `${JSON.stringify({ at: new Date().toISOString(), sources, implementation, evidence }, null, 2)}\n`);
console.log(JSON.stringify(evidence.map(({ kind, backend, viewport, performance, anomalies, completed, errors }) => ({ kind, backend, viewport, performance, anomalies, completed, errors })), null, 2));
