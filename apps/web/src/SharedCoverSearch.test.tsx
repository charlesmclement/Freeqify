// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {SharedCoverSearch} from './SharedCoverSearch.js';
import {AlbumArtworkEditor} from './AlbumArtworkEditor.js';
const account=vi.hoisted(()=>({role:'admin'}));
vi.mock('./Authentication.js',()=>({useOptionalAccount:()=>({state:{user:{role:account.role},csrf:'csrf'}})}));
beforeEach(()=>window.history.replaceState(null,'','/'));
afterEach(()=>{cleanup();vi.unstubAllGlobals();account.role='admin';});
function setup(enabled=true){
 let saved=false;
 const fetcher=vi.fn(async(url:string,init?:RequestInit)=>{
  const path=url.replace('/api/','');
  const data=path.endsWith('/choice')?{mode:'auto',coverKey:null}
   :path.endsWith('/cover-search')?{items:[{token:'preview-token',title:'Found edition',artist:'Found artist',year:'2001'}]}
   :init?.method==='POST'?(saved=JSON.parse(String(init.body)).mode==='select',{ok:true})
   :{enabled,selected:saved,artist:saved?'Found artist':null,title:saved?'Found edition':null};
  return {ok:true,json:async()=>data};
 });
 vi.stubGlobal('fetch',fetcher);return fetcher;
}
it('prefills a search, previews without saving, and explicitly applies or removes a shared cover',async()=>{
 const fetcher=setup();const onChanged=vi.fn();
 render(<SharedCoverSearch albumId="album" artist="Artist" title="Album" csrf="csrf" onChanged={onChanged}/>);
 expect(screen.getByLabelText('Cover artist')).toHaveValue('Artist');expect(screen.getByLabelText('Cover album')).toHaveValue('Album');
 const search=screen.getByRole('button',{name:'Search for cover'});await waitFor(()=>expect(search).toBeEnabled());
 fireEvent.change(screen.getByLabelText('Cover album'),{target:{value:'Short title'}});fireEvent.click(search);
 const found=await screen.findByRole('button',{name:/Found edition/});fireEvent.click(found);
 const preview=screen.getByRole('img',{name:'Found edition cover preview'});
 expect(preview).toHaveAttribute('src','/api/library/artwork/album/album/cover-preview/preview-token');
 const save=screen.getByRole('button',{name:'Use this cover for everyone'});expect(save).toBeDisabled();
 expect(fetcher.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1);
 fireEvent.load(preview);fireEvent.click(save);
 expect(await screen.findByRole('status')).toHaveTextContent('Cover saved for everyone.');expect(onChanged).toHaveBeenCalledTimes(1);
 expect(fetcher).toHaveBeenCalledWith('/api/library/artwork/album/album/cover-search',expect.objectContaining({method:'POST',headers:expect.objectContaining({'X-CSRF-Token':'csrf'}),body:JSON.stringify({artist:'Artist',album:'Short title'})}));
 fireEvent.click(screen.getByRole('button',{name:'Remove shared cover'}));
 await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Previous artwork choices are restored.'));expect(onChanged).toHaveBeenCalledTimes(2);
});
it('does not allow a failed preview to be applied',async()=>{
 setup();render(<SharedCoverSearch albumId="album" artist="Artist" title="Album" csrf="csrf" onChanged={()=>{}}/>);
 const search=screen.getByRole('button',{name:'Search for cover'});await waitFor(()=>expect(search).toBeEnabled());fireEvent.click(search);
 fireEvent.click(await screen.findByRole('button',{name:/Found edition/}));fireEvent.error(screen.getByRole('img'));
 expect(screen.getByRole('alert')).toHaveTextContent('No preview available');expect(screen.getByRole('button',{name:'Use this cover for everyone'})).toBeDisabled();
});
it('explains when online search is disabled',async()=>{
 setup(false);render(<SharedCoverSearch albumId="album" artist="Artist" title="Album" csrf="csrf" onChanged={()=>{}}/>);
 expect(await screen.findByText(/Online search is disabled/)).toBeInTheDocument();expect(screen.getByRole('button',{name:'Search for cover'})).toBeDisabled();
});
it('limits shared cover controls to administrators while preserving personal artwork editing',async()=>{
 setup();account.role='listener';render(<AlbumArtworkEditor albumId="album" artist="Artist" title="Album"/>);
 fireEvent.click(screen.getByRole('button',{name:'Edit artwork'}));
 expect(screen.queryByRole('region',{name:'Cover search for everyone'})).not.toBeInTheDocument();expect(screen.getByText(/Personal artwork choices/)).toBeInTheDocument();
});
