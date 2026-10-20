import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {afterEach,describe,expect,it,vi} from 'vitest';
import Fastify from 'fastify';
import { AuthStore } from './auth/store.js';
import { registerAuthentication } from './auth/routes.js';
import { registerArtworkRoutes,presetCovers } from './artwork-routes.js';
import { readConfig } from './config.js';
import { LibraryError,type MusicLibrary } from './integrations/navidrome.js';
import type {Account,AlbumDetail} from '@freeqify/shared';
import type {CoverSearchProvider} from './shared-artwork.js';
import type {Outcome} from './online-artwork.js';
const close:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const dispose of close.splice(0))await dispose();});
const sample:AlbumDetail={album:{id:'al-1',title:'A',artist:'B',artistId:null,artworkId:null,trackCount:1,year:null},tracks:[{id:'song-1',title:'T',artist:'B',album:'A',albumId:'al-1',artworkId:null,trackNumber:1,duration:30,format:'mp3'}]};
async function fixture(base='/', online?: {lookup:(artist:string,album:string)=>Promise<Outcome>} & Partial<CoverSearchProvider>, options: {database?:string;reviewDir?:string}={}) {
 const config=readConfig({BASE_PATH:base,...(options.reviewDir?{ARTWORK_REVIEW_DIR:options.reviewDir}:{})});const auth=new AuthStore(options.database??':memory:',config.auth);
 const accounts=['alice','bob'].map(id=>{auth.db.prepare('INSERT OR IGNORE INTO users VALUES (?,?,?,?,?,?)').run(id,id,'test-hash','listener','active',1);return {id,username:id,role:'listener',status:'active',createdAt:1} as Account;});
 const sessions=accounts.map(account=>auth.createSession(account));
 const library={album:vi.fn().mockResolvedValue(sample),artwork:vi.fn().mockRejectedValue(new LibraryError('NOT_FOUND'))} as unknown as MusicLibrary;
 const app=Fastify();registerAuthentication(app,`${base}api`,config,auth);registerArtworkRoutes(app,`${base}api/library`,library,auth,config,online);
 let closed=false;const stop=async()=>{if(!closed){closed=true;await app.close();auth.close();}};close.push(stop);
 const send=(suffix:string,payload?:unknown,who=0,overrides:Record<string,string>={})=>app.inject({url:`${base}api/library/artwork/album/al-1${suffix}`,method:payload===undefined?'GET':'POST',...(payload===undefined?{}:{payload}),headers:{cookie:`freeqify_session=${sessions[who]!.token}`,origin:'http://localhost:80','x-csrf-token':sessions[who]!.csrf,...overrides}});
 const record=(user='alice')=>auth.db.prepare('SELECT mode,cover_key FROM album_artwork_choices WHERE user_id=? AND album_id=?').get(user,'al-1');
 return {library,auth,send,record,stop,app,sessions};
}
describe.each(['/','/music/'])('artwork isolation at %s',base=>{
 it('randomly chooses a real preset once and retains its assignment',async()=>{
  const f=await fixture(base);const first=await f.send('');expect(first.statusCode).toBe(200);expect(first.headers['content-type']).toContain('image/jpeg');
  const before=f.record() as {mode:string;cover_key:string};expect(before.mode).toBe('fallback');expect(presetCovers).toContain(before.cover_key);
  expect((await f.send('')).body).toBe(first.body);expect(f.record()).toEqual(before);
  expect((await f.send('',undefined,1)).statusCode).toBe(200);expect(f.record('bob')).toBeTruthy();
 });
 it('never substitutes a preset for real artwork',async()=>{
  const f=await fixture(base);vi.mocked(f.library.album).mockResolvedValue({...sample,album:{...sample.album,artworkId:'orig'}});
  vi.mocked(f.library.artwork).mockResolvedValue({contentType:'image/png',bytes:Buffer.from([137,80,78,71])});
  const response=await f.send('');expect(response.statusCode).toBe(200);expect(response.headers['content-type']).toBe('image/png');expect(f.record()).toBeUndefined();
 });
 it('does not assign during outages or ambiguous failures',async()=>{
  const f=await fixture(base);vi.mocked(f.library.album).mockRejectedValue(new LibraryError('UNAVAILABLE'));
  expect((await f.send('')).statusCode).toBe(502);expect(f.record()).toBeUndefined();
 });
 it('preserves a saved fallback even if original artwork appears later, but displays the original',async()=>{
  const f=await fixture(base);await f.send('');const assigned=f.record();
  vi.mocked(f.library.album).mockResolvedValue({...sample,album:{...sample.album,artworkId:'orig'}});
  vi.mocked(f.library.artwork).mockResolvedValue({contentType:'image/jpeg',bytes:Buffer.from([255,216,255,0])});
  expect((await f.send('')).body).toBe(Buffer.from([255,216,255,0]).toString());expect(f.record()).toEqual(assigned);
 });
 it('allows account-scoped selection, blank, and restoration only with CSRF',async()=>{
  const f=await fixture(base);expect((await f.send('/choice',{mode:'none'},0,{'x-csrf-token':''})).statusCode).toBe(403);
  expect((await f.send('/choice',{mode:'none'})).statusCode).toBe(200);expect((await f.send('')).statusCode).toBe(204);
  expect((await f.send('',undefined,1)).statusCode).toBe(200);
  expect((await f.send('/choice',{mode:'selected',coverKey:presetCovers[2]})).statusCode).toBe(200);
  expect((await f.send('')).statusCode).toBe(200);expect((f.record() as {mode:string}).mode).toBe('selected');
  expect((await f.send('/choice',{mode:'auto'})).statusCode).toBe(200);expect(f.record()).toBeUndefined();
 });
 it('validates uploads rather than trusting mime strings',async()=>{
  const f=await fixture(base);const body={contentType:'image/png',base64:Buffer.from('not an image').toString('base64')};
  expect((await f.send('/upload',body)).statusCode).toBe(400);expect(f.record()).toBeUndefined();
 });

  it('online priority: original artwork wins',async()=>{
    const online={lookup:vi.fn(async():Promise<Outcome>=>({kind:'missing'}))};
    const f=await fixture(base,online);
    vi.mocked(f.library.album).mockResolvedValue({
      ...sample,album:{...sample.album,artworkId:'orig'}
    });
    vi.mocked(f.library.artwork).mockResolvedValue({
      contentType:'image/png',bytes:Buffer.from([137,80,78,71])
    });
    expect((await f.send('')).statusCode).toBe(200);
    expect(online.lookup).not.toHaveBeenCalled();
  });

  it('online priority: genuine online artwork wins over fallback',async()=>{
    const online={lookup:vi.fn(async():Promise<Outcome>=>({
      kind:'found',artwork:{
        contentType:'image/png',
        bytes:Buffer.from([137,80,78,71,13,10,26,10])
      }
    }))};
    const f=await fixture(base,online);
    const response=await f.send('');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('image/png');
    expect(online.lookup).toHaveBeenCalledWith('B','A');
    expect(f.record()).toBeUndefined();
  });

  it('online priority: missing art gets a stable fallback',async()=>{
    const online={lookup:vi.fn(async():Promise<Outcome>=>({kind:'missing'}))};
    const f=await fixture(base,online);
    expect((await f.send('')).statusCode).toBe(200);
    const saved=f.record();
    expect(saved).toBeTruthy();
    expect((await f.send('')).statusCode).toBe(200);
    expect(f.record()).toEqual(saved);
  });

  it('online priority: outage displays a retryable neutral fallback',async()=>{
    const online={lookup:vi.fn(async():Promise<Outcome>=>({kind:'unavailable'}))};
    const f=await fixture(base,online);
    expect((await f.send('')).statusCode).toBe(200);
    expect((f.record() as {cover_key:string}).cover_key).toMatch(/^generic_/);
  });

  it('replaces a saved fallback with online art and persists through refresh and restart',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'freeqify-art-test-'));
    close.push(()=>rm(dir,{recursive:true,force:true}));
    const online={lookup:vi.fn(async():Promise<Outcome>=>({kind:'unavailable'}))};
    const options={database:join(dir,'accounts.sqlite'),reviewDir:dir};
    const f=await fixture(base,online,options);
    expect((await f.send('')).statusCode).toBe(200);
    expect((f.record() as {cover_key:string}).cover_key).toMatch(/^generic_/);
    const bytes=Buffer.from([255,216,255,12,13,14]);
    online.lookup.mockResolvedValue({kind:'found',artwork:{contentType:'image/jpeg',bytes}});
    expect((await f.send('')).rawPayload).toEqual(bytes);
    expect((await f.send('')).rawPayload).toEqual(bytes);
    expect(online.lookup).toHaveBeenCalledTimes(2);
    await f.stop();
    const restarted=await fixture(base,online,options);
    expect((await restarted.send('')).rawPayload).toEqual(bytes);
    expect(online.lookup).toHaveBeenCalledTimes(2);
    vi.mocked(restarted.library.album).mockResolvedValue({...sample,album:{...sample.album,artworkId:'local'}});
    vi.mocked(restarted.library.artwork).mockResolvedValue({contentType:'image/png',bytes:Buffer.from('local')});
    expect((await restarted.send('')).body).toBe('local');
  });

  it('downloads once and serves the stored image after restart with online lookup disabled',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'freeqify-stored-cover-'));
    close.push(()=>rm(dir,{recursive:true,force:true}));
    const bytes=Buffer.from([255,216,255,12,13,14]);
    const online={lookup:vi.fn(async():Promise<Outcome>=>({kind:'found',artwork:{contentType:'image/jpeg',bytes}}))};
    const options={database:join(dir,'accounts.sqlite'),reviewDir:dir};
    const first=await fixture(base,online,options);
    expect((await first.send('')).rawPayload).toEqual(bytes);
    expect((await first.send('')).rawPayload).toEqual(bytes);
    expect(online.lookup).toHaveBeenCalledTimes(1);
    await first.stop();
    const restarted=await fixture(base,undefined,options);
    expect((await restarted.send('')).rawPayload).toEqual(bytes);
    expect((await restarted.send('')).rawPayload).toEqual(bytes);
    expect((await restarted.send('')).headers['cache-control']).toBe('no-store');
    expect(online.lookup).toHaveBeenCalledTimes(1);
    expect((await restarted.send('',undefined,1)).rawPayload).not.toEqual(bytes);
  });

  it('integrates previously downloaded covers using metadata and the live album ID',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'freeqify-review-test-'));
    close.push(()=>rm(dir,{recursive:true,force:true}));
    await mkdir(join(dir,'downloaded'));
    const name=createHash('sha256').update('B\0A').digest('hex').slice(0,24)+'.jpg';
    const bytes=Buffer.from([255,216,255,12,13,14]);
    await writeFile(join(dir,'downloaded',name),bytes);
    await writeFile(join(dir,'report.json'),JSON.stringify({results:[{artist:'B',album:'A',status:'previously-downloaded',file:'/old/location/'+name}]}));
    const online={lookup:vi.fn(async():Promise<Outcome>=>({kind:'missing'}))};
    const f=await fixture(base,online,{reviewDir:dir});
    expect((await f.send('')).rawPayload).toEqual(bytes);
    expect((await f.send('')).headers['cache-control']).toBe('no-store');
    expect(online.lookup).not.toHaveBeenCalled();
    expect(f.auth.db.prepare('SELECT album_id FROM album_online_artwork').get()?.album_id).toBe('al-1');
    await rm(join(dir,'downloaded',name));
    expect((await f.send('')).rawPayload).toEqual(bytes);
    await f.send('/choice',{mode:'none'});
    expect((await f.send('')).statusCode).toBe(204);
    await f.send('/choice',{mode:'selected',coverKey:presetCovers[0]});
    expect((await f.send('')).rawPayload).not.toEqual(bytes);
  });

  it('does not reuse a persisted online image if catalog metadata changes',async()=>{
    const online={lookup:vi.fn(async():Promise<Outcome>=>({kind:'found',artwork:{contentType:'image/jpeg',bytes:Buffer.from('old cover')}}))};
    const f=await fixture(base,online);
    await f.send('');
    vi.mocked(f.library.album).mockResolvedValue({...sample,album:{...sample.album,title:'Different album'}});
    online.lookup.mockResolvedValue({kind:'missing'});
    const result=await f.send('');
    expect(result.statusCode).toBe(200);
    expect(result.body).not.toBe('old cover');
    expect(online.lookup).toHaveBeenLastCalledWith('B','Different album');
  });

  it('skips Navidrome disc placeholders and uses verified online artwork',async()=>{
    const bytes=Buffer.from('verified cover');
    const online={lookup:vi.fn(async():Promise<Outcome>=>({kind:'found',artwork:{contentType:'image/jpeg',bytes}}))};
    const f=await fixture(base,online);
    vi.mocked(f.library.album).mockResolvedValue({...sample,album:{...sample.album,artworkId:'dc-album:1'},tracks:sample.tracks.map(track=>({...track,artworkId:'dc-album:2'}))});
    expect((await f.send('')).rawPayload).toEqual(bytes);
    expect(f.library.artwork).not.toHaveBeenCalled();
    expect(online.lookup).toHaveBeenCalledWith('B','A');
  });
  it('uses a stable neutral fallback instead of a Navidrome disc placeholder',async()=>{
    const f=await fixture(base);
    vi.mocked(f.library.album).mockResolvedValue({...sample,album:{...sample.album,artworkId:'dc-album:1'}});
    expect((await f.send('')).statusCode).toBe(200);
    expect((f.record() as {cover_key:string}).cover_key).toMatch(/^generic_/);
    const saved=f.record();await f.send('');expect(f.record()).toEqual(saved);
    expect(f.library.artwork).not.toHaveBeenCalled();
  });

  it('online priority: manual selection bypasses online lookup',async()=>{
    const online={lookup:vi.fn(async():Promise<Outcome>=>({kind:'missing'}))};
    const f=await fixture(base,online);
    expect((await f.send('/choice',{
      mode:'selected',coverKey:presetCovers[0]
    })).statusCode).toBe(200);
    expect((await f.send('')).statusCode).toBe(200);
    expect(online.lookup).not.toHaveBeenCalled();
  });

});

