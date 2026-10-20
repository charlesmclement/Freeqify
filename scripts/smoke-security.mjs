/** Fully isolated synthetic engine/accounts/media. Never loads operator configuration. */
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readConfig} from '../apps/server/dist/config.js';
import {AuthStore} from '../apps/server/dist/auth/store.js';
import {createApp} from '../apps/server/dist/app.js';
const base=process.env.FREEQIFY_SMOKE_BASE||'/';
const dir=await mkdtemp('/tmp/freeqify-security-smoke-');const file=join(dir,'synthetic.sqlite');
const config=readConfig({BASE_PATH:base,WEB_DIST_DIR:process.env.FREEQIFY_SMOKE_DIST||'./apps/web/dist',AUTH_SECURE_COOKIES:'false'});
const password=randomBytes(32).toString('base64url');const nextPassword=randomBytes(32).toString('base64url');
const marker='<b data-audit="canary">Synthetic music</b>';
const track={id:'synthetic-song',title:marker,artist:marker,album:marker,albumId:'synthetic-album',artworkId:null,duration:3,format:'wav',trackNumber:1};
const audio=Buffer.alloc(44+44100*2*3);audio.write('RIFF');audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(44100,24);audio.writeUInt32LE(88200,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(audio.length-44,40);
const library={ping:async()=>{},overview:async()=>({artists:1,albums:1,tracks:1,scanning:false}),artists:async()=>[],artist:async()=>({artist:{id:'artist',name:marker,albumCount:1,artworkId:null},albums:[]}),albums:async()=>({items:[],nextOffset:null}),album:async()=>({album:{id:'synthetic-album',title:marker,artist:marker,artworkId:null,artistId:null,trackCount:1,year:null},tracks:[track]}),tracks:async()=>({items:[track],nextOffset:null}),track:async()=>track,search:async()=>({artists:[],albums:[],tracks:[track]}),artwork:async()=>{throw new Error('Synthetic art absent');},stream:async(_id,_format,range)=>{
 let start=0,end=audio.length-1,status=200;if(range){const match=/^bytes=(\d+)-(\d*)$/.exec(range);if(match){start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]));status=206;}else{const suffix=/^bytes=-(\d+)$/.exec(range);if(suffix){start=Math.max(0,audio.length-Number(suffix[1]));status=206;}}}
 if(start>=audio.length)return new Response(null,{status:416,headers:{'content-range':`bytes */${audio.length}`}});
 return new Response(audio.subarray(start,end+1),{status,headers:{'content-type':'audio/wav','content-length':String(end-start+1),'accept-ranges':'bytes',...(status===206?{'content-range':`bytes ${start}-${end}/${audio.length}`}:{})}});
}};
let store=new AuthStore(file,config.auth);await store.createInitialAdmin('security-owner',password);let app,origin,browser;
async function start(){app=await createApp(config,{authStore:store,library});await app.listen({host:'127.0.0.1',port:0});origin=`http://127.0.0.1:${app.server.address().port}`;}
function client(){let cookie='',csrf='';return {get cookie(){return cookie;},async request(path,input){const r=await fetch(origin+base+'api/'+path,{headers:{cookie,...(input===undefined?{}:{origin,'x-csrf-token':csrf,'content-type':'application/json'})},...(input===undefined?{}:{method:'POST',body:JSON.stringify(input)})});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];const data=await r.json();if(data.csrf)csrf=data.csrf;return {status:r.status,data};}};}
try{
 await start();const owner=client();await owner.request('auth/session');assert.equal((await owner.request('auth/login',{username:'security-owner',password})).status,200);
 const invite=(await owner.request('admin/invitations',{expiresAt:Date.now()+600000})).data;const listener=client();await listener.request('auth/session');assert.equal((await listener.request('auth/accept-invitation',{token:invite.token,username:'security-listener',password})).status,200);
 const playlist=(await owner.request('personal/playlists',{name:"Synthetic'); SELECT private; -- <b>literal</b>"})).data.id;
 await owner.request(`personal/playlists/${playlist}/bulk`,{tracks:[{source:'local',trackId:track.id},{source:'local',trackId:track.id}]});await owner.request('personal/favorites',{source:'local',trackId:track.id,enabled:true});await owner.request('personal/history',{source:'local',trackId:track.id,eventId:'synthetic-event',listened:2,position:2,generation:0});
 assert.equal((await listener.request(`personal/playlists/${playlist}`)).status,404);assert.equal((await listener.request('admin/users')).status,403);
 for(const path of ['.env','freeqify.sqlite','backup.zip','api/missing','missing.js']){const r=await fetch(origin+base+path);assert.notEqual(r.status,200);}
 const head=await fetch(origin+base+'api/library/stream/'+track.id,{method:'HEAD',headers:{cookie:owner.cookie}});assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
 const ranged=await fetch(origin+base+'api/library/stream/'+track.id,{headers:{cookie:owner.cookie,range:'bytes=0-43'}});assert.equal(ranged.status,206);assert.equal((await ranged.arrayBuffer()).byteLength,44);
 await app.close();store=new AuthStore(file,config.auth);await start();assert.equal((await owner.request(`personal/playlists/${playlist}`)).data.items.length,2);assert.equal((await owner.request('personal/favorites')).data.items.length,1);assert.equal((await owner.request('personal/history')).data.items.length,1);
 if(process.env.FREEQIFY_PLAYWRIGHT_MODULE){
  const {chromium}=await import(pathToFileURL(process.env.FREEQIFY_PLAYWRIGHT_MODULE).href);browser=await chromium.launch({executablePath:process.env.FREEQIFY_CHROME_BINARY||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});const context=await browser.newContext();const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+base);await page.getByLabel('Username',{exact:true}).fill('security-owner');await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.locator('.sidebar-nav').getByRole('button',{name:'Tracks',exact:true}).click();await page.getByRole('button',{name:marker,exact:true}).click();await page.waitForFunction(()=>document.querySelector('audio')?.currentTime>0.05);assert.equal(await page.locator('[data-audit="canary"]').count(),0);
  await page.evaluate(()=>{const a=document.querySelector('audio');a.pause();a.currentTime=1;});await page.waitForFunction(()=>document.querySelector('audio')?.currentTime>=1);await page.locator('.sidebar-nav').getByRole('button',{name:'Playlists',exact:true}).click();assert.equal(await page.locator('audio').count(),1);await page.reload();await page.waitForFunction(()=>document.querySelector('audio')?.paused===true);
  await page.locator('.profile-menu > summary').click();await page.getByText('Change password',{exact:true}).click();await page.getByLabel('Current password',{exact:true}).fill(password);await page.getByLabel('New password',{exact:true}).fill(nextPassword);await page.getByLabel('Confirm new password',{exact:true}).fill(nextPassword);await page.getByRole('button',{name:'Save password and sign out'}).click();await page.getByRole('button',{name:'Sign in',exact:true}).waitFor();assert.equal((await owner.request('auth/me')).status,401);assert.deepEqual(errors,[]);await browser.close();browser=undefined;
  console.log('PASS Chromium: literal metadata, native synthetic WAV playback/seek, one player, paused reload, password-change sign-out.');
 }else console.log('Chromium skipped: configure FREEQIFY_PLAYWRIGHT_MODULE and FREEQIFY_CHROME_BINARY.');
 console.log(`PASS isolated ${base}: invitations, owner/admin isolation, SQL-looking literal names, private files, HEAD/ranges, duplicate playlists/favorites/history and session persistence.`);
}finally{await browser?.close();await app?.close();await rm(dir,{recursive:true,force:true});}
