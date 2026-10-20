import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { readConfig } from './config.js';
import { LibraryError, type MusicLibrary } from './integrations/navidrome.js';
import { AuthStore } from './auth/store.js';
import type { InjectOptions } from 'fastify';
import type { FastifyInstance } from 'fastify';
const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
function mockLibrary(): MusicLibrary {
  return { ping: vi.fn().mockResolvedValue(undefined), artists: vi.fn().mockResolvedValue([]), artist: vi.fn().mockResolvedValue({}), albums: vi.fn().mockResolvedValue({ items: [], nextOffset: null }), album: vi.fn().mockResolvedValue({}), tracks: vi.fn().mockResolvedValue({ items: [], nextOffset: null }), track: vi.fn().mockResolvedValue({}), search: vi.fn().mockResolvedValue({ artists: [], albums: [], tracks: [] }), overview: vi.fn().mockResolvedValue({ artists: 0, albums: 0, tracks: 0, scanning: false }), artwork: vi.fn().mockResolvedValue({ bytes: Buffer.from([255,216,255]), contentType: 'image/jpeg' }) };
}
async function fixture(base = '/') {
  const library = mockLibrary();
  // Use the real already-built Phase 0 web directory; no Vite server needed.
  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'freeqify-routes-'));
  await writeFile(join(root, 'index.html'), `<meta content="${base}">`);
  const config = readConfig({ BASE_PATH: base, WEB_DIST_DIR: root });
  const store = new AuthStore(':memory:', config.auth);
  const user = await store.createInitialAdmin('testadmin', 'a-long-test-passphrase');
  const session = store.createSession(user);
  const app = await createApp(config, { library, authStore: store });
  app.addHook('onClose', async () => { const { rm } = await import('node:fs/promises'); await rm(root, { recursive: true }); });
  apps.push(app);
  const client = { inject: (input: string | InjectOptions) => { const options = typeof input === 'string' ? { url: input } : input; return app.inject({ ...options, headers: { cookie: `freeqify_session=${session.token}`, ...options.headers } }); } };
  return { app: client, rawApp:app, store, session, library, prefix: `${base}api/library` };
}
describe.each(['/', '/music/'])('library routes at %s', base => {
  it('serves local catalog, overview, connection, details, artwork, and search', async () => {
    const { app, prefix } = await fixture(base);
    for (const endpoint of ['/connection', '/overview', '/artists', '/artists/ar-1', '/albums', '/albums/al-1', '/tracks', '/tracks/mf-1', '/search?q=music']) {
      const r = await app.inject(prefix + endpoint); expect(r.statusCode).toBe(200); expect(r.headers['cache-control']).toBe('no-store');
      expect(r.headers['access-control-allow-origin']).toBeUndefined();
    }
    const art = await app.inject(prefix + '/artwork/al-1'); expect(art.headers['content-type']).toBe('image/jpeg');
    expect(art.headers['set-cookie']).toBeUndefined();
    expect((await app.inject(`${base}api/stream?id=1`)).statusCode).toBe(404);
  });
  it('accepts bounded disc-art identifiers only for artwork',async()=>{const {app,library,prefix}=await fixture(base);expect((await app.inject(`${prefix}/artwork/dc-abcdefghijklmnopqrstuv%3A1_0`)).statusCode).toBe(200);expect(library.artwork).toHaveBeenCalledWith('dc-abcdefghijklmnopqrstuv:1_0');expect((await app.inject(`${prefix}/tracks/dc-abcdefghijklmnopqrstuv%3A1_0`)).statusCode).toBe(400);expect((await app.inject(`${prefix}/artwork/http%3Aevil`)).statusCode).toBe(400);});
  it('sanitizes credential and unexpected failures without logging response secrets', async () => {
    const { app, library, prefix } = await fixture(base);
    vi.mocked(library.ping).mockRejectedValueOnce(new LibraryError('INVALID_CREDENTIALS')).mockRejectedValueOnce(new Error('private-password private-user /secret/path'));
    const a = await app.inject(prefix + '/connection'); expect(a.statusCode).toBe(502); expect(a.json().error.code).toBe('INVALID_CREDENTIALS');
    const b = await app.inject(prefix + '/connection'); expect(b.statusCode).toBe(502); expect(b.body).not.toMatch(/private-|secret\/path/);
  });
  it.each(['/search?q=', '/search', '/search?q=x&limit=0', '/albums?limit=101', '/tracks?offset=-1', '/artwork/http%3A%2F%2Fevil', '/albums/a.b'])('rejects invalid parameters %s', async endpoint => {
    const { app, prefix } = await fixture(base); expect((await app.inject(prefix + endpoint)).statusCode).toBe(400);
  });
});
it('refuses non-loopback bind configuration', async () => {
  await expect(createApp(readConfig({ HOST: '0.0.0.0' }))).rejects.toThrow('loopback HOST');
});
it.each([
  { remoteAddress: '192.0.2.1', headers: { host: 'localhost' } },
  { remoteAddress: '127.0.0.1', headers: { host: 'evil.example' } },
  { remoteAddress: '127.0.0.1', headers: { host: 'localhost', origin: 'https://evil.example' } },
  { remoteAddress: '127.0.0.1', headers: { host: 'localhost', 'sec-fetch-site': 'cross-site' } },
])('rejects remote clients, rebinding, and cross-origin requests', async options => {
  const { app, library, prefix } = await fixture();
  expect((await app.inject({ url: prefix + '/artists', ...options })).statusCode).toBe(403);
  expect(library.artists).not.toHaveBeenCalled();
});
it.each(['http://example.com/', 'file:///private', 'http://user:secret@127.0.0.1/', 'http://127.0.0.1/?secret=x', 'not a url'])('rejects unsafe upstream URLs without reflecting configuration', url => {
  expect(() => readConfig({ NAVIDROME_URL: url })).toThrow(/NAVIDROME_URL/);
  try { readConfig({ NAVIDROME_URL: url }); } catch (error) { expect(String(error)).not.toContain('secret'); }
});

