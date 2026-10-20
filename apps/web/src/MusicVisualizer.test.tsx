// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {MusicVisualizer} from './MusicVisualizer.js';
const mocks=vi.hoisted(()=>({enable:vi.fn(async()=>{}),disable:vi.fn(),sample:vi.fn((_audio:unknown,out:Float32Array)=>out.fill(.6)),draw:vi.fn(),dispose:vi.fn(),release:vi.fn(),create:vi.fn()}));
vi.mock('./audio-spectrum.js',async importOriginal=>({...await importOriginal<object>(),enableSpectrum:mocks.enable,disableSpectrum:mocks.disable,sampleSpectrum:mocks.sample}));
vi.mock('./spectrum-scene.js',()=>({SpectrumScene:class{
 levels=new Float32Array(144);draw=mocks.draw;dispose=mocks.dispose;releaseContext=mocks.release;
 constructor(){mocks.create();}
}}));
let callbacks:Map<number,FrameRequestCallback>;let counter=0;
beforeEach(()=>{
 vi.clearAllMocks();localStorage.clear();localStorage.setItem('freeqify.visualizer.listener',JSON.stringify({enabled:false,engine:'spectrum',spectrumVersion:3}));callbacks=new Map();
 vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{callbacks.set(++counter,callback);return counter;});
 vi.stubGlobal('cancelAnimationFrame',(id:number)=>callbacks.delete(id));
 vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
 vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}));
});
afterEach(()=>{vi.useRealTimers();cleanup();vi.unstubAllGlobals();});
const audio={current:document.createElement('audio')};
const props={audio,active:true,playing:true,user:'listener',expanded:false,onExpand:vi.fn()};
async function enable(){await act(async()=>{fireEvent.click(screen.getByRole('group',{name:'Enable visualizer'}));});}
function frames(count=20){act(()=>{for(let i=0;i<count;i++){const pending=[...callbacks.values()];callbacks.clear();pending.forEach(callback=>callback((i+1)*50));}});}
it('preserves the scene and audio connection while changing palettes; freezes musical motion on pause',async()=>{
 const view=render(<MusicVisualizer {...props}/>);await enable();frames();expect(mocks.sample).toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText('Visualizer palette'),{target:{value:'Ice'}});frames();
 expect(mocks.create).toHaveBeenCalledTimes(1);expect(mocks.enable).toHaveBeenCalledTimes(1);expect(mocks.draw.mock.calls.at(-1)?.[4]).toBe('Ice');
 view.rerender(<MusicVisualizer {...props} playing={false}/>);mocks.sample.mockClear();frames();expect(mocks.sample).not.toHaveBeenCalled();expect(callbacks.size).toBe(0);
 view.rerender(<MusicVisualizer {...props}/>);frames();expect(mocks.sample).toHaveBeenCalled();
});
it('stops drawing when closed, reuses graphics on reopen, and releases graphics on actual unmount',async()=>{
 const view=render(<MusicVisualizer {...props}/>);await enable();frames();
 view.rerender(<MusicVisualizer {...props} active={false}/>);expect(callbacks.size).toBe(0);expect(mocks.disable).toHaveBeenCalledWith(audio.current);
 await act(async()=>view.rerender(<MusicVisualizer {...props}/>));frames();expect(mocks.create).toHaveBeenCalledTimes(1);
 await act(async()=>view.unmount());expect(callbacks.size).toBe(0);expect(mocks.dispose).toHaveBeenCalledTimes(1);expect(mocks.release).toHaveBeenCalledTimes(1);
});
it('keeps audio untouched on graphics failure and can retry successfully',async()=>{
 mocks.create.mockImplementationOnce(()=>{throw new Error('3D graphics are unavailable.');});
 render(<MusicVisualizer {...props}/>);await enable();expect(screen.getByRole('status').textContent).toContain('Playback controls remain available');expect(mocks.enable).not.toHaveBeenCalled();
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Retry visualizer'})));frames();expect(mocks.enable).toHaveBeenCalledTimes(1);expect(screen.queryByRole('status')).toBeNull();
});
it('reduces geometry and effects for reduced motion, and cancels frames while hidden',async()=>{
 vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()}));
 render(<MusicVisualizer {...props}/>);await enable();frames();expect(mocks.draw.mock.calls.at(-1)?.slice(0,3)).toEqual([24,2,true]);
 const visibility=vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden');fireEvent(document,new Event('visibilitychange'));expect(callbacks.size).toBe(0);
 visibility.mockReturnValue('visible');fireEvent(document,new Event('visibilitychange'));frames();expect(callbacks.size).toBe(1);visibility.mockRestore();
});

