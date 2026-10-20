import {catalogSignal} from '../catalog-budget.js';
import { createHash, randomBytes } from 'node:crypto';
import { readPrivateFile } from '../../../../scripts/private-files.mjs';
import type { AlbumSort, Album, AlbumDetail, Artist, ArtistDetail, LibraryErrorCode, LibraryOverview, LibraryScanStatus, Page, SearchResults, Track } from '@freeqify/shared';
import type { Config } from '../config.js';

const messages: Record<LibraryErrorCode, string> = {
  NOT_CONFIGURED: 'Configure the local music engine to connect your library.',
  INVALID_CREDENTIALS: 'The music engine rejected its service credentials. Check server configuration.',
  UNAVAILABLE: 'The local music engine is unavailable. Check that Navidrome is running.',
  MALFORMED_RESPONSE: 'The music engine returned an unsupported response.',
  NOT_FOUND: 'This library item or artwork is unavailable.',
  INVALID_REQUEST: 'The library request is invalid.',
};
export class LibraryError extends Error {
  constructor(public readonly code: LibraryErrorCode) { super(messages[code]); }
}
function malformed(): never { throw new LibraryError('MALFORMED_RESPONSE'); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return malformed();
  return value as Record<string, unknown>;
}
function list(value: unknown): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return malformed();
  return value;
}
export function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value);
}
export function validArtworkId(value: unknown): value is string {
  return validId(value) || (typeof value==='string' && /^dc-[A-Za-z0-9_-]{1,128}:\d{1,5}(?:_\d{1,10})?$/.test(value));
}
function optionalArtwork(value: unknown): string | null {if(value==null||value==='')return null;if(!validArtworkId(value))return malformed();return value;}
function id(value: unknown): string { if (!validId(value)) return malformed(); return value; }
function optionalId(value: unknown): string | null { return value == null || value === '' ? null : id(value); }
function text(value: unknown, fallback: string): string {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string' || value.length > 10000) return malformed();
  return value.trim() || fallback;
}
function number(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return malformed();
  return value;
}
function artist(value: unknown): Artist {
  const v = object(value);
  return { id: id(v.id), name: text(v.name, 'Unknown artist'), albumCount: number(v.albumCount) ?? 0, artworkId: optionalArtwork(v.coverArt) };
}
function album(value: unknown): Album {
  const v = object(value);
  return { id: id(v.id), title: text(v.name ?? v.title, 'Unknown album'), artist: text(v.artist, 'Unknown artist'), artistId: optionalId(v.artistId), artworkId: optionalArtwork(v.coverArt), trackCount: number(v.songCount) ?? 0, year: number(v.year) };
}
function track(value: unknown): Track {
  const v = object(value);
  return { ...(typeof v.isrc==='string'?{isrc:v.isrc}:{}), id: id(v.id), title: text(v.title, 'Untitled track'), artist: text(v.artist, 'Unknown artist'), album: text(v.album, 'Unknown album'), albumId: optionalId(v.albumId), duration: number(v.duration), format: text(v.suffix, '') || null, trackNumber: number(v.track), artworkId: optionalArtwork(v.coverArt) };
}
export interface Artwork { bytes: Buffer; contentType: string }
export interface MusicLibrary {
  stream?(id: string, format: 'raw' | 'mp3', range: string | undefined, signal: AbortSignal): Promise<Response>;
  ping(): Promise<void>; artists(): Promise<Artist[]>; artist(id: string): Promise<ArtistDetail>;
  albums(offset: number, limit: number, sort?: AlbumSort): Promise<Page<Album>>; album(id: string): Promise<AlbumDetail>;
  tracks(offset: number, limit: number): Promise<Page<Track>>; track(id: string): Promise<Track>;
  search(query: string, offset: number, limit: number): Promise<SearchResults>;
  scanStatus?(): Promise<LibraryScanStatus>; startScan?(): Promise<LibraryScanStatus>;
  overview(): Promise<LibraryOverview>; artwork(id: string): Promise<Artwork>;
}

