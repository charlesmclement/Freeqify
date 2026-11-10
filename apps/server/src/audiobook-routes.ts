import {cachedTranscript,saveTranscript,transcribeBookPassage,transcriptKey,transcriptWindow} from './book-transcript.js';
import {detectBookChapters} from './audiobook-chapters.js';
import {readSpokenHeading} from './book-spoken-headings.js';
import {Admission} from './resources.js';
import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import type {AuthStore} from './auth/store.js';
import {AuthError} from './auth/password.js';
import type {Config} from './config.js';
import {LibraryError,validId,type MusicLibrary} from './integrations/navidrome.js';
import {AudiobookStore} from './audiobook-store.js';
export function registerAudiobookRoutes(app:FastifyInstance,prefix:string,auth:AuthStore,library:MusicLibrary,config:Config){
 const store=new AudiobookStore(auth),scans=new Admission(2,1),speech=new Admission(1,1);const running=new Set<AbortController>();
 app.addHook('preClose',async()=>{for(const controller of running)controller.abort();});
 const scan=async(request:FastifyRequest,reply:FastifyReply,id:string)=>{
  const user=active(request),book=store.get(user,id),release=scans.acquire(user),controller=new AbortController();running.add(controller);
  const abort=()=>controller.abort();request.raw.on('aborted',abort);reply.raw.once('close',abort);
  const recheck=setInterval(()=>{try{active(request);}catch{abort();}},1000);recheck.unref();
  try{const result=await detectBookChapters(library,book.parts,config.audiobookFfprobePath??'ffprobe',controller.signal);return store.detect(active(request),id,book.revision,result);}
  finally{clearInterval(recheck);request.raw.off('aborted',abort);reply.raw.off('close',abort);running.delete(controller);release();}
 };
 const sourceUnavailable=()=>new AuthError(503,'BOOK_SOURCE_NOT_CONFIGURED','The Audiobooks source is not configured. An administrator must connect the Audiobooks folder as a Navidrome library and grant the service account access.');
 const sourceAlbum=(id:string)=>{if(!library.audiobookAlbum)throw sourceUnavailable();return library.audiobookAlbum(id);};
 const invalid=()=>new AuthError(400,'INVALID_INPUT','Invalid audiobook request.');
 const active=(request:FastifyRequest)=>{const session=auth.session(request.authSession?.token,false);if(!session?.user)throw new AuthError(401,'UNAUTHENTICATED','Sign in to continue.');return session.user.id;};
 app.register(async routes=>{
  routes.addHook('onRequest',async(request,reply)=>{reply.header('Cache-Control','no-store');active(request);if(!(request.method==='GET'&&[prefix,`${prefix}/catalog`].includes(request.routeOptions.url??''))&&Object.keys(request.query as object).length)throw invalid();});
  routes.addHook('preHandler',async request=>{
   if(['GET','HEAD'].includes(request.method))return;
   if(request.headers.origin!==(config.proxy?.origin??`${config.auth.secureCookies?'https':'http'}://${request.headers.host}`)||!auth.csrf(request.authSession,request.headers['x-csrf-token']))throw new AuthError(403,'CSRF_REJECTED','Refresh and try again.');
   if(!request.headers['content-type']?.startsWith('application/json')||!request.body||typeof request.body!=='object'||Array.isArray(request.body))throw invalid();
  });
  routes.addHook('preSerialization',async(request,_reply,payload)=>{active(request);return payload;});
  routes.setErrorHandler((error,_request,reply)=>{
   if(error instanceof AuthError)return reply.code(error.status).send({error:{code:error.code,message:error.message}});
   if(error instanceof LibraryError&&error.code==='NOT_CONFIGURED'){const problem=sourceUnavailable();return reply.code(problem.status).send({error:{code:problem.code,message:problem.message}});}
   if(error instanceof LibraryError)return reply.code(error.code==='NOT_FOUND'?404:502).send({error:{code:error.code,message:error.message}});
   return reply.code(500).send({error:{code:'BOOK_UNAVAILABLE',message:'Your audiobook library is unavailable.'}});
  });
  routes.get(prefix,async request=>{
   const query=request.query as Record<string,unknown>;if(Object.keys(query).some(k=>!['offset','status'].includes(k))||(query.offset!==undefined&&!/^\d{1,4}$/.test(String(query.offset))))throw invalid();
   if(query.status!==undefined&&!['all','unstarted','listening','finished'].includes(String(query.status)))throw invalid();
   return store.list(active(request),Number(query.offset??0),String(query.status??'all'));
  });
  routes.get(`${prefix}/catalog`,async request=>{
   const query=request.query as Record<string,unknown>;
   if(Object.keys(query).some(k=>!['offset','q'].includes(k))||(query.offset!==undefined&&!/^\d{1,4}$/.test(String(query.offset)))||(query.q!==undefined&&(typeof query.q!=='string'||query.q.length>200||Array.from(query.q).some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127))))throw invalid();
   if(!library.audiobookAlbums)throw sourceUnavailable();
   const page=await library.audiobookAlbums(Number(query.offset??0),48,String(query.q??'').trim());
   const saved=store.summariesForAlbums(active(request),page.items.map(a=>a.id));
   return {...page,items:page.items.map(album=>({...album,book:saved.get(album.id)??null}))};
  });
  routes.post(prefix,async(request,reply)=>{
   const body=request.body as Record<string,unknown>;if(!validId(body.albumId)||Object.keys(body).some(k=>k!=='albumId'))throw invalid();
   const album=await sourceAlbum(body.albumId),book=store.add(active(request),album);return book.chapterScan||!library.stream?book:scan(request,reply,book.id);
  });
  routes.get(`${prefix}/:id`,async request=>{const {id}=request.params as {id:string};if(!validId(id))throw invalid();return store.get(active(request),id);});
  routes.post(`${prefix}/:id/detect-chapters`,async(request,reply)=>{const {id}=request.params as {id:string},body=request.body as Record<string,unknown>;if(!validId(id)||Object.keys(body).some(k=>k!=='revision'))throw invalid();const book=store.get(active(request),id);if(book.revision!==body.revision)throw new AuthError(409,'BOOK_CONFLICT','This book changed. Reload it before scanning chapters.');return {book:await scan(request,reply,id)};});
  routes.post(`${prefix}/:id/spoken-heading`,async(request,reply)=>{
   const {id}=request.params as {id:string},body=request.body as Record<string,unknown>;
   if(!validId(id)||!validId(body.chapterId)||Object.keys(body).some(k=>k!=='chapterId'))throw invalid();
   const user=active(request),book=store.get(user,id),chapter=book.chapters.find(c=>c.id===body.chapterId),reader=config.audiobookSpeech;
   if(!chapter)throw invalid();
   if(!reader)throw new AuthError(503,'BOOK_SPEECH_NOT_CONFIGURED','Spoken headings are not enabled on this server. An administrator can enable the optional local speech reader.');
   const part=book.parts.find(p=>p.id===chapter.partId)!;
   const next=book.chapters.filter(c=>c.partId===part.id&&c.position>chapter.position).reduce((end,c)=>Math.min(end,c.position),part.duration??chapter.position+45);
   const release=speech.acquire(user),controller=new AbortController(),abort=()=>controller.abort();running.add(controller);
   const socketTimeout=request.raw.socket.timeout;request.raw.socket.setTimeout?.(100000);
   request.raw.on('aborted',abort);reply.raw.once('close',abort);
   const recheck=setInterval(()=>{try{active(request);}catch{abort();}},1000);recheck.unref();
   try{
    const result=await readSpokenHeading(library,part,chapter.id,chapter.position,Math.min(chapter.position===0?45:25,next-chapter.position),reader,controller.signal);
    const latest=store.get(active(request),id).chapters.find(c=>c.id===chapter.id);
    if(!latest||latest.partId!==chapter.partId||latest.position!==chapter.position)throw new AuthError(409,'BOOK_CONFLICT','This section changed. Reload the book before reading its heading.');
    return result;
   }finally{clearInterval(recheck);request.raw.off('aborted',abort);reply.raw.off('close',abort);request.raw.socket.setTimeout?.(socketTimeout??30000);running.delete(controller);release();}
  });
  routes.post(`${prefix}/:id/transcript`,async(request,reply)=>{
   const {id}=request.params as {id:string},body=request.body as Record<string,unknown>;
   if(!validId(id)||!validId(body.partId)||typeof body.position!=='number'||!Number.isFinite(body.position)||body.position<0||Object.keys(body).some(k=>!['partId','position'].includes(k)))throw invalid();
   const user=active(request),book=store.get(user,id),part=book.parts.find(p=>p.id===body.partId);
   if(!part||!part.duration||!Number.isFinite(part.duration)||body.position>=part.duration)throw invalid();
   const start=Math.floor(body.position/transcriptWindow)*transcriptWindow,end=Math.min(start+transcriptWindow,part.duration),reader=config.audiobookSpeech;
   if(!reader||!config.audiobookTranscriptsEnabled)return {status:'disabled',provider:'Whisper',partId:part.id,start,end,lines:[]};
   const key=transcriptKey(part,reader.model),cached=cachedTranscript(auth,user,id,part.id,key,start);
   if(cached)return {status:'ready',provider:'Whisper',partId:part.id,start,end,lines:cached};
   auth.limit(`book-transcript:${user}`,6,60000);
   const release=speech.acquire(user),controller=new AbortController(),abort=()=>controller.abort();running.add(controller);
   const socketTimeout=request.raw.socket.timeout;request.raw.socket.setTimeout?.(100000);
   request.raw.on('aborted',abort);reply.raw.once('close',abort);
   const recheck=setInterval(()=>{try{active(request);}catch{abort();}},1000);recheck.unref();
   try{
    const lines=await transcribeBookPassage(library,part,start,end-start,reader,controller.signal);
    controller.signal.throwIfAborted();const latest=store.get(active(request),id).parts.find(p=>p.id===part.id);
    if(!latest||transcriptKey(latest,reader.model)!==key)throw new AuthError(409,'BOOK_CONFLICT','This book part changed. Reopen its transcript.');
    saveTranscript(auth,user,id,part.id,key,start,lines);
    return {status:'ready',provider:'Whisper',partId:part.id,start,end,lines};
   }finally{clearInterval(recheck);request.raw.off('aborted',abort);reply.raw.off('close',abort);request.raw.socket.setTimeout?.(socketTimeout??30000);running.delete(controller);release();}
  });
  routes.post(`${prefix}/:id/chapter-titles`,{bodyLimit:128*1024},async request=>{
   const {id}=request.params as {id:string},body=request.body as Record<string,unknown>;
   if(!validId(id)||Object.keys(body).some(k=>!['revision','titles'].includes(k)))throw invalid();
   return {book:store.mutate(active(request),id,'chapter-titles',body)};
  });
  routes.post(`${prefix}/:id/append`,async request=>{
   const {id}=request.params as {id:string},body=request.body as Record<string,unknown>;
   if(!validId(id)||!validId(body.albumId)||Object.keys(body).some(k=>!['albumId','revision'].includes(k)))throw invalid();
   store.get(active(request),id);const album=await sourceAlbum(body.albumId);
   return {book:store.append(active(request),id,body.revision,album)};
  });
  routes.post(`${prefix}/:id/:action`,async request=>{const {id,action}=request.params as {id:string;action:string};if(!validId(id))throw invalid();const body=request.body as Record<string,unknown>,keys:Record<string,string[]>={'offline-sync':['partId','position','speed','status','bookmarks'],progress:['partId','position'],metadata:['title','author','narrator','series','description'],speed:['speed'],status:['status'],bookmark:['partId','position','note'],'bookmark-edit':['bookmarkId','note'],'bookmark-delete':['bookmarkId'],chapter:['partId','position','title'],'chapter-delete':['chapterId'],'move-part':['partId','direction'],delete:[]};
   if(!Object.hasOwn(keys,action)||Object.keys(body).some(k=>k!=='revision'&&!keys[action]!.includes(k)))throw invalid();
   return {book:store.mutate(active(request),id,action,body)};});
 });
}
