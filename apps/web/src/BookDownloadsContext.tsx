import {createContext,useContext,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import type {Audiobook} from '@freeqify/shared';
import {useAccount} from './Authentication.js';
import {accountRequest} from './auth-api.js';
import {libraryUrl} from './library-api.js';
import {BookDownloads,type DeviceBook} from './book-downloads.js';
const Context=createContext<{manager:BookDownloads;entries:DeviceBook[]}|null>(null);
export const useBookDownloads=()=>useContext(Context);
export function BookDownloadsProvider({children}:{children:ReactNode}){
 const account=useAccount(),current=useRef(account);useEffect(()=>{current.current=account;},[account]);
 const user=account.state?.user?.id;
 // The constructor stores these callbacks; it never invokes them during render.
 // eslint-disable-next-line react-hooks/refs
 const manager=useMemo(()=>user?new BookDownloads(user,id=>libraryUrl(`stream/${encodeURIComponent(id)}?format=raw`),async(id,revision,fields)=>(await accountRequest<{book:Audiobook}>(`audiobooks/${id}/offline-sync`,current.current.state!.csrf,{...fields,revision})).book,id=>accountRequest<Audiobook>(`audiobooks/${id}`),()=>!current.current.offline&&current.current.state?.user?.id===user,()=>window.dispatchEvent(new Event('freeqify:book-downloads-changed'))):null,[user]);
 const [snapshot,setSnapshot]=useState<{manager:BookDownloads;entries:DeviceBook[]}|null>(null);
 useEffect(()=>{if(!manager)return;let alive=true,version=0;manager.activate();const refresh=()=>{const n=++version;void manager.store.list().then(entries=>{if(alive&&n===version)setSnapshot({manager,entries});}).catch(()=>{});};const stop=()=>manager.dispose();const cancel=()=>manager.cancel();refresh();const timer=setInterval(refresh,3000);window.addEventListener('freeqify:book-downloads-changed',refresh);window.addEventListener('offline',cancel);window.addEventListener('freeqify:logout',stop);window.addEventListener('freeqify:unauthenticated',stop);return()=>{alive=false;manager.dispose();clearInterval(timer);window.removeEventListener('freeqify:book-downloads-changed',refresh);window.removeEventListener('offline',cancel);window.removeEventListener('freeqify:logout',stop);window.removeEventListener('freeqify:unauthenticated',stop);};},[manager]);
 return <Context value={manager?{manager,entries:snapshot?.manager===manager?snapshot.entries:[]}:null}>{children}</Context>;
}
