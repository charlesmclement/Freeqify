import {expect,it} from 'vitest';
import {runInNewContext} from 'node:vm';
import {pwaWorker} from './pwa-worker.js';
it('only intercepts exact public files or the shell, bypassing APIs, private media, ranges and mutations',()=>{
 const events:Record<string,(event:unknown)=>void>={};
 runInNewContext(pwaWorker(['index.html','assets/main-12345678.js'],'test'),{URL,Request,self:{location:{href:'https://music.test/freeqify/sw.js'},addEventListener:(name:string,fn:(event:unknown)=>void)=>events[name]=fn}});
 const intercept=(path:string,method='GET',range=false,mode='cors')=>{let handled=false;events.fetch!({request:{url:`https://music.test${path}`,method,mode,headers:{has:()=>range}},respondWith:()=>{handled=true;}});return handled;};
 // The worker must not even call respondWith for private or unknown requests.
 for(const path of ['/freeqify/api/media/song','/freeqify/api/auth/session','/freeqify/api/library/search','/other/','/freeqify/assets/unknown.js'])expect(intercept(path)).toBe(false);
 expect(intercept('/freeqify/assets/main-12345678.js','GET',true)).toBe(false);
 expect(intercept('/freeqify/assets/main-12345678.js','POST')).toBe(false);
 expect(pwaWorker([], 'test')).not.toMatch(/skipWaiting\(|clients\.claim\(|location\.reload/);
});
it('precaches public files without credentials and cleans only obsolete caches for its prefix',async()=>{
 const events:Record<string,(event:unknown)=>void>={};const stored:Request[]=[];const deleted:string[]=[];
 const cache={addAll:async(requests:Request[])=>{stored.push(...requests);},match:async()=>new Response('public')};
 const caches={open:async()=>cache,keys:async()=>['freeqify-shell:/music/:old','freeqify-shell:/other/:old','unrelated'],delete:async(key:string)=>{deleted.push(key);}};
 runInNewContext(pwaWorker(['index.html','assets/main-12345678.js'],'new'),{URL,Request,caches,fetch:async()=>new Response('network'),self:{location:{href:'https://music.test/music/sw.js'},addEventListener:(name:string,fn:(event:unknown)=>void)=>events[name]=fn}});
 let work:Promise<unknown>|undefined;
 events.install!({waitUntil:(promise:Promise<unknown>)=>{work=promise;}});await work;
 expect(stored.map(request=>request.url)).toEqual(['https://music.test/music/index.html','https://music.test/music/assets/main-12345678.js']);expect(stored.every(request=>request.credentials==='omit')).toBe(true);
 events.activate!({waitUntil:(promise:Promise<unknown>)=>{work=promise;}});await work;
 expect(deleted).toEqual(['freeqify-shell:/music/:old']);
 let response:Promise<Response>|undefined;
 events.fetch!({request:new Request('https://music.test/music/assets/main-12345678.js'),respondWith:(promise:Promise<Response>)=>{response=promise;}});
 expect(await(await response)!.text()).toBe('public');
});
it('falls back to the installed public shell when navigation fails or the server returns an error',async()=>{
 for(const network of [async()=>{throw new TypeError('Offline');},async()=>new Response('Unavailable',{status:503})]){
  const events:Record<string,(event:unknown)=>void>={};const caches={open:async()=>({match:async()=>new Response('installed shell')})};
  runInNewContext(pwaWorker(['index.html'],'v'),{URL,Request,caches,fetch:network,self:{location:{href:'https://music.test/music/sw.js'},addEventListener:(name:string,fn:(event:unknown)=>void)=>events[name]=fn}});
  let response:Promise<Response>|undefined;events.fetch!({request:{url:'https://music.test/music/',method:'GET',mode:'navigate',headers:{has:()=>false}},respondWith:(value:Promise<Response>)=>{response=value;}});expect(await(await response)!.text()).toBe('installed shell');
 }
});
