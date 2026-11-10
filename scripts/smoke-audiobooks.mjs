/** Disposable authenticated app and generated virtual audio; no operator config or music. */
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createApp} from '../apps/server/dist/app.js';
import {readConfig} from '../apps/server/dist/config.js';
import {openAuthStore} from '../apps/server/dist/auth/store.js';
import {emptyPlayback} from '../packages/shared/dist/index.js';
const {chromium}=await import(process.env.FREEQIFY_PLAYWRIGHT_MODULE||'playwright-core');
const base=process.env.FREEQIFY_SMOKE_BASE||'/',temp=await mkdtemp(join(tmpdir(),'freeqify-book-browser-'));
const output=process.env.FREEQIFY_SCREENSHOT_DIR||join(temp,'screenshots');await mkdir(output,{recursive:true});
const config=readConfig({BASE_PATH:base,WEB_DIST_DIR:resolve(process.env.FREEQIFY_SMOKE_WEB||'apps/web/dist'),DATA_DIR:join(temp,'data'),AUTH_SECURE_COOKIES:'false'});
const auth=openAuthStore(config),owner=await auth.createInitialAdmin('book-test','generated-book-test-passphrase'),session=auth.createSession(owner);
const tracks=[{id:'music',title:'Music queue preserved',duration:4,albumId:'music-album',album:'Music'},{id:'long-book',title:'Part one: a long journey',duration:90000,albumId:'book-album',album:'A Long Journey'},{id:'last-part',title:'Part two: home',duration:4,albumId:'book-album',album:'A Long Journey'}].map((p,i)=>({...p,artist:'Fixture Author',artworkId:'cover',format:'wav',trackNumber:i}));
const albums=[{id:'music-album',title:'Music',trackCount:1},{id:'book-album',title:'A Long Journey',trackCount:2}].map(a=>({...a,artist:'Fixture Author',artistId:'author',artworkId:'cover',year:2026}));
const cover=await readFile(resolve(config.webDistDir,'icon-192.png'));const ranges=[];let bytesServed=0;
function stream(id,range){
 const track=tracks.find(t=>t.id===id),size=44+track.duration*16000,header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(size-8,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(8000,24);header.writeUInt32LE(16000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(size-44,40);
 let start=0,end=size-1;const match=range?.match(/^bytes=(\d+)-(\d*)$/);if(match){start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]));}ranges.push({id,start});let position=start;
 const body=new ReadableStream({pull(controller){if(position>end){controller.close();return;}const count=Math.min(65536,end-position+1),chunk=Buffer.alloc(count);if(position<44)header.copy(chunk,0,position,Math.min(44,position+count));position+=count;bytesServed+=count;controller.enqueue(chunk);}});
 return new Response(body,{status:match?206:200,headers:{'content-type':'audio/wav','content-length':String(end-start+1),'accept-ranges':'bytes',...(match?{'content-range':`bytes ${start}-${end}/${size}`}:{})}});
}
const library={ping:async()=>{},overview:async()=>({artists:1,albums:2,tracks:3,scanning:false}),artists:async()=>[],artist:async()=>({artist:{id:'author',name:'Fixture Author',albumCount:2,artworkId:null},albums}),albums:async()=>({items:albums,nextOffset:null}),album:async id=>({album:albums.find(a=>a.id===id),tracks:tracks.filter(t=>t.albumId===id)}),tracks:async()=>({items:tracks,nextOffset:null}),track:async id=>tracks.find(t=>t.id===id),search:async()=>({artists:[],albums,tracks}),artwork:async()=>({contentType:'image/png',bytes:cover}),stream:async(id,_format,range)=>stream(id,range)};
library.audiobookAlbums=async()=>({items:albums.filter(a=>a.id==='book-album'),nextOffset:null});
library.audiobookAlbum=async id=>{assert.equal(id,'book-album');return library.album(id);};
const music={...emptyPlayback(),queue:[{key:'music-key',source:'local',trackId:'music'}],order:['music-key'],current:'music-key',position:2};auth.savePlayback(owner.id,JSON.stringify(music));
const app=await createApp(config,{authStore:auth,library});let browser;
try{
 await app.listen({host:'127.0.0.1',port:0});const origin=`http://127.0.0.1:${app.server.address().port}`;
 browser=await chromium.launch({executablePath:process.env.FREEQIFY_CHROME||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});await context.addCookies([{name:'freeqify_session',value:session.token,domain:'127.0.0.1',path:base,httpOnly:true,sameSite:'Lax'}]);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+base);
 await page.waitForFunction(()=>document.querySelector('audio')?.src.startsWith('blob:'));await page.evaluate(()=>{window.originalAudio=document.querySelector('audio');});
 await page.getByRole('navigation',{name:'Your space'}).getByRole('button',{name:'Audiobooks',exact:true}).click();
 await page.getByRole('button',{name:/A Long Journey.*Fixture Author/}).waitFor();assert.equal(await page.locator('.album-list .album-card').count(),1,'book picker must exclude the music album');await page.getByRole('button',{name:/A Long Journey.*Fixture Author/}).click();
 await page.getByRole('button',{name:'Start listening'}).click();await page.waitForFunction(()=>document.querySelector('audio')?.src.includes('/stream/long-book'));
 await page.waitForFunction(()=>document.querySelector('audio')?.duration===90000&&!document.querySelector('audio').paused);
 await page.waitForFunction(()=>{const image=document.querySelector('.book-dock-cover img');return image?.complete&&image.naturalWidth>0;});assert.equal(await page.locator('.music-player').isVisible(),false);assert.ok((await page.locator('.book-dock-cover img').getAttribute('src')).includes('/artwork/book/'));
 assert.equal(await page.locator('audio').count(),1);assert.equal(await page.evaluate(()=>window.originalAudio===document.querySelector('audio')),true);
 const persisted=JSON.parse(String(auth.db.prepare('SELECT state FROM playback_state WHERE user_id=?').get(owner.id).state));assert.deepEqual(persisted.queue,music.queue);assert.equal(persisted.position,2);
 await page.getByRole('slider',{name:'Seek audiobook part'}).evaluate(el=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'88000');el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});await page.waitForFunction(()=>document.querySelector('audio').currentTime>=88000);
 await page.getByRole('button',{name:'Pause book',exact:true}).click();await page.waitForFunction(()=>document.querySelector('audio').paused);
 await page.getByRole('combobox',{name:'Audiobook speed'}).selectOption('1.5');await page.waitForFunction(()=>document.querySelector('audio').playbackRate===1.5);
 await page.getByRole('button',{name:'Bookmarks (0)',exact:true}).click();await page.getByLabel(/Bookmark at/).fill('The passage to remember');await page.getByRole('button',{name:'Add bookmark',exact:true}).click();await page.getByRole('button',{name:'Bookmarks (1)',exact:true}).waitFor();
 await page.getByRole('button',{name:'Parts & chapters',exact:true}).click();await page.getByLabel(/Name a chapter at/).fill('A turning point');await page.getByRole('button',{name:'Add chapter here',exact:true}).click();await page.getByRole('button',{name:/SECTION.*A turning point/}).waitFor();
 await page.screenshot({path:join(output,'books-chapters.png'),fullPage:false});await page.evaluate(()=>{window.scrollTo({top:0,behavior:'instant'});document.querySelector('#main')?.scrollTo({top:0,behavior:'instant'});});await page.screenshot({path:join(output,'books-desktop.png'),fullPage:false});
 for(const width of [320,390,740]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(output,`books-${width}.png`),fullPage:false});}
 await page.getByRole('button',{name:'← Audiobooks',exact:true}).click();await page.getByRole('button',{name:/A Long Journey.*In progress/}).click();await page.getByRole('button',{name:'Bookmarks (1)',exact:true}).waitFor();assert.equal(auth.db.prepare('SELECT count(*) AS n FROM audiobooks WHERE user_id=?').get(owner.id).n,1,'reopening must reuse the saved book');
 await page.getByRole('button',{name:'Return to music',exact:true}).click();await page.waitForFunction(()=>document.querySelector('audio')?.src.startsWith('blob:')&&document.querySelector('audio').paused);assert.equal(await page.evaluate(()=>window.originalAudio===document.querySelector('audio')),true);
 await page.getByRole('button',{name:'Resume book',exact:true}).click();await page.waitForFunction(()=>document.querySelector('audio')?.currentTime>=88000);await page.getByRole('button',{name:'Return to music',exact:true}).click();
 await page.reload();await page.getByRole('heading',{name:'A Long Journey',exact:true}).waitFor();await page.getByRole('button',{name:'Resume book',exact:true}).click();await page.waitForFunction(()=>document.querySelector('audio')?.currentTime>=88000);
 await page.getByRole('button',{name:'Pause book',exact:true}).click();
 assert.ok(ranges.some(r=>r.id==='long-book'&&r.start>64*1024*1024),'deep seek must use a large-file byte range');
 assert.ok(bytesServed<400*1024*1024,'browser should not download the whole 1.44 GB book');assert.deepEqual(errors,[]);
 for(const path of ['api/not-a-route','assets/missing.js','.env','apps/server/src/audiobook-routes.ts','data/freeqify.sqlite']){const response=await context.request.get(origin+base+path);assert.equal(response.status(),404,path);}
 const anonymous=await browser.newContext();assert.equal((await anonymous.request.get(origin+base+'api/audiobooks')).status(),401);await anonymous.close();
 console.log(`PASS ${base}: single audio owner, 25-hour original stream, deep range seek, private progress, chapters/bookmarks, speed, paused music restoration, reload resume, 320/390/740/1280 layouts, missing/private files; served ${Math.round(bytesServed/1048576)} MiB of virtual media.`);
}finally{await browser?.close();await app.close();await rm(temp,{recursive:true,force:true});}
