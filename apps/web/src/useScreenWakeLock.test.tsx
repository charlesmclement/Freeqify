// @vitest-environment jsdom
import {act,renderHook,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {useScreenWakeLock} from './useScreenWakeLock.js';
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
function setup(){
 const locks:EventTarget[]=[];
 const request=vi.fn(async()=>{const lock=Object.assign(new EventTarget(),{release:vi.fn(async()=>{lock.dispatchEvent(new Event('release'));})});locks.push(lock);return lock;});
 Object.defineProperty(navigator,'wakeLock',{configurable:true,value:{request}});
 return {request,locks};
}
it('requests only when enabled and releases on exit',async()=>{
 const {request}=setup();const {rerender,unmount}=renderHook(({active})=>useScreenWakeLock(active),{initialProps:{active:false}});
 expect(request).not.toHaveBeenCalled();rerender({active:true});await waitFor(()=>expect(request).toHaveBeenCalledWith('screen'));
 const lock=await request.mock.results[0]!.value;rerender({active:false});expect(lock.release).toHaveBeenCalledOnce();unmount();
});
it('releases when hidden and reacquires on return',async()=>{
 const {request}=setup();vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
 const {unmount}=renderHook(()=>useScreenWakeLock(true));await waitFor(()=>expect(request).toHaveBeenCalledOnce());const lock=await request.mock.results[0]!.value;
 vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden');act(()=>document.dispatchEvent(new Event('visibilitychange')));expect(lock.release).toHaveBeenCalledOnce();
 vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');act(()=>document.dispatchEvent(new Event('visibilitychange')));await waitFor(()=>expect(request).toHaveBeenCalledTimes(2));unmount();
});
it('releases a pending request after exit',async()=>{
 const release=vi.fn(async()=>{});let resolve!:(value:WakeLockSentinel)=>void;
 Object.defineProperty(navigator,'wakeLock',{configurable:true,value:{request:()=>new Promise<WakeLockSentinel>(done=>{resolve=done;})}});
 const {unmount}=renderHook(()=>useScreenWakeLock(true));unmount();await act(async()=>{resolve({release} as unknown as WakeLockSentinel);});expect(release).toHaveBeenCalledOnce();
});
it('reports a rejected request without affecting playback',async()=>{
 Object.defineProperty(navigator,'wakeLock',{configurable:true,value:{request:vi.fn().mockRejectedValue(new Error('Denied'))}});
 const {result}=renderHook(()=>useScreenWakeLock(true));await waitFor(()=>expect(result.current).toContain('Could not keep the screen awake'));
});
