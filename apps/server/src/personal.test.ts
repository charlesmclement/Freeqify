import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { AuthStore } from './auth/store.js';
import { registerAuthentication } from './auth/routes.js';
import { readConfig } from './config.js';
import { registerPersonalRoutes } from './personal-routes.js';
import { PersonalStore } from './personal-store.js';
import { LibraryError, type MusicLibrary } from './integrations/navidrome.js';
import { emptyPlayback, type Account, type Track } from '@freeqify/shared';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { migrations } from './storage/migrations.js';
const track: Track={id:'song-1',title:'One',artist:'Artist',album:'Album',albumId:'album',artworkId:null,format:'mp3',duration:100,trackNumber:1};
const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0))await cleanup();});
async function fixture(base='/') {
 const config=readConfig({BASE_PATH:base});const auth=new AuthStore(':memory:',config.auth);const users=['alice','bob','admin'].map((id,i)=>{auth.db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(id,id,'test-only-unusable-hash',i===2?'admin':'listener','active',1);return {id,username:id,role:i===2?'admin':'listener',status:'active',createdAt:1} as Account;});
 const sessions=users.map(u=>auth.createSession(u));const library={track:vi.fn().mockImplementation(async(id:string)=>({...track,id,title:id==='song-1'?'One':'Two'}))} as unknown as MusicLibrary;
 const app=Fastify();registerAuthentication(app,`${base}api`,config,auth);registerPersonalRoutes(app,`${base}api/personal`,auth,library,config);cleanups.push(async()=>{await app.close();auth.close();});
 const request=(path:string,body?:unknown,who=0,headers:Record<string,string>={})=>app.inject({url:`${base}api/personal/${path}`,method:body===undefined?'GET':'POST',...(body===undefined?{}:{payload:body}),headers:{cookie:`freeqify_session=${sessions[who]!.token}`,origin:'http://localhost:80','x-csrf-token':sessions[who]!.csrf,...headers}});
 const create=async(name='Mix')=>(await request('playlists',{name})).json().id as string;
 return {app,auth,library,request,create,sessions,users,store:new PersonalStore(auth)};
}
describe.each(['/','/freeqify/'])('personal API at %s',base=>{
 it('creates, renames, lists and deletes owned empty playlists with totals',async()=>{const f=await fixture(base);const id=await f.create();const detail=(await f.request(`playlists/${id}`)).json();expect(detail.playlist).toMatchObject({name:'Mix',count:0,duration:0});expect(detail.items).toEqual([]);expect((await f.request(`playlists/${id}/rename`,{name:'New name'})).statusCode).toBe(200);expect((await f.request('playlists')).json().items[0].name).toBe('New name');expect((await f.request(`playlists/${id}/delete`,{})).statusCode).toBe(200);expect((await f.request(`playlists/${id}`)).statusCode).toBe(404);});
 it('supports duplicates, stable reordering, revision conflict and removal',async()=>{const f=await fixture(base);const id=await f.create();for(const trackId of ['song-1','song-2','song-1'])expect((await f.request(`playlists/${id}/tracks`,{source:'local',trackId})).statusCode).toBe(200);let d=(await f.request(`playlists/${id}`)).json();expect(d.playlist).toMatchObject({count:3,duration:300});expect(new Set(d.items.map((e:{id:string})=>e.id)).size).toBe(3);const entries=d.items.map((e:{id:string})=>e.id).reverse();expect((await f.request(`playlists/${id}/reorder`,{entries,revision:d.playlist.revision})).statusCode).toBe(200);expect((await f.request(`playlists/${id}/reorder`,{entries,revision:d.playlist.revision})).statusCode).toBe(409);d=(await f.request(`playlists/${id}`)).json();expect(d.items.map((e:{id:string})=>e.id)).toEqual(entries);expect((await f.request(`playlists/${id}/remove`,{entryId:entries[1]})).statusCode).toBe(200);expect((await f.request(`playlists/${id}`)).json().playlist.count).toBe(2);});
 it('isolates listener collections from other listeners and administrators',async()=>{const f=await fixture(base);const id=await f.create();for(const who of [1,2]){expect((await f.request(`playlists/${id}`,undefined,who)).statusCode).toBe(404);for(const [suffix,body] of [['rename',{name:'Stolen'}],['delete',{}],['tracks',{source:'local',trackId:'song-1'}],['remove',{entryId:'guess'}],['reorder',{entries:[],revision:0}]] as const)expect((await f.request(`playlists/${id}/${suffix}`,body,who)).statusCode).toBe(404);expect((await f.request('playlists',undefined,who)).json().items).toEqual([]);} });
 it('requires CSRF, exact origin, authentication and active sessions',async()=>{const f=await fixture(base);for(const path of ['summary','playlists','favorites','history'])expect((await f.request(path,undefined,0,{cookie:''})).statusCode).toBe(401);for(const path of ['playlists','favorites','history','history/clear'])expect((await f.request(path,{},0,{'x-csrf-token':''})).statusCode).toBe(403);expect((await f.request('playlists',{name:'Mix'},0,{origin:'http://evil.example'})).statusCode).toBe(403);f.auth.disableUser('admin','alice');expect((await f.request('playlists')).statusCode).toBe(401);expect(()=>f.store.playlists('alice')).toThrow('Sign in');});
 it('keeps missing favorite and playlist references and allows unfavoriting missing media',async()=>{const f=await fixture(base);const id=await f.create();await f.request(`playlists/${id}/tracks`,{source:'local',trackId:'song-1'});await f.request('favorites',{source:'local',trackId:'song-1',enabled:true});vi.mocked(f.library.track).mockRejectedValue(new LibraryError('NOT_FOUND'));expect((await f.request(`playlists/${id}`)).json().items[0]).toMatchObject({available:false,track:{title:'One'}});expect((await f.request('favorites')).json().items[0].available).toBe(false);expect((await f.request('favorites',{source:'local',trackId:'song-1',enabled:false})).statusCode).toBe(200);expect((await f.request('favorites')).json().items).toEqual([]);});
 it('favorites are idempotent and isolated even from administrators',async()=>{const f=await fixture(base);for(let i=0;i<2;i++)await f.request('favorites',{source:'local',trackId:'song-1',enabled:true});expect((await f.request('favorites')).json().items).toHaveLength(1);for(const who of [1,2]){await f.request('favorites',{source:'local',trackId:'song-1',enabled:false},who);expect((await f.request('favorites',undefined,who)).json().items).toEqual([]);expect((await f.request('history',undefined,who)).json().items).toEqual([]);}expect((await f.request('summary')).json().favoriteIds).toEqual(['song-1']);});
 it('records meaningful plays once per event, preserves resume position, clears without resurrection',async()=>{const f=await fixture(base);const event={source:'local',trackId:'song-1',eventId:'event-1',generation:0,listened:29,position:80};expect((await f.request('history',event)).statusCode).toBe(400);event.listened=30;expect((await f.request('history',event)).statusCode).toBe(200);event.position=90;event.listened=60;await f.request('history',event);await f.request('history',{...event,listened:30,position:35});expect(f.auth.db.prepare('SELECT count(*) AS n FROM personal_history').get()?.n).toBe(1);expect((await f.request('history')).json().items[0]).toMatchObject({position:90,playedAt:expect.any(Number)});expect((await f.request('history',undefined,1)).json().items).toEqual([]);const clear=await f.request('history/clear',{});expect(clear.json().generation).toBe(1);expect((await f.request('history',event)).statusCode).toBe(409);expect((await f.request('history')).json().items).toEqual([]);await f.request('history',{...event,generation:1,eventId:'event-2'});expect((await f.request('history')).json().items).toHaveLength(1);});
 it('copies an owned missing favorite into a playlist without inventing catalog metadata',async()=>{const f=await fixture(base);await f.request('favorites',{source:'local',trackId:'song-1',enabled:true});const id=await f.create();vi.mocked(f.library.track).mockRejectedValue(new LibraryError('NOT_FOUND'));expect((await f.request(`playlists/${id}/tracks`,{source:'local',trackId:'song-1'})).statusCode).toBe(200);expect((await f.request(`playlists/${id}`)).json().items[0]).toMatchObject({available:false,track:{title:'One'}});const other=await f.request('playlists',{name:'Other'},1);expect((await f.request(`playlists/${other.json().id}/tracks`,{source:'local',trackId:'song-1'},1)).statusCode).toBe(404);});
 it.each(['revoke','expire'])('denies personal access after %s',async reason=>{const f=await fixture(base);if(reason==='revoke')f.auth.revokeSessions('admin','alice');else f.auth.db.prepare('UPDATE sessions SET expires_at=0').run();expect((await f.request('summary')).statusCode).toBe(401);expect((await f.request('history/clear',{})).statusCode).toBe(401);});
 it('fails closed if a session is revoked during metadata resolution',async()=>{const f=await fixture(base);vi.mocked(f.library.track).mockImplementation(async()=>{f.auth.revokeSessions('admin','alice');return track;});expect((await f.request('favorites',{source:'local',trackId:'song-1',enabled:true})).statusCode).toBe(401);expect(f.auth.db.prepare('SELECT count(*) AS n FROM personal_favorites').get()?.n).toBe(0);});
 it('bounds metadata work during an engine outage',async()=>{const f=await fixture(base);for(let i=0;i<50;i++)f.store.favorite('alice',{...track,id:`song-${i}`},true);vi.mocked(f.library.track).mockRejectedValue(new LibraryError('UNAVAILABLE'));const response=await f.request('favorites?limit=100');expect(response.statusCode).toBe(200);expect(response.json().items).toHaveLength(50);expect(vi.mocked(f.library.track).mock.calls.length).toBeLessThanOrEqual(4);});
 it('reports engine outages separately from deleted tracks without leaking upstream errors',async()=>{const f=await fixture(base);await f.request('favorites',{source:'local',trackId:'song-1',enabled:true});vi.mocked(f.library.track).mockRejectedValue(new Error('private-upstream-secret'));const response=await f.request('favorites');expect(response.json().items[0].available).toBeNull();expect(response.body).not.toContain('private-upstream-secret');});
 it.each([{name:''},{name:' '.repeat(5)},{name:'a'.repeat(101)},{name:'x\nname'},{name:5},{name:null}])('rejects invalid playlist input %j',async body=>{const f=await fixture(base);expect((await f.request('playlists',body)).statusCode).toBe(400);});
 it.each([{source:'remote',trackId:'song-1',enabled:true},{source:'local',trackId:'../private',enabled:true},{source:'local',trackId:'song-1',enabled:'yes'}])('rejects invalid favorite/reference %j',async body=>{const f=await fixture(base);expect((await f.request('favorites',body)).statusCode).toBe(400);});
 it('rejects malformed reorder sets, event reuse and history pagination',async()=>{const f=await fixture(base);const id=await f.create();await f.request(`playlists/${id}/tracks`,{source:'local',trackId:'song-1'});expect((await f.request(`playlists/${id}/reorder`,{entries:['foreign'],revision:1})).statusCode).toBe(400);await f.request('history',{source:'local',trackId:'song-1',eventId:'event',generation:0,listened:30,position:30});expect((await f.request('history',{source:'local',trackId:'song-2',eventId:'event',generation:0,listened:30,position:30})).statusCode).toBe(400);for(const path of ['history?offset=-1','history?limit=0','history?limit=101'])expect((await f.request(path)).statusCode).toBe(400);});
});
it('upgrades populated Phase 3 data and persists collections across database restart',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'freeqify-personal-'));cleanups.push(()=>rm(directory,{recursive:true}));const file=join(directory,'accounts.sqlite');const old=new DatabaseSync(file);old.exec(migrations[0]!.sql);old.exec(migrations[1]!.sql);old.exec("INSERT INTO users VALUES ('owner','owner','unchanged-hash','admin','active',1); INSERT INTO playback_state VALUES ('owner','{}',1); PRAGMA user_version=2;");old.close();
 let auth=new AuthStore(file,readConfig({}).auth);let store=new PersonalStore(auth);const id=store.create('owner','Permanent');store.add('owner',id,track);store.add('owner',id,track);store.favorite('owner',track,true);store.record('owner',track,{eventId:'event',generation:0,listened:30,position:45});const session=auth.createSession({id:'owner',username:'owner',role:'admin',status:'active',createdAt:1});auth.close();
 auth=new AuthStore(file,readConfig({}).auth);store=new PersonalStore(auth);try{expect(auth.db.prepare('PRAGMA user_version').get()?.user_version).toBe(12);expect(auth.db.prepare('SELECT password_hash FROM users').get()?.password_hash).toBe('unchanged-hash');expect(auth.db.prepare('SELECT state FROM playback_state').get()?.state).toBe('{}');expect(auth.session(session.token)?.user?.id).toBe('owner');expect(store.entries('owner',id)).toHaveLength(2);expect(store.favorites('owner')).toHaveLength(1);expect(store.history('owner',0,48)[0]?.position).toBe(45);}finally{auth.close();}
});
it('enforces collection bounds without truncation or partial reorders',async()=>{const f=await fixture();const id=f.store.create('alice','Bounded');for(let n=0;n<50;n++){f.store.addMany('alice',id,Array.from({length:100},()=>track));f.store.favoriteMany('alice',Array.from({length:100},(_,i)=>({...track,id:`song-${n*100+i}`})));}expect(()=>f.store.add('alice',id,track)).toThrow('5,000 songs');expect(()=>f.store.favorite('alice',{...track,id:'overflow'},true)).toThrow('5,000 songs');const before=f.store.entries('alice',id).map(e=>e.id);expect(()=>f.store.reorder('alice',id,[...before.slice(1),'foreign'],5000)).toThrow();expect(f.store.entries('alice',id).map(e=>e.id)).toEqual(before);});

