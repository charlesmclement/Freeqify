/** Owner-operated, read-only review of restored copies; never remaps saved IDs. */
import type {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {validPlayback,type Track} from '@freeqify/shared';
import {LibraryError,type MusicLibrary,validId} from './integrations/navidrome.js';
export interface ReferenceBaseline {
  version: 1;
  schema: 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
  references: {id:string;status:'present'|'missing';fingerprint:string|null}[];
}
function compatibleSchema(db:DatabaseSync):5|6|7|8|9|10|11|12{
  const schema=Number(db.prepare('PRAGMA user_version').get()?.user_version);
  // Migrations 6–12 add artwork, imports, acquisition queues and library exclusions; the saved track and queue reference tables
  // audited by this tool are unchanged. Reject unknown or older schemas.
  if(schema!==5&&schema!==6&&schema!==7&&schema!==8&&schema!==9&&schema!==10&&schema!==11&&schema!==12)throw new Error('Migration review requires a compatible schema-5, schema-6, schema-7, schema-8, schema-9, schema-10, schema-11 or schema-12 copy; do not reset or downgrade a database.');
  return schema;
}
export function referenceIds(db:DatabaseSync):string[]{
  const schema=compatibleSchema(db);
  const rows=db.prepare(`SELECT DISTINCT track_id FROM (
    SELECT track_id FROM personal_entries UNION ALL SELECT track_id FROM personal_favorites
    UNION ALL SELECT track_id FROM personal_history) LIMIT 100001`).all();
  const ids=new Set(rows.map(row=>String(row.track_id)));
  if(schema>=8)for(const row of db.prepare("SELECT DISTINCT json_extract(payload,'$.track.id') AS id FROM imported_entries WHERE json_extract(payload,'$.track.id') IS NOT NULL LIMIT 100001").iterate())ids.add(String(row.id));
  for(const row of db.prepare('SELECT state FROM playback_state').iterate()){
    const state:unknown=JSON.parse(String(row.state));
    if(!validPlayback(state))throw new Error('Saved playback state cannot be verified. Stop migration review.');
    for(const item of state.queue)ids.add(item.trackId);
    if(ids.size>100000)throw new Error('Migration review exceeds 100,000 references; stop for a separately bounded plan.');
  }
  if(ids.size>100000||[...ids].some(id=>!validId(id)))throw new Error('Saved references cannot be safely verified.');
  return [...ids].sort();
}
function fingerprint(track:Track){
  return createHash('sha256').update(JSON.stringify({id:track.id,title:track.title,artist:track.artist,
    album:track.album,albumId:track.albumId,artworkId:track.artworkId,duration:track.duration,
    format:track.format,trackNumber:track.trackNumber})).digest('hex');
}
export async function captureReferenceBaseline(db:DatabaseSync,library:Pick<MusicLibrary,'track'>):Promise<ReferenceBaseline>{
  const schema=compatibleSchema(db);
  const references:ReferenceBaseline['references']=[];
  for(const id of referenceIds(db)){
    try{const track=await library.track(id);if(track.id!==id)throw new Error('Engine returned a replacement ID; stop without rewriting references.');references.push({id,status:'present',fingerprint:fingerprint(track)});}
    catch(error){if(error instanceof LibraryError&&error.code==='NOT_FOUND')references.push({id,status:'missing',fingerprint:null});else throw error;}
  }
  return {version:1,schema,references};
}
export async function verifyReferenceBaseline(db:DatabaseSync,library:Pick<MusicLibrary,'track'>,baseline:ReferenceBaseline){
  if(baseline?.version!==1||(baseline.schema!==5&&baseline.schema!==6&&baseline.schema!==7&&baseline.schema!==8&&baseline.schema!==9&&baseline.schema!==10&&baseline.schema!==11&&baseline.schema!==12)||!Array.isArray(baseline.references))throw new Error('Unsupported migration baseline.');
  const actual=await captureReferenceBaseline(db,library);
  // Verified snapshots may be upgraded through additive artwork schemas, never downgraded.
  // Only reference fingerprints are compared across these additive schemas.
  if(actual.schema<baseline.schema||JSON.stringify(actual.references)!==JSON.stringify(baseline.references))throw new Error('Saved media IDs or metadata differ from the source baseline. STOP migration; no IDs or databases were changed.');
  return {checked:actual.references.length,previouslyMissing:actual.references.filter(item=>item.status==='missing').length};
}
