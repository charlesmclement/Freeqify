import {spawn} from 'node:child_process';
import {Readable} from 'node:stream';
import type {FastifyInstance} from 'fastify';
import type {AuthStore} from './auth/store.js';
import {AuthError} from './auth/password.js';
import {LibraryError,validId,type MusicLibrary} from './integrations/navidrome.js';
import type {Admission} from './resources.js';
const audioTypes=new Set(['audio/mpeg','audio/mp3','audio/wav','audio/wave','audio/x-wav','audio/flac','audio/x-flac','audio/ogg','application/ogg','audio/mp4','audio/aac','audio/webm']);
/** Device downloads only: raw upstream -> bounded pipes -> optional MP3 encoder -> response.
 * No temporary files, server download archive, or Navidrome transcoding request/cache.
 */
export function registerDownloadRoutes(app:FastifyInstance,prefix:string,library:MusicLibrary,store:AuthStore,available:(id:string)=>boolean,streams:Admission,transcodes:Admission,ffmpeg:string,recheckMs:number){
 const active=new Set<()=>void>();
 app.addHook('preClose',async()=>{for(const stop of active)stop();});
 app.get(`${prefix}/download/:id`,async(request,reply)=>{
  reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff');
  if(request.method!=='GET')return reply.code(405).send({error:'Use GET for downloads'});
  const session=request.authSession;
  if(!session?.user)return reply.code(401).send({error:{code:'UNAUTHENTICATED',message:'Sign in to download music.'}});
  const id=(request.params as {id:string}).id;
  if(!validId(id)||Object.keys(request.query as object).length||request.headers.range)return reply.code(400).send({error:'Invalid download request'});
  if(!available(id))return reply.code(404).send({error:'Music unavailable'});
  let releaseStream:(()=>void)|undefined,releaseTranscode:(()=>void)|undefined;
  const controller=new AbortController();let upstream:Readable|undefined;let output:Readable|undefined;let encoder:ReturnType<typeof spawn>|undefined;let killTimer:ReturnType<typeof setTimeout>|undefined;
  const cancel=()=>{controller.abort();upstream?.destroy();output?.destroy();if(encoder&&encoder.exitCode===null){encoder.kill('SIGTERM');killTimer=setTimeout(()=>encoder?.kill('SIGKILL'),2000);killTimer.unref();}};
  let idle:ReturnType<typeof setTimeout>;const touch=()=>{clearTimeout(idle);idle=setTimeout(()=>{cancel();reply.raw.destroy();},30000);idle.unref();};
  const authorization=setInterval(()=>{try{if(store.session(session.token,false)?.user&&available(id))return;}catch{/* Fail closed. */}cancel();reply.raw.destroy();},recheckMs);authorization.unref();
  const cleanup=()=>{clearTimeout(idle);clearInterval(authorization);releaseStream?.();releaseTranscode?.();releaseStream=undefined;releaseTranscode=undefined;active.delete(stop);request.raw.off('aborted',stop);reply.raw.off('close',stop);};
  const stop=()=>{cancel();cleanup();};active.add(stop);request.raw.on('aborted',stop);reply.raw.on('close',stop);touch();
  try{
   releaseStream=streams.acquire(session.user.id);
   if(!library.stream)throw new LibraryError('UNAVAILABLE');
   // Download only an existing catalog ID. No paths, user URLs or FFmpeg arguments accepted.
   const track=await library.track(id);const raw=await library.stream(id,'raw',undefined,controller.signal);
   if(raw.status!==200||!raw.body){await raw.body?.cancel();throw new Error('Upstream music unavailable');}
   const type=raw.headers.get('content-type')?.split(';')[0]?.toLowerCase()??'';
   if(!audioTypes.has(type)){await raw.body.cancel();throw new Error('Unsupported upstream audio');}
   let received=0;let inputFailed=false;const expected=raw.headers.get('content-length');
   upstream=Readable.fromWeb(raw.body as Parameters<typeof Readable.fromWeb>[0]);upstream.on('data',(bytes:Buffer)=>{received+=bytes.length;touch();});upstream.pause();
   reply.type('audio/mpeg').header('Content-Disposition',`attachment; filename="freeqify-${id.slice(0,64)}.mp3"`);
   if(type==='audio/mpeg'||type==='audio/mp3'){
    const length=raw.headers.get('content-length');if(length&&/^\d+$/.test(length))reply.header('Content-Length',length);
    upstream.once('end',cleanup);upstream.once('error',stop);return reply.send(upstream);
   }
   releaseTranscode=transcodes.acquire(session.user.id);
   const metadata=['title','artist','album','track'].flatMap(key=>{const value=key==='track'?track.trackNumber:track[key as 'title'|'artist'|'album'];return value==null?[]:['-metadata',`${key}=${String(value).slice(0,1000)}`];});
   encoder=spawn(ffmpeg,['-nostdin','-hide_banner','-loglevel','error','-max_alloc','67108864','-filter_threads','1','-threads','1','-protocol_whitelist','pipe','-probesize','1048576','-analyzeduration','1000000','-i','pipe:0','-map','0:a:0','-vn','-map_metadata','-1',...metadata,'-c:a','libmp3lame','-b:a','320k','-threads','1','-id3v2_version','3','-f','mp3','pipe:1'],{stdio:['pipe','pipe','ignore'],shell:false});
   const child=encoder;
   const result=new Promise<boolean>(resolve=>{child.once('error',()=>resolve(false));child.once('close',code=>{clearTimeout(killTimer);resolve(code===0);});});
   child.stdin!.on('error',()=>{/* stdout/result propagate failed conversion. */});
   await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',()=>reject(new Error('MP3 encoder unavailable')));});
   upstream.once('error',()=>{inputFailed=true;child.kill('SIGTERM');});upstream.pipe(child.stdin!);
   // HTTP completion is conditional on successful conversion; truncated output is never complete.
   output=Readable.from((async function*(){let success=false;try{for await(const bytes of child.stdout!){touch();yield bytes;}if(!await result||controller.signal.aborted||inputFailed||!upstream?.readableEnded||(expected&&/^\d+$/.test(expected)&&received!==Number(expected)))throw new Error('MP3 conversion interrupted');success=true;}finally{if(success){controller.abort();upstream?.destroy();cleanup();}else stop();}})());
   return reply.send(output);
  }catch(error){stop();if(reply.raw.destroyed)return;reply.removeHeader('Content-Disposition');reply.type('application/json');if(error instanceof AuthError)return reply.header('Retry-After','5').code(error.status).send({error:{code:error.code,message:error.message}});return reply.code(error instanceof LibraryError&&error.code==='NOT_FOUND'?404:502).send({error:'MP3 download unavailable. Check server encoder support and retry.'});}
 });
}
