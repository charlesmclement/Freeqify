import {useHistoryOverlay} from './navigation.js';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { PersonalSummary, Track } from '@freeqify/shared';
import { useAccount } from './Authentication.js';
import { accountRequest } from './auth-api.js';
const empty: PersonalSummary = {playlists:[],favoriteIds:[],generation:0};
interface PersonalContextValue { summary: PersonalSummary; revision: number; loading: boolean; error: string; refresh: () => Promise<void>; mutate: <T>(path: string,input: unknown) => Promise<T>; choose: (track: Track) => void }
const Context = createContext<PersonalContextValue | null>(null);
export const usePersonal = () => useContext(Context);
export function PersonalProvider({children}: {children: ReactNode}) {
  const account = useAccount(); return account.state?.user ? <PersonalSession key={account.state.user.id}>{children}</PersonalSession> : children;
}
function PersonalSession({children}: {children: ReactNode}) {
  const account = useAccount(); const [summary,setSummary] = useState(empty); const [revision,setRevision] = useState(0); const [selected,setSelected] = useHistoryOverlay<Track>('addPlaylist');
  const alive = useRef(true); const [loading,setLoading]=useState(!account.offline); const [error,setError]=useState('');
  async function refresh() {
    let data:PersonalSummary; try {data=await accountRequest<PersonalSummary>('personal/summary');}catch(reason){if(alive.current&&!account.offline)setError('Your personal library could not be loaded.');throw reason;}
    if (alive.current && Array.isArray(data.playlists) && Array.isArray(data.favoriteIds) && Number.isSafeInteger(data.generation)) { setError('');setLoading(false);setSummary(data); setRevision(n=>n+1); }
  }
  useEffect(() => { alive.current=true; const controller=new AbortController();
    if(account.offline)return ()=>controller.abort();
    void accountRequest<PersonalSummary>('personal/summary',undefined,undefined,controller.signal).then(data=>{ if (!controller.signal.aborted && Array.isArray(data.playlists) && Array.isArray(data.favoriteIds)) {setSummary(data);setLoading(false);} }).catch(()=>{if(!controller.signal.aborted){setLoading(false);setError('Your personal library could not be loaded.');}});
    return ()=>{ alive.current=false; controller.abort(); };
  },[account.offline]);
  async function mutate<T>(path: string,input: unknown): Promise<T> {
    if(account.offline)throw new Error('Reconnect to change server collections.');
    const result = await accountRequest<T>(`personal/${path}`,account.state!.csrf,input); await refresh().catch(()=>{}); return result;
  }
  return <Context value={{summary,revision,loading,error,refresh,mutate,choose:setSelected}}>{children}{selected && <AddDialog track={selected} close={()=>setSelected(null)} />}</Context>;
}
function AddDialog({track,close}: {track: Track; close: ()=>void}) {
  const personal=usePersonal()!; const dialog=useRef<HTMLDialogElement>(null);
  const [choice,setChoice]=useState(personal.summary.playlists[0]?.id ?? 'new'); const [name,setName]=useState(''); const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
  useEffect(()=>{ const element=dialog.current!; if (element.showModal) element.showModal(); else element.setAttribute('open',''); return ()=>{element.close?.();}; },[]);
  return <dialog ref={dialog} className="personal-dialog" aria-labelledby="add-playlist-title" onCancel={close}><h2 id="add-playlist-title">Add to playlist</h2><p>{track.title}</p><form onSubmit={event=>{event.preventDefault(); setBusy(true);setError('');void (async()=>{
    let id=choice; if (id==='new') {id=(await personal.mutate<{id:string}>('playlists',{name})).id;setChoice(id);}
    await personal.mutate(`playlists/${id}/tracks`,{source:'local',trackId:track.id});close();
  })().catch(reason=>setError(reason instanceof Error ? reason.message : 'Could not add song.')).finally(()=>setBusy(false));}}>
    <label>Playlist<select value={choice} onChange={event=>setChoice(event.target.value)}>{personal.summary.playlists.map(p=><option key={p.id} value={p.id}>{p.name} ({p.count})</option>)}<option value="new">Create a new playlist…</option></select></label>
    {choice==='new' && <label>New playlist name<input required maxLength={100} value={name} onChange={event=>setName(event.target.value)} /></label>}
    {error && <p role="alert" className="account-error">{error}</p>}<div className="personal-actions"><button type="submit" disabled={busy}>{busy?'Adding…':'Add song'}</button><button type="button" onClick={close} disabled={busy}>Cancel</button></div>
  </form></dialog>;
}
