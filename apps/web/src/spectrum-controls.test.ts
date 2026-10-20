// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {attachSpectrumControls,defaultOrbit} from './spectrum-controls.js';
const cleanups:(()=>void)[]=[];
afterEach(()=>{cleanups.splice(0).forEach(clean=>clean());document.body.replaceChildren();});
function setup(){
 const canvas=document.createElement('canvas');document.body.append(canvas);
 const captured=new Set<number>();canvas.setPointerCapture=id=>{captured.add(id);};canvas.hasPointerCapture=id=>captured.has(id);canvas.releasePointerCapture=id=>{captured.delete(id);};
 Object.defineProperties(canvas,{clientWidth:{value:800},clientHeight:{value:400}});
 const orbit=defaultOrbit(),draw=vi.fn();cleanups.push(attachSpectrumControls(canvas,orbit,draw));
 const pointer=(type:string,id:number,x:number,y:number,touch=false)=>{const e=new Event(type,{cancelable:true});Object.assign(e,{pointerId:id,clientX:x,clientY:y,pointerType:touch?'touch':'mouse',button:0});canvas.dispatchEvent(e);return e;};
 return {canvas,orbit,draw,pointer,captured};
}
it('orbits all the way around, clamps pitch above/below, captures and cancels drags',()=>{
 const {pointer,orbit,captured,draw}=setup();pointer('pointerdown',1,0,0);expect(captured.has(1)).toBe(true);
 pointer('pointermove',1,900,1000);expect(orbit.yaw).toBeCloseTo(335);expect(orbit.pitch).toBe(85);
 pointer('pointermove',1,900,-1000);expect(orbit.pitch).toBe(-85);
 pointer('pointercancel',1,900,-1000);const before={...orbit};pointer('pointermove',1,0,0);expect(orbit).toEqual(before);expect(captured.size).toBe(0);expect(draw).toHaveBeenCalledTimes(2);
});
it('zooms with wheel in pixel, line and page units, bounds distance and resets on double click',()=>{
 const {canvas,orbit}=setup();
 for(const deltaMode of [0,1,2]){const e=new WheelEvent('wheel',{deltaY:-100,deltaMode,cancelable:true});canvas.dispatchEvent(e);expect(e.defaultPrevented).toBe(true);}
 expect(orbit.zoom).toBeLessThan(1);
 for(let i=0;i<30;i++)canvas.dispatchEvent(new WheelEvent('wheel',{deltaY:-500}));expect(orbit.zoom).toBe(.35);
 for(let i=0;i<30;i++)canvas.dispatchEvent(new WheelEvent('wheel',{deltaY:500}));expect(orbit.zoom).toBe(3);
 canvas.dispatchEvent(new MouseEvent('dblclick'));expect(orbit).toEqual(defaultOrbit());
});
it('rotates by touch, pinches without rotating, resumes one finger without jumping and double taps to reset',()=>{
 const {pointer,orbit}=setup();pointer('pointerdown',1,100,100,true);pointer('pointermove',1,120,140,true);expect(orbit.yaw).not.toBe(20);
 pointer('pointerdown',2,220,140,true);const yaw=orbit.yaw;pointer('pointermove',2,320,140,true);expect(orbit.zoom).toBe(.5);expect(orbit.yaw).toBe(yaw);
 pointer('pointermove',2,220,140,true);expect(orbit.zoom).toBe(1);pointer('pointerup',2,220,140,true);
 pointer('pointermove',1,130,140,true);expect(orbit.yaw).toBeCloseTo(yaw-4.5);pointer('pointerup',1,130,140,true);
 for(let i=0;i<2;i++){pointer('pointerdown',1,100,100,true);pointer('pointerup',1,100,100,true);}expect(orbit).toEqual(defaultOrbit());
});
it('clears interrupted gestures on blur and removes handlers on cleanup',()=>{
 const {pointer,orbit,canvas}=setup();pointer('pointerdown',1,0,0);window.dispatchEvent(new Event('blur'));pointer('pointermove',1,100,100);expect(orbit).toEqual(defaultOrbit());
 cleanups.pop()!();canvas.dispatchEvent(new WheelEvent('wheel',{deltaY:200}));expect(orbit).toEqual(defaultOrbit());
});
