import type {LibraryRemovals} from './library-removals.js';
import type { AlbumSort } from '@freeqify/shared';
import type {AuthStore} from './auth/store.js';
import type {Config} from './config.js';
import {AuthError} from './auth/password.js';
import type { FastifyInstance } from 'fastify';
import { LibraryError, validId, validArtworkId, type MusicLibrary } from './integrations/navidrome.js';

export function registerLibraryRoutes(app: FastifyInstance, prefix: string, library: MusicLibrary, auth: AuthStore, config: Config, removals?:LibraryRemovals) {
  app.register(async routes => {
    routes.addHook('onRequest', async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (!request.authSession?.user) return reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } });
    });
    routes.setErrorHandler((error, _request, reply) => {
      if(error instanceof AuthError)return reply.header('Retry-After','5').code(error.status).send({error:{code:error.code,message:error.message}});
      const safe = error instanceof LibraryError ? error : new LibraryError('UNAVAILABLE');
      const status = safe.code === 'INVALID_REQUEST' ? 400 : safe.code === 'NOT_FOUND' ? 404 : safe.code === 'NOT_CONFIGURED' ? 503 : 502;
      return reply.code(status).send({ error: { code: safe.code, message: safe.message } });
    });
    function page(query: unknown) {
      const q = query as Record<string, unknown>;
      const parse = (value: unknown, fallback: number, max: number) => {
        if (value === undefined) return fallback;
        if (typeof value !== 'string' || !/^\d{1,7}$/.test(value) || Number(value) > max) throw new LibraryError('INVALID_REQUEST');
        return Number(value);
      };
      const limit = parse(q.limit, 48, 100);
      if (!limit) throw new LibraryError('INVALID_REQUEST');
      return { offset: parse(q.offset, 0, 1000000), limit };
    }
    function item(params: unknown, artwork = false) {
      const value = (params as Record<string, unknown>).id;
      if (typeof value !== 'string' || !(artwork ? validArtworkId(value) : validId(value))) throw new LibraryError('INVALID_REQUEST');
      return value;
    }
    const admin = (request: import('fastify').FastifyRequest) => {
      const user = auth.session(request.authSession?.token, false)?.user;
      if (!user) throw new AuthError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
      if (user.role !== 'admin') throw new AuthError(403, 'ADMIN_REQUIRED', 'Administrator access is required.');
      return user;
    };
    if(removals){
      function mutation(request:import('fastify').FastifyRequest){
        const user=admin(request);
        if(request.headers.origin!==(config.proxy?.origin??`${config.auth.secureCookies?'https':'http'}://${request.headers.host}`)||!auth.csrf(request.authSession,request.headers['x-csrf-token']))throw new AuthError(403,'CSRF_REJECTED','Refresh before trying again.');
        const body=request.body as Record<string,unknown>|undefined;
        if(!request.headers['content-type']?.startsWith('application/json')||!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['kind','id','confirmed'].includes(key))||body.confirmed!==true||!['track','album'].includes(String(body.kind))||!validId(body.id))throw new LibraryError('INVALID_REQUEST');
        auth.limit(`library:removal:${user.id}`,20,60000);
        return {user,kind:body.kind as 'track'|'album',id:body.id};
      }
      routes.get('/removed',async request=>{admin(request);const p=page(request.query);return removals.page(p.offset,p.limit);});
      routes.post('/remove',{bodyLimit:1024},async request=>{
        const {kind,id}=mutation(request);
        if(removals.has(kind,id))return {ok:true};
        const value=kind==='album'?(await library.album(id)):await library.track(id);
        const user=admin(request); // Recheck after the upstream request.
        if(kind==='album'){
          const detail=value as import('@freeqify/shared').AlbumDetail;
          removals.remove(user.id,{kind,id,title:detail.album.title,artist:detail.album.artist,albumId:id,removedAt:0},detail.tracks.map(t=>t.id));
        }else{
          const track=value as import('@freeqify/shared').Track;
          removals.remove(user.id,{kind,id,title:track.title,artist:track.artist,albumId:track.albumId,removedAt:0});
        }
        return {ok:true};
      });
      routes.post('/removed/restore',{bodyLimit:1024},async request=>{const {user,kind,id}=mutation(request);removals.restore(user.id,kind,id);return {ok:true};});
    }
    routes.get('/scan', async request => {
      admin(request);
      if (!library.scanStatus) throw new LibraryError('NOT_CONFIGURED');
      return library.scanStatus();
    });
    routes.post('/scan', {bodyLimit: 1024}, async request => {
      admin(request);
      if (request.headers.origin !== (config.proxy?.origin ?? `${config.auth.secureCookies ? 'https' : 'http'}://${request.headers.host}`) || !auth.csrf(request.authSession, request.headers['x-csrf-token'])) throw new AuthError(403, 'CSRF_REJECTED', 'Refresh before trying again.');
      if (!request.headers['content-type']?.startsWith('application/json') || !request.body || typeof request.body !== 'object' || Array.isArray(request.body) || Object.keys(request.body).length) throw new LibraryError('INVALID_REQUEST');
      if (!library.startScan || !library.scanStatus) throw new LibraryError('NOT_CONFIGURED');
      auth.limit('library:scan', 1, 60000);
      const status = await library.scanStatus();
      return status.scanning ? status : library.startScan();
    });
    routes.get('/connection', async () => { await library.ping(); return { status: 'connected' }; });
    routes.get('/overview', async () => library.overview());
    routes.get('/artists', async () => ({ items: await library.artists() }));
    routes.get('/artists/:id/tracks', async request => {
      const p = page(request.query); const detail = await library.artist(item(request.params));
      const tracks = []; let seen = 0;
      for (const album of detail.albums) {
        const songs = (await library.album(album.id)).tracks;
        for (const song of songs) { if (seen++ >= p.offset) tracks.push(song); if (tracks.length > p.limit) return {items:tracks.slice(0,p.limit),nextOffset:p.offset+p.limit}; }
      }
      return {items:tracks,nextOffset:null};
    });
    routes.get('/artists/:id', async request => library.artist(item(request.params)));
    routes.get('/albums', async request => { const p = page(request.query); const sort=(request.query as Record<string,unknown>).sort;
      if(sort===undefined)return library.albums(p.offset,p.limit);
      if(typeof sort!=='string'||!['alphabeticalByName','alphabeticalByArtist','newest'].includes(sort))throw new LibraryError('INVALID_REQUEST');
      return library.albums(p.offset,p.limit,sort as AlbumSort); });
    routes.get('/albums/:id', async request => library.album(item(request.params)));
    routes.get('/tracks', async request => { const p = page(request.query); return library.tracks(p.offset, p.limit); });
    routes.get('/tracks/:id', async request => library.track(item(request.params)));
    routes.get('/search', async request => {
      const q = (request.query as Record<string, unknown>).q;
      if (typeof q !== 'string' || !q.trim() || q.length > 200) throw new LibraryError('INVALID_REQUEST');
      const p = page(request.query); return library.search(q.trim(), p.offset, p.limit);
    });
    routes.get('/artwork/:id', async (request, reply) => {
      const art = await library.artwork(item(request.params,true));
      return reply.type(art.contentType).send(art.bytes);
    });
  }, { prefix });
}
