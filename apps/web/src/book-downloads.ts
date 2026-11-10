import type {Audiobook} from '@freeqify/shared';
import {AccountRequestError} from './auth-api.js';
export type BookDownloadState='downloading'|'complete'|'failed'|'cancelled'|'removed';
export interface DownloadPart {id:string;bytes:number;total:number;chunks:number;type:string;complete:boolean;}
export interface DeviceBook {id:string;book:Audiobook;baseRevision:number;pending:boolean;state:BookDownloadState;parts:DownloadPart[];error:string;}
interface BookChunk {bookId:string;partId:string;index:number;blob:Blob;}
const CHUNK=2*1024*1024,MAX_BOOK=8*1024*1024*1024;
const mediaTypes=new Set(['audio/mpeg','audio/mp3','audio/mp4','audio/aac','audio/ogg','application/ogg','audio/flac','audio/x-flac','audio/wav','audio/wave','audio/x-wav','audio/webm']);
export const bookDatabase=(user:string)=>`freeqify-books:${import.meta.env.BASE_URL}:${user}`;
function request<T>(req:IDBRequest<T>){return new Promise<T>((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
function finished(tx:IDBTransaction){return new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error??new Error('Device storage transaction failed.'));tx.onerror=()=>{};});}
export class BookDeviceStore {
 private opened:Promise<IDBDatabase>|undefined;
 constructor(readonly user:string){}
 private db(){return this.opened??=new Promise<IDBDatabase>((resolve,reject)=>{if(!globalThis.indexedDB){reject(new Error('Device storage is unavailable.'));return;}const req=indexedDB.open(bookDatabase(this.user),1);req.onupgradeneeded=()=>{req.result.createObjectStore('books',{keyPath:'id'});req.result.createObjectStore('chunks',{keyPath:['bookId','partId','index']});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);req.onblocked=()=>reject(new Error('Close other Freeqify tabs and retry.'));});}
 async list():Promise<DeviceBook[]>{const db=await this.db();return request(db.transaction('books').objectStore('books').getAll());}
 async get(id:string):Promise<DeviceBook|undefined>{const db=await this.db();return request(db.transaction('books').objectStore('books').get(id));}
 async edit(id:string,change:(entry:DeviceBook|undefined)=>DeviceBook){const db=await this.db(),tx=db.transaction('books','readwrite'),done=finished(tx);let result:DeviceBook|undefined,problem:unknown;const store=tx.objectStore('books'),req=store.get(id);req.onsuccess=()=>{try{result=change(req.result);store.put(result);}catch(e){problem=e;tx.abort();}};try{await done;}catch(e){throw problem??e;}return result!;}
 async resetPart(bookId:string,partId:string,part?:DownloadPart){const db=await this.db(),tx=db.transaction(['books','chunks'],'readwrite'),done=finished(tx);tx.objectStore('chunks').delete(IDBKeyRange.bound([bookId,partId,0],[bookId,partId,Number.MAX_SAFE_INTEGER]));const store=tx.objectStore('books'),req=store.get(bookId);req.onsuccess=()=>{const entry=req.result as DeviceBook;if(entry){entry.parts=entry.parts.filter(p=>p.id!==partId);if(part)entry.parts.push(part);store.put(entry);}};await done;}
 async chunk(bookId:string,partId:string,index:number,bytes:Uint8Array){const db=await this.db(),tx=db.transaction(['books','chunks'],'readwrite'),done=finished(tx);const blob=new Blob([new Uint8Array(bytes).buffer]);tx.objectStore('chunks').put({bookId,partId,index,blob} satisfies BookChunk);const store=tx.objectStore('books'),req=store.get(bookId);req.onsuccess=()=>{const entry=req.result as DeviceBook,part=entry?.parts.find(p=>p.id===partId);if(!part){tx.abort();return;}part.bytes+=blob.size;part.chunks++;store.put(entry);};await done;}
 async blob(bookId:string,partId:string){const entry=await this.get(bookId),part=entry?.parts.find(p=>p.id===partId);if(!part?.complete)throw new Error('This part is not downloaded.');const db=await this.db(),tx=db.transaction('chunks');const chunks=await request(tx.objectStore('chunks').getAll(IDBKeyRange.bound([bookId,partId,0],[bookId,partId,Number.MAX_SAFE_INTEGER]))) as BookChunk[];if(chunks.length!==part.chunks||chunks.some((c,i)=>c.index!==i)||chunks.reduce((n,c)=>n+c.blob.size,0)!==part.total)throw new Error('The downloaded part is incomplete. Reconnect and download it again.');return new Blob(chunks.map(c=>c.blob),{type:part.type});}
 async removeAudio(id:string){const entry=await this.get(id);if(!entry)return;for(const p of entry.parts)await this.resetPart(id,p.id);await this.edit(id,e=>({...e!,state:'removed',error:''}));}
 async forget(id:string){await this.removeAudio(id);const db=await this.db(),tx=db.transaction('books','readwrite'),done=finished(tx);tx.objectStore('books').delete(id);await done;}
}
export function downloaded(entry:DeviceBook|undefined){return !!entry&&entry.book.parts.every(p=>entry.parts.some(file=>file.id===p.id&&file.complete));}
export function offlineFields(book:Audiobook){return {partId:book.partId,position:book.position,speed:book.speed,status:book.status,bookmarks:book.bookmarks};}
export function changeDeviceBook(book:Audiobook,action:string,input:Record<string,unknown>):Audiobook {
 const next=structuredClone(book),fail=()=>{throw new Error('Choose a valid audiobook position or setting.');};
 const point=()=>{const part=next.parts.find(p=>p.id===input.partId),position=input.position;if(!part||typeof position!=='number'||!Number.isFinite(position)||position<0||position>604800||(part.duration!==null&&position>part.duration+1))return fail();return {partId:part.id,position:Math.min(position,part.duration??position)};};
 const note=()=>{if(typeof input.note!=='string'||input.note.length>1000||Array.from(input.note).some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127))return fail();return input.note.trim();};
 if(action==='progress'){Object.assign(next,point());if(next.status!=='finished')next.status='listening';}
 else if(action==='speed'){if(typeof input.speed!=='number'||!Number.isFinite(input.speed)||input.speed<.5||input.speed>3)return fail();next.speed=input.speed;}
 else if(action==='status'){if(!['unstarted','listening','finished'].includes(String(input.status)))return fail();next.status=input.status as Audiobook['status'];if(next.status==='unstarted'){next.partId=next.parts[0]!.id;next.position=0;}}
 else if(action==='bookmark'){if(next.bookmarks.length>=500)throw new Error('Bookmark limit reached.');next.bookmarks.push({id:crypto.randomUUID(),...point(),note:note(),createdAt:Date.now()});}
 else if(action==='bookmark-edit'){const b=next.bookmarks.find(b=>b.id===input.bookmarkId);if(!b)return fail();b.note=note();}
 else if(action==='bookmark-delete')next.bookmarks=next.bookmarks.filter(b=>b.id!==input.bookmarkId);
 else throw new Error('Reconnect and use streaming mode to edit chapters, book details or file order.');
 next.revision++;next.updatedAt=Date.now();return next;
}
type RemoteBook=(id:string,revision:number,fields:ReturnType<typeof offlineFields>)=>Promise<Audiobook>;
export class BookDownloads {
 readonly store:BookDeviceStore;private active:AbortController|null=null;private disposed=false;
 constructor(readonly user:string,private source:(id:string)=>string,private remote:RemoteBook,private read:(id:string)=>Promise<Audiobook>,private online:()=>boolean,private notify:()=>void){this.store=new BookDeviceStore(user);}
 private lock<T>(id:string,work:()=>Promise<T>){if(!navigator.locks)return Promise.reject(new Error('This browser does not support safe download coordination.'));return navigator.locks.request(`${bookDatabase(this.user)}:${id}`,work);}
 activate(){this.disposed=false;}
 dispose(){this.disposed=true;this.active?.abort();}
 cancel(){this.active?.abort();}
 async prepare(book:Audiobook,local:boolean){
  if(!local){const entry=await this.store.get(book.id).catch(()=>undefined);return entry?.pending?this.sync(book.id):this.read(book.id);}
  return this.lock(book.id,async()=>{const entry=await this.store.get(book.id);if(!entry?.pending&&this.online())book=await this.read(book.id);if(!downloaded(entry)||(!entry!.pending&&!downloaded({...entry!,book})))throw new Error('Download every part of this book before listening offline.');if(!entry!.pending&&this.online())return (await this.store.edit(book.id,e=>({...e!,book,baseRevision:book.revision}))).book;return entry!.book;});
 }
 async remember(book:Audiobook){await this.lock(book.id,async()=>{if(!await this.store.get(book.id))return;await this.store.edit(book.id,e=>e!.pending||e!.book.revision>book.revision?e!:{...e!,book,baseRevision:book.revision});});this.notify();}
 async write(book:Audiobook,action:string,input:Record<string,unknown>){return this.lock(book.id,async()=>{const entry=await this.store.edit(book.id,e=>{if(!e||e.book.revision!==book.revision)throw new Error('This device copy changed in another tab. Reload the book.');return {...e,book:changeDeviceBook(e.book,action,input),pending:true,error:''};});this.notify();if(this.online()&&!this.disposed){try{return await this.syncLocked(entry);}catch(e){if(e instanceof AccountRequestError&&e.status===401)throw e;/* Keep listening from the durable device copy; show sync status in the book view. */}}return entry.book;});}
 async sync(id:string,choice?:'server'|'device'){if(!this.online()||this.disposed)throw new Error('Reconnect to sync this book.');return this.lock(id,async()=>{let entry=await this.store.get(id);if(!entry)throw new Error('Device copy unavailable.');if(choice){const server=await this.read(id);if(choice==='server'){await this.store.edit(id,e=>({...e!,book:server,baseRevision:server.revision,pending:false,error:''}));this.notify();return server;}entry={...entry,baseRevision:server.revision};}return this.syncLocked(entry);});}
 private async syncLocked(entry:DeviceBook){if(!entry.pending)return entry.book;let result:Audiobook;
  try{result=await this.remote(entry.id,entry.baseRevision,offlineFields(entry.book));}
  catch(e){if(e instanceof AccountRequestError&&e.status===409){const server=await this.read(entry.id);if(JSON.stringify(offlineFields(server))===JSON.stringify(offlineFields(entry.book)))result=server;else{await this.store.edit(entry.id,x=>({...x!,error:'Server progress changed. Choose which saved progress and bookmarks to keep.'}));this.notify();throw e;}}
   else{await this.store.edit(entry.id,x=>({...x!,error:'Saved on this device. Reconnect and sync to update the server.'}));this.notify();throw e;}}
  await this.store.edit(entry.id,e=>({...e!,book:result,baseRevision:result.revision,pending:false,error:''}));this.notify();return result;
 }
 private async removeStored(id:string,forget:boolean){if(!navigator.locks)throw new Error('Device storage coordination unavailable.');await navigator.locks.request(`${bookDatabase(this.user)}:download`,{ifAvailable:true},async lock=>{if(!lock||this.active)throw new Error('Cancel the active download before removing a copy.');await this.lock(id,()=>forget?this.store.forget(id):this.store.removeAudio(id));});this.notify();}
 async remove(id:string){return this.removeStored(id,false);}
 async forget(id:string){return this.removeStored(id,true);}
 async download(book:Audiobook){if(!this.online())throw new Error('Reconnect to download a book.');if(this.active)throw new Error('A book is already downloading.');if(!navigator.locks)throw new Error('This browser does not support safe download coordination.');
  const controller=new AbortController();this.active=controller;const signal=controller.signal;let idle:ReturnType<typeof setTimeout>|undefined;const touch=()=>{clearTimeout(idle);idle=setTimeout(()=>controller.abort(new Error('Download stalled. Retry when connected.')),30000);};
  try{await navigator.locks.request(`${bookDatabase(this.user)}:download`,{ifAvailable:true},async lock=>{
   if(!lock)throw new Error('A book is downloading in another tab.');if(this.disposed)throw new Error('Sign in again to download.');
   book=await this.read(book.id);
   const estimate=await navigator.storage?.estimate();if(!estimate?.quota)throw new Error('Browser storage is unavailable.');await navigator.storage.persist?.().catch(()=>false);
   await this.lock(book.id,async()=>{await this.store.edit(book.id,e=>{if(e?.pending)throw new Error('Sync saved device progress before updating its download.');if(e&&e.book.revision>book.revision)book=e.book;return {id:book.id,book,baseRevision:book.revision,pending:false,state:'downloading',parts:e?.parts??[],error:''};});const entry=await this.store.get(book.id);for(const p of entry!.parts)if(!book.parts.some(t=>t.id===p.id))await this.store.resetPart(book.id,p.id);});this.notify();
   let total=(await this.store.get(book.id))!.parts.filter(p=>p.complete).reduce((n,p)=>n+p.total,0);
   try{for(const part of book.parts){signal.throwIfAborted();if(this.disposed)throw new Error('Download stopped.');if((await this.store.get(book.id))!.parts.some(p=>p.id===part.id&&p.complete))continue;
     await this.store.resetPart(book.id,part.id);
     touch();const response=await fetch(this.source(part.id),{credentials:'same-origin',cache:'no-store',signal});
     if(response.status===401){window.dispatchEvent(new Event('freeqify:unauthenticated'));throw new Error('Sign in to download books.');}
     const type=response.headers.get('content-type')?.split(';')[0]?.toLowerCase()??'',size=Number(response.headers.get('content-length'));
     const storage=await navigator.storage.estimate();
     if(response.status!==200||!mediaTypes.has(type)||!Number.isSafeInteger(size)||size<=0||total+size>MAX_BOOK||size>(storage.quota??0)-(storage.usage??0)-16*1024*1024){await response.body?.cancel();throw new Error('Download unavailable or too large for device storage (8 GB maximum per book).');}
     total+=size;await this.store.resetPart(book.id,part.id,{id:part.id,bytes:0,total:size,chunks:0,type,complete:false});this.notify();
     const reader=response.body?.getReader();if(!reader)throw new Error('Audio stream is unavailable.');let used=0,index=0,received=0;const buffer=new Uint8Array(CHUNK);
     try{while(true){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;touch();received+=value.length;if(received>size)throw new Error('Audio length changed during download.');let offset=0;while(offset<value.length){const n=Math.min(CHUNK-used,value.length-offset);buffer.set(value.subarray(offset,offset+n),used);used+=n;offset+=n;if(used===CHUNK){signal.throwIfAborted();await this.store.chunk(book.id,part.id,index++,buffer);used=0;this.notify();}}}if(received!==size)throw new Error('Audio transfer was incomplete. Retry the download.');signal.throwIfAborted();if(used)await this.store.chunk(book.id,part.id,index,buffer.subarray(0,used));}
     finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
     signal.throwIfAborted();await this.store.edit(book.id,e=>({...e!,parts:e!.parts.map(p=>p.id===part.id?{...p,complete:true}:p)}));this.notify();
    }
    signal.throwIfAborted();await this.store.edit(book.id,e=>({...e!,state:'complete',error:''}));
   }catch(e){const entry=await this.store.get(book.id);for(const part of entry?.parts??[])if(!part.complete)await this.store.resetPart(book.id,part.id);const cancelled=signal.aborted&&signal.reason instanceof DOMException&&signal.reason.name==='AbortError';const message=cancelled?'Download cancelled.':signal.aborted&&signal.reason instanceof Error?signal.reason.message:e instanceof Error?e.message:'Download failed.';await this.store.edit(book.id,x=>({...x!,state:cancelled?'cancelled':'failed',error:message}));if(!cancelled)throw new Error(message,{cause:e});}
  });}finally{clearTimeout(idle);this.active=null;this.notify();}
 }
}
