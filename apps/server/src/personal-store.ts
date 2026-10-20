import { randomUUID } from 'node:crypto';
import type { AuthStore } from './auth/store.js';
import { AuthError } from './auth/password.js';
import { COLLECTION_LIMIT, BULK_LIMIT, listeningThreshold, type PlaylistSummary, type Track } from '@freeqify/shared';
export const personalLimit = COLLECTION_LIMIT;
export type SavedTrack = { id: string; source: 'local'; track_id: string; metadata: string; played_at?: number; position?: number };
const invalid = (message = 'Invalid personal library request.') => new AuthError(400, 'INVALID_INPUT', message);
export class PersonalStore {
  constructor(private readonly auth: AuthStore, private readonly now = Date.now) {}
  private get db() { return this.auth.db; }
  private active(user: string) {
    if (!this.db.prepare("SELECT id FROM users WHERE id=? AND status='active'").get(user)) throw new AuthError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
  }
  private transaction<T>(user: string, action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { this.active(user); const before=this.auth.storageUsage(user);const value = action();this.auth.checkStorage(user,before); this.db.exec('COMMIT'); return value; }
    catch (error) { try{this.db.exec('ROLLBACK');}catch{/* SQLite may have already rolled back. */}if(error instanceof Error&&/database or disk is full/i.test(error.message))throw new AuthError(503,'STORAGE_UNAVAILABLE','Application storage limit reached. Ask the operator to review storage.'); throw error; }
  }
  private owned(user: string, id: string) {
    this.active(user);
    const row = this.db.prepare('SELECT * FROM personal_playlists WHERE id=? AND user_id=?').get(id, user);
    if (!row) throw new AuthError(404, 'NOT_FOUND', 'Playlist not found.');
    return row;
  }
  private metadata(track:Track){
    const text=JSON.stringify({id:track.id,title:track.title,artist:track.artist,album:track.album,albumId:track.albumId,duration:track.duration,format:track.format,trackNumber:track.trackNumber,artworkId:track.artworkId});
    if(Buffer.byteLength(text)>this.auth.resources.metadataBytes)throw invalid('Track metadata exceeds the configured storage limit.');return text;
  }
  private name(value: unknown) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 100 || Array.from(value).some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127)) throw invalid('Use a playlist name of 1–100 characters.');
    return value.trim();
  }
  private touch(id: string) { this.db.prepare('UPDATE personal_playlists SET revision=revision+1,updated_at=? WHERE id=?').run(this.now(), id); }
  playlists(user: string, id?: string): PlaylistSummary[] {
    this.active(user);
    const rows = this.db.prepare(`SELECT p.*,count(e.id) AS count,coalesce(sum(json_extract(e.metadata,'$.duration')),0) AS duration,
      (SELECT json_extract(art.metadata,'$.artworkId') FROM personal_entries art WHERE art.playlist_id=p.id AND json_extract(art.metadata,'$.artworkId') IS NOT NULL ORDER BY art.position LIMIT 1) AS artwork,
      (SELECT json_extract(art.metadata,'$.albumId') FROM personal_entries art WHERE art.playlist_id=p.id AND json_extract(art.metadata,'$.albumId') IS NOT NULL ORDER BY art.position LIMIT 1) AS artwork_album_id
      FROM personal_playlists p LEFT JOIN personal_entries e ON e.playlist_id=p.id WHERE p.user_id=? ${id?'AND p.id=?':''} GROUP BY p.id ORDER BY p.updated_at DESC,p.id`).all(...(id?[user,id]:[user]));
    return rows.map(row=>({id:String(row.id),name:String(row.name),revision:Number(row.revision),updatedAt:Number(row.updated_at),count:Number(row.count),duration:Number(row.duration),artworkId:row.artwork?String(row.artwork):null,artworkAlbumId:row.artwork_album_id?String(row.artwork_album_id):null}));
  }

  create(user: string, name: unknown) {
    const normalized = this.name(name);
    return this.transaction(user, () => {
      if (Number(this.db.prepare('SELECT count(*) AS n FROM personal_playlists WHERE user_id=?').get(user)!.n) >= 200) throw invalid('You can keep up to 200 playlists.');
      const id = randomUUID(); const now = this.now();
      this.db.prepare('INSERT INTO personal_playlists(id,user_id,name,created_at,updated_at) VALUES (?,?,?,?,?)').run(id, user, normalized, now, now);
      return id;
    });
  }
  /** One transaction for a playable snapshot, including duplicate ordered entries. */
  createFromTracks(user:string,name:unknown,tracks:Track[],linked?:(id:string)=>void){
    const title=this.name(name);if(!tracks.length||tracks.length>personalLimit)throw invalid('Choose 1–5,000 available songs.');
    return this.transaction(user,()=>{
      if(Number(this.db.prepare('SELECT count(*) AS n FROM personal_playlists WHERE user_id=?').get(user)!.n)>=200)throw invalid('You can keep up to 200 playlists.');
      const id=randomUUID(),now=this.now();this.db.prepare('INSERT INTO personal_playlists(id,user_id,name,created_at,updated_at) VALUES (?,?,?,?,?)').run(id,user,title,now,now);
      const insert=this.db.prepare("INSERT INTO personal_entries(id,playlist_id,source,track_id,metadata,position) VALUES (?,?,'local',?,?,?)");
      tracks.forEach((t,i)=>insert.run(randomUUID(),id,t.id,this.metadata(t),i));linked?.(id);return id;
    });
  }
  rename(user: string, id: string, name: unknown) { const normalized = this.name(name); this.transaction(user, () => { this.owned(user,id); this.db.prepare('UPDATE personal_playlists SET name=? WHERE id=? AND user_id=?').run(normalized,id,user); this.touch(id); }); }
  delete(user: string, id: string) { this.transaction(user, () => { this.owned(user,id); this.db.prepare('DELETE FROM personal_playlists WHERE id=? AND user_id=?').run(id,user); }); }
  entries(user: string, id: string, offset = 0, limit = personalLimit): SavedTrack[] { this.owned(user,id); return this.db.prepare('SELECT * FROM personal_entries WHERE playlist_id=? ORDER BY position LIMIT ? OFFSET ?').all(id,limit,offset) as unknown as SavedTrack[]; }
  add(user: string, id: string, track: Track) { return this.addMany(user,id,[track])[0]!; }
  /** Atomic bounded batches; reuse prepared statements and count once per batch. */
  addMany(user: string, id: string, tracks: Track[]) {
    return this.transaction(user, () => {
      this.owned(user,id);
      if (!tracks.length || tracks.length>BULK_LIMIT) throw invalid('Use batches of 1–100 songs.');
      const count=Number(this.db.prepare('SELECT count(*) AS n FROM personal_entries WHERE playlist_id=?').get(id)!.n);
      if(count+tracks.length>personalLimit) throw invalid('A playlist supports up to 5,000 songs.');
      const insert=this.db.prepare("INSERT INTO personal_entries(id,playlist_id,source,track_id,metadata,position) VALUES (?,?,'local',?,?,?)");
      const ids=tracks.map((track,index)=>{const entry=randomUUID();insert.run(entry,id,track.id,this.metadata(track),count+index);return entry;});
      this.touch(id);return ids;
    });
  }
  favoriteIds(user: string): string[] {this.active(user);return this.db.prepare('SELECT track_id FROM personal_favorites WHERE user_id=? ORDER BY created_at DESC,track_id').all(user).map(r=>String(r.track_id));}
  references(user: string, playlist?: string) {
    if(playlist)this.owned(user,playlist);else this.active(user);
    const rows=playlist ? this.db.prepare('SELECT id,source,track_id FROM personal_entries WHERE playlist_id=? ORDER BY position').all(playlist)
      : this.db.prepare('SELECT track_id AS id,source,track_id FROM personal_favorites WHERE user_id=? ORDER BY created_at DESC,track_id').all(user);
    return rows.map(row=>({id:String(row.id),source:'local' as const,trackId:String(row.track_id)}));
  }
  move(user:string,id:string,entry:string,direction:number,revision:unknown) {
    this.transaction(user,()=>{
      const row=this.owned(user,id);if(row.revision!==revision)throw new AuthError(409,'CONFLICT','Playlist changed. Refresh before reordering.');
      if(direction!==1&&direction!==-1)throw invalid();
      const current=this.db.prepare('SELECT position FROM personal_entries WHERE playlist_id=? AND id=?').get(id,entry);
      if(!current)throw new AuthError(404,'NOT_FOUND','Playlist entry not found.');
      const position=Number(current.position);const target=this.db.prepare('SELECT id FROM personal_entries WHERE playlist_id=? AND position=?').get(id,position+direction);
      if(!target)return;
      const update=this.db.prepare('UPDATE personal_entries SET position=? WHERE playlist_id=? AND id=?');
      update.run(-1,id,entry);update.run(position,id,String(target.id));update.run(position+direction,id,entry);this.touch(id);
    });
  }
  remove(user: string, id: string, entry: string) {
    this.transaction(user, () => {
      this.owned(user,id);
      if (!this.db.prepare('DELETE FROM personal_entries WHERE id=? AND playlist_id=?').run(entry,id).changes) throw new AuthError(404,'NOT_FOUND','Playlist entry not found.');
      this.order(id, (this.db.prepare('SELECT id FROM personal_entries WHERE playlist_id=? ORDER BY position').all(id)).map(e => String(e.id))); this.touch(id);
    });
  }
  private order(id: string, entries: string[]) {
    this.db.prepare('UPDATE personal_entries SET position=-position-1 WHERE playlist_id=?').run(id);
    const statement = this.db.prepare('UPDATE personal_entries SET position=? WHERE id=? AND playlist_id=?'); entries.forEach((entry,index) => statement.run(index,entry,id));
  }
  reorder(user: string, id: string, entries: unknown, revision: unknown) {
    this.transaction(user, () => {
      const row = this.owned(user,id);
      if (revision !== Number(row.revision)) throw new AuthError(409,'CONFLICT','Playlist changed. Refresh before reordering.');
      const current = new Set(this.references(user,id).map(e => e.id));
      if (!Array.isArray(entries) || entries.length !== current.size || new Set(entries).size !== current.size || !entries.every(e => typeof e === 'string' && current.has(e))) throw invalid();
      this.order(id,entries as string[]); this.touch(id);
    });
  }
  favorites(user: string, offset = 0, limit = personalLimit): SavedTrack[] { this.active(user); return this.db.prepare('SELECT track_id AS id,* FROM personal_favorites WHERE user_id=? ORDER BY created_at DESC,track_id LIMIT ? OFFSET ?').all(user,limit,offset) as unknown as SavedTrack[]; }
  unfavorite(user: string, id: string) { this.transaction(user, () => { this.db.prepare("DELETE FROM personal_favorites WHERE user_id=? AND source='local' AND track_id=?").run(user,id); }); }
  favorite(user: string, track: Track, enabled: boolean) {if(!enabled){this.unfavorite(user,track.id);return;}this.favoriteMany(user,[track]);}
  favoriteMany(user:string,tracks:Track[]) {
    this.transaction(user,()=>{
      if(!tracks.length||tracks.length>BULK_LIMIT)throw invalid('Use batches of 1–100 songs.');
      const count=Number(this.db.prepare('SELECT count(*) AS n FROM personal_favorites WHERE user_id=?').get(user)!.n);const unique=new Map(tracks.map(t=>[t.id,t]));
      const exists=this.db.prepare("SELECT 1 FROM personal_favorites WHERE user_id=? AND source='local' AND track_id=?");
      if(count+[...unique.keys()].filter(id=>!exists.get(user,id)).length>personalLimit)throw invalid('Favorites supports up to 5,000 songs.');
      const insert=this.db.prepare("INSERT INTO personal_favorites(user_id,source,track_id,metadata,created_at) VALUES (?,'local',?,?,?) ON CONFLICT(user_id,source,track_id) DO NOTHING");
      for(const track of unique.values())insert.run(user,track.id,this.metadata(track),this.now());
    });
  }
  saved(user: string, id: string): Track | null {
    this.active(user);
    const row = this.db.prepare(`SELECT metadata FROM personal_favorites WHERE user_id=? AND source='local' AND track_id=?
      UNION ALL SELECT e.metadata FROM personal_entries e JOIN personal_playlists p ON p.id=e.playlist_id WHERE p.user_id=? AND e.source='local' AND e.track_id=?
      UNION ALL SELECT metadata FROM personal_history WHERE user_id=? AND source='local' AND track_id=? LIMIT 1`).get(user,id,user,id,user,id);
    return row ? JSON.parse(String(row.metadata)) as Track : null;
  }
  generation(user: string) { this.active(user); return Number(this.db.prepare('SELECT history_generation FROM personal_settings WHERE user_id=?').get(user)?.history_generation ?? 0); }
  record(user: string, track: Track, input: { eventId: string; listened: number; position: number; generation: number }) {
    this.transaction(user, () => {
      if (input.generation !== this.generation(user)) throw new AuthError(409,'HISTORY_CLEARED','History was cleared. Start a new listening attempt.');
      if (input.listened < listeningThreshold(track.duration)) throw invalid('Playback has not reached the listening threshold.');
      const old = this.db.prepare('SELECT * FROM personal_history WHERE user_id=? AND event_id=?').get(user,input.eventId);
      if (old && (old.track_id !== track.id || old.source !== 'local')) throw invalid();
      const now = this.now();
      this.db.prepare("INSERT INTO personal_history(user_id,event_id,source,track_id,metadata,listened,position,started_at,played_at) VALUES (?,?,'local',?,?,?,?,?,?) ON CONFLICT(user_id,event_id) DO UPDATE SET listened=max(personal_history.listened,excluded.listened),position=CASE WHEN excluded.listened>=personal_history.listened THEN excluded.position ELSE personal_history.position END,metadata=excluded.metadata").run(user,input.eventId,track.id,this.metadata(track),input.listened,input.position,now,now);
      this.db.prepare('DELETE FROM personal_history WHERE user_id=? AND event_id NOT IN (SELECT event_id FROM personal_history WHERE user_id=? ORDER BY played_at DESC,event_id DESC LIMIT 1000)').run(user,user);
    });
  }
  history(user: string, offset: number, limit: number): SavedTrack[] {
    this.active(user);
    return this.db.prepare("SELECT event_id AS id,* FROM (SELECT *,row_number() OVER (PARTITION BY source,track_id ORDER BY played_at DESC,event_id DESC) AS latest FROM personal_history WHERE user_id=?) WHERE latest=1 ORDER BY played_at DESC,id DESC LIMIT ? OFFSET ?").all(user,limit,offset) as unknown as SavedTrack[];
  }
  clearHistory(user: string) { return this.transaction(user, () => { this.db.prepare('DELETE FROM personal_history WHERE user_id=?').run(user); this.db.prepare('INSERT INTO personal_settings VALUES (?,1) ON CONFLICT(user_id) DO UPDATE SET history_generation=history_generation+1').run(user); return this.generation(user); }); }
}