it('keeps the canvas and audio graph when expanded without double-click actions',async()=>{
 const expand=vi.fn();const view=render(<MusicVisualizer {...props} onExpand={expand}/>);await enable();frames();
 const canvas=screen.getByRole('img');fireEvent.doubleClick(canvas);expect(expand).not.toHaveBeenCalled();
 view.rerender(<MusicVisualizer {...props} expanded onExpand={expand}/>);frames();
 expect(screen.getByRole('img')).toBe(canvas);expect(mocks.create).toHaveBeenCalledTimes(1);expect(mocks.enable).toHaveBeenCalledTimes(1);
});
it('starts enabled for new listeners while respecting an explicit saved opt-out',async()=>{
 localStorage.clear();const view=render(<MusicVisualizer {...props}/>);
 await act(async()=>{});expect(screen.getByRole('group',{name:'Visualizer display'})).toBeTruthy();
 view.unmount();localStorage.setItem('freeqify.visualizer.listener',JSON.stringify({enabled:false,engine:'spectrum',spectrumVersion:3}));
 render(<MusicVisualizer {...props}/>);expect(screen.getByRole('group',{name:'Enable visualizer'})).toBeTruthy();
});

it('suspends off-screen rendering and adapts band count after container resizing',async()=>{
 let intersection!:IntersectionObserverCallback;const resizes:ResizeObserverCallback[]=[];
 vi.stubGlobal('IntersectionObserver',class{constructor(callback:IntersectionObserverCallback){intersection=callback;}observe(){}disconnect(){}});
 vi.stubGlobal('ResizeObserver',class{constructor(callback:ResizeObserverCallback){resizes.push(callback);}observe(){}disconnect(){}});
 render(<MusicVisualizer {...props}/>);await enable();frames();expect(callbacks.size).toBe(1);
 act(()=>intersection([{isIntersecting:false} as IntersectionObserverEntry],{} as IntersectionObserver));expect(callbacks.size).toBe(0);
 await act(async()=>intersection([{isIntersecting:true} as IntersectionObserverEntry],{} as IntersectionObserver));frames();
 act(()=>resizes[0]!([{contentRect:{width:390}} as ResizeObserverEntry],{} as ResizeObserver));frames();
 expect(mocks.draw.mock.calls.at(-1)?.[0]).toBe(32);expect(mocks.enable).toHaveBeenCalledTimes(1);
});

it('leaves wheel and pointer gestures available for page scrolling without changing the camera',async()=>{
 const view=render(<MusicVisualizer {...props} playing={false}/>);await enable();frames();
 const canvas=screen.getByRole('img');expect(callbacks.size).toBe(0);
 const wheel=new WheelEvent('wheel',{deltaY:150,bubbles:true,cancelable:true});fireEvent(canvas,wheel);expect(wheel.defaultPrevented).toBe(false);expect(callbacks.size).toBe(0);
 const down=new Event('pointerdown',{bubbles:true,cancelable:true});Object.assign(down,{button:0,clientX:30,clientY:30,isPrimary:true});fireEvent(canvas,down);fireEvent.pointerMove(canvas,{clientX:30,clientY:80});fireEvent.pointerCancel(canvas);expect(down.defaultPrevented).toBe(false);
 view.rerender(<MusicVisualizer {...props} playing={false} expanded/>);frames();
 expect(mocks.draw.mock.calls.at(-1)?.[6]).toEqual({yaw:20,pitch:16,zoom:1});expect(mocks.enable).toHaveBeenCalledTimes(1);
});

