import {accountRequest,validAuthState} from './auth-api.js';
import type {AuthState} from '@freeqify/shared';
import type {Track} from '@freeqify/shared';
import {libraryUrl} from './library-api.js';
import {OfflineStore,storageInfo,type LocalCollection,type LocalTrack} from './offline-store.js';
const audioTypes=new Set(['audio/mpeg','audio/mp3']);
/** Foreground-only, one transfer across this installation's tabs. Durable snapshots survive closure. */
export class OfflineDownloads {
 readonly store:OfflineStore;
 error='';
 generation=0;
 private stopped=true;
 private controller:AbortController|null=null;
 private running=false;
 private currentId:string|null=null;
 private channel:BroadcastChannel|null=null;
 private requested=false;
 constructor(user:string,private changed:()=>void){this.store=new OfflineStore(user);}
 private connect(){if(!this.channel&&typeof BroadcastChannel!=='undefined'){this.channel=new BroadcastChannel('freeqify-downloads:'+import.meta.env.BASE_URL+':'+this.store.user);this.channel.onmessage=event=>{const data=event.data;if(data?.type==='cancel'&&(!data.ids||data.ids.includes(this.currentId)))this.controller?.abort();};}}
 async locked<T>(work:()=>Promise<T>){if(!navigator.locks)throw new Error('This browser does not support safe download coordination. Try a current browser.');return navigator.locks.request(this.store.user+':'+import.meta.env.BASE_URL+':downloads',work);}
 async select(collection:LocalCollection,tracks:Track[],generation=this.generation){this.error='';await this.locked(async()=>{if(generation!==this.generation||this.stopped)throw new Error('Download selection cancelled.');await this.store.saveCollection(collection,tracks);});this.changed();this.run();}
 cancel(ids?:string[]){if(!ids)this.generation++;this.connect();this.channel?.postMessage({type:'cancel',ids});if(!ids||ids.includes(this.currentId??''))this.controller?.abort();return this.locked(async()=>{const {tracks}=await this.store.list();for(const t of tracks)if((!ids||ids.includes(t.id))&&(t.state==='queued'||t.state==='downloading'||t.state==='cancelled')){await this.store.reset(t.id);await this.store.saveTrack({...t,state:'cancelled',bytes:0,chunks:0,error:undefined});}this.changed();});}
 async retry(ids?:string[]){this.error='';await this.locked(async()=>{const {tracks}=await this.store.list();for(const t of tracks)if((!ids||ids.includes(t.id))&&t.state!=='complete')await this.store.saveTrack({...t,state:'queued',error:undefined});});this.changed();this.run();}
 async removeTrack(id:string){this.generation++;await this.cancel([id]);await this.locked(()=>this.store.removeTrack(id));this.changed();}
 async detach(collection:string,id:string){this.generation++;await this.locked(()=>this.store.detach(collection,id));this.changed();}
 async remove(id:string){this.generation++;this.connect();this.channel?.postMessage({type:'cancel'});this.controller?.abort();await this.locked(()=>this.store.removeCollection(id));this.changed();this.run();}
 activate(){this.stopped=false;this.connect();this.run();}
 dispose(){this.generation++;this.stopped=true;this.controller?.abort();this.channel?.close();this.channel=null;}
 run(){this.requested=true;if(this.running||this.stopped||!navigator.onLine)return;this.running=true;void (async()=>{while(!this.stopped&&navigator.onLine){this.requested=false;const more=await this.locked(async()=>{if(this.stopped)return false;const next=await this.store.nextQueued();if(!next)return false;await this.download(next);return true;});if(!more)break;}})().catch(error=>{this.error=error instanceof Error?error.message:'Local storage failed. Export or remove downloads and retry.';this.changed();}).finally(()=>{this.running=false;if(this.requested&&!this.stopped)this.run();});}
 private async download(item:LocalTrack){const controller=new AbortController();this.controller=controller;this.currentId=item.id;let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;let timer:ReturnType<typeof setTimeout>|undefined;
  const touch=()=>{clearTimeout(timer);timer=setTimeout(()=>controller.abort(),30000);};
  try{
   touch();
   if(item.source.kind!=='library')throw new Error('This local source is not a server download.');
   const session=await accountRequest<AuthState>('auth/session',undefined,undefined,controller.signal);if(!validAuthState(session)||session.user?.id!==this.store.user){window.dispatchEvent(new Event('freeqify:unauthenticated'));throw new Error('Account changed. Sign in again before downloading.');}
   await this.store.reset(item.id);item={...item,state:'downloading',bytes:0,chunks:0,total:null,error:undefined};await this.store.saveTrack(item);this.changed();touch();
   const response=await fetch(libraryUrl(`download/${encodeURIComponent(item.source.id)}`),{credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal});
   if(response.status===401||response.status===403){window.dispatchEvent(new Event('freeqify:unauthenticated'));throw new Error('Sign in again to download music.');}
   if(response.status!==200){await response.body?.cancel();throw new Error(`Download unavailable (${response.status}). Retry when connected.`);}
   const type=response.headers.get('content-type')?.split(';')[0]?.toLowerCase()??'';
   if(!audioTypes.has(type)||!response.body){await response.body?.cancel();throw new Error('The server did not return a supported audio file.');}
   const length=response.headers.get('content-length');item.total=length&&/^\d+$/.test(length)?Number(length):null;item.type=type;
   const estimate=await storageInfo();if(estimate.quota!==undefined&&estimate.usage!==undefined&&(item.total??1048576)>estimate.quota-estimate.usage-1048576){await response.body.cancel();throw new Error('Not enough device storage. Remove downloads or export files first.');}
   reader=response.body.getReader();let report=0;const pending=new Uint8Array(1048576);let used=0;
   const flush=async()=>{if(!used)return;await this.store.chunk(item.id,item.chunks++,pending.subarray(0,used));item.bytes+=used;used=0;};
   for(;;){touch();const {done,value}=await reader.read();if(done)break;for(let offset=0;offset<value.length;){const size=Math.min(pending.length-used,value.length-offset);pending.set(value.subarray(offset,offset+size),used);used+=size;offset+=size;if(used===pending.length)await flush();}if(Date.now()-report>300){await this.store.saveTrack(item);this.changed();report=Date.now();}}
   await flush();
   if(controller.signal.aborted||this.stopped)throw new DOMException('Download stopped','AbortError');
   if(!item.bytes||item.total!==null&&item.total!==item.bytes)throw new Error('Download interrupted before the complete file arrived. Retry to finish.');
   await this.store.saveTrack(item);await this.store.blob(item.id,true);
   // Artwork is optional and independently bounded. Never save request URLs or credentials.
   const artwork=item.track.albumId?`artwork/album/${encodeURIComponent(item.track.albumId)}`:item.track.artworkId?`artwork/${encodeURIComponent(item.track.artworkId)}`:null;
   const cachedArtwork=await this.store.artwork(item.track);
   if(cachedArtwork)item.artwork=cachedArtwork;
   if(artwork&&!cachedArtwork){try{touch();const art=await fetch(libraryUrl(artwork),{credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal});if(art.ok&&/^image\/(png|jpeg|webp)$/.test(art.headers.get('content-type')?.split(';')[0]??'')&&art.body){const ar=art.body.getReader();const parts:BlobPart[]=[];let bytes=0;try{for(;;){const value=await ar.read();if(value.done)break;bytes+=value.value.length;if(bytes>5*1024*1024)throw new Error('Artwork too large');parts.push(new Uint8Array(value.value).buffer);}item.artwork=new Blob(parts,{type:art.headers.get('content-type')!});}finally{await ar.cancel().catch(()=>{});}}else await art.body?.cancel();}catch{/* Audio remains usable without artwork. */}}
   if(controller.signal.aborted||this.stopped)throw new DOMException('Download stopped','AbortError');
   await this.store.saveTrack({...item,track:{...item.track,format:'mp3'},state:'complete'});
  }catch(error){await this.store.saveTrack({...item,state:controller.signal.aborted?'cancelled':'failed',error:error instanceof DOMException&&error.name==='QuotaExceededError'?'Device storage is full. Export or remove downloads, then retry.':error instanceof Error?error.message:'Download failed. Retry when connected.'});}
  finally{clearTimeout(timer);await reader?.cancel().catch(()=>{});this.controller=null;this.currentId=null;this.changed();}
 }
}
