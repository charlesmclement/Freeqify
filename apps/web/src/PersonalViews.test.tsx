// @vitest-environment jsdom
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { AccountProvider } from './Authentication.js';
import { PersonalProvider } from './PersonalContext.js';
import { Playback } from './Player.js';
import { PersonalView, type PersonalViewName } from './PersonalViews.js';
import { TrackActions } from './TrackActions.js';
import { emptyPlayback, type PersonalTrack, type PlaylistSummary, type Track } from '@freeqify/shared';
const song:Track={id:'t1',title:'First song',artist:'Artist',album:'Album',albumId:'al',artworkId:null,format:'mp3',duration:100,trackNumber:1};
const second={...song,id:'t2',title:'Second song'};
beforeEach(()=>{localStorage.clear();window.history.replaceState(null,'','/');vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue();});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function fixture(view:PersonalViewName='Playlists',missing=false,count=0){
 let playlist:PlaylistSummary|null=null;let favorites=false;let items:PersonalTrack[]=[];let generation=0;
 if(count){favorites=true;playlist={id:'mix',name:'Large mix',count,duration:count*100,artworkId:null,revision:0,updatedAt:1};items=Array.from({length:count},(_,i)=>({id:`e${i}`,source:'local',trackId:`large-${i}`,track:{...song,id:`large-${i}`,title:`Large song ${i}`},available:true}));}
 const fetcher=vi.fn().mockImplementation(async(url:string,options?:RequestInit)=>{
  const path=url.replace('/api/','');const params=new URL(url,'http://localhost').searchParams;const pageOffset=Number(params.get('offset')??0);const body=options?.body?JSON.parse(String(options.body)):null;let result:unknown={ok:true};
  if(path==='auth/session')result={user:{id:'u',username:'listener',role:'listener',status:'active',createdAt:0},csrf:'a'.repeat(64),expiresAt:Date.now()+3600000};
  else if(path==='playback')result=emptyPlayback();
  else if(path==='personal/summary')result={playlists:playlist?[playlist]:[],favoriteIds:count?items.map(t=>t.trackId):favorites?['t1']:[],generation};
  else if(path==='personal/playlists'&&body){playlist={id:'mix',name:body.name,count:0,duration:0,artworkId:null,revision:0,updatedAt:1};result={id:'mix'};}
  else if(path.startsWith('personal/playlists/mix?'))result={playlist,items:items.slice(pageOffset,pageOffset+48),nextOffset:pageOffset+48<items.length?pageOffset+48:null};
  else if(path==='personal/playlists/mix/tracks'){items.push({id:`e${items.length}`,source:'local',trackId:body.trackId,track:body.trackId==='t1'?song:second,available:!missing});if(playlist){playlist={...playlist,count:items.length,duration:items.length*100,revision:playlist.revision+1};}}
  else if(path==='personal/playlists/mix/rename'){playlist={...playlist!,name:body.name};}
  else if(path==='personal/playlists/mix/delete'){playlist=null;items=[];}
  else if(path==='personal/playlists/mix/move'){const index=items.findIndex(e=>e.id===body.entryId);[items[index],items[index+body.direction]]=[items[index+body.direction]!,items[index]!];playlist={...playlist!,revision:playlist!.revision+1};}
  else if(path==='personal/playlists/mix/queue')result={items:items.map(({id,source,trackId})=>({id,source,trackId}))};
  else if(path==='personal/playlists/mix/reorder'){items=body.entries.map((id:string)=>items.find(e=>e.id===id));playlist={...playlist!,revision:playlist!.revision+1};}
  else if(path==='personal/playlists/mix/remove'){items=items.filter(e=>e.id!==body.entryId);playlist={...playlist!,count:items.length};}
  else if(path==='personal/favorites'&&body)favorites=body.enabled;
  else if(path.startsWith('personal/favorites?'))result=count?{items:items.slice(pageOffset,pageOffset+48),nextOffset:pageOffset+48<items.length?pageOffset+48:null}:{items:favorites?[{id:'t1',source:'local',trackId:'t1',track:song,available:!missing}]:[]};
  else if(path.startsWith('personal/history?'))result={items:generation?[]:[{id:'event',source:'local',trackId:'t1',track:song,available:!missing,position:35,playedAt:123456}],nextOffset:null};
  else if(path==='personal/history/clear'){generation++;result={generation};}
  else if(path.startsWith('library/tracks/'))result=path.includes('large-')?{...song,id:path.split('/').at(-1),title:`Large song ${path.split('-').at(-1)}`}:path.endsWith('t1')?song:second;
  return{ok:true,status:200,json:async()=>structuredClone(result)};
 });
 vi.stubGlobal('fetch',fetcher);
 function Views(){const [current,setCurrent]=useState(view);return<><button onClick={()=>setCurrent('Playlists')}>View playlists</button><button onClick={()=>setCurrent('Favorites')}>View favorites</button><button onClick={()=>setCurrent('Recently played')}>View history</button><TrackActions track={song}/><TrackActions track={second}/><PersonalView key={current} view={current}/></>;}
 render(<AccountProvider><PersonalProvider><Playback><Views/></Playback></PersonalProvider></AccountProvider>);return fetcher;
}
it('creates, renames and confirms deletion through the existing personal view',async()=>{fixture();expect(await screen.findByText(/You haven't created/)).toBeVisible();fireEvent.change(screen.getByLabelText('Playlist name'),{target:{value:'My mix'}});fireEvent.click(screen.getByRole('button',{name:'Create playlist'}));fireEvent.click(await screen.findByRole('button',{name:/My mix/}));await screen.findByRole('button',{name:'Rename playlist'});fireEvent.change(screen.getByLabelText('Playlist name'),{target:{value:'Renamed'}});fireEvent.click(screen.getByRole('button',{name:'Rename playlist'}));await screen.findByRole('heading',{name:'Renamed'});fireEvent.click(screen.getByRole('button',{name:'Delete playlist'}));expect(screen.getByRole('alertdialog')).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'Cancel'}));expect(screen.queryByRole('alertdialog')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Delete playlist'}));fireEvent.click(screen.getByRole('button',{name:'Confirm delete'}));expect(await screen.findByText(/You haven't created/)).toBeVisible();});
it('creates from Add to Playlist, retains duplicates, reorders, plays/shuffles and queues with one audio element',async()=>{fixture();await waitFor(()=>expect(screen.getByRole('button',{name:'Favorite First song'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Add First song'}));fireEvent.click(screen.getByRole('menuitem',{name:'Add to Playlist'}));let dialog=screen.getByRole('dialog');fireEvent.change(within(dialog).getByLabelText('New playlist name'),{target:{value:'New mix'}});fireEvent.click(within(dialog).getByRole('button',{name:'Add song'}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());for(const title of ['Second song','First song']){fireEvent.click(screen.getByRole('button',{name:`Add ${title}`}));fireEvent.click(screen.getByRole('menuitem',{name:'Add to Playlist'}));dialog=screen.getByRole('dialog');fireEvent.click(within(dialog).getByRole('button',{name:'Add song'}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());}fireEvent.click(screen.getByRole('button',{name:/New mix/}));await screen.findByText(/3 songs/);const audio=document.querySelector('audio');fireEvent.click(screen.getByRole('button',{name:'Move Second song up'}));await waitFor(()=>expect(document.querySelector('.personal-tracks li')).toHaveTextContent('Second song'));fireEvent.click(screen.getByRole('button',{name:'Play all'}));await waitFor(()=>expect(document.querySelector('audio')?.src).toContain('/stream/t2'));fireEvent.click(screen.getByRole('button',{name:'Shuffle play'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Shuffle'})).toHaveAttribute('aria-pressed','true'));fireEvent.click(screen.getByRole('button',{name:'Add all to queue'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Hide playback queue'})).toBeVisible());expect(document.querySelector('audio')).toBe(audio);});
it('favorites show hearts and retain missing songs until explicitly unfavorited',async()=>{fixture('Favorites',true);await waitFor(()=>expect(screen.getByRole('button',{name:'Favorite First song'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Favorite First song'}));await screen.findByText(/Media unavailable/);expect(screen.getAllByRole('button',{name:'Unfavorite First song'})[0]).toHaveAttribute('aria-pressed','true');expect(screen.getByRole('button',{name:'First song'})).toBeDisabled();fireEvent.click(screen.getAllByRole('button',{name:'Unfavorite First song'})[0]!);expect(await screen.findByText(/No favorite songs yet/)).toBeVisible();});
it('resumes private history and requires confirmation before clearing it',async()=>{const fetcher=fixture('Recently played');await screen.findByRole('button',{name:'Resume'});fireEvent.click(screen.getByRole('button',{name:'Resume'}));await waitFor(()=>expect(document.querySelector('audio')?.src).toContain('/stream/t1'));fireEvent.click(screen.getByRole('button',{name:'Clear listening history'}));expect(fetcher.mock.calls.some(([url])=>String(url).endsWith('/history/clear'))).toBe(false);fireEvent.click(screen.getByRole('button',{name:'Confirm clear'}));expect(await screen.findByText(/You haven't played/)).toBeVisible();expect(screen.getByRole('button',{name:'Show playback queue'})).toBeVisible();});

it('renders only a page of a 5,000-track playlist/queue and fetches metadata lazily',async()=>{
 const fetcher=fixture('Playlists',false,5000);fireEvent.click(await screen.findByRole('button',{name:/Large mix/}));
 await screen.findByRole('button',{name:'Large song 0'});expect(document.querySelectorAll('.personal-tracks li')).toHaveLength(48);expect(screen.queryByRole('button',{name:'Large song 48'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'More songs'}));await screen.findByRole('button',{name:'Large song 48'});expect(document.querySelectorAll('.personal-tracks li')).toHaveLength(48);
 fireEvent.click(screen.getByRole('button',{name:'Large song 48'}));await waitFor(()=>expect(document.querySelector('audio')?.src).toContain('/stream/large-48'));
 expect(screen.getByRole('button',{name:'Hide playback queue'})).toBeVisible();
 await waitFor(()=>expect(fetcher.mock.calls.some(([url])=>String(url).includes('library/tracks/large-48'))).toBe(true));
 expect(fetcher.mock.calls.filter(([url])=>String(url).includes('library/tracks/')).length).toBeLessThanOrEqual(49);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Hide playback queue'})).toBeVisible());await waitFor(()=>expect(document.querySelectorAll('.player-queue li')).toHaveLength(49));
 fireEvent.click(screen.getByRole('button',{name:'Next queue page'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Actions for Large song 97'})).toBeVisible());expect(document.querySelectorAll('.player-queue li')).toHaveLength(49);
 expect(fetcher.mock.calls.filter(([url])=>String(url).includes('library/tracks/')).length).toBeLessThan(110);
 expect(document.querySelectorAll('audio')).toHaveLength(1);
},60000);

it('pages 5,000 favorites without mounting the whole collection',async()=>{
 fixture('Favorites',false,5000);await screen.findByRole('button',{name:'Large song 0'});expect(document.querySelectorAll('.personal-tracks li')).toHaveLength(48);
 fireEvent.click(screen.getByRole('button',{name:'More songs'}));await screen.findByRole('button',{name:'Large song 48'});expect(document.querySelectorAll('.personal-tracks li')).toHaveLength(48);expect(screen.queryByRole('button',{name:'Large song 0'})).toBeNull();
},15000);

vi.mock('./song-buffer.js',()=>({SongTooLarge:class extends Error{},SongBuffer:class{retain(){}clear(){}has(){return false;}source(){return 'server';}get(_key:string,source:string){return Promise.resolve(`blob:${source}`);}}}));
