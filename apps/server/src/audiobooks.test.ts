import {afterEach,describe,expect,it,vi} from 'vitest';
import Fastify from 'fastify';
import {AuthStore} from './auth/store.js';
import {registerAuthentication} from './auth/routes.js';
import {readConfig} from './config.js';
import {registerAudiobookRoutes} from './audiobook-routes.js';
import {AudiobookStore} from './audiobook-store.js';
import * as speechReader from './book-spoken-headings.js';
import type {MusicLibrary} from './integrations/navidrome.js';
import type {Account,AlbumDetail} from '@freeqify/shared';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const album:AlbumDetail={album:{id:'book-album',title:'A long story',artist:'Author',artistId:'author',artworkId:null,trackCount:2,year:2026},tracks:[{id:'part-1',title:'First',artist:'Author',album:'A long story',albumId:'book-album',artworkId:null,duration:90000,format:'m4b',trackNumber:1},{id:'part-2',title:'Second',artist:'Author',album:'A long story',albumId:'book-album',artworkId:null,duration:1000,format:'mp3',trackNumber:2}]};
const cleanups:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const clean of cleanups.splice(0))await clean();vi.restoreAllMocks();});
async function fixture(base='/'){
 const config=readConfig({BASE_PATH:base}),auth=new AuthStore(':memory:',config.auth,Date.now,{...config.resources});
 const users=['alice','bob','admin'].map((id,i)=>{const role=i===2?'admin':'listener';auth.db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(id,id,'unusable-test-hash',role,'active',1);return {id,username:id,role,status:'active',createdAt:1}as Account;});
 const sessions=users.map(user=>auth.createSession(user));const library={audiobookAlbum:vi.fn(async()=>structuredClone(album)),audiobookAlbums:vi.fn(async()=>({items:[album.album],nextOffset:null}))}as unknown as MusicLibrary;
 const app=Fastify();registerAuthentication(app,`${base}api`,config,auth);registerAudiobookRoutes(app,`${base}api/audiobooks`,auth,library,config);
 cleanups.push(async()=>{await app.close();auth.close();});
 const request=(path='',body?:unknown,who=0,headers:Record<string,string>={})=>app.inject({url:`${base}api/audiobooks${path}`,method:body===undefined?'GET':'POST',...(body===undefined?{}:{payload:body}),headers:{cookie:`freeqify_session=${sessions[who]!.token}`,origin:'http://localhost:80','x-csrf-token':sessions[who]!.csrf,...headers}});
 return {auth,library,request,sessions,config,store:new AudiobookStore(auth)};
}
describe.each(['/','/freeqify/'])('audiobooks at %s',base=>{
 it('adds trusted ordered parts idempotently and exposes lightweight summaries',async()=>{const f=await fixture(base);const result=await f.request('',{albumId:'book-album'});expect(result.statusCode).toBe(200);const book=result.json();expect(book).toMatchObject({title:'A long story',duration:91000,status:'unstarted',revision:0});expect(book.parts.map((p:{id:string})=>p.id)).toEqual(['part-1','part-2']);expect(book.chapters.every((c:{kind:string})=>c.kind==='part')).toBe(true);expect((await f.request('',{albumId:'book-album'})).json().id).toBe(book.id);const list=(await f.request()).json();expect(list.items).toHaveLength(1);expect(list.items[0]).not.toHaveProperty('parts');expect(list.items[0]).not.toHaveProperty('bookmarks');});
 it('isolates books, chapters and progress from listeners and ordinary administrators',async()=>{const f=await fixture(base),book=(await f.request('',{albumId:'book-album'})).json();for(const who of [1,2]){expect((await f.request('',undefined,who)).json().items).toEqual([]);expect((await f.request('/'+book.id,undefined,who)).statusCode).toBe(404);expect((await f.request(`/${book.id}/progress`,{revision:0,partId:'part-1',position:20},who)).statusCode).toBe(404);expect((await f.request(`/${book.id}/delete`,{revision:0},who)).statusCode).toBe(404);}});
 it('requires active authentication, CSRF and exact origin, including after upstream resolution',async()=>{const f=await fixture(base);expect((await f.request('',undefined,0,{cookie:''})).statusCode).toBe(401);expect((await f.request('',{albumId:'book-album'},0,{'x-csrf-token':''})).statusCode).toBe(403);expect((await f.request('',{albumId:'book-album'},0,{origin:'http://foreign.example'})).statusCode).toBe(403);vi.mocked(f.library.audiobookAlbum!).mockImplementation(async()=>{f.auth.revokeSessions('admin','alice');return album;});expect((await f.request('',{albumId:'book-album'})).statusCode).toBe(401);expect(f.auth.db.prepare('SELECT count(*) AS n FROM audiobooks').get()?.n).toBe(0);});
 it('saves intentional rewinds, prevents stale writes, and preserves notes on reset',async()=>{const f=await fixture(base);let book=(await f.request('',{albumId:'book-album'})).json();const update=async(action:string,body:object)=>{const res=await f.request(`/${book.id}/${action}`,{...body,revision:book.revision});expect(res.statusCode).toBe(200);book=res.json().book;};await update('progress',{partId:'part-1',position:88000});await update('bookmark',{partId:'part-1',position:87000,note:'Return here'});await update('chapter',{partId:'part-1',position:100,title:'Chapter one'});await update('progress',{partId:'part-1',position:50});expect(book.position).toBe(50);expect((await f.request(`/${book.id}/progress`,{revision:0,partId:'part-1',position:10})).statusCode).toBe(409);await update('status',{status:'unstarted'});expect(book.position).toBe(0);expect(book.bookmarks).toHaveLength(1);expect(book.chapters).toHaveLength(3);expect(f.auth.db.prepare('SELECT count(*) AS n FROM playback_state').get()?.n).toBe(0);expect(f.auth.db.prepare('SELECT count(*) AS n FROM personal_history').get()?.n).toBe(0);});
 it('rejects invalid IDs, positions, settings and oversized notes',async()=>{const f=await fixture(base);expect((await f.request('',{albumId:'../private'})).statusCode).toBe(400);expect((await f.request('?offset=-1')).statusCode).toBe(400);expect((await f.request('?path=/etc/passwd')).statusCode).toBe(400);const book=(await f.request('',{albumId:'book-album'})).json();for(const [action,body]of [['progress',{partId:'foreign',position:1}],['progress',{partId:'part-1',position:-1}],['progress',{partId:'part-2',position:2000}],['speed',{speed:99}],['bookmark',{partId:'part-1',position:1,note:'x'.repeat(1001)}],['chapter',{partId:'part-1',position:0,title:'Duplicate boundary'}]])expect((await f.request(`/${book.id}/${action}`,{...body as object,revision:0})).statusCode).toBe(400);});
 it('counts storage and rolls back metadata growth at quota',async()=>{const f=await fixture(base);const before=f.auth.storageUsage('alice').user,book=(await f.request('',{albumId:'book-album'})).json();expect(f.auth.storageUsage('alice').user).toBeGreaterThan(before);const used=f.auth.storageUsage('alice').user;const limit=f.auth.resources.personalBytes;f.auth.resources.personalBytes=used;const result=await f.request(`/${book.id}/bookmark`,{revision:0,partId:'part-1',position:20,note:'A growing note'});expect(result.statusCode).toBe(429);expect(f.store.get('alice',book.id).bookmarks).toHaveLength(0);expect(f.auth.storageUsage('alice').user).toBe(used);f.auth.resources.personalBytes=limit;expect((await f.request(`/${book.id}/delete`,{revision:0})).statusCode).toBe(200);expect(f.auth.storageUsage('alice').user).toBe(before);});
});
it('preserves accounts, references, long positions and bookmarks across reopening',async()=>{const dir=await mkdtemp(join(tmpdir(),'freeqify-books-')),path=join(dir,'accounts.sqlite');let auth=new AuthStore(path,readConfig({}).auth);try{auth.db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run('owner','owner','unchanged','listener','active',1);let store=new AudiobookStore(auth),book=store.add('owner',album);book=store.mutate('owner',book.id,'progress',{revision:0,partId:'part-1',position:88000})!;book=store.mutate('owner',book.id,'bookmark',{revision:1,partId:'part-1',position:88000,note:'Long book'})!;auth.close();auth=new AuthStore(path,readConfig({}).auth);store=new AudiobookStore(auth);expect(store.get('owner',book.id)).toMatchObject({position:88000,revision:2,bookmarks:[{note:'Long book'}]});expect(auth.db.prepare('SELECT password_hash FROM users').get()?.password_hash).toBe('unchanged');}finally{auth.close();await rm(dir,{recursive:true});}});
it('appends volumes atomically, rejects stale revisions and preserves part positions when reordering',async()=>{const f=await fixture();let book=(await f.request('',{albumId:'book-album'})).json();vi.mocked(f.library.audiobookAlbum!).mockResolvedValue({album:{...album.album,id:'volume-two'},tracks:[{...album.tracks[1]!,id:'part-3',albumId:'volume-two'}]});const append=await f.request(`/${book.id}/append`,{revision:0,albumId:'volume-two'});expect(append.statusCode).toBe(200);book=append.json().book;expect(book.parts.map((p:{id:string})=>p.id)).toEqual(['part-1','part-2','part-3']);expect(book.duration).toBe(92000);expect((await f.request(`/${book.id}/append`,{revision:0,albumId:'volume-two'})).statusCode).toBe(409);book=(await f.request(`/${book.id}/progress`,{revision:1,partId:'part-3',position:500})).json().book;book=(await f.request(`/${book.id}/move-part`,{revision:2,partId:'part-3',direction:-1})).json().book;expect(book.parts.map((p:{id:string})=>p.id)).toEqual(['part-1','part-3','part-2']);expect(book).toMatchObject({partId:'part-3',position:500});expect(book.chapters.map((c:{partId:string})=>c.partId)).toEqual(['part-1','part-3','part-2']);expect((await f.request(`/${book.id}/progress`,{revision:3,partId:'part-3',position:20,path:'/etc/passwd'})).statusCode).toBe(400);expect((await f.request(`/${book.id}?path=/etc/passwd`)).statusCode).toBe(400);});
it('filters the entire private shelf before pagination',async()=>{const f=await fixture();for(let i=0;i<49;i++)f.store.add('alice',{album:{...album.album,id:`album-${i}`},tracks:album.tracks});const oldest=f.store.list('alice',48).items[0]!;f.store.mutate('alice',oldest.id,'status',{revision:0,status:'finished'});const response=await f.request('?status=finished');expect(response.statusCode,response.body).toBe(200);const finished=response.json();expect(finished.items.map((b:{id:string})=>b.id)).toEqual([oldest.id]);expect(finished.nextOffset).toBeNull();expect((await f.request('?status=unknown')).statusCode).toBe(400);expect((await f.request('?status=finished',undefined,1)).json().items).toEqual([]);});
it('uses only the dedicated source and accepts no client folder or filesystem override',async()=>{
 const f=await fixture();expect((await f.request('/catalog?q=story&offset=48')).statusCode).toBe(200);expect(f.library.audiobookAlbums).toHaveBeenCalledWith(48,48,'story');
 expect((await f.request('/catalog?musicFolderId=1')).statusCode).toBe(400);expect((await f.request('/catalog?path=files/Music')).statusCode).toBe(400);expect((await f.request('?path=files/Music',{albumId:'book-album'})).statusCode).toBe(400);
 expect((await f.request('/catalog',undefined,0,{cookie:''})).statusCode).toBe(401);
 delete f.library.audiobookAlbums;delete f.library.audiobookAlbum;
 expect((await f.request('/catalog')).statusCode).toBe(503);expect((await f.request('',{albumId:'book-album'})).statusCode).toBe(503);
});
it('syncs offline progress and bookmarks atomically without accepting foreign parts or metadata',async()=>{
 const f=await fixture();const book=f.store.add('alice',album),path=`/${book.id}/offline-sync`;
 const payload={revision:0,partId:'part-1',position:350,speed:1.25,status:'listening',bookmarks:[{id:'device-note',partId:'part-2',position:40,note:'Offline note',createdAt:123}]};
 for(const who of [1,2])expect((await f.request(path,payload,who)).statusCode).toBe(404);
 for(const bad of [{...payload,title:'Injected title'},{...payload,bookmarks:[{...payload.bookmarks[0],partId:'foreign'}]},{...payload,bookmarks:[payload.bookmarks[0],payload.bookmarks[0]]},{...payload,bookmarks:[{...payload.bookmarks[0],createdAt:-1}]}])expect((await f.request(path,bad)).statusCode).toBe(400);
 expect((await f.request(path,payload,0,{'x-csrf-token':''})).statusCode).toBe(403);
 const result=await f.request(path,payload);expect(result.statusCode).toBe(200);expect(result.json().book).toMatchObject({title:book.title,position:350,revision:1,bookmarks:payload.bookmarks});
 expect((await f.request(path,{...payload,position:900})).statusCode).toBe(409);expect(f.store.get('alice',book.id).position).toBe(350);
 expect((await f.request(path,{...payload,revision:1,position:10})).statusCode).toBe(200);
});
it('merges detected chapters without duplicating markers or replacing manual notes',async()=>{
 const f=await fixture();let book=f.store.add('alice',album);book=f.store.mutate('alice',book.id,'chapter',{revision:0,partId:'part-1',position:100,title:'My chapter'})!;
 const detection={complete:true,message:'Found embedded chapters.',chapters:[{partId:'part-1',position:0,title:'Opening'},{partId:'part-1',position:100,title:'Source title'},{partId:'part-1',position:200,title:'Next chapter'}]};
 book=f.store.detect('alice',book.id,book.revision,detection);book=f.store.detect('alice',book.id,book.revision,detection);expect(book.chapters).toHaveLength(4);expect(book.chapters.map(c=>c.title)).toEqual(['Opening','My chapter','Next chapter','Second']);expect(()=>f.store.detect('alice',book.id,0,detection)).toThrow('changed');
});
it('lists every source book before opening and joins only the current listener’s saved progress without writes',async()=>{
 const f=await fixture();const second={...album.album,id:'another-book',title:'Another story'};
 vi.mocked(f.library.audiobookAlbums!).mockResolvedValue({items:[album.album,second],nextOffset:null});
 expect((await f.request('/catalog')).json().items.map((b:{book:unknown})=>b.book)).toEqual([null,null]);
 expect(f.auth.db.prepare('SELECT count(*) AS n FROM audiobooks').get()?.n).toBe(0);
 let saved=f.store.add('alice',album);saved=f.store.mutate('alice',saved.id,'progress',{revision:0,partId:'part-1',position:88000})!;
 saved=f.store.mutate('alice',saved.id,'bookmark',{revision:1,partId:'part-1',position:88000,note:'My private note'})!;
 const items=(await f.request('/catalog')).json().items;expect(items).toHaveLength(2);
 expect(items[0].book).toMatchObject({id:saved.id,status:'listening',position:88000,revision:2});expect(items[0].book).not.toHaveProperty('parts');expect(items[0].book).not.toHaveProperty('bookmarks');expect(items[1].book).toBeNull();
 for(const who of [1,2])expect((await f.request('/catalog',undefined,who)).json().items.map((b:{book:unknown})=>b.book)).toEqual([null,null]);
 expect(f.store.get('alice',saved.id)).toEqual(saved);expect(f.auth.db.prepare('SELECT count(*) AS n FROM audiobooks').get()?.n).toBe(1);
});
it('renames section titles atomically while preserving times, identity, progress, notes and rescan corrections',async()=>{
 const f=await fixture();let book=f.store.add('alice',album);
 book=f.store.detect('alice',book.id,book.revision,{complete:true,message:'Found sections.',chapters:[{partId:'part-1',position:0,title:'001'},{partId:'part-1',position:200,title:'002'}]});
 book=f.store.mutate('alice',book.id,'progress',{revision:book.revision,partId:'part-1',position:250})!;
 book=f.store.mutate('alice',book.id,'bookmark',{revision:book.revision,partId:'part-1',position:245,note:'Keep this'})!;
 const before=structuredClone(book),titles=book.chapters.slice(0,2).map((c,i)=>({chapterId:c.id,previousTitle:c.title,title:i===0?'Prologue':'Chapter 1 — The beginning'})),path=`/${book.id}/chapter-titles`;
 for(const who of [1,2])expect((await f.request(path,{revision:book.revision,titles},who)).statusCode).toBe(404);
 expect((await f.request(path,{revision:book.revision,titles},0,{'x-csrf-token':''})).statusCode).toBe(403);
 for(const bad of [[titles[0],{...titles[1],previousTitle:'Changed elsewhere'}],[titles[0],titles[0]],[{...titles[0],title:''}],[{...titles[0],position:123}]]){
  expect([400,409]).toContain((await f.request(path,{revision:book.revision,titles:bad})).statusCode);expect(f.store.get('alice',book.id)).toEqual(before);
 }
 const response=await f.request(path,{revision:book.revision,titles});expect(response.statusCode,response.body).toBe(200);book=response.json().book;
 expect(book.chapters.slice(0,2).map(c=>c.title)).toEqual(['Prologue','Chapter 1 — The beginning']);
 expect(book.chapters.map(c=>[c.id,c.partId,c.position])).toEqual(before.chapters.map(c=>[c.id,c.partId,c.position]));expect(book.bookmarks).toEqual(before.bookmarks);expect(book.position).toBe(before.position);
 book=f.store.detect('alice',book.id,book.revision,{complete:true,message:'Found sections.',chapters:[{partId:'part-1',position:0,title:'001'}]});expect(book.chapters[0]!.title).toBe('Prologue');
 expect((await f.request(path,{revision:before.revision,titles})).statusCode).toBe(409);
});
it('protects spoken previews and accepts only saved book section IDs, with no URLs or local path inputs',async()=>{
 const f=await fixture(),book=f.store.add('alice',album),path=`/${book.id}/spoken-heading`,body={chapterId:book.chapters[0]!.id};
 expect((await f.request(path,body,0,{cookie:''})).statusCode).toBe(401);
 expect((await f.request(path,body,0,{'x-csrf-token':''})).statusCode).toBe(403);
 for(const who of [1,2])expect((await f.request(path,body,who)).statusCode).toBe(404);
 for(const bad of [{chapterId:'missing'},{...body,path:'/etc/passwd'},{...body,url:'http://localhost/'},{...body,position:123}])expect((await f.request(path,bad)).statusCode).toBe(400);
 const response=await f.request(path,body);expect(response.statusCode).toBe(503);expect(response.json().error.code).toBe('BOOK_SPEECH_NOT_CONFIGURED');expect(f.store.get('alice',book.id)).toEqual(book);
});
it.each(['/','/freeqify/'])('bounds speech work, clips at the next section and rechecks sessions at %s',async base=>{
 const f=await fixture(base);f.config.audiobookSpeech={python:'local-python',model:'local-model',ffmpeg:'local-ffmpeg'};
 let book=f.store.add('alice',album);book=f.store.mutate('alice',book.id,'chapter',{revision:0,partId:'part-1',position:10,title:'Next'})!;
 const other=f.store.add('bob',album),path=`/${book.id}/spoken-heading`,body={chapterId:book.chapters[0]!.id};
 let finish!:()=>void,started!:()=>void;const began=new Promise<void>(resolve=>{started=resolve;}),gate=new Promise<void>(resolve=>{finish=resolve;});
 const read=vi.spyOn(speechReader,'readSpokenHeading').mockImplementation(async(_library,_part,chapterId,position)=>{started();await gate;return {chapterId,position,transcript:'Introduction.',suggestedTitle:'Introduction'};});
 const pending=f.request(path,body).then(response=>response);await Promise.race([began,pending.then(response=>{throw new Error(`Unexpected early response ${response.statusCode}: ${response.body}`);})]);
 try{
  expect((await f.request(path,body)).statusCode).toBe(429);
  expect((await f.request(`/${other.id}/spoken-heading`,{chapterId:other.chapters[0]!.id},1)).statusCode).toBe(503);
 }finally{finish();}
 const response=await pending;expect(response.statusCode,response.body).toBe(200);expect(response.json().suggestedTitle).toBe('Introduction');
 expect(read).toHaveBeenCalledWith(f.library,book.parts[0],body.chapterId,0,10,f.config.audiobookSpeech,expect.any(AbortSignal));expect(f.store.get('alice',book.id)).toEqual(book);
 read.mockImplementation(async(_library,_part,chapterId,position)=>{f.auth.revokeSessions('admin','alice');return {chapterId,position,transcript:'Introduction.',suggestedTitle:'Introduction'};});
 expect((await f.request(path,body)).statusCode).toBe(401);
});
