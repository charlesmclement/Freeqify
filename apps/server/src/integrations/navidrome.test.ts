import { expect, it, vi } from 'vitest';
import { Navidrome, LibraryError } from './navidrome.js';
import { readConfig } from '../config.js';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const config = readConfig({ NAVIDROME_USERNAME: 'private-user', NAVIDROME_PASSWORD: 'private-secret' }).navidrome;
function response(data: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ 'subsonic-response': { status: 'ok', version: '1.16.1', ...data } }), { headers: { 'content-type': 'application/json' } });
}
function setup(data: Record<string, unknown>) {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(data));
  return { client: new Navidrome(config, fetcher), fetcher };
}
it('connects with a fresh salted token in POST form data and no credentials in URL', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response());
  const client = new Navidrome(config, fetcher);
  await client.ping(); await client.ping();
  const [url, options] = fetcher.mock.calls[0]!;
  expect(String(url)).toBe('http://127.0.0.1:4533/rest/ping.view');
  expect(options).toMatchObject({ method: 'POST', redirect: 'error' });
  const body = options!.body as URLSearchParams;
  expect(body.get('p')).toBeNull(); expect(body.get('u')).toBe('private-user');
  expect(body.get('t')).toBe(createHash('md5').update('private-secret' + body.get('s')).digest('hex'));
  expect((fetcher.mock.calls[1]![1]!.body as URLSearchParams).get('s')).not.toBe(body.get('s'));
});
it('reports missing configuration without making an upstream request', async () => {
  const fetcher = vi.fn<typeof fetch>();
  await expect(new Navidrome(readConfig({}).navidrome, fetcher).ping()).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([40, 41, 50])('reports invalid credentials (%s) without upstream messages', async code => {
  const { client } = setup({ status: 'failed', error: { code, message: 'private-secret' } });
  await expect(client.ping()).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  await expect(client.ping()).rejects.not.toThrow('private-secret');
});
it('sanitizes transport errors and unavailable Navidrome', async () => {
  const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('private-secret private-user http://private-url'));
  const error = await new Navidrome(config, fetcher).ping().catch(error => error);
  expect(error).toBeInstanceOf(LibraryError);
  expect(error.code).toBe('UNAVAILABLE');
  expect(JSON.stringify(error)).not.toMatch(/private-/);
});
it('times out an unavailable engine', async () => {
  const fetcher: typeof fetch = async (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  await expect(new Navidrome({ ...config, timeoutMs: 10 }, fetcher).ping()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
});
it('handles an empty library with real zero counts', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => {
    const path = String(url);
    return response(path.includes('getArtists') ? { artists: {} } : path.includes('getAlbumList2') ? { albumList2: {} } : { scanStatus: { count: 0, scanning: false } });
  });
  const client = new Navidrome(config, fetcher);
  expect(await client.overview()).toEqual({ artists: 0, albums: 0, tracks: 0, scanning: false });
});
it('retrieves indexed artists and handles missing artist metadata and artwork', async () => {
  const { client } = setup({ artists: { index: [{ name: 'A', artist: [{ id: 'artist-1', name: 'A', albumCount: 2 }, { id: 'artist-2' }] }] } });
  expect(await client.artists()).toEqual([{ id: 'artist-1', name: 'A', albumCount: 2, artworkId: null }, { id: 'artist-2', name: 'Unknown artist', albumCount: 0, artworkId: null }]);
});
it('retrieves an artist and its albums using stable string IDs', async () => {
  const { client } = setup({ artist: { id: 'ar-123', name: 'Artist', album: [{ id: 'al-456', name: 'Album', artist: 'Artist' }] } });
  expect(await client.artist('ar-123')).toMatchObject({ artist: { id: 'ar-123' }, albums: [{ id: 'al-456', title: 'Album' }] });
});
it('paginates albums and passes only documented pagination parameters', async () => {
  const { client, fetcher } = setup({ albumList2: { album: [{ id: 'a1', name: 'Album', artist: 'Artist', coverArt: 'al-a1_0' }] } });
  expect(await client.albums(2, 1)).toMatchObject({ items: [{ id: 'a1', artworkId: 'al-a1_0' }], nextOffset: 3 });
  const body = fetcher.mock.calls[0]![1]!.body as URLSearchParams;
  expect(body.get('offset')).toBe('2'); expect(body.get('type')).toBe('alphabeticalByName');
});
it.each(['mp3', 'wav'])('retrieves %s metadata without conversion or private paths', async suffix => {
  const { client } = setup({ song: { id: 'song-1', title: 'Song', artist: 'Artist', album: 'Album', suffix, duration: 125.5, track: 1, path: '/private/music', username: 'private-user' } });
  const song = await client.track('song-1');
  expect(song).toMatchObject({ id: 'song-1', title: 'Song', format: suffix, duration: 125.5 });
  expect(JSON.stringify(song)).not.toMatch(/private|path|username/);
});
it('handles WAV files without tags, duration, or cover art', async () => {
  const { client } = setup({ album: { id: 'a', song: [{ id: 'wav-1', suffix: 'wav' }] } });
  expect(await client.album('a')).toMatchObject({ album: { title: 'Unknown album', artist: 'Unknown artist' }, tracks: [{ title: 'Untitled track', artist: 'Unknown artist', album: 'Unknown album', duration: null, artworkId: null, format: 'wav' }] });
});
it('searches all three categories and enumerates tracks with empty-query search3', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response({ searchResult3: { artist: [{ id: 'a', name: 'Artist' }], album: [{ id: 'b', name: 'Album' }], song: [{ id: 'c', title: 'Track' }] } }));
  const client = new Navidrome(config, fetcher);
  expect(await client.search('test & words', 0, 48)).toMatchObject({ artists: [{ id: 'a' }], albums: [{ id: 'b' }], tracks: [{ id: 'c' }] });
  expect((fetcher.mock.calls[0]![1]!.body as URLSearchParams).get('query')).toBe('test & words');
  expect(await client.tracks(0, 48)).toMatchObject({ items: [{ id: 'c' }], nextOffset: null });
});
it('retrieves bounded artwork as image bytes without forwarding upstream headers', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array([255, 216, 255]), { headers: { 'content-type': 'image/jpeg', 'set-cookie': 'private-secret' } }));
  expect(await new Navidrome(config, fetcher).artwork('al-1_0')).toEqual({ bytes: Buffer.from([255, 216, 255]), contentType: 'image/jpeg' });
});
it('handles missing artwork through Subsonic error 70', async () => {
  const { client } = setup({ status: 'failed', error: { code: 70, message: 'private path' } });
  await expect(client.artwork('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
});
it('rejects SVG, oversized media, and redirects', async () => {
  for (const value of [new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }), new Response('oversized', { headers: { 'content-type': 'image/jpeg', 'content-length': '9000000' } })]) {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(value);
    await expect(new Navidrome(config, fetcher).artwork('id')).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' });
  }
});
it.each([null, {}, { 'subsonic-response': [] }, { 'subsonic-response': { status: 'maybe' } }])('rejects malformed envelopes', async value => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(value)));
  await expect(new Navidrome(config, fetcher).ping()).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' });
});
it.each([{ artists: null }, { artists: { index: 'wrong' } }, { artists: { index: [{ artist: [{ id: '../../secret' }] }] } }])('rejects malformed catalog data', async value => {
  await expect(setup(value).client.artists()).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' });
});
it('requires owner-only permissions for a password file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'freeqify-secret-'));
  try {
    const path = join(dir, 'password'); writeFileSync(path, 'secret', { mode: 0o644 });
    expect(() => new Navidrome({ ...config, passwordFile: path })).toThrow('owner-only');
  } finally { rmSync(dir, { recursive: true }); }
});
it('streams through supported POST with raw/MP3 options, Range and cancellation signal', async () => {
  const signal = new AbortController().signal;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => String(url).includes('getSong') ? response({ song: { id: 'song-1' } }) : new Response(new Uint8Array([1]), { headers: { 'content-type': 'audio/mpeg' } }));
  const client = new Navidrome(config, fetcher);
  const raw = await client.stream('song-1', 'raw', 'bytes=0-9', signal); await raw.body?.cancel();
  const [url, init] = fetcher.mock.calls[1]!; expect(String(url)).toBe('http://127.0.0.1:4533/rest/stream.view'); expect(String(url)).not.toMatch(/private-|[?]/);
  expect(init).toMatchObject({ method: 'POST', redirect: 'error', signal, headers: { Range: 'bytes=0-9' } });
  const params = init!.body as URLSearchParams; expect(params.get('format')).toBe('raw'); expect(params.get('maxBitRate')).toBe('0'); expect(params.get('p')).toBeNull(); expect(params.get('u')).toBe('private-user');
  const mp3 = await client.stream('song-1', 'mp3', undefined, signal); await mp3.body?.cancel(); expect((fetcher.mock.calls[3]![1]!.body as URLSearchParams).get('maxBitRate')).toBe('320');
});
it('rejects missing stream tracks using sanitized metadata errors before audio fetch', async () => {
  const { client, fetcher } = setup({ status: 'failed', error: { code: 70, message: 'private-secret' } });
  await expect(client.stream('missing', 'raw', undefined, new AbortController().signal)).rejects.toMatchObject({ code: 'NOT_FOUND' }); expect(fetcher).toHaveBeenCalledTimes(1);
});

