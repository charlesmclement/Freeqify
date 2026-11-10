// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type {Audiobook,BookCatalogEntry} from '@freeqify/shared';
import {Audiobooks} from './Audiobooks.js';
import {useAccount} from './Authentication.js';
import {accountRequest,AccountRequestError} from './auth-api.js';
vi.mock('./Authentication.js',()=>({useAccount:vi.fn()}));
vi.mock('./auth-api.js',async importOriginal=>({...await importOriginal<typeof import('./auth-api.js')>(),accountRequest:vi.fn()}));
vi.mock('./AudiobookContext.js',()=>({useAudiobook:()=>null}));
vi.mock('./BookDownloadsContext.js',()=>({useBookDownloads:()=>null}));
vi.mock('./AlbumArtworkEditor.js',()=>({AlbumArtworkEditor:()=>null}));
vi.mock('./AlbumArtwork.js',()=>({AlbumArtwork:()=>null}));
const saved:Audiobook={id:'saved-book',albumId:'source-one',title:'First story',author:'Author',artworkId:null,narrator:'',series:'',description:'',status:'listening',partId:'part',position:600,speed:1.25,revision:3,updatedAt:1,partCount:1,duration:3600,parts:[{id:'part',title:'Part',album:'First story',albumId:'source-one',artist:'Author',duration:3600,format:'mp3',trackNumber:1,artworkId:null}],chapters:[{id:'chapter',kind:'part',partId:'part',position:0,title:'Opening'}],bookmarks:[{id:'bookmark',partId:'part',position:500,note:'Keep this',createdAt:1}]};
const entries:BookCatalogEntry[]=[{id:'source-one',title:'First story',artist:'Author',artistId:'author',artworkId:null,trackCount:1,year:null,book:saved},{id:'source-two',title:'Second story',artist:'Another Author',artistId:'another',artworkId:null,trackCount:1,year:null,book:null}];
beforeEach(()=>{
 window.history.replaceState(null,'','/');vi.mocked(accountRequest).mockReset();
 vi.mocked(useAccount).mockReturnValue({state:{user:{id:'reader',username:'reader',role:'listener',status:'active',createdAt:1},csrf:'csrf',expiresAt:1},offline:false,loading:false,error:'',invitation:'',refresh:vi.fn(),signedIn:vi.fn(),logout:async()=>{}});
 vi.mocked(accountRequest).mockImplementation(async path=>{
  if(path.startsWith('audiobooks/catalog'))return {items:entries,nextOffset:null} as never;
  if(path==='audiobooks/saved-book')return saved as never;
  if(path.startsWith('audiobooks?'))return {items:[saved],nextOffset:null} as never;
  throw new Error('Unexpected request');
 });
});
afterEach(()=>{cleanup();vi.useRealTimers();window.history.replaceState(null,'','/');});
it('shows all source books immediately and reopens the saved book without creating or resetting it',async()=>{
 render(<Audiobooks/>);
 expect(await screen.findByRole('button',{name:/First story.*In progress/})).toBeVisible();
 expect(screen.getByRole('button',{name:/Second story.*Not started/})).toBeVisible();
 expect(accountRequest).not.toHaveBeenCalledWith(expect.stringMatching(/^audiobooks\?/),expect.anything(),expect.anything(),expect.anything());
 fireEvent.click(screen.getByRole('button',{name:/First story.*In progress/}));
 expect(await screen.findByRole('heading',{name:'First story'})).toBeVisible();
 expect(screen.getByRole('button',{name:'Bookmarks (1)'})).toBeVisible();
 expect(screen.getByRole('progressbar',{name:'Book progress'})).toHaveAttribute('value','600');
 expect(vi.mocked(accountRequest).mock.calls.every(([,csrf])=>csrf===undefined)).toBe(true);
});
it('opens an unstarted source book directly with one CSRF-protected creation',async()=>{
 const next={...saved,id:'new-book',albumId:'source-two',title:'Second story',status:'unstarted' as const,position:0,revision:0,bookmarks:[]};
 const original=vi.mocked(accountRequest).getMockImplementation()!;
 vi.mocked(accountRequest).mockImplementation(async(...args)=>args[0]==='audiobooks'||args[0]==='audiobooks/new-book'?next as never:original(...args));
 render(<Audiobooks/>);fireEvent.click(await screen.findByRole('button',{name:/Second story.*Not started/}));
 expect(await screen.findByRole('heading',{name:'Second story'})).toBeVisible();
 expect(screen.getByRole('button',{name:'Start listening'})).toBeVisible();
 expect(accountRequest).toHaveBeenCalledWith('audiobooks','csrf',{albumId:'source-two'});
 expect(vi.mocked(accountRequest).mock.calls.filter(([path])=>path==='audiobooks')).toHaveLength(1);
});
it('keeps the private shelf as a separate view and returns to all source books',async()=>{
 render(<Audiobooks/>);await screen.findByRole('button',{name:/Second story.*Not started/});
 fireEvent.click(screen.getByRole('button',{name:'My bookshelf'}));
 await waitFor(()=>expect(screen.queryByText('Loading your bookshelf…')).not.toBeInTheDocument());
 expect(screen.getByRole('button',{name:/First story.*In progress/})).toBeVisible();
 expect(screen.queryByRole('button',{name:/Second story/})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'My bookshelf'}));expect(screen.queryByText('Loading your bookshelf…')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'All books'}));
 expect(await screen.findByRole('button',{name:/Second story.*Not started/})).toBeVisible();
});
it('does not request the remote catalog when offline',async()=>{
 vi.mocked(useAccount).mockReturnValue({...useAccount(),offline:true});render(<Audiobooks/>);
 expect(screen.getByRole('heading',{name:'Books on this device'})).toBeVisible();expect(accountRequest).not.toHaveBeenCalled();
});
it('preserves catalog search when background playback saves progress',async()=>{
 render(<Audiobooks/>);await screen.findByRole('button',{name:/Second story.*Not started/});
 fireEvent.change(screen.getByLabelText('Find audiobooks'),{target:{value:'Second'}});fireEvent.click(screen.getByRole('button',{name:'Search'}));
 await waitFor(()=>expect(accountRequest).toHaveBeenCalledWith('audiobooks/catalog?q=Second&offset=0',undefined,undefined,expect.any(AbortSignal)));
 vi.mocked(accountRequest).mockClear();fireEvent(window,new Event('freeqify:books-changed'));
 await waitFor(()=>expect(accountRequest).toHaveBeenCalledWith('audiobooks/catalog?q=Second&offset=0',undefined,undefined,expect.any(AbortSignal)));
 expect(screen.getByLabelText('Find audiobooks')).toHaveValue('Second');
});

