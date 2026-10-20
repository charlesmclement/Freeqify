/** Disposable TLS proxy, generated certificate/accounts/media. Never loads operator config. */
import assert from 'node:assert/strict';
import {createServer as httpsServer,request as httpsRequest} from 'node:https';
import {request as httpRequest,createServer as httpServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {createApp} from '../apps/server/dist/app.js';
import {readConfig} from '../apps/server/dist/config.js';
import {AuthStore} from '../apps/server/dist/auth/store.js';
const base=process.env.FREEQIFY_SMOKE_BASE||'/';
const root=await mkdtemp('/tmp/freeqify-proxy-smoke-');let app,proxy,browser,external;const documentRequests=[];
try{
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',root+'/key','-out',root+'/cert','-days','1','-subj','/CN=localhost'],{stdio:'ignore'});
 proxy=httpsServer({key:await readFile(root+'/key'),cert:await readFile(root+'/cert')});await new Promise(ok=>proxy.listen(0,'127.0.0.1',ok));
 const origin=`https://127.0.0.1:${proxy.address().port}`;await writeFile(root+'/index.html',`<meta content="${base}">`);await writeFile(root+'/sw.js',"self.addEventListener('fetch',e=>{if(e.request.mode==='navigate')e.respondWith(fetch(e.request));});");
 const c=readConfig({NODE_ENV:'production',DEPLOYMENT_MODE:'proxy',PUBLIC_ORIGIN:origin,TRUSTED_PROXY_PEER:'127.0.0.1',WEB_DIST_DIR:root,BASE_PATH:base});
 const store=new AuthStore(':memory:',c.auth);const user=await store.createInitialAdmin('proxy-owner','iris cobalt forest nebula');const session=store.createSession(user);const cookie=`${base==='/'?'__Host-freeqify_session':'freeqify_session'}=${session.token}`;
 let cancelled=false;
 const audio=Buffer.alloc(4096,7);
 const library={stream:async(id,_format,range)=>{
  if(id==='slow')return new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(4096));},cancel(){cancelled=true;}}),{headers:{'content-type':'audio/wav'}});
  const match=range&&/^bytes=(\d+)-(\d+)$/.exec(range);const start=match?Number(match[1]):0,end=match?Number(match[2]):audio.length-1;
  return new Response(audio.subarray(start,end+1),{status:match?206:200,headers:{'content-type':'audio/wav','content-length':String(end-start+1),'accept-ranges':'bytes',...(match?{'content-range':`bytes ${start}-${end}/${audio.length}`}:{})}});
 }};
 app=await createApp(c,{authStore:store,library});await app.listen({host:'127.0.0.1',port:0});const backend=app.server.address().port;
 proxy.on('request',(req,res)=>{
  if(req.url===base)documentRequests.push({...req.headers});
  const headers={...req.headers,'x-forwarded-for':req.socket.remoteAddress,'x-forwarded-proto':'https'};delete headers.forwarded;delete headers['x-forwarded-host'];
  const upstream=httpRequest({host:'127.0.0.1',port:backend,path:req.url,method:req.method,headers},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
  upstream.on('error',()=>res.destroy());res.on('close',()=>upstream.destroy());req.pipe(upstream);
 });
 const get=(path,headers={},method='GET')=>new Promise((ok,no)=>{const req=httpsRequest(origin+base+path,{rejectUnauthorized:false,headers,method},res=>{const bytes=[];res.on('data',b=>bytes.push(b));res.on('end',()=>ok({status:res.statusCode,headers:res.headers,body:Buffer.concat(bytes)}));});req.on('error',no);req.end();});
 assert.equal((await get('api/health')).status,200);
 const launch={'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document','sec-fetch-user':'?1'};
 assert.equal((await get('',launch)).status,200);
 assert.equal((await get('index.html',launch)).status,200);
 assert.equal((await get('api/health',launch)).status,403);
 assert.equal((await get('api/library/stream/song',{...launch,cookie})).status,403);
 assert.equal((await get('',{...launch,'sec-fetch-dest':'iframe'})).status,403);
 assert.equal((await get('',{...launch,origin:'https://evil.test'})).status,403);

 const anon=await get('api/auth/session');assert.match(anon.headers['set-cookie'][0],/; Secure/);assert.equal(anon.headers['cache-control'],'no-store');
 const head=await get('api/library/stream/song',{cookie},'HEAD');assert.equal(head.status,200);assert.equal(head.body.length,0);
 const range=await get('api/library/stream/song',{cookie,range:'bytes=100-199'});assert.equal(range.status,206);assert.equal(range.body.length,100);assert.equal(range.headers['content-range'],'bytes 100-199/4096');assert.equal(range.headers['cache-control'],'no-store');
 assert.equal((await get('api/health',{host:'hostile.test'})).status,403);assert.equal((await get('api/health',{origin:'https://hostile.test'})).status,403);
 // Caller forwarding is overwritten by the trusted fixture; direct malformed chains fail.
 assert.equal((await app.inject({url:base+'api/health',headers:{host:new URL(origin).host,'x-forwarded-for':'1.2.3.4, 5.6.7.8','x-forwarded-proto':'https'}})).statusCode,403);
 await new Promise((ok,no)=>{const req=httpsRequest(origin+base+'api/library/stream/slow',{rejectUnauthorized:false,headers:{cookie}},res=>{res.once('data',()=>{res.destroy();req.destroy();ok();});});req.on('error',e=>{if(e.code!=='ECONNRESET')no(e);});req.end();});
 for(let i=0;i<30&&!cancelled;i++)await new Promise(ok=>setTimeout(ok,50));assert.equal(cancelled,true);
 for(const path of ['.env','api/missing','missing.js','freeqify.sqlite'])assert.equal((await get(path)).status,404);
 if(process.env.FREEQIFY_PROXY_BROWSER==='1'){
  const {chromium}=await import(process.env.FREEQIFY_PLAYWRIGHT_MODULE||'playwright-core');
  browser=await chromium.launch({executablePath:process.env.FREEQIFY_CHROME||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
  external=httpServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end(`<a href="${origin}${base}">Open Freeqify</a>`);});
  await new Promise(ok=>external.listen(0,'127.0.0.1',ok));
  for(const mobile of [false,true]){
   const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:mobile?{width:390,height:844}:{width:1280,height:900},isMobile:mobile});
   const page=await context.newPage();await page.goto(`http://localhost:${external.address().port}`);
   await page.getByRole('link',{name:'Open Freeqify'}).click();
   assert.equal(page.url(),origin+base);assert.match(await page.content(),new RegExp(`content="${base}"`));
   const launchRequest=documentRequests.at(-1);
   assert.equal(launchRequest['sec-fetch-site'],'cross-site');assert.equal(launchRequest['sec-fetch-mode'],'navigate');assert.equal(launchRequest['sec-fetch-dest'],'document');
   assert.equal(await page.evaluate(async path=>(await fetch(path+'api/auth/session')).status,base),200);
   assert.equal(await page.evaluate(async path=>(await fetch(path+'api/library/overview')).status,base),401);
   assert.equal(await page.evaluate(async path=>(await fetch(path+'api/auth/logout',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,base),403);
   await page.evaluate(async path=>{await navigator.serviceWorker.register(path+'sw.js',{scope:path});await navigator.serviceWorker.ready;},base);
   await page.reload();await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);
   await page.goto(`http://localhost:${external.address().port}`);await page.getByRole('link',{name:'Open Freeqify'}).click();
   assert.match(await page.content(),new RegExp(`content="${base}"`));
   assert.equal(documentRequests.at(-1)['sec-fetch-mode'],'navigate');
   assert.equal(documentRequests.at(-1)['sec-fetch-dest'],'empty');
   assert.equal(await page.evaluate(async path=>(await fetch(path+'api/library/overview')).status,base),401);
   await context.close();
  }
  console.log(`PASS real Chromium desktop/mobile external document launch ${base}: actual cross-site navigation headers accepted for public shell, same-origin bootstrap works, private library and CSRF remain protected.`);
 }
 console.log(`PASS isolated TLS proxy ${base}: exact Host/Origin, Secure cookies, no-store, root/prefix, HEAD/range/seek bytes, cancellation, forwarding rejection and private files.`);
}finally{await browser?.close();if(external){external.closeAllConnections();await new Promise(ok=>external.close(ok));}await app?.close();if(proxy){proxy.closeAllConnections();await new Promise(ok=>proxy.close(ok));}await rm(root,{recursive:true,force:true});}
