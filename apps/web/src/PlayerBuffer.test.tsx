// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {AccountProvider} from './Authentication.js';
import {Playback,usePlayer} from './Player.js';
import {emptyPlayback,type Track} from '@freeqify/shared';
const tracks=[0,1].map(i=>({id:`t${i}`,title:`Song ${i}`,artist:'Artist',album:'Album',duration:120,format:'mp3',artworkId:null,albumId:'a',trackNumber:i+1} satisfies Track));
function Controls(){const player=usePlayer();return <button onClick={()=>player.play(tracks)}>Start</button>;}
beforeEach(()=>{localStorage.clear();vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue();vi.stubGlobal('URL',class extends URL{static createObjectURL=vi.fn(()=>`blob:complete-${Math.random()}`);static revokeObjectURL=vi.fn();});});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
it('falls back to complete-song buffering without MediaSource, reuses next offline, and revokes buffers on logout',async()=>{
 let finish!:()=>void;let offline=false;
 const first=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array([1]));finish=()=>{c.enqueue(new Uint8Array([2]));c.close();};}});
 const fetcher=vi.fn(async(url:string)=>{
  if(url.includes('/stream/')){if(offline)throw new TypeError('offline');return new Response(url.includes('/t0?')?first:new Uint8Array([3,4]),{headers:{'content-type':'audio/mpeg','content-length':'2'}});}
  return {ok:true,json:async()=>url.endsWith('/auth/session')?{user:{id:'listener',username:'listener',role:'listener',status:'active',createdAt:0},csrf:'a'.repeat(64),expiresAt:Date.now()+3600000}:url.endsWith('/playback')?emptyPlayback():tracks.find(t=>url.endsWith(t.id))??{}};
 });vi.stubGlobal('fetch',fetcher);
 render(<AccountProvider><Playback><Controls/></Playback></AccountProvider>);
 await screen.findByText('Find your frequency');fireEvent.click(screen.getByText('Start'));
 await waitFor(()=>expect(fetcher.mock.calls.some(([u])=>u.includes('/stream/t0'))).toBe(true));
 const audio=document.querySelector('audio')!;expect(audio.getAttribute('src')).toBeNull();expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Pause'}));
 finish();await waitFor(()=>expect(audio.src).toMatch(/^blob:/));
 expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Play'}));expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
 await waitFor(()=>expect(URL.createObjectURL).toHaveBeenCalledTimes(2));const calls=fetcher.mock.calls.filter(([u])=>u.includes('/stream/')).length;
 offline=true;fireEvent.click(screen.getByRole('button',{name:'Next track'}));await waitFor(()=>expect(audio.src).toBe(vi.mocked(URL.createObjectURL).mock.results[1]!.value));
 expect(fetcher.mock.calls.filter(([u])=>u.includes('/stream/'))).toHaveLength(calls);
 fireEvent(window,new Event('freeqify:logout'));expect(audio.getAttribute('src')).toBeNull();expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
});

it('fast-starts an unprepared original through one progressive MP3 request, then uses the prepared original next',async()=>{
 class Buffer extends EventTarget{seconds=0;buffered={length:1,start:()=>0,end:()=>this.seconds};appendBuffer(b:ArrayBuffer){this.seconds+=b.byteLength;queueMicrotask(()=>this.dispatchEvent(new Event('updateend')));}}
 class Source extends EventTarget{static isTypeSupported=()=>true;readyState='closed';buffer=new Buffer();addSourceBuffer(){return this.buffer;}endOfStream(){this.readyState='ended';}}
 vi.stubGlobal('MediaSource',Source);vi.mocked(URL.createObjectURL).mockImplementation(value=>{if(value instanceof Source)queueMicrotask(()=>{value.readyState='open';value.dispatchEvent(new Event('sourceopen'));});return `blob:${Math.random()}`;});
 const originals=tracks.map(t=>({...t,format:'flac'}));let send!:(b:Uint8Array)=>void,end!:()=>void;
 const first=new ReadableStream<Uint8Array>({start(c){send=b=>c.enqueue(b);end=()=>c.close();}});
 const fetcher=vi.fn(async(url:string)=>{
  if(url.includes('/stream/'))return new Response(url.includes('/t0?')?first:new Uint8Array(4),{headers:{'content-type':url.includes('format=mp3')?'audio/mpeg':'audio/flac','content-length':url.includes('/t0?')?'24':'4'}});
  return {ok:true,json:async()=>url.endsWith('/auth/session')?{user:{id:'listener',username:'listener',role:'listener',status:'active',createdAt:0},csrf:'a'.repeat(64),expiresAt:Date.now()+3600000}:url.endsWith('/playback')?emptyPlayback():originals.find(t=>url.endsWith(t.id))??{}};
 });vi.stubGlobal('fetch',fetcher);
 function Start(){const player=usePlayer();return <button onClick={()=>player.play(originals)}>Start original</button>;}
 render(<AccountProvider><Playback><Start/></Playback></AccountProvider>);await screen.findByText('Find your frequency');fireEvent.click(screen.getByText('Start original'));
 send(new Uint8Array(12));await waitFor(()=>expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
 const audio=document.querySelector('audio')!,source=audio.src;
 expect(fetcher.mock.calls.filter(([url])=>url.includes('/stream/t0?'))).toHaveLength(1);expect(fetcher.mock.calls.some(([url])=>url.includes('/stream/t0?format=mp3'))).toBe(true);
 expect(screen.queryByText('Whole song ready.')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Play'}));
 send(new Uint8Array(12));end();await screen.findByText('Whole song ready.');expect(audio.src).toBe(source);
 await waitFor(()=>expect(fetcher.mock.calls.some(([url])=>url.includes('/stream/t1?format=raw'))).toBe(true));await waitFor(()=>expect(URL.createObjectURL).toHaveBeenCalledTimes(3));
 fireEvent.click(screen.getByRole('button',{name:'Next track'}));await waitFor(()=>expect(audio.src).not.toBe(source));expect(fetcher.mock.calls.filter(([url])=>url.includes('/stream/'))).toHaveLength(2);
 fireEvent(window,new Event('freeqify:logout'));expect(audio.getAttribute('src')).toBeNull();expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
});
