import {it,expect,afterEach,vi} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {createApp} from './app.js';
import {readConfig} from './config.js';
import {AuthStore} from './auth/store.js';
const cleanups:(()=>Promise<unknown>)[]=[];
afterEach(async()=>{for(const fn of cleanups.splice(0).reverse())await fn();});
const env={NODE_ENV:'production',DEPLOYMENT_MODE:'proxy',PUBLIC_ORIGIN:'https://music.example.test',TRUSTED_PROXY_PEER:'127.0.0.1'};
const headers={host:'music.example.test','x-forwarded-for':'192.0.2.8','x-forwarded-proto':'https'};
async function fixture(base='/'){
 const dir=await mkdtemp('/tmp/freeqify-proxy-');cleanups.push(()=>rm(dir,{recursive:true,force:true}));await writeFile(dir+'/index.html',`<meta content="${base}">`);
 const config=readConfig({...env,BASE_PATH:base,WEB_DIST_DIR:dir});const store=new AuthStore(':memory:',config.auth);const app=await createApp(config,{authStore:store});cleanups.push(()=>app.close());return {app,store};
}
it.each(['http://music.example.test','https://music.example.test/','https://music.example.test/path','https://user@music.example.test','https://music.example.test.'])('rejects ambiguous origin %s',PUBLIC_ORIGIN=>expect(()=>readConfig({...env,PUBLIC_ORIGIN})).toThrow());
it.each([{TRUSTED_PROXY_PEER:'0.0.0.0/0'},{AUTH_SECURE_COOKIES:'false'},{NODE_ENV:'development'},{DEPLOYMENT_MODE:'local'},{DEPLOYMENT_MODE:'unknown'}])('fails closed for unsafe proxy config %#',override=>expect(()=>readConfig({...env,...override})).toThrow());
it.each(['/','/freeqify/'])('enforces exact proxy contract, cookies and CSRF under %s',async base=>{
 const {app}=await fixture(base);const url=base+'api/auth/session';
 const r=await app.inject({url,headers});expect(r.statusCode).toBe(200);expect(r.headers['set-cookie']).toContain('; Secure');expect(r.headers['set-cookie']).toContain(`Path=${base};`);expect(r.headers['cache-control']).toBe('no-store');
 const cookie=String(r.headers['set-cookie']).split(';')[0]!;
 const valid={...headers,origin:env.PUBLIC_ORIGIN,cookie,'x-csrf-token':r.json().csrf};
 const logout=await app.inject({method:'POST',url:base+'api/auth/logout',headers:valid,payload:{}});expect(logout.statusCode).toBe(200);
 const managed=await app.inject({url,headers:{...headers,'x-forwarded-host':'music.example.test'}});
 expect(managed.statusCode).toBe(200);expect(managed.headers['set-cookie']).toContain('; Secure');
 for(const override of [{host:'localhost'},{origin:'https://evil.test'},{'x-forwarded-proto':'http'},{'x-forwarded-for':'192.0.2.8, 127.0.0.1'},{'x-forwarded-for':'not-an-ip'},{forwarded:'for=192.0.2.8'},{'x-forwarded-host':'evil.test'},{'x-forwarded-host':'music.example.test, evil.test'},{'x-forwarded-host':'music.example.test:443'},{'sec-fetch-site':'cross-site'}])expect((await app.inject({url,headers:{...headers,...override}})).statusCode).toBe(403);
 expect((await app.inject({url,headers,remoteAddress:'192.0.2.9'})).statusCode).toBe(403);
 expect((await app.inject(url)).statusCode).toBe(403);
 for(const suffix of ['.env','backup.zip','api/missing','missing.js'])expect((await app.inject({url:base+suffix,headers})).statusCode).toBe(404);
});
it('keeps rate limits distinct for validated proxy client IPs',async()=>{
 const {app,store}=await fixture();store.limit('anonymous:192.0.2.8',1,3600000);
 // Existing bootstrap uses 120 per client. Exhaust only a disposable address.
 for(let i=0;i<119;i++)store.limit('anonymous:192.0.2.8',120,3600000);
 expect((await app.inject({url:'/api/auth/session',headers})).statusCode).toBe(429);
 expect((await app.inject({url:'/api/auth/session',headers:{...headers,'x-forwarded-for':'192.0.2.9'}})).statusCode).toBe(200);
});
it.each(['/','/freeqify/'])('allows installed/external public shell navigation at %s without granting cross-site API access',async base=>{
 const {app}=await fixture(base);
 const launch={...headers,'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document','sec-fetch-user':'?1',referer:'android-app://org.chromium.webapk.fixture/'};
 for(const suffix of ['','index.html'])for(const method of ['GET','HEAD'] as const)for(const dest of ['document','empty']){
  const response=await app.inject({method,url:base+suffix,headers:{...launch,'sec-fetch-dest':dest}});
  expect(response.statusCode).toBe(200);expect(response.headers['content-type']).toContain('text/html');
  expect(response.headers.vary).toContain('Sec-Fetch-Site');expect(response.headers['cache-control']).toBe('no-cache');
  expect(response.headers['set-cookie']).toBeUndefined();
 }
 for(const suffix of ['api/auth/session','api/library/overview','api/library/stream/song','api/personal/summary','api/admin/users','manifest.webmanifest','sw.js','.env','other']){
  const response=await app.inject({url:base+suffix,headers:{...launch,'sec-fetch-dest':'empty'}});// Personal routes also enforce their final active-session serialization guard.
  expect(response.statusCode,suffix).toBe(suffix==='api/personal/summary'?401:403);expect(response.headers['cache-control']).toBe('no-store');
 }
 for(const override of [
  {'sec-fetch-mode':'cors'}, {'sec-fetch-mode':'no-cors'}, {'sec-fetch-mode':undefined},
  {'sec-fetch-dest':'iframe'}, {'sec-fetch-dest':'empty','sec-fetch-mode':'cors'}, {'sec-fetch-dest':'object'}, {'sec-fetch-dest':undefined},
  {origin:'null'}, {origin:'https://evil.test'}, {host:'evil.test'}, {'x-forwarded-host':'evil.test'},
  {'x-forwarded-proto':'http'}, {'x-forwarded-for':'192.0.2.8, 127.0.0.1'}, {forwarded:'for=192.0.2.8'},
 ])expect((await app.inject({url:base,headers:Object.fromEntries(Object.entries({...launch,...override}).filter(([,value])=>value!==undefined))})).statusCode).toBe(403);
 expect((await app.inject({method:'POST',url:base,headers:launch,payload:{}})).statusCode).toBe(403);
 expect((await app.inject({url:base,headers:launch,remoteAddress:'192.0.2.9'})).statusCode).toBe(403);
 // Ordinary browser/mobile same-origin requests continue to require a real session.
 for(const site of ['same-origin','none',undefined]){
  expect((await app.inject({url:base,headers:site?{...headers,'sec-fetch-site':site}:headers})).statusCode).toBe(200);
  expect((await app.inject({url:base+'api/library/overview',headers:site?{...headers,'sec-fetch-site':site}:headers})).statusCode).toBe(401);
 }
 const localConfig=readConfig({NODE_ENV:'production',BASE_PATH:base});
 // Actual loopback defaults must still reject a launcher-shaped cross-site request.
 const localDir=await mkdtemp('/tmp/freeqify-local-launch-');cleanups.push(()=>rm(localDir,{recursive:true,force:true}));await writeFile(localDir+'/index.html',`<meta content="${base}">`);
 const config={...localConfig,webDistDir:localDir};const store=new AuthStore(':memory:',config.auth);const local=await createApp(config,{authStore:store});cleanups.push(()=>local.close());
 expect((await local.inject({url:base,headers:{host:'localhost',...{'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document'}}})).statusCode).toBe(403);
 expect((await local.inject({url:base,headers:{host:'localhost'},remoteAddress:'192.0.2.9'})).statusCode).toBe(403);
});

it('records only bounded launch metadata, never sensitive headers or URLs',async()=>{
 const {app}=await fixture();const log=vi.spyOn(app.log,'info');
 const launch={...headers,'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document','sec-fetch-user':'?1',origin:'https://private-origin-canary.test',cookie:'private-cookie-canary',authorization:'Bearer private-token-canary'};
 for(let i=0;i<12;i++)expect((await app.inject({url:'/?private-query-canary=1',headers:launch})).statusCode).toBe(403);
 const records=log.mock.calls.filter(call=>typeof call[0]==='object'&&call[0]!==null&&'event' in call[0]&&call[0].event==='public-shell-access').map(call=>call[0]);
 expect(records).toHaveLength(10);expect(records[0]).toMatchObject({allowed:false,fetchSite:'cross-site',fetchMode:'navigate',fetchDest:'document',fetchUser:'?1',origin:'other',hostMatches:true,proxyPeerMatches:true,forwardedClientValid:true,forwardedHTTPS:true,forwardedHostMatches:true,hasForwarded:false});
 expect(JSON.stringify(records)).not.toContain('canary');log.mockRestore();
});
