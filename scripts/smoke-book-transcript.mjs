/** Disposable book, generated speech and optional existing local Whisper. No operator data. */
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createApp} from '../apps/server/dist/app.js';
import {readConfig} from '../apps/server/dist/config.js';
import {openAuthStore} from '../apps/server/dist/auth/store.js';
import {AudiobookStore} from '../apps/server/dist/audiobook-store.js';
const {chromium}=await import(process.env.FREEQIFY_PLAYWRIGHT_MODULE||'playwright-core');
const base=process.env.FREEQIFY_SMOKE_BASE||'/',temp=await mkdtemp(join(tmpdir(),'freeqify-book-transcript-'));
const output=process.env.FREEQIFY_SCREENSHOT_DIR||join(temp,'screenshots');await mkdir(output,{recursive:true});
assert.ok(process.env.FREEQIFY_SPEECH_PYTHON&&process.env.FREEQIFY_SPEECH_MODEL,'Provide an existing local Python and Whisper model for this test.');
execFileSync('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-f','lavfi','-i','flite=text=Chapter one. The little boat crossed the quiet lake. This is a local speech recognition test.:voice=slt','-af','apad','-t','30','-c:a','libmp3lame','-b:a','96k',join(temp,'fixture.mp3')]);
const audio=await readFile(join(temp,'fixture.mp3'));
const config=readConfig({BASE_PATH:base,WEB_DIST_DIR:resolve(process.env.FREEQIFY_SMOKE_WEB||'apps/web/dist'),DATA_DIR:join(temp,'data'),AUTH_SECURE_COOKIES:'false',AUDIOBOOKS_TRANSCRIPTS_ENABLED:'true',AUDIOBOOKS_SPEECH_PYTHON:process.env.FREEQIFY_SPEECH_PYTHON,AUDIOBOOKS_SPEECH_MODEL:process.env.FREEQIFY_SPEECH_MODEL});
const auth=openAuthStore(config),user=await auth.createInitialAdmin('transcript-test','generated-transcript-test-passphrase'),session=auth.createSession(user);
const track={id:'part',title:'Generated spoken passage',artist:'Synthetic voice',album:'Fixture story',duration:30,albumId:'book-album',artworkId:null,format:'mp3',trackNumber:1};
const album={id:'book-album',title:'Fixture story',artist:'Synthetic voice',artistId:null,trackCount:1,artworkId:null,year:null};
const book=new AudiobookStore(auth).add(user.id,{album,tracks:[track]});
const cover=await readFile(resolve(config.webDistDir,'icon-192.png'));
const library={ping:async()=>{},overview:async()=>({artists:0,albums:0,tracks:0,scanning:false}),artists:async()=>[],albums:async()=>({items:[],nextOffset:null}),tracks:async()=>({items:[],nextOffset:null}),track:async id=>id==='part'?track:undefined,artwork:async()=>({contentType:'image/png',bytes:cover}),audiobookAlbums:async()=>({items:[album],nextOffset:null}),audiobookAlbum:async()=>({album,tracks:[track]}),stream:async(_id,_format,range)=>{
 const match=/^bytes=(\d+)-(\d*)$/.exec(range??''),start=match?Number(match[1]):0,end=match?.[2]?Math.min(Number(match[2]),audio.length-1):audio.length-1;
 return new Response(audio.subarray(start,end+1),{status:match?206:200,headers:{'content-type':'audio/mpeg','content-length':String(end-start+1),'accept-ranges':'bytes',...(match?{'content-range':`bytes ${start}-${end}/${audio.length}`}:{})}});
}};
const app=await createApp(config,{authStore:auth,library});let browser;
try{
 await app.listen({host:'127.0.0.1',port:0});const origin=`http://127.0.0.1:${app.server.address().port}`;
 browser=await chromium.launch({executablePath:process.env.FREEQIFY_CHROME||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--mute-audio']});
 const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});await context.addCookies([{name:'freeqify_session',value:session.token,domain:'127.0.0.1',path:base,httpOnly:true,sameSite:'Lax'}]);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+base+'#/'+new URLSearchParams({view:JSON.stringify('Audiobooks'),book:JSON.stringify(book.id)}));
 await page.getByRole('button',{name:'Start listening',exact:true}).click();await page.waitForFunction(()=>document.querySelector('audio')?.currentTime>0);
 await page.getByRole('button',{name:'Open Now Playing',exact:true}).click();await page.getByRole('dialog',{name:'Now Playing'}).waitFor();
 await page.evaluate(()=>{window.originalAudio=document.querySelector('audio');window.originalSource=window.originalAudio.src;});
 assert.equal(Number(auth.db.prepare('SELECT count(*) AS n FROM book_transcripts').get().n),0);
 await page.getByLabel('Visualizer mode').selectOption('lyrics');
 await page.getByRole('region',{name:'Audiobook player',exact:true}).getByRole('button',{name:'Pause book',exact:true}).click();
 const line=page.getByRole('region',{name:'Audiobook transcript',exact:true}).getByRole('button',{name:/little boat/i});await line.waitFor({timeout:100000});
 assert.equal(Number(auth.db.prepare('SELECT count(*) AS n FROM book_transcripts').get().n),1);
 await line.click();assert.ok(await page.locator('audio').evaluate(a=>a.currentTime)<2);assert.equal(await page.evaluate(()=>window.originalAudio===document.querySelector('audio')&&window.originalSource===document.querySelector('audio').src),true);
 for(const width of [1280,740,390,320]){
  await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.getByRole('button',{name:/^Immersive view/}).click();assert.equal(await page.getByRole('checkbox',{name:'Keep screen awake',exact:true}).isVisible(),true);
  assert.ok((await page.locator('.lyrics-scroll').boundingBox()).height>40);assert.equal(await page.locator('audio').count(),1);
  await page.screenshot({path:join(output,`book-transcript-immersive-${width}.png`)});await page.getByRole('button',{name:/^Exit immersive view/}).click();
 }
 await page.getByLabel('Visualizer mode').selectOption('spectrum2d');assert.equal(await page.getByRole('region',{name:'Audiobook transcript',exact:true}).count(),0);
 await page.getByLabel('Visualizer mode').selectOption('lyrics');await line.waitFor();assert.equal(Number(auth.db.prepare('SELECT count(*) AS n FROM book_transcripts').get().n),1);
 assert.deepEqual(errors,[]);console.log(`PASS ${base}: real local Whisper, private persistent text cache, opt-in generation, book line seek, one audio owner, mode switching and immersive 320/390/740/1280 layouts.`);
}finally{await browser?.close();await app.close();await rm(temp,{recursive:true,force:true});}
