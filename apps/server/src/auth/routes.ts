import { emptyPlayback, validPlayback } from '@freeqify/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AuthError } from './password.js';
import type { AuthStore, Session } from './store.js';
import type { Config } from '../config.js';
declare module 'fastify' { interface FastifyRequest { authSession: Session | null } }
export function sessionCookieName(config: Config) {return config.auth.secureCookies && config.basePath==='/' ? '__Host-freeqify_session' : 'freeqify_session';}
export function sessionCookie(header: string | undefined, cookieName = 'freeqify_session'): string | undefined {
  const values = header?.split(';').map(part => part.trim()).filter(part => part.startsWith(`${cookieName}=`));
  return values?.length === 1 ? values[0]!.slice(cookieName.length + 1) : undefined;
}
function body(request: FastifyRequest): Record<string, unknown> {
  if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) throw new AuthError(400, 'INVALID_INPUT', 'A JSON request body is required.');
  return request.body as Record<string, unknown>;
}
function publicSession(session: Session) { return { user: session.user, csrf: session.csrf, expiresAt: session.expiresAt }; }
export function registerAuthentication(app: FastifyInstance, api: string, config: Config, store: AuthStore) {
  const cookieName=sessionCookieName(config);
  app.decorateRequest('authSession', null);
  const cookie = (reply: FastifyReply, session?: Session) => {
    const seconds = session ? Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000)) : 0;
    reply.header('Set-Cookie', `${cookieName}=${session?.token ?? ''}; Path=${config.basePath}; HttpOnly; SameSite=Lax; Max-Age=${seconds}${config.auth.secureCookies ? '; Secure' : ''}`);
  };
  app.addHook('onRequest', async (request, reply) => {
    // Registered route templates are canonical even if an incoming path is encoded.
    const path = request.routeOptions.url ?? '';
    request.authSession = store.session(sessionCookie(request.headers.cookie,cookieName), path !== `${api}/playback/status`);
    const library = path === `${api}/library` || path.startsWith(`${api}/library/`);
    const admin = path === `${api}/admin` || path.startsWith(`${api}/admin/`);
    if (library || admin || path === `${api}/personal` || path.startsWith(`${api}/personal/`) || (path === `${api}/auth/password` || path === `${api}/auth/me` || path === `${api}/playback` || path === `${api}/playback/status`)) {
      reply.header('Cache-Control', 'no-store');
      if (!request.authSession?.user) return reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } });
      if (admin && request.authSession.user.role !== 'admin') return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Administrator access is required.' } });
    }
  });
  app.register(async routes => {
    routes.addHook('onRequest', async (_request, reply) => { reply.header('Cache-Control', 'no-store'); });
    routes.addHook('preHandler', async (request, reply) => {
      if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
      const expected = (config.proxy?.origin ?? `${config.auth.secureCookies ? 'https' : 'http'}://${request.headers.host}`);
      if (request.headers.origin !== expected || !store.csrf(request.authSession, request.headers['x-csrf-token'])) {
        return reply.code(403).send({ error: { code: 'CSRF_REJECTED', message: 'Your request could not be verified. Refresh and try again.' } });
      }
      if (!request.headers['content-type']?.startsWith('application/json')) throw new AuthError(400, 'INVALID_INPUT', 'Use a JSON request body.');
    });
    routes.setErrorHandler((error, _request, reply) => {
      const safe = error instanceof AuthError ? error : new AuthError(500, 'AUTH_UNAVAILABLE', 'The account service could not complete this request.');
      if (safe.status === 429) reply.header('Retry-After', '900');
      return reply.code(safe.status).send({ error: { code: safe.code, message: safe.message } });
    });
    routes.get('/playback/status', async () => ({ ok: true }));
    routes.get('/playback', async request => {
      const row = store.db.prepare('SELECT state FROM playback_state WHERE user_id=?').get(request.authSession!.user!.id);
      if (!row) return emptyPlayback();
      const state: unknown = JSON.parse(String(row.state));
      return validPlayback(state) ? state : emptyPlayback();
    });
    routes.post('/playback', {bodyLimit:4*1024*1024}, async request => {
      if (!validPlayback(request.body)) throw new AuthError(400, 'INVALID_INPUT', 'Invalid playback state.');
      const s=request.body;
      const canonical={queue:s.queue.map(t=>({key:t.key,source:t.source,trackId:t.trackId,...(t.origin==='manual'?{origin:'manual' as const}:{})})),...(s.contextLabel?{contextLabel:s.contextLabel}:{}),order:[...s.order],current:s.current,position:s.position,shuffle:s.shuffle,repeat:s.repeat,volume:s.volume,muted:s.muted};
      store.savePlayback(request.authSession!.user!.id,JSON.stringify(canonical));
      return { ok: true };
    });
    routes.get('/auth/session', async (request, reply) => {
      let session = request.authSession;
      if (!session) {
        store.limit(`anonymous:${request.ip}`, 120, 3600000);
        session = store.createSession(null); cookie(reply, session);
      }
      return publicSession(session);
    });
    routes.get('/auth/me', async request => ({ user: request.authSession!.user }));
    routes.post('/auth/login', async (request, reply) => {
      const input = body(request);
      const user = await store.login(input.username, input.password, request.ip);
      const session = store.createSession(user, request.authSession?.token);
      cookie(reply, session); return publicSession(session);
    });
    routes.post('/auth/password', async(request,reply)=>{
      const input=body(request);await store.changePassword(request.authSession!.token,input.currentPassword,input.newPassword,request.ip);
      cookie(reply);return {ok:true};
    });
    routes.post('/auth/logout', async (request, reply) => {
      if (request.authSession) store.logout(request.authSession.token);
      cookie(reply); return { ok: true };
    });
    routes.post('/auth/invitation', async request => {
      store.limit(`invitation-check:${request.ip}`, 60);
      return store.checkInvitation(body(request).token);
    });
    routes.post('/auth/accept-invitation', async (request, reply) => {
      store.limit(`invitation-accept:${request.ip}`, 15);
      if (request.authSession?.user) throw new AuthError(409, 'ALREADY_SIGNED_IN', 'Sign out before accepting an invitation.');
      const input = body(request);
      const user = await store.acceptInvitation(input.token, input.username, input.password);
      const session = store.createSession(user, request.authSession?.token);
      cookie(reply, session); return publicSession(session);
    });
    routes.get('/admin/invitations', async request => ({ items: store.invitations(request.authSession!.user!.id) }));
    routes.post('/admin/invitations', async request => {
      const expiresAt = body(request).expiresAt;
      if (typeof expiresAt !== 'number') throw new AuthError(400, 'INVALID_INPUT', 'Choose an invitation expiration date.');
      return store.createInvitation(request.authSession!.user!.id, expiresAt);
    });
    routes.post('/admin/invitations/:id/revoke', async request => {
      store.revokeInvitation(request.authSession!.user!.id, (request.params as { id: string }).id); return { ok: true };
    });
    routes.get('/admin/users', async request => ({ items: store.users(request.authSession!.user!.id) }));
    routes.post('/admin/users/:id/disable', async request => {
      store.disableUser(request.authSession!.user!.id, (request.params as { id: string }).id); return { ok: true };
    });
    routes.post('/admin/users/:id/revoke-sessions', async request => {
      store.revokeSessions(request.authSession!.user!.id, (request.params as { id: string }).id); return { ok: true };
    });
  }, { prefix: api });
}
