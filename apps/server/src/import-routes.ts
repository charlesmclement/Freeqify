import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {ImportPage,ImportedMetadata,Track,LidarrAlbumChoice} from '@freeqify/shared';
import type {AuthStore} from './auth/store.js';
import {AuthError} from './auth/password.js';
import type {Config} from './config.js';
import {LibraryError,validId,type MusicLibrary} from './integrations/navidrome.js';
import {Lidarr,type AlbumIntegration} from './integrations/lidarr.js';
import {ImportStore,type StoredImportEntry} from './import-store.js';
import {IMPORT_MAX_BYTES,parsePlaylistCsv} from './import-csv.js';
import {matchImported,normalized} from './import-matching.js';
import {ImportQueue} from './import-queue.js';
import {PersonalStore} from './personal-store.js';
const invalid=(message='Invalid playlist import request.')=>new AuthError(400,'INVALID_INPUT',message);
export function registerImportRoutes(app:FastifyInstance,prefix:string,auth:AuthStore,library:MusicLibrary,config:Config,integration:AlbumIntegration=new Lidarr(config.lidarr)){
 const store=new ImportStore(auth),personal=new PersonalStore(auth),queue=new ImportQueue(auth);const locks=new Set<string>();let requesting=false,autoScanAt=0;
 app.register(async routes=>{
  const active=(r:FastifyRequest)=>{const session=auth.session(r.authSession?.token,false);if(!session?.user)throw new AuthError(401,'UNAUTHENTICATED','Sign in to continue.');return session.user;};
  routes.addHook('onRequest',async(r,reply)=>{reply.header('Cache-Control','no-store');active(r);});
  routes.addHook('preHandler',async r=>{if(['GET','HEAD'].includes(r.method))return;if(r.headers.origin!==(config.proxy?.origin??`${config.auth.secureCookies?'https':'http'}://${r.headers.host}`)||!auth.csrf(r.authSession,r.headers['x-csrf-token']))throw new AuthError(403,'CSRF_REJECTED','Refresh before trying again.');if(!r.headers['content-type']?.startsWith('application/json')||!r.body||typeof r.body!=='object'||Array.isArray(r.body))throw invalid();});
  routes.addHook('preSerialization',async(r,reply,payload)=>{try{active(r);return payload;}catch{reply.code(401);return {error:{code:'UNAUTHENTICATED',message:'Sign in to continue.'}};}});
  routes.setErrorHandler((e,_r,reply)=>{if(e instanceof AuthError)return reply.code(e.status).send({error:{code:e.code,message:e.message}});if(e instanceof LibraryError)return reply.code(502).send({error:{code:e.code,message:e.message}});return reply.code(500).send({error:{code:'IMPORT_UNAVAILABLE',message:'The import could not be updated. Your saved checklist is safe.'}});});
  const body=(r:FastifyRequest)=>r.body as Record<string,unknown>;
  const id=(r:FastifyRequest)=>{const value=(r.params as {id:unknown}).id;if(!validId(value))throw invalid();return value;};
  const integer=(value:unknown,fallback:number,max:number)=>{if(value===undefined)return fallback;if(typeof value!=='string'||!/^\d{1,5}$/.test(value)||Number(value)>max)throw invalid();return Number(value);};
  const locked=async<T>(r:FastifyRequest,fn:()=>Promise<T>)=>{const key=active(r).id+':'+id(r);store.owned(active(r).id,id(r));if(locks.has(key))throw new AuthError(409,'IMPORT_BUSY','This checklist is being updated. Retry shortly.');locks.add(key);try{return await fn();}finally{locks.delete(key);}};
  routes.get('/',async r=>({items:store.list(active(r).id)}));
  routes.post('/',{bodyLimit:IMPORT_MAX_BYTES*2+4096},async r=>{const b=body(r);if(typeof b.filename!=='string'||!b.filename.toLowerCase().endsWith('.csv')||b.filename.length>255)throw invalid('Choose a CSV export. Extract ZIP archives on your device first.');const entries=parsePlaylistCsv(b.csv);return {id:store.create(active(r).id,b.name,entries),count:entries.length};});
  routes.get('/lidarr',async r=>{const status=await integration.status();return {...status,canRequest:status.canRequest&&active(r).role==='admin'};});
  routes.get('/:id',async(r):Promise<ImportPage>=>{const user=active(r).id,q=r.query as Record<string,unknown>,offset=integer(q.offset,0,5000),limit=integer(q.limit,50,100);if(!limit)throw invalid();if(q.status!==undefined&&!['available','missing','review','requested'].includes(String(q.status)))throw invalid();if(q.q!==undefined&&(typeof q.q!=='string'||q.q.length>200))throw invalid();const search=normalized(String(q.q??''));return {playlist:store.summary(user,id(r)),...store.page(user,id(r),offset,limit,String(q.status??''),search)};});
  routes.post('/:id/delete',async r=>locked(r,async()=>{store.delete(active(r).id,id(r));return {ok:true};}));
  routes.post('/:id/recheck',async r=>locked(r,async()=>{
   const user=active(r).id,b=body(r);if(b.offset!==undefined&&(!Number.isSafeInteger(b.offset)||Number(b.offset)<0||Number(b.offset)>5000))throw invalid();const offset=Number(b.offset??0),total=store.summary(user,id(r)).count,batch=store.entries(user,id(r),offset,10),completed:StoredImportEntry[]=[],started=Date.now(),cache=new Map<string,Promise<Track[]>>();let newlyAvailable=0;
   for(const entry of batch){
    if(Date.now()-started>10000)break;completed.push(entry);const previousStatus=entry.status;
    if(entry.manual&&entry.track){try{entry.track=await library.track(entry.track.id);entry.status='available';entry.checkedAt=Date.now();entry.reason='Your confirmed match is available.';if(previousStatus!=='available')newlyAvailable++;continue;}catch(e){if(!(e instanceof LibraryError)||e.code!=='NOT_FOUND')throw e;entry.manual=false;}}
    const key=JSON.stringify(entry.metadata);if(!cache.has(key))cache.set(key,(async()=>{const result=await library.search(entry.metadata.title+' '+entry.metadata.artist,0,40);if(result.tracks.length)return result.tracks;return (await library.search(entry.metadata.title,0,40)).tracks;})());
    const tracks=await cache.get(key)!;Object.assign(entry,matchImported(entry.metadata,tracks,entry.rejected),{checkedAt:Date.now()});
    if(tracks.length>=40&&entry.status==='available'){entry.status='review';entry.candidates=entry.track?[entry.track]:[];entry.track=null;entry.reason='Search results may be incomplete. Confirm this match.';}
    if(entry.status!=='available'&&entry.request){try{const state=await integration.state(entry.request.albumId);if(state.monitored){entry.status='requested';entry.reason=state.present?'Files imported in Lidarr; waiting for a confirmed library match.':'Waiting for Lidarr to download and import the containing album.';
      if(state.present&&active(r).role==='admin'&&library.startScan&&library.scanStatus&&Date.now()-autoScanAt>=600000){
       try{auth.limit('library:scan',1,60000);autoScanAt=Date.now();const scan=await library.scanStatus();if(!scan.scanning)await library.startScan();entry.reason='Files imported in Lidarr. Library indexing started automatically.';}catch{entry.reason='Files imported in Lidarr; waiting for library indexing. An administrator can use Scan music library.';}
      }
     }else entry.request=null;}catch{entry.status='requested';entry.reason='Lidarr is unavailable. Last confirmed monitored; recheck later.';}}
    if(entry.status==='available'&&previousStatus!=='available')newlyAvailable++;
   }
   active(r);store.save(user,id(r),completed);return {newlyAvailable,nextOffset:offset+completed.length<total?offset+completed.length:null,checked:completed.length};
  }));
  routes.post('/:id/review',async r=>locked(r,async()=>{
   const b=body(r),user=active(r).id;const entry=store.entries(user,id(r)).find(e=>e.id===b.entryId);if(!entry)throw invalid();
   if(b.action==='reject'){entry.rejected=[...new Set([...entry.rejected,...entry.candidates.map(t=>t.id)])].slice(-50);entry.candidates=[];entry.track=null;entry.manual=false;entry.status='missing';entry.reason='Suggested recordings rejected. No confirmed local match.';}
   else if(b.action==='confirm'&&typeof b.trackId==='string'&&entry.candidates.some(t=>t.id===b.trackId)){entry.track=await library.track(b.trackId);entry.candidates=[];entry.manual=true;entry.status='available';entry.reason='Match confirmed by you.';}
   else throw invalid();entry.checkedAt=Date.now();active(r);store.save(user,id(r),[entry]);return {ok:true};
  }));
  routes.post('/:id/playlist',async r=>locked(r,async()=>{
   const user=active(r).id,existing=store.linked(user,id(r));if(existing)return {id:existing,existing:true};
   const tracks=store.available(user,id(r));if(!tracks.length)throw invalid('Match at least one available track first.');
   if(store.entries(user,id(r)).some(e=>e.status==='available'&&(!e.checkedAt||Date.now()-e.checkedAt>300000)))throw new AuthError(409,'RECHECK_REQUIRED','Recheck the library before creating this playlist.');
   // Trusted server-resolved snapshots, never caller-supplied tracks. Availability is
   // last checked; later missing references remain in the ordinary personal playlist.
   active(r);return {id:personal.createFromTracks(user,store.summary(user,id(r)).name,tracks,created=>store.link(user,id(r),created)),existing:false};
  }));
  function admin(r:FastifyRequest){const user=active(r);if(user.role!=='admin')throw new AuthError(403,'ADMIN_REQUIRED','An administrator must review and submit Lidarr requests.');return user.id;}
  // Processing is driven by bounded authenticated requests. Saved work survives a
  // closed tab/restart; resuming requires a current administrator session.
  routes.get('/:id/albums/queue',async r=>{const user=admin(r);return queue.public(queue.get(user,id(r)));});
  routes.post('/:id/albums/queue',{bodyLimit:256*1024},async r=>locked(r,async()=>{const user=admin(r);return queue.public(queue.create(user,id(r),body(r).entries));}));
  routes.post('/:id/albums/queue/clear',async r=>locked(r,async()=>{queue.clear(admin(r),id(r),body(r).queueId);return {ok:true};}));
  routes.post('/:id/albums/queue/retry',async r=>locked(r,async()=>{
   const user=admin(r),b=body(r),q=queue.require(user,id(r),b.queueId);
   if(!validId(b.key))throw invalid();const item=q.items.find(i=>i.key===b.key&&['failed','review'].includes(i.status));if(!item)throw invalid();
   item.status=item.albumId?'queued':'pending';delete item.error;if(q.automatic)queue.resume(user,id(r),q,r.authSession!.token);else queue.save(user,id(r),q);return queue.public(q);
  }));
  routes.post('/:id/albums/queue/skip',async r=>locked(r,async()=>{
   const user=admin(r),b=body(r),q=queue.require(user,id(r),b.queueId);
   const item=q.items.find(i=>i.key===b.key&&i.status==='failed');if(!item)throw invalid();
   item.status='skipped';item.candidates=[];delete item.error;if(q.automatic)queue.resume(user,id(r),q,r.authSession!.token);else queue.save(user,id(r),q);return queue.public(q);
  }));
  routes.post('/:id/albums/queue/confirm',async r=>locked(r,async()=>{
   const user=admin(r),b=body(r),q=queue.require(user,id(r),b.queueId);
   if(b.confirmed!==true||typeof b.search!=='boolean'||!Array.isArray(b.choices)||b.choices.length>10||!Array.isArray(b.skip)||b.skip.length>10)throw invalid('Review and explicitly confirm or skip albums.');
   const ready=q.items.filter(i=>i.status==='review').slice(0,10),keys=new Set<string>();
   for(const c of b.choices){if(!c||typeof c!=='object'||!validId(c.key)||!validId(c.albumId)||keys.has(c.key))throw invalid();keys.add(c.key);const item=ready.find(i=>i.key===c.key);if(!item?.candidates.some(a=>a.id===c.albumId&&a.canRequest))throw invalid('Choose an album from this review.');}
   for(const key of b.skip){if(typeof key!=='string'||keys.has(key)||!ready.some(i=>i.key===key))throw invalid();keys.add(key);}
   if(!keys.size)throw invalid('Choose or skip at least one album.');
   const entries=store.entries(user,id(r));
   for(const c of b.choices){const item=ready.find(i=>i.key===c.key)!;if(item.entryIds.some(key=>!entries.some(e=>e.id===key&&['missing','requested'].includes(e.status))))throw new AuthError(409,'REVIEW_CHANGED','A recording is now available or needs review. Skip that album and recheck the library.');item.albumId=c.albumId;item.search=b.search;item.status='queued';}
   for(const key of b.skip)ready.find(i=>i.key===key)!.status='skipped';
   if(q.automatic)queue.resume(user,id(r),q,r.authSession!.token);else queue.save(user,id(r),q);return queue.public(q);
  }));
  async function processQueue(user:string,playlist:string,q:import('./import-queue.js').StoredQueue,ensure:()=>void){
   ensure();
   const item=q.items.find(i=>i.status==='queued')??((q.automatic||q.items.filter(i=>i.status==='review').length<10)?q.items.find(i=>i.status==='pending'):undefined);
   if(!item)return queue.public(q);
   if(requesting)throw new AuthError(409,'LIDARR_BUSY','Another album request is being processed. Retry shortly.');
   requesting=true;
   try{
    if(item.status==='pending'){
     if(q.automatic){
      const result=await library.search(item.metadata.album+' '+(item.metadata.albumArtist||item.metadata.artist),0,40);ensure();
      const albums=result.albums.filter(a=>normalized(a.title)===normalized(item.metadata.album)&&normalized(a.artist)===normalized(item.metadata.albumArtist||item.metadata.artist));
      if(albums.length&&albums.length<=2&&library.album){
       const local:Track[]=[];for(const album of albums){local.push(...(await library.album(album.id)).tracks);ensure();}
       const entries=store.entries(user,playlist).filter(e=>item.entryIds.includes(e.id));
       const matches=entries.map(e=>matchImported(e.metadata,local,e.rejected));
       if(entries.length&&matches.every((m,i)=>m.status==='available'||m.status==='review'&&m.candidates.some(t=>normalized(t.album)===normalized(item.metadata.album)&&normalized(t.title)===normalized(entries[i]!.metadata.title)&&normalized(t.artist)===normalized(entries[i]!.metadata.artist)))){
        entries.forEach((e,i)=>Object.assign(e,matches[i],{checkedAt:Date.now()}));store.save(user,playlist,entries);
        item.status='skipped';item.error='Selected recordings already exist in the library.';queue.save(user,playlist,q);return queue.public(q);
       }
      }
     }
     const candidates=await integration.lookup(item.metadata);ensure();item.candidates=candidates;item.status='review';
     if(q.automatic){
      const exact=[...new Map(candidates.filter(c=>c.canRequest&&normalized(c.title)===normalized(item.metadata.album)&&normalized(c.artist)===normalized(item.metadata.albumArtist||item.metadata.artist)).map(c=>[c.id,c])).values()];
      if(exact.length===1){item.albumId=exact[0]!.id;item.search=true;item.status='queued';}
     }
    }else{
     const entries=store.entries(user,playlist),changed=entries.filter(e=>item.entryIds.includes(e.id));
     if(changed.length!==item.entryIds.length||changed.some(e=>!['missing','requested'].includes(e.status)))throw new AuthError(409,'REVIEW_CHANGED','A recording changed. Skip this album and recheck the library.');
     const albumId=item.albumId!;
     // Persisted confirmations and checklist receipts make retries and duplicate
     // credits idempotent, including a restart after the remote side effect.
     const done=q.items.some(i=>i.status==='confirmed'&&i.albumId===albumId)||changed.every(e=>e.request?.albumId===albumId);
     if(!done){ensure();await integration.request(albumId,item.search===true);}
     const state=await integration.state(albumId);ensure();
     if(!state.monitored)throw new AuthError(502,'NOT_MONITORED','Lidarr did not confirm album monitoring. Retry when it is available.');
     for(const entry of changed){entry.request={albumId};entry.status='requested';entry.reason='Containing album is confirmed monitored in Lidarr.';}
     store.save(user,playlist,changed);item.status='confirmed';item.candidates=[];
    }
   }catch(e){
    if(q.automatic&&!queue.authorized(user,q)){q.paused=true;queue.save(user,playlist,q);throw new AuthError(401,'UNAUTHENTICATED','Sign in and press Seek all to resume this background queue.');}
    ensure();item.status='failed';if(q.automatic)q.paused=true;item.error=e instanceof AuthError||e instanceof LibraryError?e.message:'Lidarr is unavailable. Retry this album later.';
   }finally{requesting=false;}
   ensure();queue.save(user,playlist,q);return queue.public(q);
  }
  routes.post('/:id/albums/queue/step',async r=>locked(r,async()=>{
   const user=admin(r),q=queue.require(user,id(r),body(r).queueId);
   if(q.automatic)return queue.public(q);
   return processQueue(user,id(r),q,()=>{admin(r);});
  }));
  routes.post('/:id/albums/queue/seek',async r=>locked(r,async()=>{
   const user=admin(r);return queue.public(queue.authorize(user,id(r),r.authSession!.token));
  }));
  routes.post('/:id/albums/queue/pause',async r=>{const user=admin(r);return queue.public(queue.pause(user,id(r),body(r).queueId));});
  let workerBusy=false,closing=false,cursor=0;
  const worker=setInterval(()=>{if(workerBusy||closing||requesting)return;workerBusy=true;
   void (async()=>{
    const jobs=queue.jobs();if(!jobs.length)return;const job=jobs[cursor++%jobs.length]!,key=job.user+':'+job.playlist;
    if(locks.has(key))return;locks.add(key);
    try{
     const q=queue.get(job.user,job.playlist);if(!q||!q.automatic||q.paused)return;
     if(!queue.authorized(job.user,q)){q.paused=true;queue.save(job.user,job.playlist,q);return;}
     if(!q.items.some(i=>i.status==='pending'||i.status==='queued'))return;
     await processQueue(job.user,job.playlist,q,()=>{if(!queue.authorized(job.user,q))throw new AuthError(401,'UNAUTHENTICATED','Background queue authorization expired. Sign in and press Seek all to resume.');});
    }finally{locks.delete(key);}
   })().catch(()=>{/* Saved receipts survive outages, revocation and shutdown. */}).finally(()=>{workerBusy=false;});
  },1000);worker.unref();
  app.addHook('preClose',async()=>{closing=true;clearInterval(worker);while(workerBusy)await new Promise(resolve=>setTimeout(resolve,25));});
  routes.post('/:id/albums/review',async r=>locked(r,async()=>{
   const user=admin(r),selected=body(r).entries;if(!Array.isArray(selected)||!selected.length||selected.length>50||new Set(selected).size!==selected.length||!selected.every(validId))throw invalid('Select 1–50 missing tracks.');
   const entries=store.entries(user,id(r)).filter(e=>selected.includes(e.id));if(entries.length!==selected.length||entries.some(e=>e.status!=='missing'||!e.checkedAt))throw invalid('Select checked missing tracks only.');
   const groups=new Map<string,{key:string;metadata:ImportedMetadata;entryIds:string[]}>();for(const e of entries){const m=e.metadata,key=normalized(m.albumArtist||m.artist)+'|'+normalized(m.album);const group=groups.get(key)??{key:e.id,metadata:m,entryIds:[]};group.entryIds.push(e.id);groups.set(key,group);}if(groups.size>10)throw invalid('Review up to 10 albums at a time.');
   const albums:LidarrAlbumChoice[]=[];for(const g of groups.values())albums.push({key:g.key,title:g.metadata.album||'Album not specified',artist:g.metadata.albumArtist||g.metadata.artist,tracks:g.entryIds.length,candidates:await integration.lookup(g.metadata)});
   active(r);const token=store.review(user,id(r),{groups:[...groups.values()].map(g=>({key:g.key,entryIds:g.entryIds,candidates:albums.find(a=>a.key===g.key)!.candidates.map(c=>({id:c.id}))}))});return {...token,albums};
  }));
  routes.post('/:id/albums/confirm',async r=>locked(r,async()=>{
   const user=admin(r),b=body(r);if(b.confirmed!==true||typeof b.search!=='boolean'||!validId(b.reviewId)||!Array.isArray(b.choices)||!b.choices.length||b.choices.length>10)throw invalid('Review and explicitly confirm selected albums.');
   const review=store.getReview(user,id(r),b.reviewId),entries=store.entries(user,id(r)),choices=b.choices as {key:string;albumId:string}[];
   if(new Set(choices.map(c=>c?.key)).size!==choices.length)throw invalid();
   for(const choice of choices){const group=review.groups.find(g=>g.key===choice?.key);if(!group||!group.candidates.some(c=>c.id===choice.albumId))throw invalid('Choose an album from this review.');if(group.entryIds.some(id=>!entries.some(e=>e.id===id&&['missing','requested'].includes(e.status))))throw new AuthError(409,'REVIEW_CHANGED','The checklist changed. Review the missing albums again.');}
   if(requesting)throw new AuthError(409,'LIDARR_BUSY','Another album request is being submitted. Retry shortly.');requesting=true;let submitted=0;
   try{for(const albumId of new Set(choices.map(c=>c.albumId))){admin(r);await integration.request(albumId,b.search);const state=await integration.state(albumId);if(!state.monitored)throw new AuthError(502,'NOT_MONITORED','Lidarr did not confirm album monitoring. Recheck before retrying.');admin(r);const entryIds=choices.filter(c=>c.albumId===albumId).flatMap(c=>review.groups.find(g=>g.key===c.key)!.entryIds);const changed=entries.filter(e=>entryIds.includes(e.id));for(const e of changed){e.request={albumId};e.status='requested';e.reason='Containing album is confirmed monitored in Lidarr.';}store.save(user,id(r),changed);submitted++;}store.finishReview(user,b.reviewId);return {submitted};}finally{requesting=false;}
  }));
 },{prefix});
}
