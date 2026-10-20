import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { registerMediaRoutes, validRange } from './media-routes.js';
import { AuthStore } from './auth/store.js';
import { readConfig } from './config.js';
import type { MusicLibrary } from './integrations/navidrome.js';
import { sessionCookie } from './auth/routes.js';
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
async function fixture(base = '/', recheck = 10) {
  let now = Date.now();
  const store = new AuthStore(':memory:', readConfig({}).auth, () => now);
  const user = await store.createInitialAdmin('media-owner', 'a-long-media-test-password');
  const session = store.createSession(user);
  const stream = vi.fn<NonNullable<MusicLibrary['stream']>>().mockImplementation(async () => new Response(new Uint8Array([1,2,3,4]), { headers: { 'content-type': 'audio/mpeg', 'content-length': '4', 'accept-ranges': 'bytes' } }));
  const app = Fastify();
  app.decorateRequest('authSession', null);
  app.addHook('onRequest', async request => { request.authSession = store.session(sessionCookie(request.headers.cookie)); });
  registerMediaRoutes(app, `${base}api/library`, { stream } as unknown as MusicLibrary, store, 300, recheck);
  cleanup.push(async () => { await app.close(); store.close(); });
  const request = (method: 'GET' | 'HEAD' = 'GET', path = 'song', headers = {}) => app.inject({ method, url: `${base}api/library/stream/${path}`, headers: { cookie: `freeqify_session=${session.token}`, ...headers } });
  return { app, store, user, session, stream, request, expire: () => { now += 8 * 86400000; } };
}
describe.each(['/', '/freeqify/'])('authenticated media %s', base => {
  it('streams audio and HEAD metadata without exposing upstream headers', async () => {
    const f = await fixture(base);
    const response = await f.request(); expect(response.statusCode).toBe(200); expect(response.rawPayload).toEqual(Buffer.from([1,2,3,4])); expect(response.headers['cache-control']).toBe('no-store');
    const head = await f.request('HEAD'); expect(head.statusCode).toBe(200); expect(head.body).toBe(''); expect(head.headers['content-length']).toBe('4');
  });
  it('rejects anonymous, revoked and expired sessions before upstream work', async () => {
    const f = await fixture(base);
    expect((await f.request('GET', 'song', { cookie: '' })).statusCode).toBe(401);
    f.expire(); expect((await f.request()).statusCode).toBe(401);
    const fresh = f.store.createSession(f.user); f.store.logout(fresh.token);
    expect((await f.request('GET', 'song', { cookie: `freeqify_session=${fresh.token}` })).statusCode).toBe(401); expect(f.stream).not.toHaveBeenCalled();
  });
  it('rejects disabled listeners', async () => {
    const f = await fixture(base); const invite = f.store.createInvitation(f.user.id, Date.now() + 600000);
    const listener = await f.store.acceptInvitation(invite.token, 'media-listener', 'a-long-listener-test-password'); const session = f.store.createSession(listener);
    f.store.disableUser(f.user.id, listener.id);
    expect((await f.request('GET', 'song', { cookie: `freeqify_session=${session.token}` })).statusCode).toBe(401); expect(f.stream).not.toHaveBeenCalled();
  });
  it.each(['bad.id', 'http%3A%2F%2Fevil', 'song?url=http://evil', 'song?format=flac', 'song?path=secret'])('rejects unsafe identifiers/parameters %s', async path => {
    const f = await fixture(base); expect((await f.request('GET', path)).statusCode).toBe(400); expect(f.stream).not.toHaveBeenCalled();
  });
  it.each([401,403,404,500,302])('sanitizes upstream status %s', async status => {
    const f = await fixture(base); f.stream.mockResolvedValue(new Response('secret password', { status, headers: { 'set-cookie': 'secret', location: 'http://evil', 'content-type': 'text/xml' } }));
    const response = await f.request(); expect(response.statusCode).toBe(status < 500 && status !== 302 ? status : 502); expect(response.body).not.toContain('secret'); expect(response.headers.location).toBeUndefined(); expect(response.headers['set-cookie']).toBeUndefined();
  });
  it('forwards a single byte range and preserves 206 and 416', async () => {
    const f = await fixture(base); f.stream.mockResolvedValueOnce(new Response(new Uint8Array([2,3]), { status: 206, headers: { 'content-type': 'audio/wav', 'content-range': 'bytes 1-2/4', 'content-length': '2', 'accept-ranges': 'bytes' } }));
    const response = await f.request('GET', 'song', { range: 'bytes=1-2' }); expect(response.statusCode).toBe(206); expect(response.headers['content-range']).toBe('bytes 1-2/4'); expect(f.stream.mock.calls[0]?.[2]).toBe('bytes=1-2');
    f.stream.mockResolvedValueOnce(new Response(null, { status: 416, headers: { 'content-range': 'bytes */4' } }));
    const unsatisfied = await f.request('GET', 'song', { range: 'bytes=9-' }); expect(unsatisfied.statusCode).toBe(416); expect(unsatisfied.headers['content-range']).toBe('bytes */4');
    expect((await f.request('GET', 'song', { range: 'bytes=0-1,3-4' })).statusCode).toBe(400);
  });
  it('requests native by default and MP3 only explicitly; rejects non-audio success', async () => {
    const f = await fixture(base); await f.request(); expect(f.stream.mock.calls[0]?.[1]).toBe('raw'); await f.request('GET', 'song?format=mp3'); expect(f.stream.mock.calls[1]?.[1]).toBe('mp3');
    f.stream.mockResolvedValueOnce(new Response('private upstream JSON', { headers: { 'content-type': 'application/json' } })); expect((await f.request()).statusCode).toBe(502);
  });
});
it.each(['bytes=0-', 'bytes=-10', 'bytes=0-4'])('accepts bounded range %s', value => expect(validRange(value)).toBe(true));
it.each(['bytes=-0', 'bytes=4-1', 'bytes=-', 'bytes=9999999999999999-', 'items=0-1'])('rejects malformed range %s', value => expect(validRange(value)).toBe(false));
it.each(['disconnect', 'revoke', 'expire', 'disable', 'shutdown'] as const)('cancels a live bounded stream on %s', async reason => {
  const f = await fixture(); let produced = 0; let canceled = false;
  const invite = f.store.createInvitation(f.user.id, Date.now() + 600000);
  const listener = await f.store.acceptInvitation(invite.token, 'active-listener', 'a-long-listener-test-password'); const session = f.store.createSession(listener);
  f.stream.mockImplementation(async (_id, _format, _range, signal) => {
    const body = new ReadableStream<Uint8Array>({ async pull(controller) { await new Promise(resolve => setTimeout(resolve, 2)); if (signal.aborted) { canceled = true; controller.close(); return; } produced++; controller.enqueue(new Uint8Array(65536)); }, cancel() { canceled = true; } });
    return new Response(body, { headers: { 'content-type': 'audio/mpeg' } });
  });
  await f.app.listen({ host: '127.0.0.1', port: 0 }); const address = f.app.server.address() as { port: number };
  const controller = new AbortController();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/library/stream/song`, { headers: { cookie: `freeqify_session=${session.token}` }, signal: controller.signal });
  const reader = response.body!.getReader(); await reader.read();
  if (reason === 'disconnect') controller.abort();
  else if (reason === 'revoke') f.store.revokeSessions(f.user.id, listener.id);
  else if (reason === 'disable') f.store.disableUser(f.user.id, listener.id);
  else if (reason === 'shutdown') await f.app.close();
  else f.expire();
  await vi.waitFor(() => expect(canceled).toBe(true), { timeout: 1000 });
  expect(produced).toBeLessThan(200); expect(f.stream.mock.calls[0]?.[3].aborted).toBe(true);
  controller.abort(); await reader.cancel().catch(() => {});
});
it('serves independent simultaneous listeners', async () => {
  const f = await fixture(); const results = await Promise.all(Array.from({ length: 6 }, () => f.request())); expect(results.every(r => r.statusCode === 200 && r.rawPayload.length === 4)).toBe(true); expect(f.stream).toHaveBeenCalledTimes(6);
});