it('pages 5,000 entries and favorites, snapshots queue references, scopes limits, and bounds metadata work',async()=>{
 const f=await fixture();const id=await f.create('Large');const start=performance.now();
 for(let offset=0;offset<5000;offset+=100){const batch=Array.from({length:100},(_,i)=>({...track,id:`large-${offset+i}`}));f.store.addMany('alice',id,batch);f.store.favoriteMany('alice',batch);}
 const populated=performance.now();
 // Keep duplicates at capacity and verify append limits are per collection/owner.
 const duplicate=f.store.create('alice','Duplicates');f.store.addMany('alice',duplicate,[track,track]);f.store.favorite('bob',track,true);
 expect(f.store.references('alice',duplicate).map(t=>t.trackId)).toEqual(['song-1','song-1']);
 expect(()=>f.store.addMany('alice',id,[track,track])).toThrow('5,000');expect(()=>f.store.favoriteMany('alice',[track])).toThrow('5,000');
 expect(f.store.references('alice',id)).toHaveLength(5000);expect(f.store.favoriteIds('alice')).toHaveLength(5000);expect(f.store.favoriteIds('bob')).toEqual(['song-1']);
 vi.mocked(f.library.track).mockClear();const first=(await f.request(`playlists/${id}`)).json();expect(first.items).toHaveLength(48);expect(first.nextOffset).toBe(48);expect(vi.mocked(f.library.track)).toHaveBeenCalledTimes(48);
 const boundary=first.items[47].id;const move=await f.request(`playlists/${id}/move`,{entryId:boundary,direction:1,revision:first.playlist.revision});expect(move.statusCode).toBe(200);
 const second=(await f.request(`playlists/${id}?offset=48&limit=48`)).json();expect(second.items[0].id).toBe(boundary);
 const tail=(await f.request(`playlists/${id}?offset=4992`)).json();expect(tail.items).toHaveLength(8);expect(tail.nextOffset).toBeNull();
 const favorites=(await f.request('favorites?offset=4992')).json();expect(favorites.items).toHaveLength(8);expect(favorites.nextOffset).toBeNull();
 vi.mocked(f.library.track).mockClear();const refs=(await f.request(`playlists/${id}/queue`)).json().items;expect(refs).toHaveLength(5000);expect(refs[48].id).toBe(boundary);expect(refs.every((r:object)=>!('track' in r))).toBe(true);expect(vi.mocked(f.library.track)).not.toHaveBeenCalled();
 expect((await f.request(`playlists/${id}/queue`,undefined,1)).statusCode).toBe(404);
 for(const path of [`playlists/${id}?limit=101`,`playlists/${id}?offset=-1`,'favorites?limit=0'])expect((await f.request(path)).statusCode).toBe(400);
 // Production-sized queue exceeds the former 16 KiB global request limit.
 const state={...emptyPlayback(),queue:refs.map((r:{id:string;source:'local';trackId:string})=>({key:r.id,source:r.source,trackId:r.trackId})),order:refs.map((r:{id:string})=>r.id),current:refs[0].id};
 const saved=await f.app.inject({method:'POST',url:'/api/playback',headers:{cookie:`freeqify_session=${f.sessions[0]!.token}`,origin:'http://localhost:80','x-csrf-token':f.sessions[0]!.csrf},payload:state});expect(saved.statusCode).toBe(200);expect(JSON.parse(String(f.auth.db.prepare('SELECT state FROM playback_state WHERE user_id=?').get('alice')?.state))).toEqual(state);
 const plan=f.auth.db.prepare('EXPLAIN QUERY PLAN SELECT * FROM personal_entries WHERE playlist_id=? ORDER BY position LIMIT 48 OFFSET 4992').all(id);expect(JSON.stringify(plan)).toContain('INDEX');
 console.log(`CAPACITY benchmark: insert 5,000 entries + 5,000 favorites ${Math.round(populated-start)}ms; paged/API/queue checks ${Math.round(performance.now()-populated)}ms`);
 expect(performance.now()-start).toBeLessThan(20000);
});