/** Supported Subsonic 1.16.1 only. No streaming, arbitrary URL, or filesystem interface. */
export class Navidrome implements MusicLibrary {
  private readonly password: string;
  private readonly configured: boolean;
  private readonly scanPassword: string;
  private overviewCache: { expires: number; value: LibraryOverview } | undefined;
  private overviewPending: Promise<LibraryOverview> | undefined;
  constructor(private readonly config: Config['navidrome'], private readonly fetcher: typeof fetch = fetch) {
    this.password = config.password;
    this.scanPassword = config.scanPasswordFile ? readPrivateFile(config.scanPasswordFile,false,4096)!.replace(/\r?\n$/, '') : '';
    if (config.passwordFile) {
      try {
        this.password = readPrivateFile(config.passwordFile,false,4096)!.replace(/\r?\n$/, '');
      } catch { throw new Error('Cannot read private NAVIDROME_PASSWORD_FILE; use an owner-only readable file'); }
    }
    this.configured = Boolean(config.username && this.password);
  }
  async stream(itemId: string, format: 'raw' | 'mp3', range: string | undefined, signal: AbortSignal): Promise<Response> {
    if (!this.configured) throw new LibraryError('NOT_CONFIGURED');
    track((await this.json('getSong', { id: itemId }, signal)).song); // Bounded existence check shares cancellation.
    const salt = randomBytes(24).toString('hex');
    const body = new URLSearchParams({ u: this.config.username, t: createHash('md5').update(this.password + salt).digest('hex'), s: salt, v: '1.16.1', c: 'Freeqify', f: 'json', id: itemId, format, maxBitRate: format === 'mp3' ? '320' : '0' });
    return this.fetcher(new URL('rest/stream.view', this.config.url), {
      method: 'POST', body, redirect: 'error', signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(range ? { Range: range } : {}) },
    });
  }
  private async request(endpoint: string, params: Record<string, string> = {}, binary = false, signal?: AbortSignal): Promise<Record<string, unknown> | Artwork> {
    if (!this.configured) throw new LibraryError('NOT_CONFIGURED');
    const operation=catalogSignal.getStore();operation?.throwIfAborted();
    const salt = randomBytes(24).toString('hex');
    const url = new URL(`rest/${endpoint}.view`, this.config.url);
    const scanning = endpoint === 'startScan' && this.scanPassword && this.config.scanUsername;
    const query = new URLSearchParams({ u: scanning ? this.config.scanUsername! : this.config.username, t: createHash('md5').update((scanning ? this.scanPassword : this.password) + salt).digest('hex'), s: salt, v: '1.16.1', c: 'Freeqify', f: 'json', ...params });
    // POST keeps authentication material out of request URLs and access logs.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.fetcher(url, { method: 'POST', body: query, redirect: 'error', signal: AbortSignal.any([controller.signal,...(signal?[signal]:[]),...(operation?[operation]:[])]), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (!response.ok) throw new LibraryError(response.status === 401 || response.status === 403 ? 'INVALID_CREDENTIALS' : response.status === 404 ? 'NOT_FOUND' : 'UNAVAILABLE');
      const max = binary ? 5 * 1024 * 1024 : 8 * 1024 * 1024;
      if (Number(response.headers.get('content-length')) > max) return malformed();
      const reader = response.body?.getReader();
      if (!reader) return malformed();
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.length; if (size > max) { await reader.cancel(); return malformed(); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const bytes = Buffer.concat(chunks);
      const contentType = response.headers.get('content-type')?.split(';')[0] ?? '';
      if (binary && ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(contentType)) {
        return { bytes, contentType };
      }
      let json: unknown;
      try { json = JSON.parse(bytes.toString('utf8')); } catch { return malformed(); }
      const envelope = object(object(json)['subsonic-response']);
      if (envelope.status === 'failed') {
        const code = object(envelope.error).code;
        throw new LibraryError([40, 41, 42, 43, 44, 50].includes(Number(code)) ? 'INVALID_CREDENTIALS' : code === 70 ? 'NOT_FOUND' : 'UNAVAILABLE');
      }
      if (envelope.status !== 'ok' || binary) return malformed();
      return envelope;
    } catch (error) {
      if (error instanceof LibraryError) throw error;
      // Never propagate fetch errors: they can contain credentials, URLs, or upstream data.
      throw new LibraryError('UNAVAILABLE');
    } finally { clearTimeout(timer); }
  }
  private async json(endpoint: string, params?: Record<string, string>, signal?: AbortSignal) {
    return await this.request(endpoint, params, false, signal) as Record<string, unknown>;
  }
  async ping() { await this.json('ping'); }
  async artists() {
    const data = object((await this.json('getArtists')).artists);
    return list(data.index).flatMap(index => list(object(index).artist).map(artist));
  }
  async artist(itemId: string): Promise<ArtistDetail> {
    const data = object((await this.json('getArtist', { id: itemId })).artist);
    return { artist: artist(data), albums: list(data.album).map(album) };
  }
  async albums(offset: number, limit: number, sort: AlbumSort = 'alphabeticalByName'): Promise<Page<Album>> {
    const data = object((await this.json('getAlbumList2', { type: sort, size: String(limit), offset: String(offset) })).albumList2);
    const items = list(data.album).map(album);
    return { items, nextOffset: items.length === limit ? offset + limit : null };
  }
  async album(itemId: string): Promise<AlbumDetail> {
    const data = object((await this.json('getAlbum', { id: itemId })).album);
    return { album: album(data), tracks: list(data.song).map(track) };
  }
  async track(itemId: string) { return track((await this.json('getSong', { id: itemId })).song); }
  async search(query: string, offset: number, limit: number): Promise<SearchResults> {
    const data = object((await this.json('search3', { query, artistCount: String(limit), albumCount: String(limit), songCount: String(limit), artistOffset: String(offset), albumOffset: String(offset), songOffset: String(offset) })).searchResult3);
    return { artists: list(data.artist).map(artist), albums: list(data.album).map(album), tracks: list(data.song).map(track) };
  }
  async tracks(offset: number, limit: number): Promise<Page<Track>> {
    // OpenSubsonic documents empty-query search3 as library enumeration.
    const items = (await this.search('', offset, limit)).tracks;
    return { items, nextOffset: items.length === limit ? offset + limit : null };
  }
  private async scan(endpoint: 'startScan' | 'getScanStatus'): Promise<LibraryScanStatus> {
    const value = object((await this.json(endpoint)).scanStatus);
    const count = number(value.count);
    if (typeof value.scanning !== 'boolean' || count === null) return malformed();
    this.overviewCache = undefined;
    return {scanning: value.scanning, count};
  }
  async scanStatus() { return this.scan('getScanStatus'); }
  async startScan() { return this.scan('startScan'); }
  async overview(): Promise<LibraryOverview> {
    if (this.overviewCache && this.overviewCache.expires > Date.now()) return this.overviewCache.value;
    if (this.overviewPending) return this.overviewPending;
    this.overviewPending = this.loadOverview();
    try {
      const value = await this.overviewPending;
      this.overviewCache = { value, expires: Date.now() + 15000 };
      return value;
    } finally { this.overviewPending = undefined; }
  }
  private async loadOverview(): Promise<LibraryOverview> {
    const artists = await this.artists();
    let albums = 0;
    for (let page = 0; page < 1000; page++) {
      const data = await this.albums(page * 500, 500); albums += data.items.length;
      if (data.nextOffset === null) {
        const scan = object((await this.json('getScanStatus')).scanStatus);
        const tracks = number(scan.count);
        if (tracks === null || typeof scan.scanning !== 'boolean') return malformed();
        return { artists: artists.length, albums, tracks, scanning: scan.scanning };
      }
    }
    return malformed();
  }
  async artwork(itemId: string): Promise<Artwork> { return await this.request('getCoverArt', { id: itemId, size: '400' }, true) as Artwork; }
}