const coverId='48140466-cff6-3222-bd55-63c27e43190d';
const searchImage=Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(40,7)]);
function interactiveProvider(){return {
 lookup:vi.fn(async():Promise<Outcome>=>({kind:'missing'})),
 search:vi.fn(async()=>({kind:'results' as const,items:[{id:coverId,title:'Found album',artist:'Found artist',year:'2001'}]})),
 candidateCover:vi.fn(async():Promise<Outcome>=>({kind:'found',artwork:{contentType:'image/jpeg',bytes:searchImage}})),
};}
async function interactiveFixture(base='/',database?:string){
 const online=interactiveProvider();const f=await fixture(base,online,database?{database}:{});
 f.auth.db.prepare("UPDATE users SET role='admin' WHERE id='alice'").run();
 return {...f,online};
}
describe.each(['/','/music/'])('shared cover search at %s',base=>{
 it('requires active administrators and CSRF, with no upstream calls on rejection',async()=>{
  const f=await interactiveFixture(base);
  for(const suffix of ['/cover-search','/shared']){
   expect((await f.send(suffix,{artist:'A',album:'B'},1)).statusCode).toBe(403);
   expect((await f.send(suffix,{artist:'A',album:'B'},0,{'x-csrf-token':''})).statusCode).toBe(403);
   expect((await f.send(suffix,{artist:'A',album:'B'},0,{origin:'https://evil.invalid'})).statusCode).toBe(403);
  }
  expect((await f.send('/shared',undefined,1)).statusCode).toBe(403);
  expect((await f.send('/cover-search',{artist:'A',album:'B'},0,{cookie:''})).statusCode).toBe(401);
  expect(f.online.search).not.toHaveBeenCalled();
 });
 it('previews same-origin results without changing artwork; selection overrides everyone and removal restores private choices',async()=>{
  const f=await interactiveFixture(base);
  await f.send('/choice',{mode:'none'},1);
  const response=await f.send('/cover-search',{artist:'B',album:'A'});expect(response.statusCode).toBe(200);
  const item=response.json().items[0];expect(item.title).toBe('Found album');expect(JSON.stringify(item)).not.toContain('https:');
  expect(f.auth.db.prepare('SELECT * FROM shared_album_artwork').get()).toBeUndefined();
  const preview=await f.send(`/cover-preview/${item.token}`);expect(preview.statusCode).toBe(200);expect(preview.rawPayload).toEqual(searchImage);expect(preview.headers['cache-control']).toBe('no-store');
  expect((await f.send(`/cover-preview/${item.token}`,undefined,1)).statusCode).toBe(403);
  expect((await f.send('/shared',{mode:'select',token:item.token})).statusCode).toBe(200);
  for(const who of [0,1]){
   const image=await f.send('',undefined,who);expect(image.rawPayload).toEqual(searchImage);
   expect((await f.send('/choice',undefined,who)).json()).toMatchObject({shared:true,mode:'custom'});
  }
  expect(f.online.candidateCover).toHaveBeenCalledTimes(1);
  expect(f.record('bob')).toMatchObject({mode:'none'});
  expect((await f.send('/shared',{mode:'remove'})).statusCode).toBe(200);
  expect((await f.send('',undefined,1)).statusCode).toBe(204);
 });
 it('rejects URLs, arbitrary IDs, expired tokens and tokens for another album',async()=>{
  const f=await interactiveFixture(base);
  expect((await f.send('/cover-search',{artist:'A',album:'B',url:'http://localhost/private'})).statusCode).toBe(400);
  expect((await f.send('/cover-search',{artist:'A',album:''})).statusCode).toBe(400);
  expect((await f.send('/shared',{mode:'select',token:coverId})).statusCode).toBe(404);
  const token=(await f.send('/cover-search',{artist:'B',album:'A'})).json().items[0].token;
  const other=await f.app.inject({method:'POST',url:`${base}api/library/artwork/album/other/shared`,headers:{cookie:`freeqify_session=${f.sessions[0]!.token}`,origin:'http://localhost:80','x-csrf-token':f.sessions[0]!.csrf},payload:{mode:'select',token}});
  expect(other.statusCode).toBe(404);
  f.auth.db.prepare("UPDATE users SET role='admin' WHERE id='bob'").run();
  expect((await f.send(`/cover-preview/${token}`,undefined,1)).statusCode).toBe(404);
  const time=vi.spyOn(Date,'now').mockReturnValue(Date.now()+6*60*1000);
  try{expect((await f.send('/shared',{mode:'select',token})).statusCode).toBe(404);}finally{time.mockRestore();}
  expect(f.online.candidateCover).not.toHaveBeenCalled();
 });
 it('does not save after an administrator is disabled during a remote preview',async()=>{
  const f=await interactiveFixture(base);const token=(await f.send('/cover-search',{artist:'B',album:'A'})).json().items[0].token;
  f.online.candidateCover.mockImplementation(async()=>{
   f.auth.db.prepare("UPDATE users SET status='disabled' WHERE id='alice'").run();
   return {kind:'found',artwork:{contentType:'image/jpeg',bytes:searchImage}};
  });
  expect((await f.send('/shared',{mode:'select',token})).statusCode).toBe(401);
  expect(f.auth.db.prepare('SELECT * FROM shared_album_artwork').get()).toBeUndefined();
 });
 it('reports missing artwork, outages, unconfigured search and rate limits honestly',async()=>{
  const disabled=await fixture(base);disabled.auth.db.prepare("UPDATE users SET role='admin' WHERE id='alice'").run();
  expect((await disabled.send('/shared')).json()).toMatchObject({enabled:false,selected:false});
  expect((await disabled.send('/cover-search',{artist:'B',album:'A'})).statusCode).toBe(503);
  const f=await interactiveFixture(base);const token=(await f.send('/cover-search',{artist:'B',album:'A'})).json().items[0].token;
  expect((await f.send('/cover-search',{artist:'B',album:'A'})).statusCode).toBe(429);
  f.online.candidateCover.mockResolvedValue({kind:'missing'});
  expect((await f.send(`/cover-preview/${token}`)).statusCode).toBe(404);
  f.online.candidateCover.mockResolvedValue({kind:'unavailable'});
  expect((await f.send('/shared',{mode:'select',token})).statusCode).toBe(503);
  expect(f.auth.db.prepare('SELECT * FROM shared_album_artwork').get()).toBeUndefined();
 });
});
it('keeps shared covers after restart without deleting personal preferences',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'freeqify-shared-art-'));close.push(()=>rm(dir,{recursive:true,force:true}));
 const database=join(dir,'accounts.sqlite');const first=await interactiveFixture('/',database);
 await first.send('/choice',{mode:'none'},1);
 const token=(await first.send('/cover-search',{artist:'B',album:'A'})).json().items[0].token;
 expect((await first.send('/shared',{mode:'select',token})).statusCode).toBe(200);await first.stop();
 const second=await interactiveFixture('/',database);expect((await second.send('',undefined,1)).rawPayload).toEqual(searchImage);
 expect(second.record('bob')).toMatchObject({mode:'none'});
 expect(second.auth.db.prepare('PRAGMA user_version').get()?.user_version).toBe(12);
});
it('rolls back a shared cover when the global collection limit is reached',async()=>{
 const f=await interactiveFixture();
 const insert=f.auth.db.prepare("INSERT INTO shared_album_artwork VALUES(?,'image/jpeg',?,'Artist','Album')");
 f.auth.db.exec('BEGIN');for(let n=0;n<5000;n++)insert.run(`full-${n}`,searchImage);f.auth.db.exec('COMMIT');
 const token=(await f.send('/cover-search',{artist:'B',album:'A'})).json().items[0].token;
 expect((await f.send('/shared',{mode:'select',token})).statusCode).toBe(409);
 expect(f.auth.db.prepare("SELECT * FROM shared_album_artwork WHERE album_id='al-1'").get()).toBeUndefined();
 expect(f.auth.db.prepare('SELECT count(*) AS n FROM shared_album_artwork').get()?.n).toBe(5000);
});
