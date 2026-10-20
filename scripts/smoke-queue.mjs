/** Isolated native server, temporary users/database and generated audio. No operator config. */
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createApp} from '../apps/server/dist/app.js';
import {readConfig} from '../apps/server/dist/config.js';
import {openAuthStore} from '../apps/server/dist/auth/store.js';
import {emptyPlayback} from '../packages/shared/dist/index.js';
const {chromium}=await import(process.env.FREEQIFY_PLAYWRIGHT_MODULE||'playwright-core');
const base=process.env.FREEQIFY_SMOKE_BASE||'/',temp=await mkdtemp(join(tmpdir(),'freeqify-queue-review-'));
const output=process.env.FREEQIFY_SCREENSHOT_DIR||join(temp,'screenshots');await mkdir(output,{recursive:true});
const config=readConfig({BASE_PATH:base,WEB_DIST_DIR:resolve(process.env.FREEQIFY_SMOKE_WEB||'apps/web/dist'),DATA_DIR:join(temp,'data'),AUTH_SECURE_COOKIES:'false'});
const store=openAuthStore(config),owner=await store.createInitialAdmin('queue-review','generated-local-queue-fixture-passphrase'),session=store.createSession(owner);
const ids=['A','B','C','D','X','Y','Z'];
const tracks=ids.map((id,index)=>({id,title:`Track ${id}`,artist:'Queue fixture artist',album:id<'X'?'Album Fixture':'Other Fixture',albumId:id<'X'?'album':'other',artworkId:'cover',duration:120,format:'wav',trackNumber:index+1}));
const albums=['album','other'].map((id,index)=>({id,title:index?'Other Fixture':'Album Fixture',artist:'Queue fixture artist',artistId:'artist',artworkId:'cover',trackCount:index?3:4,year:2026}));
const cover=await readFile(resolve(config.webDistDir,'icon-192.png'));
const sr=8000,wav=Buffer.alloc(44+sr*120*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(sr,24);wav.writeUInt32LE(sr*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);for(let i=0;i<sr*120;i++)wav.writeInt16LE(Math.round(Math.sin(i/sr*2*Math.PI*220)*6000),44+i*2);
const library={ping:async()=>{},overview:async()=>({artists:1,albums:2,tracks:7,scanning:false}),artists:async()=>[{id:'artist',name:'Queue fixture artist',albumCount:2,artworkId:'cover'}],artist:async()=>({artist:{id:'artist',name:'Queue fixture artist',albumCount:2,artworkId:'cover'},albums}),albums:async()=>({items:albums,nextOffset:null}),album:async id=>({album:albums.find(a=>a.id===id),tracks:tracks.filter(t=>t.albumId===id)}),tracks:async()=>({items:tracks,nextOffset:null}),track:async id=>{const t=tracks.find(t=>t.id===id);assert.ok(t);return t;},search:async()=>({artists:[],albums,tracks}),artwork:async()=>({contentType:'image/png',bytes:cover}),stream:async(_id,_format,range)=>{
 let start=0,end=wav.length-1;const match=range?.match(/^bytes=(\d+)-(\d*)$/);if(match){start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]));}
 return new Response(wav.subarray(start,end+1),{status:match?206:200,headers:{'content-type':'audio/wav','content-length':String(end-start+1),'accept-ranges':'bytes',...(match?{'content-range':`bytes ${start}-${end}/${wav.length}`}:{})}});
}};
store.savePlayback(owner.id,JSON.stringify({...emptyPlayback(),queue:ids.slice(0,4).map(id=>({key:`key-${id}`,source:'local',trackId:id})),order:ids.slice(0,4).map(id=>`key-${id}`),current:'key-A',position:2,contextLabel:'Album Fixture'}));
const app=await createApp(config,{authStore:store,library});let browser;
try{
 await app.listen({host:'127.0.0.1',port:0});const origin=`http://127.0.0.1:${app.server.address().port}`;
 browser=await chromium.launch({executablePath:process.env.FREEQIFY_CHROME||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce',hasTouch:true});await context.addCookies([{name:'freeqify_session',value:session.token,domain:'127.0.0.1',path:base,httpOnly:true,sameSite:'Lax'}]);
 await context.addInitScript(user=>{try{const key=`freeqify.visualizer.${user}`;if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify({engine:'milkdrop',spectrumVersion:2}));}catch{/* Opaque initial pages have no storage. */}},owner.id);
 const page=await context.newPage(),errors=[];await page.emulateMedia({reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{const original=WebGL2RenderingContext.prototype.uniformMatrix4fv;WebGL2RenderingContext.prototype.uniformMatrix4fv=function(location,transpose,value){window.queueFlightMatrix=Array.from(value);return original.call(this,location,transpose,value);};});
 await page.goto(origin+base);const player=page.locator('.music-player'),audio=page.locator('audio'),queue=page.locator('#dock-queue');
 const waitTrack=async(id,previous=null)=>page.waitForFunction(({id,previous})=>document.querySelector('.mini-player-open .scrolling-title-copy')?.textContent===`Track ${id}`&&document.querySelector('audio')?.src.startsWith('blob:')&&(!previous||document.querySelector('audio').src!==previous),{id,previous});
 await waitTrack('A');assert.equal(await page.getByLabel('Visualizer mode').inputValue(),'spectrum2d');assert.equal(await page.getByLabel('Visualizer palette').locator('option').count(),7);assert.ok(await page.evaluate(()=>document.querySelector('#main').children[1].classList.contains('player-main-host')&&document.querySelector('.hero').nextElementSibling.tagName==='FOOTER'));await page.screenshot({path:join(output,'home-2d.png')});console.log('PASS restored track on desktop Chromium');
 assert.equal(await audio.evaluate(a=>a.paused),true,'restoration must not autoplay');
 await player.getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(()=>{const canvas=document.querySelector('.home-visualizer canvas');if(!canvas)return false;return canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data.some((v,i)=>i%4===3&&v>0);});await page.screenshot({path:join(output,'home-2d-live.png')});
 await page.setViewportSize({width:320,height:568});await page.getByLabel('Visualizer mode').selectOption('milkdrop');
 assert.ok(await page.locator('.home-visualizer .visualizer-tools').evaluate(e=>e.scrollWidth<=e.clientWidth));assert.ok(await page.locator('.home-visualizer .visualizer-tools button').evaluateAll(items=>items.every(e=>e.getBoundingClientRect().width>=36&&e.getBoundingClientRect().height<=60)));await page.screenshot({path:join(output,'milkdrop-controls-320.png')});
 await page.getByLabel('Visualizer mode').selectOption('spectrum2d');
 const holdCdp=await context.newCDPSession(page),stage=await page.getByRole('group',{name:'Visualizer display'}).boundingBox(),hx=stage.x+stage.width/2,hy=stage.y+stage.height/2;
 await holdCdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:hx,y:hy}]});await page.waitForTimeout(750);await holdCdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.getByText('Tap to enable',{exact:true}).waitFor();assert.equal(await audio.evaluate(a=>a.paused),false);
 await page.getByRole('group',{name:'Enable visualizer'}).tap();await page.getByText('Long touch for off',{exact:true}).waitFor();assert.equal(await page.locator('.visualizer-heading').count(),0);
 assert.equal(await page.locator('.visualizer-scroll-rail,.home-scroll-indicators').count(),0);
 for(const mode of ['spectrum2d','spectrum','milkdrop']){
  await page.locator('#main').evaluate(e=>e.scrollTop=0);await page.getByLabel('Visualizer mode').selectOption(mode);
  if(mode==='spectrum'){
   await page.emulateMedia({reducedMotion:'no-preference'});await page.waitForFunction(()=>window.queueFlightMatrix?.length===16);
   const first=await page.evaluate(()=>window.queueFlightMatrix);await page.waitForTimeout(1500);const second=await page.evaluate(()=>window.queueFlightMatrix);assert.notDeepEqual(second,first,'real WebGL camera must move during playback');await page.screenshot({path:join(output,'drone-flight.png')});console.log('PASS real WebGL drone camera changes during playback');
   await page.emulateMedia({reducedMotion:'reduce'});
  }
  const box=await page.locator('.spectrum-stage').boundingBox(),x=box.x+box.width/2,y=box.y+box.height*.8;
  assert.equal(await page.locator('.spectrum-stage canvas:visible').evaluate(e=>getComputedStyle(e).touchAction),'pan-y');
  await holdCdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x,y}]});
  for(let i=1;i<=8;i++){await holdCdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x,y:y-i*12}]});await page.waitForTimeout(20);}
  await holdCdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForFunction(()=>document.querySelector('#main').scrollTop>20);
  assert.equal(await audio.evaluate(a=>a.paused),false);await page.waitForTimeout(500);
 }
 await page.locator('#main').evaluate(e=>e.scrollTop=0);await page.getByLabel('Visualizer mode').selectOption('spectrum2d');console.log('PASS touch scroll over 2D/3D/MilkDrop; no scroll lane or arrows; audio continues');
 await page.setViewportSize({width:1280,height:900});await player.getByRole('button',{name:'Pause',exact:true}).click();
 await page.locator('.library-tabs').getByRole('button',{name:'Tracks',exact:true}).click();await page.getByRole('button',{name:'Track X',exact:true}).waitFor();
 await player.getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('audio').paused&&document.querySelector('audio').currentTime>.2);
 await page.evaluate(()=>{window.queueFixtureAudio=document.querySelector('audio');window.queueFixtureSource=document.querySelector('audio').src;});
 const hide=async()=>{if(await queue.isVisible())await queue.getByRole('button',{name:'Collapse queue'}).click();};
 const add=async(id,action)=>{await hide();const row=page.locator('.track-list tr').filter({has:page.getByRole('button',{name:`Track ${id}`,exact:true})});await row.getByRole('button',{name:`Add Track ${id}`,exact:true}).click();await page.getByRole('menuitem',{name:action,exact:true}).click();};
 const upcomingOrder=async()=>{await page.waitForFunction(()=>[...document.querySelectorAll('#dock-queue .queue-scroll section:not(:first-child) .queue-song strong')].every(node=>node.textContent.startsWith('Track ')));return queue.locator('.queue-scroll section:not(:first-child) .queue-song strong').allTextContents();};
 await add('X','Play Next');await queue.getByRole('button',{name:'Play Track X',exact:true}).waitFor();assert.deepEqual(await upcomingOrder(),['Track X','Track B','Track C','Track D']);
 await add('Y','Add to Queue');assert.deepEqual(await upcomingOrder(),['Track X','Track Y','Track B','Track C','Track D']);
 const before=await player.locator('.player-controls').boundingBox();await queue.getByRole('button',{name:'Collapse queue'}).click();assert.equal(await audio.evaluate(a=>!a.paused),true);
 await player.getByRole('button',{name:'Show playback queue',exact:true}).click();assert.deepEqual(await player.locator('.player-controls').boundingBox(),before);
 assert.equal(await page.evaluate(()=>window.queueFixtureAudio===document.querySelector('audio')&&window.queueFixtureSource===document.querySelector('audio').src),true);
 // The existing playlist picker remains available through the same plus menu.
 await add('Z','Add to Playlist');const picker=page.getByRole('dialog',{name:'Add to playlist'});await picker.getByLabel('New playlist name').fill('Existing picker');await picker.getByRole('button',{name:'Add song',exact:true}).click();await picker.waitFor({state:'hidden'});
 await player.getByRole('button',{name:'Show playback queue',exact:true}).click();
 // Keyboard-accessible reordering and a direct pointer drag both update actual playback order.
 await queue.getByRole('button',{name:'Actions for Track Y',exact:true}).click();await page.getByRole('menuitem',{name:'Move up',exact:true}).click();assert.deepEqual((await upcomingOrder()).slice(0,2),['Track Y','Track X']);
 const from=await queue.getByRole('button',{name:'Reorder Track X',exact:true}).boundingBox(),to=await queue.getByRole('button',{name:'Reorder Track Y',exact:true}).boundingBox();
 await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:8});await page.mouse.up();assert.deepEqual((await upcomingOrder()).slice(0,2),['Track X','Track Y']);
 const beforeX=await audio.getAttribute('src');await player.getByRole('button',{name:'Next track',exact:true}).click();await waitTrack('X',beforeX);
 const beforeY=await audio.getAttribute('src');await player.getByRole('button',{name:'Next track',exact:true}).click();await waitTrack('Y',beforeY);
 const beforeB=await audio.getAttribute('src');await player.getByRole('button',{name:'Next track',exact:true}).click();await waitTrack('B',beforeB);
 await queue.getByRole('button',{name:'Save as playlist'}).click();await queue.getByLabel('Playlist name').fill('Entire queue');
 for(const [width,height] of [[390,844],[740,360]]){await page.setViewportSize({width,height});const label=await queue.locator('.queue-save label').boundingBox(),save=await queue.getByRole('button',{name:'Save entire queue',exact:true}).boundingBox();assert.ok(save.y>=label.y+label.height,'playlist name must occupy its own line');if(width===390)await page.screenshot({path:join(output,'queue-save-name.png')});}
 await queue.getByRole('button',{name:'Save entire queue',exact:true}).click();await page.setViewportSize({width:1280,height:900});await queue.getByRole('status').filter({hasText:'Saved the entire queue'}).waitFor();
 const saved=store.db.prepare("SELECT id FROM personal_playlists WHERE user_id=? AND name='Entire queue'").get(owner.id);assert.ok(saved);
 assert.deepEqual(store.db.prepare('SELECT track_id FROM personal_entries WHERE playlist_id=? ORDER BY position').all(saved.id).map(r=>r.track_id),['A','X','Y','B','C','D']);
 await queue.getByRole('button',{name:'Earlier (3)',exact:true}).click();await queue.getByLabel('Earlier in this queue').getByRole('button',{name:'Play Track A',exact:true}).waitFor();assert.equal(await queue.getByLabel('Earlier in this queue').locator('li').count(),3);await queue.getByRole('button',{name:'Earlier (3)',exact:true}).click();
 // Structural edits work with no server connection and recover through a paused reload.
 await add('X','Add to Queue');await context.setOffline(true);await page.getByRole('heading',{name:'Downloaded music',exact:true}).waitFor();await queue.getByRole('button',{name:'Reorder Track D',exact:true}).press('ArrowUp');await queue.getByRole('button',{name:'Reorder Track D',exact:true}).press('ArrowDown');assert.ok(await queue.getByRole('button',{name:'Clear manual queue'}).isEnabled());
 assert.ok(await page.evaluate(user=>localStorage.getItem(`freeqify.queue-draft.${user}`),owner.id));await context.setOffline(false);await page.waitForFunction(()=>!document.querySelector('.offline-banner'));await page.locator('.sidebar-nav').getByRole('button',{name:'Tracks',exact:true}).click();await page.getByRole('button',{name:'Track X',exact:true}).waitFor();
 await page.reload();await waitTrack('B');assert.equal(await audio.evaluate(a=>a.paused),true);
 if(!await queue.isVisible())await player.getByRole('button',{name:'Show playback queue',exact:true}).click();
 await queue.getByRole('button',{name:'Play Track C',exact:true}).waitFor();assert.deepEqual(await upcomingOrder(),['Track X','Track C','Track D']);
 const currentSource=await audio.getAttribute('src');await queue.getByRole('button',{name:'Clear manual queue'}).click();assert.equal(await audio.getAttribute('src'),currentSource);assert.deepEqual(await upcomingOrder(),['Track C','Track D']);
 await add('X','Add to Queue');await add('Y','Add to Queue');
 // Touch drag inside the same manual section, plus independent dock/seek controls.
 await page.setViewportSize({width:390,height:844});await player.getByRole('button',{name:'Show seek bar'}).click();
 const touchFrom=await queue.getByRole('button',{name:'Reorder Track Y',exact:true}).boundingBox(),touchTo=await queue.getByRole('button',{name:'Reorder Track X',exact:true}).boundingBox();
 const cdp=await context.newCDPSession(page);const x=touchFrom.x+touchFrom.width/2,y=touchFrom.y+touchFrom.height/2,ty=touchTo.y+touchTo.height/2;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x,y}]});for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x,y:y+(ty-y)*i/8}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 assert.deepEqual((await upcomingOrder()).slice(0,2),['Track Y','Track X']);
 await page.emulateMedia({reducedMotion:'no-preference'});
 await queue.getByRole('button',{name:'Collapse queue'}).click();await page.waitForTimeout(250);
 const animation=await page.evaluate(()=>new Promise(resolve=>{const tray=document.querySelector('#dock-queue');tray.getBoundingClientRect();const timer=setTimeout(()=>resolve(false),5000);const began=event=>{if(event.propertyName==='grid-template-rows'){clearTimeout(timer);tray.removeEventListener('transitionrun',began);resolve(true);}};tray.addEventListener('transitionrun',began);document.querySelector('.player-queue-toggle').click();}));
 assert.ok(animation,'queue expansion must animate its own row inside the tray');await page.waitForTimeout(250);await page.emulateMedia({reducedMotion:'reduce'});
 for(const [width,height] of [[320,568],[390,844],[740,360],[1280,900]]){
  await page.setViewportSize({width,height});
  const geometry=await page.evaluate(()=>{const p=document.querySelector('.music-player').getBoundingClientRect(),q=document.querySelector('#dock-queue').getBoundingClientRect();const seek=document.querySelector('#mini-player-seek').getBoundingClientRect(),nav=document.querySelector('.mobile-navigation').getBoundingClientRect();return {player:p.toJSON(),queue:q.toJSON(),seek:seek.toJSON(),nav:nav.toJSON(),overflow:document.documentElement.scrollWidth>innerWidth};});
  await page.screenshot({path:join(output,`queue-${width}.png`)});console.log('Queue geometry',width,JSON.stringify(geometry));
  assert.ok(!geometry.overflow);if(width<761){assert.ok(Math.abs(geometry.queue.y-geometry.seek.bottom)<=1,'queue must start directly beneath seek');assert.ok(geometry.queue.bottom<=geometry.nav.y+1,'navigation remains accessible');}assert.ok(geometry.queue.y>=0,'queue must fit visible viewport');
  await page.screenshot({path:join(output,`queue-${width}.png`)});
 }
 await page.setViewportSize({width:390,height:844});await queue.getByRole('button',{name:'Collapse queue'}).click();assert.ok(await player.getByRole('button',{name:'Hide seek bar'}).isVisible());
 const swipeHandle=await player.locator('.player-controls .player-play').boundingBox();
 const sx=swipeHandle.x+swipeHandle.width/2,sy=swipeHandle.y+swipeHandle.height/2;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:sx,y:sy}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:sx,y:sy-70}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await queue.waitFor();
 const down=await player.locator('.player-queue-toggle').boundingBox(),dy=down.y+down.height/2;const downX=down.x+down.width/2;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:downX,y:dy}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:downX,y:dy+70}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await queue.waitFor({state:'hidden'});
 // Changing the context retains the user's pending manual songs and their order.
 await page.locator('.library-tabs').getByRole('button',{name:'Albums',exact:true}).click();await page.locator('.album-card').filter({hasText:'Other Fixture'}).first().click();await page.getByRole('button',{name:'Play album',exact:true}).click();
 await player.getByRole('button',{name:'Show playback queue',exact:true}).click();assert.deepEqual((await upcomingOrder()).slice(0,2),['Track Y','Track X']);
 await queue.getByRole('button',{name:'Collapse queue'}).click();const audioHandle=await audio.elementHandle();await player.getByRole('button',{name:'Open Now Playing',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Now Playing'});await dialog.waitFor();
 assert.ok(await dialog.evaluate(d=>Boolean(d.closest('#main'))),'visualizer belongs to the main pane');assert.equal(await dialog.getAttribute('aria-modal'),'false');
 await dialog.getByRole('button',{name:'Show playback queue',exact:true}).click();await queue.waitFor();
 assert.ok(await player.getByRole('button',{name:'Hide playback queue',exact:true}).isVisible());
 await page.screenshot({path:join(output,'main-visualizer-queue.png')});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await queue.getByRole('button',{name:'Collapse queue'}).click();assert.ok(await dialog.isVisible());assert.equal(await page.evaluate(a=>document.querySelector('audio')===a,audioHandle),true,'main-pane visualizer must retain the audio element');
 const mode=await dialog.getByLabel('Visualizer mode').inputValue();await dialog.getByRole('button',{name:'Immersive view',exact:true}).click();await dialog.getByRole('button',{name:'Show playback queue',exact:true}).click();await page.keyboard.press('Escape');assert.ok((await dialog.getAttribute('class')).includes('player-immersive'));assert.equal(await dialog.getByLabel('Visualizer mode').inputValue(),mode);
 await dialog.getByRole('button',{name:'Close Now Playing',exact:true}).click();assert.ok(await player.getByRole('button',{name:'Hide seek bar',exact:true}).isVisible());
 // Starting an actual private playlist populates and opens the compact queue automatically.
 await page.setViewportSize({width:1280,height:900});await page.getByRole('navigation',{name:'Your space'}).getByRole('button',{name:'Playlists',exact:true}).click();
 await page.locator('.personal-library .library-card').filter({hasText:'Entire queue'}).click();await page.getByRole('button',{name:'Play all',exact:true}).click();await queue.waitFor();await waitTrack('A');
 assert.ok(await player.getByRole('button',{name:'Hide playback queue',exact:true}).isVisible());await queue.getByRole('button',{name:'Play Track B',exact:true}).waitFor();assert.ok((await queue.innerText()).includes('Entire queue'));
 assert.deepEqual(errors,[]);console.log(`PASS queue ${base}: genuine server/API saves; manual priority/resume; playlist picker; mouse/touch reorder; independent collapse; offline editing/reload paused; all-history save; replacement context; 320/390/740/1280 layouts; persistent playback. Generated audio only.`);
}finally{await browser?.close();await app.close();await rm(temp,{recursive:true,force:true});}
