import type {StatementSync} from 'node:sqlite';
import type {Album,Artist,RemovedLibraryItem,Track} from '@freeqify/shared';
import type {AuthStore} from './auth/store.js';
import {AuthError} from './auth/password.js';
import {catalogSignal} from './catalog-budget.js';
import {LibraryError,type MusicLibrary} from './integrations/navidrome.js';

/** Application-only exclusions. This module has no filesystem or upstream write API. */
export class LibraryRemovals {
 revision=0;
 private readonly rule:StatementSync;private readonly blocked:StatementSync;private readonly present:StatementSync;
 constructor(private auth:AuthStore){
  this.rule=auth.db.prepare("SELECT 1 FROM library_removals WHERE source='local' AND kind=? AND id=?");
  this.blocked=auth.db.prepare("SELECT 1 FROM library_removals WHERE source='local' AND kind='track' AND id=? UNION ALL SELECT 1 FROM library_removed_members WHERE source='local' AND track_id=? LIMIT 1");
  this.present=auth.db.prepare('SELECT 1 FROM library_removals LIMIT 1');
 }
 private rows(){return this.auth.db.prepare('SELECT kind,id,title,artist,album_id AS albumId,removed_at AS removedAt FROM library_removals ORDER BY removed_at DESC,kind,id');}
 all(){return this.rows().all() as unknown as RemovedLibraryItem[];}
 page(offset:number,limit:number){const items=this.all().slice(offset,offset+limit+1);return {items:items.slice(0,limit),nextOffset:items.length>limit?offset+limit:null};}
 has(kind:'track'|'album',id:string){return Boolean(this.rule.get(kind,id));}
 any(){return Boolean(this.present.get());}
 blocks(id:string){return Boolean(this.blocked.get(id,id));}
 blocksTrack(track:Track){return this.blocks(track.id)||Boolean(track.albumId&&this.has('album',track.albumId));}
 private write(actor:string,action:()=>void,growing:boolean){
  const db=this.auth.db;db.exec('BEGIN IMMEDIATE');
  try{
   if(!db.prepare("SELECT 1 FROM users WHERE id=? AND role='admin' AND status='active'").get(actor))throw new AuthError(403,'ADMIN_REQUIRED','Administrator access is required.');
   const before=this.auth.storageUsage(actor);action();
   if(growing)this.auth.checkStorage(actor,before);
   db.exec('COMMIT');this.revision++;
  }catch(error){db.exec('ROLLBACK');if(error instanceof Error&&/database or disk is full/i.test(error.message))throw new AuthError(503,'STORAGE_UNAVAILABLE','Application storage is full.');throw error;}
 }
 remove(actor:string,item:RemovedLibraryItem,members:string[]=[]){
  if(members.length>10000)throw new AuthError(400,'INVALID_REQUEST','This album is too large to remove in one operation.');
  this.write(actor,()=>{
   if(this.has(item.kind,item.id))return;
   if(Number(this.auth.db.prepare('SELECT count(*) AS n FROM library_removals').get()!.n)>=10000||Number(this.auth.db.prepare('SELECT count(*) AS n FROM library_removed_members').get()!.n)+members.length>100000)throw new AuthError(429,'REMOVAL_LIMIT','Restore unused removals before removing more items.');
   this.auth.db.prepare("INSERT INTO library_removals VALUES('local',?,?,?,?,?,?)").run(item.kind,item.id,item.title.slice(0,512),item.artist.slice(0,512),item.albumId,Date.now());
   const insert=this.auth.db.prepare("INSERT OR IGNORE INTO library_removed_members VALUES('local','album',?,?)");
   for(const id of members)insert.run(item.id,id);
  },true);
 }
 restore(actor:string,kind:'track'|'album',id:string){this.write(actor,()=>{this.auth.db.prepare("DELETE FROM library_removals WHERE source='local' AND kind=? AND id=?").run(kind,id);},false);}
}

