import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadEnvironment } from '../apps/server/dist/environment.js';
import { readConfig } from '../apps/server/dist/config.js';
import { openAuthStore } from '../apps/server/dist/auth/store.js';
import { createApp } from '../apps/server/dist/app.js';
loadEnvironment();
const temporary = await mkdtemp(join(tmpdir(), 'freeqify-auth-smoke-'));
const config = readConfig({ ...process.env, DATA_DIR: join(temporary, 'accounts'), AUTH_SECURE_COOKIES: 'false' });
const password = randomBytes(32).toString('base64url');
let app; let origin;
const store = openAuthStore(config);
await store.createInitialAdmin('smoke-owner', password);
function browser() {
  let cookie = ''; let csrf = '';
  async function request(path, input) {
    const response = await fetch(`${origin}${config.basePath}api/${path}`, { signal: AbortSignal.timeout(30000), headers: { cookie, ...(input === undefined ? {} : { 'content-type': 'application/json', origin, 'x-csrf-token': csrf }) }, ...(input === undefined ? {} : { method: 'POST', body: JSON.stringify(input) }) });
    const value = response.headers.get('set-cookie'); if (value) cookie = value.split(';')[0];
    const data = await response.json(); if (data.csrf) csrf = data.csrf;
    return { status: response.status, data };
  }
  return { request, cookie: () => cookie };
}
async function start(authStore) {
  app = await createApp(config, authStore ? { authStore } : {});
  await app.listen({ host: '127.0.0.1', port: 0 });
  origin = `http://127.0.0.1:${app.server.address().port}`;
}
try {
  await start(store);
  const owner = browser(); const listener = browser();
  assert.equal((await listener.request('library/overview')).status, 401);
  assert.equal((await listener.request('library/artwork/al-example')).status, 401);
  await owner.request('auth/session');
  assert.equal((await owner.request('auth/login', { username: 'smoke-owner', password })).status, 200);
  const invite = await owner.request('admin/invitations', { expiresAt: Date.now() + 3600000 }); assert.equal(invite.status, 200);
  await listener.request('auth/session');
  const registration = await listener.request('auth/accept-invitation', { token: invite.data.token, username: 'smoke-listener', password }); assert.equal(registration.status, 200); assert.equal(registration.data.user.role, 'listener');
  assert.equal((await listener.request('admin/users')).status, 403);
  const cookieFile = join(temporary, 'smoke-cookie');
  await writeFile(cookieFile, listener.cookie(), { mode: 0o600 });
  const result = await promisify(execFile)(process.execPath, ['scripts/smoke-library.mjs'], { env: { ...process.env, FREEQIFY_SMOKE_URL: `${origin}${config.basePath}`, FREEQIFY_SMOKE_COOKIE_FILE: cookieFile }, timeout: 120000 });
  // The existing library smoke prints only counts and formats, never session credentials.
  process.stdout.write(result.stdout);
  await app.close(); app = undefined;
  await start();
  assert.equal((await listener.request('auth/me')).status, 200);
  assert.equal((await listener.request('library/overview')).status, 200);
  assert.equal((await owner.request(`admin/users/${registration.data.user.id}/disable`, {})).status, 200);
  assert.equal((await listener.request('library/tracks')).status, 401);
  await listener.request('auth/session');
  assert.equal((await listener.request('auth/login', { username: 'smoke-listener', password })).status, 401);
  assert.equal((await owner.request('auth/logout', {})).status, 200);
  assert.equal((await owner.request('admin/users')).status, 401);
  console.log('PASS: initial admin, CSRF login, invitation, listener authorization, real library, restart persistence, account disabling, and logout.');
} finally {
  if (app) await app.close();
  await rm(temporary, { recursive: true, force: true });
}
