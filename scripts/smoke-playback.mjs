import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnvironment } from '../apps/server/dist/environment.js';
import { readConfig } from '../apps/server/dist/config.js';
import { openAuthStore } from '../apps/server/dist/auth/store.js';
import { createApp } from '../apps/server/dist/app.js';
loadEnvironment();
const temporary = await mkdtemp(join(tmpdir(), 'freeqify-player-smoke-'));
const config = readConfig({ ...process.env, DATA_DIR: join(temporary, 'accounts'), AUTH_SECURE_COOKIES: 'false' });
const store = openAuthStore(config);
const password = randomBytes(32).toString('base64url');
const owner = await store.createInitialAdmin('playback-smoke', password);
const session = store.createSession(owner);
const cookie = `freeqify_session=${session.token}`;
const app = await createApp(config, { authStore: store });
let browser;
try {
  await app.listen({ host: '127.0.0.1', port: 0 });
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const base = `${origin}${config.basePath}`;
  const get = (path, options = {}) => fetch(`${base}api/${path}`, { ...options, signal: AbortSignal.timeout(30000), headers: { cookie, ...options.headers } });
  const tracks = (await (await get('library/tracks?limit=100')).json()).items;
  for (const format of ['mp3', 'wav']) {
    const track = tracks.find(t => t.format?.toLowerCase() === format); assert.ok(track, `No ${format} fixture`);
    const path = `library/stream/${encodeURIComponent(track.id)}`;
    const full = await get(path); assert.equal(full.status, 200); const reader = full.body.getReader(); const first = await reader.read(); assert.ok(first.value?.length); await reader.cancel();
    const head = await get(path, { method: 'HEAD' }); assert.equal(head.status, 200); assert.ok(Number(head.headers.get('content-length')) > 0);
    const range = await get(path, { headers: { range: 'bytes=0-4095' } }); assert.equal(range.status, 206); assert.match(range.headers.get('content-range'), /^bytes 0-4095\//); assert.equal((await range.arrayBuffer()).byteLength, 4096);
    const tail = await get(path, { headers: { range: 'bytes=-128' } }); assert.equal(tail.status, 206); assert.equal((await tail.arrayBuffer()).byteLength, 128);
    const invalid = await get(path, { headers: { range: 'bytes=999999999999-' } }); assert.equal(invalid.status, 416);
    console.log(`PASS real ${format}: native bytes, HEAD, first/suffix ranges, 416`);
    if (format === 'wav') {
      const converted = await get(`${path}?format=mp3`); assert.equal(converted.status, 200); assert.match(converted.headers.get('content-type'), /audio\/(mpeg|mp3)/); const r = converted.body.getReader(); assert.ok((await r.read()).value?.length); await r.cancel();
      const rangeMP3 = await get(`${path}?format=mp3`, { headers: { range: 'bytes=0-4095' } }); console.log(`Transcoded range response: ${rangeMP3.status}; accept-ranges=${rangeMP3.headers.get('accept-ranges') ?? 'absent'}; UI disables transcoded seek.`); await rangeMP3.body?.cancel();
      console.log('PASS real WAV → MP3 on-demand fallback bytes');
    }
  }
  assert.equal((await fetch(`${base}api/library/stream/${tracks[0].id}`)).status, 401);
  assert.equal((await get('library/stream/definitely-missing-track')).status, 404);
  assert.equal((await get('library/stream/bad.id')).status, 400);
  for (const path of ['.env', 'freeqify.sqlite', 'apps/server/src/app.ts', 'assets/missing.js', 'api/missing']) { const response = await fetch(base + path); assert.ok([403, 404].includes(response.status), path); }
  const manifest = await (await fetch(base + 'manifest.webmanifest')).json(); assert.equal(manifest.scope, '.'); assert.equal(manifest.start_url, '.');
  for (const icon of manifest.icons) assert.equal((await fetch(base + icon.src)).status, 200);
  console.log(`PASS ${config.basePath}: private-file isolation, missing API/assets, manifest/icons, anonymous media denial`);
  if (process.env.FREEQIFY_PLAYWRIGHT_MODULE) {
    const { chromium } = await import(pathToFileURL(process.env.FREEQIFY_PLAYWRIGHT_MODULE).href);
    browser = await chromium.launch({ executablePath: process.env.FREEQIFY_CHROME_BINARY || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const context = await browser.newContext(); const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await context.addCookies([{ name: 'freeqify_session', value: session.token, domain: '127.0.0.1', path: config.basePath, httpOnly: true, sameSite: 'Lax' }]);
    await page.goto(base); await page.getByRole('navigation', { name: 'Your space' }).getByRole('button', { name: 'Tracks', exact: true }).click();
    await page.waitForSelector('.track-play');
    for (const format of ['mp3', 'wav']) {
      const track = tracks.find(t => t.format?.toLowerCase() === format);
      await page.getByRole('button', { name: track.title, exact: true }).first().click();
      await page.waitForFunction(() => { const a = document.querySelector('audio'); return a && !a.paused && a.currentTime > 0.2; }, { timeout: 30000 });
      assert.equal(await page.locator('audio').count(), 1);
      console.log(`PASS headless Chromium ${format}: decoded audio with advancing playback time`);
      await page.waitForFunction(() => !document.querySelector('input[aria-label="Seek"]').disabled);
      const nativeSeek = page.getByRole('slider', { name: 'Seek', exact: true });
      await nativeSeek.fill('10'); await nativeSeek.dispatchEvent('change');
      await page.waitForFunction(() => document.querySelector('audio').currentTime >= 9);
      console.log(`PASS Chromium native ${format} seek`);
      if (format === 'wav') {
        await page.getByRole('button', { name: 'MP3 compatibility', exact: true }).click();
        await page.waitForFunction(() => { const a = document.querySelector('audio'); return a.src.includes('format=mp3') && !a.paused && a.currentTime > 0.2; });
        assert.equal(await page.getByRole('slider', { name: 'Seek', exact: true }).isDisabled(), true);
        console.log('PASS Chromium WAV → MP3 compatibility decoded playback; seek disabled');
      }
      await page.getByRole('button', { name: 'Pause', exact: true }).click();
      assert.equal(await page.locator('audio').evaluate(a => a.paused), true);
    }
    const node = await page.locator('audio').elementHandle();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.locator('.sidebar-nav').getByRole('button', { name: 'Albums', exact: true }).click();
    const albumId = (await (await get('library/albums?limit=48')).json()).items[0].id;
    const albumTracks = (await (await get(`library/albums/${encodeURIComponent(albumId)}`)).json()).tracks;
    await page.locator('.library-card').first().click(); await page.getByRole('button', { name: 'Play album' }).click();
    await page.waitForFunction(() => document.querySelector('audio').currentTime > 0.2);
    await page.getByText('playback-smoke', { exact: false }).first().click(); await page.getByRole('button', { name: 'Manage invitations & users' }).click();
    assert.equal(await node.evaluate(a => a === document.querySelector('audio') && !a.paused), true);
    await page.getByRole('button', { name: /^Queue \(/ }).click(); assert.equal(await page.locator('.player-queue li').count(), albumTracks.length);
    await page.getByRole('button', { name: /^Queue \(/ }).click();
    await page.getByRole('button', { name: 'Shuffle', exact: true }).click(); await page.getByRole('button', { name: 'Repeat off' }).click();
    await page.waitForTimeout(1600);
    const seek = page.getByRole('slider', { name: 'Seek', exact: true });
    if (await seek.isEnabled()) {
      await seek.fill('10'); await seek.dispatchEvent('change'); await page.waitForFunction(() => document.querySelector('audio').currentTime >= 9); console.log('PASS Chromium native seeking');
    }
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.waitForTimeout(15500);
    const position = await page.locator('audio').evaluate(a => a.currentTime);
    await page.reload(); await page.waitForSelector('audio[src]', { state: 'attached' }); await page.waitForFunction(() => document.querySelector('audio').readyState >= 1);
    assert.equal(await page.locator('audio').evaluate(a => a.paused), true);
    assert.ok(Math.abs(await page.locator('audio').evaluate(a => a.currentTime) - position) < 3);
    assert.equal(await page.getByRole('button', { name: 'Shuffle', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: 'Repeat all' }).waitFor();
    console.log('PASS Chromium navigation/admin continuity, queue, shuffle/repeat, paused reload restoration');
    for (const width of [320, 390, 760, 1280]) {
      await page.setViewportSize({ width, height: 850 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow at ${width}`);
      assert.ok(await page.getByRole('button', { name: 'Play', exact: true }).isVisible());
      await page.getByRole('button', { name: /^Queue \(/ }).click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `queue overflow at ${width}`);
      await page.getByRole('button', { name: /^Queue \(/ }).click();
      if (width === 390 && process.env.FREEQIFY_SCREENSHOT) await writeFile(process.env.FREEQIFY_SCREENSHOT.replace('.png', '-mobile.png'), await page.screenshot());
    }
    await page.screenshot({ path: join(temporary, 'mobile.png') });
    if (process.env.FREEQIFY_SCREENSHOT) await writeFile(process.env.FREEQIFY_SCREENSHOT, await page.screenshot({ fullPage: true }));
    console.log('PASS responsive widths 320, 390, 760, 1280');
    await page.getByText('playback-smoke', { exact: false }).first().click(); await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor(); assert.equal(await page.locator('audio').count(), 0);
    const invitation = store.createInvitation(owner.id, Date.now()+600000); const listener = await store.acceptInvitation(invitation.token, 'second-smoke', password); const other = store.createSession(listener);
    await context.addCookies([{ name: 'freeqify_session', value: other.token, domain: '127.0.0.1', path: config.basePath, httpOnly: true, sameSite: 'Lax' }]); await page.reload();
    await page.getByRole('button', { name: 'Queue (0)' }).waitFor(); assert.equal(await page.locator('audio').getAttribute('src'), null);
    assert.deepEqual(errors, []); console.log('PASS Chromium logout cleanup, second-user isolation, no browser exceptions');
    await context.close();
  } else console.log('Browser checks skipped: set FREEQIFY_PLAYWRIGHT_MODULE to an installed playwright-core index.mjs.');
} finally {
  await browser?.close(); await app.close(); await rm(temporary, { recursive: true, force: true });
}
