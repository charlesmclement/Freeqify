/** Administrator-selected artwork shared by the catalog, separate from private preferences. */
import {randomUUID} from 'node:crypto';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import type {AuthStore} from './auth/store.js';
import {AuthError} from './auth/password.js';
import {validId, type MusicLibrary, type Artwork} from './integrations/navidrome.js';
import type {ArtworkCandidate, OnlineAlbumArtwork, Outcome} from './online-artwork.js';
import {imageType} from './online-artwork.js';
import {Admission} from './resources.js';

export type CoverSearchProvider = Pick<OnlineAlbumArtwork,'search'|'candidateCover'>;
type SharedCover = {content_type:string; image:Uint8Array; artist:string; title:string};
type Preview = {user:string; album:string; expires:number; candidate:ArtworkCandidate; artwork?:Artwork; pending?:Promise<Outcome>};
const maxPreviews=24, ttl=5*60*1000, maxSharedBytes=100*1024*1024;
const invalid=()=>new AuthError(400,'INVALID_INPUT','Invalid cover search request.');
export function sharedCover(auth:AuthStore,album:string) {
  return auth.db.prepare('SELECT content_type,image,artist,title FROM shared_album_artwork WHERE album_id=?').get(album) as SharedCover|undefined;
}

/** Registered inside artwork's authenticated, CSRF-protected plugin. */
export function registerSharedArtwork(routes:FastifyInstance,auth:AuthStore,library:MusicLibrary,provider:CoverSearchProvider|null) {
  const previews=new Map<string,Preview>();
  const admission=new Admission(2,1);
  routes.addHook('onClose',async()=>{previews.clear();});
  const album=(request:FastifyRequest)=>{
    const id=(request.params as Record<string,unknown>).id;
    if(!validId(id))throw invalid();return id;
  };
  const admin=(request:FastifyRequest)=>{
    const account=auth.session(request.authSession?.token,false)?.user;
    if(!account)throw new AuthError(401,'UNAUTHENTICATED','Sign in to continue.');
    if(account.role!=='admin')throw new AuthError(403,'FORBIDDEN','Only administrators can manage covers for everyone.');
    return account.id;
  };
  const body=(request:FastifyRequest)=>{
    if(!request.body||typeof request.body!=='object'||Array.isArray(request.body))throw invalid();
    return request.body as Record<string,unknown>;
  };
  const prune=()=>{for(const [token,entry] of previews)if(entry.expires<=Date.now())previews.delete(token);};
  const preview=(request:FastifyRequest,token:unknown)=>{
    const user=admin(request);prune();
    const entry=typeof token==='string'?previews.get(token):undefined;
    if(!entry||entry.user!==user||entry.album!==album(request))throw new AuthError(404,'NOT_FOUND','Cover preview expired. Search again.');
    return entry;
  };
  async function load(request:FastifyRequest,entry:Preview) {
    if(entry.artwork)return entry.artwork;
    if(!provider)throw new AuthError(503,'ARTWORK_DISABLED','Online cover search is not configured.');
    if(!entry.pending){
      const release=admission.acquire(admin(request));
      entry.pending=provider.candidateCover(entry.candidate.id).finally(release);
    }
    let result:Outcome;
    try{result=await entry.pending;}finally{delete entry.pending;}
    admin(request);
    if(result.kind!=='found')throw new AuthError(result.kind==='missing'?404:503,'ARTWORK_UNAVAILABLE',result.kind==='missing'?'No cover is available for this result.':'Cover preview is temporarily unavailable. Try again.');
    const art=result.artwork;
    if(art.bytes.length>3*1024*1024||!imageType(art.bytes,art.contentType))throw invalid();
    entry.artwork=art;return art;
  }
  routes.get('/artwork/album/:id/shared',async request=>{
    admin(request);const cover=sharedCover(auth,album(request));
    return {enabled:!!provider,selected:!!cover,artist:cover?.artist??null,title:cover?.title??null};
  });
  routes.post('/artwork/album/:id/cover-search',{bodyLimit:2000},async request=>{
    const user=admin(request),id=album(request),value=body(request);
    if(typeof value.artist!=='string'||typeof value.album!=='string'||!value.album.trim()
      ||value.artist.length>200||value.album.length>200||Object.keys(value).some(key=>key!=='artist'&&key!=='album'))throw invalid();
    if(!provider)throw new AuthError(503,'ARTWORK_DISABLED','Online cover search requires MUSICBRAINZ_CONTACT on the server.');
    auth.limit(`cover-search:${user}`,1,5000);
    const release=admission.acquire(user);
    try{
      await library.album(id);admin(request);
      const result=await provider.search(value.artist.trim(),value.album.trim());admin(request);
      if(result.kind!=='results')throw new AuthError(503,'ARTWORK_UNAVAILABLE','Cover search is temporarily unavailable. Try again.');
      prune();
      // A new search replaces this account's previous previews for this album.
      for(const [token,entry] of previews)if(entry.user===user&&entry.album===id)previews.delete(token);
      const items=result.items.slice(0,6).map(candidate=>{
        while(previews.size>=maxPreviews)previews.delete(previews.keys().next().value!);
        const token=randomUUID();previews.set(token,{user,album:id,expires:Date.now()+ttl,candidate});
        return {token,title:candidate.title,artist:candidate.artist,year:candidate.year};
      });
      return {items};
    }finally{release();}
  });
  routes.get('/artwork/album/:id/cover-preview/:token',async(request,reply)=>{
    const entry=preview(request,(request.params as Record<string,unknown>).token);
    const art=await load(request,entry);admin(request);
    return reply.type(art.contentType).send(art.bytes);
  });
  routes.post('/artwork/album/:id/shared',{bodyLimit:2000},async request=>{
    const uid=admin(request),id=album(request),value=body(request);
    if(value.mode==='remove'&&Object.keys(value).length===1){
      auth.db.prepare('DELETE FROM shared_album_artwork WHERE album_id=?').run(id);return {ok:true};
    }
    if(value.mode!=='select'||Object.keys(value).some(key=>key!=='mode'&&key!=='token'))throw invalid();
    const entry=preview(request,value.token);
    await library.album(id);admin(request);
    const art=await load(request,entry);preview(request,value.token);
    // Keep shared storage bounded, without charging or exposing another user's private data.
    auth.db.exec('BEGIN IMMEDIATE');
    try{
      const before=auth.storageUsage(uid);
      auth.db.prepare(`INSERT INTO shared_album_artwork VALUES(?,?,?,?,?) ON CONFLICT(album_id) DO UPDATE SET
        content_type=excluded.content_type,image=excluded.image,artist=excluded.artist,title=excluded.title`)
        .run(id,art.contentType,art.bytes,entry.candidate.artist,entry.candidate.title);
      const usage=auth.db.prepare('SELECT sum(length(image)) AS bytes,count(*) AS count FROM shared_album_artwork').get()!;
      if(Number(usage.bytes)>maxSharedBytes||Number(usage.count)>5000)throw new AuthError(409,'STORAGE_LIMIT','Shared cover storage is full. Remove an unused shared cover first.');
      auth.checkStorage(uid,before);auth.db.exec('COMMIT');
    }catch(error){auth.db.exec('ROLLBACK');throw error;}
    return {ok:true};
  });
}