it('switches controls and preserves spectrum preferences without touching the media element',async()=>{
 const view=render(<MusicVisualizer {...props}/>);await enable();frames();
 fireEvent.change(screen.getByLabelText('Visualizer palette'),{target:{value:'Synthwave'}});
 // Use inactive view to exercise persistent controls without requiring a real WebGL context.
 view.rerender(<MusicVisualizer {...props} active={false}/>);
 fireEvent.change(screen.getByLabelText('Visualizer mode'),{target:{value:'milkdrop'}});
 expect(screen.queryByLabelText('Visualizer palette')).toBeNull();
 const preset=screen.getByLabelText('MilkDrop preset') as HTMLSelectElement;
 const first=preset.value;fireEvent.click(screen.getByLabelText('Next preset'));expect(preset.value).not.toBe(first);
 const chosen=preset.value;fireEvent.click(screen.getByLabelText('Automatic preset cycling'));
 expect(JSON.parse(localStorage.getItem('freeqify.visualizer.listener')!)).toMatchObject({engine:'milkdrop',preset:chosen,cycle:true,palette:'Synthwave'});
 fireEvent.change(screen.getByLabelText('Visualizer mode'),{target:{value:'spectrum'}});
 expect((screen.getByLabelText('Visualizer palette') as HTMLSelectElement).value).toBe('Synthwave');
 fireEvent.change(screen.getByLabelText('Visualizer mode'),{target:{value:'milkdrop'}});
 expect((screen.getByLabelText('MilkDrop preset') as HTMLSelectElement).value).toBe(chosen);
 expect(callbacks.size).toBe(0);
});

it('turns off by long press without a ghost tap re-enabling it, and permits keyboard re-enable',async()=>{
 render(<MusicVisualizer {...props}/>);await enable();vi.useFakeTimers();
 const stage=screen.getByRole('group',{name:'Visualizer display'});const down=new Event('pointerdown',{bubbles:true});Object.assign(down,{button:0,clientX:30,clientY:30,isPrimary:true});fireEvent(stage,down);
 act(()=>vi.advanceTimersByTime(700));fireEvent.pointerUp(stage);fireEvent.click(stage);expect(screen.getByText('Tap to enable')).toBeTruthy();expect(screen.queryByRole('button',{name:'Visualizer on'})).toBeNull();
 await act(async()=>fireEvent.keyDown(stage,{key:'Enter'}));expect(screen.getByText('Long touch for off')).toBeTruthy();vi.useRealTimers();
});

it('ignores the retired reduced-effects setting, flies varied passes, and freezes on pause',async()=>{
 localStorage.setItem('freeqify.visualizer.listener',JSON.stringify({enabled:false,engine:'spectrum',spectrumVersion:3,reduced:true}));
 const view=render(<MusicVisualizer {...props}/>);await enable();frames();expect(screen.queryByLabelText('Reduced effects')).toBeNull();
 const moving={...mocks.draw.mock.calls.at(-1)?.[6]};expect(moving.yaw).toBeGreaterThan(20);expect(moving.yaw).toBeLessThanOrEqual(160);expect(moving.pitch).toBeGreaterThan(18);expect(moving.zoom).toBeGreaterThan(1);
 view.rerender(<MusicVisualizer {...props} playing={false}/>);frames();expect(mocks.draw.mock.calls.at(-1)?.[6]).toEqual(moving);
 view.rerender(<MusicVisualizer {...props}/>);frames();expect(mocks.draw.mock.calls.at(-1)?.[6].yaw).toBeGreaterThan(moving.yaw);
});

it('keeps automatic camera movement off for the device reduced-motion preference',async()=>{
 vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()}));
 render(<MusicVisualizer {...props}/>);await enable();frames();expect(mocks.draw.mock.calls.at(-1)?.[6]).toEqual({yaw:20,pitch:16,zoom:1});
});
