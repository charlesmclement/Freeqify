/** Optional, read-only online artwork discovery. Nothing here modifies music files. */
import { setTimeout as delay } from 'node:timers/promises';
import type { Artwork } from './integrations/navidrome.js';

const musicBrainz = 'https://musicbrainz.org/ws/2/release-group/';
const coverArchive = 'https://coverartarchive.org';
const maxMetadataBytes = 256 * 1024;
const maxImageBytes = 3 * 1024 * 1024;
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const positiveTtl = 24 * 60 * 60 * 1000;
const negativeTtl = 6 * 60 * 60 * 1000;

export type Outcome =
  | { kind: 'found'; artwork: Artwork }
  | { kind: 'missing' }
  | { kind: 'unavailable' };

export interface ArtworkCandidate { id: string; title: string; artist: string; year: string }
export type ArtworkSearch = { kind: 'results'; items: ArtworkCandidate[] } | { kind: 'unavailable' };

export interface OnlineArtworkOptions {
  /** MusicBrainz requests require an identifiable application and contact. Not a credential. */
  contact: string;
  /** Injectable transport and limiter make tests entirely offline. */
  fetcher?: typeof fetch;
  acquireMusicBrainzSlot?: () => Promise<void>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function normalized(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, ' ').trim();
}

function quotedSearch(value: string): string {
  return `"${value.replace(/[\\"]/g, '\\$&')}"`;
}

function creditName(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value.map(part => {
    if (typeof part === 'string') return part;
    const item = record(part);
    const artist = record(item?.artist);
    const name = typeof item?.name === 'string' ? item.name
      : typeof artist?.name === 'string' ? artist.name : '';
    return name + (typeof item?.joinphrase === 'string' ? item.joinphrase : '');
  }).join('');
}

function permittedCoverHost(url: URL): boolean {
  return url.protocol === 'https:' && !url.username && !url.password && !url.port
    && (url.hostname === 'coverartarchive.org' || url.hostname === 'archive.org'
      || url.hostname.endsWith('.archive.org'));
}

export function imageType(bytes: Buffer, contentType: string): string | null {
  const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (contentType === 'image/jpeg' && jpeg) return 'image/jpeg';
  if (contentType === 'image/png' && png) return 'image/png';
  if (contentType === 'image/webp' && webp) return 'image/webp';
  return null;
}

