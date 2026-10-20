import {useCallback,useEffect,useRef,useState,type RefObject} from 'react';
import {MilkDropVisualizer} from './MilkDropVisualizer.js';
import {presetNames} from './milkdrop/names.js';
import {disableSpectrum,enableSpectrum,sampleSpectrum,smoothSpectrum,remapSpectrum} from './audio-spectrum.js';
import {defaultOrbit} from './spectrum-controls.js';
import {FlatSpectrumScene} from './spectrum-2d.js';
import {SpectrumScene} from './spectrum-scene.js';
import {palettes,readVisualizerSettings,saveVisualizerSettings,type VisualizerSettings} from './visualizer-settings.js';

export function MusicVisualizer({audio,active,playing,user,expanded,onExpand}:{audio:RefObject<HTMLAudioElement|null>;active:boolean;playing:boolean;user:string;expanded:boolean;onExpand:()=>void}){
 const [settings,setSettings]=useState(()=>readVisualizerSettings(user));
 const [milkError,setMilkError]=useState('');
 const milkFailure=useCallback((message:string)=>setMilkError(message),[]);
 const [error,setError]=useState('');const [connected,setConnected]=useState(false);
 const [inView,setInView]=useState(true);
 const [compact,setCompact]=useState(false);
 const [visible,setVisible]=useState(document.visibilityState!=='hidden');
 const [reducedMotion,setReducedMotion]=useState(()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches??false);
 const canvas=useRef<HTMLCanvasElement>(null);const scene=useRef<SpectrumScene|FlatSpectrumScene|null>(null);const frame=useRef(0);
 const sweepTime=useRef(0);const orbit=useRef(defaultOrbit());const redraw=useRef<(()=>void)|null>(null);
 const layout=useRef({bands:0,rows:0});
 const spectrum=settings.engine!=='milkdrop',flat=settings.engine==='spectrum2d';
 const requestedAnalysis=useRef(false);
 const [generation,setGeneration]=useState(0);const desired=useRef(settings.enabled&&active);
 useEffect(()=>{desired.current=settings.enabled&&active;},[settings.enabled,active]);
 function change(patch:Partial<VisualizerSettings>){const next={...settings,...patch};setSettings(next);saveVisualizerSettings(user,next);}
 async function activate(){
  const element=audio.current;if(!element)return;
  try{await enableSpectrum(element);if(!desired.current){disableSpectrum(element);return;}setConnected(true);setError('');}
  catch(e){setConnected(false);setError(e instanceof Error?e.message:'Audio visualization is unavailable.');}
 }
 useEffect(()=>{
  const visibility=()=>setVisible(document.visibilityState!=='hidden');
  const media=window.matchMedia?.('(prefers-reduced-motion: reduce)');const motion=()=>setReducedMotion(media?.matches??false);
  document.addEventListener('visibilitychange',visibility);media?.addEventListener('change',motion);
  const sizing=typeof ResizeObserver==='undefined'?null:new ResizeObserver(entries=>{if(entries[0])setCompact(entries[0].contentRect.width<600);});
  if(canvas.current)sizing?.observe(canvas.current.parentElement!);
  const observer=typeof IntersectionObserver==='undefined'?null:new IntersectionObserver(entries=>setInView(entries[0]?.isIntersecting??true));
  if(canvas.current)observer?.observe(canvas.current.parentElement!);
  return()=>{sizing?.disconnect();observer?.disconnect();document.removeEventListener('visibilitychange',visibility);media?.removeEventListener('change',motion);};
 },[settings.engine]);
 useEffect(()=>{
  const element=audio.current;
  if(!active||!settings.enabled||!spectrum){if(element)disableSpectrum(element);return;}
  // Create graphics before changing audio routing, so unsupported GPUs leave audio untouched.
  // GPU initialization is external synchronization; surface failures to the user.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  try{scene.current??=(flat?new FlatSpectrumScene(canvas.current!):new SpectrumScene(canvas.current!));}catch(e){setError(e instanceof Error?e.message:'3D graphics are unavailable.');return;}
  if(playing||requestedAnalysis.current){requestedAnalysis.current=false;void activate();}
  const play=()=>{void activate();};element?.addEventListener('play',play);
  return()=>{element?.removeEventListener('play',play);if(element)disableSpectrum(element);};
  // Activation depends on open/enable, never palette, progress, or track metadata.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[active,settings.enabled,generation,spectrum,flat]);
 useEffect(()=>{
  const element=canvas.current!;
  const lost=(event:Event)=>{event.preventDefault();cancelAnimationFrame(frame.current);setConnected(false);setError('3D graphics paused. Restoring the display…');};
  const restored=()=>{scene.current?.dispose();scene.current=null;setGeneration(n=>n+1);};
  element.addEventListener('webglcontextlost',lost);element.addEventListener('webglcontextrestored',restored);
  return()=>{cancelAnimationFrame(frame.current);element.removeEventListener('webglcontextlost',lost);element.removeEventListener('webglcontextrestored',restored);const renderer=scene.current;renderer?.dispose();scene.current=null;queueMicrotask(()=>{if(!element.isConnected)renderer?.releaseContext();});};
 },[settings.engine]);
 useEffect(()=>{
  const renderer=scene.current;if(!spectrum||!renderer||!settings.enabled||!active||!visible||!inView||error)return;
  const mobile=compact;
  const reduced=reducedMotion;const bands=reduced?24:mobile?32:48;const rows=reduced?2:3;
  if(layout.current.bands&&(layout.current.bands!==bands||layout.current.rows!==rows))remapSpectrum(renderer.levels,layout.current.bands,layout.current.rows,bands,rows);
  layout.current={bands,rows};
  const target=new Float32Array(bands);const current=renderer.levels.slice(0,bands);const rear=renderer.levels.slice(bands,bands*2);const back=renderer.levels.slice(bands*2,bands*3);
  const fps=reducedMotion?8:reduced?20:mobile?30:45;let previous=0;let settled=0;
  // Paused settings changes still get one static draw; no continuous idle rendering.
  const draw=(time:number)=>{
   frame.current=0;
   if(time-previous<1000/fps&&previous){frame.current=requestAnimationFrame(draw);return;}
   const dt=previous?Math.min((time-previous)/1000,.1):1/fps;previous=time;
   if(playing&&connected&&audio.current){sampleSpectrum(audio.current,target,settings.sensitivity);smoothSpectrum(back,rear,dt,.45);smoothSpectrum(rear,current,dt,.65);smoothSpectrum(current,target,dt,settings.response);renderer.levels.fill(0);renderer.levels.set(current);renderer.levels.set(rear,bands);if(rows>2)renderer.levels.set(back,bands*2);}
   if(!flat&&!reducedMotion&&playing&&connected){
    // Unequal periods create changing drone passes instead of a repeating circular orbit.
    sweepTime.current+=dt;const t=sweepTime.current;
    orbit.current.yaw=20+Math.sin(t*.12)*95+Math.sin(t*.047)*45;
    orbit.current.pitch=32-Math.cos(t*.18)*16+Math.sin(t*.29)*14;
    orbit.current.zoom=1+Math.sin(t*.13)*.16+Math.sin(t*.27)*.07;
   }
   renderer.draw(bands,rows,reduced,settings.angle,settings.palette,dt,orbit.current);settled+=dt;
   if(playing&&connected)frame.current=requestAnimationFrame(draw);
   else if(settled<.45)frame.current=requestAnimationFrame(draw);
  };
  frame.current=requestAnimationFrame(draw);
  redraw.current=()=>{if(!frame.current){previous=0;frame.current=requestAnimationFrame(draw);}};
  const resize=new ResizeObserver(()=>redraw.current?.());resize.observe(canvas.current!);
  return()=>{cancelAnimationFrame(frame.current);frame.current=0;redraw.current=null;resize.disconnect();};
 },[active,visible,inView,compact,playing,connected,settings,error,reducedMotion,generation,audio,expanded,spectrum,flat]);
 useEffect(()=>{
  if(spectrum||!settings.cycle||!settings.enabled||!active||!visible||!inView||!playing||milkError||reducedMotion)return;
  const timer=window.setInterval(()=>setSettings(previous=>{
   const next={...previous,preset:presetNames[(presetNames.findIndex(name=>name===previous.preset)+1)%presetNames.length]!};
   saveVisualizerSettings(user,next);return next;
  }),30000);
  return()=>clearInterval(timer);
 },[spectrum,settings.cycle,settings.enabled,active,visible,inView,playing,milkError,reducedMotion,user]);
 const hold=useRef<ReturnType<typeof setTimeout>|null>(null),holdStart=useRef({x:0,y:0}),holdFired=useRef(false);
 function cancelHold(){if(hold.current)clearTimeout(hold.current);hold.current=null;}
 function toggle(){requestedAnalysis.current=!settings.enabled;desired.current=!settings.enabled&&active;change({enabled:!settings.enabled});}
 useEffect(()=>()=>{if(hold.current)clearTimeout(hold.current);},[]);
 function nextPreset(offset:number){const index=presetNames.findIndex(name=>name===settings.preset);change({preset:presetNames[(index+offset+presetNames.length)%presetNames.length]!});}
 return <section className={`visualizer ${settings.enabled?'visualizer-enabled':''}`} aria-label="Music visualizer">

  <div className="spectrum-stage" tabIndex={settings.enabled?-1:0} role="group" aria-label={settings.enabled?'Visualizer display':'Enable visualizer'} onPointerDown={event=>{holdFired.current=false;if(!settings.enabled||event.button!==0||event.isPrimary===false)return;cancelHold();holdFired.current=false;holdStart.current={x:event.clientX,y:event.clientY};hold.current=setTimeout(()=>{hold.current=null;holdFired.current=true;desired.current=false;change({enabled:false});},650);}} onPointerMove={event=>{if(Math.hypot(event.clientX-holdStart.current.x,event.clientY-holdStart.current.y)>10)cancelHold();}} onPointerUp={cancelHold} onPointerCancel={cancelHold} onContextMenu={event=>event.preventDefault()} onClick={()=>{if(holdFired.current){holdFired.current=false;return;}if(!settings.enabled)toggle();}} onKeyDown={event=>{if((event.key===' '||event.key==='Enter')&&(event.target===event.currentTarget||(event.target as HTMLElement).tagName==='CANVAS')){event.preventDefault();event.stopPropagation();toggle();}}}><canvas key={settings.engine} hidden={!spectrum||!settings.enabled} ref={canvas} tabIndex={0} title={flat?'2D spectrum · Bass to treble':'3D spectrum · Bass to treble'} role="img" aria-label={`Live ${flat?'2D':'3D LED'} audio spectrum: bass on the left, treble on the right`}/>{!spectrum&&settings.enabled&&active&&!milkError&&<MilkDropVisualizer key={generation} audio={audio} running={visible&&inView} playing={playing} preset={settings.preset} reduced={reducedMotion} onError={milkFailure}/>}{settings.enabled&&<div className="spectrum-caption"><span>{spectrum?'35 Hz · BASS':'MILKDROP'}</span><span>{playing&&(spectrum?connected:!milkError)?'LIVE AUDIO':'PAUSED'}</span><span>{spectrum?'TREBLE · 16 kHz':'BUTTERCHURN'}</span></div>}</div>
  <small className="visualizer-touch-hint" role={settings.enabled?undefined:'button'} tabIndex={settings.enabled?undefined:0} onClick={()=>{if(!settings.enabled)toggle();}} onKeyDown={event=>{if(!settings.enabled&&(event.key==='Enter'||event.key===' ')){event.preventDefault();event.stopPropagation();toggle();}}}>{settings.enabled?'Long touch for off':'Tap to enable'}</small>
  {(spectrum?error:milkError)&&settings.enabled&&<p role="status" className="visualizer-hint">{spectrum?error:milkError} Playback controls remain available. <button onClick={()=>{setError('');setMilkError('');setGeneration(n=>n+1);}}>Retry visualizer</button></p>}
  {settings.enabled&&<><div className={`visualizer-tools ${spectrum?'':'milkdrop-tools'}`}><label>Mode<select aria-label="Visualizer mode" value={settings.engine} onChange={e=>{setMilkError('');change({engine:e.target.value as VisualizerSettings['engine']});}}><option value="spectrum2d">2D Spectrum</option><option value="spectrum">3D Spectrum</option><option value="milkdrop">MilkDrop</option></select></label>{spectrum?<label>Palette<select aria-label="Visualizer palette" value={settings.palette} onChange={e=>change({palette:e.target.value as VisualizerSettings['palette']})}>{palettes.map(p=><option key={p}>{p}</option>)}</select></label>:<><label className="milkdrop-preset">Preset<select aria-label="MilkDrop preset" value={settings.preset} onChange={e=>change({preset:e.target.value})}>{presetNames.map(name=><option key={name}>{name}</option>)}</select></label><div className="milkdrop-buttons"><button aria-label="Previous preset" onClick={()=>nextPreset(-1)}>‹</button><button aria-label="Next preset" onClick={()=>nextPreset(1)}>›</button><button aria-label="Random preset" onClick={()=>nextPreset(1+Math.floor(Math.random()*(presetNames.length-1)))}>⤨</button><button aria-label="Automatic preset cycling" aria-pressed={settings.cycle} onClick={()=>change({cycle:!settings.cycle})}>Auto</button></div></>}<button onClick={onExpand} aria-pressed={expanded}>{expanded?'Shrink':'Expand'}</button></div>
  {spectrum&&<details className="visualizer-settings"><summary><span className="spectrum-settings-full">Fine-tune the spectrum</span><span className="spectrum-settings-short">Settings</span></summary><div><label>Sensitivity<input aria-label="Visualizer sensitivity" type="range" min="0.5" max="2.5" step=".05" value={settings.sensitivity} onChange={e=>change({sensitivity:Number(e.target.value)})}/></label><label>Responsiveness<input aria-label="Visualizer responsiveness" type="range" min=".4" max="2" step=".05" value={settings.response} onChange={e=>change({response:Number(e.target.value)})}/></label>{reducedMotion&&<small>Reduced motion is active: slower updates, no glow or reflections.</small>}</div></details>}</>}
 </section>;
}
