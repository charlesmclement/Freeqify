import {expect,it,vi} from 'vitest';
import {transcriptLines,cachedTranscript,saveTranscript,transcriptKey} from './book-transcript.js';
import * as transcript from './book-transcript.js';
import {AuthStore} from './auth/store.js';
import {readConfig} from './config.js';
import {AudiobookStore} from './audiobook-store.js';
import {registerAudiobookRoutes} from './audiobook-routes.js';
import {registerAuthentication} from './auth/routes.js';
import Fastify from 'fastify';
import type {Account,AlbumDetail} from '@freeqify/shared';
import type {MusicLibrary} from './integrations/navidrome.js';
const segment={start:1,end:3,text:' Spoken words. ',avg_logprob:-.2,no_speech_prob:.1,compression_ratio:1};
const album:AlbumDetail={album:{id:'album',title:'Story',artist:'Author',artistId:null,artworkId:null,trackCount:1,year:null},tracks:[{id:'part',title:'Part',artist:'Author',album:'Story',albumId:'album',artworkId:null,duration:90,trackNumber:1,format:'mp3'}]};
it('accepts bounded timed speech and omits uncertain recognition',()=>{
 expect(transcriptLines([segment],30,30)).toEqual([{time:31,text:'Spoken words.'}]);
 expect(transcriptLines([{...segment,no_speech_prob:.8}],0,30)).toEqual([]);
 expect(transcriptLines([{...segment,end:3.0000000000000004},{...segment,start:3,end:30.9}],0,30)).toEqual([{time:1,text:'Spoken words.'},{time:3,text:'Spoken words.'}]);
 for(const value of [[{...segment,start:-1}],[{...segment,end:80}],[segment,segment],[{...segment,text:4}],Array(101).fill(segment)])expect(()=>transcriptLines(value,0,30)).toThrow();
});
it.each(['/','/freeqify/'])('protects recognition and its private persistent cache at %s',async base=>{
 const config=readConfig({BASE_PATH:base,AUDIOBOOKS_TRANSCRIPTS_ENABLED:'true'});config.audiobookSpeech={python:'local-python',model:'local-model',ffmpeg:'local-ffmpeg'};
 const auth=new AuthStore(':memory:',config.auth),store=new AudiobookStore(auth);
 const users=['alice','bob','admin'].map((id,i)=>{const role=i===2?'admin':'listener';auth.db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,id,'unused',role,'active',0);return {id,username:id,role,status:'active',createdAt:0} as Account;});
 const sessions=users.map(user=>auth.createSession(user)),book=store.add('alice',album);
 const app=Fastify();registerAuthentication(app,base+'api',config,auth);registerAudiobookRoutes(app,base+'api/audiobooks',auth,{} as MusicLibrary,config);
 const read=vi.spyOn(transcript,'transcribeBookPassage').mockResolvedValue([{time:31,text:'Private words'}]);
 const request=(body:unknown,who=0,extra:Record<string,string>={})=>app.inject({method:'POST',url:base+`api/audiobooks/${book.id}/transcript`,payload:body,headers:{cookie:`freeqify_session=${sessions[who]!.token}`,origin:'http://localhost:80','x-csrf-token':sessions[who]!.csrf,...extra}});
 try{
  config.audiobookTranscriptsEnabled=false;expect((await request({partId:'part',position:31})).json().status).toBe('disabled');expect(read).not.toHaveBeenCalled();config.audiobookTranscriptsEnabled=true;
  for(const who of [1,2])expect((await request({partId:'part',position:31},who)).statusCode).toBe(404);
  expect((await request({partId:'part',position:31},0,{'x-csrf-token':''})).statusCode).toBe(403);
  for(const body of [{partId:'foreign',position:0},{partId:'part',position:-1},{partId:'part',position:90},{partId:'part',position:0,url:'http://foreign'},{partId:'part',position:'0'}])expect((await request(body)).statusCode).toBe(400);
  expect(read).not.toHaveBeenCalled();
  const result=await request({partId:'part',position:31});expect(result.statusCode).toBe(200);expect(result.json()).toMatchObject({status:'ready',start:30,end:60,lines:[{time:31,text:'Private words'}]});
  expect(read).toHaveBeenCalledWith(expect.anything(),album.tracks[0],30,30,config.audiobookSpeech,expect.any(AbortSignal));
  expect((await request({partId:'part',position:33})).json()).toEqual(result.json());expect(read).toHaveBeenCalledTimes(1);
  expect(cachedTranscript(auth,'bob',book.id,'part',transcriptKey(album.tracks[0]!,config.audiobookSpeech.model),30)).toBeUndefined();
  expect(auth.storageUsage('alice').user).toBeGreaterThan(0);
  let finish!:(value:{time:number;text:string}[])=>void;read.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const pending=request({partId:'part',position:61});void pending.then(()=>{});await vi.waitFor(()=>expect(read).toHaveBeenCalledTimes(2));auth.db.prepare("UPDATE users SET status='disabled' WHERE id='alice'").run();finish([{time:61,text:'Hidden'}]);expect((await pending).statusCode).toBe(401);
  expect(auth.db.prepare('SELECT count(*) AS n FROM book_transcripts').get()?.n).toBe(1);
  auth.db.prepare("UPDATE users SET status='active' WHERE id='alice'").run();store.mutate('alice',book.id,'delete',{revision:book.revision});expect(auth.db.prepare('SELECT count(*) AS n FROM book_transcripts').get()?.n).toBe(0);
 }finally{read.mockRestore();await app.close();auth.close();}
});
it('retains empty recognized passages without confusing them with cache misses',()=>{
 expect(readConfig({}).audiobookTranscriptsEnabled).toBe(false);expect(()=>readConfig({AUDIOBOOKS_TRANSCRIPTS_ENABLED:'yes'})).toThrow();
 const config=readConfig({}),auth=new AuthStore(':memory:',config.auth);auth.db.prepare("INSERT INTO users VALUES('a','a','unused','listener','active',0)").run();const book=new AudiobookStore(auth).add('a',album);
 try{saveTranscript(auth,'a',book.id,'part','key',0,[]);expect(cachedTranscript(auth,'a',book.id,'part','key',0)).toEqual([]);expect(cachedTranscript(auth,'a',book.id,'part','other',0)).toBeUndefined();}finally{auth.close();}
});
