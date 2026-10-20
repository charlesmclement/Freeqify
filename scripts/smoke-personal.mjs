import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadEnvironment} from '../apps/server/dist/environment.js';
import {readConfig} from '../apps/server/dist/config.js';
import {openAuthStore} from '../apps/server/dist/auth/store.js';
import {createApp} from '../apps/server/dist/app.js';
loadEnvironment();
const directory=await mkdtemp(join(tmpdir(),'freeqify-personal-smoke-'));
const config=readConfig({...process.env,DATA_DIR:join(directory,'accounts'),AUTH_SECURE_COOKIES:'false'});
const password=randomBytes(32).toString('base64url');
let auth=openAuthStore(config);let app;let browser;let origin;
try{
 const owner=await auth.createInitialAdmin('personal-smoke',password);const invite=auth.createInvitation(owner.id,Date.now()+600000);const listener=await auth.acceptInvitation(invite.token,'personal-listener',password);
 const a=auth.createSession(owner);const b=auth.createSession(listener);
 const start=async()=>{app=await createApp(config,{authStore:auth});await app.listen({host:'127.0.0.1',port:0});origin=`http://127.0.0.1:${app.server.address().port}`;};
 await start();
 const api=async(path,input,session=a)=>{const response=await fetch(`${origin}${config.basePath}api/${path}`,{signal:AbortSignal.timeout(30000),headers:{cookie:`freeqify_session=${session.token}`,...(input===undefined?{}:{origin,'content-type':'application/json','x-csrf-token':session.csrf})},...(input===undefined?{}:{method:'POST',body:JSON.stringify(input)})});return{status:response.status,data:await response.json()};};
 const tracks=(await api('library/tracks?limit=100')).data.items;assert.ok(tracks.length>=2);const song=tracks.find(t=>t.format==='mp3')??tracks[0];
 const id=(await api('personal/playlists',{name:'Persistent mix'})).data.id;
 for(const track of [song,tracks.find(t=>t.id!==song.id),song])assert.equal((await api(`personal/playlists/${id}/tracks`,{source:'local',trackId:track.id})).status,200);
 assert.equal((await api('personal/favorites',{source:'local',trackId:song.id,enabled:true})).status,200);
 assert.equal((await api('personal/history',{source:'local',trackId:song.id,eventId:'integration-event',generation:0,listened:30,position:35})).status,200);
 const detail=(await api(`personal/playlists/${id}`)).data;assert.equal(detail.items.length,3);assert.equal(detail.items[0].trackId,song.id);assert.equal(detail.items[2].trackId,song.id);
 assert.equal((await api(`personal/playlists/${id}`,undefined,b)).status,404);assert.equal((await api('personal/favorites',undefined,b)).data.items.length,0);assert.equal((await api('personal/history',undefined,b)).data.items.length,0);
 const reversed=detail.items.map(e=>e.id).reverse();assert.equal((await api(`personal/playlists/${id}/reorder`,{entries:reversed,revision:detail.playlist.revision})).status,200);
 await app.close();app=undefined;auth=openAuthStore(config);await start();
 assert.equal((await api(`personal/playlists/${id}`)).data.items.length,3);assert.equal((await api('personal/favorites')).data.items[0].trackId,song.id);assert.equal((await api('personal/history')).data.items[0].position,35);assert.equal((await api('auth/me')).status,200);
 console.log(`PASS ${config.basePath}: real catalog references, playlist duplicates/order, favorites/history persistence after restart, preserved sessions and listener isolation`);
 if(process.env.FREEQIFY_PLAYWRIGHT_MODULE){
  const {chromium}=await import(pathToFileURL(process.env.FREEQIFY_PLAYWRIGHT_MODULE).href);browser=await chromium.launch({executablePath:process.env.FREEQIFY_CHROME_BINARY||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});const context=await browser.newContext();const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.addCookies([{name:'freeqify_session',value:a.token,domain:'127.0.0.1',path:config.basePath,httpOnly:true,sameSite:'Lax'}]);await page.goto(origin+config.basePath);
  const nav=(name)=>page.locator('.sidebar-nav').getByRole('button',{name,exact:true});
  await nav('Playlists').click();await page.getByRole('button',{name:/Persistent mix/}).click();await page.getByRole('button',{name:'Play all',exact:true}).click();
  await page.waitForFunction(()=>{const a=document.querySelector('audio');return a&&!a.paused&&a.currentTime>0.5;});const audio=await page.locator('audio').elementHandle();assert.equal(await page.locator('audio').count(),1);
  const collection=page.locator('.personal-library');await collection.getByLabel('Playlist name').fill('Renamed mix');await collection.getByRole('button',{name:'Rename playlist'}).click();await collection.getByRole('heading',{name:'Renamed mix'}).waitFor();assert.equal(await audio.evaluate(a=>a===document.querySelector('audio')&&!a.paused),true);
  await page.screenshot({path:'/tmp/freeqify-p4-playlist-desktop.png',fullPage:true});await collection.getByRole('button',{name:'Shuffle play'}).click();await page.waitForFunction(()=>document.querySelector('button[aria-label="Shuffle"]')?.getAttribute('aria-pressed')==='true');assert.equal(await page.getByRole('button',{name:'Shuffle',exact:true}).getAttribute('aria-pressed'),'true');await collection.getByRole('button',{name:'Add all to queue'}).click();await page.getByRole('button',{name:'Queue (6)'}).waitFor();
  await collection.getByRole('button',{name:/Move .* down/}).first().click();await page.waitForTimeout(500);await collection.getByRole('button',{name:/Remove .* from playlist/}).first().click();await page.waitForTimeout(500);assert.equal((await api(`personal/playlists/${id}`)).data.items.length,2);
  await nav('Tracks').click();await page.locator('.track-list').getByRole('button',{name:song.title,exact:true}).first().click();
  await page.waitForFunction(()=>document.querySelector('audio').currentTime>0.3);
  const songRow=page.locator('.track-list tr').filter({has:page.getByRole('button',{name:song.title,exact:true})}).first();
  await songRow.getByRole('button',{name:`Add ${song.title} to playlist`,exact:true}).click();const dialog=page.getByRole('dialog');await dialog.waitFor();await page.setViewportSize({width:390,height:850});await page.screenshot({path:'/tmp/freeqify-p4-dialog-mobile.png',fullPage:false});await page.setViewportSize({width:1280,height:850});await dialog.getByRole('combobox').selectOption('new');await dialog.getByLabel('New playlist name').fill('Created from song');await dialog.getByRole('button',{name:'Add song'}).click();await dialog.waitFor({state:'hidden'});
  await nav('Artists').click();await page.locator('.library-card').first().click();await page.getByRole('button',{name:'Show artist tracks'}).click();await page.locator('.track-list').waitFor();assert.ok(await page.locator('.track-list').getByRole('button',{name:/Add .* to playlist/}).count());
  await nav('Favorites').click();await page.locator('.personal-tracks').waitFor();assert.ok(await page.getByRole('button',{name:`Unfavorite ${song.title}`,exact:true}).count());
  // The actual track, rather than a fabricated timer/event, must reach the public threshold.
  await page.waitForTimeout(32000);const history=await api('personal/history');assert.ok(history.data.items.length);assert.ok(auth.db.prepare("SELECT count(*) AS n FROM personal_history WHERE user_id=? AND event_id<>'integration-event'").get(owner.id).n>=1);
  await nav('Recently played').click();const resumePosition=(await api('personal/history')).data.items[0].position;await page.getByRole('button',{name:'Resume',exact:true}).first().click();await page.waitForFunction(expected=>{const audio=document.querySelector('audio');return !audio.paused&&audio.currentTime>=Math.max(0,expected-2);},resumePosition);assert.equal(await page.locator('audio').count(),1);
  await page.getByRole('button',{name:'Clear listening history',exact:true}).click();await page.getByRole('button',{name:'Confirm clear'}).click();await page.getByText(/You haven't played any songs yet/).waitFor();assert.equal((await api('personal/history')).data.items.length,0);
  await nav('Playlists').click();await page.getByRole('button',{name:/Created from song/}).click();await page.getByRole('button',{name:'Delete playlist',exact:true}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.ok(await page.getByRole('heading',{name:'Created from song'}).isVisible());await page.getByRole('button',{name:'Delete playlist',exact:true}).click();await page.getByRole('button',{name:'Confirm delete',exact:true}).click();await page.getByRole('button',{name:/Renamed mix/}).waitFor();
  await page.reload();await nav('Playlists').click();await page.getByRole('button',{name:/Renamed mix/}).waitFor();
  for(const width of [320,390,760,1280]){await page.setViewportSize({width,height:850});if(width<=760)await page.getByRole('navigation',{name:'Music library'}).getByRole('button',{name:'Favorites',exact:true}).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`overflow at ${width}`);}
  await page.setViewportSize({width:1280,height:850});await page.getByText('personal-smoke',{exact:false}).first().click();await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByRole('button',{name:'Sign in',exact:true}).waitFor();assert.equal(await page.locator('audio').count(),0);
  await context.addCookies([{name:'freeqify_session',value:b.token,domain:'127.0.0.1',path:config.basePath,httpOnly:true,sameSite:'Lax'}]);await page.reload();await nav('Playlists').click();await page.getByText(/You haven't created any playlists yet/).waitFor();await nav('Favorites').click();await page.getByText(/No favorite songs yet/).waitFor();assert.deepEqual(errors,[]);
  console.log(`PASS ${config.basePath}: Chromium playlist CRUD/order/play/shuffle/enqueue, track/artist actions, real playback history threshold/clear/resume, mobile widths, reload, logout/user isolation, one persistent audio element`);await context.close();
 }
}finally{await browser?.close();await app?.close();await rm(directory,{recursive:true,force:true});}
