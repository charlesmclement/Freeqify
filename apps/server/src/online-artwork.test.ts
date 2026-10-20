import { describe, expect, it, vi } from 'vitest';
import { OnlineAlbumArtwork } from './online-artwork.js';

const id = '48140466-cff6-3222-bd55-63c27e43190d';
const picture = Buffer.from([255, 216, 255, 0, 8, 9, 10, 11]);
const group = (overrides: Record<string, unknown> = {}) => ({
  id, title: 'Clayman', score: 100,
  'artist-credit': [{ name: 'In Flames' }], ...overrides,
});

function provider(options: {
  groups?: unknown[];
  coverStatus?: number;
  redirect?: string;
  image?: Buffer;
  imageType?: string;
  failures?: number;
  networkFailures?: number;
  coverFailures?: number;
  retryAfter?: boolean;
} = {}) {
  let failures = options.failures ?? 0;
  let networkFailures = options.networkFailures ?? 0;
  let coverFailures = options.coverFailures ?? 0;
  const calls: string[] = [];
  const fetcher = vi.fn(async (request: string | URL) => {
    const url = new URL(String(request));
    calls.push(url.href);
    if (url.hostname === 'musicbrainz.org') {
      if (networkFailures > 0) {
        networkFailures--;
        throw new Error('ETIMEDOUT');
      }
      if (failures > 0) {
        failures--;
        return new Response(null, {
          status: 503,
          headers: options.retryAfter ? { 'Retry-After': '60' } : {},
        });
      }
      return Response.json({ 'release-groups': options.groups ?? [group()] });
    }
    if (url.hostname === 'coverartarchive.org') {
      if (coverFailures > 0) {
        coverFailures--;
        throw new Error('ETIMEDOUT');
      }
      if (options.coverStatus === 404) return new Response(null, { status: 404 });
      return new Response(null, { status: 307, headers: {
        location: options.redirect ?? 'https://archive.org/download/mbid-cover/front.jpg',
      } });
    }
    if (url.hostname === 'archive.org') {
      return new Response(new Uint8Array(options.image ?? picture), { headers: {
        'content-type': options.imageType ?? 'image/jpeg',
      } });
    }
    throw new Error('Request to unexpected host');
  });
  const service = new OnlineAlbumArtwork({
    contact: 'test@example.invalid', fetcher: fetcher as unknown as typeof fetch,
    acquireMusicBrainzSlot: async () => {},
    sleep: async () => {},
  });
  return { service, fetcher, calls };
}