it('validates bounded bulk writes, checks CSRF/ownership and rejects overflowing batches atomically',async()=>{
 const f=await fixture();const id=await f.create();const tracks=Array.from({length:100},()=>({source:'local',trackId:'song-1'}));
 expect((await f.request(`playlists/${id}/bulk`,{tracks})).statusCode).toBe(200);expect(f.store.references('alice',id)).toHaveLength(100);
 expect((await f.request('favorites/bulk',{tracks})).statusCode).toBe(200);expect(f.store.favoriteIds('alice')).toEqual(['song-1']);
 expect((await f.request(`playlists/${id}/bulk`,{tracks},1)).statusCode).toBe(404);expect((await f.request(`playlists/${id}/bulk`,{tracks},0,{'x-csrf-token':''})).statusCode).toBe(403);
 for(const values of [[],[...tracks,tracks[0]], [{source:'local',trackId:'../private'}]])expect((await f.request(`playlists/${id}/bulk`,{tracks:values})).statusCode).toBe(400);
 const batch=Array.from({length:100},()=>track);for(let i=0;i<49;i++)f.store.addMany('alice',id,batch);
 expect((await f.request(`playlists/${id}/bulk`,{tracks})).statusCode).toBe(400);expect(f.store.references('alice',id)).toHaveLength(5000);
});

