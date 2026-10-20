// @vitest-environment jsdom
import {act,cleanup,render} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {MilkDropVisualizer} from './MilkDropVisualizer.js';
import {presetNames} from './milkdrop/names.js';
const mocks=vi.hoisted(()=>({source:{},context:{},connect:vi.fn(),disconnect:vi.fn(),load:vi.fn(),draw:vi.fn(),size:vi.fn(),create:vi.fn(),lose:vi.fn()}));
vi.mock('./audio-spectrum.js',()=>({enableSpectrum:async()=>({source:mocks.source,context:mocks.context})}));
vi.mock('butterchurn',()=>({default:{default:{createVisualizer:(...args:unknown[])=>{mocks.create(...args);return {connectAudio:mocks.connect,disconnectAudio:mocks.disconnect,loadPreset:mocks.load,render:mocks.draw,setRendererSize:mocks.size};}}}}));
let callbacks:Map<number,FrameRequestCallback>;let id=0;
beforeEach(()=>{
 vi.clearAllMocks();callbacks=new Map();
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({getExtension:()=>({loseContext:mocks.lose})} as unknown as WebGL2RenderingContext);
 vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
 vi.stubGlobal('requestAnimationFrame',(fn:FrameRequestCallback)=>{callbacks.set(++id,fn);return id;});
 vi.stubGlobal('cancelAnimationFrame',(key:number)=>callbacks.delete(key));
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
function frame(){act(()=>{const pending=[...callbacks.values()];callbacks.clear();pending.forEach(fn=>fn(100));});}
it('uses the existing source, preserves the engine on resize/visibility and disconnects only its own branch',async()=>{
 const onError=vi.fn(),audio={current:document.createElement('audio')};
 const props={audio,onError,running:true,playing:true,preset:presetNames[0],reduced:false};
 let view!:ReturnType<typeof render>;
 await act(async()=>{view=render(<MilkDropVisualizer {...props}/>);});
 await act(async()=>{await vi.dynamicImportSettled();});
 expect(mocks.create).toHaveBeenCalledTimes(1);expect(mocks.connect).toHaveBeenCalledWith(mocks.source);
 frame();expect(mocks.draw).toHaveBeenCalled();expect(callbacks.size).toBe(1);
 view.rerender(<MilkDropVisualizer {...props} running={false}/>);expect(callbacks.size).toBe(0);expect(mocks.disconnect).not.toHaveBeenCalled();
 view.rerender(<MilkDropVisualizer {...props} playing={false} preset={presetNames[1]}/>);frame();expect(callbacks.size).toBe(0);
 expect(mocks.load).toHaveBeenCalledTimes(2);expect(mocks.load.mock.calls.at(-1)?.[1]).toBe(0);expect(mocks.size).toHaveBeenCalledTimes(1);expect(mocks.create).toHaveBeenCalledTimes(1);
 view.unmount();expect(mocks.disconnect).toHaveBeenCalledWith(mocks.source);expect(mocks.lose).toHaveBeenCalledTimes(1);expect(onError).not.toHaveBeenCalled();
});
it('reports unsupported graphics before connecting to audio',async()=>{
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
 const onError=vi.fn();render(<MilkDropVisualizer audio={{current:document.createElement('audio')}} running playing preset={presetNames[0]} reduced={false} onError={onError}/>);
 await act(async()=>{await vi.dynamicImportSettled();});
 expect(onError).toHaveBeenCalledWith(expect.stringContaining('WebGL 2'));
 expect(mocks.connect).not.toHaveBeenCalled();expect(callbacks.size).toBe(0);
});

it('releases graphics safely if player teardown has already disconnected its source',async()=>{
 const onError=vi.fn();const view=render(<MilkDropVisualizer audio={{current:document.createElement('audio')}} running playing preset={presetNames[0]} reduced={false} onError={onError}/>);
 await act(async()=>{await vi.dynamicImportSettled();});
 mocks.disconnect.mockImplementationOnce(()=>{throw new DOMException('Already disconnected','InvalidAccessError');});
 expect(()=>view.unmount()).not.toThrow();expect(mocks.lose).toHaveBeenCalledTimes(1);
});
