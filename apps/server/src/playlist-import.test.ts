import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {migrations} from './storage/migrations.js';
import {afterEach,describe,expect,it,vi} from 'vitest';
import Fastify from 'fastify';
import {AuthStore} from './auth/store.js';
import {registerAuthentication} from './auth/routes.js';
import {registerImportRoutes} from './import-routes.js';
import {readConfig} from './config.js';
import {parsePlaylistCsv} from './import-csv.js';
import {matchImported} from './import-matching.js';
import {ImportStore} from './import-store.js';
import {PersonalStore} from './personal-store.js';
import {LibraryError,type MusicLibrary} from './integrations/navidrome.js';
import type {AlbumIntegration} from './integrations/lidarr.js';
import type {Account,ImportedMetadata,Track} from '@freeqify/shared';
const csv='Track Name,Artist Name(s),Album Name,Track Duration (ms),ISRC\r\nSong,Artist,Album,100000,USAAA2000001\r\nSong,Artist,Album,100000,USAAA2000001';
const metadata:ImportedMetadata={title:'Song',artist:'Artist',album:'Album',albumArtist:'Artist',duration:100,isrc:'USAAA2000001',spotifyTrackId:null,spotifyAlbumId:null,releaseDate:null,discNumber:1,trackNumber:1};
const track:Track={id:'song',title:'Song',artist:'Artist',album:'Album',albumId:'album',duration:100,format:'flac',trackNumber:1,artworkId:null};
it('parses quoted Unicode, commas, newlines, BOM, CRLF and escaped quotes without losing duplicates or order',()=>{
 const input='\uFEFFTrack Name,Artist Name(s),Album Name\r\n"First, ""Song""",Artist,"Album\nTwo"\r\nSecond,Artist,Album\r\nSecond,Artist,Album';
 const rows=parsePlaylistCsv(input);expect(rows.map(r=>r.title)).toEqual(['First, "Song"','Second','Second']);expect(rows[0]?.album).toBe('Album\nTwo');expect(parsePlaylistCsv(csv)).toHaveLength(2);
});
it.each(['Title,Artist\nSong,Artist','Title,Artist,Album\n"unfinished','Title,Artist,Album\nSong,Artist,Album,extra','Title,Artist,Album\nSong,,Album','Title,Artist,Album\n"Song"oops,Artist,Album','Title,Artist,Album\nSo\0ng,Artist,Album','Title,Artist,Album,ISRC\nSong,Artist,Album,invalid'])('rejects invalid CSV %#',input=>expect(()=>parsePlaylistCsv(input)).toThrow());
it('bounds upload size, field size and row count; accepts genuinely empty exported playlists',()=>{expect(()=>parsePlaylistCsv('x'.repeat(2097153))).toThrow('2 MB');expect(()=>parsePlaylistCsv('Title,Artist,Album\n'+ 'x'.repeat(4097)+',Artist,Album')).toThrow('4,096');expect(()=>parsePlaylistCsv('Title,Artist,Album\n'+ 'Song,Artist,Album\n'.repeat(5001))).toThrow('5,000');expect(parsePlaylistCsv('Title,Artist,Album')).toEqual([]);});
it('extracts supported Spotify export identifiers without contacting or retaining external image URLs',()=>{const r=parsePlaylistCsv('Track Name,Artist Name(s),Album Name,Track URI,Album URI,Album Image URL\nSong,Artist,Album,spotify:track:1234567890123456789012,spotify:album:abcdefghijklmnopqrstuv,https://evil.invalid/private')[0];expect(r?.spotifyTrackId).toBe('1234567890123456789012');expect(r?.spotifyAlbumId).toBe('abcdefghijklmnopqrstuv');expect(JSON.stringify(r)).not.toContain('evil.invalid');});
it('auto-matches only a unique exact recording; ambiguous editions, missing duration and alternate versions need review',()=>{
 expect(matchImported(metadata,[track]).status).toBe('available');expect(matchImported(metadata,[track,{...track,id:'duplicate'}]).status).toBe('review');expect(matchImported(metadata,[{...track,album:'Compilation'}]).status).toBe('review');expect(matchImported(metadata,[{...track,title:'Song (Live)'}]).status).toBe('review');expect(matchImported(metadata,[{...track,artist:'Other'}]).status).toBe('missing');expect(matchImported({...metadata,duration:null},[track]).status).toBe('review');expect(matchImported(metadata,[{...track,isrc:'USBBB2000001'}]).status).toBe('review');expect(matchImported(metadata,[track],['song']).status).toBe('missing');
});
const cleanup:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const f of cleanup.splice(0))await f();});
async function fixture(base='/'){
 const config=readConfig({BASE_PATH:base}),auth=new AuthStore(':memory:',config.auth);const users=['alice','bob','admin'].map((id,i)=>{auth.db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(id,id,'unusable-test-hash',i===2?'admin':'listener','active',1);return {id,username:id,role:i===2?'admin':'listener',status:'active',createdAt:1} as Account;});const sessions=users.map(u=>auth.createSession(u));
 const library={search:vi.fn().mockResolvedValue({artists:[],albums:[],tracks:[track]}),track:vi.fn().mockResolvedValue(track)} as unknown as MusicLibrary;
 const monitored=new Set<string>();const lidarr:AlbumIntegration={status:vi.fn().mockResolvedValue({configured:true,connected:true,canRequest:true,message:'connected'}),lookup:vi.fn().mockResolvedValue([{id:'album-request',title:'Album',artist:'Artist',year:2020,monitored:false,present:false,canRequest:true}]),state:vi.fn(async id=>({monitored:monitored.has(id),present:false})),request:vi.fn(async id=>{monitored.add(id);})};
 const app=Fastify({bodyLimit:16*1024});registerAuthentication(app,base+'api',config,auth);registerImportRoutes(app,base+'api/imports',auth,library,config,lidarr);await app.ready();cleanup.push(async()=>{await app.close();auth.close();});
 const request=(path:string,input?:unknown,user=0,headers:Record<string,string>={})=>app.inject({method:input===undefined?'GET':'POST',url:base+'api/imports/'+path,headers:{host:'localhost',origin:'http://localhost',cookie:`freeqify_session=${sessions[user]!.token}`,'x-csrf-token':sessions[user]!.csrf,...headers},...(input===undefined?{}:{payload:input})});
 const create=async(user=0,text=csv)=>(await request('',{filename:'playlist.csv',name:'Imported',csv:text},user)).json().id as string;
 return {auth,app,request,create,library,lidarr,store:new ImportStore(auth)};
}
describe.each(['/','/music/'])('private import routes %s',base=>{
 it('preserves duplicate positions, isolates owners including administrators, requires CSRF and keeps queue unchanged',async()=>{
  const f=await fixture(base);const id=await f.create();expect(id).toBeTruthy();let data=(await f.request(id)).json();expect(data.items.map((e:{position:number})=>e.position)).toEqual([1,2]);expect(data.items[0].status).toBe('review');expect(data.items[0].checkedAt).toBeNull();
  expect((await f.request(id,undefined,1)).statusCode).toBe(404);expect((await f.request(id,undefined,2)).statusCode).toBe(404);expect((await f.request(id+'/recheck',{},0,{'x-csrf-token':'wrong'})).statusCode).toBe(403);expect((await f.request(id+'/recheck',{},0,{origin:'https://foreign.invalid'})).statusCode).toBe(403);expect((await f.app.inject({url:base+'api/imports/',headers:{host:'localhost'}})).statusCode).toBe(401);
  await f.request(id+'/recheck',{});data=(await f.request(id)).json();expect(data.playlist.counts.available).toBe(2);expect(f.auth.db.prepare('SELECT count(*) AS n FROM playback_state').get()?.n).toBe(0);
  const created=(await f.request(id+'/playlist',{})).json();expect(created.id).toBeTruthy();expect(new PersonalStore(f.auth).references('alice',created.id).map(t=>t.trackId)).toEqual(['song','song']);expect((await f.request(id+'/playlist',{})).json().id).toBe(created.id);expect(f.store.entries('alice',id)).toHaveLength(2);
 });
 it('retains prior statuses on outage, supports explicit review/rejection, and never accepts a caller-injected track',async()=>{
  const f=await fixture(base),id=await f.create();vi.mocked(f.library.search).mockResolvedValue({artists:[],albums:[],tracks:[{...track,album:'Soundtrack'}]});await f.request(id+'/recheck',{});let entries=f.store.entries('alice',id);expect(entries[0]?.status).toBe('review');
  expect((await f.request(id+'/review',{entryId:entries[0]!.id,action:'confirm',trackId:'injected'})).statusCode).toBe(400);await f.request(id+'/review',{entryId:entries[0]!.id,action:'confirm',trackId:'song'});await f.request(id+'/review',{entryId:entries[1]!.id,action:'reject'});entries=f.store.entries('alice',id);expect(entries.map(e=>e.status)).toEqual(['available','missing']);
  vi.mocked(f.library.search).mockRejectedValue(new LibraryError('UNAVAILABLE'));expect((await f.request(id+'/recheck',{})).statusCode).toBe(502);expect(f.store.entries('alice',id).map(e=>e.status)).toEqual(['available','missing']);
 });
 it('groups selected tracks into containing albums and submits only explicitly reviewed administrator choices',async()=>{
  const f=await fixture(base),id=await f.create(2);vi.mocked(f.library.search).mockResolvedValue({artists:[],albums:[],tracks:[]});await f.request(id+'/recheck',{},2);const entries=f.store.entries('admin',id);const review=(await f.request(id+'/albums/review',{entries:entries.map(e=>e.id)},2)).json();expect(review.albums).toHaveLength(1);expect(review.albums[0].tracks).toBe(2);expect(f.lidarr.request).not.toHaveBeenCalled();
  const input={reviewId:review.id,choices:[{key:review.albums[0].key,albumId:'album-request'}],search:false,confirmed:true};expect((await f.request(id+'/albums/confirm',{...input,confirmed:false},2)).statusCode).toBe(400);expect((await f.request(id+'/albums/confirm',{...input,choices:[{key:review.albums[0].key,albumId:'injected'}]},2)).statusCode).toBe(400);expect((await f.request(id+'/albums/confirm',input,2)).statusCode).toBe(200);expect(f.lidarr.request).toHaveBeenCalledExactlyOnceWith('album-request',false);expect(f.store.entries('admin',id).map(e=>e.status)).toEqual(['requested','requested']);expect((await f.request(id+'/albums/confirm',input,2)).statusCode).toBe(409);
 });
 it('denies listeners acquisition access while allowing checklist use, and validates pagination and file types',async()=>{
  const f=await fixture(base),id=await f.create();expect((await f.request('lidarr')).json().canRequest).toBe(false);expect((await f.request(id+'/albums/review',{entries:[]})).statusCode).toBe(403);for(const query of ['?offset=-1','?limit=0','?limit=101','?status=invalid'])expect((await f.request(id+query)).statusCode).toBe(400);expect((await f.request('',{filename:'playlist.zip',name:'Bad',csv})).statusCode).toBe(400);
 });
});
it('accounts for imported metadata in existing storage limits and rolls back over-quota imports',async()=>{const f=await fixture();const before=f.auth.resources.personalBytes;try{f.auth.resources.personalBytes=300;expect(()=>f.store.create('alice','Test',[metadata])).toThrow();expect(f.store.list('alice')).toEqual([]);}finally{f.auth.resources.personalBytes=before;}});
it('does not persist matches after session revocation during a catalog lookup',async()=>{const f=await fixture(),id=await f.create();vi.mocked(f.library.search).mockImplementation(async()=>{f.auth.db.prepare("UPDATE users SET status='disabled' WHERE id='alice'").run();return {artists:[],albums:[],tracks:[track]};});expect((await f.request(id+'/recheck',{})).statusCode).toBe(401);const row=f.auth.db.prepare('SELECT payload FROM imported_entries WHERE playlist_id=? LIMIT 1').get(id);expect(JSON.parse(String(row?.payload)).checkedAt).toBeNull();});
it('filters and pages original positions in SQL without changing duplicate entry identity',async()=>{const f=await fixture();const id=await f.create();await f.request(id+'/recheck',{});const result=(await f.request(id+'?status=available&q=ARTIST&limit=1&offset=1')).json();expect(result.items).toHaveLength(1);expect(result.items[0].position).toBe(2);expect(result.nextOffset).toBeNull();expect(f.store.entries('alice',id)[1]?.id).toBe(result.items[0].id);});
it('keeps the checklist recheck usable when Lidarr goes offline after an earlier confirmed request',async()=>{const f=await fixture(),id=await f.create();const entries=f.store.entries('alice',id);entries[0]!.request={albumId:'prior-confirmed'};entries[0]!.status='requested';f.store.save('alice',id,entries);vi.mocked(f.library.search).mockResolvedValue({artists:[],albums:[],tracks:[]});vi.mocked(f.lidarr.state).mockRejectedValue(new Error('offline'));expect((await f.request(id+'/recheck',{})).statusCode).toBe(200);const after=f.store.entries('alice',id);expect(after[0]?.status).toBe('requested');expect(after[0]?.reason).toContain('Last confirmed');expect(after[1]?.status).toBe('missing');});

