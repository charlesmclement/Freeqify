import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import type {Account,Album,Track} from '@freeqify/shared';
import {createApp} from './app.js';
import {AuthStore} from './auth/store.js';
import {readConfig} from './config.js';
import {LibraryRemovals,removableLibrary} from './library-removals.js';
import {LibraryError,type MusicLibrary} from './integrations/navidrome.js';
import {PersonalStore} from './personal-store.js';
import {DatabaseSync} from 'node:sqlite';
import {migrations} from './storage/migrations.js';
const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const dispose of cleanup.splice(0))await dispose();});
async function fixture(base='/'){
 const root=await mkdtemp(join(tmpdir(),'freeqify-removals-'));await writeFile(join(root,'index.html'),`<meta content="${base}">`);await writeFile(join(root,'original.mp3'),'unaltered fixture music');
 const config=readConfig({BASE_PATH:base,WEB_DIST_DIR:root});const file=join(root,'auth.sqlite');const auth=new AuthStore(file,config.auth);
 const users=['admin','listener'].map((id,i)=>{const user:Account={id,username:id,role:i===0?'admin':'listener',status:'active',createdAt:1};auth.db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(id,id,'unusable-test-hash',user.role,'active',1);return user;});
 const sessions=users.map(u=>auth.createSession(u));
 const albums:Album[]=['a','b'].map((id,i)=>({id,title:`Album ${id}`,artist:'Artist',artistId:'artist',trackCount:i===0?2:1,artworkId:null,year:null}));
 const tracks:Track[]=['one','two','three'].map((id,i)=>({id,title:id,artist:'Artist',album:i<2?'Album a':'Album b',albumId:i<2?'a':'b',artworkId:null,duration:90,format:'wav',trackNumber:i+1}));
 const page=<T,>(items:T[],offset:number,limit:number)=>({items:structuredClone(items.slice(offset,offset+limit)),nextOffset:items.length>offset+limit?offset+limit:null});
 const raw:MusicLibrary={
  ping:async()=>{},artists:async()=>[{id:'artist',name:'Artist',albumCount:2,artworkId:null}],artist:async()=>({artist:{id:'artist',name:'Artist',albumCount:2,artworkId:null},albums:structuredClone(albums)}),
  albums:async(o,l)=>page(albums,o,l),album:vi.fn(async id=>{const album=albums.find(a=>a.id===id);if(!album)throw new LibraryError('NOT_FOUND');return {album:structuredClone(album),tracks:structuredClone(tracks.filter(t=>t.albumId===id))};}),
  tracks:async(o,l)=>page(tracks,o,l),track:vi.fn(async id=>{const t=tracks.find(t=>t.id===id);if(!t)throw new LibraryError('NOT_FOUND');return structuredClone(t);}),
  overview:async()=>({artists:1,albums:albums.length,tracks:tracks.length,scanning:false}),
  search:async(_q,o,l)=>({artists:o?[]:[{id:'artist',name:'Artist',albumCount:2,artworkId:null}],albums:page(albums,o,l).items,tracks:page(tracks,o,l).items}),
  artwork:async()=>({bytes:Buffer.from([255,216,255]),contentType:'image/jpeg'}),
  stream:vi.fn(async()=>new Response('fixture',{headers:{'content-type':'audio/wav'}})),scanStatus:async()=>({scanning:false,count:tracks.length}),startScan:async()=>({scanning:false,count:tracks.length}),
 };
 const app=await createApp(config,{library:raw,authStore:auth});let closed=false;
 const stop=async()=>{if(!closed){closed=true;await app.close();}};
 cleanup.push(async()=>{await stop();await rm(root,{recursive:true,force:true});});
 const request=(path:string,body?:unknown,who=0,headers:Record<string,string>={})=>app.inject({url:`${base}api/${path}`,method:body===undefined?'GET':'POST',...(body===undefined?{}:{payload:body as object}),headers:{host:'localhost',origin:'http://localhost',cookie:`freeqify_session=${sessions[who]!.token}`,'x-csrf-token':sessions[who]!.csrf,...headers}});
 const change=(kind:'track'|'album',id:string,restore=false)=>request(`library/${restore?'removed/restore':'remove'}`,{kind,id,confirmed:true});
 return {root,auth,config,file,raw,app,stop,request,change,tracks,sessions};
}
describe.each(['/','/music/'])('application library removals at %s',base=>{
 it('requires active admins, CSRF and explicit confirmation; rejects filesystem and forged metadata input',async()=>{
  const f=await fixture(base),body={kind:'track',id:'one',confirmed:true};
  expect((await f.request('library/removed',undefined,1)).statusCode).toBe(403);
  expect((await f.request('library/remove',body,1)).statusCode).toBe(403);
  expect((await f.request('library/removed/restore',body,1)).statusCode).toBe(403);
  expect((await f.app.inject({url:`${base}api/library/removed`,headers:{host:'localhost'}})).statusCode).toBe(401);
  expect((await f.request('library/remove',body,0,{'x-csrf-token':'wrong'})).statusCode).toBe(403);
  expect((await f.request('library/remove',body,0,{origin:'http://foreign.example'})).statusCode).toBe(403);
  for(const value of [{...body,confirmed:false},{...body,id:'../../music'},{...body,path:'/music'},{...body,userId:'admin'},{...body,kind:'artist'},{...body,title:'Forged'}])expect((await f.request('library/remove',value)).statusCode).toBe(400);
  expect(f.raw.track).not.toHaveBeenCalled();expect(new LibraryRemovals(f.auth).all()).toEqual([]);
  f.auth.db.prepare("UPDATE users SET status='disabled' WHERE id='admin'").run();
  expect((await f.change('track','one')).statusCode).toBe(401);
 });
 it('hides an album globally, preserves personal references/files and handles new indexed tracks until restored',async()=>{
  const f=await fixture(base);const personal=new PersonalStore(f.auth);const playlist=personal.create('listener','Saved duplicates');personal.addMany('listener',playlist,[f.tracks[0]!,f.tracks[0]!]);personal.favorite('listener',f.tracks[0]!,true);
  const saved=JSON.stringify(personal.entries('listener',playlist));
  expect((await f.change('track','one')).statusCode).toBe(200);
  expect((await f.change('album','a')).statusCode).toBe(200);
  expect((await f.change('album','a')).statusCode).toBe(200);
  for(const who of [0,1]){
   expect((await f.request('library/tracks',undefined,who)).json().items.map((t:Track)=>t.id)).toEqual(['three']);
   expect((await f.request('library/albums',undefined,who)).json().items.map((a:Album)=>a.id)).toEqual(['b']);
   expect((await f.request('library/overview',undefined,who)).json()).toMatchObject({artists:1,albums:1,tracks:1});
   expect((await f.request('library/albums/a',undefined,who)).statusCode).toBe(404);
   expect((await f.request('library/tracks/two',undefined,who)).statusCode).toBe(404);
   expect((await f.request('library/stream/two',undefined,who)).statusCode).toBe(404);
  }
  expect(f.raw.stream).not.toHaveBeenCalled();
  expect((await f.request('personal/favorites',undefined,1)).json().items[0].available).toBe(false);
  expect(JSON.stringify(personal.entries('listener',playlist))).toBe(saved);
  f.tracks.push({...f.tracks[1]!,id:'new-song'});
  expect((await f.request('library/stream/new-song',undefined,1)).statusCode).toBe(404);
  expect((await f.request('library/scan',{})).statusCode).toBe(200);
  expect((await f.request('library/tracks')).json().items.map((t:Track)=>t.id)).toEqual(['three']);
  expect((await f.change('album','a',true)).statusCode).toBe(200);
  expect((await f.request('library/tracks')).json().items.map((t:Track)=>t.id)).toEqual(['two','three','new-song']);
  expect((await f.request('library/stream/one')).statusCode).toBe(404);
  expect((await f.change('track','one',true)).statusCode).toBe(200);
  expect((await f.request('personal/favorites',undefined,1)).json().items[0].available).toBe(true);
  expect(await readFile(join(f.root,'original.mp3'),'utf8')).toBe('unaltered fixture music');
  expect(JSON.stringify(personal.entries('listener',playlist))).toBe(saved);
 });
 it('keeps raw pagination reachable through fully filtered pages and hides empty artist/album lists',async()=>{
  const f=await fixture(base);await f.change('album','a');
  expect((await f.request('library/tracks?limit=1')).json()).toEqual({items:[],nextOffset:1});
  expect((await f.request('library/search?q=test&limit=1')).json()).toMatchObject({albums:[],tracks:[],nextOffset:1});
  expect((await f.request('library/tracks?offset=2&limit=1')).json().items[0].id).toBe('three');
  await f.change('album','b');
  expect((await f.request('library/artists')).json().items).toEqual([]);
  expect((await f.request('library/overview')).json()).toMatchObject({artists:0,albums:0,tracks:0});
  expect((await f.request('library/artists/artist')).statusCode).toBe(404);
  expect((await f.request('library/removed')).json().items).toHaveLength(2);
 });
 it('rechecks a disabled administrator after an upstream lookup and saves nothing on engine failure',async()=>{
  const f=await fixture(base);vi.mocked(f.raw.track).mockRejectedValueOnce(new LibraryError('UNAVAILABLE'));
  expect((await f.change('track','one')).statusCode).toBe(502);
  expect(new LibraryRemovals(f.auth).all()).toHaveLength(0);
  let resolve!:(t:Track)=>void;vi.mocked(f.raw.track).mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
  const request=f.change('track','one');await vi.waitFor(()=>expect(resolve).toBeTypeOf('function'));
  f.auth.db.prepare("UPDATE users SET status='disabled' WHERE id='admin'").run();resolve(f.tracks[0]!);
  expect((await request).statusCode).toBe(401);expect(new LibraryRemovals(f.auth).all()).toHaveLength(0);
 });
});
it('persists removals and existing sessions/personal data across application restart',async()=>{
 const f=await fixture();await f.change('track','one');const personal=new PersonalStore(f.auth);personal.favorite('listener',f.tracks[0]!,true);
 await f.stop();const reopened=new AuthStore(f.file,f.config.auth);
 try{
  const removals=new LibraryRemovals(reopened);expect(removals.all()).toHaveLength(1);
  await expect(removableLibrary(f.raw,removals).track('one')).rejects.toMatchObject({code:'NOT_FOUND'});
  expect(reopened.session(f.sessions[1]!.token)?.user?.id).toBe('listener');
  expect(new PersonalStore(reopened).favorites('listener')).toHaveLength(1);
  expect(reopened.db.prepare('PRAGMA user_version').get()?.user_version).toBe(12);
 }finally{reopened.close();}
});
it('migration 12 is additive to schema 11 and retains every existing user row',()=>{
 const db=new DatabaseSync(':memory:');try{
  for(const m of migrations.slice(0,11))db.exec(m.sql);
  db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run('prior','Prior','unchanged-hash','admin','active',123);
  const before=db.prepare('SELECT * FROM users').all();db.exec(migrations[11]!.sql);
  expect(db.prepare('SELECT * FROM users').all()).toEqual(before);
  expect(db.prepare('SELECT * FROM library_removals').all()).toEqual([]);
 }finally{db.close();}
});
