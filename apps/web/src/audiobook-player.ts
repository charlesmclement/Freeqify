import type {Audiobook,BookChapter} from '@freeqify/shared';
export type BookSource='stream'|'download';
export type BookMedia=string|{url:string;release:()=>void};
export type BookWrite=(book:Audiobook,action:string,input:Record<string,unknown>,source:BookSource)=>Promise<Audiobook|null>;
export type BookPlayerState={source:BookSource;book:Audiobook|null;partId:string;position:number;playing:boolean;ready:boolean;error:string;sleepUntil:number|null;endChapter:boolean;volume:number;muted:boolean};
export function bookTime(seconds:number|null){if(seconds===null)return 'Unknown';const n=Math.max(0,Math.floor(seconds));return `${Math.floor(n/3600)}:${String(Math.floor(n/60)%60).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;}
export function chapterAt(book:Audiobook,partId:string,position:number){return book.chapters.filter(c=>c.partId===partId&&c.position<=position+0.05).at(-1);}
export function bookElapsed(book:Audiobook,partId:string,position:number){let elapsed=position;for(const p of book.parts){if(p.id===partId)return elapsed;if(p.duration===null)return null;elapsed+=p.duration;}return null;}
/** One audio owner. Book sources stream directly; no whole-file buffering or music queue writes. */
export class BookController {
 state:BookPlayerState={source:'stream',book:null,partId:'',position:0,playing:false,ready:false,error:'',sleepUntil:null,endChapter:false,volume:1,muted:false};
 private online=true;
 private listeners=new Set<()=>void>();private audio:HTMLAudioElement|null=null;private attached=false;private wantsPlay=false;
 private session:{book:Audiobook;blocked:boolean;source:BookSource}|null=null;
 private pending:Promise<unknown>=Promise.resolve();private writes=0;private epoch=0;private lastSaved=0;private dirty=false;private blocked=false;private sleepChapter:string|null=null;
 constructor(private write:BookWrite,private source:(id:string,book:Audiobook,source:BookSource)=>BookMedia|Promise<BookMedia>,private now=Date.now){}
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>this.listeners.delete(listener);};
 snapshot=()=>this.state;
 private patch(value:Partial<BookPlayerState>){this.state={...this.state,...value};for(const l of this.listeners)l();}
 setOnline(online:boolean){this.online=online;if(!online&&this.state.book&&this.state.source==='stream'){this.wantsPlay=false;this.audio?.pause();this.patch({playing:false,error:'Audiobook streaming needs a server connection. Your last synced place is saved.'});}}
 setWriter(write:BookWrite){this.write=write;}
 start(book:Audiobook,partId?:string,position?:number,source:BookSource='stream'){
  this.stop();const epoch=++this.epoch;
  if(this.writes){void this.pending.catch(()=>{}).then(()=>{if(epoch===this.epoch)this.start(book,partId,position,source);});return;}
  if(this.session?.source===source&&this.session?.book.id===book.id&&!this.session.blocked&&this.session.book.revision>book.revision)book=this.session.book;
  partId??=book.partId;position??=book.position;
  if(!book.parts.some(p=>p.id===partId))return;
  this.session={book,blocked:false,source};this.blocked=false;this.dirty=false;this.wantsPlay=true;
  this.patch({book,source,partId,position,playing:false,ready:false,error:'',sleepUntil:null,endChapter:false});
 }
 stop(){if(this.state.book){void this.flush();this.attached=false;this.audio?.pause();this.patch({book:null,playing:false,ready:false,sleepUntil:null,endChapter:false});}this.epoch++;this.wantsPlay=false;}
 attach(audio:HTMLAudioElement){
  this.audio=audio;this.attached=true;this.patch({volume:audio.volume,muted:audio.muted});const b=this.state.book;if(!b)return()=>{};
  const position=this.state.position;let loaded=false;
  const metadata=()=>{if(loaded||!this.attached)return;loaded=true;audio.playbackRate=this.state.book?.speed??1;audio.preservesPitch=true;
   if(position>0)audio.currentTime=Math.min(position,Number.isFinite(audio.duration)?audio.duration:position);
   this.patch({ready:true});if(this.wantsPlay)this.play();};
  const time=()=>{if(!this.attached||!loaded||!Number.isFinite(audio.currentTime))return;
   const before=chapterAt(this.state.book!,this.state.partId,this.state.position),after=chapterAt(this.state.book!,this.state.partId,audio.currentTime);
   this.dirty=true;this.patch({position:audio.currentTime});
   if(this.state.endChapter&&before?.id!==after?.id&&before?.id===this.sleepChapter){this.pause();this.setSleep('off');}
   this.checkSleep();if(this.now()-this.lastSaved>=10000)void this.flush();};
  const play=()=>{this.checkSleep();if(this.wantsPlay)this.patch({playing:true});};
  const pause=()=>{if(!this.attached)return;this.patch({playing:false});void this.flush();};
  const ended=()=>{if(!this.attached)return;this.dirty=true;this.patch({position:Number.isFinite(audio.duration)?audio.duration:this.state.position});void this.flush();
   if(this.state.endChapter){this.pause();this.setSleep('off');return;}
   const book=this.state.book!,i=book.parts.findIndex(p=>p.id===this.state.partId);
   if(i+1<book.parts.length)this.seek(book.parts[i+1]!.id,0,true);
   else{this.wantsPlay=false;this.patch({playing:false});void this.mutate('status',{status:'finished'}).catch(()=>{});}
  };
  const error=()=>{if(this.attached){this.wantsPlay=false;this.patch({playing:false,error:'This part could not play. Check your connection or use a browser that supports its original audio format. Your saved position is retained.'});}};
  const events:{[key:string]:()=>void}={loadedmetadata:metadata,timeupdate:time,play,pause,ended,error};
  for(const [event,handler]of Object.entries(events))audio.addEventListener(event,handler);
  let cancelled=false,release:(()=>void)|undefined;
  const assign=(media:BookMedia)=>{if(cancelled){if(typeof media!=='string')media.release();return;}audio.src=typeof media==='string'?media:media.url;release=typeof media==='string'?undefined:media.release;audio.preload='metadata';audio.load();};
  try{const media=this.source(this.state.partId,b,this.state.source);if(media instanceof Promise)void media.then(assign).catch(()=>{if(!cancelled)error();});else assign(media);}catch{error();}
  return()=>{cancelled=true;release?.();this.attached=false;for(const [event,handler]of Object.entries(events))audio.removeEventListener(event,handler);audio.pause();audio.removeAttribute('src');audio.load();};
 }
 play(){if(!this.state.book||(!this.online&&this.state.source==='stream')||this.blocked)return;const b=this.state.book,i=b.parts.findIndex(p=>p.id===this.state.partId),part=b.parts[i];if(part?.duration&&this.state.position>=part.duration){if(i+1<b.parts.length)this.seek(b.parts[i+1]!.id,0,true);return;}if(this.checkSleep())return;this.patch({error:''});this.wantsPlay=true;if(this.state.ready)void this.audio?.play().catch(()=>this.patch({error:'Tap Play to start the audiobook.'}));}
 pause(){this.wantsPlay=false;this.audio?.pause();this.patch({playing:false});void this.flush();}
 volume(value:number){if(!Number.isFinite(value)||value<0||value>1)return;if(this.audio){this.audio.volume=value;this.audio.muted=false;}this.patch({volume:value,muted:false});}
 mute(){const muted=!this.state.muted;if(this.audio)this.audio.muted=muted;this.patch({muted});}
 get waitingToPlay(){return this.wantsPlay&&!this.state.ready;}
 toggle(){if(this.state.playing||this.waitingToPlay)this.pause();else this.play();}
 seek(partId:string,position:number,play=this.state.playing){
  const part=this.state.book?.parts.find(p=>p.id===partId);if(!part)return;
  void this.flush();position=Math.max(0,Math.min(position,part.duration??604800));this.wantsPlay=play;if(this.state.endChapter)this.sleepChapter=chapterAt(this.state.book!,partId,position)?.id??null;
  if(partId===this.state.partId&&this.state.ready){this.audio!.currentTime=position;this.dirty=true;this.patch({position});void this.flush();if(play)this.play();else this.pause();}
  else{this.attached=false;this.audio?.pause();this.dirty=true;this.patch({partId,position,ready:false,playing:false});void this.flush();}
 }
 skip(seconds:number){const b=this.state.book;if(!b)return;let i=b.parts.findIndex(p=>p.id===this.state.partId),position=this.state.position+seconds;
  while(position<0&&i>0){i--;position+=b.parts[i]!.duration??0;}
  while(b.parts[i]!.duration!==null&&position>b.parts[i]!.duration!&&i<b.parts.length-1){position-=b.parts[i]!.duration!;i++;}
  this.seek(b.parts[i]!.id,position);
 }
 chapter(direction:1|-1){const b=this.state.book;if(!b)return;const current=chapterAt(b,this.state.partId,this.state.position),index=b.chapters.findIndex(c=>c.id===current?.id);
  const c=direction===-1&&current&&this.state.position-current.position>3?current:b.chapters[index+direction];if(c)this.seek(c.partId,c.position,this.state.playing);
 }
 go(chapter:BookChapter){this.seek(chapter.partId,chapter.position,true);}
 setSleep(value:string){this.sleepChapter=value==='chapter'?chapterAt(this.state.book!,this.state.partId,this.state.position)?.id??null:null;this.patch({sleepUntil:value==='off'||value==='chapter'?null:this.now()+Number(value)*60000,endChapter:value==='chapter'});}
 checkSleep(){if(this.state.sleepUntil!==null&&this.now()>=this.state.sleepUntil){this.pause();this.setSleep('off');return true;}return false;}
 async mutate(action:string,input:Record<string,unknown>):Promise<Audiobook|null>{
  if(!this.online&&this.state.source==='stream')throw new Error('Reconnect to save audiobook changes.');
  if(action!=='progress')await this.flush();
  const epoch=this.epoch,session=this.session;if(!session)return null;
  this.writes++;const task=this.pending.catch(()=>{}).then(async()=>{
   if(session.blocked)throw new Error('Reload the book to resolve the sync conflict.');
   const current=session.book;
   const result=await this.write(current,action,input,session.source);if(result)session.book=result;
   if(epoch===this.epoch){if(result){this.patch({book:result,error:''});if(this.audio)this.audio.playbackRate=result.speed;}}window.dispatchEvent(new Event('freeqify:books-changed'));
   return result;
  });
  this.pending=task;try{return await task;}catch(error){session.blocked=true;if(epoch===this.epoch){this.blocked=true;this.pauseWithoutSave();this.patch({error:error instanceof Error?error.message:'Book changes could not sync. Reload the book before continuing.'});}throw error;}finally{this.writes--;}
 }
 private pauseWithoutSave(){this.wantsPlay=false;this.attached=false;this.audio?.pause();this.patch({playing:false});}
 flush(){if((!this.online&&this.state.source==='stream')||!this.dirty||!this.state.book||this.blocked)return Promise.resolve();this.dirty=false;this.lastSaved=this.now();const epoch=this.epoch;const input={partId:this.state.partId,position:this.state.position};return this.mutate('progress',input).then(()=>{}).catch(()=>{if(epoch===this.epoch)this.dirty=true;});}
 forgetSession(){this.session=null;}
 async settle(){if(this.audio&&this.state.ready&&Number.isFinite(this.audio.currentTime)){this.dirty=true;this.patch({position:this.audio.currentTime});}this.attached=false;this.pause();await this.flush();await this.pending.catch(()=>{});}
 tick(){this.checkSleep();}
}