it('upgrades a populated schema-7 copy additively and persists private checklist decisions across restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'freeqify-import-storage-'));cleanup.push(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'accounts.sqlite');const old=new DatabaseSync(file);for(const m of migrations.filter(m=>m.version<=7))old.exec(m.sql);old.exec("PRAGMA user_version=7; INSERT INTO users VALUES ('owner','owner','unchanged-test-hash','listener','active',1); INSERT INTO personal_playlists(id,user_id,name,created_at,updated_at) VALUES ('prior','owner','Prior playlist',1,1);");old.close();
 let auth=new AuthStore(file,readConfig({}).auth),store=new ImportStore(auth);const id=store.create('owner','Import',[metadata,metadata]);const entries=store.entries('owner',id);entries[0]!.manual=true;entries[0]!.track=track;entries[0]!.status='available';entries[0]!.checkedAt=Date.now();entries[1]!.rejected=['song'];store.save('owner',id,entries);const usage=auth.storageUsage('owner').user;auth.close();
 auth=new AuthStore(file,readConfig({}).auth);store=new ImportStore(auth);try{expect(auth.db.prepare('PRAGMA user_version').get()?.user_version).toBe(12);expect(auth.db.prepare('SELECT password_hash FROM users').get()?.password_hash).toBe('unchanged-test-hash');expect(new PersonalStore(auth).playlists('owner')[0]?.name).toBe('Prior playlist');expect(store.entries('owner',id).map(e=>[e.position,e.manual,e.rejected])).toEqual([[1,true,[]],[2,false,['song']]]);expect(auth.storageUsage('owner').user).toBe(usage);}finally{auth.close();}
});
it('deduplicates album requests across different imported credits resolving to the same album',async()=>{const f=await fixture();const id=f.store.create('admin','Different credits',[metadata,{...metadata,albumArtist:'Various Artists'}]);vi.mocked(f.library.search).mockResolvedValue({artists:[],albums:[],tracks:[]});await f.request(id+'/recheck',{},2);const entries=f.store.entries('admin',id);const review=(await f.request(id+'/albums/review',{entries:entries.map(e=>e.id)},2)).json();expect(review.albums).toHaveLength(2);const result=await f.request(id+'/albums/confirm',{confirmed:true,search:false,reviewId:review.id,choices:review.albums.map((a:{key:string})=>({key:a.key,albumId:'album-request'}))},2);expect(result.statusCode).toBe(200);expect(result.json().submitted).toBe(1);expect(f.lidarr.request).toHaveBeenCalledTimes(1);});
it('rejects stale album review when a selected missing recording has become available',async()=>{const f=await fixture(),id=await f.create(2);vi.mocked(f.library.search).mockResolvedValue({artists:[],albums:[],tracks:[]});await f.request(id+'/recheck',{},2);const entries=f.store.entries('admin',id);const review=(await f.request(id+'/albums/review',{entries:entries.map(e=>e.id)},2)).json();entries[0]!.status='available';entries[0]!.track=track;f.store.save('admin',id,entries);expect((await f.request(id+'/albums/confirm',{confirmed:true,search:false,reviewId:review.id,choices:[{key:review.albums[0].key,albumId:'album-request'}]},2)).statusCode).toBe(409);expect(f.lidarr.request).not.toHaveBeenCalled();});

