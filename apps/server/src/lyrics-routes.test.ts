import {expect,it,vi} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createApp} from './app.js';
import {readConfig} from './config.js';
import {AuthStore} from './auth/store.js';
import type {MusicLibrary} from './integrations/navidrome.js';
import type {LyricsResult} from '@freeqify/shared';
const song={id:'song',title:'Test song',artist:'Test artist',album:'Album',duration:120,albumId:null,artworkId:null,trackNumber:1,format:'mp3'};
it.each(['/','/freeqify/'])('protects lyrics and keeps metadata server-derived at %s',async base=>{
 const dir=await mkdtemp('/tmp/freeqify-lyrics-');await writeFile(join(dir,'index.html'),`<meta content="${base}">`);const config=readConfig({BASE_PATH:base,WEB_DIST_DIR:dir,LYRICS_ENABLED:'true'}),auth=new AuthStore(':memory:',config.auth);const user={id:'listener',username:'listener',role:'listener' as const,status:'active' as const,createdAt:0};auth.db.prepare("INSERT INTO users VALUES('listener','listener','unused','listener','active',0)").run();const session=auth.createSession(user),lookup=vi.fn().mockResolvedValue({status:'instrumental'}),track=vi.fn().mockResolvedValue(song);const app=await createApp(config,{authStore:auth,library:{track} as unknown as MusicLibrary,lyrics:{lookup}});const url=base+'api/library/tracks/song/lyrics',headers={host:'localhost',cookie:`freeqify_session=${session.token}`};
 try{
  expect((await app.inject({url,headers:{host:'localhost'}})).statusCode).toBe(401);expect(lookup).not.toHaveBeenCalled();
  expect((await app.inject({url:url+'?url=http://127.0.0.1/',headers})).statusCode).toBe(400);expect(track).not.toHaveBeenCalled();
  const response=await app.inject({url,headers});expect(response.json()).toEqual({status:'instrumental'});expect(response.headers['cache-control']).toBe('no-store');expect(lookup).toHaveBeenCalledWith(song,expect.any(AbortSignal));
  expect((await app.inject({url,headers:{...headers,origin:'https://foreign.test'}})).statusCode).toBe(403);
  let finish!:(v:LyricsResult)=>void;lookup.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const pending=app.inject({url,headers});void pending.then(()=>{});await vi.waitFor(()=>expect(lookup).toHaveBeenCalledTimes(2));auth.db.prepare("UPDATE users SET status='disabled' WHERE id='listener'").run();finish({status:'missing'});expect((await pending).statusCode).toBe(401);
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
it('defaults to disabled and validates explicit optional configuration',async()=>{
 expect(readConfig({}).lyricsEnabled).toBe(false);expect(()=>readConfig({LYRICS_ENABLED:'yes'})).toThrow('LYRICS_ENABLED');
 const dir=await mkdtemp('/tmp/freeqify-lyrics-off-');await writeFile(join(dir,'index.html'),'<meta content="/">');const config=readConfig({WEB_DIST_DIR:dir}),auth=new AuthStore(':memory:',config.auth);auth.db.prepare("INSERT INTO users VALUES('a','a','unused','listener','active',0)").run();const session=auth.createSession({id:'a',username:'a',role:'listener',status:'active',createdAt:0}),lookup=vi.fn();const app=await createApp(config,{authStore:auth,lyrics:{lookup}});
 try{expect((await app.inject({url:'/api/library/tracks/song/lyrics',headers:{host:'localhost',cookie:`freeqify_session=${session.token}`}})).json()).toEqual({status:'disabled'});expect(lookup).not.toHaveBeenCalled();}finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
