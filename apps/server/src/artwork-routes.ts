/** Account-scoped album artwork: original Navidrome image wins unless user overrides it. */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomInt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AuthError } from './auth/password.js';
import type { AuthStore } from './auth/store.js';
import type { Config } from './config.js';
import { projectRoot } from './config.js';
import { LibraryError, validId, type MusicLibrary } from './integrations/navidrome.js';
import { artworkName, reviewedArtwork } from './review-artwork.js';
import { OnlineAlbumArtwork } from './online-artwork.js';
import {registerSharedArtwork,sharedCover,type CoverSearchProvider} from './shared-artwork.js';

export const presetCovers = [
  'generic_01_sunset_ridge.jpg',
  'generic_02_smoke_portrait.jpg',
  'generic_03_shoreline_tide.jpg',
  'generic_04_neon_halo.jpg',
  'generic_05_lunar_eclipse.jpg',
  'generic_06_morning_leaves.jpg',
  'generic_07_vinyl_warmth.jpg',
  'generic_08_iridescent_silk.jpg',
  'generic_09_rainy_metropolis.jpg',
  'generic_10_peach_clouds.jpg',
  'generic_11_moonlit_doorway.jpg',
  'generic_12_dune_waves.jpg',
  'generic_13_night_garden.jpg',
  'generic_14_alpine_light.jpg',
  'generic_15_deep_water.jpg',
  'generic_16_cosmic_bloom.jpg',
  'generic_17_prism_orb.jpg',
] as const;
type ArtworkMode = 'fallback'|'selected'|'custom'|'none';
type Row = { mode: ArtworkMode; cover_key: string|null; content_type: string|null; image: Uint8Array|null };
const maxArtworkBytes=1024*1024; // 1 MiB custom image limit, per album and user
function fail() { return new AuthError(400,'INVALID_INPUT','Invalid artwork request.'); }
const neutralCovers = presetCovers.filter(name => name.startsWith('generic_'));
function chooseCover() { return neutralCovers[randomInt(neutralCovers.length)]!; }
function png(bytes: Buffer) { return bytes.length>8 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])); }
function jpg(bytes: Buffer) { return bytes.length>3 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255; }
function webp(bytes: Buffer) { return bytes.length>12 && bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP'; }
function validatedImage(input: unknown) {
  if (!input || typeof input!=='object' || Array.isArray(input)) throw fail();
  const {contentType, base64}=input as Record<string,unknown>;
  if(typeof base64!=='string' || base64.length>Math.ceil(maxArtworkBytes*4/3)+8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw fail();
  const bytes=Buffer.from(base64,'base64');
  if(bytes.length<32 || bytes.length>maxArtworkBytes || bytes.toString('base64')!==base64) throw fail();
  if (!((contentType==='image/png'&&png(bytes))||(contentType==='image/jpeg'&&jpg(bytes))||(contentType==='image/webp'&&webp(bytes)))) throw fail();
  return {bytes,contentType};
}
export function registerArtworkRoutes(app:FastifyInstance,prefix:string,library:MusicLibrary,auth:AuthStore,config:Config, onlineArtwork?: Pick<OnlineAlbumArtwork, 'lookup'> & Partial<CoverSearchProvider>){
  const online = onlineArtwork ?? (config.musicbrainz.contact
    ? new OnlineAlbumArtwork({contact: config.musicbrainz.contact})
    : null);
  const find=auth.db.prepare('SELECT mode,cover_key,content_type,image FROM album_artwork_choices WHERE user_id=? AND album_id=?');
  const upsert=auth.db.prepare(`INSERT INTO album_artwork_choices(user_id,album_id,mode,cover_key,content_type,image) VALUES(?,?,?,?,?,?)
    ON CONFLICT(user_id,album_id) DO UPDATE SET mode=excluded.mode,cover_key=excluded.cover_key,content_type=excluded.content_type,image=excluded.image`);
  const remove=auth.db.prepare('DELETE FROM album_artwork_choices WHERE user_id=? AND album_id=?');
  const row=(user:string,id:string)=>find.get(user,id) as Row|undefined;
  function save(user:string,id:string,mode:ArtworkMode,key:string|null=null,type:string|null=null,bytes:Buffer|null=null){
    auth.db.exec('BEGIN IMMEDIATE');
    try {const before=auth.storageUsage(user);upsert.run(user,id,mode,key,type,bytes);auth.checkStorage(user,before);auth.db.exec('COMMIT');}
    catch(error){auth.db.exec('ROLLBACK');throw error;}
  }
  async function preset(name:string) {
    if(!presetCovers.includes(name as typeof presetCovers[number]))throw fail();
    // Production assets ship inside Vite's dist; dev assets live inside its public dir.
    try{return await readFile(join(config.webDistDir,'freeqify-covers',name));}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
      return await readFile(join(projectRoot,'apps/web/public/freeqify-covers',name));}
  }
  const id=(request:FastifyRequest)=>{
    const value=(request.params as Record<string,unknown>).id;
    if(!validId(value))throw fail();return value;
  };
  const user=(request:FastifyRequest)=>{
    const account=auth.session(request.authSession?.token,false)?.user;
    if(!account)throw new AuthError(401,'UNAUTHENTICATED','Sign in to continue.');return account.id;
  };
  const body=(request:FastifyRequest)=>{
    if(!request.body || typeof request.body!=='object' || Array.isArray(request.body))throw fail();return request.body as Record<string,unknown>;
  };
  app.register(async routes=>{
    routes.addHook('onRequest',async(request,reply)=>{
      reply.header('Cache-Control','no-store');
      if(!request.authSession?.user)return reply.code(401).send({error:{code:'UNAUTHENTICATED',message:'Sign in to continue.'}});
    });
    routes.addHook('preHandler',async request=>{
      if(request.method==='GET'||request.method==='HEAD')return;
      const expected=config.proxy?.origin??`${config.auth.secureCookies?'https':'http'}://${request.headers.host}`;
      if(request.headers.origin!==expected || !auth.csrf(request.authSession,request.headers['x-csrf-token']))
        throw new AuthError(403,'CSRF_REJECTED','Your request could not be verified. Refresh and try again.');
      if(!request.headers['content-type']?.startsWith('application/json'))throw fail();
    });
    routes.setErrorHandler((error,_request,reply)=>{
      if(error instanceof AuthError)return reply.code(error.status).send({error:{code:error.code,message:error.message}});
      if(error instanceof LibraryError){const status=error.code==='NOT_FOUND'?404:error.code==='INVALID_REQUEST'?400:502;
        return reply.code(status).send({error:{code:error.code,message:error.message}});}
      return reply.code(503).send({error:{code:'ARTWORK_UNAVAILABLE',message:'Album artwork is temporarily unavailable.'}});
    });
    registerSharedArtwork(routes,auth,library,online?.search && online?.candidateCover ? online as CoverSearchProvider : null);
    routes.get('/artwork/album/:id/choice',async request=>{
      const uid=user(request),albumId=id(request),choice=row(uid,albumId),shared=sharedCover(auth,albumId);return {mode:shared?'custom':choice?.mode??'auto',coverKey:shared?null:choice?.cover_key??null,shared:!!shared};
    });
    routes.get('/artwork/album/:id',async(request,reply)=>{
      const uid=user(request),albumId=id(request),choice=row(uid,albumId);
      // A manual change made while upstream IO is pending must win that response too.
      const manual=async()=>{
        user(request);
        const shared=sharedCover(auth,albumId);
        if(shared){reply.type(shared.content_type).send(Buffer.from(shared.image));return true;}
        const current=row(uid,albumId);
        if(current?.mode==='none'){reply.code(204).send();return true;}
        if(current?.mode==='custom'){reply.type(current.content_type!).send(Buffer.from(current.image!));return true;}
        if(current?.mode==='selected'){reply.type('image/jpeg').send(await preset(current.cover_key!));return true;}
        return false;
      };
      const shared=sharedCover(auth,albumId);
      if(shared)return reply.type(shared.content_type).send(Buffer.from(shared.image));
      if(choice?.mode==='none')return reply.code(204).send();
      if(choice?.mode==='custom')return reply.type(choice.content_type!).send(Buffer.from(choice.image!));
      if(choice?.mode==='selected')return reply.type('image/jpeg').send(await preset(choice.cover_key!));
      // An automatic fallback never masks genuine album or track artwork.
      const detail=await library.album(albumId);
      // Exclude Navidrome disc artwork (dc-*): use album/file covers or verified online art.
      const candidates=[detail.album.artworkId,...detail.tracks.map(t=>t.artworkId)].filter((v):v is string=>typeof v==='string' && !v.startsWith('dc-'));
      for(const artworkId of new Set(candidates)){
        try{const original=await library.artwork(artworkId);if(await manual())return reply;return reply.type(original.contentType).send(original.bytes);}
        catch(error){if(error instanceof LibraryError&&error.code==='NOT_FOUND')continue;throw error;}
      }
      const cached=auth.db.prepare('SELECT artist,title,content_type,image FROM album_online_artwork WHERE user_id=? AND album_id=?').get(uid,albumId);
      if(cached && cached.artist===artworkName(detail.album.artist) && cached.title===artworkName(detail.album.title)){
        if(await manual())return reply;
        return reply.type(String(cached.content_type)).send(Buffer.from(cached.image as Uint8Array));
      }
      const persist=async(artwork:{contentType:string;bytes:Buffer})=>{
        if(await manual())return reply;
        auth.db.exec('BEGIN IMMEDIATE');
        try{const before=auth.storageUsage(uid);
          auth.db.prepare(`INSERT INTO album_online_artwork VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,album_id) DO UPDATE SET artist=excluded.artist,title=excluded.title,content_type=excluded.content_type,image=excluded.image`)
            .run(uid,albumId,artworkName(detail.album.artist),artworkName(detail.album.title),artwork.contentType,artwork.bytes);
          auth.checkStorage(uid,before);auth.db.exec('COMMIT');
        }catch(error){auth.db.exec('ROLLBACK');throw error;}
        return reply.type(artwork.contentType).send(artwork.bytes);
      };
      const reviewed=await reviewedArtwork(config.musicbrainz.reviewDir,detail.album.artist,detail.album.title);
      if(reviewed)return persist(reviewed);
      if (online) {
        const result = await online.lookup(detail.album.artist, detail.album.title);
        user(request);

        if (result.kind === 'found') {
          return persist(result.artwork);
        }
      }

      if(await manual())return reply; // Recheck explicit choices after upstream IO.
      // Neutral assignments are retryable: they never mask later genuine artwork.
      const key=choice?.mode==='fallback' && neutralCovers.includes(choice.cover_key as typeof neutralCovers[number])?choice.cover_key!:chooseCover();
      if(choice?.mode==='fallback' && choice.cover_key!==key)save(uid,albumId,'fallback',key);
      if(!choice){
        auth.db.exec('BEGIN IMMEDIATE');
        try{const before=auth.storageUsage(uid);
          auth.db.prepare(`INSERT OR IGNORE INTO album_artwork_choices(user_id,album_id,mode,cover_key) VALUES(?,?,'fallback',?)`).run(uid,albumId,key);
          auth.checkStorage(uid,before);auth.db.exec('COMMIT');}
        catch(error){auth.db.exec('ROLLBACK');throw error;}
      }
      const saved=row(uid,albumId);
      return reply.type('image/jpeg').send(await preset(saved?.cover_key??key));
    });
    routes.post('/artwork/album/:id/choice',{bodyLimit:10000},async request=>{
      const uid=user(request),albumId=id(request),value=body(request);
      await library.album(albumId);user(request); // Never create preferences for nonexistent albums or revoked sessions.
      if(value.mode==='none')save(uid,albumId,'none');
      else if(value.mode==='selected'&&typeof value.coverKey==='string'&&presetCovers.includes(value.coverKey as typeof presetCovers[number]))save(uid,albumId,'selected',value.coverKey);
      else if(value.mode==='auto'){
        auth.db.exec('BEGIN IMMEDIATE');try{remove.run(uid,albumId);auth.db.exec('COMMIT');}catch(error){auth.db.exec('ROLLBACK');throw error;}
      }
      else if(value.mode==='reroll')save(uid,albumId,'fallback',chooseCover());
      else throw fail();
      return {ok:true};
    });
    routes.post('/artwork/album/:id/upload',{bodyLimit:1500000},async request=>{
      const uid=user(request),albumId=id(request);
      const image=validatedImage(body(request));await library.album(albumId);user(request);
      save(uid,albumId,'custom',null,image.contentType,image.bytes);return {ok:true};
    });
  },{prefix});
}