it('recovers a transient catalog failure without replaying a write',async()=>{
 vi.useFakeTimers();vi.mocked(accountRequest).mockRejectedValueOnce(new AccountRequestError('Temporarily unavailable',502));
 render(<Audiobooks/>);await act(async()=>{});expect(screen.getByText('Loading Audiobooks…')).toBeVisible();
 await act(async()=>{await vi.advanceTimersByTimeAsync(1000);});
 expect(screen.getByRole('button',{name:/Second story.*Not started/})).toBeVisible();expect(accountRequest).toHaveBeenCalledTimes(2);
 expect(vi.mocked(accountRequest).mock.calls.every(([path,csrf])=>path.startsWith('audiobooks/catalog')&&csrf===undefined)).toBe(true);
});
it('bounds automatic retries and offers an explicit retry after failure',async()=>{
 vi.useFakeTimers();const original=vi.mocked(accountRequest).getMockImplementation()!;
 vi.mocked(accountRequest).mockRejectedValue(new AccountRequestError('Temporarily unavailable',502));render(<Audiobooks/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(10000);});expect(accountRequest).toHaveBeenCalledTimes(3);expect(screen.getByRole('alert')).toHaveTextContent('Temporarily unavailable');
 vi.mocked(accountRequest).mockImplementation(original);fireEvent.click(screen.getByRole('button',{name:'Retry books'}));await act(async()=>{});
 expect(screen.getByRole('button',{name:/Second story.*Not started/})).toBeVisible();
});
it('cancels a scheduled catalog retry when leaving the source view',async()=>{
 vi.useFakeTimers();vi.mocked(accountRequest).mockRejectedValue(new AccountRequestError('Busy',429));const view=render(<Audiobooks/>);await act(async()=>{});view.unmount();await act(async()=>{await vi.advanceTimersByTimeAsync(10000);});expect(accountRequest).toHaveBeenCalledTimes(1);
});
