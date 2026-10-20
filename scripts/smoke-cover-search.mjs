/** Isolated production browser review. Synthetic catalog/providers; no operator config or music. */
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readConfig} from '../apps/server/dist/config.js';
import {AuthStore} from '../apps/server/dist/auth/store.js';
import {createApp} from '../apps/server/dist/app.js';
import {LibraryError} from '../apps/server/dist/integrations/navidrome.js';
if(!process.env.FREEQIFY_PLAYWRIGHT_MODULE)throw new Error('Set FREEQIFY_PLAYWRIGHT_MODULE to an installed playwright-core index.mjs.');
const {chromium}=await import(pathToFileURL(process.env.FREEQIFY_PLAYWRIGHT_MODULE).href);
const temporary=await mkdtemp(join(tmpdir(),'freeqify-cover-search-'));
const base=process.env.FREEQIFY_SMOKE_BASE||'/';
const output=process.env.FREEQIFY_SCREENSHOT_DIR;
if(output)await mkdir(output,{recursive:true});
const config=readConfig({BASE_PATH:base,WEB_DIST_DIR:process.env.FREEQIFY_SMOKE_DIST||'./apps/web/dist',AUTH_SECURE_COOKIES:'false',MUSICBRAINZ_CONTACT:'mailto:fixture@example.invalid'});
const auth=new AuthStore(join(temporary,'synthetic.sqlite'),config.auth);
const admin={id:'admin-fixture',username:'cover-admin',role:'admin',status:'active',createdAt:1};
const listener={id:'listener-fixture',username:'cover-listener',role:'listener',status:'active',createdAt:1};
for(const user of [admin,listener])auth.db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(user.id,user.username,'unused-fixture-hash',user.role,user.status,1);
const session=auth.createSession(admin),listenerSession=auth.createSession(listener);
const album={id:'fixture_album',title:'Cover Search Review',artist:'Synthetic Artist',artistId:null,artworkId:null,trackCount:1,year:2026};
const track={id:'fixture_song',title:'Synthetic Song',artist:album.artist,album:album.title,albumId:album.id,artworkId:null,duration:60,format:'mp3',trackNumber:1};
const library={ping:async()=>{},overview:async()=>({artists:1,albums:1,tracks:1,scanning:false}),artists:async()=>[],albums:async()=>({items:[album],nextOffset:null}),album:async()=>({album,tracks:[track]}),tracks:async()=>({items:[track],nextOffset:null}),track:async()=>track,search:async()=>({artists:[],albums:[album],tracks:[track]}),artwork:async()=>{throw new LibraryError('NOT_FOUND');}};
const picture=await readFile(new URL('../apps/web/public/freeqify-covers/generic_07_vinyl_warmth.jpg',import.meta.url));
const originalFetch=globalThis.fetch;
// Stub the server's external transports, preserving real same-origin browser traffic.
globalThis.fetch=async input=>{
 const url=new URL(String(input));
 if(url.hostname==='musicbrainz.org')return Response.json({'release-groups':[{id:'48140466-cff6-3222-bd55-63c27e43190d',title:'Cover Search Review',score:100,'artist-credit':[{name:'Synthetic Artist'}],'first-release-date':'2026-01-01'}]});
 if(url.hostname==='coverartarchive.org')return new Response(picture,{headers:{'content-type':'image/jpeg'}});
 throw new Error('Unexpected synthetic provider request.');
};
let app,browser;
try{
 app=await createApp(config,{authStore:auth,library});await app.listen({host:'127.0.0.1',port:0});const origin=`http://127.0.0.1:${app.server.address().port}`;
 for(const path of ['api/missing','assets/missing.js','.env','freeqify.sqlite','../.env'])assert.notEqual((await originalFetch(origin+base+path)).status,200);
 browser=await chromium.launch({executablePath:process.env.FREEQIFY_CHROME_BINARY||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:390,height:844}});
 await context.addCookies([{name:'freeqify_session',value:session.token,domain:'127.0.0.1',path:base,httpOnly:true,sameSite:'Lax'}]);
 const page=await context.newPage();const errors=[];const external=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(new URL(request.url()).origin!==origin)external.push(request.url());});
 await page.goto(origin+base);await page.getByRole('navigation',{name:'Mobile navigation'}).getByRole('button',{name:'Library',exact:true}).click();
 await page.locator('.album-list .album-card').filter({hasText:'Cover Search Review'}).click();await page.getByRole('button',{name:'Edit artwork',exact:true}).click();
 const search=page.getByRole('button',{name:'Search for cover',exact:true});await search.click();
 await page.getByRole('button',{name:'Cover Search Review Synthetic Artist · 2026'}).click();
 const save=page.getByRole('button',{name:'Use this cover for everyone'});await save.waitFor();
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Use this cover for everyone'&&!b.disabled));
 for(const width of [320,390,740,1440]){
  await page.setViewportSize({width,height:width===740?440:900});await save.scrollIntoViewIfNeeded();
  const metrics=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,controls:[...document.querySelectorAll('.shared-cover-search input,.shared-cover-search button,.cover-search-preview img')].map(e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right}))}));
  assert(metrics.scroll<=width+1,`Page overflow at ${width}: ${metrics.scroll}`);
  for(const box of metrics.controls)assert(box.left>=-1&&box.right<=width+1,`Cover controls overflow at ${width}: ${JSON.stringify(box)}`);
  if(output&&(width===390||width===1440))await page.screenshot({path:join(output,width===390?'mobile.png':'desktop.png'),fullPage:true});
 }
 await save.click();await page.getByText('Cover saved for everyone.',{exact:true}).waitFor();
 const image=await originalFetch(`${origin}${base}api/library/artwork/album/${album.id}`,{headers:{cookie:`freeqify_session=${listenerSession.token}`}});
 assert.equal(image.status,200);assert.deepEqual(Buffer.from(await image.arrayBuffer()),picture);
 await page.getByRole('button',{name:'Remove shared cover'}).click();await page.getByText('Shared cover removed. Previous artwork choices are restored.',{exact:true}).waitFor();
 const listenerContext=await browser.newContext({viewport:{width:390,height:844}});
 await listenerContext.addCookies([{name:'freeqify_session',value:listenerSession.token,domain:'127.0.0.1',path:base,httpOnly:true,sameSite:'Lax'}]);
 const listenerPage=await listenerContext.newPage();await listenerPage.goto(origin+base);
 await listenerPage.getByRole('navigation',{name:'Mobile navigation'}).getByRole('button',{name:'Library',exact:true}).click();
 await listenerPage.locator('.album-list .album-card').filter({hasText:'Cover Search Review'}).click();await listenerPage.getByRole('button',{name:'Edit artwork',exact:true}).click();
 assert.equal(await listenerPage.getByRole('button',{name:'Search for cover',exact:true}).count(),0);
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 console.log(`PASS ${base}: production mobile/desktop search → preview → save → listener cover → removal; admin-only controls; 320/390/740/1440px layout; missing API/assets and private files; no external browser requests.`);
}finally{
 globalThis.fetch=originalFetch;if(browser)await browser.close();if(app)await app.close();else auth.close();await rm(temporary,{recursive:true,force:true});
}
