import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Lidarr} from './lidarr.js';
import {readConfig} from '../config.js';
import type {ImportedMetadata} from '@freeqify/shared';
const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const cleanup:string[]=[];afterEach(async()=>{for(const p of cleanup.splice(0))await rm(p,{recursive:true,force:true});});
async function fixture(options:{existing?:boolean;root?:boolean;newArtist?:boolean;populateAlbums?:boolean;fail?:boolean}={}){
 const dir=await mkdtemp(join(tmpdir(),'freeqify-lidarr-test-'));cleanup.push(dir);const key=join(dir,'key');await writeFile(key,'disposable-test-key',{mode:0o600});let monitored=!!options.existing,added=false;
 const artist={id:1,artistName:'Artist',foreignArtistId:'11111111-2222-3333-4444-555555555555',qualityProfileId:7,metadataProfileId:8,path:'/existing-operator-location'};
 const album={id:10,title:'Album',foreignAlbumId:id,artist,artistId:1,monitored,statistics:{trackFileCount:0}};
 const fetcher=vi.fn(async(url:URL|RequestInfo,init?:RequestInit)=>{
  if(options.fail)return new Response('{}',{status:500});const path=new URL(String(url)).pathname.split('/api/v1/')[1];let result:unknown={};
  if(path==='album')result=album;else if(path==='album/lookup')result=[album];else if(path==='artist'){if(init?.method==='POST'){added=true;result={...artist,monitored:false};}else result=options.newArtist&&!added?[]:[artist];}else if(path==='artist/1')result={...artist,monitored:true};else if(path==='rootfolder')result=options.root?[{id:3,path:'/configured-root',defaultQualityProfileId:7,defaultMetadataProfileId:8,defaultTags:[2]}]:[];else if(path==='album/monitor'){monitored=true;result=[];}
  if(path==='album'&&new URL(String(url)).searchParams.has('foreignAlbumId'))result=options.existing||monitored||(options.populateAlbums&&added)?[{...album,monitored}]:[];
  if(path==='album'&&init?.method==='POST'){monitored=true;result={...album,monitored:true};}
  return Response.json(result);
 });
 return {adapter:new Lidarr({url:'http://127.0.0.1:8989/',apiKeyFile:key,rootFolderId:options.root?3:null},fetcher as typeof fetch),fetcher};
}
it('leaves imports usable when unconfigured or disconnected',async()=>{expect((await new Lidarr({url:'',apiKeyFile:'',rootFolderId:null}).status()).configured).toBe(false);const f=await fixture({fail:true});expect((await f.adapter.status()).connected).toBe(false);});
it('reuses existing artist settings, monitors only the reviewed album, and defaults to no search',async()=>{
 const f=await fixture();await f.adapter.request(id,false);const post=f.fetcher.mock.calls.find(([,i])=>i?.method==='POST'&&String(i.body).includes('searchForNewAlbum'));expect(post).toBeTruthy();const body=JSON.parse(String(post![1]!.body));expect(body.artist.qualityProfileId).toBe(7);expect(body.artist.metadataProfileId).toBe(8);expect(body.artist.path).toBe('/existing-operator-location');expect(body.addOptions.searchForNewAlbum).toBe(false);expect(f.fetcher.mock.calls.some(([u])=>String(u).endsWith('/command'))).toBe(false);expect(f.fetcher.mock.calls.every(([,i])=>i?.redirect==='error'&&(i.headers as Record<string,string>)['X-Api-Key']==='disposable-test-key')).toBe(true);
});
it('does not duplicate monitored albums or repeat automatic searches on retry',async()=>{const f=await fixture({existing:true});await f.adapter.request(id,true);expect(f.fetcher.mock.calls.every(([,i])=>i?.method==='GET')).toBe(true);});
it('only searches the selected album when explicitly requested',async()=>{const f=await fixture();await f.adapter.request(id,true);const calls=f.fetcher.mock.calls.filter(([u])=>String(u).endsWith('/command'));expect(calls).toHaveLength(1);expect(JSON.parse(String(calls[0]![1]!.body))).toEqual({name:'AlbumSearch',albumIds:[10]});});
it('sanitizes failures rather than exposing upstream response bodies or API keys',async()=>{const f=await fixture({fail:true});await expect(f.adapter.request(id,false)).rejects.toThrow('Lidarr is unavailable');});
it('shows exact album candidates but requires human confirmation of the artist and edition',async()=>{const f=await fixture();const m:ImportedMetadata={title:'Song',artist:'Artist',album:'Album',albumArtist:'Artist',duration:null,isrc:null,spotifyTrackId:null,spotifyAlbumId:null,releaseDate:null,discNumber:null,trackNumber:null};const result=await f.adapter.lookup(m);expect(result).toEqual([{id,title:'Album',artist:'Artist',year:null,monitored:false,present:false,canRequest:true}]);expect(JSON.stringify(result)).not.toContain('operator-location');});
it.each(['https://example.com','http://127.0.0.1/?token=secret','http://user:pass@127.0.0.1','file:///tmp/lidarr'])('rejects unsafe Lidarr configuration %s',url=>expect(()=>readConfig({LIDARR_URL:url})).toThrow('LIDARR_URL'));

it('adds new artists only using explicitly selected root defaults and does not search or monitor their discography',async()=>{const f=await fixture({root:true,newArtist:true});await f.adapter.request(id,false);const add=f.fetcher.mock.calls.find(([u,i])=>String(u).endsWith('/artist')&&i?.method==='POST');const body=JSON.parse(String(add?.[1]?.body));expect(body.rootFolderPath).toBe('/configured-root');expect(body.addOptions).toEqual({monitor:'none',searchForMissingAlbums:false});expect(body.monitorNewItems).toBe('none');expect(f.fetcher.mock.calls.some(([u,i])=>String(u).endsWith('/artist/1')&&i?.method==='PUT')).toBe(true);});
it('requires operator setup for new artists instead of inventing music paths or profiles',async()=>{const f=await fixture({newArtist:true});await expect(f.adapter.request(id,false)).rejects.toThrow('Add this artist in Lidarr first');expect(f.fetcher.mock.calls.every(([,i])=>i?.method==='GET')).toBe(true);});

it('reuses albums populated automatically when adding an artist',async()=>{const f=await fixture({root:true,newArtist:true,populateAlbums:true});await f.adapter.request(id,true);expect(f.fetcher.mock.calls.some(([u,i])=>new URL(String(u)).pathname.endsWith('/album')&&i?.method==='POST')).toBe(false);expect(f.fetcher.mock.calls.filter(([u])=>String(u).endsWith('/album/monitor'))).toHaveLength(1);expect(f.fetcher.mock.calls.filter(([u])=>String(u).endsWith('/command'))).toHaveLength(1);});
