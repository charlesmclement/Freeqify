// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {PlaylistImport} from './PlaylistImport.js';
import type {ImportEntry,ImportPage,Track,LidarrQueue} from '@freeqify/shared';
const {play,refresh}=vi.hoisted(()=>({play:vi.fn(),refresh:vi.fn().mockResolvedValue(undefined)}));
vi.mock('./Player.js',()=>({usePlayer:()=>({play})}));
vi.mock('./Authentication.js',()=>({useAccount:()=>({state:{user:{id:'owner',role:'admin'},csrf:'test-csrf'}})}));
vi.mock('./PersonalContext.js',()=>({usePersonal:()=>({refresh})}));
vi.mock('./AlbumArtwork.js',()=>({AlbumArtwork:({label}:{label:string})=><span role="img" aria-label={label}/> }));
const track:Track={id:'local',title:'Song',artist:'Artist',album:'Album',albumId:'album',duration:100,format:'mp3',trackNumber:1,artworkId:null};
const entry=(id:string,position:number,status:ImportEntry['status']):ImportEntry=>({id,position,status,checkedAt:1,reason:'Confirm the version',metadata:{title:'Song',artist:'Artist',album:'Album',albumArtist:'Artist',duration:100,isrc:null,spotifyTrackId:null,spotifyAlbumId:null,discNumber:1,trackNumber:1,releaseDate:null},track:status==='available'?track:null,candidates:status==='review'?[track]:[]});
const data:ImportPage={playlist:{id:'import',name:'My exported playlist',count:4,updatedAt:1,counts:{available:2,missing:1,review:1,requested:0}},items:[entry('first',1,'available'),entry('second',2,'available'),entry('third',3,'missing'),entry('fourth',4,'review')],nextOffset:null};
beforeEach(()=>{vi.clearAllMocks();});afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function setup(reviewResponse?:()=>Promise<unknown>){let queue:LidarrQueue|null=null;const album={key:'third',title:'Album',artist:'Artist',tracks:1,candidates:[{id:'album-id',title:'Album',artist:'Artist',year:2020,monitored:false,present:false,canRequest:true}]};const fetcher=vi.fn(async(url:string,init?:RequestInit)=>{
 const path=url.replace('/api/imports/','');let result:unknown={ok:true};
 if(path==='')result=init?.method==='POST'?{id:'import',count:4}:{items:[data.playlist]};
 else if(path==='lidarr')result={configured:true,connected:true,canRequest:true,message:'Lidarr connected'};
 else if(path.startsWith('import?')){const q=new URLSearchParams(path.split('?')[1]);result={...data,items:q.get('status')?data.items.filter(e=>e.status===q.get('status')):data.items};}
 else if(path==='import/albums/queue'&&init?.method==='POST'&&reviewResponse)return await reviewResponse();
 else if(path==='import/albums/queue'){if(init?.method==='POST')queue={id:'queue',total:1,counts:{pending:1,review:0,queued:0,confirmed:0,skipped:0,failed:0},albums:[],failures:[]};result=queue;}
 else if(path==='import/albums/queue/step'){queue=queue!.counts.pending?{...queue!,counts:{...queue!.counts,pending:0,review:1},albums:[album]}:{...queue!,counts:{...queue!.counts,queued:0,confirmed:1}};result=queue;}
 else if(path==='import/albums/queue/confirm'){queue={...queue!,counts:{...queue!.counts,review:0,queued:1},albums:[]};result=queue;}
 else if(path==='import/albums/review')result={id:'review',expiresAt:Date.now()+600000,albums:[{key:'third',title:'Album',artist:'Artist',tracks:1,candidates:[{id:'album-id',title:'Album',artist:'Artist',year:2020,monitored:false,present:false,canRequest:true}]}]};
 else if(path==='import/albums/confirm')result={submitted:1};
 else if(path==='import/playlist')result={id:'created',existing:false};
 else if(path==='import/recheck')result={checked:4,nextOffset:null};
 return {ok:true,json:async()=>result};
 });vi.stubGlobal('fetch',fetcher);render(<PlaylistImport onMore={vi.fn()}/>);return fetcher;}
