import {useEffect,useRef,useState,type RefObject} from 'react';
import type {ButterchurnVisualizer} from 'butterchurn';
import {enableSpectrum} from './audio-spectrum.js';

/** Analysis-only branch from the player's single source. Never connected to destination. */
export function MilkDropVisualizer({audio,running,playing,preset,reduced,onError}:{audio:RefObject<HTMLAudioElement|null>;running:boolean;playing:boolean;preset:string;reduced:boolean;onError:(message:string)=>void}){
 const canvas=useRef<HTMLCanvasElement>(null);
 const renderer=useRef<ButterchurnVisualizer|null>(null);
 const collection=useRef<Record<string,object>>({});
 const selected=useRef(preset);const loaded=useRef('');
 const [ready,setReady]=useState(0);
 const dimensions=useRef({width:0,height:0});
 useEffect(()=>{selected.current=preset;},[preset]);
 useEffect(()=>{
  let cancelled=false;let source:AudioNode|undefined;let instance:ButterchurnVisualizer|undefined;let gl:WebGL2RenderingContext|null=null;
  const element=canvas.current!;
  const fail=(e:unknown)=>{if(!cancelled)onError(e instanceof Error?e.message:'MilkDrop is unavailable.');};
  const lost=(event:Event)=>{event.preventDefault();fail(new Error('MilkDrop graphics context lost. Switch to 3D Spectrum or retry.'));};
  element.addEventListener('webglcontextlost',lost);
  void (async()=>{
   const [{default:imported},{default:presets}]=await Promise.all([import('butterchurn'),import('./milkdrop/presets.js')]);
   // Published UMD/CommonJS builds expose an additional default wrapper in Vite.
   const butterchurn=(imported as unknown as {default?:typeof imported}).default??imported;
   if(cancelled||!audio.current)return;
   gl=element.getContext('webgl2');
   if(!gl)throw new Error('MilkDrop requires WebGL 2. You can continue using 3D Spectrum.');
   const graph=await enableSpectrum(audio.current);
   if(cancelled)return;
   instance=butterchurn.createVisualizer(graph.context,element,{width:Math.max(1,element.clientWidth),height:Math.max(1,element.clientHeight),pixelRatio:1,textureRatio:1});
   collection.current=presets;
   instance.loadPreset(presets[selected.current]!,0);loaded.current=selected.current;
   instance.connectAudio(graph.source);source=graph.source;
   renderer.current=instance;setReady(n=>n+1);
  })().catch(fail);
  return()=>{
   cancelled=true;element.removeEventListener('webglcontextlost',lost);
   if(source)try{instance?.disconnectAudio(source);}catch{/* Player teardown may already have disconnected the shared graph. */}
   renderer.current=null;loaded.current='';
   // Butterchurn 2.x has no dispose API: retire this dedicated context to release GPU objects.
   gl?.getExtension('WEBGL_lose_context')?.loseContext();
  };
 },[audio,onError]);
 useEffect(()=>{
  const instance=renderer.current;if(!instance||!collection.current[preset]||loaded.current===preset)return;
  try{instance.loadPreset(collection.current[preset]!,reduced||!playing?0:2);loaded.current=preset;}catch(e){onError(e instanceof Error?e.message:'Unable to load preset.');}
 },[preset,ready,reduced,playing,onError]);
 useEffect(()=>{
  const instance=renderer.current,element=canvas.current;if(!running||!instance||!element)return;
  let frame=0;let previous=0;let stopped=false;
  const draw=(time:number)=>{
   frame=0;if(stopped)return;
   if(previous&&time-previous<1000/(reduced?15:60)){frame=requestAnimationFrame(draw);return;}
   previous=time;
   try{instance.render();}catch(e){stopped=true;onError(e instanceof Error?e.message:'MilkDrop rendering failed.');return;}
   if(playing)frame=requestAnimationFrame(draw);
  };
  const resize=()=>{
   const width=Math.max(1,element.clientWidth),height=Math.max(1,element.clientHeight);
   const scale=Math.min(window.devicePixelRatio||1,1.5,1280/width,900/height);
   const next={width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
   // Resizing clears feedback textures; preset and playback changes must retain them.
   if(next.width!==dimensions.current.width||next.height!==dimensions.current.height){instance.setRendererSize(next.width,next.height);dimensions.current=next;}
   if(!frame&&!stopped)frame=requestAnimationFrame(draw);
  };
  const observer=new ResizeObserver(resize);observer.observe(element);resize();
  return()=>{stopped=true;cancelAnimationFrame(frame);observer.disconnect();};
 },[running,playing,ready,preset,reduced,onError]);
 return <canvas className="milkdrop-canvas" ref={canvas} tabIndex={0} role="img" aria-label="Live MilkDrop music visualization"/>;
}
