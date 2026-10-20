import {DownloadButton} from './DownloadButton.js';
import {useNavigationState,isNullableString,isOffset} from './navigation.js';
import { useEffect, useState, type ReactNode } from 'react';
import { AlbumArtwork } from './AlbumArtwork.js';
import { COLLECTION_LIMIT, PERSONAL_PAGE_SIZE, type MediaReference, type PersonalTrack, type PlaylistDetail } from '@freeqify/shared';
import { accountRequest } from './auth-api.js';
import { usePersonal } from './PersonalContext.js';
import { usePlayer } from './Player.js';
import { TrackActions } from './TrackActions.js';
import { duration } from './duration.js';
export type PersonalViewName='Playlists'|'Favorites'|'Recently played';
function Cover({id,albumId=null}: {id:string|null;albumId?:string|null}) { return <AlbumArtwork artworkId={id} albumId={albumId} label="Album"/>; }
export function PersonalView({view}: {view:PersonalViewName}) {
  const personal=usePersonal(); const player=usePlayer(); const [selection,setSelection]=useNavigationState<string|null>('playlist',null,isNullableString); const [data,setData]=useState<PlaylistDetail|null>(null); const [items,setItems]=useState<PersonalTrack[]>([]); const [offset,setOffset]=useNavigationState('offset',0,isOffset); const [next,setNext]=useState<number|null>(null); const [loaded,setLoaded]=useState(''); const [error,setError]=useState(''); const [name,setName]=useState(''); const [busy,setBusy]=useState(false); const [confirm,setConfirm]=useNavigationState<'playlist'|'history'|null>('confirm',null,(v):v is 'playlist'|'history'|null=>v===null||v==='playlist'||v==='history'); const [revision,setRevision]=useState(0);
  const resourceKey=`${view}:${selection}:${offset}:${revision}:${personal?.revision}`;
  const loading=loaded!==resourceKey;
  useEffect(()=>{
    if (!personal) return; const controller=new AbortController();
    if(view==='Playlists'&&!selection) return ()=>controller.abort();
    const path=`${view==='Playlists'?`playlists/${selection}`:view==='Favorites'?'favorites':'history'}?offset=${offset}&limit=${PERSONAL_PAGE_SIZE}`;
    void accountRequest<PlaylistDetail & {nextOffset?:number|null}>(`personal/${path}`,undefined,undefined,controller.signal).then(value=>{ if(!controller.signal.aborted){setError('');setItems(value.items);setData(view==='Playlists'?value:null);setNext(value.nextOffset??null);if(value.playlist)setName(value.playlist.name);} }).catch(reason=>{if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'Could not load personal library.');}).finally(()=>{if(!controller.signal.aborted)setLoaded(resourceKey);});
    return ()=>controller.abort();
    // Summary changes refresh the selected resource without remounting the player.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[view,selection,offset,personal?.revision,revision,resourceKey]);
  if(!personal) return null;
  async function action(work:()=>Promise<unknown>) {setBusy(true);setError('');try{await work();setRevision(n=>n+1);}catch(reason){setError(reason instanceof Error?reason.message:'Could not update your library.');}finally{setBusy(false);}}
  const playable=items.filter(t=>t.available!==false).map(t=>t.track);
  async function collectionPlayback(mode:'play'|'shuffle'|'add'|'next',entryId?:string) {
    if(view==='Recently played'){if(mode==='add'||mode==='next')player.addTracks(playable,mode==='next');else player.play(playable,0,{shuffle:mode==='shuffle',context:data?.playlist.name??view});return;}
    setBusy(true);setError('');try{const refs=await accountRequest<{items:(MediaReference & {id:string})[]}>(`personal/${view==='Playlists'?`playlists/${selection}`:'favorites'}/queue`);
      if(mode==='add'||mode==='next')player.addReferences(refs.items,mode==='next');else player.playReferences(refs.items,Math.max(0,refs.items.findIndex(t=>t.id===entryId)),{shuffle:mode==='shuffle',context:data?.playlist.name??view});
    }catch(reason){setError(reason instanceof Error?reason.message:'Could not load the collection queue.');}finally{setBusy(false);}
  }
  const toolbar=(title:string):ReactNode=><div className="personal-heading"><h3>{title}</h3>{data&&<DownloadButton playlist={{id:data.playlist.id,name:data.playlist.name}}/>}<div className="personal-actions"><button disabled={busy||!playable.length} onClick={()=>{void collectionPlayback('play');}}>Play all</button><button disabled={busy||!playable.length} onClick={()=>{void collectionPlayback('shuffle');}}>Shuffle play</button><button disabled={busy||!playable.length} onClick={()=>{void collectionPlayback('add');}}>Add all to queue</button><button disabled={busy||!playable.length} onClick={()=>{void collectionPlayback('next');}}>Play all next</button></div></div>;
  return <section className="personal-library" aria-label={view}>
    {personal.loading&&<p role="status">Loading personal collections…</p>}
    {personal.error&&<p role="alert" className="account-error">{personal.error}<button onClick={()=>{void personal.refresh().catch(()=>{});}}>Retry personal library</button></p>}
    {error&&<p role="alert" className="account-error">{error}<button onClick={()=>setRevision(n=>n+1)}>Try again</button></p>}
    {view==='Playlists'&&!selection?<><form className="personal-create" onSubmit={event=>{event.preventDefault();void action(async()=>{await personal.mutate('playlists',{name});setName('');});}}><label>Playlist name<input required maxLength={100} value={name} onChange={event=>setName(event.target.value)} /></label><button disabled={busy}>Create playlist</button></form>
      {!personal.summary.playlists.length?<p className="library-message">You haven't created any playlists yet. Give your first playlist a name above, or add a song from your library.</p>:<div className="library-grid">{personal.summary.playlists.map(p=><button className="library-card" key={p.id} onClick={()=>{setData(null);setItems([]);setSelection(p.id);setOffset(0);}}><Cover id={p.artworkId} albumId={p.artworkAlbumId??null}/><strong>{p.name}</strong><small>{p.count} songs · {duration(p.duration)}</small></button>)}</div>}
    </>:<>
      {view==='Playlists'&&<button onClick={()=>{setSelection(null);setOffset(0);setData(null);setItems([]);setName('');}}>← Back to playlists</button>}
      {loading?<p role="status" className="library-message">Loading your personal library…</p>:<>
        {toolbar(data?.playlist.name??view)}
        {data&&<><p className="library-caption">{data.playlist.count} songs · {duration(data.playlist.duration)} total · Up to {COLLECTION_LIMIT.toLocaleString()} songs per playlist</p><form className="personal-create" onSubmit={event=>{event.preventDefault();void action(()=>personal.mutate(`playlists/${selection}/rename`,{name}));}}><label>Playlist name<input required maxLength={100} value={name} onChange={event=>setName(event.target.value)} /></label><button disabled={busy}>Rename playlist</button><button type="button" onClick={()=>setConfirm('playlist')}>Delete playlist</button></form></>}
        {view==='Recently played'&&<button disabled={busy||!items.length} onClick={()=>setConfirm('history')}>Clear listening history</button>}
        {confirm&&<div className="personal-confirm" role="alertdialog" aria-label={confirm==='playlist'?'Delete playlist?':'Clear listening history?'}><p>{confirm==='playlist'?'Delete this playlist and its entries? Your music files and current queue stay unchanged.':'Clear your listening history? Playlists, favorites and your current queue stay unchanged.'}</p><button disabled={busy} onClick={()=>{void action(async()=>{if(confirm==='playlist'){await personal.mutate(`playlists/${selection}/delete`,{});setSelection(null);setOffset(0);setData(null);setItems([]);}else{const result=await personal.mutate<{generation:number}>('history/clear',{});window.dispatchEvent(new CustomEvent('freeqify:history-cleared',{detail:result.generation}));setItems([]);}setConfirm(null);});}}>Confirm {confirm==='playlist'?'delete':'clear'}</button><button onClick={()=>setConfirm(null)}>Cancel</button></div>}
        {!items.length?<p className="library-message">{view==='Playlists'?'This playlist is empty. Add songs using Add to playlist in your library.':view==='Favorites'?'No favorite songs yet. Tap a heart beside a song to save it.':"You haven't played any songs yet. Listen for 30 seconds, or half of a shorter song, to see it here."}</p>:<ol className="personal-tracks">{items.map((entry,index)=><li key={entry.id}><div className="personal-song"><button disabled={entry.available===false} onClick={()=>{if(view==='Recently played')player.play(playable,items.slice(0,index).filter(t=>t.available!==false).length);else void collectionPlayback('play',entry.id);}}>{entry.track.title}</button><small>{entry.track.artist} · {entry.track.album} · {duration(entry.track.duration)}</small>{entry.available!==true&&<span className="account-hint">{entry.available===false?'Media unavailable — saved reference retained':'Music engine unavailable — showing saved details'}</span>}{entry.playedAt!==undefined&&<small>Last played {new Date(entry.playedAt).toLocaleString()} · saved position {duration(entry.position??0)}</small>}</div><div className="personal-actions"><TrackActions track={entry.track}/>{entry.position!==undefined&&<button disabled={entry.available===false} onClick={()=>player.play([entry.track],0,{position:entry.position??0})}>Resume</button>}{data&&<><button aria-label={`Move ${entry.track.title} up`} disabled={busy||offset+index===0} onClick={()=>{void action(()=>personal.mutate(`playlists/${selection}/move`,{entryId:entry.id,direction:-1,revision:data.playlist.revision}));}}>↑</button><button aria-label={`Move ${entry.track.title} down`} disabled={busy||offset+index===data.playlist.count-1} onClick={()=>{void action(()=>personal.mutate(`playlists/${selection}/move`,{entryId:entry.id,direction:1,revision:data.playlist.revision}));}}>↓</button><button aria-label={`Remove ${entry.track.title} from playlist`} disabled={busy} onClick={()=>{void action(()=>personal.mutate(`playlists/${selection}/remove`,{entryId:entry.id}));}}>Remove</button></>}</div></li>)}</ol>}
        {<div className="library-pages">{offset>0&&<button onClick={()=>setOffset(Math.max(0,offset-PERSONAL_PAGE_SIZE))}>Previous {view==='Recently played'?'history':'songs'}</button>}{next!==null&&<button onClick={()=>setOffset(next)}>More {view==='Recently played'?'history':'songs'}</button>}</div>}
        {view==='Recently played'&&<><h3>Recently played albums</h3><div className="library-grid">{items.filter((item,index,all)=>item.track.albumId&&all.findIndex(t=>t.track.albumId===item.track.albumId)===index).map(item=><article className="library-card" key={item.track.albumId}><Cover id={item.track.artworkId} albumId={item.track.albumId}/><strong>{item.track.album}</strong><small>{item.track.artist} · {new Date(item.playedAt!).toLocaleString()}</small><small>From this history page</small></article>)}</div></>}
      </>}
    </>}
  </section>;
}