type Visibility={revision:number;expires:number;albums:Set<string>;artists:Set<string>;removedTracks:Set<string>;albumTracks:Map<string,number>;artistAlbums:Map<string,number>};
/** Filter every catalog consumer, including personal-library availability and streaming. */
export function removableLibrary(raw:MusicLibrary,store:LibraryRemovals):MusicLibrary {
 let cached:Visibility|undefined;let pending:{revision:number;work:Promise<Visibility>}|undefined;
 const missing=(e:unknown)=>e instanceof LibraryError&&e.code==='NOT_FOUND';
 async function visibility():Promise<Visibility|null>{
  if(!store.any())return null;
  const revision=store.revision;
  if(cached?.revision===revision&&cached.expires>Date.now())return cached;
  if(pending?.revision===revision){await pending.work;return visibility();}
  const work=(async()=>{
   const rows=store.all();const albums=new Set<string>(),removedTracks=new Set<string>();const albumTracks=new Map<string,number>(),artistAlbums=new Map<string,number>();
   const affected=new Set(rows.filter(r=>r.kind==='album').map(r=>r.id));
   for(const row of rows)if(row.kind==='track'){
    catalogSignal.getStore()?.throwIfAborted();
    try{const t=await raw.track(row.id);removedTracks.add(t.id);if(t.albumId)affected.add(t.albumId);}catch(e){if(!missing(e))throw e;}
   }
   for(const id of affected){
    catalogSignal.getStore()?.throwIfAborted();
    try{
     const detail=await raw.album(id);const removed=detail.tracks.filter(t=>store.blocksTrack(t));
     removed.forEach(t=>removedTracks.add(t.id));albumTracks.set(id,removed.length);
     if(store.has('album',id)||(detail.tracks.length>0&&removed.length===detail.tracks.length)){
      albums.add(id);if(detail.album.artistId)artistAlbums.set(detail.album.artistId,(artistAlbums.get(detail.album.artistId)??0)+1);
     }
    }catch(e){if(!missing(e))throw e;}
   }
   const artists=new Set((await raw.artists()).filter(a=>a.albumCount>0&&(artistAlbums.get(a.id)??0)>=a.albumCount).map(a=>a.id));
   return {revision,expires:Date.now()+15000,albums,artists,removedTracks,albumTracks,artistAlbums};
  })();
  const task={revision,work};pending=task;
  try{const result=await work;if(store.revision===revision)cached=result;}finally{if(pending===task)pending=undefined;}
  return visibility();
 }
 const shownAlbum=(a:Album,v:Visibility)=>!store.has('album',a.id)&&!v.albums.has(a.id);
 const albumCount=(a:Album,v:Visibility)=>({...a,trackCount:Math.max(0,a.trackCount-(v.albumTracks.get(a.id)??0))});
 const artistCount=(a:Artist,v:Visibility)=>({...a,albumCount:Math.max(0,a.albumCount-(v.artistAlbums.get(a.id)??0))});
 const library:MusicLibrary={
  ping:()=>raw.ping(),artwork:async id=>{if(store.has('album',id)||store.has('track',id))throw new LibraryError('NOT_FOUND');return raw.artwork(id);},
  overview:async()=>{const value=await raw.overview(),v=await visibility();return v?{...value,artists:Math.max(0,value.artists-v.artists.size),albums:Math.max(0,value.albums-v.albums.size),tracks:Math.max(0,value.tracks-v.removedTracks.size)}:value;},
  artists:async()=>{const value=await raw.artists(),v=await visibility();return v?value.filter(a=>!v.artists.has(a.id)).map(a=>artistCount(a,v)):value;},
  artist:async id=>{const value=await raw.artist(id),v=await visibility();if(!v)return value;if(v.artists.has(id))throw new LibraryError('NOT_FOUND');return {artist:artistCount(value.artist,v),albums:value.albums.filter(a=>shownAlbum(a,v)).map(a=>albumCount(a,v))};},
  albums:async(offset,limit,sort)=>{const value=await raw.albums(offset,limit,sort),v=await visibility();return v?{...value,items:value.items.filter(a=>shownAlbum(a,v)).map(a=>albumCount(a,v))}:value;},
  album:async id=>{if(store.has('album',id))throw new LibraryError('NOT_FOUND');const value=await raw.album(id);if(!store.any())return value;if(store.has('album',id))throw new LibraryError('NOT_FOUND');const tracks=value.tracks.filter(t=>!store.blocksTrack(t));if(value.tracks.length&&!tracks.length)throw new LibraryError('NOT_FOUND');return {album:{...value.album,trackCount:tracks.length},tracks};},
  tracks:async(offset,limit)=>{const value=await raw.tracks(offset,limit);return store.any()?{...value,items:value.items.filter(t=>!store.blocksTrack(t))}:value;},
  track:async id=>{if(store.blocks(id))throw new LibraryError('NOT_FOUND');const t=await raw.track(id);if(store.any()&&store.blocksTrack(t))throw new LibraryError('NOT_FOUND');return t;},
  search:async(query,offset,limit)=>{const value=await raw.search(query,offset,limit),v=await visibility();return v?{artists:value.artists.filter(a=>!v.artists.has(a.id)).map(a=>artistCount(a,v)),albums:value.albums.filter(a=>shownAlbum(a,v)).map(a=>albumCount(a,v)),tracks:value.tracks.filter(t=>!store.blocksTrack(t)),nextOffset:[value.artists,value.albums,value.tracks].some(a=>a.length===limit)?offset+limit:null}:value;},
 };
 const stream:NonNullable<MusicLibrary['stream']>=async(id,format,range,signal)=>{
  if(store.blocks(id))throw new LibraryError('NOT_FOUND');
  if(store.any())await catalogSignal.run(signal,()=>library.track(id));
  const response=await raw.stream!(id,format,range,signal);
  if(store.any())try{await catalogSignal.run(signal,()=>library.track(id));}catch(e){await response.body?.cancel();throw e;}
  return response;
 };
 Object.defineProperties(library,{
  scanStatus:{get:()=>raw.scanStatus?()=>raw.scanStatus!():undefined},
  startScan:{get:()=>raw.startScan?()=>{cached=undefined;return raw.startScan!();}:undefined},
  stream:{get:()=>raw.stream?stream:undefined},
 });
 return library;
}
