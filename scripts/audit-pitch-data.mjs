import { VectorTile } from '../packages/map3d/node_modules/@mapbox/vector-tile/index.js';
import { PbfReader } from '../packages/map3d/node_modules/pbf/index.js';
import { writeFileSync } from 'node:fs';
const keys = ['6/50/26', '7/104/51', '7/104/52', '14/13488/6207', '15/26976/12418', '8/215/99'];
const results = await Promise.all(keys.map(async key => {
  const response = await fetch(`https://tiles0.kye-erp.com/v2/maptile-dispatch/data/v8Maptile/${key}.pbf`);
  const data = new Uint8Array(await response.arrayBuffer());
  writeFileSync(`docs/evidence/streaming-rebuild/T046-pitch-${key.replaceAll('/', '-')}.pbf`, data);
  const tile = new VectorTile(new PbfReader(data)); const layers = {};
  for (const [name, layer] of Object.entries(tile.layers)) {
    const classes = {}; let negative = 0, positive = 0; const features = [];
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i); const cls = String(f.properties.class); classes[cls] = (classes[cls] ?? 0) + 1;
      const g = f.loadGeometry();
      for (const ring of g) { let area = 0; for (let k = 0; k < ring.length - 1; k++) area += ring[k].x * ring[k + 1].y - ring[k + 1].x * ring[k].y; if (area < 0) negative++; else if (area > 0) positive++; }
      if (name === 'water') features.push({ properties: f.properties, g });
    }
    layers[name] = { features: layer.length, classes, positive, negative };
    if (name === 'water') writeFileSync(`docs/evidence/streaming-rebuild/T046-pitch-water-${key.replaceAll('/', '-')}.json`, JSON.stringify({ extent: layer.extent, features }));
  }
  return { key, status: response.status, bytes: data.length, layers };
}));
writeFileSync('docs/evidence/streaming-rebuild/T046-pitch-data-audit.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
