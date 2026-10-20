import { afterEach, expect, it } from 'vitest';
import Fastify from 'fastify';
import { registerAuthentication } from './auth/routes.js';
import { AuthStore } from './auth/store.js';
import { readConfig } from './config.js';
import { emptyPlayback, type PlaybackState } from '@freeqify/shared';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { migrations } from './storage/migrations.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
it.each(['/', '/freeqify/'])('persists private playback with CSRF and user isolation at %s', async base => {
  const config = readConfig({ BASE_PATH: base }); const store = new AuthStore(':memory:', config.auth);
  const admin = await store.createInitialAdmin('owner', 'a-long-playback-test-password'); const invite = store.createInvitation(admin.id, Date.now()+600000); const listener = await store.acceptInvitation(invite.token, 'listener', 'a-long-playback-test-password');
  const a = store.createSession(admin); const b = store.createSession(listener); const app = Fastify(); registerAuthentication(app, `${base}api`, config, store);
  cleanups.push(async () => { await app.close(); store.close(); });
  const headers = { cookie: `freeqify_session=${a.token}`, origin: 'http://localhost:80', 'x-csrf-token': a.csrf };
  const state: PlaybackState = { ...emptyPlayback(), queue: [{ key: 'entry-1', source: 'local', trackId: 'song-1', origin:'manual' }], order: ['entry-1'], current: 'entry-1', contextLabel:'Original album', position: 21, volume: 0.4, shuffle: true, repeat: 'all' };
  expect((await app.inject({ url: `${base}api/playback` })).statusCode).toBe(401);
  expect((await app.inject({ method: 'POST', url: `${base}api/playback`, headers: { ...headers, 'x-csrf-token': '' }, payload: state })).statusCode).toBe(403);
  expect((await app.inject({ method: 'POST', url: `${base}api/playback`, headers, payload: state })).statusCode).toBe(200);
  const restored = await app.inject({ url: `${base}api/playback`, headers }); expect(restored.json()).toEqual(state); expect(restored.headers['cache-control']).toBe('no-store');
  expect((await app.inject({ url: `${base}api/playback`, headers: { cookie: `freeqify_session=${b.token}` } })).json()).toEqual(emptyPlayback());
  expect((await app.inject({ method: 'POST', url: `${base}api/playback`, headers, payload: { ...state, current: 'foreign' } })).statusCode).toBe(400);
  store.revokeSessions(admin.id, admin.id); expect((await app.inject({ url: `${base}api/playback`, headers })).statusCode).toBe(401);
});
it('upgrades a Phase 2 database additively and restores playback after restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'freeqify-playback-')); cleanups.push(() => rm(dir, { recursive: true })); const file = join(dir, 'test.sqlite');
  const old = new DatabaseSync(file); old.exec(migrations[0]!.sql); old.exec("INSERT INTO users VALUES ('existing-user','existing-name','existing-hash','listener','active',1); PRAGMA user_version=1"); old.close();
  let store = new AuthStore(file, readConfig({}).auth);
  const original = store.db.prepare('SELECT * FROM users').get(); expect(original?.username).toBe('existing-name');
  store.db.prepare('INSERT INTO playback_state VALUES (?,?,?)').run('existing-user', JSON.stringify(emptyPlayback()), 1); store.close();
  store = new AuthStore(file, readConfig({}).auth);
  try { expect(store.db.prepare('SELECT * FROM users').get()).toEqual(original); expect(JSON.parse(String(store.db.prepare('SELECT state FROM playback_state').get()?.state))).toEqual(emptyPlayback()); expect(store.db.prepare('PRAGMA user_version').get()?.user_version).toBe(12); } finally { store.close(); }
});
it('authorization polling does not extend idle sessions', async () => {
  let now = Date.now(); const config = readConfig({}); const store = new AuthStore(':memory:', config.auth, () => now);
  const user = await store.createInitialAdmin('idle-owner', 'a-long-idle-test-password'); const session = store.createSession(user); const app = Fastify(); registerAuthentication(app, '/api', config, store);
  cleanups.push(async () => { await app.close(); store.close(); });
  const before = store.db.prepare('SELECT idle_expires_at FROM sessions').get()?.idle_expires_at;
  now += 1000; const headers = { cookie: `freeqify_session=${session.token}` };
  expect((await app.inject({ url: '/api/playback/status', headers })).statusCode).toBe(200); expect(store.db.prepare('SELECT idle_expires_at FROM sessions').get()?.idle_expires_at).toBe(before);
  now += 31 * 60000; expect((await app.inject({ url: '/api/playback/status', headers })).statusCode).toBe(401);
});