it('automatically indexes newly imported requested albums for administrators, deduplicates scans, and marks later matches playable',async()=>{
 const f=await fixture(),id=await f.create(2);const entries=f.store.entries('admin',id);for(const entry of entries){entry.request={albumId:'prior-confirmed'};entry.status='requested';}f.store.save('admin',id,entries);
 vi.mocked(f.library.search).mockResolvedValue({artists:[],albums:[],tracks:[]});vi.mocked(f.lidarr.state).mockResolvedValue({monitored:true,present:true});
 f.library.scanStatus=vi.fn().mockResolvedValue({scanning:false,count:301});f.library.startScan=vi.fn().mockResolvedValue({scanning:true,count:301});
 expect((await f.request(id+'/recheck',{},2)).statusCode).toBe(200);expect(f.library.startScan).toHaveBeenCalledTimes(1);
 await f.request(id+'/recheck',{},2);expect(f.library.startScan).toHaveBeenCalledTimes(1);
 vi.mocked(f.library.search).mockResolvedValue({artists:[],albums:[],tracks:[track]});const result=await f.request(id+'/recheck',{},2);expect(result.json().newlyAvailable).toBe(2);expect(f.store.summary('admin',id).counts.available).toBe(2);
});
it('never lets listener checklist rechecks initiate a library scan',async()=>{const f=await fixture(),id=await f.create();const entries=f.store.entries('alice',id);entries[0]!.request={albumId:'prior'};entries[0]!.status='requested';f.store.save('alice',id,entries);vi.mocked(f.library.search).mockResolvedValue({artists:[],albums:[],tracks:[]});vi.mocked(f.lidarr.state).mockResolvedValue({monitored:true,present:true});f.library.scanStatus=vi.fn();f.library.startScan=vi.fn();await f.request(id+'/recheck',{});expect(f.library.startScan).not.toHaveBeenCalled();});

