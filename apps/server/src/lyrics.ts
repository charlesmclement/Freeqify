import {setTimeout as delay} from 'node:timers/promises';
import type {LyricLine,LyricsResult,Track} from '@freeqify/shared';

const maxText=65536,maxLines=600;
const normalize=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]+/gu,' ').trim();
const record=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const clean=(s:string)=>Array.from(s).filter(c=>['\t','\n','\r'].includes(c)||(c.charCodeAt(0)>=32&&c.charCodeAt(0)!==127)).join('');

/** Preserve blank timed lines (instrumental gaps), repeated tags and millisecond offsets. */
export function parseLrc(text:string,duration:number):LyricLine[]{
 if(text.length>maxText)return [];
 let offset=0;const raw:LyricLine[]=[];
 for(const row of text.split(/\r?\n/)){
  const line=row.trim(),shift=/^\[offset:([+-]?\d{1,6})\]$/i.exec(line);
  if(shift){offset=Number(shift[1])/1000;continue;}
  if(!line||/^\[(?:ar|al|ti|au|by|re|ve|length):[^\]]*\]$/i.test(line))continue;
  const tags=/^(?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])+/u.exec(line)?.[0];
  if(!tags)return [];
  const words=clean(line.slice(tags.length).trim());if(words.length>2000)return [];
  for(const match of tags.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)){
   if(Number(match[2])>=60)return [];
   const time=Number(match[1])*60+Number(match[2])+Number(`0.${match[3]??'0'}`);
   raw.push({time,text:words});if(raw.length>maxLines)return [];
  }
 }
 if(!raw.some(l=>l.text))return [];
 const lines=raw.map(l=>({...l,time:Math.max(0,l.time+offset)})).sort((a,b)=>a.time-b.time);
 if(lines.some(l=>l.time>duration+2))return [];
 // Simultaneous lines are one highlight/seek target, preserving duet text.
 return lines.reduce<LyricLine[]>((all,line)=>{const last=all.at(-1);if(last?.time===line.time)last.text=[last.text,line.text].filter(Boolean).join('\n');else all.push(line);return all;},[]);
}

async function boundedJson(response:Response){
 const declared=response.headers.get('content-length');
 if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>256*1024)){await response.body?.cancel();throw new Error('Oversized response');}
 const reader=response.body?.getReader();if(!reader)throw new Error('Missing body');
 const chunks:Buffer[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>256*1024){await reader.cancel();throw new Error('Oversized response');}chunks.push(Buffer.from(value));}}
 finally{reader.releaseLock();}
 return JSON.parse(Buffer.concat(chunks,size).toString('utf8')) as unknown;
}

export interface LyricsProvider { lookup(track:Track,signal:AbortSignal):Promise<LyricsResult> }
/** Optional free lookup. No credentials, audio uploads, database writes or bulk scanning. */
export class LrclibLyrics implements LyricsProvider {
 private cache=new Map<string,{expires:number;value:LyricsResult}>();
 private busy=false;private nextRequest=0;private cooldown=0;
 constructor(private fetcher:typeof fetch=fetch,private now=Date.now,private timeoutMs=8000){}
 async lookup(track:Track,signal:AbortSignal):Promise<LyricsResult>{
  const duration=track.duration;
  if(!duration||duration<1||duration>3600||!Number.isFinite(duration)||![track.title,track.artist].every(s=>s.trim()&&s.length<=512&&!/^unknown (artist|title)$/i.test(s.trim())))return {status:'missing'};
  const key=JSON.stringify([track.title,track.artist,track.album,duration]);
  const cached=this.cache.get(key);if(cached&&cached.expires>this.now())return cached.value;
  if(this.busy||this.now()<this.cooldown)return {status:'unavailable'};
  this.busy=true;
  try{
   const abort=AbortSignal.any([signal,AbortSignal.timeout(this.timeoutMs)]);
   const params=new URLSearchParams({track_name:track.title,artist_name:track.artist,duration:String(Math.round(duration))});
   if(track.album&&track.album.length<=512)params.set('album_name',track.album);
   let value:unknown=null;
   for(let attempt=0;attempt<2;attempt++){
    await delay(Math.max(0,this.nextRequest-this.now()),undefined,{signal:abort});
    this.nextRequest=this.now()+500;
    const response=await this.fetcher(new URL('/api/get?'+params,'https://lrclib.net'),{redirect:'error',signal:abort,headers:{'Accept':'application/json','User-Agent':'Freeqify/0.1.0 (https://github.com/charlesmclement/Freeqify)'}});
    if(response.status===429){
     const raw=response.headers.get('retry-after')??'60';const seconds=/^\d+$/.test(raw)?Number(raw):Math.max(1,(Date.parse(raw)-this.now())/1000);
     const wait=Number.isFinite(seconds)?Math.max(1,seconds):60;
     this.cooldown=this.now()+wait*1000*(1.1+Math.random()*.2);await response.body?.cancel();return {status:'unavailable'};
    }
    if(response.status===404){await response.body?.cancel();if(attempt===0&&params.has('album_name')){params.delete('album_name');continue;}break;}
    if(!response.ok){await response.body?.cancel();return {status:'unavailable'};}
    value=await boundedJson(response);break;
   }
   abort.throwIfAborted();
   const data=record(value);let result:LyricsResult={status:'missing'};
   if(data&&typeof data.trackName==='string'&&typeof data.artistName==='string'&&normalize(data.trackName)===normalize(track.title)&&normalize(data.artistName)===normalize(track.artist)&&typeof data.duration==='number'&&Number.isFinite(data.duration)&&Math.abs(data.duration-duration)<=2){
    if(data.instrumental===true)result={status:'instrumental'};
    else if(Number.isSafeInteger(data.id)&&Number(data.id)>0){
     const text=typeof data.plainLyrics==='string'&&data.plainLyrics.length<=maxText?clean(data.plainLyrics).trim():'';
     const lines=typeof data.syncedLyrics==='string'?parseLrc(data.syncedLyrics,duration):[];
     if(lines.length||text)result={status:lines.length?'synced':'plain',provider:'LRCLIB',recordId:Number(data.id),lines,text:lines.length?'':text};
    }
   }
   if(this.cache.size>=128)this.cache.delete(this.cache.keys().next().value!);
   this.cache.set(key,{expires:this.now()+(result.status==='missing'?15*60000:24*3600000),value:result});return result;
  }catch{return {status:'unavailable'};}finally{this.busy=false;}
 }
}
