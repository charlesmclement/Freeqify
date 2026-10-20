import type { FastifyInstance, FastifyRequest } from 'fastify';
import { COLLECTION_LIMIT, PERSONAL_PAGE_SIZE, BULK_LIMIT, type PersonalTrack, type Track } from '@freeqify/shared';
import type { AuthStore } from './auth/store.js';
import {Admission} from './resources.js';
import { AuthError } from './auth/password.js';
import type { Config } from './config.js';
import { LibraryError, validId, type MusicLibrary } from './integrations/navidrome.js';
import { PersonalStore, type SavedTrack } from './personal-store.js';
const invalid = () => new AuthError(400,'INVALID_INPUT','Invalid personal library request.');
export function registerPersonalRoutes(app: FastifyInstance, prefix: string, auth: AuthStore, library: MusicLibrary, config: Config) {
  const store = new PersonalStore(auth);
  const queueSaves=new Admission(1,1);
  app.register(async routes => {
    routes.addHook('onRequest', async (request,reply) => {
      reply.header('Cache-Control','no-store');
      if (!request.authSession?.user) throw new AuthError(401,'UNAUTHENTICATED','Sign in to continue.');
    });
    routes.addHook('preHandler', async request => {
      if (['GET','HEAD'].includes(request.method)) return;
      if (request.headers.origin !== (config.proxy?.origin ?? `${config.auth.secureCookies ? 'https' : 'http'}://${request.headers.host}`) || !auth.csrf(request.authSession,request.headers['x-csrf-token'])) throw new AuthError(403,'CSRF_REJECTED','Your request could not be verified. Refresh and try again.');
      if (!request.headers['content-type']?.startsWith('application/json') || !request.body || typeof request.body !== 'object' || Array.isArray(request.body)) throw invalid();
    });
    function activeSession(request: FastifyRequest) {
      const session=auth.session(request.authSession?.token,false);
      if(!session?.user)throw new AuthError(401,'UNAUTHENTICATED','Sign in to continue.');
      return session.user.id;
    }
    routes.addHook('preSerialization',async(request,reply,payload)=>{
      try{activeSession(request);return payload;}catch{reply.code(401);return {error:{code:'UNAUTHENTICATED',message:'Sign in to continue.'}};}
    });
    routes.setErrorHandler((error,_request,reply) => {
      if (error instanceof AuthError) return reply.header('Retry-After',error.status===429||error.status===503?'5':'0').code(error.status).send({ error: { code: error.code, message: error.message } });
      if (error instanceof LibraryError) return reply.code(error.code === 'NOT_FOUND' ? 404 : 502).send({ error: { code: error.code, message: error.message } });
      return reply.code(500).send({ error: { code: 'PERSONAL_UNAVAILABLE', message: 'Your personal library could not be updated.' } });
    });
    function item(params: unknown, key = 'id') { const id = (params as Record<string,unknown>)[key]; if (!validId(id)) throw invalid(); return id; }
    function reference(body: Record<string,unknown>) { if (body.source !== 'local' || !validId(body.trackId)) throw invalid(); return body.trackId; }
    async function resolve(rows: SavedTrack[]): Promise<PersonalTrack[]> {
      const result: PersonalTrack[] = []; let index = 0; let outage=false;
      const cached = new Map<string,Promise<{ track: Track; available: boolean | null }>>();
      await Promise.all(Array.from({length: Math.min(4,rows.length)},async () => {
        while (index < rows.length) {
          const i = index++; const row = rows[i]!;
          if(outage&&!cached.has(row.track_id)){result[i]={id:row.id,source:row.source,trackId:row.track_id,track:JSON.parse(row.metadata) as Track,available:null,...(row.played_at!==undefined?{playedAt:Number(row.played_at),position:Number(row.position)}:{})};continue;}
          if (!cached.has(row.track_id)) cached.set(row.track_id, library.track(row.track_id).then(track => ({track,available:true})).catch(error => {const missing=error instanceof LibraryError&&error.code==='NOT_FOUND';if(!missing)outage=true;return {track:JSON.parse(row.metadata) as Track,available:missing?false:null};}));
          const live = await cached.get(row.track_id)!;
          result[i] = { id: row.id, source: row.source, trackId: row.track_id, ...live, ...(row.played_at !== undefined ? { playedAt: Number(row.played_at), position: Number(row.position) } : {}) };
        }
      })); return result;
    }
    async function catalogOrSaved(user: string, id: string): Promise<Track> {
      try { return await library.track(id); } catch(error) {
        if(error instanceof LibraryError && ['NOT_FOUND','UNAVAILABLE'].includes(error.code)) { const saved=store.saved(user,id);if(saved)return saved; }
        throw error;
      }
    }
    const summary = (user: string) => ({ playlists: store.playlists(user), favoriteIds: store.favoriteIds(user), generation: store.generation(user) });
    routes.get('/summary', async request => summary(request.authSession!.user!.id));
    routes.get('/playlists', async request => ({items:store.playlists(request.authSession!.user!.id)}));
    routes.post('/playlists', async request => ({id:store.create(request.authSession!.user!.id,(request.body as Record<string,unknown>).name)}));
    // Snapshot supplied as ordered public references; metadata and ownership stay server-derived.
    routes.post('/playlists/from-queue',{bodyLimit:2*1024*1024},async(request,reply)=>{
      const body=request.body as Record<string,unknown>;
      if(typeof body.name!=='string'||!body.name.trim()||body.name.trim().length>100||Array.from(body.name).some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127)||!Array.isArray(body.tracks)||!body.tracks.length||body.tracks.length>COLLECTION_LIMIT)throw invalid();
      const ids=body.tracks.map(value=>{if(!value||typeof value!=='object'||Array.isArray(value))throw invalid();return reference(value as Record<string,unknown>);});
      const user=request.authSession!.user!.id,unique=[...new Set(ids)],resolved=new Map<string,Track>();
      const release=queueSaves.acquire(user);
      try{
        const deadline=Date.now()+config.resources.catalogTimeoutMs;let index=0;let failure:unknown;
        await Promise.all(Array.from({length:Math.min(4,unique.length)},async()=>{
          while(index<unique.length&&!failure){
            try{
              if(request.raw.aborted||reply.raw.destroyed||Date.now()>deadline)throw new AuthError(503,'QUEUE_SAVE_UNAVAILABLE','Queue could not be saved in time. Your queue is unchanged; try again.');
              const id=unique[index++]!;resolved.set(id,await catalogOrSaved(user,id));
            }catch(error){failure=error;}
          }
        }));
        if(failure)throw failure;
        activeSession(request);
        if(reply.raw.destroyed||Date.now()>deadline)throw new AuthError(503,'QUEUE_SAVE_UNAVAILABLE','Queue could not be saved in time. Your queue is unchanged; try again.');
        return {id:store.createFromTracks(user,body.name,ids.map(id=>resolved.get(id)!))};
      }finally{release();}
    });
    function page(request:FastifyRequest) {
      const q=request.query as Record<string,unknown>;
      const integer=(value:unknown,fallback:number,max:number)=>{if(value===undefined)return fallback;if(typeof value!=='string'||!/^\d{1,7}$/.test(value)||Number(value)>max)throw invalid();return Number(value);};
      const limit=integer(q.limit,PERSONAL_PAGE_SIZE,100);if(!limit)throw invalid();return {limit,offset:integer(q.offset,0,COLLECTION_LIMIT)};
    }
    routes.get('/playlists/:id', async request => {
      const user=request.authSession!.user!.id;const id=item(request.params);const {limit,offset}=page(request);const rows=store.entries(user,id,offset,limit+1);
      return {playlist:store.playlists(user,id)[0]!,items:await resolve(rows.slice(0,limit)),nextOffset:rows.length>limit?offset+limit:null};
    });
    // Queue snapshots contain only ordered references, never 5,000 metadata objects.
    routes.get('/playlists/:id/queue',async request=>({items:store.references(request.authSession!.user!.id,item(request.params))}));
    routes.get('/favorites/queue',async request=>({items:store.references(request.authSession!.user!.id)}));
    routes.post('/playlists/:id/move',async request=>{const b=request.body as Record<string,unknown>;if(!validId(b.entryId))throw invalid();store.move(request.authSession!.user!.id,item(request.params),b.entryId,b.direction as number,b.revision);return {ok:true};});
    async function batch(request:FastifyRequest) {
      const b=request.body as Record<string,unknown>;if(!Array.isArray(b.tracks)||!b.tracks.length||b.tracks.length>BULK_LIMIT)throw invalid();
      const ids=b.tracks.map(t=>{if(!t||typeof t!=='object'||Array.isArray(t))throw invalid();return reference(t as Record<string,unknown>);});
      const user=request.authSession!.user!.id;const tracks=new Map<string,Track>();const unique=[...new Set(ids)];let index=0;
      await Promise.all(Array.from({length:Math.min(4,unique.length)},async()=>{while(index<unique.length){const id=unique[index++]!;if(!tracks.has(id))tracks.set(id,await catalogOrSaved(user,id));}}));
      activeSession(request);return ids.map(id=>tracks.get(id)!);
    }
    routes.post('/playlists/:id/bulk', {bodyLimit:64*1024},async request=>{const user=request.authSession!.user!.id;const id=item(request.params);store.entries(user,id,0,1);return {ids:store.addMany(user,id,await batch(request))};});
    routes.post('/favorites/bulk',{bodyLimit:64*1024},async request=>{store.favoriteMany(request.authSession!.user!.id,await batch(request));return {ok:true};});
    routes.post('/playlists/:id/rename', async request => { store.rename(request.authSession!.user!.id,item(request.params),(request.body as Record<string,unknown>).name); return {ok:true}; });
    routes.post('/playlists/:id/delete', async request => { store.delete(request.authSession!.user!.id,item(request.params)); return {ok:true}; });
    routes.post('/playlists/:id/tracks', async request => {
      const user = request.authSession!.user!.id; const id = item(request.params); store.entries(user,id,0,1);
      const track = await catalogOrSaved(user,reference(request.body as Record<string,unknown>));
      activeSession(request);return {id:store.add(user,id,track)};
    });
    routes.post('/playlists/:id/remove', async request => { const body = request.body as Record<string,unknown>; if (!validId(body.entryId)) throw invalid(); store.remove(request.authSession!.user!.id,item(request.params),body.entryId); return {ok:true}; });
    routes.post('/playlists/:id/reorder', {bodyLimit:512*1024}, async request => { const body = request.body as Record<string,unknown>; store.reorder(request.authSession!.user!.id,item(request.params),body.entries,body.revision); return {ok:true}; });
    routes.get('/favorites', async request => {const {limit,offset}=page(request);const rows=store.favorites(request.authSession!.user!.id,offset,limit+1);return {items:await resolve(rows.slice(0,limit)),nextOffset:rows.length>limit?offset+limit:null};});
    routes.post('/favorites', async request => {
      const user = request.authSession!.user!.id; const body = request.body as Record<string,unknown>; const id = reference(body);
      if (typeof body.enabled !== 'boolean') throw invalid();
      if (!body.enabled) store.unfavorite(user,id); else {const track=await catalogOrSaved(user,id);activeSession(request);store.favorite(user,track,true);}
      return {ok:true};
    });
    routes.get('/history', async request => {
      const query = request.query as Record<string,unknown>;
      const number = (value: unknown, fallback: number, max: number) => { if (value === undefined) return fallback; if (typeof value !== 'string' || !/^\d{1,7}$/.test(value) || Number(value)>max) throw invalid(); return Number(value); };
      const limit = number(query.limit,48,100); const offset = number(query.offset,0,1000); if (!limit) throw invalid();
      const rows = store.history(request.authSession!.user!.id,offset,limit+1); return {items:await resolve(rows.slice(0,limit)),nextOffset:rows.length>limit ? offset+limit : null};
    });
    routes.post('/history', async request => {
      const user = request.authSession!.user!.id; const body = request.body as Record<string,unknown>; const id = reference(body);
      if (!validId(body.eventId) || ![body.listened,body.position].every(n=>typeof n==='number' && Number.isFinite(n) && n>=0 && n<=604800) || !Number.isSafeInteger(body.generation) || Number(body.generation)<0) throw invalid();
      const track = await library.track(id);
      activeSession(request);store.record(user,track,{eventId:body.eventId,listened:body.listened as number,position:body.position as number,generation:body.generation as number}); return {ok:true};
    });
    routes.post('/history/clear', async request => ({generation:store.clearHistory(request.authSession!.user!.id)}));
  },{prefix});
}