it('preserves 5,000-track collections, ordering, duplicate IDs and accounts across database restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'freeqify-capacity-'));const file=join(dir,'accounts.sqlite');let auth=new AuthStore(file,readConfig({}).auth);
 try{
 auth.db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run('owner','owner','unchanged-test-hash','listener','active',1);let store=new PersonalStore(auth);const id=store.create('owner','Persistent large');
 for(let n=0;n<50;n++){store.addMany('owner',id,Array.from({length:100},()=>track));store.favoriteMany('owner',Array.from({length:100},(_,i)=>({...track,id:`favorite-${n*100+i}`})));}
 const before=store.references('owner',id);store.reorder('owner',id,before.map(t=>t.id).reverse(),50);auth.close();auth=new AuthStore(file,readConfig({}).auth);store=new PersonalStore(auth);
 expect(store.references('owner',id).map(t=>t.id)).toEqual(before.map(t=>t.id).reverse());expect(store.favoriteIds('owner')).toHaveLength(5000);expect(store.entries('owner',id,4992,48)).toHaveLength(8);expect(auth.db.prepare('SELECT password_hash FROM users').get()?.password_hash).toBe('unchanged-test-hash');
 }finally{auth.close();await rm(dir,{recursive:true,force:true});}
});

it.each(['/','/freeqify/'])('atomically saves the complete queue snapshot with duplicates, CSRF and owner isolation at %s',async base=>{
 const f=await fixture(base),body={name:'Entire listening queue',tracks:['song-1','song-2','song-1'].map(trackId=>({source:'local',trackId}))};
 expect((await f.request('playlists/from-queue',body,0,{'x-csrf-token':''})).statusCode).toBe(403);
 const result=await f.request('playlists/from-queue',body);expect(result.statusCode).toBe(200);const id=result.json().id;
 const saved=(await f.request(`playlists/${id}`)).json();expect(saved.items.map((t:{trackId:string})=>t.trackId)).toEqual(['song-1','song-2','song-1']);expect(new Set(saved.items.map((t:{id:string})=>t.id)).size).toBe(3);
 expect((await f.request(`playlists/${id}`,undefined,1)).statusCode).toBe(404);expect((await f.request(`playlists/${id}`,undefined,2)).statusCode).toBe(404);
 expect((await f.request('playlists/from-queue',{...body,tracks:[{source:'remote',trackId:'song-1'}]})).statusCode).toBe(400);
 const before=f.store.playlists('alice').length;vi.mocked(f.library.track).mockRejectedValue(new LibraryError('UNAVAILABLE'));
 expect((await f.request('playlists/from-queue',{name:'Failed save',tracks:[{source:'local',trackId:'unavailable'}]})).statusCode).not.toBe(200);expect(f.store.playlists('alice')).toHaveLength(before);
});

