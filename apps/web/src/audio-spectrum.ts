/** One graph per existing media element. The audible path never passes through effects. */
type Graph = {context:AudioContext;source:MediaElementAudioSourceNode;analyser:AnalyserNode;connected:boolean;bins:Uint8Array<ArrayBuffer>};
const graphs=new WeakMap<HTMLMediaElement,Graph>();
const pending=new WeakMap<HTMLMediaElement,Promise<Graph>>();
const retired=new WeakSet<HTMLMediaElement>();
export async function enableSpectrum(audio:HTMLMediaElement):Promise<Graph>{
 if(retired.has(audio))throw new Error('This audio player has closed.');
 const existing=graphs.get(audio);
 if(existing){await existing.context.resume();if(!existing.connected){existing.source.connect(existing.analyser);existing.connected=true;}return existing;}
 const waiting=pending.get(audio);if(waiting)return waiting;
 const task=(async()=>{
  if(!globalThis.AudioContext)throw new Error('Audio analysis is unavailable in this browser.');
  if(audio.currentSrc&&new URL(audio.currentSrc,location.href).origin!==location.origin)throw new Error('Visualization requires same-origin audio.');
  const context=new AudioContext();
  try{
   // Resume before taking over the media element: denial leaves native playback intact.
   await context.resume();if(context.state!=='running'||retired.has(audio))throw new Error('Tap Enable visualizer to allow audio analysis.');
   const analyser=context.createAnalyser();analyser.fftSize=4096;analyser.smoothingTimeConstant=0;analyser.minDecibels=-85;analyser.maxDecibels=-15;
   const source=context.createMediaElementSource(audio);
   source.connect(context.destination); // Exactly one audible connection, at unity gain.
   const graph={context,source,analyser,connected:false,bins:new Uint8Array(analyser.frequencyBinCount)};
   graphs.set(audio,graph);
   source.connect(analyser);graph.connected=true;return graph;
  }catch(error){if(!graphs.has(audio))await context.close();throw error;}
 })();
 pending.set(audio,task);try{return await task;}finally{pending.delete(audio);}
}
export function disableSpectrum(audio:HTMLMediaElement){const g=graphs.get(audio);if(g?.connected){g.source.disconnect(g.analyser);g.connected=false;}}
export function resumeSpectrum(audio:HTMLMediaElement){const g=graphs.get(audio);if(g&&g.context.state!=='running')void g.context.resume().catch(()=>{});}
export function disposeSpectrum(audio:HTMLMediaElement){retired.add(audio);const g=graphs.get(audio);if(g){g.source.disconnect();g.analyser.disconnect();void g.context.close().catch(()=>{});graphs.delete(audio);}}
export function sampleSpectrum(audio:HTMLMediaElement,output:Float32Array,sensitivity:number){
 const g=graphs.get(audio);if(!g?.connected||g.context.state!=='running'){output.fill(0);return false;}
 g.analyser.getByteFrequencyData(g.bins);groupFrequencies(g.bins,g.context.sampleRate,g.analyser.fftSize,output,sensitivity);return true;
}
/** Logarithmic 35Hz–16kHz groups; averaging power avoids a single noisy bin dominating. */
export function groupFrequencies(bins:Uint8Array,sampleRate:number,fftSize:number,out:Float32Array,sensitivity=1){
 const low=35,high=Math.min(16000,sampleRate/2),binHz=sampleRate/fftSize;
 for(let i=0;i<out.length;i++){
  const start=Math.max(1,Math.floor(low*(high/low)**(i/out.length)/binHz));
  const end=Math.min(bins.length,Math.max(start+1,Math.ceil(low*(high/low)**((i+1)/out.length)/binHz)));
  let power=0;for(let b=start;b<end;b++)power+=(bins[b]!/255)**2;
  // A soft noise floor and gentle contrast keep quiet passages dark while
  // retaining independent bass, snare and cymbal attacks. No synthetic motion.
  const magnitude=Math.sqrt(power/Math.max(1,end-start));
  out[i]=Math.min(1,Math.max(0,(magnitude-.035)/.965)**1.25*sensitivity);
 }
}
export function smoothSpectrum(current:Float32Array,target:Float32Array,seconds:number,response:number){
 for(let i=0;i<current.length;i++){
  const frequency=i/Math.max(1,current.length-1);
  // Bass retains weight; upper percussion has a faster attack and shorter tail.
  const tau=(target[i]! > current[i]! ? .023-.012*frequency : .28-.12*frequency)/response;
  current[i]=current[i]!+(target[i]!-current[i]!)*(1-Math.exp(-Math.min(seconds,.1)/tau));
 }
}

/** Preserve a frozen spectrum when container size or effect quality changes its band layout. */
export function remapSpectrum(levels:Float32Array,oldBands:number,oldRows:number,bands:number,rows:number){
 const previous=levels.slice();levels.fill(0);
 for(let row=0;row<rows;row++)for(let band=0;band<bands;band++){
  const position=band*(oldBands-1)/Math.max(1,bands-1),left=Math.floor(position),fraction=position-left;
  const start=Math.min(row,oldRows-1)*oldBands;
  levels[row*bands+band]=previous[start+left]!*(1-fraction)+previous[start+Math.min(left+1,oldBands-1)]!*fraction;
 }
}
