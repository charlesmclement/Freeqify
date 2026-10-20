/** Disposable public frontend + synthetic API; never reads operator data. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {publicAsset} from '../apps/server/dist/public-assets.js';
const {chromium}=await import(process.env.FREEQIFY_PLAYWRIGHT_MODULE||'playwright-core');
const base=process.env.FREEQIFY_SMOKE_BASE||'/';
const dist=resolve(process.env.FREEQIFY_SMOKE_WEB||'apps/web/dist');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webmanifest':'application/manifest+json'};
let generation=0,coverRequests=0;
const coverFixture=await readFile(resolve(dist,'icon-192.png'));
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;if(!path.startsWith(base))throw Error();const relative=path.slice(base.length)||'index.html';if(!publicAsset(relative))throw Error();let bytes=await readFile(resolve(dist,relative));if(relative==='sw.js')bytes=Buffer.concat([bytes,Buffer.from(`\n// smoke generation ${generation}`)]);res.writeHead(200,{'content-type':types[extname(relative)]||'application/octet-stream','cache-control':'no-cache'});res.end(bytes);}catch{res.writeHead(404);res.end();}});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
try{
 browser=await chromium.launch({executablePath:process.env.FREEQIFY_CHROME||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:1280,height:900}});
 const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(String(error)));
 const track={id:'song',title:'Fixture Song',artist:'Fixture Artist',album:'Fixture Album',albumId:'album',artworkId:null,duration:60,format:'wav',trackNumber:1};
 const album={id:'album',title:'Fixture Album',artist:'Fixture Artist',artistId:'artist',artworkId:null,trackCount:1,year:2026};
 const remaining={...track,id:'remaining',title:'Remaining Song',trackNumber:2};let removed=false;
 const playback={queue:[{key:'entry',source:'local',trackId:'song'}],order:['entry'],current:'entry',position:0,volume:0.4,muted:false,shuffle:false,repeat:'off'};
 const wav=Buffer.alloc(44+8000*2*60);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
 await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname.slice((base+'api/').length);
  if(path.startsWith('library/artwork/album/')&&!path.endsWith('/choice')){coverRequests++;return route.fulfill({contentType:'image/png',body:coverFixture,headers:{'cache-control':'no-store'}});}
  if(path==='library/remove'){removed=true;return route.fulfill({json:{ok:true}});}
  if(path.startsWith('library/stream/'))return route.fulfill({contentType:'audio/wav',body:wav,headers:{'cache-control':'no-store'}});
  const body=path==='auth/session'?{user:{id:'fixture',username:'fixture',role:process.env.FREEQIFY_SMOKE_ADMIN==='1'?'admin':'listener',status:'active',createdAt:0},csrf:'a'.repeat(64),expiresAt:Date.now()+3600000}:path==='health'?{status:'ok',service:'freeqify',phase:0}:path==='playback'?playback:path==='personal/summary'?{playlists:[],favoriteIds:[],generation:0}:path==='library/overview'?{artists:1,albums:1,tracks:1,scanning:false}:path==='library/tracks/song'?track:path==='library/albums/album'?{album,tracks:removed?[remaining]:[track,remaining]}:path.startsWith('library/albums')?{items:[album],nextOffset:null}:path==='library/artists'?{items:[{id:'artist',name:'Fixture Artist',albumCount:1,artworkId:null}]}:path.startsWith('library/tracks')?{items:[track],nextOffset:null}:path.startsWith('personal/')?{items:[],nextOffset:null}:{items:[],nextOffset:null};
  await route.fulfill({json:body,headers:{'cache-control':'no-store'}});
 });
 await page.goto(origin+base);await page.locator('audio').waitFor({state:'attached'});
 await page.evaluate(()=>{window.fixtureAudio=document.querySelector('audio');});
 const nav=page.getByRole('navigation',{name:'Your space'});
 await nav.getByRole('button',{name:'Albums',exact:true}).click();
 await page.locator('.album-list .album-card').first().click();
 await page.getByRole('heading',{name:'Fixture Album',exact:true}).waitFor();
 await page.waitForFunction(()=>{const image=document.querySelector('.album-heading img');return image?.complete&&image.naturalWidth>0;});
 const savedCoverRequests=coverRequests;
 await page.evaluate(()=>{for(let i=0;i<3;i++)window.dispatchEvent(new Event('focus'));});
 await page.waitForTimeout(250);assert.equal(coverRequests,savedCoverRequests,'loaded covers must not refetch on focus');
 await page.evaluate(()=>window.dispatchEvent(new Event('freeqify:artwork-changed')));
 await page.waitForFunction(()=>{const image=document.querySelector('.album-heading img');return image?.getAttribute('src')?.includes('revision=1')&&image.complete&&image.naturalWidth>0;});
 assert.ok(coverRequests>savedCoverRequests,'manual artwork changes must still refresh');
 if(process.env.FREEQIFY_SMOKE_ADMIN==='1'){
  for(const width of [320,390,768,1280]){
   await page.setViewportSize({width,height:900});
   const actions=page.locator('.album-actions');
   const buttons=[actions.getByRole('button',{name:'Play album',exact:true}),actions.getByRole('button',{name:'Edit artwork',exact:true}),actions.getByRole('button',{name:'Remove Fixture Album from Freeqify',exact:true})];
   const boxes=await Promise.all(buttons.map(button=>button.boundingBox()));
   assert.ok(boxes.every(box=>Math.abs(box.y-boxes[0].y)<=1&&Math.abs(box.height-boxes[0].height)<=1&&Math.abs(box.width-boxes[0].width)<=1),`album action alignment ${width}`);
   assert.equal((await buttons[2].innerText()).trim(),'Remove');
   const songRow=page.locator('.track-list tbody tr').first();
   assert.equal((await songRow.getByRole('button',{name:'Add Fixture Song',exact:true}).innerText()).trim(),'＋');
   const download=songRow.getByRole('button',{name:'Download Fixture Song',exact:true});
   assert.equal(await download.isDisabled(),false);
   assert.equal(await download.evaluate(e=>getComputedStyle(e,'::after').content),'none');
   const cells=await songRow.locator('.library-track-controls button').evaluateAll(buttons=>buttons.map(e=>({x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})));
   assert.ok(cells.every(cell=>cell.width===44&&cell.height===44),`square song grid ${width}`);
   for(const cell of cells)assert.ok(Math.abs((cell.x-cells[0].x)%49)<=1&&Math.abs((cell.y-cells[0].y)%49)<=1,`song grid alignment ${width}`);
   const labels=await page.locator('.library-category:visible').evaluateAll(buttons=>buttons.map(e=>{const icon=e.querySelector('svg').getBoundingClientRect(),label=e.querySelector('span');return {above:icon.bottom<=label.getBoundingClientRect().top+1,fits:label.scrollWidth<=label.clientWidth,nowrap:getComputedStyle(label).whiteSpace};}));
   assert.ok(labels.every(label=>label.above&&label.fits&&label.nowrap==='nowrap'),`library tab labels ${width}`);
   assert.ok(await actions.evaluate(e=>e.scrollWidth<=e.clientWidth));
   const maintenance=page.locator('.library-maintenance'),scan=await maintenance.getByRole('button',{name:'Scan music library',exact:true}).boundingBox(),refresh=await maintenance.getByRole('button',{name:'Refresh view',exact:true}).boundingBox();assert.equal(scan.y,refresh.y);assert.equal(scan.height,44);assert.equal(scan.height,refresh.height);assert.equal(scan.width,refresh.width);
   if(process.env.FREEQIFY_SHARP_PREVIEW)await page.screenshot({path:`${process.env.FREEQIFY_SHARP_PREVIEW}-album-${width}.png`});
  }
 }
 if(process.env.FREEQIFY_SMOKE_ADMIN==='1'){
  await page.locator('.track-list').getByRole('button',{name:'Add Fixture Song',exact:true}).click();
  await page.getByRole('menuitem',{name:'Add to Playlist',exact:true}).click();
  await page.getByRole('dialog',{name:'Add to playlist'}).waitFor();
  await page.getByRole('dialog',{name:'Add to playlist'}).getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('dialog',{name:'Add to playlist'}).waitFor({state:'hidden'});
 }
 if(process.env.FREEQIFY_SMOKE_ADMIN==='1'){
  const profile=page.locator('.header-account .profile-menu');await profile.locator(':scope>summary').click();
  for(const width of [320,390,1280]){await page.setViewportSize({width,height:900});const actions=await profile.locator('.profile-content>button,.profile-content>details>summary').evaluateAll(items=>items.map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {w:r.width,h:r.height,pt:s.paddingTop,pb:s.paddingBottom};}));assert.equal(actions.length,3);assert.ok(actions.every(a=>a.w===actions[0].w&&a.h===48&&a.pt===a.pb),'account actions must align with equal vertical padding');}
  await profile.locator(':scope>summary').click();
 }
 const deep=page.url();await page.goBack();await page.locator('.album-list .album-card').first().waitFor();
 await page.goForward();await page.getByRole('heading',{name:'Fixture Album',exact:true}).waitFor();
 await page.reload();await page.getByRole('heading',{name:'Fixture Album',exact:true}).waitFor();
 assert.equal(page.url(),deep);
 if(process.env.FREEQIFY_SMOKE_ADMIN==='1'){
  const remove=page.getByRole('button',{name:'Remove Fixture Song from Freeqify',exact:true});
  assert.equal((await remove.innerText()).trim(),'−');
  await remove.click();await page.getByRole('button',{name:'Confirm removal'}).click();
  await page.getByRole('dialog',{name:'Remove from Freeqify?'}).waitFor({state:'hidden'});
  await page.locator('.track-list').getByText('Remaining Song',{exact:true}).waitFor();
  assert.equal(await page.locator('.track-list').getByText('Fixture Song',{exact:true}).count(),0);
  assert.equal(page.url(),deep);await page.getByRole('heading',{name:'Fixture Album',exact:true}).waitFor();
 }
 await page.evaluate(()=>{window.fixtureAudio=document.querySelector('audio');});
 await nav.getByRole('button',{name:'Search',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.fixtureAudio===document.querySelector('audio')),true);
 await page.getByRole('button',{name:'Open Now Playing'}).click();
 await page.getByRole('dialog',{name:'Now Playing',exact:true}).waitFor();
 await page.getByRole('dialog',{name:'Now Playing',exact:true}).getByRole('button',{name:'Show playback queue'}).click();
 await page.getByLabel('Playback queue',{exact:true}).waitFor();
 await page.goBack();await page.getByLabel('Playback queue',{exact:true}).waitFor({state:'hidden'});
 await page.goBack();await page.getByRole('dialog',{name:'Now Playing',exact:true}).waitFor({state:'hidden'});
 await page.goForward();await page.getByRole('dialog',{name:'Now Playing',exact:true}).waitFor();
 await page.getByRole('button',{name:'Close Now Playing'}).click();await page.getByRole('dialog',{name:'Now Playing',exact:true}).waitFor({state:'hidden'});
 assert.equal(await page.evaluate(()=>window.fixtureAudio===document.querySelector('audio')),true);
 await page.evaluate(async()=>{await navigator.serviceWorker.ready;});await page.reload();
 await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);
 const cache=await page.evaluate(async()=>{const keys=await caches.keys();return {keys,urls:(await Promise.all(keys.map(async key=>(await(await caches.open(key)).keys()).map(request=>request.url)))).flat()};});
 assert.ok(cache.keys.length>0);assert.ok(cache.urls.every(url=>!url.includes('/api/')));assert.ok(cache.urls.some(url=>url.includes('/assets/')));
 await page.getByRole('button',{name:'Play',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('audio').paused);
 await page.evaluate(()=>{window.fixtureAudio=document.querySelector('audio');window.workerChanges=0;navigator.serviceWorker.addEventListener('controllerchange',()=>window.workerChanges++);});
 generation++;
 await page.evaluate(async()=>{await(await navigator.serviceWorker.getRegistration()).update();});
 await page.waitForFunction(async()=>Boolean((await navigator.serviceWorker.getRegistration()).waiting));
 assert.equal(await page.evaluate(()=>window.fixtureAudio===document.querySelector('audio')&&!document.querySelector('audio').paused&&window.workerChanges===0),true);
 const manifest=await(await fetch(origin+base+'manifest.webmanifest')).json();assert.equal(manifest.name,'Freeqify');assert.equal(manifest.display,'standalone');assert.equal(new URL(manifest.scope,origin+base+'manifest.webmanifest').pathname,base);
 for(const icon of [...manifest.icons,{src:'apple-touch-icon.png'}])assert.equal((await fetch(origin+base+icon.src)).status,200);
 await page.setViewportSize({width:390,height:844});
 const seekToggle=page.getByRole('button',{name:'Show seek bar'});await seekToggle.waitFor();
 assert.equal(await page.locator('#mini-player-seek').isVisible(),false);
 const dock=await page.locator('.music-player').boundingBox(),menu=await page.getByRole('navigation',{name:'Mobile navigation'}).boundingBox();
 assert.ok(Math.abs(dock.y+dock.height-menu.y)<=1);assert.equal(dock.x,0);assert.equal(dock.width,390);
 assert.equal(await page.locator('.music-player').evaluate(element=>getComputedStyle(element).borderTopLeftRadius),'0px');
 await seekToggle.click();assert.equal(await page.locator('#mini-player-seek').isVisible(),true);
 assert.equal(await page.evaluate(()=>window.fixtureAudio===document.querySelector('audio')&&!document.querySelector('audio').paused),true);
 if(process.env.FREEQIFY_SMOKE_SCREENSHOT)await page.screenshot({path:process.env.FREEQIFY_SMOKE_SCREENSHOT});
 await page.getByRole('button',{name:'Hide seek bar'}).click();assert.equal(await page.locator('#mini-player-seek').isVisible(),false);

 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 for(const width of [320,390,768,1280]){
  await page.setViewportSize({width,height:900});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow at ${width}`);
  const controls=await page.locator('button:visible').evaluateAll(buttons=>buttons.map(button=>({label:button.getAttribute('aria-label')||button.textContent,radius:getComputedStyle(button).borderRadius,clipped:button.scrollWidth>button.clientWidth+1||button.scrollHeight>button.clientHeight+1})));
  assert.ok(controls.every(button=>button.radius==='0px'),`rounded buttons at ${width}`);
  assert.deepEqual(controls.filter(button=>button.clipped),[],`clipped buttons at ${width}`);
  if(process.env.FREEQIFY_SHARP_PREVIEW)await page.screenshot({path:`${process.env.FREEQIFY_SHARP_PREVIEW}-${width}.png`});
 }
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('navigation',{name:'Mobile navigation'}).getByRole('button',{name:'Home',exact:true}).click();
 const countCards=page.locator('.dashboard-counts strong');await countCards.first().waitFor();
 for(const width of [320,390,768,1280]){
  await page.setViewportSize({width,height:844});
  for(const text of ['9','12,345','987,654,321','9,007,199,254,740,991']){
   const fits=await countCards.evaluateAll((elements,text)=>elements.map(e=>{e.textContent=text;e.style.setProperty('--count-chars',String(text.length));return e.scrollWidth<=e.clientWidth+1&&getComputedStyle(e).whiteSpace==='nowrap';}),text);
   assert.ok(fits.every(Boolean),`growing count fit ${width} ${text}`);
  }
 }
 await page.setViewportSize({width:390,height:844});
 const main=page.locator('#main');
 await main.evaluate(element=>{ const spacer=document.createElement('div');spacer.style.height='1800px';spacer.setAttribute('data-scroll-fixture','');element.append(spacer); });
 for(const height of [844,700,920]){
  await page.setViewportSize({width:390,height});
  for(const bottom of [false,true]){
   await main.evaluate((element,bottom)=>element.scrollTo({top:bottom?element.scrollHeight:0,left:100}),bottom);
   const navBox=await page.getByRole('navigation',{name:'Mobile navigation'}).boundingBox();
   const playerBox=await page.locator('.music-player').boundingBox();
   assert.ok(Math.abs(navBox.y+navBox.height-height)<=1,'navigation must stay at visible viewport bottom');
   assert.ok(Math.abs(playerBox.y+playerBox.height-navBox.y)<=1,'player must stay above navigation');
   assert.equal(await main.evaluate(element=>element.scrollLeft),0);
   assert.equal(await page.evaluate(()=>scrollY),0);
  }
 }
 await main.locator('[data-scroll-fixture]').evaluate(element=>element.remove());
 assert.ok((await page.locator('meta[name=viewport]').getAttribute('content')).includes('user-scalable=no'));
 const movingTitle=page.locator('.mini-player-open .scrolling-title-copy');
 assert.equal(await movingTitle.evaluate(element=>getComputedStyle(element).animationName),'none');
 await movingTitle.evaluate(element=>{element.textContent='A very long song title that should move gently back and forth inside the compact player without moving its controls or the bottom navigation';});
 await page.waitForFunction(()=>document.querySelector('.mini-player-open .scrolling-title-copy')?.classList.contains('is-overflowing'));
 const motion=await movingTitle.evaluate(element=>{
  const animation=element.getAnimations()[0];const duration=Number(animation.effect.getTiming().duration);animation.pause();animation.currentTime=duration*.9;const end=getComputedStyle(element).transform;animation.currentTime=duration*1.9;return {end,start:getComputedStyle(element).transform,direction:animation.effect.getTiming().direction};
 });
 assert.equal(motion.direction,'alternate');assert.notEqual(motion.start,motion.end);
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await movingTitle.evaluate(element=>getComputedStyle(element).animationName),'none');
 assert.deepEqual(errors,[]);
 console.log(`PASS PWA ${base}: real Chromium history/deep-link reload, player and queue Back/Forward, persistent audio, service-worker public-only cache and waiting update during playback, manifest/icons and mobile sizing. Synthetic audio/API only; no physical-device claims.`);
}finally{await browser?.close();server.closeAllConnections();await new Promise(ok=>server.close(ok));}
