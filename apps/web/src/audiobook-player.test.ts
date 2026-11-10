// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {Audiobook} from '@freeqify/shared';
import {BookController,bookTime,bookElapsed,type BookWrite} from './audiobook-player.js';
const book:Audiobook={id:'book',title:'Story',author:'Author',narrator:'',series:'',description:'',albumId:'album',artworkId:null,status:'listening',partId:'p1',position:400,speed:1.5,revision:0,updatedAt:0,partCount:2,duration:91000,parts:[{id:'p1',title:'First',artist:'Author',album:'Story',albumId:'album',artworkId:null,duration:90000,format:'m4b',trackNumber:1},{id:'p2',title:'Second',artist:'Author',album:'Story',albumId:'album',artworkId:null,duration:1000,format:'mp3',trackNumber:2}],chapters:[{id:'c1',partId:'p1',position:0,title:'Part 1',kind:'part'},{id:'c2',partId:'p1',position:500,title:'Chapter 2',kind:'chapter'},{id:'c3',partId:'p2',position:0,title:'Part 2',kind:'part'}],bookmarks:[]};
beforeEach(()=>{vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'play').mockImplementation(function(this:HTMLMediaElement){this.dispatchEvent(new Event('play'));return Promise.resolve();});vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(function(this:HTMLMediaElement){this.dispatchEvent(new Event('pause'));});});afterEach(()=>vi.restoreAllMocks());
function fixture(){let now=100000;let stored=structuredClone(book);const write=vi.fn<BookWrite>(async(current,action,input)=>{if(current.revision!==stored.revision)throw new Error('Conflict');stored={...stored,...(action==='progress'?{partId:String(input.partId),position:Number(input.position)}:action==='speed'?{speed:Number(input.speed)}:action==='status'?{status:input.status as Audiobook['status']}:{}),revision:stored.revision+1};return structuredClone(stored);});const c=new BookController(write,id=>`/api/library/stream/${id}?format=raw`,()=>now),audio=document.createElement('audio');Object.defineProperty(audio,'duration',{configurable:true,value:90000});c.start(structuredClone(book));const detach=c.attach(audio);audio.dispatchEvent(new Event('loadedmetadata'));return {c,audio,write,detach,advance:(ms:number)=>{now+=ms;}};}
it('streams original long files directly, resumes, and keeps hours readable',()=>{const f=fixture();expect(f.audio.src).toContain('/stream/p1?format=raw');expect(f.audio.src).not.toContain('blob:');expect(f.audio.currentTime).toBe(400);expect(f.audio.playbackRate).toBe(1.5);expect(bookTime(90000)).toBe('25:00:00');expect(bookElapsed(book,'p2',20)).toBe(90020);f.detach();});
it('serializes delayed writes with the newest revision and permits intentional rewinds',async()=>{const f=fixture();f.audio.currentTime=700;f.audio.dispatchEvent(new Event('timeupdate'));await f.c.flush();f.c.seek('p1',100,false);await f.c.flush();await f.c.mutate('speed',{speed:2});expect(f.c.state.book).toMatchObject({position:100,speed:2});expect(f.write.mock.calls.map(([b])=>b.revision)).toEqual([0,1,2]);f.detach();});
it('pauses at a chapter boundary and on a background-delayed sleep deadline',()=>{const f=fixture();f.c.setSleep('chapter');f.audio.currentTime=501;f.audio.dispatchEvent(new Event('timeupdate'));expect(f.c.state.playing).toBe(false);expect(f.c.state.endChapter).toBe(false);f.c.play();f.c.setSleep('5');f.advance(301000);f.c.tick();expect(f.c.state.playing).toBe(false);expect(f.c.state.sleepUntil).toBeNull();f.detach();});
it('stops on sync conflicts without overwriting the other device',async()=>{const f=fixture();f.write.mockRejectedValueOnce(new Error('Changed on another device'));await expect(f.c.mutate('speed',{speed:2})).rejects.toThrow('another device');expect(f.c.state.playing).toBe(false);expect(f.c.state.error).toContain('another device');await expect(f.c.mutate('speed',{speed:2})).rejects.toThrow('Reload');expect(f.write).toHaveBeenCalledTimes(1);f.detach();});
it('does not mark network errors as completion and keeps the resume point',()=>{const f=fixture();f.audio.dispatchEvent(new Event('error'));expect(f.c.state.book?.status).toBe('listening');expect(f.c.state.position).toBe(400);expect(f.write).not.toHaveBeenCalled();f.detach();});
it('moves across file boundaries without a music queue and flushes before stopping',async()=>{const f=fixture();f.c.seek('p1',89995,true);f.c.skip(30);expect(f.c.state).toMatchObject({partId:'p2',position:25,ready:false});f.detach();const detach=f.c.attach(f.audio);f.audio.dispatchEvent(new Event('loadedmetadata'));f.audio.currentTime=30;f.audio.dispatchEvent(new Event('timeupdate'));f.c.stop();await f.c.flush();expect(f.c.state.book).toBeNull();detach();});

