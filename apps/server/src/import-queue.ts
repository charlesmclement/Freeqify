import {randomUUID,createHash} from 'node:crypto';
import type {ImportedMetadata,LidarrAlbumChoice,LidarrQueue} from '@freeqify/shared';
import type {AuthStore} from './auth/store.js';
import {ImportStore} from './import-store.js';
import {normalized} from './import-matching.js';
import {AuthError} from './auth/password.js';
export interface QueueItem {
 key:string; metadata:ImportedMetadata; entryIds:string[];
 status:'pending'|'review'|'queued'|'confirmed'|'skipped'|'failed';
 candidates:LidarrAlbumChoice['candidates']; albumId?:string; search?:boolean; error?:string;
}
export interface StoredQueue {id:string; items:QueueItem[]; automatic:boolean; paused:boolean; sessionHash:string|null}
export class ImportQueue {
 private imports:ImportStore;
 constructor(private auth:AuthStore){this.imports=new ImportStore(auth);}
 get(user:string,playlist:string):StoredQueue|null {
  this.imports.owned(user,playlist);
  const row=this.auth.db.prepare('SELECT * FROM import_album_queues WHERE user_id=? AND playlist_id=?').get(user,playlist);
  return row?{id:String(row.id),items:JSON.parse(String(row.payload)),automatic:!!row.automatic,paused:!!row.paused,sessionHash:row.session_hash?String(row.session_hash):null}:null;
 }
 require(user:string,playlist:string,id:unknown){const q=this.get(user,playlist);if(!q||q.id!==id)throw new AuthError(409,'QUEUE_CHANGED','This album queue changed. Refresh to continue.');return q;}
 save(user:string,playlist:string,q:StoredQueue){this.imports.transaction(user,()=>{
  this.imports.owned(user,playlist);
  this.auth.db.prepare('INSERT INTO import_album_queues(id,user_id,playlist_id,payload,automatic,paused,session_hash) VALUES (?,?,?,?,?,?,?) ON CONFLICT(playlist_id) DO UPDATE SET id=excluded.id,payload=excluded.payload,automatic=excluded.automatic,paused=excluded.paused,session_hash=excluded.session_hash').run(q.id,user,playlist,JSON.stringify(q.items),Number(q.automatic),Number(q.paused),q.sessionHash);
 });}
 create(user:string,playlist:string,selection:unknown){
  const previous=this.get(user,playlist);
  if(previous?.items.some(i=>['pending','review','queued','failed'].includes(i.status)))throw new AuthError(409,'QUEUE_EXISTS','Resume or clear the saved album queue first.');
  if(selection!=='all'&&(!Array.isArray(selection)||!selection.length||selection.length>5000||!selection.every(id=>typeof id==='string')||new Set(selection).size!==selection.length))throw new AuthError(400,'INVALID_INPUT','Select missing tracks or all missing music.');
  const entries=this.imports.entries(user,playlist).filter(e=>selection==='all'?e.status==='missing'&&e.checkedAt:selection.includes(e.id));
  if(!entries.length||selection!=='all'&&entries.length!==selection.length||entries.some(e=>e.status!=='missing'||!e.checkedAt))throw new AuthError(400,'INVALID_INPUT','Select checked missing tracks only.');
  const groups=new Map<string,QueueItem>();
  for(const e of entries){const key=normalized(e.metadata.albumArtist||e.metadata.artist)+'|'+normalized(e.metadata.album);const item=groups.get(key)??{key:e.id,metadata:e.metadata,entryIds:[],status:'pending',candidates:[]};item.entryIds.push(e.id);groups.set(key,item);}
  const q:StoredQueue={id:randomUUID(),items:[...groups.values()],automatic:false,paused:false,sessionHash:null};this.save(user,playlist,q);return q;
 }
 clear(user:string,playlist:string,id:unknown){this.require(user,playlist,id);this.imports.transaction(user,()=>{this.auth.db.prepare('DELETE FROM import_album_queues WHERE user_id=? AND playlist_id=?').run(user,playlist);});}
 authorize(user:string,playlist:string,token:string){
  let q=this.get(user,playlist);
  if(!q||!q.items.some(i=>['pending','review','queued','failed'].includes(i.status)))q=this.create(user,playlist,'all');
  // Seek all also includes missing tracks added since an earlier partial selection.
  const entries=this.imports.entries(user,playlist),represented=new Set(q.items.flatMap(i=>i.entryIds));
  for(const entry of entries.filter(e=>e.status==='missing'&&e.checkedAt&&!represented.has(e.id))){
   const key=normalized(entry.metadata.albumArtist||entry.metadata.artist)+'|'+normalized(entry.metadata.album);
   const group=q.items.find(i=>normalized(i.metadata.albumArtist||i.metadata.artist)+'|'+normalized(i.metadata.album)===key&&['pending','review'].includes(i.status));
   if(group)group.entryIds.push(entry.id);else q.items.push({key:entry.id,metadata:entry.metadata,entryIds:[entry.id],status:'pending',candidates:[]});
  }
  for(const item of q.items){if(['review','failed','skipped'].includes(item.status)){item.status=item.albumId?'queued':'pending';item.candidates=[];delete item.error;}if(item.status==='queued')item.search=true;}
  q.automatic=true;q.paused=false;q.sessionHash=createHash('sha256').update(token).digest('hex');this.save(user,playlist,q);return q;
 }
 authorized(user:string,q:StoredQueue){
  const now=Date.now();return !!q.sessionHash&&!!this.auth.db.prepare("SELECT s.token_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND u.id=? AND u.role='admin' AND u.status='active' AND s.expires_at>? AND s.idle_expires_at>? AND EXISTS(SELECT 1 FROM import_album_queues q WHERE q.id=? AND q.paused=0 AND q.session_hash=s.token_hash)").get(q.sessionHash,user,now,now,q.id);
 }
 resume(user:string,playlist:string,q:StoredQueue,token:string){q.paused=false;q.sessionHash=createHash('sha256').update(token).digest('hex');this.save(user,playlist,q);}
 pause(user:string,playlist:string,id:unknown){this.require(user,playlist,id);this.auth.db.prepare('UPDATE import_album_queues SET paused=1 WHERE user_id=? AND playlist_id=?').run(user,playlist);return this.get(user,playlist);}
 jobs(){return this.auth.db.prepare("SELECT user_id,playlist_id FROM import_album_queues WHERE automatic=1 AND paused=0 AND EXISTS(SELECT 1 FROM json_each(import_album_queues.payload) j WHERE json_extract(j.value,'$.status') IN ('pending','queued')) ORDER BY playlist_id").all().map(r=>({user:String(r.user_id),playlist:String(r.playlist_id)}));}
 public(q:StoredQueue|null):LidarrQueue|null {
  if(!q)return null;
  const counts={pending:0,review:0,queued:0,confirmed:0,skipped:0,failed:0};for(const item of q.items)counts[item.status]++;
  return {id:q.id,automatic:q.automatic,paused:q.paused,total:q.items.length,counts,albums:q.items.filter(i=>i.status==='review').slice(0,10).map(i=>({key:i.key,title:i.metadata.album||'Album not specified',artist:i.metadata.albumArtist||i.metadata.artist,tracks:i.entryIds.length,candidates:i.candidates})),failures:q.items.filter(i=>i.status==='failed').slice(0,10).map(i=>({key:i.key,title:i.metadata.album||'Album not specified',artist:i.metadata.albumArtist||i.metadata.artist,message:i.error||'Album could not be processed.'}))};
 }
}