async function boundedBytes(response: Response, maximum: number): Promise<Buffer | null> {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum)) return null;
  const reader = response.body?.getReader();
  if (!reader) return null;
  let size = 0;
  const pieces: Buffer[] = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        return null;
      }
      pieces.push(Buffer.from(part.value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(pieces, size);
}

// One request per 1.2 seconds across instances inside this process.
let nextMusicBrainzRequest = 0;
let requestQueue: Promise<void> = Promise.resolve();
async function acquireMusicBrainzSlot(): Promise<void> {
  const previous = requestQueue;
  let release!: () => void;
  requestQueue = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try {
    const pause = Math.max(0, nextMusicBrainzRequest - Date.now());
    if (pause) await delay(pause);
    nextMusicBrainzRequest = Date.now() + 1200;
  } finally {
    release();
  }
}

export class OnlineAlbumArtwork {
  private readonly fetcher: typeof fetch;
  private readonly slot: () => Promise<void>;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly userAgent: string;
  private readonly cache = new Map<string, { expires: number; result: Exclude<Outcome, { kind: 'unavailable' }> }>();
  private readonly pending = new Map<string, Promise<Outcome>>();

  constructor(options: OnlineArtworkOptions) {
    if (!options.contact || options.contact.length > 200 || /[\r\n]/.test(options.contact)) {
      throw new Error('A MusicBrainz contact address or URL is required');
    }
    this.userAgent = `Freeqify/0.1.0 (${options.contact})`;
    this.fetcher = options.fetcher ?? fetch;
    this.slot = options.acquireMusicBrainzSlot ?? acquireMusicBrainzSlot;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? delay;
  }

  async find(artist: string, album: string): Promise<Artwork | null> {
    const result = await this.lookup(artist, album);
    return result.kind === 'found' ? result.artwork : null;
  }

  async lookup(artist: string, album: string): Promise<Outcome> {
    if (!artist.trim() || !album.trim() || artist.length > 200 || album.length > 200
      || normalized(artist) === 'unknown artist'
      || normalized(album) === 'unknown album') {
      return { kind: 'missing' };
    }

    const cacheKey = `${normalized(artist)}\0${normalized(album)}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expires > this.now()) return cached.result;

    let operation = this.pending.get(cacheKey);
    if (!operation) {
      operation = this.resolve(artist, album);
      this.pending.set(cacheKey, operation);
    }

    try {
      const result = await operation;
      if (result.kind !== 'unavailable') {
        this.cache.set(cacheKey, {
          result,
          expires: this.now() + (
            result.kind === 'found' ? positiveTtl : negativeTtl
          ),
        });
      }
      return result;
    } finally {
      if (this.pending.get(cacheKey) === operation) {
        this.pending.delete(cacheKey);
      }
    }
  }

  /** Interactive search permits ambiguous matches; only the administrator chooses. */
  async search(artist: string, album: string): Promise<ArtworkSearch> {
    if (!album.trim() || artist.length > 200 || album.length > 200) return {kind:'results',items:[]};
    try {
      const url = new URL(musicBrainz);
      const query = `releasegroup:${quotedSearch(album)}${artist.trim() ? ` AND artistname:${quotedSearch(artist)}` : ''}`;
      url.search = new URLSearchParams({query,fmt:'json',limit:'6'}).toString();
      const response = await this.request(url,{redirect:'error',headers:{'User-Agent':this.userAgent,Accept:'application/json'}},true);
      if (!response?.ok) return {kind:'unavailable'};
      const bytes = await boundedBytes(response,maxMetadataBytes);
      if (!bytes) return {kind:'unavailable'};
      const groups = record(JSON.parse(bytes.toString('utf8')))?.['release-groups'];
      if (!Array.isArray(groups)) return {kind:'unavailable'};
      const items: ArtworkCandidate[] = [];
      for (const value of groups.slice(0,6)) {
        const group = record(value);
        if (!group || typeof group.id !== 'string' || !uuid.test(group.id)
          || typeof group.title !== 'string' || !group.title.trim() || group.title.length > 200) continue;
        const name = creditName(group['artist-credit']);
        if (name.length > 200 || items.some(item=>item.id===group.id)) continue;
        const date = group['first-release-date'];
        items.push({id:group.id,title:group.title,artist:name,
          year:typeof date==='string' && /^\d{4}/.test(date) ? date.slice(0,4) : ''});
      }
      return {kind:'results',items};
    } catch { return {kind:'unavailable'}; }
  }

  async candidateCover(id: string): Promise<Outcome> {
    if (!uuid.test(id)) return {kind:'missing'};
    try { return await this.cover(id); } catch { return {kind:'unavailable'}; }
  }

  private async request(
    url: URL,
    init: RequestInit,
    musicBrainzRequest: boolean,
  ): Promise<Response | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      // Every MusicBrainz attempt gets a fresh rate-limit slot.
      if (musicBrainzRequest) await this.slot();

      try {
        const response = await this.fetcher(url, {
          ...init,
          signal: AbortSignal.timeout(8000),
        });

        if (attempt === 0
          && [502, 503, 504].includes(response.status)
          && !response.headers.has('retry-after')) {
          await response.body?.cancel().catch(() => {});
          if (!musicBrainzRequest) await this.sleep(1200);
          continue;
        }

        return response;
      } catch {
        if (attempt !== 0) return null;
        if (!musicBrainzRequest) await this.sleep(1200);
      }
    }
    return null;
  }

  private async resolve(artist: string, album: string): Promise<Outcome> {
    try {
      const query = `releasegroup:${quotedSearch(album)} AND artistname:${quotedSearch(artist)}`;
      const url = new URL(musicBrainz);
      url.search = new URLSearchParams({ query, fmt: 'json', limit: '10' }).toString();
      const response = await this.request(url, {
        redirect: 'error',
        headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
      }, true);
      if (!response?.ok) return { kind: 'unavailable' };
      const bytes = await boundedBytes(response, maxMetadataBytes);
      if (!bytes) return { kind: 'unavailable' };
      const document = record(JSON.parse(bytes.toString('utf8')));
      const groups = document?.['release-groups'];
      if (!Array.isArray(groups)) return { kind: 'unavailable' };
      const matches = new Set<string>();
      for (const item of groups) {
        const group = record(item);
        if (!group || typeof group.title !== 'string' || typeof group.id !== 'string'
          || !uuid.test(group.id) || typeof group.score !== 'number' || group.score < 90) continue;
        if (normalized(group.title) === normalized(album)
          && normalized(creditName(group['artist-credit'])) === normalized(artist)) {
          matches.add(group.id);
        }
      }
      if (matches.size !== 1) return { kind: 'missing' }; // No guesswork for ambiguous editions.
      return await this.cover([...matches][0]!);
    } catch {
      // Never propagate remote URLs, API contents, or implementation details to users.
      return { kind: 'unavailable' };
    }
  }

  private async cover(mbid: string): Promise<Outcome> {
    let url = new URL(`/release-group/${mbid}/front-500`, coverArchive);
    for (let hop = 0; hop < 5; hop++) {
      if (!permittedCoverHost(url)) return { kind: 'unavailable' };
      const response = await this.request(url, {
        redirect: 'manual',
        headers: { 'User-Agent': this.userAgent, Accept: 'image/jpeg,image/png,image/webp' },
      }, false);
      if (!response) return { kind: 'unavailable' };
      if (response.status === 404) return { kind: 'missing' };
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) return { kind: 'unavailable' };
        url = new URL(location, url);
        continue;
      }
      if (!response.ok) return { kind: 'unavailable' };
      const bytes = await boundedBytes(response, maxImageBytes);
      if (!bytes) return { kind: 'unavailable' };
      const contentType = imageType(bytes, response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '');
      return contentType ? { kind: 'found', artwork: { bytes, contentType } } : { kind: 'unavailable' };
    }
    return { kind: 'unavailable' };
  }
}
