/** Disposable app, generated audio and clearly synthetic lyrics; no operator data. */
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from '../apps/server/dist/app.js';
import {readConfig} from '../apps/server/dist/config.js';
import {openAuthStore} from '../apps/server/dist/auth/store.js';
import {emptyPlayback} from '../packages/shared/dist/index.js';
const {chromium}=await import(process.env.FREEQIFY_PLAYWRIGHT_MODULE||'playwright-core');
const base=process.env.FREEQIFY_SMOKE_BASE||'/',temp=await mkdtemp(join(tmpdir(),'freeqify-lyrics-browser-'));
const output=process.env.FREEQIFY_SCREENSHOT_DIR||join(temp,'screenshots');await mkdir(output,{recursive:true});
execFileSync('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=220:duration=30','-c:a','libmp3lame','-b:a','96k',join(temp,'fixture.mp3')]);const audio=await readFile(join(temp,'fixture.mp3'));
const config=readConfig({BASE_PATH:base,WEB_DIST_DIR:resolve(process.env.FREEQIFY_SMOKE_WEB||'apps/web/dist'),DATA_DIR:join(temp,'data'),AUTH_SECURE_COOKIES:'false',LYRICS_ENABLED:'true'}),auth=openAuthStore(config);
const user=await auth.createInitialAdmin('lyrics-test','generated-lyrics-test-passphrase'),session=auth.createSession(user);
const tracks=[1,2].map(n=>({id:'song'+n,title:'Fixture song '+n,artist:'Fixture artist',album:'Fixture album',duration:30,albumId:'album',artworkId:'cover',format:'mp3',trackNumber:n}));
const album={id:'album',title:'Fixture album',artist:'Fixture artist',artistId:'artist',trackCount:2,artworkId:'cover',year:2026};const cover=await readFile(resolve(config.webDistDir,'icon-192.png'));let lookups=0;
const library={ping:async()=>{},overview:async()=>({artists:1,albums:1,tracks:2,scanning:false}),artists:async()=>[],artist:async()=>({artist:{id:'artist',name:'Fixture artist',albumCount:1,artworkId:null},albums:[album]}),albums:async()=>({items:[album],nextOffset:null}),album:async()=>({album,tracks}),tracks:async()=>({items:tracks,nextOffset:null}),track:async id=>tracks.find(t=>t.id===id),search:async()=>({artists:[],albums:[album],tracks}),artwork:async()=>({contentType:'image/png',bytes:cover}),stream:async(_id,_format,range)=>{
 const match=/^bytes=(\d+)-(\d*)$/.exec(range??''),start=match?Number(match[1]):0,end=match?.[2]?Math.min(Number(match[2]),audio.length-1):audio.length-1;
 return new Response(audio.subarray(start,end+1),{status:match?206:200,headers:{'content-type':'audio/mpeg','content-length':String(end-start+1),'accept-ranges':'bytes',...(match?{'content-range':`bytes ${start}-${end}/${audio.length}`}:{})}});
}};
const lyrics={lookup:async track=>{lookups++;return {status:'synced',provider:'LRCLIB',recordId:1,text:'',lines:[{time:0,text:'Fixture opening '+track.id},{time:10,text:'Fixture middle '+track.id},{time:20,text:'Fixture ending '+track.id},{time:28,text:''}]};}};
const playback={...emptyPlayback(),queue:tracks.map(t=>({key:t.id,trackId:t.id,source:'local'})),order:tracks.map(t=>t.id),current:'song1'};auth.savePlayback(user.id,JSON.stringify(playback));
const app=await createApp(config,{authStore:auth,library,lyrics});let browser;
try{
 await app.listen({host:'127.0.0.1',port:0});const origin=`http://127.0.0.1:${app.server.address().port}`;
 browser=await chromium.launch({executablePath:process.env.FREEQIFY_CHROME||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--mute-audio']});const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});await context.addCookies([{name:'freeqify_session',value:session.token,domain:'127.0.0.1',path:base,httpOnly:true,sameSite:'Lax'}]);const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+base);await page.waitForFunction(()=>document.querySelector('audio')?.readyState>=2);assert.equal(lookups,0);
 await page.getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('audio').paused&&document.querySelector('audio').currentTime>0);await page.evaluate(()=>{window.originalAudio=document.querySelector('audio');window.originalSrc=window.originalAudio.src;});
 await page.getByRole('button',{name:'Open Now Playing',exact:true}).click();await page.getByRole('dialog',{name:'Now Playing'}).waitFor();assert.equal(lookups,0);await page.getByRole('button',{name:'Lyrics',exact:true}).click();await page.getByRole('button',{name:'Fixture middle song1',exact:true}).click();await page.waitForFunction(()=>document.querySelector('audio').currentTime>=10);assert.equal(await page.getByRole('button',{name:'Fixture middle song1',exact:true}).getAttribute('aria-current'),'true');
 await page.getByRole('region',{name:'Music player',exact:true}).getByRole('button',{name:'Pause',exact:true}).click();const paused=await page.locator('audio').evaluate(a=>a.currentTime);await page.waitForTimeout(300);assert.equal(await page.locator('audio').evaluate(a=>a.currentTime),paused);
 await page.getByRole('button',{name:'Show lyrics half a second earlier'}).click();await page.getByRole('button',{name:'Fixture middle song1',exact:true}).click();assert.ok(Math.abs(await page.locator('audio').evaluate(a=>a.currentTime)-9.5)<.1);
 await page.getByLabel('Lyrics text',{exact:true}).dispatchEvent('wheel',{deltaY:100});await page.getByRole('button',{name:'Follow lyrics',exact:true}).click();
 for(const width of [1280,740,390,320]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.getByRole('button',{name:'Lyrics',exact:true}).isVisible(),true);assert.equal(await page.evaluate(()=>{const b=document.querySelector('.music-player .player-play'),r=b.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true);await page.screenshot({path:join(output,`lyrics-${width}.png`)});}
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:/^Immersive view/}).click();const immersive=page.getByRole('dialog',{name:'Now Playing'});assert.equal(await immersive.getAttribute('aria-modal'),'true');await immersive.getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('audio').paused);await immersive.getByRole('button',{name:'Pause',exact:true}).click();assert.ok((await page.locator('.lyrics-scroll').boundingBox()).height>50);await page.screenshot({path:join(output,'lyrics-immersive-390.png')});await page.getByRole('button',{name:/^Exit immersive view/}).click();
 await page.getByRole('button',{name:'Lyrics',exact:true}).click();assert.equal(await page.evaluate(()=>window.originalAudio===document.querySelector('audio')&&window.originalSrc===document.querySelector('audio').src),true);await page.getByRole('button',{name:'Lyrics',exact:true}).click();await page.getByRole('button',{name:'Fixture middle song1',exact:true}).waitFor();
 await page.getByRole('region',{name:'Music player',exact:true}).getByRole('button',{name:'Next track',exact:true}).click();await page.getByRole('button',{name:'Fixture middle song2',exact:true}).waitFor();assert.equal(await page.getByText('Fixture middle song1',{exact:true}).count(),0);assert.equal(await page.locator('audio').count(),1);assert.equal(await page.evaluate(()=>window.originalAudio===document.querySelector('audio')),true);
 for(const path of ['api/missing','assets/missing.js','.env','apps/server/src/lyrics.ts','data/freeqify.sqlite'])assert.equal((await context.request.get(origin+base+path)).status(),404,path);
 const anonymous=await browser.newContext();assert.equal((await anonymous.request.get(origin+base+'api/library/tracks/song1/lyrics')).status(),401);await anonymous.close();assert.deepEqual(errors,[]);
 console.log(`PASS ${base}: opt-in lookup, actual audio playback, synced highlighting, tap seek, timing adjustment, pause, manual scroll/follow, track changes, same audio and queue, 320/390/740/1280 layouts and private routes.`);
}finally{await browser?.close();await app.close();await rm(temp,{recursive:true,force:true});}