it('queues a whole 5,000-track selection, groups duplicate albums and preserves it across database restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'freeqify-album-queue-'));cleanup.push(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'accounts.sqlite');
 const {ImportQueue}=await import('./import-queue.js');
 let auth=new AuthStore(file,readConfig({}).auth);auth.db.prepare("INSERT INTO users VALUES ('owner','owner','preserved-hash','admin','active',1)").run();
 const store=new ImportStore(auth),id=store.create('owner','Large',Array.from({length:5000},(_,i)=>({...metadata,album:`Album ${i%120}`})));
 const entries=store.entries('owner',id);for(const e of entries){e.status='missing';e.checkedAt=1;}store.save('owner',id,entries);
 const q=new ImportQueue(auth).create('owner',id,'all');expect(q.items).toHaveLength(120);expect(q.items.reduce((n,i)=>n+i.entryIds.length,0)).toBe(5000);const usage=auth.storageUsage('owner').user;auth.close();
 auth=new AuthStore(file,readConfig({}).auth);try{expect(new ImportQueue(auth).get('owner',id)).toEqual(q);expect(auth.storageUsage('owner').user).toBe(usage);expect(auth.db.prepare('SELECT password_hash FROM users').get()?.password_hash).toBe('preserved-hash');}finally{auth.close();}
});
it('processes more than 10 albums over review batches, deduplicates confirmed requests and never auto-confirms',async()=>{
 const f=await fixture(),id=f.store.create('admin','Many',Array.from({length:55},(_,i)=>({...metadata,album:`Album ${i%12}`})));
 const entries=f.store.entries('admin',id);for(const e of entries){e.status='missing';e.checkedAt=1;}f.store.save('admin',id,entries);
 let q=(await f.request(id+'/albums/queue',{entries:'all'},2)).json();expect(q.total).toBe(12);
 for(let i=0;i<12;i++)q=(await f.request(id+'/albums/queue/step',{queueId:q.id},2)).json();
 expect(q.counts.review).toBe(10);expect(q.counts.pending).toBe(2);expect(f.lidarr.request).not.toHaveBeenCalled();
 const confirm=()=>f.request(id+'/albums/queue/confirm',{queueId:q.id,confirmed:true,search:true,choices:q.albums.map((a:{key:string})=>({key:a.key,albumId:'album-request'})),skip:[]},2);
 expect((await confirm()).statusCode).toBe(200);
 for(let i=0;i<12;i++)q=(await f.request(id+'/albums/queue/step',{queueId:q.id},2)).json();
 expect(q.counts.confirmed).toBe(10);expect(q.counts.review).toBe(2);expect(f.lidarr.request).toHaveBeenCalledExactlyOnceWith('album-request',true);
 await confirm();for(let i=0;i<2;i++)q=(await f.request(id+'/albums/queue/step',{queueId:q.id},2)).json();
 expect(q.counts.confirmed).toBe(12);expect(f.lidarr.request).toHaveBeenCalledTimes(1);expect(f.store.entries('admin',id).every(e=>e.status==='requested')).toBe(true);
});
it('protects persisted queues with owner/admin/CSRF checks, rejects fabricated choices and leaves failed albums retryable',async()=>{
 const f=await fixture(),id=await f.create(2);const entries=f.store.entries('admin',id);for(const e of entries){e.status='missing';e.checkedAt=1;}f.store.save('admin',id,entries);
 const q=(await f.request(id+'/albums/queue',{entries:'all'},2)).json();
 expect((await f.request(id+'/albums/queue',undefined,0)).statusCode).toBe(403);
 f.auth.db.prepare("UPDATE users SET role='admin' WHERE id='bob'").run();expect((await f.request(id+'/albums/queue',undefined,1)).statusCode).toBe(404);
 for(const headers of [{'x-csrf-token':'bad'},{origin:'https://foreign.invalid'}])expect((await f.request(id+'/albums/queue/step',{queueId:q.id},2,headers)).statusCode).toBe(403);
 vi.mocked(f.lidarr.lookup).mockRejectedValueOnce(new Error('secret upstream URL and token'));
 const failed=(await f.request(id+'/albums/queue/step',{queueId:q.id},2)).json();expect(failed.counts.failed).toBe(1);expect(JSON.stringify(failed)).not.toContain('secret');
 await f.request(id+'/albums/queue/retry',{queueId:q.id,key:failed.failures[0].key},2);const ready=(await f.request(id+'/albums/queue/step',{queueId:q.id},2)).json();
 const confirmation={queueId:q.id,confirmed:true,search:false,choices:[{key:ready.albums[0].key,albumId:'injected'}],skip:[]};
 expect((await f.request(id+'/albums/queue/confirm',confirmation,2)).statusCode).toBe(400);expect(f.lidarr.request).not.toHaveBeenCalled();
 expect((await f.request(id+'/albums/queue/confirm',{...confirmation,choices:[{key:ready.albums[0].key,albumId:'album-request'}]},2)).statusCode).toBe(200);
 vi.mocked(f.lidarr.request).mockRejectedValueOnce(new Error('private failure'));
 const failedRequest=(await f.request(id+'/albums/queue/step',{queueId:q.id},2)).json();expect(failedRequest.counts.failed).toBe(1);
 await f.request(id+'/albums/queue/retry',{queueId:q.id,key:failedRequest.failures[0].key},2);expect((await f.request(id+'/albums/queue/step',{queueId:q.id},2)).json().counts.confirmed).toBe(1);
 expect((await f.request(id+'/albums/queue/clear',{queueId:'stale'},2)).statusCode).toBe(409);
 expect((await f.request(id+'/albums/queue/clear',{queueId:q.id},2)).statusCode).toBe(200);expect((await f.request(id+'/albums/queue',undefined,2)).json()).toBeNull();expect(f.store.entries('admin',id)[0]?.status).toBe('requested');
});
it('revalidates administrator session after lookup and before a queued remote request',async()=>{
 const f=await fixture(),id=await f.create(2);const entries=f.store.entries('admin',id);for(const e of entries){e.status='missing';e.checkedAt=1;}f.store.save('admin',id,entries);
 const q=(await f.request(id+'/albums/queue',{entries:'all'},2)).json();
 vi.mocked(f.lidarr.lookup).mockImplementationOnce(async()=>{f.auth.db.prepare("DELETE FROM sessions WHERE user_id='admin'").run();return [];});
 expect((await f.request(id+'/albums/queue/step',{queueId:q.id},2)).statusCode).toBe(401);
 const {ImportQueue}=await import('./import-queue.js');expect(new ImportQueue(f.auth).get('admin',id)?.items[0]?.status).toBe('pending');expect(f.lidarr.request).not.toHaveBeenCalled();
});
it('counts queue payloads against storage quotas and cascades them when deleting a checklist',async()=>{
 const f=await fixture(),id=await f.create(2);const entries=f.store.entries('admin',id);for(const e of entries){e.status='missing';e.checkedAt=1;}f.store.save('admin',id,entries);
 const before=f.auth.storageUsage('admin').user,limit=f.auth.resources.personalBytes;f.auth.resources.personalBytes=before+1;
 try{expect((await f.request(id+'/albums/queue',{entries:'all'},2)).statusCode).toBe(429);expect(f.auth.storageUsage('admin').user).toBe(before);}finally{f.auth.resources.personalBytes=limit;}
 await f.request(id+'/albums/queue',{entries:'all'},2);expect(f.auth.storageUsage('admin').user).toBeGreaterThan(before);
 await f.request(id+'/delete',{},2);expect(f.auth.db.prepare('SELECT count(*) AS n FROM import_album_queues').get()?.n).toBe(0);expect(f.auth.storageUsage('admin').user).toBe(0);
});

