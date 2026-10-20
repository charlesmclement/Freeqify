/** A single temporary MPEG SourceBuffer; no storage, workers or extra downloads. */
export const START_BUFFER_SECONDS=0.5;
export function supportsProgressiveAudio(){return typeof MediaSource!=='undefined'&&MediaSource.isTypeSupported('audio/mpeg');}
export interface AudioConsumer {start(type:string):Promise<void>;write(bytes:Uint8Array):Promise<void>;finish():void;failed():void;}
export class ProgressiveAudio implements AudioConsumer {
 private source:MediaSource|undefined;
 private buffer:SourceBuffer|undefined;
 private url:string|undefined;
 private disabled=false;
 private started=false;
 private complete=false;
 private warmed=false;
 private rebuffering=false;
 private waiting=()=>{
  if(this.disabled||this.complete||!this.started||this.audio.paused||this.audio.currentTime===0)return;
  this.rebuffering=true;this.buffering();this.audio.pause();
 };
 private cancelWait:(()=>void)|undefined;
 constructor(private audio:HTMLAudioElement,private ready:()=>void,private recover:()=>void,private warmNext:()=>void=()=>{},private buffering:()=>void=()=>{}){this.audio.addEventListener('waiting',this.waiting);}
 get attached(){return !!this.url;}
 get active(){return !!this.url&&!this.disabled;}
 async start(type:string){
  if(this.disabled)return;
  if(!['audio/mpeg','audio/mp3'].includes(type)||!supportsProgressiveAudio()){this.disabled=true;return;}
  try{
   const source=this.source=new MediaSource();this.url=URL.createObjectURL(source);this.audio.src=this.url;this.audio.load();
   await this.wait(source,'sourceopen',()=>{});
   if(this.disabled)return;
   this.buffer=source.addSourceBuffer('audio/mpeg');
  }catch{this.failed();}
 }
 async write(bytes:Uint8Array){
  if(this.disabled||!this.buffer)return;
  try{
   const buffer=this.buffer;
   await this.wait(buffer,'updateend',()=>buffer.appendBuffer(new Uint8Array(bytes).buffer));
   if(buffer.buffered.length&&(!this.started||this.rebuffering)&&buffer.buffered.end(0)>=this.audio.currentTime+(this.rebuffering?3:START_BUFFER_SECONDS)){this.started=true;this.rebuffering=false;this.ready();}
   // Start the next download only after current playback has useful headroom.
   if(!this.warmed&&buffer.buffered.length&&buffer.buffered.end(0)>=this.audio.currentTime+8){this.warmed=true;this.warmNext();}
  }catch{this.failed();}
 }
 finish(){
  if(this.disabled||!this.source||this.source.readyState!=='open')return;
  try{this.source.endOfStream();this.complete=true;if(!this.started||this.rebuffering){this.started=true;this.rebuffering=false;this.ready();}}
  catch{this.failed();}
 }
 failed(){
  if(this.disabled)return;this.disabled=true;
  // Keep the selected song/position while the bounded whole-file retry finishes.
  if(this.url)this.recover();
  this.cancelWait?.();
 }
 dispose(){this.audio.removeEventListener('waiting',this.waiting);this.disabled=true;this.cancelWait?.();if(this.url)URL.revokeObjectURL(this.url);this.url=undefined;this.buffer=undefined;this.source=undefined;}
 get finished(){return this.complete&&this.active;}
 private wait(target:EventTarget,event:string,action:()=>void){
  return new Promise<void>((resolve,reject)=>{
   const cleanup=()=>{clearTimeout(timer);target.removeEventListener(event,done);target.removeEventListener('error',fail);this.cancelWait=undefined;};
   const done=()=>{cleanup();resolve();};const fail=()=>{cleanup();reject(new Error('Progressive audio unavailable'));};
   const timer=setTimeout(fail,5000);this.cancelWait=fail;
   target.addEventListener(event,done,{once:true});target.addEventListener('error',fail,{once:true});
   try{action();}catch{fail();}
  });
 }
}