it('renders real response counts, preserves duplicate row positions and uses the existing player',async()=>{
 setup();const list=await screen.findByRole('list',{name:'Imported track checklist'});expect(within(list).getAllByRole('listitem')).toHaveLength(4);expect(within(list).getAllByText('Song')).toHaveLength(4);expect(screen.getByText('4 tracks · Original playlist order preserved')).toBeVisible();fireEvent.click(screen.getAllByRole('button',{name:'Play Song'})[1]!);expect(play).toHaveBeenCalledWith([track]);expect(screen.getByRole('button',{name:/Record Clips/})).toBeDisabled();
});
it('requires a separate album review and explicit confirmation; search starts off',async()=>{
 const fetcher=setup();await screen.findByRole('list',{name:'Imported track checklist'});fireEvent.click(screen.getByRole('checkbox',{name:'Select track 3: Song'}));fireEvent.click(screen.getByRole('button',{name:/Add missing music/}));const dialog=await screen.findByRole('dialog',{name:'Missing music queue'});expect(await within(dialog).findByRole('checkbox',{name:'Automatic search'})).not.toBeChecked();expect(fetcher.mock.calls.some(([url])=>url.endsWith('/confirm'))).toBe(false);expect(within(dialog).getByRole('button',{name:'Confirm 0 selected albums'})).toBeDisabled();await waitFor(()=>expect(within(dialog).getByRole('radio')).toBeEnabled());fireEvent.click(within(dialog).getByRole('radio'));fireEvent.click(within(dialog).getByRole('button',{name:'Confirm 1 selected albums'}));await waitFor(()=>expect(fetcher).toHaveBeenCalledWith('/api/imports/import/albums/queue/confirm',expect.objectContaining({body:JSON.stringify({queueId:'queue',confirmed:true,search:false,choices:[{key:'third',albumId:'album-id'}],skip:[]})})));expect(await screen.findByText(/Queue complete/)).toBeVisible();
});
it('shows candidates in a review dialog and sends only an explicit confirmed choice',async()=>{
 const fetcher=setup();await screen.findByRole('list',{name:'Imported track checklist'});fireEvent.click(screen.getByRole('button',{name:'Review match for Song'}));const dialog=await screen.findByRole('dialog',{name:'Review library match'});expect(fetcher.mock.calls.some(([url])=>url.endsWith('/review')&&url.includes('import/review'))).toBe(false);fireEvent.click(within(dialog).getByRole('button',{name:'Use this recording'}));await waitFor(()=>expect(fetcher).toHaveBeenCalledWith('/api/imports/import/review',expect.objectContaining({body:JSON.stringify({entryId:'fourth',action:'confirm',trackId:'local'})})));
});
it('creates a playable playlist independently of Lidarr and keeps the checklist',async()=>{const fetcher=setup();await screen.findByRole('list',{name:'Imported track checklist'});fireEvent.click(screen.getByRole('button',{name:'Create playlist with 2 available tracks'}));expect(await screen.findByText(/Freeqify playlist created/)).toBeVisible();expect(refresh).toHaveBeenCalled();expect(screen.getByRole('list',{name:'Imported track checklist'})).toBeVisible();expect(fetcher.mock.calls.some(([url,init])=>url.includes('albums/')&&init?.method==='POST')).toBe(false);});
it('imports actual selected CSV text with its filename without Spotify authentication',async()=>{const fetcher=setup();await screen.findByRole('list',{name:'Imported track checklist'});const csv='Title,Artist,Album\nSong,Artist,Album';const file=new File([csv],'test.csv',{type:'text/csv'});Object.defineProperty(file,'arrayBuffer',{value:async()=>new TextEncoder().encode(csv).buffer});fireEvent.change(screen.getByLabelText('Import CSV playlists'),{target:{files:[file]}});await waitFor(()=>expect(fetcher).toHaveBeenCalledWith('/api/imports/',expect.objectContaining({method:'POST',body:JSON.stringify({filename:'test.csv',name:'test',csv})})));expect(await screen.findByText('Playlist imports saved.')).toBeVisible();});

it('opens feedback immediately and keeps lookup errors visible inside the dialog',async()=>{
 let finish!:(value:unknown)=>void;
 setup(()=>new Promise(resolve=>{finish=resolve;}));
 await screen.findByRole('list',{name:'Imported track checklist'});
 fireEvent.click(screen.getByRole('checkbox',{name:'Select track 3: Song'}));
 fireEvent.click(screen.getByRole('button',{name:/Add missing music/}));
 const dialog=await screen.findByRole('dialog',{name:'Missing music queue'});
 expect(within(dialog).getByRole('status')).toHaveTextContent('Saving selected albums');
 finish({ok:false,status:400,json:async()=>({error:{message:'Review up to 10 albums at a time.'}})});
 expect(await within(dialog).findByRole('alert')).toHaveTextContent('Review up to 10 albums at a time.');
 expect(within(dialog).queryByRole('status')).not.toBeInTheDocument();
 fireEvent.click(within(dialog).getByRole('button',{name:'Close dialog'}));
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