it('accepts Navidrome disc-art IDs without relaxing track identifiers',async()=>{const {client}=setup({song:{id:'song-1',coverArt:'dc-abcdefghijklmnopqrstuv:1_0'}});expect((await client.track('song-1')).artworkId).toBe('dc-abcdefghijklmnopqrstuv:1_0');});
it.each(['newest','alphabeticalByArtist'] as const)('requests documented %s album ordering',async sort=>{
 const {client,fetcher}=setup({albumList2:{album:[]}});await client.albums(0,8,sort);
 expect((fetcher.mock.calls[0]![1]!.body as URLSearchParams).get('type')).toBe(sort);
});

it('starts and checks scans using only supported fixed Subsonic endpoints',async()=>{
 const fetcher=vi.fn<typeof fetch>().mockImplementation(async()=>response({scanStatus:{scanning:true,count:301}}));const client=new Navidrome(config,fetcher);
 expect(await client.startScan()).toEqual({scanning:true,count:301});await client.scanStatus();
 expect(fetcher.mock.calls.map(([u])=>new URL(String(u)).pathname)).toEqual(['/rest/startScan.view','/rest/getScanStatus.view']);
 expect(fetcher.mock.calls.every(([,options])=>!(options!.body as URLSearchParams).has('path'))).toBe(true);
});
it('rejects malformed scan state',async()=>{const {client}=setup({scanStatus:{scanning:'yes',count:1}});await expect(client.startScan()).rejects.toMatchObject({code:'MALFORMED_RESPONSE'});});

it('uses optional private scan credentials only for startScan, preserving ordinary catalog credentials',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'freeqify-scan-key-'));const file=join(dir,'scan-key');writeFileSync(file,'disposable-scanner-secret',{mode:0o600});
 try{const fetcher=vi.fn<typeof fetch>().mockImplementation(async()=>response({scanStatus:{scanning:false,count:301}}));const client=new Navidrome({...config,scanUsername:'disposable-scanner',scanPasswordFile:file},fetcher);await client.startScan();await client.scanStatus();await client.ping();expect(fetcher.mock.calls.map(([,o])=>(o!.body as URLSearchParams).get('u'))).toEqual(['disposable-scanner','private-user','private-user']);expect(fetcher.mock.calls.every(([u])=>!String(u).includes('secret'))).toBe(true);}finally{rmSync(dir,{recursive:true,force:true});}
});
it('rejects incomplete scanner credential configuration',()=>{expect(()=>readConfig({NAVIDROME_SCAN_USERNAME:'scanner'})).toThrow('Configure both');});
