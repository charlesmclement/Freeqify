import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app.js';
import { readConfig } from './config.js';
import { AuthStore } from './auth/store.js';
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture(basePath: string) {
  const dir = await mkdtemp(join(tmpdir(), 'freeqify-test-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'public'));
  await writeFile(join(dir, '.env'), 'SECRET=do-not-serve');
  await writeFile(join(dir, 'public/index.html'), `<html><meta name="freeqify-base" content="${basePath}"><body>Freeqify</body></html>`);
  await writeFile(join(dir, 'public/app.js'), 'console.log("app")');
  await writeFile(join(dir, 'public/.hidden'), 'hidden');
  const config = readConfig({ BASE_PATH: basePath, WEB_DIST_DIR: './public' }, dir);
  const app = await createApp(config, { authStore: new AuthStore(':memory:', config.auth) });
  cleanups.push(() => app.close());
  return { app, dir };
}
describe.each(['/', '/music/freeqify/'])('production entry point %s', base => {
  it('serves the health contract and built UI', async () => {
    const { app } = await fixture(base);
    const health = await app.inject(`${base}api/health`);
    expect(health.json()).toEqual({ status: 'ok', service: 'freeqify', phase: 0 });
    expect(health.headers['x-content-type-options']).toBe('nosniff');
    expect(health.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    const page = await app.inject({ url: base, headers: { accept: 'text/html' } });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.body).toContain('Freeqify');
    expect((await app.inject(`${base}app.js`)).statusCode).toBe(200);
    expect((await app.inject({ url: `${base}library`, headers: { accept: 'text/html' } })).statusCode).toBe(200);
  });
  it('keeps API failures, missing assets, and private files out of the SPA fallback', async () => {
    const { app } = await fixture(base);
    for (const path of ['api', 'api/missing', 'missing.js', '.hidden', '.env', '../.env', '%2e%2e/.env']) {
      const response = await app.inject({ url: `${base}${path}`, headers: { accept: 'text/html' } });
      expect([403, 404]).toContain(response.statusCode);
      expect(response.body).not.toContain('do-not-serve');
      expect(response.body).not.toContain('<html>');
    }
    expect((await app.inject({ method: 'POST', url: base })).statusCode).toBe(404);
    if (base !== '/') {
      expect((await app.inject('/api/health')).statusCode).toBe(404);
      expect((await app.inject(base.slice(0, -1))).headers.location).toBe(base);
    }
  });
});
it('fails clearly when assets are missing or the prefix differs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'freeqify-missing-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  await expect(createApp(readConfig({ WEB_DIST_DIR: dir }))).rejects.toThrow();
  await writeFile(join(dir, 'index.html'), '<html>wrong prefix</html>');
  await expect(createApp(readConfig({ WEB_DIST_DIR: dir }))).rejects.toThrow('BASE_PATH');
});
