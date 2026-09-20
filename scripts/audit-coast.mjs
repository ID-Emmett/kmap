import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const require = createRequire(new URL('../packages/map3d/package.json', import.meta.url));
const { VectorTile } = require('@mapbox/vector-tile'), { PbfReader } = require('pbf');
const records=[], datasets=[];
const samples=[[114.216,22.21],[114.215,22.206],[114.22,22.207],[114.225,22.21]];
const inside=(ring,x,y)=>{let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const p=ring[i],q=ring[j];if((p.y>y)!==(q.y>y)&&x<(q.x-p.x)*(y-p.y)/(q.y-p.y)+p.x)hit=!hit;}return hit;};
for(const [source,z,x,y] of [['v8Maptile',16,53561,28621],['v8Maptile',16,53560,28620],['v8Maptile',7,104,55],['kye_water_ocean',7,104,55],['kye_water',6,52,27]]) {
 const url=`https://tiles0.kye-erp.com/v2/maptile-dispatch/data/${source}/${z}/${x}/${y}.pbf`;
 const r=await fetch(url), bytes=new Uint8Array(await r.arrayBuffer());
 await writeFile(`docs/evidence/maplibre-alignment/${source}-${z}-${x}-${y}.mvt`,bytes);
 const tile=new VectorTile(new PbfReader(bytes)); datasets.push({source,z,x,y,tile}); const rec={url,status:r.status,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),layers:{}};
 for(const [name,layer] of Object.entries(tile.layers)) {
   const features=Array.from({length:layer.length},(_,i)=>layer.feature(i));
   rec.layers[name]={count:layer.length,properties:features.slice(0,2).map(f=>f.properties)};
   if(name==='water')rec.layers[name].samples=samples.map(([lng,lat])=>{const tx=((lng+180)/360*2**z-x)*layer.extent,ty=((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*2**z-y)*layer.extent;return {lng,lat,inTile:tx>=0&&ty>=0&&tx<=layer.extent&&ty<=layer.extent,features:features.filter(f=>f.loadGeometry().reduce((hit,r)=>inside(r,tx,ty)?!hit:hit,false)).map(f=>f.properties)}});
 }
 records.push(rec);
}
const wet=(d,px,py)=>{const l=d.tile.layers.water;if(!l)return false;const x=(px*2**d.z-d.x)*l.extent,y=(py*2**d.z-d.y)*l.extent;for(let i=0;i<l.length;i++)if(l.feature(i).loadGeometry().reduce((hit,r)=>inside(r,x,y)?!hit:hit,false))return true;return false;};
const buildings=[], seaProbes=[];
for(const d of datasets.filter(d=>d.z===16)) {
 const candidates=[];
 for(let sy=512;sy<=3584;sy+=256)for(let sx=512;sx<=3584;sx+=256){
  if([-512,0,512].every(dx=>[-512,0,512].every(dy=>wet(d,(d.x+(sx+dx)/4096)/2**16,(d.y+(sy+dy)/4096)/2**16)))){
   const px=(d.x+sx/4096)/2**16,py=(d.y+sy/4096)/2**16;
   candidates.push({lng:px*360-180,lat:Math.atan(Math.sinh(Math.PI*(1-2*py)))*180/Math.PI,source:`16/${d.x}/${d.y}`});
  }
 }
 for(const i of [0,Math.floor(candidates.length/2),candidates.length-1])if(candidates[i])seaProbes.push(candidates[i]);
 const l=d.tile.layers.building;
 for(let i=0;i<l.length;i++) {
  const f=l.feature(i),r=f.loadGeometry()[0],p=r.slice(0,-1).reduce((a,p)=>({x:a.x+p.x/(r.length-1),y:a.y+p.y/(r.length-1)}),{x:0,y:0});
  const px=(d.x+p.x/l.extent)/2**d.z,py=(d.y+p.y/l.extent)/2**d.z;
  buildings.push({id:f.properties.buildingId,lng:px*360-180,lat:Math.atan(Math.sinh(Math.PI*(1-2*py)))*180/Math.PI,primaryWet:wet(d,px,py),detailWet:wet(datasets[3],px,py),baseWet:wet(datasets[4],px,py)});
 }
}
records.push({buildings,seaProbes});
await writeFile('docs/evidence/maplibre-alignment/coast-source-audit.json',JSON.stringify(records,null,2));
console.log(JSON.stringify(records));
