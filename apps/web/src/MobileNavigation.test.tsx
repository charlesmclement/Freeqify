// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {App} from './App.js';
import {emptyPlayback,type Album,type Track} from '@freeqify/shared';
const album:Album={id:'actual-album',title:'Catalog Album',artist:'Catalog Artist',artistId:'artist',artworkId:null,trackCount:1,year:2024};
const track:Track={id:'song',title:'History Song',artist:'Catalog Artist',album:'Catalog Album',albumId:album.id,artworkId:null,duration:100,format:'mp3',trackNumber:1};
beforeEach(()=>{localStorage.clear();window.history.replaceState(null,'','/');vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue();vi.stubGlobal('scrollTo',vi.fn());});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function setup(role='listener'){
 const fetcher=vi.fn(async(url:string)=>{
  const path=url.replace('/api/','');
  const data=path==='auth/session'?{user:{id:'mobile',username:'listener',role,status:'active',createdAt:1},csrf:'a'.repeat(64),expiresAt:Date.now()+3600000}
   :path==='health'?{status:'ok',service:'freeqify',phase:0}
   :path==='playback'?emptyPlayback()
   :path==='personal/summary'?{playlists:[],favoriteIds:['song'],generation:0}
   :path==='imports/'?{items:[]}:path==='imports/lidarr'?{configured:false,connected:false,canRequest:false,message:'Not configured'}
   :path.startsWith('personal/history')?{items:[{id:'event',source:'local',trackId:'song',track,available:true,playedAt:1}]}
   :path==='library/overview'?{tracks:17,albums:3,artists:2,scanning:false}
   :path.startsWith('admin/')?{items:[]}
   :path==='library/artists'?{items:[{id:'artist',name:'Catalog Artist',albumCount:1,artworkId:null}]}
   :path.startsWith('library/albums?')?{items:[album],nextOffset:null}
   :path==='library/albums/actual-album'?{album,tracks:[track]}
   :path.startsWith('library/search?')?{artists:[],albums:[album],tracks:[]}:{};
  return {ok:true,json:async()=>data};
 });vi.stubGlobal('fetch',fetcher);render(<App/>);return fetcher;
}
it('uses real response counts, personal history, and the existing artwork API on Home',async()=>{
 setup();expect(await screen.findByText('17')).toBeVisible();
 expect(await screen.findByText('History Song')).toBeVisible();
 expect(screen.getByRole('button',{name:'1 Favorites'})).toBeVisible();
 expect(document.querySelector('img[src^="/api/library/artwork/album/actual-album"]')).toBeTruthy();
 expect(screen.queryByText('Midnight Drive')).not.toBeInTheDocument();
});
it('navigates Home, Library categories, Search, Playlists, and More without replacing audio',async()=>{
 setup();const nav=await screen.findByRole('navigation',{name:'Mobile navigation'});
 const audio=document.querySelector('audio');
 fireEvent.click(within(nav).getByRole('button',{name:'Library'}));
 expect(await screen.findByRole('heading',{name:'Your Library'})).toBeVisible();
 expect(within(nav).getByRole('button',{name:'Library'})).toHaveAttribute('aria-current','page');
 fireEvent.click(within(screen.getByRole('navigation',{name:'Music library'})).getByRole('button',{name:'Artists'}));
 expect(await screen.findByText('Catalog Artist')).toBeVisible();
 fireEvent.click(within(nav).getByRole('button',{name:'Search'}));
 fireEvent.change(screen.getByRole('searchbox'),{target:{value:'Catalog'}});
 fireEvent.click(screen.getByRole('button',{name:'Search library'}));
 expect(await screen.findByRole('heading',{name:'Albums'})).toBeVisible();
 fireEvent.click(within(nav).getByRole('button',{name:'Playlists'}));
 expect(await screen.findByText(/haven't created any playlists/)).toBeVisible();
 fireEvent.click(within(nav).getByRole('button',{name:'Tools'}));
 fireEvent.click(await screen.findByRole('button',{name:'More & account'}));
 expect(await screen.findByRole('heading',{name:'Your account'})).toBeVisible();
 expect(screen.queryByRole('button',{name:'Administration & artwork manager'})).not.toBeInTheDocument();
 expect(document.querySelector('audio')).toBe(audio);
 fireEvent.click(within(nav).getByRole('button',{name:'Home'}));
 expect(await screen.findByText('17')).toBeVisible();
});
it('keeps administration available to administrators through More',async()=>{
 setup('admin');const nav=await screen.findByRole('navigation',{name:'Mobile navigation'});
 fireEvent.click(within(nav).getByRole('button',{name:'Tools'}));
 fireEvent.click(await screen.findByRole('button',{name:'More & account'}));
 fireEvent.click(await screen.findByRole('button',{name:'Administration & artwork manager'}));
 expect(await screen.findByRole('heading',{name:'Invitations & listeners'})).toBeVisible();
 expect(window.scrollTo).toHaveBeenLastCalledWith({top:0});
});
it('uses server pagination and sorting for albums without enumerating the library',async()=>{
 const fetcher=setup();const nav=await screen.findByRole('navigation',{name:'Mobile navigation'});
 fireEvent.click(within(nav).getByRole('button',{name:'Library'}));
 fireEvent.change(screen.getByRole('combobox',{name:'Sort albums'}),{target:{value:'alphabeticalByArtist'}});
 await waitFor(()=>expect(fetcher).toHaveBeenCalledWith('/api/library/albums?offset=0&limit=48&sort=alphabeticalByArtist',expect.anything()));
 expect(fetcher.mock.calls.some(([url])=>url.includes('limit=8&sort=newest'))).toBe(true);
 expect(fetcher.mock.calls.some(([url])=>url.includes('limit=5000'))).toBe(false);
});

it('opens a real album from Jump back in and returns to the Home dashboard',async()=>{
 setup();await screen.findByText('History Song');
 const albumButton=document.querySelector('.jump-section .carousel-card');expect(albumButton).toBeTruthy();
 fireEvent.click(albumButton!);
 expect(await screen.findByRole('heading',{name:'Catalog Album'})).toBeVisible();
 expect(screen.getByRole('button',{name:'Play album'})).toBeEnabled();
 fireEvent.click(screen.getByRole('button',{name:'← Back to overview'}));
 expect(await screen.findByText('17')).toBeVisible();
});
