"""根据逐帧诊断相机重建地面采样点，核对层级差区域的屏幕占比。"""
import json, math, sys, numpy as np
from pathlib import Path
path=Path(sys.argv[1])
r=json.loads(path.read_text())
W=40075016.68557849
records=[]
for s in r['samples']:
 d=s['diagnostics']; bad=[i for i in d['tiles'].get('coverageDetails',[]) if i['gap']>2]
 if not bad: continue
 v=d['view']; p=d['camera']['position']; origin=d['camera']['origin']['meters']; f=d['tiles']['footprint']
 pitch=math.radians(v['pitch']); bearing=math.radians(v['bearing'])
 up=np.array([math.sin(bearing)*math.cos(pitch),math.sin(pitch),-math.cos(bearing)*math.cos(pitch)])
 forward=np.array([math.sin(bearing)*math.sin(pitch),-math.cos(pitch),-math.cos(bearing)*math.sin(pitch)])
 right=np.cross(forward,up); a=d['viewport']['width']/d['viewport']['height']; t=math.tan(math.pi/8)
 x,y=np.meshgrid(np.linspace(-.999,.999,256),np.linspace(-.999,.999,130)); rays=forward+up*y[...,None]*t+right*x[...,None]*t*a
 distance=-p['y']/rays[:,:,1]; X=p['x']+rays[:,:,0]*distance+origin['x']; Y=origin['y']-(p['z']+rays[:,:,2]*distance)
 cx=v['center']['lng']/360*W; cy=math.log(math.tan(math.pi/4+v['center']['lat']*math.pi/360))/(2*math.pi)*W
 visible=(distance>0)&(np.hypot(X-cx,Y-cy)<f['loadCutoff'])
 for item in bad:
  z,tx,ty=map(int,item['target'].split('/')); span=W/2**z; west=tx*span-W/2; north=W/2-ty*span
  mask=visible&(X>=west)&(X<west+span)&(Y<=north)&(Y>north-span)
  records.append({**item,'atMs':s['atMs'],'stage':s.get('stage'),'visibleSamples':int(mask.sum()),'fraction':float(mask.mean()),'unfoggedSamples':int((mask&(np.hypot(X-cx,Y-cy)<f['fogStart'])).sum())})
print('observations>2',len(records),'visible',sum(i['visibleSamples']>0 for i in records),'gap>3-visible',sum(i['visibleSamples']>0 and i['gap']>3 for i in records))
print(json.dumps(sorted([r for r in records if r['gap']>3],key=lambda i:-i['fraction'])[:6],indent=2))
path.with_name(path.stem+'-detail-screen.json').write_text(json.dumps(records,indent=2))
