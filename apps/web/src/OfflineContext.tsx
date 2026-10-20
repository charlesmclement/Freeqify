import {createContext,useContext,useEffect,useMemo,useState,type ReactNode} from 'react';
import type {AlbumDetail,PlaylistDetail,Track} from '@freeqify/shared';
import {useAccount} from './Authentication.js';
import {OfflineDownloads} from './offline-downloads.js';
import {storageInfo,type LocalCollection,type LocalTrack} from './offline-store.js';
import {accountRequest} from './auth-api.js';
import {readLibrary} from './library-api.js';
interface OfflineContextValue {manager:OfflineDownloads;tracks:LocalTrack[];collections:LocalCollection[];error:string;refresh:()=>Promise<void>;select:(kind:LocalCollection['kind'],id:string,name:string,tracks?:Track[])=>Promise<void>;}
const Context=createContext<OfflineContextValue|null>(null);
export const useOffline=()=>useContext(Context);
export function OfflineProvider({children}:{children:ReactNode}){const account=useAccount();return account.state?.user?<OfflineSession key={account.state.user.id}>{children}</OfflineSession>:children;}
function OfflineSession({children}:{children:ReactNode}){
 const account=useAccount();const user=account.state!.user!.id;const [tracks,setTracks]=useState<LocalTrack[]>([]);const [collections,setCollections]=useState<LocalCollection[]>([]);const [error,setError]=useState('');
 const manager=useMemo(()=>new OfflineDownloads(user,()=>window.dispatchEvent(new Event('freeqify:downloads-changed'))),[user]);
 async function refresh(){try{const data=await manager.store.list();setTracks(old=>stableTracks(old,data.tracks));setCollections(old=>JSON.stringify(old)===JSON.stringify(data.collections)?old:data.collections);setError('');}catch(e){setError(e instanceof Error?e.message:'Device storage is unavailable.');}}
 useEffect(()=>{let active=true;const refresh=()=>{if(document.hidden)return;void manager.store.list().then(data=>{if(active){setTracks(old=>stableTracks(old,data.tracks));setCollections(old=>JSON.stringify(old)===JSON.stringify(data.collections)?old:data.collections);setError('');}}).catch(e=>{if(active)setError(e instanceof Error?e.message:'Device storage is unavailable.');});};refresh();window.addEventListener('freeqify:downloads-changed',refresh);document.addEventListener('visibilitychange',refresh);const timer=setInterval(refresh,3000);return()=>{active=false;clearInterval(timer);window.removeEventListener('freeqify:downloads-changed',refresh);document.removeEventListener('visibilitychange',refresh);};},[manager]);
 useEffect(()=>{if(account.offline)return;const start=()=>manager.activate();start();window.addEventListener('online',start);return()=>{window.removeEventListener('online',start);manager.dispose();};},[manager,account.offline]);
 // Dispose even when opened directly in local-only mode.
 useEffect(()=>()=>manager.dispose(),[manager]);
 async function select(kind:LocalCollection['kind'],id:string,name:string,provided?:Track[]){const generation=manager.generation;if(account.offline)throw new Error('Reconnect and sign in to download more music.');if(!navigator.locks)throw new Error('Update your browser to enable safe download coordination.');await storageInfo();await navigator.storage.persist?.().catch(()=>false);let tracks=provided??[];
  if(kind==='album'&&!provided)tracks=(await readLibrary<AlbumDetail>(`albums/${encodeURIComponent(id)}`,new AbortController().signal)).tracks;
  if(kind==='playlist'){tracks=[];let offset:number|null=0;let revision:number|undefined;while(offset!==null){const page:PlaylistDetail=await accountRequest(`personal/playlists/${encodeURIComponent(id)}?offset=${offset}&limit=48`);if(revision!==undefined&&revision!==page.playlist.revision)throw new Error('Playlist changed during download selection. Try again.');revision=page.playlist.revision;tracks.push(...page.items.map(item=>item.track));const next=page.nextOffset??null;if(next!==null&&next<=offset)throw new Error('Invalid playlist pagination.');offset=next;if(tracks.length>5000)throw new Error('A download selection supports up to 5,000 tracks.');}}
  if(!tracks.length)throw new Error('No tracks available to download.');
  const previous=(await manager.store.list()).collections.find(c=>c.id===`${kind}:${id}`);
  if(kind==='playlist'&&previous&&!window.confirm('Update this offline playlist snapshot to its current server tracks?'))return;
  await manager.select({id:`${kind}:${id}`,kind,name,tracks:tracks.map(t=>t.id),savedAt:Date.now()},tracks,generation);await refresh();
 }
 return <Context value={{manager,tracks,collections,error:error||manager.error,refresh,select}}>{children}</Context>;
}

/** Reuse unchanged Blob handles so cross-tab polling does not reload every saved cover. */
function stableTracks(old:LocalTrack[],next:LocalTrack[]){const previous=new Map(old.map(t=>[t.id,t]));const stable=next.map(t=>{const p=previous.get(t.id);return p&&p.artwork?.size===t.artwork?.size&&p.artwork?.type===t.artwork?.type&&JSON.stringify({...p,artwork:undefined})===JSON.stringify({...t,artwork:undefined})?p:t;});return stable.length===old.length&&stable.every((t,i)=>t===old[i])?old:stable;}
