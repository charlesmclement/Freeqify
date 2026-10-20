export type SpectrumOrbit={yaw:number;pitch:number;zoom:number};
export const defaultOrbit=():SpectrumOrbit=>({yaw:20,pitch:16,zoom:1});
/** Canvas-local gestures; camera mutations never touch React or the audio graph. */
export function attachSpectrumControls(canvas:HTMLCanvasElement,orbit:SpectrumOrbit,invalidate:()=>void){
 const pointers=new Map<number,{x:number;y:number}>();
 let tap:{time:number;x:number;y:number}|undefined;
 let start:{x:number;y:number;time:number}|undefined;let moved=false;
 const reset=()=>{Object.assign(orbit,defaultOrbit());invalidate();};
 const zoom=(factor:number)=>{orbit.zoom=Math.max(.35,Math.min(3,orbit.zoom*factor));invalidate();};
 const distance=()=>{const [a,b]=[...pointers.values()];return a&&b?Math.hypot(a.x-b.x,a.y-b.y):0;};
 const down=(e:PointerEvent)=>{
  if(e.pointerType==='mouse'&&e.button!==0)return;
  e.preventDefault();canvas.focus({preventScroll:true});canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pointers.size===1){start={x:e.clientX,y:e.clientY,time:e.timeStamp};moved=false;}else{moved=true;tap=undefined;}
 };
 const move=(e:PointerEvent)=>{
  const old=pointers.get(e.pointerId);if(!old)return;e.preventDefault();
  const before=distance(),dx=e.clientX-old.x,dy=e.clientY-old.y;
  pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(start&&Math.hypot(e.clientX-start.x,e.clientY-start.y)>6)moved=true;
  if(pointers.size===2){const after=distance();if(before>0&&after>0)zoom(before/after);}
  else if(pointers.size===1){
   const scale=180/Math.max(160,Math.min(canvas.clientWidth,canvas.clientHeight));
   orbit.yaw=((orbit.yaw-dx*scale)%360+360)%360;
   orbit.pitch=Math.max(-85,Math.min(85,orbit.pitch+dy*scale));invalidate();
  }
 };
 const end=(e:PointerEvent)=>{
  if(!pointers.has(e.pointerId))return;
  if(e.type==='pointerup'&&e.pointerType==='touch'&&pointers.size===1&&!moved&&start&&e.timeStamp-start.time<300){
   if(tap&&e.timeStamp-tap.time<350&&Math.hypot(e.clientX-tap.x,e.clientY-tap.y)<28){reset();tap=undefined;}
   else tap={time:e.timeStamp,x:e.clientX,y:e.clientY};
  }else tap=undefined;
  pointers.delete(e.pointerId);start=undefined;
  if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
 };
 const wheel=(e:WheelEvent)=>{e.preventDefault();const units=e.deltaMode===1?16:e.deltaMode===2?canvas.clientHeight:1;zoom(Math.exp(Math.max(-.3,Math.min(.3,e.deltaY*units*.0015))));};
 const double=(e:MouseEvent)=>{e.preventDefault();reset();};
 const cancel=()=>{for(const id of pointers.keys())if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);pointers.clear();start=undefined;tap=undefined;};
 canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);
 for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,end as EventListener);
 canvas.addEventListener('wheel',wheel,{passive:false});canvas.addEventListener('dblclick',double);window.addEventListener('blur',cancel);
 return()=>{cancel();canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.removeEventListener(type,end as EventListener);canvas.removeEventListener('wheel',wheel);canvas.removeEventListener('dblclick',double);window.removeEventListener('blur',cancel);};
}
