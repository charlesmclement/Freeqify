// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {accountRequest} from './auth-api.js';
afterEach(()=>vi.unstubAllGlobals());
const state=(id:string,token:string)=>({user:{id,username:'listener',role:'listener'},csrf:token.repeat(64),expiresAt:Date.now()+60000});
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status});
it('recovers a rotated same-account cookie exactly once after a rejected write',async()=>{
 const before=state('owner','a'),after=state('owner','b');
 const fetcher=vi.fn().mockResolvedValueOnce(json(before)).mockResolvedValueOnce(json({error:{code:'CSRF_REJECTED'}},403)).mockResolvedValueOnce(json(after)).mockResolvedValueOnce(json({ok:true}));vi.stubGlobal('fetch',fetcher);
 await accountRequest('auth/session');expect(await accountRequest('personal/playlists',before.csrf,{name:'Music'})).toEqual({ok:true});
 expect(fetcher).toHaveBeenCalledTimes(4);expect(fetcher.mock.calls[3]![1].headers['X-CSRF-Token']).toBe(after.csrf);
});
it('never replays a write under another account',async()=>{
 const before=state('first','c');const fetcher=vi.fn().mockResolvedValueOnce(json(before)).mockResolvedValueOnce(json({error:{code:'CSRF_REJECTED'}},403)).mockResolvedValueOnce(json(state('second','d')));vi.stubGlobal('fetch',fetcher);
 await accountRequest('auth/session');await expect(accountRequest('personal/playlists',before.csrf,{name:'Private'})).rejects.toMatchObject({status:403});expect(fetcher).toHaveBeenCalledTimes(3);
});
it('does not retry permissions denials',async()=>{
 const fetcher=vi.fn().mockResolvedValue(json({error:{code:'FORBIDDEN'}},403));vi.stubGlobal('fetch',fetcher);
 await expect(accountRequest('admin/users')).rejects.toMatchObject({status:403});expect(fetcher).toHaveBeenCalledTimes(1);
});
it('stops after one refreshed write is rejected again',async()=>{
 const before=state('owner','e');const rejection=()=>json({error:{code:'CSRF_REJECTED'}},403);
 const fetcher=vi.fn().mockResolvedValueOnce(json(before)).mockResolvedValueOnce(rejection()).mockResolvedValueOnce(json(state('owner','f'))).mockResolvedValueOnce(rejection());vi.stubGlobal('fetch',fetcher);
 await accountRequest('auth/session');await expect(accountRequest('personal/playlists',before.csrf,{name:'Music'})).rejects.toMatchObject({status:403});expect(fetcher).toHaveBeenCalledTimes(4);
});

it('bounds a stalled account request and signals recovery without signing out or replaying a write',async()=>{
 vi.useFakeTimers();const unavailable=vi.fn(),logout=vi.fn();
 window.addEventListener('freeqify:server-unavailable',unavailable);window.addEventListener('freeqify:unauthenticated',logout);
 // Stub the browser deadline with the fake clock so this exercises the real fetch signal.
 const deadline=vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>{const controller=new AbortController();setTimeout(()=>controller.abort(new DOMException('Timed out','TimeoutError')),ms);return controller.signal;});
 const fetcher=vi.fn((_url,init:RequestInit)=>new Promise((_resolve,reject)=>{init.signal!.addEventListener('abort',()=>reject(init.signal!.reason));}));vi.stubGlobal('fetch',fetcher);
 try{
  const pending=expect(accountRequest('playback','a'.repeat(64),{})).rejects.toMatchObject({name:'TimeoutError'});
  await vi.advanceTimersByTimeAsync(12000);await pending;
  expect(fetcher).toHaveBeenCalledOnce();expect(unavailable).toHaveBeenCalledOnce();expect(logout).not.toHaveBeenCalled();
 }finally{deadline.mockRestore();vi.useRealTimers();window.removeEventListener('freeqify:server-unavailable',unavailable);window.removeEventListener('freeqify:unauthenticated',logout);}
});
