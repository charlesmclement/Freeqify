import type {FastifyInstance} from 'fastify';
import type {AuthStore} from './auth/store.js';
import {AuthError} from './auth/password.js';
import type {Config} from './config.js';
import {LibraryError,validId,type MusicLibrary} from './integrations/navidrome.js';
import type {LibraryRemovals} from './library-removals.js';
import {LrclibLyrics,type LyricsProvider} from './lyrics.js';

export function registerLyricsRoutes(app:FastifyInstance,prefix:string,config:Config,auth:AuthStore,library:MusicLibrary,removals:LibraryRemovals,provider:LyricsProvider=new LrclibLyrics()){
 app.get(`${prefix}/tracks/:id/lyrics`,async(request,reply)=>{
  reply.header('Cache-Control','no-store');
  const session=request.authSession;
  if(!session?.user)return reply.code(401).send({error:{code:'UNAUTHENTICATED',message:'Sign in to continue.'}});
  const id=(request.params as {id:string}).id;
  if(!validId(id)||Object.keys(request.query as object).length)return reply.code(400).send({error:{code:'INVALID_REQUEST',message:'Invalid lyrics request.'}});
  if(!config.lyricsEnabled)return {status:'disabled'};
  const controller=new AbortController();const cancel=()=>controller.abort();
  request.raw.once('aborted',cancel);reply.raw.once('close',cancel);
  try{
   auth.limit(`lyrics:${session.user.id}`,20,60000);
   const track=await library.track(id);
   const result=await provider.lookup(track,controller.signal);
   if(!auth.session(session.token,false)?.user)return reply.code(401).send({error:{code:'UNAUTHENTICATED',message:'Sign in to continue.'}});
   if(removals.blocksTrack(track))return reply.code(404).send({error:{code:'NOT_FOUND',message:'This song is unavailable.'}});
   return result;
  }catch(error){
   if(error instanceof AuthError)return reply.header('Retry-After','5').code(error.status).send({error:{code:error.code,message:error.message}});
   if(error instanceof LibraryError&&error.code==='NOT_FOUND')return reply.code(404).send({error:{code:'NOT_FOUND',message:'This song is unavailable.'}});
   return {status:'unavailable'};
  }finally{request.raw.off('aborted',cancel);reply.raw.off('close',cancel);}
 });
}