it('persists a paused jump to another part before its media loads',async()=>{const f=fixture();f.c.pause();f.c.seek('p2',75,false);await f.c.mutate('speed',{speed:2});expect(f.c.state.book).toMatchObject({partId:'p2',position:75});expect(f.c.state.ready).toBe(false);f.detach();});
it('waits for the last save before reopening the same book and uses its newest resume point',async()=>{
 const f=fixture();let finish!:()=>void;const held=new Promise<void>(resolve=>{finish=resolve;});
 f.write.mockImplementationOnce(async(current,_action,input)=>{await held;return {...current,partId:String(input.partId),position:Number(input.position),revision:1};});
 f.audio.currentTime=88000;f.audio.dispatchEvent(new Event('timeupdate'));f.c.stop();f.detach();f.c.start(structuredClone(book));expect(f.c.state.book).toBeNull();finish();
 await vi.waitFor(()=>expect(f.c.state.book?.revision).toBe(1));expect(f.c.state.position).toBe(88000);expect(f.write).toHaveBeenCalledTimes(1);
 f.c.stop();
});
it('plays downloaded parts offline and persists their progress through the device writer',async()=>{
 const write=vi.fn<BookWrite>(async(current,_action,input)=>({...current,...input,revision:current.revision+1}));const c=new BookController(write,()=>({url:'blob:device-part',release:()=>{}})),audio=document.createElement('audio');c.setOnline(false);c.start(book,undefined,undefined,'download');const detach=c.attach(audio);audio.dispatchEvent(new Event('loadedmetadata'));expect(c.state.playing).toBe(true);audio.currentTime=470;audio.dispatchEvent(new Event('timeupdate'));await c.settle();expect(write).toHaveBeenCalledWith(expect.anything(),'progress',{partId:'p1',position:470},'download');detach();
});
it('releases a late device Blob without attaching it after the user changes views or sources',async()=>{
 let resolve!:(value:{url:string;release:()=>void})=>void;const release=vi.fn(),pending=new Promise<{url:string;release:()=>void}>(r=>{resolve=r;});const c=new BookController(async()=>null,()=>pending),audio=document.createElement('audio');c.start(book,undefined,undefined,'download');const detach=c.attach(audio);detach();resolve({url:'blob:old-book',release});await pending;await Promise.resolve();expect(release).toHaveBeenCalledTimes(1);expect(audio.getAttribute('src')).toBeNull();
});

it('resumes an existing suspended visualizer audio path when playing a book',async()=>{
 const {enableSpectrum,disposeSpectrum}=await import('./audio-spectrum.js');const f=fixture();
 const source={connect:vi.fn(),disconnect:vi.fn()},analyser={fftSize:0,frequencyBinCount:8,disconnect:vi.fn()};
 const context={state:'running',destination:{},resume:vi.fn(async()=>{context.state='running';}),close:vi.fn(async()=>{}),createAnalyser:()=>analyser,createMediaElementSource:()=>source};
 vi.stubGlobal('AudioContext',vi.fn(function(){return context;}));
 try{await enableSpectrum(f.audio);f.c.pause();context.state='suspended';context.resume.mockClear();f.c.play();expect(context.resume).toHaveBeenCalledOnce();expect(context.state).toBe('running');expect(f.c.state.playing).toBe(true);expect(source.connect.mock.calls.filter(([target])=>target===context.destination)).toHaveLength(1);}
 finally{disposeSpectrum(f.audio);f.detach();vi.unstubAllGlobals();}
});

it('retries failed media on explicit Play using the same book and saved position',()=>{
 const f=fixture();f.audio.currentTime=470;f.audio.dispatchEvent(new Event('timeupdate'));f.audio.dispatchEvent(new Event('error'));
 expect(f.c.state).toMatchObject({position:470,ready:false,playing:false,loadRevision:0});expect(f.c.waitingToPlay).toBe(false);
 f.c.play();expect(f.c.state).toMatchObject({position:470,loadRevision:1,error:''});expect(f.c.waitingToPlay).toBe(true);
 f.detach();const detach=f.c.attach(f.audio);f.audio.dispatchEvent(new Event('loadedmetadata'));
 expect(f.audio.currentTime).toBe(470);expect(f.c.state.playing).toBe(true);expect(f.c.state.book?.id).toBe(book.id);detach();
});