it('saves 5,000 queue occurrences atomically with one trusted metadata lookup per unique ID',async()=>{
 const f=await fixture();const response=await f.request('playlists/from-queue',{name:'Full queue',tracks:Array.from({length:5000},()=>({source:'local',trackId:'song-1'}))});expect(response.statusCode).toBe(200);
 expect(vi.mocked(f.library.track)).toHaveBeenCalledTimes(1);expect(f.store.references('alice',response.json().id)).toHaveLength(5000);
 expect((await f.request('playlists/from-queue',{name:'Too big',tracks:Array.from({length:5001},()=>({source:'local',trackId:'song-1'}))})).statusCode).toBe(400);
});
it('rejects forged metadata and a revoked session before creating a saved queue playlist',async()=>{
 const f=await fixture();let release!:(value:Track)=>void;vi.mocked(f.library.track).mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
 const pending=f.request('playlists/from-queue',{name:'Revoked',userId:'bob',tracks:[{source:'local',trackId:'song-1',metadata:{title:'Forged'}}]});
 await vi.waitFor(()=>expect(release).toBeTypeOf('function'));f.auth.logout(f.sessions[0]!.token);release(track);expect((await pending).statusCode).toBe(401);expect(f.store.playlists('alice')).toHaveLength(0);expect(f.store.playlists('bob')).toHaveLength(0);
});