it('accepts 5,000 explicit UUID selections through the bounded queue body limit',async()=>{
 const f=await fixture(),id=f.store.create('admin','Capacity',Array.from({length:5000},()=>metadata));
 const entries=f.store.entries('admin',id);for(const e of entries){e.status='missing';e.checkedAt=1;}f.store.save('admin',id,entries);
 const result=await f.request(id+'/albums/queue',{entries:entries.map(e=>e.id)},2);expect(result.statusCode).toBe(200);expect(result.json().total).toBe(1);expect(result.json().counts.pending).toBe(1);
});

it('Seek all automatically requests unique exact matches beyond ten albums without browser step requests',async()=>{
 vi.useFakeTimers({toFake:['setInterval','clearInterval']});
 const f=await fixture();
 try{
  const id=f.store.create('admin','Automatic',Array.from({length:12},(_,i)=>({...metadata,album:`Album ${i}`})));
  const entries=f.store.entries('admin',id);for(const e of entries){e.status='missing';e.checkedAt=1;}f.store.save('admin',id,entries);
  vi.mocked(f.lidarr.lookup).mockImplementation(async m=>[{id:'album-request',title:m.album,artist:m.artist,year:2020,monitored:false,present:false,canRequest:true}]);
  const result=await f.request(id+'/albums/queue/seek',{},2);expect(result.statusCode).toBe(200);expect(result.json().automatic).toBe(true);
  for(let i=0;i<28;i++)await vi.advanceTimersByTimeAsync(1000);
  const q=(await f.request(id+'/albums/queue',undefined,2)).json();expect(q.counts.confirmed).toBe(12);expect(f.lidarr.request).toHaveBeenCalledExactlyOnceWith('album-request',true);
  expect(JSON.stringify(q)).not.toContain('sessionHash');
 }finally{await f.app.close();vi.useRealTimers();}
});
it('leaves ambiguous matches for review, continues other albums and pauses on revoked background authority',async()=>{
 vi.useFakeTimers({toFake:['setInterval','clearInterval']});const f=await fixture();
 try{
  const id=f.store.create('admin','Ambiguity',[metadata,{...metadata,album:'Other'}]);const entries=f.store.entries('admin',id);for(const e of entries){e.status='missing';e.checkedAt=1;}f.store.save('admin',id,entries);
  vi.mocked(f.lidarr.lookup).mockImplementation(async m=>[{id:'album-request',title:m.album,artist:m.artist,year:2020,monitored:false,present:false,canRequest:true},...(m.album==='Album'?[{id:'edition-two',title:m.album,artist:m.artist,year:2021,monitored:false,present:false,canRequest:true}]:[])]);
  await f.request(id+'/albums/queue/seek',{},2);for(let i=0;i<5;i++)await vi.advanceTimersByTimeAsync(1000);
  let q=(await f.request(id+'/albums/queue',undefined,2)).json();expect(q.counts.review).toBe(1);expect(q.counts.confirmed).toBe(1);
  await f.request(id+'/albums/queue/seek',{},2);f.auth.db.prepare("DELETE FROM sessions WHERE user_id='admin'").run();await vi.advanceTimersByTimeAsync(1000);
  const {ImportQueue}=await import('./import-queue.js');q=new ImportQueue(f.auth).get('admin',id);expect(q.paused).toBe(true);expect(f.lidarr.request).toHaveBeenCalledTimes(1);
 }finally{await f.app.close();vi.useRealTimers();}
});
it('Seek all checks the live catalog to avoid acquiring recordings already present',async()=>{
 vi.useFakeTimers({toFake:['setInterval','clearInterval']});const f=await fixture();
 try{
  const id=await f.create(2),entries=f.store.entries('admin',id);for(const e of entries){e.status='missing';e.checkedAt=1;}f.store.save('admin',id,entries);
  vi.mocked(f.library.search).mockResolvedValue({artists:[],albums:[{id:'album',title:'Album',artist:'Artist',artistId:null,artworkId:null,trackCount:1,year:2020}],tracks:[track]});f.library.album=vi.fn().mockResolvedValue({tracks:[track]});
  await f.request(id+'/albums/queue/seek',{},2);await vi.advanceTimersByTimeAsync(1000);
  expect(f.lidarr.lookup).not.toHaveBeenCalled();expect(f.lidarr.request).not.toHaveBeenCalled();expect(f.store.summary('admin',id).counts.available).toBe(2);
  expect((await f.request(id+'/albums/queue',undefined,2)).json().counts.skipped).toBe(1);
 }finally{await f.app.close();vi.useRealTimers();}
});
