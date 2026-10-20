import {AsyncLocalStorage} from 'node:async_hooks';
import {Admission} from './resources.js';
import {AuthError} from './auth/password.js';
import type {MusicLibrary} from './integrations/navidrome.js';
export const catalogSignal = new AsyncLocalStorage<AbortSignal>();
/** All adapter operations share one admission budget, including personal metadata lookups. */
export function boundedLibrary(library:MusicLibrary,concurrent:number,timeoutMs=30000):MusicLibrary {
 const budget=new Admission(concurrent,Number.MAX_SAFE_INTEGER);
 return new Proxy(library,{get(target,key){const method=Reflect.get(target,key);if(typeof method!=='function'||key==='stream')return typeof method==='function'?method.bind(target):method;
  return async(...args:unknown[])=>{
   const release=budget.acquire('catalog');const controller=new AbortController();
   let timer:ReturnType<typeof setTimeout>|undefined;
   const work=catalogSignal.run(controller.signal,()=>Promise.resolve().then(()=>method.apply(target,args)));
   // Admission stays occupied until work actually settles, even for a non-cooperative mock.
   void work.finally(release).catch(()=>{});
   try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new AuthError(503,'CATALOG_TIMEOUT','The music engine took too long. Retry shortly.'));},timeoutMs);})]);}
   finally{clearTimeout(timer);}
  };
 }});
}
