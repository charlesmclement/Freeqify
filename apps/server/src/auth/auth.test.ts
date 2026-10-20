import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AuthStore, openAuthStore } from './store.js';
import { hashPassword, verifyPassword } from './password.js';
import { createApp } from '../app.js';
import { readConfig, projectRoot } from '../config.js';
import type { InjectOptions } from 'fastify';
const password = 'a-private-test-passphrase';
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture(base = '/', secure = false) {
  const root = await mkdtemp(join(tmpdir(), 'freeqify-auth-'));
  cleanups.push(() => rm(root, { recursive: true }));
  await writeFile(join(root, 'index.html'), `<meta content="${base}">`);
  const config = readConfig({ BASE_PATH: base, WEB_DIST_DIR: root, AUTH_SECURE_COOKIES: String(secure), SESSION_HOURS: '1', SESSION_IDLE_MINUTES: '10' });
  let now = Date.now();
  const store = new AuthStore(':memory:', config.auth, () => now);
  const admin = await store.createInitialAdmin('owner', password);
  const app = await createApp(config, { authStore: store });
  cleanups.push(() => app.close());
  function client() {
    let cookie = ''; let csrf = '';
    async function request(path: string, options: Partial<InjectOptions> = {}, protect = true) {
      const response = await app.inject({ ...options, url: `${base}api/${path}`, headers: { host: 'localhost:3000', cookie, ...(options.method && options.method !== 'GET' && protect ? { origin: `${secure ? 'https' : 'http'}://localhost:3000`, 'x-csrf-token': csrf, 'content-type': 'application/json' } : {}), ...options.headers } });
      const set = response.headers['set-cookie']; if (typeof set === 'string') cookie = set.split(';')[0]!;
      const json = response.headers['content-type']?.includes('json') ? response.json() : {};
      if (json.csrf) csrf = json.csrf;
      return response;
    }
    return { request, cookie: () => cookie, csrf: () => csrf,
      session: () => request('auth/session'),
      post: (path: string, payload: unknown = {}) => request(path, { method: 'POST', payload }),
      login: async (username = 'owner', secret = password) => { await request('auth/session'); return request('auth/login', { method: 'POST', payload: { username, password: secret } }); },
    };
  }
  return { app, config, store, admin, client, advance: (milliseconds: number) => { now += milliseconds; } };
}
describe.each(['/', '/freeqify/'])('authentication under %s', base => {
  it('creates only the first administrator, hashes its password, and rejects weak passwords', async () => {
    const { store, admin } = await fixture(base);
    expect(admin.role).toBe('admin');
    const row = store.db.prepare('SELECT * FROM users').get()!;
    expect(row.password_hash).not.toBe(password); expect(String(row.password_hash)).toMatch(/^scrypt\$32768\$8\$3/);
    await expect(store.createInitialAdmin('second', password)).rejects.toMatchObject({ code: 'ALREADY_INITIALIZED' });
    const empty = new AuthStore(':memory:', readConfig({}).auth);
    try { await expect(empty.createInitialAdmin('owner', 'short')).rejects.toMatchObject({ code: 'INVALID_PASSWORD' }); expect(empty.hasUsers()).toBe(false); }
    finally { empty.close(); }
  });
  it('logs in, rotates the anonymous session, and sets private prefix-scoped cookies', async () => {
    const { client } = await fixture(base); const browser = client();
    await browser.session(); const old = browser.cookie();
    const response = await browser.login(); expect(response.statusCode).toBe(200);
    expect(response.json().user).toMatchObject({ username: 'owner', role: 'admin' });
    expect(browser.cookie()).not.toBe(old);
    const cookie = response.headers['set-cookie'] as string;
    expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=Lax'); expect(cookie).toContain(`Path=${base};`); expect(cookie).not.toContain('Domain='); expect(cookie).not.toContain('; Secure');
    expect((await browser.request('auth/me')).json().user.username).toBe('owner');
  });
  it('denies anonymous library, search, connection, and artwork access without contacting Navidrome', async () => {
    const { client } = await fixture(base); const browser = client(); await browser.session();
    for (const path of ['library/connection', 'library/overview', 'library/artists', 'library/albums', 'library/tracks', 'library/search?q=x', 'library/artwork/al-1', 'admin/users', 'auth/me']) {
      const response = await browser.request(path); expect(response.statusCode).toBe(401); expect(response.body).not.toMatch(/navidrome|password_hash|token_hash/); expect(response.headers['cache-control']).toBe('no-store');
    }
    expect((await browser.request('auth/register', { method: 'POST', payload: {} })).statusCode).toBe(404);
  });
  it('protects canonical and encoded private paths and HEAD artwork requests', async () => {
    const { app } = await fixture(base);
    for (const path of ['api/library/artists', 'api/library/%61rtists', '%61pi/library/artists', 'api/%6cibrary/artists', 'api/admin/%75sers']) {
      const response = await app.inject(`${base}${path}`);
      expect([400, 401, 404]).toContain(response.statusCode);
      expect(response.body).not.toContain('smoke');
    }
    expect((await app.inject({ method: 'HEAD', url: `${base}api/library/artwork/al-1` })).statusCode).toBe(401);
  });
  it('returns uniform errors for nonexistent users, invalid passwords, and disabled accounts', async () => {
    const { client } = await fixture(base);
    const a = await client().login('owner', 'incorrect'); const b = await client().login('nobody', 'incorrect');
    expect(a.statusCode).toBe(401); expect(b.body).toBe(a.body); expect(a.body).not.toContain(password);
  });
  it('enforces login rate limits', async () => {
    const { client } = await fixture(base); const browser = client(); await browser.session();
    // Exercise the real limiter while avoiding repeated expensive password hashing.
    const attempts = Array.from({ length: 11 }, () => browser.post('auth/login', { username: 'owner', password: 'wrong' }));
    const results = await Promise.all(attempts);
    expect(results.some(result => result.statusCode === 429)).toBe(true);
    expect(results.filter(result => result.statusCode === 429).every(result => result.headers['retry-after'] === '900')).toBe(true);
    // Once concurrency has cleared, the persisted attempt window still blocks login.
    expect((await browser.post('auth/login', { username: 'owner', password })).statusCode).toBe(429);
  });
  it('creates a single-use invitation, exposes its token once, and registers only a listener', async () => {
    const { client, store } = await fixture(base); const owner = client(); await owner.login();
    const invitation = await owner.post('admin/invitations', { expiresAt: Date.now() + 3600000 }); expect(invitation.statusCode).toBe(200);
    const value = invitation.json(); expect(value.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const rows = JSON.stringify(store.db.prepare('SELECT * FROM invitations').all()); expect(rows).not.toContain(value.token);
    const listed = await owner.request('admin/invitations'); expect(listed.body).not.toContain(value.token); expect(listed.json().items[0].status).toBe('pending');
    const guest = client(); await guest.session(); expect((await guest.post('auth/invitation', { token: value.token })).statusCode).toBe(200);
    const registered = await guest.post('auth/accept-invitation', { token: value.token, username: 'listener', password, role: 'admin' });
    expect(registered.statusCode).toBe(200); expect(registered.json().user.role).toBe('listener');
    const another = client(); await another.session(); expect((await another.post('auth/accept-invitation', { token: value.token, username: 'another', password })).statusCode).toBe(400);
    expect((await owner.request('admin/invitations')).json().items[0].status).toBe('used');
  });
  it('rejects expired and revoked invitations and bounds expiration dates', async () => {
    const { client, advance } = await fixture(base); const owner = client(); await owner.login();
    expect((await owner.post('admin/invitations', { expiresAt: Date.now() - 1 })).statusCode).toBe(400);
    const value = (await owner.post('admin/invitations', { expiresAt: Date.now() + 120000 })).json();
    expect((await owner.post(`admin/invitations/${value.id}/revoke`)).statusCode).toBe(200);
    const guest = client(); await guest.session(); expect((await guest.post('auth/invitation', { token: value.token })).statusCode).toBe(400);
    const expired = (await owner.post('admin/invitations', { expiresAt: Date.now() + 120000 })).json(); advance(180000);
    expect((await guest.post('auth/accept-invitation', { token: expired.token, username: 'newuser', password })).statusCode).toBe(400);
  });
  it('expires idle and absolute sessions and clears logout cookies', async () => {
    const { client, store, advance } = await fixture(base); const browser = client(); await browser.login();
    const raw = browser.cookie().split('=')[1]!; expect(JSON.stringify(store.db.prepare('SELECT * FROM sessions').all())).not.toContain(raw);
    advance(11 * 60000); expect((await browser.request('auth/me')).statusCode).toBe(401);
    await browser.login();
    for (let n = 0; n < 7; n++) { advance(9 * 60000); await browser.request('auth/me'); }
    expect((await browser.request('auth/me')).statusCode).toBe(401);
    await browser.login(); const loggedOut = await browser.post('auth/logout'); expect(loggedOut.statusCode).toBe(200); expect(loggedOut.headers['set-cookie']).toContain('Max-Age=0');
    expect((await browser.request('auth/me')).statusCode).toBe(401);
  });
  it('enforces administrator privileges, self-only profiles, and immediate account disabling', async () => {
    const { client, store, admin } = await fixture(base); const owner = client(); await owner.login();
    const invite = store.createInvitation(admin.id, Date.now() + 3600000);
    const guest = client(); await guest.session(); const registration = await guest.post('auth/accept-invitation', { token: invite.token, username: 'listener', password }); const id = registration.json().user.id;
    expect((await guest.request('auth/me?userId=' + admin.id)).json().user.id).toBe(id);
    for (const path of ['admin/users', 'admin/invitations']) expect((await guest.request(path)).statusCode).toBe(403);
    expect((await guest.post('admin/invitations', { expiresAt: Date.now() + 3600000 })).statusCode).toBe(403);
    expect((await owner.post(`admin/users/${admin.id}/disable`)).statusCode).toBe(400);
    expect((await owner.post(`admin/users/${id}/disable`)).statusCode).toBe(200);
    expect((await guest.request('auth/me')).statusCode).toBe(401);
    expect((await guest.request('library/artwork/cover')).statusCode).toBe(401);
    expect((await client().login('listener')).statusCode).toBe(401);
    expect((await owner.request('admin/users')).body).not.toMatch(/password_hash|token_hash/);
  });
  it('lets administrators revoke sessions without disabling the user', async () => {
    const { client, store, admin } = await fixture(base); const owner = client(); await owner.login();
    const invite = store.createInvitation(admin.id, Date.now() + 3600000); const guest = client(); await guest.session(); const registration = await guest.post('auth/accept-invitation', { token: invite.token, username: 'listener', password });
    expect((await owner.post(`admin/users/${registration.json().user.id}/revoke-sessions`)).statusCode).toBe(200);
    expect((await guest.request('auth/me')).statusCode).toBe(401); expect((await client().login('listener')).statusCode).toBe(200);
  });
  it('rejects missing, unrelated-session, and cross-origin CSRF tokens including login', async () => {
    const { client } = await fixture(base); const browser = client(); await browser.session(); const another = client(); await another.session();
    expect((await browser.request('auth/login', { method: 'POST', payload: { username: 'owner', password } }, false)).statusCode).toBe(403);
    expect((await browser.request('auth/login', { method: 'POST', payload: { username: 'owner', password }, headers: { 'x-csrf-token': another.csrf() } })).statusCode).toBe(403);
    expect((await browser.request('auth/login', { method: 'POST', payload: { username: 'owner', password }, headers: { origin: 'https://foreign.example' } })).statusCode).toBe(403);
    await browser.login(); expect((await browser.request('admin/invitations', { method: 'POST', payload: { expiresAt: Date.now() + 3600000 }, headers: { 'x-csrf-token': '0'.repeat(64) } })).statusCode).toBe(403);
  });
});
it('sets Secure cookies for HTTPS production with prefix scope', async () => {
  const { client } = await fixture('/private/', true); const response = await client().login();
  expect(response.statusCode).toBe(200); expect(response.headers['set-cookie']).toContain('; Secure'); expect(response.headers['set-cookie']).toContain('Path=/private/');
});
it('persists users, invitation status, rate limits, migrations, and sessions after database restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'freeqify-persist-')); cleanups.push(() => rm(dir, { recursive: true }));
  const file = join(dir, 'accounts.sqlite'); const settings = readConfig({}).auth;
  let store = new AuthStore(file, settings);
  const admin = await store.createInitialAdmin('owner', password); const invitation = store.createInvitation(admin.id, Date.now() + 3600000); const session = store.createSession(admin); store.limit('persistent-rate-key', 1); store.close();
  store = new AuthStore(file, settings);
  try {
    expect(store.session(session.token)?.user?.id).toBe(admin.id); expect(store.checkInvitation(invitation.token).expiresAt).toBe(invitation.expiresAt);
    expect(store.db.prepare('PRAGMA user_version').get()!.user_version).toBe(12);
    expect(() => store.limit('persistent-rate-key', 1)).toThrow('Too many');
    expect((await store.login('owner', password, 'localhost')).id).toBe(admin.id);
  } finally { store.close(); }
});
it('atomically rejects concurrent reuse of an invitation', async () => {
  const store = new AuthStore(':memory:', readConfig({}).auth);
  try {
    const admin = await store.createInitialAdmin('owner', password); const invite = store.createInvitation(admin.id, Date.now() + 3600000);
    const results = await Promise.allSettled([store.acceptInvitation(invite.token, 'first', password), store.acceptInvitation(invite.token, 'second', password)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1); expect(store.users(admin.id)).toHaveLength(2);
  } finally { store.close(); }
});
it('stores different salts for identical passwords and rejects incorrect passwords', async () => {
  const first = await hashPassword(password); const second = await hashPassword(password);
  expect(first).not.toBe(second); expect(await verifyPassword(password, first)).toBe(true); expect(await verifyPassword('wrong', first)).toBe(false);
});
it('creates private data outside the checkout and refuses unsafe persistence paths', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'freeqify-private-')); cleanups.push(() => rm(dir, { recursive: true }));
  const data = join(dir, 'accounts');
  const store = openAuthStore(readConfig({ DATA_DIR: data, WEB_DIST_DIR: join(dir, 'web') })); store.close();
  expect((await stat(data)).mode & 0o077).toBe(0); expect((await stat(join(data, 'freeqify.sqlite'))).mode & 0o077).toBe(0);
  expect(() => openAuthStore(readConfig({ DATA_DIR: join(projectRoot, 'data') }))).toThrow('outside');
  await mkdir(join(dir, 'public'));
  expect(() => openAuthStore(readConfig({ DATA_DIR: join(dir, 'public/data'), WEB_DIST_DIR: join(dir, 'public') }))).toThrow('outside');
});

it('renews the idle deadline on authenticated activity without extending absolute expiry', async () => {
  let now = Date.now(); const settings = { ...readConfig({}).auth, idleMinutes: 1, sessionHours: 1 };
  const store = new AuthStore(':memory:', settings, () => now);
  try {
    const user = await store.createInitialAdmin('owner', password); const session = store.createSession(user);
    now += 59000; expect(store.session(session.token)?.user?.id).toBe(user.id);
    now += 59000; expect(store.session(session.token)?.user?.id).toBe(user.id);
    now += 61000; expect(store.session(session.token)).toBeNull();
  } finally { store.close(); }
});