describe.each(['/','/music/'])('album ordering at %s',base=>{
 it.each(['newest','alphabeticalByArtist','alphabeticalByName'])('passes allowlisted %s sorting to the catalog',async sort=>{
  const {app,library,prefix}=await fixture(base);
  const response=await app.inject(`${prefix}/albums?offset=48&limit=8&sort=${sort}`);
  expect(response.statusCode).toBe(200);expect(library.albums).toHaveBeenCalledWith(48,8,sort);
 });
 it.each(['random','http://example.invalid','newest&sort=alphabeticalByName'])('rejects unsupported or repeated sorts: %s',async sort=>{
  const {app,library,prefix}=await fixture(base);
  expect((await app.inject(`${prefix}/albums?sort=${sort}`)).statusCode).toBe(400);
  expect(library.albums).not.toHaveBeenCalled();
 });
});


describe.each(['/','/music/'])('admin music scanning at %s',base=>{
 it('requires an active administrator, same origin and CSRF; bounds scan frequency',async()=>{
  const {app,rawApp,store,session,library,prefix}=await fixture(base);
  library.scanStatus=vi.fn().mockResolvedValue({scanning:false,count:301});
  library.startScan=vi.fn().mockResolvedValue({scanning:true,count:301});
  const headers={origin:'http://localhost',host:'localhost','x-csrf-token':session.csrf};
  expect((await rawApp.inject({method:'POST',url:prefix+'/scan',payload:{},headers})).statusCode).toBe(401);
  expect((await app.inject({method:'POST',url:prefix+'/scan',payload:{},headers:{...headers,'x-csrf-token':'bad'}})).statusCode).toBe(403);
  expect((await app.inject({method:'POST',url:prefix+'/scan',payload:{},headers:{...headers,origin:'http://evil.example'}})).statusCode).toBe(403);
  const listener=store.createSession({...session.user!,role:'listener'});
  // Role is checked against stored user data, not a client-supplied claim.
  store.db.prepare("UPDATE users SET role='listener' WHERE id=?").run(session.user!.id);
  expect((await app.inject({method:'POST',url:prefix+'/scan',payload:{},headers:{...headers,cookie:`freeqify_session=${listener.token}`}})).statusCode).toBe(403);
  expect((await app.inject({url:prefix+'/scan',headers})).statusCode).toBe(403);
  store.db.prepare("UPDATE users SET role='admin' WHERE id=?").run(session.user!.id);
  expect((await app.inject({method:'POST',url:prefix+'/scan',payload:{path:'/untrusted'},headers})).statusCode).toBe(400);
  const response=await app.inject({method:'POST',url:prefix+'/scan',payload:{},headers});
  expect(response.statusCode).toBe(200);expect(response.json()).toEqual({scanning:true,count:301});
  expect(library.startScan).toHaveBeenCalledExactlyOnceWith();
  expect((await app.inject({method:'POST',url:prefix+'/scan',payload:{},headers})).statusCode).toBe(429);
  expect((await app.inject({url:prefix+'/scan',headers})).json()).toEqual({scanning:false,count:301});
 });
 it('joins an ongoing scan instead of starting another',async()=>{
  const {app,session,library,prefix}=await fixture(base);library.scanStatus=vi.fn().mockResolvedValue({scanning:true,count:12});library.startScan=vi.fn();
  expect((await app.inject({method:'POST',url:prefix+'/scan',payload:{},headers:{origin:'http://localhost',host:'localhost','x-csrf-token':session.csrf}})).json()).toEqual({scanning:true,count:12});expect(library.startScan).not.toHaveBeenCalled();
 });
});
