// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {LibraryScan} from './LibraryScan.js';
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.useRealTimers();});
it('hides scanner controls from listeners',()=>{render(<LibraryScan admin={false} onComplete={vi.fn()}/>);expect(screen.queryByRole('button')).toBeNull();});
it('starts an authenticated scan, waits for completion, then refreshes the view',async()=>{
 const complete=vi.fn();let calls=0;const fetcher=vi.fn(async()=>({ok:true,json:async()=>({scanning:calls++===0,count:301})}));vi.stubGlobal('fetch',fetcher);
 render(<LibraryScan admin csrf="csrf" onComplete={complete}/>);fireEvent.click(screen.getByRole('button',{name:'Scan music library'}));
 await screen.findByText('Scanning music library… 301 tracks indexed so far.');expect(complete).not.toHaveBeenCalled();
 expect(fetcher).toHaveBeenCalledWith('/api/library/scan',expect.objectContaining({method:'POST',body:'{}',headers:expect.objectContaining({'X-CSRF-Token':'csrf'})}));
 await waitFor(()=>expect(complete).toHaveBeenCalledOnce(),{timeout:6500});expect(await screen.findByText('Library scan complete · 301 tracks indexed.')).toBeVisible();
},10000);
it('reports failures without claiming completion',async()=>{const complete=vi.fn();vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,status:502,json:async()=>({error:{message:'The local music engine is unavailable.'}})})));render(<LibraryScan admin onComplete={complete}/>);fireEvent.click(screen.getByRole('button',{name:'Scan music library'}));expect(await screen.findByRole('alert')).toHaveTextContent('unavailable');expect(complete).not.toHaveBeenCalled();});
