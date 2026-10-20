import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
const base = new URL(process.env.FREEQIFY_SMOKE_URL || 'http://127.0.0.1:3000/');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || !['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || !base.pathname.endsWith('/')) throw new Error('Use a loopback Freeqify URL ending in /');
const cookieFile = process.env.FREEQIFY_SMOKE_COOKIE_FILE;
assert(cookieFile, 'Use the Phase 2 integration runner, or provide a private session cookie file.');
assert.equal((await stat(cookieFile)).mode & 0o077, 0, 'Cookie file must have owner-only permissions');
const sessionCookie = (await readFile(cookieFile, 'utf8')).trim();
const authenticatedFetch = (url, options = {}) => fetch(url, { ...options, headers: { cookie: sessionCookie, ...options.headers } });
async function get(path) {
  const response = await authenticatedFetch(new URL(`api/library/${path}`, base), { signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200, `Library check failed: ${path.split('?')[0]}`);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return response;
}
assert.equal((await (await get('connection')).json()).status, 'connected');
const overview = await (await get('overview')).json();
const artists = (await (await get('artists')).json()).items;
assert.equal(artists.length, overview.artists);
if (artists.length) {
  const detail = await (await get(`artists/${encodeURIComponent(artists[0].id)}`)).json();
  assert.equal(detail.artist.id, artists[0].id);
  const result = await (await get(`search?q=${encodeURIComponent(artists[0].name)}`)).json();
  assert(Array.isArray(result.artists) && Array.isArray(result.albums) && Array.isArray(result.tracks));
}
const albums = []; const tracks = [];
for (const [kind, items] of [['albums', albums], ['tracks', tracks]]) {
  let offset = 0;
  for (let pages = 0; ; pages++) {
    assert(pages < 2000, 'Smoke pagination limit exceeded');
    const page = await (await get(`${kind}?offset=${offset}&limit=100`)).json(); items.push(...page.items);
    if (page.nextOffset === null) break;
    assert(page.nextOffset > offset); offset = page.nextOffset;
  }
}
assert.equal(albums.length, overview.albums);
assert.equal(tracks.length, overview.tracks);
if (albums.length) {
  const detail = await (await get(`albums/${encodeURIComponent(albums[0].id)}`)).json();
  assert.equal(detail.album.id, albums[0].id); assert(Array.isArray(detail.tracks));
}
if (tracks.length) {
  const detail = await (await get(`tracks/${encodeURIComponent(tracks[0].id)}`)).json();
  assert.equal(detail.id, tracks[0].id); assert(!('path' in detail));
}
let artwork = 'no artwork identifiers available';
const cover = albums.find(album => album.artworkId);
if (cover) {
  const response = await authenticatedFetch(new URL(`api/library/artwork/${encodeURIComponent(cover.artworkId)}`, base));
  assert([200,404].includes(response.status));
  if (response.ok) { assert(/^image\/(jpeg|png|webp|gif)/.test(response.headers.get('content-type'))); artwork = `verified (${(await response.arrayBuffer()).byteLength} bytes)`; }
  else artwork = 'missing artwork handled with 404';
}
const denied = await authenticatedFetch(new URL('api/library/artists', base), { headers: { Origin: 'https://foreign.example' } });
assert.equal(denied.status, 403);
assert.equal((await authenticatedFetch(new URL('api/stream', base))).status, 404);
const formats = {};
for (const track of tracks) formats[track.format ?? 'unknown'] = (formats[track.format ?? 'unknown'] ?? 0) + 1;
console.log(JSON.stringify({ connection: 'verified', ...overview, formats, artwork, localAccess: 'verified', legacyStreamEndpoint: 'absent'  }, null, 2));
