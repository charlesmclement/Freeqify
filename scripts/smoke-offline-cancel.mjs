/** Isolated native server, temporary users/database and generated audio. No operator config. */
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createApp} from '../apps/server/dist/app.js';
import {readConfig} from '../apps/server/dist/config.js';
import {openAuthStore} from '../apps/server/dist/auth/store.js';
const {chromium}=await import(process.env.FREEQIFY_PLAYWRIGHT_MODULE||'playwright-core');
const base=process.env.FREEQIFY_SMOKE_BASE||'/',temp=await mkdtemp(join(tmpdir(),'freeqify-offline-review-'));
const output=process.env.FREEQIFY_SCREENSHOT_DIR||join(temp,'screenshots');await mkdir(output,{recursive:true});
const config=readConfig({BASE_PATH:base,WEB_DIST_DIR:resolve(process.env.FREEQIFY_SMOKE_WEB||'apps/web/dist'),DATA_DIR:join(temp,'data'),AUTH_SECURE_COOKIES:'false'});
const store=openAuthStore(config),owner=await store.createInitialAdmin('offline-review','generated-local-queue-fixture-passphrase'),session=store.createSession(owner);
const transfers={};
const ids=['A','B','C','D','X','Y','Z'];
const tracks=ids.map((id,index)=>({id,title:`Track ${id}`,artist:'Queue fixture artist',album:id<'X'?'Album Fixture':'Other Fixture',albumId:id<'X'?'album':'other',artworkId:'cover',duration:120,format:'wav',trackNumber:index+1}));
const albums=['album','other'].map((id,index)=>({id,title:index?'Other Fixture':'Album Fixture',artist:'Queue fixture artist',artistId:'artist',artworkId:'cover',trackCount:index?3:4,year:2026}));
const cover=await readFile(resolve(config.webDistDir,'icon-192.png'));
const sr=44100,wav=Buffer.alloc(44+sr*120*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(sr,24);wav.writeUInt32LE(sr*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);for(let i=0;i<sr*120;i++)wav.writeInt16LE(Math.round(Math.sin(i/sr*2*Math.PI*220)*6000),44+i*2);
const library={ping:async()=>{},overview:async()=>({artists:1,albums:2,tracks:7,scanning:false}),artists:async()=>[{id:'artist',name:'Queue fixture artist',albumCount:2,artworkId:'cover'}],artist:async()=>({artist:{id:'artist',name:'Queue fixture artist',albumCount:2,artworkId:'cover'},albums}),albums:async()=>({items:albums,nextOffset:null}),album:async id=>({album:albums.find(a=>a.id===id),tracks:tracks.filter(t=>t.albumId===id)}),tracks:async()=>({items:tracks,nextOffset:null}),track:async id=>{const t=tracks.find(t=>t.id===id);assert.ok(t);return t;},search:async()=>({artists:[],albums,tracks}),artwork:async()=>({contentType:'image/png',bytes:cover}),stream:async(_id,_format,_range,signal)=>{transfers[_id]=(transfers[_id]??0)+1;let offset=0,timer;signal.addEventListener('abort',()=>{globalThis.cancelledDownload=true;});return new Response(new ReadableStream({start(controller){timer=setInterval(()=>{if(offset>=wav.length){clearInterval(timer);controller.close();return;}const end=Math.min(offset+65536,wav.length);controller.enqueue(new Uint8Array(wav.subarray(offset,end)));offset=end;},30);},cancel(){clearInterval(timer);}}),{headers:{'content-type':'audio/wav','content-length':String(wav.length)}});}

};
const app=await createApp(config,{authStore:store,library});let browser;
try{
 await app.listen({host:'127.0.0.1',port:0});const origin=`http://127.0.0.1:${app.server.address().port}`;
 browser=await chromium.launch({executablePath:process.env.FREEQIFY_CHROME||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:390,height:844}});await context.addCookies([{name:'freeqify_session',value:session.token,domain:'127.0.0.1',path:base,httpOnly:true,sameSite:'Lax'}]);const page=await context.newPage();await page.goto(origin+base);await page.getByRole('navigation',{name:'Mobile navigation'}).getByRole('button',{name:'Library',exact:true}).click();await page.getByRole('button',{name:'Album Fixture',exact:false}).first().click();await page.getByRole('button',{name:'Download Album Fixture',exact:true}).click();
 await page.getByRole('button',{name:'Downloaded music',exact:true}).click();await page.getByRole('status').filter({hasText:/Downloading [1-9]/}).waitFor();await page.getByRole('button',{name:'Cancel downloads',exact:true}).click();await page.waitForTimeout(600);
 const states=await page.locator('.offline-tracks .personal-song [role=status]').allTextContents();assert.equal(states.length,4);assert.ok(states.every(t=>t.startsWith('cancelled')));const chunks=await page.evaluate(async()=>{const u=JSON.parse(localStorage.getItem('freeqify-offline:/:identity'));const db=await new Promise(ok=>{const r=indexedDB.open('freeqify-offline:/:'+u.id);r.onsuccess=()=>ok(r.result);});const count=await new Promise(ok=>{const r=db.transaction('chunks').objectStore('chunks').count();r.onsuccess=()=>ok(r.result);});db.close();return count;});assert.equal(chunks,0);assert.ok(globalThis.cancelledDownload);assert.equal(transfers.A,1);assert.equal(transfers.B,undefined);assert.equal(transfers.C,undefined);assert.equal(transfers.D,undefined);console.log('PASS active cancellation: upstream aborted; partial chunks removed; all four selections cancelled; queued tracks not fetched. Synthetic audio only.');
}finally{await browser?.close();await app.close();await rm(temp,{recursive:true,force:true});}
