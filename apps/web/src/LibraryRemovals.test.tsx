// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import '@testing-library/jest-dom/vitest';
import {LibraryRemovalButton,RemovedLibrary} from './LibraryRemovals.js';
const state=vi.hoisted(()=>({role:'admin',request:vi.fn()}));
vi.mock('./Authentication.js',()=>({useOptionalAccount:()=>({state:{user:{role:state.role},csrf:'csrf'}})}));
vi.mock('./auth-api.js',()=>({accountRequest:state.request}));
beforeEach(()=>{window.history.replaceState(null,'','/');state.role='admin';state.request.mockReset();});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('does not offer removal or restore management to listeners',()=>{
 state.role='listener';render(<><LibraryRemovalButton kind="track" id="one" title="One"/><RemovedLibrary/></>);expect(screen.queryByRole('button')).toBeNull();expect(screen.queryByText('Removed from Freeqify')).toBeNull();expect(state.request).not.toHaveBeenCalled();
});
it('requires explicit confirmation, explains shared scope and keeping files, then refreshes the library',async()=>{
 state.request.mockResolvedValue({ok:true});const changed=vi.fn();window.addEventListener('freeqify:library-changed',changed);
 try{
  render(<LibraryRemovalButton kind="album" id="a" title="Album A"/>);
  fireEvent.click(screen.getByRole('button',{name:'Remove Album A from Freeqify'}));
  expect(screen.getByRole('button',{name:'Remove Album A from Freeqify'})).toHaveTextContent('Remove');expect(screen.getByRole('button',{name:'Remove Album A from Freeqify'})).toHaveClass('queue-add');expect(await screen.findByRole('dialog')).toBeTruthy();expect(screen.getByText(/Music files stay on disk/)).toBeTruthy();expect(state.request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Cancel'}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(screen.getByRole('button',{name:'Remove Album A from Freeqify'}));
  const confirm=await screen.findByRole('button',{name:'Confirm removal'});await act(async()=>fireEvent.click(confirm));
  expect(state.request).toHaveBeenCalledWith('library/remove','csrf',{kind:'album',id:'a',confirmed:true});
  expect(changed).toHaveBeenCalledOnce();await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 }finally{window.removeEventListener('freeqify:library-changed',changed);}
});
it('keeps confirmation open on a server refusal',async()=>{
 state.request.mockRejectedValue(new Error('Administrator access is required.'));render(<LibraryRemovalButton kind="track" id="one" title="One"/>);
 fireEvent.click(screen.getByRole('button',{name:'Remove One from Freeqify'}));fireEvent.click(await screen.findByRole('button',{name:'Confirm removal'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Administrator access');expect(screen.getByRole('dialog')).toBeTruthy();
});
it('loads removed items only on expansion and restores them without claiming files were deleted',async()=>{
 let restored=false;state.request.mockImplementation(async(path:string)=>{
  if(path==='library/removed/restore'){restored=true;return {ok:true};}
  return {items:restored?[]:[{kind:'track',id:'one',title:'One',artist:'Artist',albumId:'a',removedAt:1}],nextOffset:null};
 });
 render(<RemovedLibrary/>);expect(state.request).not.toHaveBeenCalled();
 const details=screen.getByText('Removed from Freeqify').closest('details')!;
 details.open=true;fireEvent(details,new Event('toggle'));
 fireEvent.click(await screen.findByRole('button',{name:'Restore One to Freeqify'}));
 await waitFor(()=>expect(screen.getByText('No items removed.')).toBeTruthy());
 expect(state.request).toHaveBeenCalledWith('library/removed/restore','csrf',{kind:'track',id:'one',confirmed:true});
});
