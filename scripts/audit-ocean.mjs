import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const require = createRequire(new URL('../packages/map3d/package.json', import.meta.url));
const { VectorTile } = require('@mapbox/vector-tile'), { PbfReader } = require('pbf');
const records = [];
for (const [source, z, x, y] of [['kye_water_ocean',7,108,55],['kye_water_ocean',7,109,55],['kye_water_ocean',7,107,55],['kye_water',6,54,27],['kye_water',6,53,27]]) {
  const url = `https://tiles0.kye-erp.com/v2/maptile-dispatch/data/${source}/${z}/${x}/${y}.pbf`;
  const r = await fetch(url), bytes = new Uint8Array(await r.arrayBuffer());
  await writeFile(`docs/evidence/maplibre-alignment/${source}-${z}-${x}-${y}.mvt`,bytes);
  const layer = new VectorTile(new PbfReader(bytes)).layers.water;
  const a = {url,status:r.status,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),extent:layer?.extent,features:layer?.length,classes:{},areaWithBuffer:0,large:[],gridSamples:1024,waterSamples:0};
  const polygons=[];
  for(let i=0;i<(layer?.length??0);i++) {
    const f=layer.feature(i); a.classes[f.properties.class]=(a.classes[f.properties.class]??0)+1;
    let area=0; const rings=f.loadGeometry();
    for(const ring of rings) for(let j=1;j<ring.length;j++) area+=(ring[j-1].x*ring[j].y-ring[j].x*ring[j-1].y)/2;
    a.areaWithBuffer+=area/(layer.extent**2); polygons.push(rings);
    if(area>layer.extent**2*.05)a.large.push({properties:f.properties,area:area/layer.extent**2,bbox:f.bbox(),points:rings[0].slice(0,10)});
  }
  const inside=(ring,x,y)=>{let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const p=ring[i],q=ring[j];if((p.y>y)!==(q.y>y)&&x<(q.x-p.x)*(y-p.y)/(q.y-p.y)+p.x)hit=!hit;}return hit;};
  for(let y=0;y<32;y++)for(let x=0;x<32;x++)if(polygons.some(rings=>rings.reduce((hit,r)=>inside(r,(x+.5)/32*layer.extent,(y+.5)/32*layer.extent)?!hit:hit,false)))a.waterSamples++;
  records.push(a);
}
await writeFile('docs/evidence/maplibre-alignment/ocean-source-audit.json',JSON.stringify(records,null,2));
console.log(JSON.stringify(records));
