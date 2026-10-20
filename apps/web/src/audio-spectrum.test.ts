// @vitest-environment jsdom
import {it,expect,vi,afterEach} from 'vitest';
import {enableSpectrum,disableSpectrum,disposeSpectrum,groupFrequencies,smoothSpectrum,sampleSpectrum,remapSpectrum} from './audio-spectrum.js';
import {readVisualizerSettings,saveVisualizerSettings,defaultVisualizer} from './visualizer-settings.js';
afterEach(()=>{vi.unstubAllGlobals();localStorage.clear();});
function context(state='running'){
 const source={connect:vi.fn(),disconnect:vi.fn()};
 const analyser={fftSize:4096,frequencyBinCount:2048,smoothingTimeConstant:0,minDecibels:0,maxDecibels:0,disconnect:vi.fn(),getByteFrequencyData:vi.fn((b:Uint8Array)=>b.fill(180))};
 const ctx={state,sampleRate:48000,destination:{},resume:vi.fn(async()=>{}),close:vi.fn(async()=>{}),createAnalyser:vi.fn(()=>analyser),createMediaElementSource:vi.fn(()=>source)};
 vi.stubGlobal('AudioContext',vi.fn(function(){return ctx;}));return {ctx,source,analyser};
}
it('reuses one media source across concurrent enable, disable, reopen, and track changes',async()=>{
 const {ctx,source,analyser}=context();const audio=document.createElement('audio');
 await Promise.all([enableSpectrum(audio),enableSpectrum(audio)]);
 expect(ctx.createMediaElementSource).toHaveBeenCalledTimes(1);expect(source.connect.mock.calls.filter(c=>c[0]===ctx.destination)).toHaveLength(1);
 disableSpectrum(audio);expect(source.disconnect).toHaveBeenCalledWith(analyser);expect(ctx.close).not.toHaveBeenCalled();
 audio.src='/api/library/stream/new-track';await enableSpectrum(audio);expect(ctx.createMediaElementSource).toHaveBeenCalledTimes(1);
 const bins=new Float32Array(32);expect(sampleSpectrum(audio,bins,1)).toBe(true);expect(bins.some(x=>x>0)).toBe(true);
 disposeSpectrum(audio);expect(ctx.close).toHaveBeenCalledTimes(1);expect(source.disconnect).toHaveBeenLastCalledWith();
 await expect(enableSpectrum(audio)).rejects.toThrow('closed');
});
it('leaves native playback untouched when audio permission is unavailable',async()=>{
 const {ctx}=context('suspended');await expect(enableSpectrum(document.createElement('audio'))).rejects.toThrow('Tap Enable');
 expect(ctx.createMediaElementSource).not.toHaveBeenCalled();expect(ctx.close).toHaveBeenCalled();
});
it('rejects cross-origin media before rerouting it',async()=>{
 const {ctx}=context();const audio=document.createElement('audio');Object.defineProperty(audio,'currentSrc',{value:'https://foreign.example/song.mp3'});
 await expect(enableSpectrum(audio)).rejects.toThrow('same-origin');expect(ctx.createMediaElementSource).not.toHaveBeenCalled();
});
it('cancels pending analysis when its player is disposed',async()=>{
 const {ctx}=context();let resume!:()=>void;ctx.resume.mockImplementation(()=>new Promise<void>(r=>{resume=r;}));
 const audio=document.createElement('audio');const task=enableSpectrum(audio);disposeSpectrum(audio);resume();await expect(task).rejects.toThrow();expect(ctx.createMediaElementSource).not.toHaveBeenCalled();
});
it('maps bass, mids and treble to separate logarithmic towers and silence to zero',()=>{
 const peaks:number[]=[];
 for(const hz of [80,1000,10000]){const bins=new Uint8Array(2048);bins[Math.round(hz/(48000/4096))]=255;const out=new Float32Array(48);groupFrequencies(bins,48000,4096,out);peaks.push(out.indexOf(Math.max(...out)));}
 expect(peaks[0]).toBeLessThan(12);expect(peaks[1]).toBeGreaterThan(20);expect(peaks[1]).toBeLessThan(32);expect(peaks[2]).toBeGreaterThan(39);
 const out=new Float32Array(48).fill(1);groupFrequencies(new Uint8Array(2048),48000,4096,out);expect([...out]).toEqual(Array(48).fill(0));
});
it('uses faster attack than decay and converges to silence without jitter',()=>{
 const rising=new Float32Array([0]),falling=new Float32Array([1]);smoothSpectrum(rising,new Float32Array([1]),.02,1);smoothSpectrum(falling,new Float32Array([0]),.02,1);expect(rising[0]).toBeGreaterThan(1-falling[0]!);
 for(let i=0;i<100;i++)smoothSpectrum(falling,new Float32Array([0]),.02,1);expect(falling[0]).toBeLessThan(.001);
});
it('persists bounded preferences per account and tolerates corrupt/blocked storage',()=>{
 saveVisualizerSettings('a',{...defaultVisualizer,enabled:true,palette:'Amber CRT',angle:30});expect(readVisualizerSettings('a').palette).toBe('Amber CRT');expect(readVisualizerSettings('b').enabled).toBe(true);
 localStorage.setItem('freeqify.visualizer.a','{"sensitivity":999,"palette":"bad"}');expect(readVisualizerSettings('a').sensitivity).toBe(2.5);expect(readVisualizerSettings('a').palette).toBe('Freeqify Green');
 localStorage.setItem('freeqify.visualizer.a','{');expect(readVisualizerSettings('a')).toEqual(defaultVisualizer);
});

it('keeps quiet audio subdued without normalizing it into a loud passage',()=>{
 const quiet=new Float32Array(48),loud=new Float32Array(48);
 groupFrequencies(new Uint8Array(2048).fill(30),48000,4096,quiet);
 groupFrequencies(new Uint8Array(2048).fill(220),48000,4096,loud);
 expect(Math.max(...quiet)).toBeLessThan(.08);expect(Math.max(...loud)).toBeGreaterThan(.75);
});

it('gives upper percussion a quicker envelope while preserving bass weight',()=>{
 const rising=new Float32Array(48),falling=new Float32Array(48).fill(1);
 smoothSpectrum(rising,new Float32Array(48).fill(1),.02,1);
 smoothSpectrum(falling,new Float32Array(48),.1,1);
 expect(rising[47]).toBeGreaterThan(rising[0]!);expect(falling[47]).toBeLessThan(falling[0]!);
});

it('preserves row boundaries and frequency endpoints when a paused stage changes resolution',()=>{
 const levels=new Float32Array(144);levels.set([0,.5,1,1,.5,0]);
 remapSpectrum(levels,3,2,5,3);
 expect([...levels.slice(0,5)]).toEqual([0,.25,.5,.75,1]);
 expect([...levels.slice(5,10)]).toEqual([1,.75,.5,.25,0]);
 expect([...levels.slice(10,15)]).toEqual([1,.75,.5,.25,0]);
 expect([...levels.slice(15)]).toEqual(Array(129).fill(0));
});
