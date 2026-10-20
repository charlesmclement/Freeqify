import type { Track } from './index.js';
export type ImportStatus = 'available' | 'missing' | 'review' | 'requested';
export interface ImportedMetadata { title:string; artist:string; album:string; albumArtist:string; duration:number|null; isrc:string|null; spotifyTrackId:string|null; spotifyAlbumId:string|null; releaseDate:string|null; discNumber:number|null; trackNumber:number|null }
export interface ImportSummary { id:string; name:string; count:number; updatedAt:number; counts:Record<ImportStatus,number> }
export interface ImportEntry { id:string; position:number; metadata:ImportedMetadata; status:ImportStatus; checkedAt:number|null; reason:string; track:Track|null; candidates:Track[] }
export interface ImportPage { playlist:ImportSummary; items:ImportEntry[]; nextOffset:number|null }
export interface LidarrAlbumChoice { key:string; title:string; artist:string; tracks:number; candidates:{id:string; title:string; artist:string; year:number|null; monitored:boolean; present:boolean; canRequest:boolean}[] }
export interface LidarrReview { id:string; expiresAt:number; albums:LidarrAlbumChoice[] }
export interface LidarrStatus { configured:boolean; connected:boolean; canRequest:boolean; message:string }

export interface LidarrQueue {
 id:string; total:number; automatic?:boolean; paused?:boolean;
 counts:Record<'pending'|'review'|'queued'|'confirmed'|'skipped'|'failed',number>;
 albums:LidarrAlbumChoice[];
 failures:{key:string;title:string;artist:string;message:string}[];
}
