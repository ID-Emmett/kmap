/** 临时检查：对比同一位置的 z6 与 z7 主源瓦片包含的图层，确认回退层级是否具备道路数据。 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(new URL('../packages/map3d/package.json', import.meta.url));
const { VectorTile } = await import(pathToFileURL(require.resolve('@mapbox/vector-tile')));
const { PbfReader } = await import(pathToFileURL(require.resolve('pbf')));
const samples = [[6, 51, 27], [7, 103, 54], [7, 103, 55], [6, 51, 26], [5, 25, 13]];
for (const [z, x, y] of samples) {
  const url = `https://tiles0.kye-erp.com/v2/maptile-dispatch/data/v8Maptile/${z}/${x}/${y}.pbf`;
  try {
    const response = await fetch(url), bytes = new Uint8Array(await response.arrayBuffer());
    if (!response.ok || bytes.length === 0) { console.log(`z${z}/${x}/${y}`, 'status', response.status, 'bytes', bytes.length); continue; }
    const tile = new VectorTile(new PbfReader(bytes));
    const layers = Object.entries(tile.layers).map(([name, layer]) => `${name}:${layer.length}`).join(' ');
    const road = tile.layers['road'], transport = tile.layers['transportation'];
    const roadClasses = road ? (() => { const c = {}; for (let i = 0; i < road.length; i++) { const v = road.feature(i).properties.class ?? '?'; c[v] = (c[v] ?? 0) + 1; } return JSON.stringify(c); })() : '-';
    console.log(`z${z}/${x}/${y}`, 'bytes', bytes.length);
    console.log('   layers:', layers);
    console.log('   road:', road ? road.length : 0, roadClasses, '| transportation:', transport ? transport.length : 0);
  } catch (error) { console.log(`z${z}/${x}/${y}`, 'ERR', String(error.message).slice(0, 100)); }
}
