// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ProgressiveAudio,supportsProgressiveAudio} from './progressive-audio.js';
import {SongBuffer} from './song-buffer.js';
class FakeBuffer extends EventTarget {
 seconds=0;updating=false;
 buffered={length:1,start:()=>0,end:()=>this.seconds};
 appendBuffer(bytes:ArrayBuffer){this.seconds+=bytes.byteLength/10;queueMicrotask(()=>this.dispatchEvent(new Event('updateend')));}
}
class FakeSource extends EventTarget {
 static isTypeSupported=()=>true;
 readyState='closed';buffer=new FakeBuffer();
 addSourceBuffer(){return this.buffer;}
 endOfStream(){this.readyState='ended';}
}
let sources:FakeSource[]=[];
beforeEach(()=>{
 sources=[];vi.stubGlobal('MediaSource',class extends FakeSource{constructor(){super();sources.push(this);}});
 vi.stubGlobal('URL',class extends URL{static createObjectURL=vi.fn((value:unknown)=>{if(value instanceof FakeSource)queueMicrotask(()=>{value.readyState='open';value.dispatchEvent(new Event('sourceopen'));});return `blob:${Math.random()}`;});static revokeObjectURL=vi.fn();});
 vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it('starts after half a second and continues appending until completion without a source swap',async()=>{
 const audio=document.createElement('audio'),ready=vi.fn(),recover=vi.fn(),pipe=new ProgressiveAudio(audio,ready,recover);
 expect(supportsProgressiveAudio()).toBe(true);await pipe.start('audio/mpeg');const url=audio.src;
 await pipe.write(new Uint8Array(2));expect(ready).not.toHaveBeenCalled();await pipe.write(new Uint8Array(3));expect(ready).toHaveBeenCalledOnce();
 await pipe.write(new Uint8Array(10));expect(audio.src).toBe(url);expect(sources[0]!.buffer.seconds).toBe(1.5);pipe.finish();expect(pipe.finished).toBe(true);expect(ready).toHaveBeenCalledOnce();pipe.dispose();expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
});
it('finishes short songs early and leaves unsupported originals on the complete-blob path',async()=>{
 const ready=vi.fn(),pipe=new ProgressiveAudio(document.createElement('audio'),ready,vi.fn());await pipe.start('audio/mpeg');await pipe.write(new Uint8Array(3));pipe.finish();expect(ready).toHaveBeenCalledOnce();pipe.dispose();
 const raw=new ProgressiveAudio(document.createElement('audio'),ready,vi.fn());await raw.start('audio/flac');await raw.write(new Uint8Array(20));raw.finish();expect(raw.active).toBe(false);expect(ready).toHaveBeenCalledOnce();
});
it('discards a progressive attempt on failure and does not append duplicate retry bytes',async()=>{
 const recover=vi.fn(),pipe=new ProgressiveAudio(document.createElement('audio'),vi.fn(),recover);await pipe.start('audio/mpeg');await pipe.write(new Uint8Array(12));pipe.failed();expect(recover).toHaveBeenCalledOnce();await pipe.start('audio/mpeg');await pipe.write(new Uint8Array(12));expect(sources).toHaveLength(1);expect(sources[0]!.buffer.seconds).toBe(1.2);expect(pipe.finished).toBe(false);pipe.dispose();
});
it('uses a single download while playback becomes ready before the fetch reaches EOF',async()=>{
 let send!:(v:Uint8Array)=>void,end!:()=>void;
 const body=new ReadableStream<Uint8Array>({start(c){send=v=>c.enqueue(v);end=()=>c.close();}});
 const fetcher=vi.fn(async()=>new Response(body,{headers:{'content-type':'audio/mpeg','content-length':'24'}}));vi.stubGlobal('fetch',fetcher);
 const ready=vi.fn(),pipe=new ProgressiveAudio(document.createElement('audio'),ready,vi.fn()),cache=new SongBuffer();let complete=false;
 const downloading=cache.get('one','/api/library/stream/one',undefined,pipe);void downloading.then(()=>{complete=true;});
 send(new Uint8Array(12));await vi.waitFor(()=>expect(ready).toHaveBeenCalledOnce());expect(complete).toBe(false);
 send(new Uint8Array(12));end();await downloading;expect(pipe.finished).toBe(true);expect(fetcher).toHaveBeenCalledOnce();cache.clear();pipe.dispose();
});

it('prepares the next song before EOF only after eight seconds of headroom',async()=>{
 const warm=vi.fn(),audio=document.createElement('audio'),pipe=new ProgressiveAudio(audio,vi.fn(),vi.fn(),warm);await pipe.start('audio/mpeg');
 await pipe.write(new Uint8Array(10));expect(warm).not.toHaveBeenCalled();audio.currentTime=1;await pipe.write(new Uint8Array(70));expect(warm).not.toHaveBeenCalled();
 await pipe.write(new Uint8Array(10));expect(warm).toHaveBeenCalledOnce();await pipe.write(new Uint8Array(10));expect(warm).toHaveBeenCalledOnce();pipe.dispose();
});

it('rebuilds three seconds after an underrun without reloading the audio source',async()=>{
 const audio=document.createElement('audio'),ready=vi.fn(),buffering=vi.fn(),pipe=new ProgressiveAudio(audio,ready,vi.fn(),vi.fn(),buffering);await pipe.start('audio/mpeg');await pipe.write(new Uint8Array(5));expect(ready).toHaveBeenCalledOnce();
 const url=audio.src;Object.defineProperty(audio,'paused',{configurable:true,value:false});audio.dispatchEvent(new Event('waiting'));expect(buffering).not.toHaveBeenCalled();audio.currentTime=0.5;audio.dispatchEvent(new Event('waiting'));expect(buffering).toHaveBeenCalledOnce();expect(audio.pause).toHaveBeenCalled();
 await pipe.write(new Uint8Array(10));expect(ready).toHaveBeenCalledOnce();await pipe.write(new Uint8Array(20));expect(ready).toHaveBeenCalledTimes(2);expect(audio.src).toBe(url);audio.dispatchEvent(new Event('waiting'));pipe.finish();expect(ready).toHaveBeenCalledTimes(3);pipe.dispose();audio.dispatchEvent(new Event('waiting'));expect(buffering).toHaveBeenCalledTimes(2);
});