describe('online album artwork (offline mocks)', () => {
  it('finds a matching release group and verifies cover bytes', async () => {
    const p = provider();
    const image = await p.service.find('In Flames', 'Clayman');
    expect(image?.contentType).toBe('image/jpeg');
    expect(image?.bytes.equals(picture)).toBe(true);
    expect(p.calls).toHaveLength(3);
    expect(new URL(p.calls[0]!).searchParams.get('query')).toContain('Clayman');
  });

  it('caches a successful lookup rather than re-fetching', async () => {
    const p = provider();
    await p.service.find('In Flames', 'Clayman');
    await p.service.find('in flames', 'CLAYMAN');
    expect(p.calls).toHaveLength(3);
  });

  it('ignores incorrect artist or title even with a high score', async () => {
    const p = provider({ groups: [group({ title: 'Clayman Live' })] });
    expect(await p.service.find('In Flames', 'Clayman')).toBeNull();
    expect(p.calls).toHaveLength(1);
  });

  it('rejects ambiguous release groups rather than picking one', async () => {
    const p = provider({ groups: [group(), group({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' })] });
    expect(await p.service.find('In Flames', 'Clayman')).toBeNull();
    expect(p.calls).toHaveLength(1);
  });

  it('returns no image if the archive has no front cover', async () => {
    const p = provider({ coverStatus: 404 });
    expect(await p.service.find('In Flames', 'Clayman')).toBeNull();
    expect(p.calls).toHaveLength(2);
  });

  it('blocks redirects away from trusted cover archive hosts', async () => {
    const p = provider({ redirect: 'http://127.0.0.1/private' });
    expect(await p.service.find('In Flames', 'Clayman')).toBeNull();
    expect(p.calls).toHaveLength(2);
  });

  it('rejects images with a mismatched content-type and magic bytes', async () => {
    const p = provider({ imageType: 'image/png' });
    expect(await p.service.find('In Flames', 'Clayman')).toBeNull();
  });

  it('does not negatively cache a temporary MusicBrainz failure', async () => {
    const p = provider({ failures: 2 });
    expect(await p.service.find('In Flames', 'Clayman')).toBeNull();
    expect((await p.service.find('In Flames', 'Clayman'))?.contentType).toBe('image/jpeg');
    expect(p.calls).toHaveLength(5);
  });

  it('ignores unknown or excessively long metadata without network access', async () => {
    const p = provider();
    expect(await p.service.find('Unknown artist', 'Clayman')).toBeNull();
    expect(await p.service.find('In Flames', 'x'.repeat(201))).toBeNull();
    expect(p.calls).toHaveLength(0);
  });

  it('retries one MusicBrainz 503 and succeeds', async () => {
    const p = provider({ failures: 1 });
    expect((await p.service.lookup('In Flames', 'Clayman')).kind).toBe('found');
    expect(p.calls).toHaveLength(4);
  });

  it('retries a temporary MusicBrainz network error', async () => {
    const p = provider({ networkFailures: 1 });
    expect((await p.service.lookup('In Flames', 'Clayman')).kind).toBe('found');
    expect(p.calls).toHaveLength(4);
  });

  it('retries a temporary Cover Art Archive network error', async () => {
    const p = provider({ coverFailures: 1 });
    expect((await p.service.lookup('In Flames', 'Clayman')).kind).toBe('found');
    expect(p.calls).toHaveLength(4);
  });

  it('does not immediately retry when Retry-After is supplied', async () => {
    const p = provider({ failures: 1, retryAfter: true });
    expect((await p.service.lookup('In Flames', 'Clayman')).kind)
      .toBe('unavailable');
    expect(p.calls).toHaveLength(1);
  });

});

it('offers ambiguous interactive results without relaxing automatic matching',async()=>{
 const second='58140466-cff6-3222-bd55-63c27e43190d';
 const p=provider({groups:[group(),group({id:second,title:'Clayman (deluxe)',score:80}),group({id:'http://localhost'})]});
 const result=await p.service.search('In Flames','Clayman');
 expect(result).toEqual({kind:'results',items:[{id,title:'Clayman',artist:'In Flames',year:''},{id:second,title:'Clayman (deluxe)',artist:'In Flames',year:''}]});
 expect(p.calls).toHaveLength(1);
 expect((await p.service.candidateCover(second)).kind).toBe('found');
 const before=p.calls.length;expect((await p.service.candidateCover('https://evil.invalid')).kind).toBe('missing');expect(p.calls).toHaveLength(before);
});
it('allows album-only interactive search and escapes provider query syntax',async()=>{
 const p=provider();await p.service.search('','Clayman');
 expect(new URL(p.calls[0]!).searchParams.get('query')).toBe('releasegroup:"Clayman"');
 await p.service.search('A" OR artist:*','B\\C');
 const query=new URL(p.calls[1]!).searchParams.get('query');
 expect(query).toContain('artistname:"A\\" OR artist:*"');expect(query).toContain('releasegroup:"B\\\\C"');
});
it('rejects unsafe candidate images and redirect destinations',async()=>{
 expect((await provider({redirect:'http://127.0.0.1/private'}).service.candidateCover(id)).kind).toBe('unavailable');
 expect((await provider({image:Buffer.from('<svg/>'),imageType:'image/svg+xml'}).service.candidateCover(id)).kind).toBe('unavailable');
 expect((await provider({image:Buffer.alloc(3*1024*1024+1)}).service.candidateCover(id)).kind).toBe('unavailable');
});
