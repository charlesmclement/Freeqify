// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type {LidarrQueue} from '@freeqify/shared';
import {AlbumQueue} from './AlbumQueue.js';
import {accountRequest} from './auth-api.js';
vi.mock('./auth-api.js',()=>({accountRequest:vi.fn()}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
it('resumes a saved batch after remount without requesting albums or retaining old search consent',async()=>{
 const saved:LidarrQueue={id:'saved',total:12,counts:{pending:2,review:0,queued:0,confirmed:10,skipped:0,failed:0},albums:[],failures:[]};
 let snapshot=saved;
 vi.mocked(accountRequest).mockImplementation(async(path,_csrf,input)=>{
  if(path.endsWith('/step')){snapshot={...snapshot,counts:{...snapshot.counts,pending:0,review:2},albums:[1,2].map(i=>({key:`key-${i}`,title:`Album ${i}`,artist:'Artist',tracks:1,candidates:[{id:`id-${i}`,title:`Album ${i}`,artist:'Artist',year:2020,monitored:false,present:false,canRequest:true}]}))};return snapshot as never;}
  if(input!==undefined)throw new Error('Unexpected mutation');return snapshot as never;
 });
 const props={playlist:'list',csrf:'csrf',selected:[],disabled:false,canRequest:true,onUpdate:vi.fn()};
 const view=render(<AlbumQueue {...props}/>);
 fireEvent.click(await screen.findByRole('button',{name:/View \/ resume album queue/}));
 const dialog=await screen.findByRole('dialog');await within(dialog).findByText('Album 1 · 1 selected tracks');
 await waitFor(()=>expect(within(dialog).getByRole('button',{name:'Confirm 0 selected albums'})).toBeDisabled());
 expect(vi.mocked(accountRequest).mock.calls.some(([p])=>p.endsWith('/confirm'))).toBe(false);
 await waitFor(()=>expect(within(dialog).getByRole('checkbox',{name:'Automatic search'})).toBeEnabled());
 fireEvent.click(within(dialog).getByRole('checkbox',{name:'Automatic search'}));
 fireEvent.click(within(dialog).getAllByRole('radio')[0]!);
 fireEvent.click(within(dialog).getByRole('button',{name:'Close dialog'}));view.unmount();
 render(<AlbumQueue {...props}/>);fireEvent.click(await screen.findByRole('button',{name:/View \/ resume album queue/}));
 const resumed=await screen.findByRole('dialog');
 expect(await within(resumed).findByRole('checkbox',{name:'Automatic search'})).not.toBeChecked();
 expect(within(resumed).getByRole('button',{name:'Confirm 0 selected albums'})).toBeDisabled();
 expect(within(resumed).getByText(/10 confirmed/)).toBeVisible();
 expect(vi.mocked(accountRequest).mock.calls.some(([p])=>p.endsWith('/confirm'))).toBe(false);
});
it('pauses on an album failure instead of consuming the remaining queue during an outage',async()=>{
 const saved:LidarrQueue={id:'saved',total:12,counts:{pending:12,review:0,queued:0,confirmed:0,skipped:0,failed:0},albums:[],failures:[]};
 vi.mocked(accountRequest).mockImplementation(async(path)=>path.endsWith('/step')?{...saved,counts:{...saved.counts,pending:11,failed:1},failures:[{key:'failed',title:'Album',artist:'Artist',message:'Lidarr unavailable'}]} as never:saved as never);
 render(<AlbumQueue playlist="list" csrf="csrf" selected={[]} disabled={false} canRequest onUpdate={vi.fn()}/>);
 fireEvent.click(await screen.findByRole('button',{name:/View \/ resume album queue/}));
 const dialog=await screen.findByRole('dialog');expect(await within(dialog).findByText('Lidarr unavailable')).toBeVisible();
 await waitFor(()=>expect(within(dialog).getByRole('button',{name:'Retry Album'})).toBeEnabled());
 expect(vi.mocked(accountRequest).mock.calls.filter(([p])=>p.endsWith('/step'))).toHaveLength(1);
 expect(within(dialog).getByText(/11 awaiting lookup/)).toBeVisible();
});
it('starts Seek all with one click and leaves processing to the server',async()=>{
 const automatic:LidarrQueue={id:'automatic',automatic:true,paused:false,total:20,counts:{pending:20,review:0,queued:0,confirmed:0,skipped:0,failed:0},albums:[],failures:[]};
 vi.mocked(accountRequest).mockImplementation(async(path)=>path.endsWith('/seek')?automatic as never:null as never);
 render(<AlbumQueue playlist="list" csrf="csrf" selected={[]} missing={50} disabled={false} canRequest onUpdate={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:/Seek all/}));
 const dialog=await screen.findByRole('dialog');expect(await within(dialog).findByText(/Seek all runs on the server/)).toBeVisible();
 expect(accountRequest).toHaveBeenCalledWith('imports/list/albums/queue/seek','csrf',{});
 expect(vi.mocked(accountRequest).mock.calls.some(([p])=>p.endsWith('/step')||p.endsWith('/confirm'))).toBe(false);
 fireEvent.click(within(dialog).getByRole('button',{name:'Close dialog'}));
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:/View \/ resume album queue/})).toBeVisible();
});
