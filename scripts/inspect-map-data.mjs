import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(new URL('../packages/map3d/package.json', import.meta.url));
const { VectorTile } = await import(pathToFileURL(require.resolve('@mapbox/vector-tile')));
const { PbfReader } = await import(pathToFileURL(require.resolve('pbf')));
const samples = [['v8Maptile',7,107,55],['v8Maptile',7,106,55],['v8Maptile',6,53,27],['v8Maptile',5,26,12],['kye_admin_pro',4,13,6]];
const result = [];
await mkdir('docs/evidence/map-continuity', {recursive:true});
for (const [source,z,x,y] of samples) {
  const url = `https://tiles0.kye-erp.com/v2/maptile-dispatch/data/${source}/${z}/${x}/${y}.pbf`;
  const response = await fetch(url), bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(`docs/evidence/map-continuity/${source}-${z}-${x}-${y}.mvt`,bytes);
  const tile = new VectorTile(new PbfReader(bytes));
  const layers = {};
  for (const [name, layer] of Object.entries(tile.layers)) {
    const classes = {}, examples = [];
    for (let i=0; i<layer.length;i++) {
      const f=layer.feature(i), c=f.properties.class ?? f.properties.level ?? 'other'; classes[c]=(classes[c]??0)+1;
      if (['place','landuse','province','label'].includes(name) && examples.length<35) examples.push({properties:f.properties,type:f.type,bbox:f.bbox()});
    }
    layers[name]={count:layer.length,classes,examples};
  }
  result.push({url,status:response.status,bytes:bytes.length,layers});
}
await writeFile('docs/evidence/map-continuity/data.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
