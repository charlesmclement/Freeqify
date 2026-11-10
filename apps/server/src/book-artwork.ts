/** Optional Open Library book covers. Fixed hosts, bounded reads and conservative matching. */
import {setTimeout as delay} from 'node:timers/promises';
import {imageType,type ArtworkCandidate,type ArtworkSearch,type Outcome} from './online-artwork.js';
const normalize=(value:string)=>value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
let nextRequest=0;
async function slot(){const now=Date.now(),at=Math.max(now,nextRequest);if(at-now>5500)throw new Error('Cover service busy');nextRequest=at+1100;if(at>now)await delay(at-now);}
export class OnlineBookArtwork {
 private readonly fetcher:typeof fetch;
 private readonly acquire:()=>Promise<void>;
 private readonly now:()=>number;
 private cache=new Map<string,{expires:number;value:Outcome}>();
 private pending=new Map<string,Promise<Outcome>>();
 constructor(private options:{contact:string;fetcher?:typeof fetch;acquire?:()=>Promise<void>;now?:()=>number}){
  this.fetcher=options.fetcher??fetch;this.acquire=options.acquire??slot;this.now=options.now??Date.now;
 }
 private async read(url:string,max:number,type:'json'|'image'){
  await this.acquire();
  const signal=AbortSignal.timeout(8000);let response:Response;
  for(let hop=0;;hop++){
   response=await this.fetcher(url,{redirect:'manual',signal,headers:{'User-Agent':`Freeqify/0.1 (${this.options.contact.replace(/[\r\n]/g,' ').slice(0,200)})`,Accept:type==='json'?'application/json':'image/jpeg,image/png,image/webp'}});
   if(type!=='image'||![301,302,303,307,308].includes(response.status))break;
   const location=response.headers.get('location');await response.body?.cancel();if(!location||hop>=3)throw new Error('Invalid cover redirect');
   const next=new URL(location,url);if(next.protocol!=='https:'||next.username||next.password||(next.port&&next.port!=='443')||!(next.hostname==='covers.openlibrary.org'||next.hostname==='archive.org'||next.hostname.endsWith('.archive.org')))throw new Error('Untrusted cover redirect');
   url=next.href;
  }
  if(response.status!==200){await response.body?.cancel();return {status:response.status,bytes:null,type:''};}
  const contentType=response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()??'';
  const length=response.headers.get('content-length');
  if((type==='json'?contentType!=='application/json':!['image/jpeg','image/png','image/webp'].includes(contentType))||(length!==null&&(!/^\d+$/.test(length)||Number(length)>max))){await response.body?.cancel();throw new Error('Invalid cover response');}
  const reader=response.body?.getReader();if(!reader)throw new Error('Empty cover response');const chunks:Buffer[]=[];let size=0;
  try{while(true){const value=await reader.read();if(value.done)break;size+=value.value.length;if(size>max){await reader.cancel();throw new Error('Oversized cover response');}chunks.push(Buffer.from(value.value));}}finally{reader.releaseLock();}
  return {status:response.status,bytes:Buffer.concat(chunks,size),type:contentType};
 }
 async search(author:string,title:string):Promise<ArtworkSearch>{
  if(!title.trim()||title.length>200||author.length>200)return {kind:'unavailable'};
  try{
   const url=new URL('https://openlibrary.org/search.json');url.search=new URLSearchParams({title,...(author.trim()?{author}:{}),fields:'key,title,author_name,first_publish_year,cover_i',limit:'12'}).toString();
   const response=await this.read(url.href,256*1024,'json');if(!response.bytes)return {kind:'unavailable'};
   const value=JSON.parse(response.bytes.toString('utf8')) as {docs?:unknown[]};if(!Array.isArray(value.docs)||value.docs.length>12)return {kind:'unavailable'};
   const items:ArtworkCandidate[]=[],seen=new Set<string>();
   for(const row of value.docs){
    if(!row||typeof row!=='object')continue;const item=row as Record<string,unknown>;
    if(typeof item.title!=='string'||!item.title.trim()||item.title.length>300||!Number.isSafeInteger(item.cover_i)||Number(item.cover_i)<1||Number(item.cover_i)>9999999999||!Array.isArray(item.author_name))continue;
    const authors=item.author_name.filter((a):a is string=>typeof a==='string'&&a.length<=200).slice(0,3);if(!authors.length)continue;
    const id=String(item.cover_i);if(seen.has(id))continue;seen.add(id);
    items.push({id,title:item.title,artist:authors.join(', '),year:typeof item.first_publish_year==='number'&&Number.isInteger(item.first_publish_year)?String(item.first_publish_year):''});
   }
   return {kind:'results',items:items.slice(0,6)};
  }catch{return {kind:'unavailable'};}
 }
 async candidateCover(id:string):Promise<Outcome>{
  if(!/^[1-9]\d{0,9}$/.test(id))return {kind:'missing'};
  try{const response=await this.read(`https://covers.openlibrary.org/b/id/${id}-L.jpg?default=false`,3*1024*1024,'image');
   if(response.status===404)return {kind:'missing'};
   if(!response.bytes||!imageType(response.bytes,response.type))return {kind:'unavailable'};
   return {kind:'found',artwork:{bytes:response.bytes,contentType:response.type}};
  }catch{return {kind:'unavailable'};}
 }
 async lookup(author:string,title:string):Promise<Outcome>{
  const key=JSON.stringify([author,title]),cached=this.cache.get(key);if(cached&&cached.expires>this.now())return cached.value;
  const pending=this.pending.get(key);if(pending)return pending;if(this.pending.size>=8)return {kind:'unavailable'};
  const work=(async():Promise<Outcome>=>{
   const result=await this.search(author,title.split(':')[0]!.trim());if(result.kind!=='results')return {kind:'unavailable'};
   const matches=result.items.filter(item=>normalize(item.artist)===normalize(author)&&[normalize(title),normalize(title.split(':')[0]!)].includes(normalize(item.title)));
   const value:Outcome=matches.length>0?await this.candidateCover(matches[0]!.id):{kind:'missing'};
   if(value.kind!=='unavailable'){while(this.cache.size>=8)this.cache.delete(this.cache.keys().next().value!);this.cache.set(key,{value,expires:this.now()+(value.kind==='found'?86400000:3600000)});}
   return value;
  })();this.pending.set(key,work);try{return await work;}finally{this.pending.delete(key);}
 }
}
