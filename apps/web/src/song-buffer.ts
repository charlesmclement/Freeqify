import type {AudioConsumer} from './progressive-audio.js';
/** Temporary per-player audio only. Never writes audio to browser storage/cache. */
export const SONG_BUFFER_BYTES=64*1024*1024;
const audioTypes=new Set(['audio/mpeg','audio/mp3','audio/wav','audio/wave','audio/x-wav','audio/flac','audio/x-flac','audio/ogg','application/ogg','audio/mp4','audio/aac','audio/webm']);
export class SongTooLarge extends Error {constructor(){super('This song exceeds the 64 MB memory buffer limit. Try MP3 compatibility.');}}
export class SongFetchError extends Error {constructor(public readonly status:number){super(status===404?'This song is no longer available.':'Could not load the complete song. Check your connection and retry.');}}
type Progress=(loaded:number,total:number|null)=>void;
type Entry={controller:AbortController;promise:Promise<string>;url?:string;source?:'device'|'server';listeners:Set<Progress>};
const aborted=()=>new DOMException('Stopped','AbortError');
export class SongBuffer {
 private entries=new Map<string,Entry>();
 constructor(private limit=SONG_BUFFER_BYTES,private local?:(key:string)=>Promise<Blob|null>){}
 retain(keys:string[]){const keep=new Set(keys);for(const [key,entry] of this.entries)if(!keep.has(key)){entry.controller.abort();if(entry.url)URL.revokeObjectURL(entry.url);this.entries.delete(key);}}
 source(key:string){return this.entries.get(key)?.source;}
 has(key:string){return this.entries.has(key);}
 clear(){this.retain([]);}
 get(key:string,source:string,progress?:Progress,consumer?:AudioConsumer,beforeNetwork?:()=>void){
  const existing=this.entries.get(key);if(existing){if(this.local&&existing.source==='server')return this.preferLocal(key,existing,progress);if(progress&&!existing.url)existing.listeners.add(progress);return existing.promise;}
  // The player retains at most current + next; reject accidental unbounded callers.
  if(this.entries.size>=2)return Promise.reject(new Error('Only two songs may be buffered at a time.'));
  const entry:Entry={controller:new AbortController(),listeners:new Set(progress?[progress]:[]),promise:Promise.resolve('')};
  this.entries.set(key,entry);
  entry.promise=(async()=>{const local=await this.local?.(key);if(entry.controller.signal.aborted)throw aborted();if(local){entry.source='device';return local;}beforeNetwork?.();entry.source='server';return this.load(source,entry,consumer);})().then(blob=>{if(entry.controller.signal.aborted)throw aborted();entry.url=URL.createObjectURL(blob);entry.listeners.clear();return entry.url;}).catch(e=>{if(this.entries.get(key)===entry)this.entries.delete(key);entry.listeners.clear();throw e;});
  return entry.promise;
 }
 /** A completed manual download outranks even a retained temporary server buffer.
  * Called only when preparing a source; it never changes a currently attached source by itself. */
 private async preferLocal(key:string,entry:Entry,progress?:Progress):Promise<string>{
  const local=await this.local!(key).catch(()=>null);
  const current=this.entries.get(key);
  if(current!==entry)return current?.promise??Promise.reject(aborted());
  if(entry.controller.signal.aborted)throw aborted();
  if(!local){if(progress&&!entry.url)entry.listeners.add(progress);return entry.promise;}
  const url=URL.createObjectURL(local);
  this.entries.set(key,{controller:new AbortController(),source:'device',url,promise:Promise.resolve(url),listeners:new Set()});
  entry.controller.abort();if(entry.url)URL.revokeObjectURL(entry.url);entry.listeners.clear();
  return url;
 }
 private async load(source:string,entry:Entry,consumer?:AudioConsumer):Promise<Blob>{
  for(let attempt=0;;attempt++){
   if(entry.controller.signal.aborted)throw aborted();
   try{return await this.read(source,entry,consumer);}
   catch(e){consumer?.failed();if(entry.controller.signal.aborted)throw aborted();
    if(e instanceof SongTooLarge||e instanceof SongFetchError&&e.status<500&&e.status!==429)throw e;
    if(attempt>=2){window.dispatchEvent(new Event('freeqify:server-unavailable'));throw e;}
    await new Promise<void>((resolve,reject)=>{const signal=entry.controller.signal;const stop=()=>{clearTimeout(timer);reject(aborted());};const timer=setTimeout(()=>{signal.removeEventListener('abort',stop);resolve();},1000*(attempt+1));signal.addEventListener('abort',stop,{once:true});if(signal.aborted)stop();});
   }
  }
 }
 private async read(source:string,entry:Entry,consumer?:AudioConsumer):Promise<Blob>{
  const controller=new AbortController(),parent=entry.controller.signal;
  const stop=()=>controller.abort();parent.addEventListener('abort',stop,{once:true});
  if(parent.aborted)controller.abort();
  let timer=setTimeout(stop,30000);let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  try{
   const response=await fetch(source,{credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal});
   if(response.status===401)window.dispatchEvent(new Event('freeqify:unauthenticated'));
   if(response.status===401||response.status===403)throw new SongFetchError(response.status);
   if(response.status!==200){await response.body?.cancel();throw new SongFetchError(response.status);}
   const type=response.headers.get('content-type')?.split(';')[0]?.toLowerCase()??'';
   if(!audioTypes.has(type)){await response.body?.cancel();throw new SongFetchError(415);}
   const length=response.headers.get('content-length');const total=length&&/^\d+$/.test(length)?Number(length):null;
   if(total!==null&&total>this.limit){await response.body?.cancel();throw new SongTooLarge();}
   if(!response.body)throw new SongFetchError(502);
   await consumer?.start(type);
   reader=response.body.getReader();let loaded=0;const chunks:BlobPart[]=[];
   for(;;){clearTimeout(timer);timer=setTimeout(stop,30000);const {done,value}=await reader.read();if(done)break;
    loaded+=value.byteLength;if(loaded>this.limit)throw new SongTooLarge();
    // Each chunk is bounded before copying, including responses without Content-Length.
    chunks.push(new Uint8Array(value).buffer);await consumer?.write(value);for(const listener of entry.listeners)listener(loaded,total);
   }
   if(controller.signal.aborted)throw aborted();
   if(!loaded||total!==null&&loaded!==total)throw new SongFetchError(502);
   consumer?.finish();
   return new Blob(chunks,{type});
  }finally{clearTimeout(timer);parent.removeEventListener('abort',stop);await reader?.cancel().catch(()=>{});}
 }
}
