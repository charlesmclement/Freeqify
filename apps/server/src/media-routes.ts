import {registerDownloadRoutes} from './download-routes.js';
import {Admission,defaultResources,type ResourceLimits} from './resources.js';
import {AuthError} from './auth/password.js';
import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import type { AuthStore } from './auth/store.js';
import { LibraryError, validId, type MusicLibrary } from './integrations/navidrome.js';

export function validRange(value: string | undefined) {
  if (value === undefined) return true;
  const match = /^bytes=(\d{1,15})?-(\d{1,15})?$/.exec(value);
  return Boolean(match && (match[1] || match[2]) && (!match[1] || !match[2] || Number(match[1]) <= Number(match[2])) && (match[1] || Number(match[2]) > 0));
}
/** Separate from bounded JSON/artwork requests: never accumulate audio chunks. */
export function registerMediaRoutes(app: FastifyInstance, prefix: string, library: MusicLibrary, store: AuthStore, timeoutMs: number, recheckMs = 1000, limits:ResourceLimits=defaultResources,available:(id:string)=>boolean=()=>true,ffmpeg='ffmpeg') {
  const streams=new Admission(limits.streams,limits.streamsPerUser);
  const transcodes=new Admission(limits.transcodes,limits.transcodes);
  registerDownloadRoutes(app,prefix,library,store,available,streams,transcodes,ffmpeg,recheckMs);
  const active = new Set<() => void>();
  app.addHook('preClose', async () => { for (const terminate of active) terminate(); });
  app.route({ method: ['GET', 'HEAD'], url: `${prefix}/stream/:id`, handler: async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const session = request.authSession;
    if (!session?.user) return reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } });
    const id = (request.params as { id: string }).id;
    const query = request.query as Record<string, unknown>;
    if (!validId(id) || Object.keys(query).some(key => key !== 'format') || (query.format !== undefined && query.format !== 'raw' && query.format !== 'mp3') || !validRange(request.headers.range)) {
      return reply.code(400).send({ error: 'Invalid media request' });
    }
    if(!available(id))return reply.code(404).send({error:'Music stream unavailable'});
    let releaseStream:(()=>void)|undefined;let releaseTranscode:(()=>void)|undefined;
    try{releaseStream=streams.acquire(session.user.id);if(query.format==='mp3')releaseTranscode=transcodes.acquire(session.user.id);}
    catch(error){releaseStream?.();if(error instanceof AuthError)return reply.header('Retry-After','5').code(error.status).send({error:{code:error.code,message:error.message}});throw error;}
    const controller = new AbortController();
    let media: Readable | undefined;
    const cancel = () => { controller.abort(); media?.destroy(); };
    const timer = setTimeout(cancel, timeoutMs);
    // Revalidate without renewing idle expiry: a long media response is not a session keepalive.
    const authorization = setInterval(() => {
      try { if (store.session(session.token, false)?.user&&available(id)) return; } catch { /* Storage failures must fail closed. */ }
      cancel(); reply.raw.destroy();
    }, recheckMs);
    authorization.unref();
    const cleanup = () => { releaseStream?.();releaseTranscode?.(); active.delete(terminate); clearTimeout(timer); clearInterval(authorization); request.raw.off('aborted', cancel); reply.raw.off('close', closed); };
    const terminate = () => { cancel(); reply.raw.destroy(); cleanup(); };
    active.add(terminate);
    const closed = () => { cancel(); cleanup(); };
    request.raw.on('aborted', cancel); reply.raw.on('close', closed);
    try {
      if (!library.stream) throw new LibraryError('UNAVAILABLE');
      const response = await library.stream(id, query.format === 'mp3' ? 'mp3' : 'raw', request.headers.range, controller.signal);
      clearTimeout(timer);
      if (![200, 206, 416].includes(response.status)) {
        await response.body?.cancel();
        const status = response.status === 404 ? 404 : 502;
        cleanup(); return reply.code(status).send({ error: 'Music stream unavailable' });
      }
      const type = response.headers.get('content-type')?.split(';')[0]?.toLowerCase() ?? '';
      if (response.status !== 416 && !['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 'audio/x-wav', 'audio/flac', 'audio/x-flac', 'audio/ogg', 'application/ogg', 'audio/mp4', 'audio/aac', 'audio/webm'].includes(type)) {
        await response.body?.cancel(); cleanup(); return reply.code(502).send({ error: 'Unsupported music response' });
      }
      const contentRange = response.headers.get('content-range');
      if ((response.status === 206 && (!request.headers.range || !contentRange || !/^bytes \d+-\d+\/\d+$/.test(contentRange))) || (contentRange && !/^bytes (?:\d+-\d+|\*)\/\d+$/.test(contentRange))) {
        await response.body?.cancel(); cleanup(); return reply.code(502).send({ error: 'Invalid media range response' });
      }
      reply.code(response.status);
      if (response.status !== 416) reply.type(type);
      for (const name of ['content-length', 'content-range', 'accept-ranges']) {
        const value = response.headers.get(name);
        if ((response.status !== 416 || name !== 'content-length') && value && (name === 'content-length' ? /^\d+$/.test(value) : name === 'accept-ranges' ? /^(bytes|none)$/.test(value) : true)) reply.header(name, value);
      }
      if (request.method === 'HEAD' || response.status === 416) { await response.body?.cancel(); cleanup(); return reply.send(); }
      if (!response.body) throw new Error();
      media = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
      media.once('end', cleanup); media.once('error', cleanup);
      return reply.send(media);
    } catch (error) {
      cancel(); cleanup();
      if (!reply.raw.destroyed) return reply.code(error instanceof LibraryError && error.code === 'NOT_FOUND' ? 404 : 502).send({ error: 'Music stream unavailable' });
    }
  } });
}
