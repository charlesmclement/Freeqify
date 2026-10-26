// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {SongBuffer,SongTooLarge} from './song-buffer.js';
beforeEach(()=>{vi.stubGlobal('fetch',vi.fn());vi.stubGlobal('URL',class extends URL {static createObjectURL=vi.fn(()=>`blob:ready-${Math.random()}`);static revokeObjectURL=vi.fn();});});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
const response=(body:BodyInit,headers:Record<string,string>={})=>new Response(body,{headers:{'content-type':'audio/flac',...headers}});
it('does not publish partial audio; reuses completed next-song buffers and revokes pruned/logout URLs',async()=>{
 let send!:(value:Uint8Array)=>void,end!:()=>void;
 const stream=new ReadableStream<Uint8Array>({start(c){send=v=>c.enqueue(v);end=()=>c.close();}});
 vi.mocked(fetch).mockResolvedValue(new Response(stream,{headers:{'content-type':'audio/flac','content-length':'4'}}));
 const cache=new SongBuffer(),progress=vi.fn(),pending=cache.get('first','/audio',progress);let ready=false;void pending.then(()=>{ready=true;});
 send(new Uint8Array([1,2]));await vi.waitFor(()=>expect(progress).toHaveBeenCalledWith(2,4));expect(ready).toBe(false);expect(URL.createObjectURL).not.toHaveBeenCalled();
 send(new Uint8Array([3,4]));end();const url=await pending;expect(await cache.get('first','/audio')).toBe(url);expect(fetch).toHaveBeenCalledTimes(1);
 cache.retain(['second']);expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
 vi.mocked(fetch).mockResolvedValue(response(new Uint8Array([5])));const next=await cache.get('second','/next');cache.clear();expect(URL.revokeObjectURL).toHaveBeenCalledWith(next);
});
it('bounds memory even without Content-Length, refuses partial/non-audio data and prevents a third buffer',async()=>{
 const cache=new SongBuffer(3);vi.mocked(fetch).mockResolvedValue(response(new Uint8Array(4)));await expect(cache.get('large','/large')).rejects.toBeInstanceOf(SongTooLarge);
 expect(URL.createObjectURL).not.toHaveBeenCalled();
 vi.mocked(fetch).mockResolvedValue(new Response('private error',{status:403}));const stop=vi.fn();window.addEventListener('freeqify:unauthenticated',stop);
 await expect(cache.get('private','/private')).rejects.toThrow();expect(stop).not.toHaveBeenCalled();
 vi.mocked(fetch).mockResolvedValue(new Response('expired',{status:401}));await expect(cache.get('expired','/expired')).rejects.toThrow();expect(stop).toHaveBeenCalledOnce();window.removeEventListener('freeqify:unauthenticated',stop);
 vi.mocked(fetch).mockResolvedValue(new Response('html',{headers:{'content-type':'text/html'}}));await expect(cache.get('html','/html')).rejects.toThrow();
 vi.mocked(fetch).mockImplementation(async()=>response(new Uint8Array(1)));await cache.get('one','/one');await cache.get('two','/two');await expect(cache.get('three','/three')).rejects.toThrow('Only two');cache.clear();
});
it('retries truncated responses and aborts pending work on clear without leaving playable blobs',async()=>{
 vi.useFakeTimers();const cache=new SongBuffer();vi.mocked(fetch).mockImplementation(async()=>response(new Uint8Array([1]),{'content-length':'2'}));const pending=cache.get('broken','/broken');const rejected=expect(pending).rejects.toThrow();await vi.advanceTimersByTimeAsync(4000);await rejected;expect(fetch).toHaveBeenCalledTimes(3);expect(URL.createObjectURL).not.toHaveBeenCalled();
 vi.mocked(fetch).mockImplementation((_url,init)=>new Promise((_resolve,reject)=>{init!.signal!.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError')));}));const cancelled=cache.get('cancel','/cancel');cache.clear();await expect(cancelled).rejects.toMatchObject({name:'AbortError'});
});
it('selects completed local audio without fetching, transcoding or applying the temporary-stream size limit',async()=>{
 const blob=new Blob([new Uint8Array(8)],{type:'audio/wav'}),local=vi.fn(async()=>blob),network=vi.fn(),consumer={start:vi.fn(),write:vi.fn(),finish:vi.fn(),failed:vi.fn()};
 const cache=new SongBuffer(1,local);const url=await cache.get('song:raw','/stream',undefined,consumer,network);
 expect(url).toMatch(/^blob:/);expect(cache.source('song:raw')).toBe('device');expect(fetch).not.toHaveBeenCalled();expect(network).not.toHaveBeenCalled();expect(consumer.start).not.toHaveBeenCalled();expect(local).toHaveBeenCalledWith('song:raw');cache.clear();
});
it('retains normal streaming when there is no local file and fails closed on a corrupt local file',async()=>{
 vi.mocked(fetch).mockResolvedValue(response(new Uint8Array([1])));
 const network=vi.fn(),cache=new SongBuffer(3,async()=>null);await cache.get('online:raw','/stream',undefined,undefined,network);expect(network).toHaveBeenCalledOnce();expect(cache.source('online:raw')).toBe('server');expect(fetch).toHaveBeenCalledOnce();cache.clear();vi.mocked(fetch).mockClear();
 const broken=new SongBuffer(3,async()=>{throw new Error('Downloaded file is incomplete');});await expect(broken.get('bad:raw','/stream')).rejects.toThrow('incomplete');expect(fetch).not.toHaveBeenCalled();
});

it('prefers a new completed download over an already buffered server copy when the track is prepared again',async()=>{let saved:Blob|null=null;const cache=new SongBuffer(3,async()=>saved);vi.mocked(fetch).mockResolvedValue(response(new Uint8Array([1])));const server=await cache.get('song:raw','/stream');expect(cache.source('song:raw')).toBe('server');saved=new Blob([new Uint8Array([2,3])],{type:'audio/mpeg'});const device=await cache.get('song:raw','/stream');expect(device).not.toBe(server);expect(cache.source('song:raw')).toBe('device');expect(fetch).toHaveBeenCalledOnce();expect(URL.revokeObjectURL).toHaveBeenCalledWith(server);cache.clear();});

it('keeps an existing temporary server buffer playable when local lookup becomes unavailable offline',async()=>{let offline=false;const cache=new SongBuffer(3,async()=>{if(offline)throw new Error('No local file');return null;});vi.mocked(fetch).mockResolvedValue(response(new Uint8Array([1])));const url=await cache.get('song:raw','/stream');offline=true;expect(await cache.get('song:raw','/stream')).toBe(url);expect(fetch).toHaveBeenCalledOnce();expect(cache.source('song:raw')).toBe('server');cache.clear();});

it('requests connection recovery after exhausting transient audio retries without reporting logout',async()=>{
 vi.useFakeTimers();const unavailable=vi.fn(),logout=vi.fn();
 window.addEventListener('freeqify:server-unavailable',unavailable);window.addEventListener('freeqify:unauthenticated',logout);
 try{
  vi.mocked(fetch).mockRejectedValue(new TypeError('Connection dropped'));
  const cache=new SongBuffer();const pending=expect(cache.get('retry:raw','/stream')).rejects.toThrow('Connection dropped');
  await vi.advanceTimersByTimeAsync(4000);await pending;
  expect(fetch).toHaveBeenCalledTimes(3);expect(unavailable).toHaveBeenCalledOnce();expect(logout).not.toHaveBeenCalled();
 }finally{window.removeEventListener('freeqify:server-unavailable',unavailable);window.removeEventListener('freeqify:unauthenticated',logout);}
});
