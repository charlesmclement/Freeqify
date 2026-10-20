/** Public, non-sensitive contracts only. Never export server configuration here. */
export const APP_NAME = 'Freeqify';
export const TAGLINE = 'Your Music. Your Frequency.';
export interface HealthResponse { status: 'ok'; service: 'freeqify'; phase: 0 }

export interface Artist { id: string; name: string; albumCount: number; artworkId: string | null }
export type AlbumSort = 'alphabeticalByName' | 'alphabeticalByArtist' | 'newest';
export interface Album { id: string; title: string; artist: string; artistId: string | null; artworkId: string | null; trackCount: number; year: number | null }
export interface Track {
  isrc?: string; id: string; title: string; artist: string; album: string; albumId: string | null; duration: number | null; format: string | null; trackNumber: number | null; artworkId: string | null }
export interface SearchResults { artists: Artist[]; albums: Album[]; tracks: Track[]; nextOffset?: number | null }
export interface RemovedLibraryItem { kind:'track'|'album'; id:string; title:string; artist:string; albumId:string|null; removedAt:number }
export interface LibraryScanStatus { scanning: boolean; count: number }
export interface LibraryOverview { artists: number; albums: number; tracks: number; scanning: boolean }
export interface Page<T> { items: T[]; nextOffset: number | null }
export interface ArtistDetail { artist: Artist; albums: Album[] }
export interface AlbumDetail { album: Album; tracks: Track[] }
export type LibraryErrorCode = 'NOT_CONFIGURED' | 'INVALID_CREDENTIALS' | 'UNAVAILABLE' | 'MALFORMED_RESPONSE' | 'NOT_FOUND' | 'INVALID_REQUEST';
export interface LibraryErrorResponse { error: { code: LibraryErrorCode; message: string } }

export interface Account { id: string; username: string; role: 'admin' | 'listener'; status: 'active' | 'disabled'; createdAt: number }
export interface AuthState { user: Account | null; csrf: string; expiresAt: number }
export interface Invitation { id: string; createdAt: number; expiresAt: number; status: 'pending' | 'used' | 'revoked' | 'expired' }

/** Installation-local namespace; remote sources are intentionally unsupported. */
export interface QueuedTrack { key: string; source: 'local'; trackId: string; origin?: 'manual' }
export interface PlaybackState { queue: QueuedTrack[]; order: string[]; current: string | null; position: number; shuffle: boolean; repeat: 'off' | 'all' | 'one'; volume: number; muted: boolean; contextLabel?: string }
export const COLLECTION_LIMIT = 5000;
export const QUEUE_LIMIT = 5000;
export const PERSONAL_PAGE_SIZE = 48;
export const BULK_LIMIT = 100;
export const emptyPlayback = (): PlaybackState => ({ queue: [], order: [], current: null, position: 0, shuffle: false, repeat: 'off', volume: 1, muted: false });
export function validPlayback(value: unknown): value is PlaybackState {
  if (!value || typeof value !== 'object') return false;
  const s = value as PlaybackState;
  const id = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(v);
  if (!Array.isArray(s.queue) || s.queue.length > QUEUE_LIMIT || !s.queue.every(t => t && t.source === 'local' && id(t.key) && id(t.trackId) && (t.origin === undefined || t.origin === 'manual'))) return false;
  const keys = new Set(s.queue.map(t => t.key));
  return (s.contextLabel === undefined || (typeof s.contextLabel === 'string' && s.contextLabel.length <= 160 && Array.from(s.contextLabel).every(c=>c.charCodeAt(0)>=32&&c.charCodeAt(0)!==127))) && keys.size === s.queue.length && Array.isArray(s.order) && s.order.length === keys.size
    && new Set(s.order).size === keys.size && s.order.every(k => keys.has(k))
    && (s.current === null || keys.has(s.current)) && Number.isFinite(s.position) && s.position >= 0 && s.position <= 604800
    && typeof s.shuffle === 'boolean' && ['off', 'all', 'one'].includes(s.repeat) && Number.isFinite(s.volume) && s.volume >= 0 && s.volume <= 1 && typeof s.muted === 'boolean';
}

export interface MediaReference { source: 'local'; trackId: string }
export interface PersonalTrack extends MediaReference { id: string; track: Track; available: boolean | null; playedAt?: number; position?: number }
export interface PlaylistSummary { id: string; name: string; count: number; duration: number; artworkId: string | null; artworkAlbumId?: string | null; revision: number; updatedAt: number }
export interface PlaylistDetail { playlist: PlaylistSummary; items: PersonalTrack[]; nextOffset?: number | null }
export interface PersonalSummary { playlists: PlaylistSummary[]; favoriteIds: string[]; generation: number }
export function listeningThreshold(duration: number | null) { return duration && duration > 0 ? Math.max(1, Math.min(30, duration / 2)) : 30; }
export type { ImportedMetadata, ImportStatus, ImportSummary, ImportEntry, ImportPage, LidarrAlbumChoice, LidarrReview, LidarrStatus, LidarrQueue } from './playlist-import.js';
