import {expect,it} from 'vitest';
import {spectrumCamera,spectrumTowerScale} from './spectrum-camera.js';
function projectedBounds(aspect:number,angle:number,bands=32){
 const width=bands*.46,height=28*.205*spectrumTowerScale(aspect),depth=3*1.15;
 const matrix=spectrumCamera(aspect,angle,width,height,depth);
 const projected:number[][]=[];
 for(const x of [-width/2,width/2])for(const y of [-1.6,height+.2])for(const z of [-depth/2,depth/2]){
  const point=[x,y,z,1];const clip=[0,1,2,3].map(row=>point.reduce((sum,v,column)=>sum+matrix[column*4+row]!*v,0));
  expect(clip[3]).toBeGreaterThan(0);projected.push([clip[0]!/clip[3]!,clip[1]!/clip[3]!]);
 }
 return projected;
}
it('keeps full-height towers and the floor reflection inside portrait, landscape and wide stages at every camera angle',()=>{
 for(const bands of [24,32,48])for(const aspect of [.45,.65,.8,1,1.5,2.5,3.5])for(const angle of [-40,0,20,40]){
  const points=projectedBounds(aspect,angle,bands);
  for(const point of points)for(const axis of point)expect(Math.abs(axis)).toBeLessThanOrEqual(.941);
 }
});
it('uses the available frame instead of shrinking the spectrum behind a fixed camera distance',()=>{
 for(const aspect of [.65,1,2.5,3.5]){
  const points=projectedBounds(aspect,20);
  const span=[0,1].map(axis=>Math.max(...points.map(p=>p[axis]!))-Math.min(...points.map(p=>p[axis]!)));
  expect(Math.max(...span)).toBeGreaterThan(1.5); // At least 75% of the stage on its limiting axis.
 }
});
it('produces stable perspective matrices through full orbits, overhead and underside views at zoom limits',()=>{
 for(const aspect of [.45,1,3.5])for(const yaw of [0,90,180,270,360,720])for(const pitch of [-85,0,85])for(const zoom of [.35,1,3]){
  const matrix=spectrumCamera(aspect,yaw,48*.46,19,3.45,pitch,zoom,true);
  expect([...matrix].every(Number.isFinite)).toBe(true);
  // The orbit target remains at the center with the eye outside all skyline corners.
  const target=[0,19*.4,0,1];const clip=[0,1,2,3].map(row=>target.reduce((sum,v,col)=>sum+matrix[col*4+row]!*v,0));
  expect(clip[0]!/clip[3]!).toBeCloseTo(0);expect(clip[1]!/clip[3]!).toBeCloseTo(0);expect(clip[3]).toBeGreaterThan(Math.hypot(48*.46/2,19*.6+.2,3.45/2));
 }
});
