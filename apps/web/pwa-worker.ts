/** Generate a public-files-only worker. No runtime caching, audio or API handling. */
export function pwaWorker(files:string[],version:string){return `
const base=new URL('./',self.location.href);
const cacheName='freeqify-shell:'+base.pathname+':${version}';
const files=${JSON.stringify(files)}.map(path=>new URL(path,base).href);
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(cacheName).then(cache=>cache.addAll(files.map(url=>new Request(url,{credentials:'omit',cache:'reload'})))));
});
// Normal lifecycle: wait for all old clients to close. Never reload a playing tab.
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('freeqify-shell:'+base.pathname+':')&&key!==cacheName).map(key=>caches.delete(key)))));
});
self.addEventListener('fetch',event=>{
  const request=event.request;
  const url=new URL(request.url);
  if(request.method!=='GET'||request.headers.has('range')||url.origin!==base.origin)return;
  if(request.mode==='navigate'&&url.pathname===base.pathname&&!url.search){
    event.respondWith(fetch(request).then(response=>{if(!response.ok)throw new Error('Server unavailable');return response;}).catch(()=>caches.open(cacheName).then(cache=>cache.match(new URL('index.html',base).href))));return;
  }
  if(!files.includes(url.href)||url.pathname===base.pathname+'index.html')return;
  event.respondWith(caches.open(cacheName).then(async cache=>(await cache.match(url.href))||fetch(request)));
});
`;}
