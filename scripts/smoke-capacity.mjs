import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadEnvironment} from '../apps/server/dist/environment.js';
import {readConfig} from '../apps/server/dist/config.js';
import {openAuthStore} from '../apps/server/dist/auth/store.js';
import {PersonalStore} from '../apps/server/dist/personal-store.js';
import {createApp} from '../apps/server/dist/app.js';
loadEnvironment();
const directory=await mkdtemp(join(tmpdir(),'freeqify-capacity-'));
const config=readConfig({...process.env,DATA_DIR:join(directory,'accounts'),AUTH_SECURE_COOKIES:'false'});
let auth=openAuthStore(config);let app;let browser;let origin;
async function start(){app=await createApp(config,{authStore:auth});await app.listen({host:'127.0.0.1',port:0});origin=`http://127.0.0.1:${app.server.address().port}`;}
try{
 auth.db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run('capacity-owner','capacity-smoke','test-only-unusable-hash','listener','active',1);
 const session=auth.createSession({id:'capacity-owner',username:'capacity-smoke',role:'listener',status:'active',createdAt:1});
 await start();const headers={cookie:`freeqify_session=${session.token}`};const songs=await(await fetch(`${origin}${config.basePath}api/library/tracks?limit=1`,{headers})).json();assert.equal(songs.items.length,1);const song=songs.items[0];
 let store=new PersonalStore(auth);const id=store.create('capacity-owner','Capacity review fixture');const began=performance.now();
 for(let i=0;i<50;i++){store.addMany('capacity-owner',id,Array.from({length:100},()=>song));store.favoriteMany('capacity-owner',Array.from({length:100},(_,n)=>({...song,id:`capacity-fixture-${i*100+n}`})));}
 const inserted=performance.now();const refs=store.references('capacity-owner',id);assert.equal(refs.length,5000);assert.equal(new Set(refs.map(r=>r.id)).size,5000);
 assert.throws(()=>store.add('capacity-owner',id,song),/5,000/);assert.throws(()=>store.favorite('capacity-owner',song,true),/5,000/);
 const pageTimes=[];for(let i=0;i<100;i++){const t=performance.now();store.entries('capacity-owner',id,4952,48);store.favorites('capacity-owner',4952,48);pageTimes.push(performance.now()-t);}
 console.log(JSON.stringify({basePath:config.basePath,tracks:5000,favorites:5000,insertMilliseconds:Math.round(inserted-began),pagePairAverageMilliseconds:Number((pageTimes.reduce((a,b)=>a+b)/100).toFixed(2)),pagePairMaxMilliseconds:Number(Math.max(...pageTimes).toFixed(2))}));
 await app.close();app=undefined;auth=openAuthStore(config);store=new PersonalStore(auth);await start();assert.deepEqual(store.references('capacity-owner',id),refs);assert.equal(store.favoriteIds('capacity-owner').length,5000);
 if(process.env.FREEQIFY_PLAYWRIGHT_MODULE){
  const {chromium}=await import(pathToFileURL(process.env.FREEQIFY_PLAYWRIGHT_MODULE).href);browser=await chromium.launch({executablePath:process.env.FREEQIFY_CHROME_BINARY||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});const context=await browser.newContext();await context.addCookies([{name:'freeqify_session',value:session.token,domain:'127.0.0.1',path:config.basePath,httpOnly:true,sameSite:'Lax'}]);const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+config.basePath);
  const nav=name=>page.locator('.sidebar-nav').getByRole('button',{name,exact:true});await nav('Playlists').click();await page.getByRole('button',{name:/Capacity review fixture/}).click();await page.locator('.personal-tracks li').first().waitFor();assert.equal(await page.locator('.personal-tracks li').count(),48);
  await page.getByRole('button',{name:'More songs',exact:true}).click();await page.getByRole('button',{name:'Previous songs',exact:true}).waitFor();assert.equal(await page.locator('.personal-tracks li').count(),48);
  await page.getByRole('button',{name:/Move .* up/}).first().click();await page.waitForTimeout(700);assert.equal(store.references('capacity-owner',id)[47].id,refs[48].id);
  await page.getByRole('button',{name:'Play all',exact:true}).click();await page.getByRole('button',{name:'Queue (5000)',exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('audio').paused&&document.querySelector('audio').currentTime>0.3);
  await page.getByRole('button',{name:'Queue (5000)',exact:true}).click();assert.equal(await page.locator('.player-queue li').count(),48);await page.getByRole('button',{name:'Next queue page',exact:true}).click();await page.getByRole('button',{name:'Move track 49 up',exact:true}).waitFor();
  await page.getByRole('button',{name:'Shuffle',exact:true}).click();await page.getByRole('button',{name:'Repeat off',exact:true}).click();await page.waitForTimeout(1600);
  const state=JSON.parse(auth.db.prepare('SELECT state FROM playback_state WHERE user_id=?').get('capacity-owner').state);assert.equal(state.queue.length,5000);assert.equal(new Set(state.order).size,5000);assert.equal(state.shuffle,true);assert.equal(state.repeat,'all');
  await page.getByRole('button',{name:'Pause',exact:true}).click();await page.reload();await page.getByRole('button',{name:'Queue (5000)',exact:true}).waitFor();assert.equal(await page.locator('audio').evaluate(a=>a.paused),true);assert.equal(await page.locator('audio').count(),1);
  await nav('Favorites').click();await page.locator('.personal-tracks li').first().waitFor();assert.equal(await page.locator('.personal-tracks li').count(),48);assert.ok(await page.getByText(/Media missing/).count());await page.getByRole('button',{name:'More songs',exact:true}).click();await page.getByRole('button',{name:'Previous songs',exact:true}).waitFor();assert.equal(await page.locator('.personal-tracks li').count(),48);assert.deepEqual(errors,[]);await context.close();
  console.log(`PASS ${config.basePath}: Chromium 5,000-track queue playback/shuffle/repeat/reload, 48-row views, page-boundary move, missing favorite fixtures and one audio element`);
 }
 console.log(`PASS ${config.basePath}: 5,000 playlist entries and favorites, 5,001 rejection, duplicate order and restart persistence; temporary fixtures only`);
}finally{await browser?.close();if(app)await app.close();else auth.close();await rm(directory,{recursive:true,force:true});}
