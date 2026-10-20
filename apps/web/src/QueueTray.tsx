import {useOffline} from './OfflineContext.js';
import {confirmLocalRemoval,openDownloads} from './local-download-actions.js';
import {memo,useRef,useState} from 'react';
import type {PlaybackState,Track} from '@freeqify/shared';
import {AlbumArtwork} from './AlbumArtwork.js';
import {Icon} from './Icons.js';
import {ActionMenu} from './SongAddButton.js';
import {usePersonal} from './PersonalContext.js';
import {manualKeys,upcoming} from './playback-queue.js';
interface Props{
 showEarlier:boolean;toggleEarlier:()=>void;historyKeys:string[];
 state:PlaybackState;metadata:Record<string,Track>;keys:string[];ready:boolean;
 close:()=>void;select:(key:string)=>void;remove:(key:string)=>void;move:(key:string,target:string)=>boolean;clear:()=>void;
 offset:number;pageSize:number;onPage:(offset:number)=>void;
}
function QueueTrayView({showEarlier,toggleEarlier,historyKeys,state,metadata,keys,ready,close,select,remove,move,clear,offset,pageSize,onPage}:Props){
 const local=useOffline();const personal=usePersonal(),[saving,setSaving]=useState(false),[showSave,setShowSave]=useState(false),[name,setName]=useState(''),[message,setMessage]=useState('');
 const [dragging,setDragging]=useState<string|null>(null),target=useRef<string|null>(null),root=useRef<HTMLDivElement>(null);
 const map=new Map(state.queue.map(t=>[t.key,t])),manual=new Set(manualKeys(state)),future=upcoming(state),played=Math.max(0,state.order.indexOf(state.current??''));
 const manualList=future.filter(key=>manual.has(key)),contextList=future.filter(key=>!manual.has(key));
 const positions=new Map([...manualList.map((key,index)=>[key,index] as const),...contextList.map((key,index)=>[key,index] as const)]);
 function label(key:string){const item=map.get(key);return item?metadata[item.trackId]?.title??item.trackId:'Unavailable song';}
 function reorder(key:string,direction:number){const section=manual.has(key)?manualList:contextList,index=positions.get(key)??-1;const next=section[index+direction];if(next){move(key,next);setMessage(`Moved ${label(key)} ${direction<0?'up':'down'}.`);}}
 const row=(key:string,current=false,past=false)=>{
  const item=map.get(key);if(!item)return null;const downloaded=local?.tracks.find(t=>t.id===item.trackId);const track=metadata[item.trackId]??downloaded?.track;const stored=downloaded?.state==='complete';const downloading=downloaded?.state==='queued'||downloaded?.state==='downloading';
  const section=manual.has(key)?manualList:contextList,index=positions.get(key)??-1;
  return <li key={key} data-queue-key={key} className={dragging===key?'queue-row is-dragging':'queue-row'} aria-current={current?'true':undefined}>
   {past&&<span className="queue-history-marker">↶</span>}
   {!current&&!past&&<button className="queue-drag" aria-label={`Reorder ${label(key)}`} title="Drag to reorder; arrow keys also move songs" disabled={!ready} onKeyDown={event=>{if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();event.stopPropagation();reorder(key,event.key==='ArrowUp'?-1:1);}}} onPointerDown={event=>{if(event.button!==0)return;event.currentTarget.setPointerCapture(event.pointerId);target.current=key;setDragging(key);}} onPointerMove={event=>{
    if(dragging!==key)return;
    const hit=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('[data-queue-key]');
    if(hit&&root.current?.contains(hit))target.current=hit.dataset.queueKey??key;
    const scroller=root.current?.querySelector<HTMLElement>('.queue-scroll');if(scroller){const rect=scroller.getBoundingClientRect();if(event.clientY<rect.top+32)scroller.scrollTop-=12;else if(event.clientY>rect.bottom-32)scroller.scrollTop+=12;}
   }} onPointerUp={event=>{event.currentTarget.releasePointerCapture(event.pointerId);if(target.current&&target.current!==key){setMessage(move(key,target.current)?'Queue order updated.':'Drag within the same section; manual songs stay first.');}setDragging(null);target.current=null;}} onPointerCancel={()=>{setDragging(null);target.current=null;}}>⠿</button>}
   <button className="queue-song" onClick={()=>select(key)} aria-label={`Play ${label(key)}`} disabled={!ready} title={track?`${track.title} — ${track.artist}`:item.trackId}>
    <span className="queue-art"><AlbumArtwork albumId={track?.albumId??null} artworkId={track?.artworkId??null} label={track?.album??'Album'}/>{stored&&<span className="queue-download-badge" role="img" aria-label="Downloaded">✓</span>}</span><span><strong>{label(key)}</strong><small>{track?.artist??'Metadata unavailable'}</small></span>
   </button>
   <span className="queue-duration">{track?.duration!=null?`${Math.floor(track.duration/60)}:${String(Math.floor(track.duration%60)).padStart(2,'0')}`:'—'}</span>
   <ActionMenu label={`Actions for ${label(key)}`} className="queue-row-actions" items={[
    {label:'Play now',action:()=>select(key),disabled:!ready},
    ...(local?[stored?{label:'Downloaded · manage',action:openDownloads}:{label:downloading?'Cancel download':'Download MP3',action:()=>{void (downloading?local.manager.cancel([item.trackId]):local.select('track',item.trackId,track?.title??item.trackId,track?[track]:undefined)).then(()=>setMessage(downloading?'Download cancelled.':'Download queued.')).catch(error=>setMessage(error instanceof Error?error.message:'Download failed.'));},disabled:!track},...(stored?[{label:'Remove local file',action:()=>{if(confirmLocalRemoval(track?.title??item.trackId,local.collections.filter(c=>c.tracks.includes(item.trackId))))void local.manager.removeTrack(item.trackId).then(()=>setMessage('Local copy removed. Server original and queue are unchanged.')).catch(error=>setMessage(error instanceof Error?error.message:'Could not remove local copy.'));}}]:[])]:[]),
    ...(!current&&!past?[
     {label:'Move up',action:()=>reorder(key,-1),disabled:!ready||index===0},
     {label:'Move down',action:()=>reorder(key,1),disabled:!ready||index===section.length-1},
     {label:'Remove from queue',action:()=>remove(key),disabled:!ready},
    ]:[]),
   ]}>⋮</ActionMenu>
  </li>;
 };
 return <div ref={root} className="queue-tray-content">
  <div className="queue-heading"><strong>Playback queue</strong><small title={`${played} earlier · ${future.length} upcoming`}>{future.length} upcoming</small><button aria-label="Collapse queue" onClick={close}><Icon name="chevron"/></button></div>
  <div className="queue-toolbar"><button disabled={!ready||!manual.size} onClick={clear}>Clear manual queue</button><button disabled={!personal||!state.queue.length} onClick={()=>setShowSave(v=>!v)}>Save as playlist</button><button disabled={!played&&!showEarlier} aria-expanded={showEarlier} onClick={toggleEarlier}>Earlier ({played})</button></div>
  {showSave&&<form className="queue-save" onSubmit={event=>{event.preventDefault();if(!personal||saving)return;setSaving(true);setMessage('');const tracks=state.order.map(key=>{const item=map.get(key)!;return {source:item.source,trackId:item.trackId};});void personal.mutate('playlists/from-queue',{name,tracks}).then(()=>{setShowSave(false);setName('');setMessage('Saved the entire queue, including earlier songs, as a playlist.');}).catch(reason=>setMessage(reason instanceof Error?reason.message:'Could not save playlist. Your queue is unchanged.')).finally(()=>setSaving(false));}}><label>Playlist name<input value={name} onChange={e=>setName(e.target.value)} required maxLength={100}/></label><button disabled={saving}>{saving?'Saving…':'Save entire queue'}</button><button type="button" onClick={()=>setShowSave(false)} disabled={saving}>Cancel</button></form>}
  {message&&<p role="status" className="queue-notice">{message}</p>}
  <div className="queue-scroll">
   {showEarlier&&<section aria-label="Earlier in this queue"><h4>Earlier in this queue <small>Most recent {historyKeys.length}</small></h4><ol>{historyKeys.map(key=>row(key,false,true))}</ol></section>}
   {state.current&&<section><h4>Now playing</h4><ol>{row(state.current,true)}</ol></section>}
   <section aria-label="Next in Queue"><h4>Next in Queue <small>{manual.size}</small></h4>{keys.some(key=>manual.has(key))?<ol>{keys.filter(key=>manual.has(key)).map(key=>row(key))}</ol>:<p>{manual.size?'More manual songs on another page.':'Add songs using +.'}</p>}</section>
   <section aria-label="Next From"><h4>Next From <span>{state.contextLabel??'Current selection'}</span></h4>{keys.some(key=>!manual.has(key))?<ol>{keys.filter(key=>!manual.has(key)).map(key=>row(key))}</ol>:<p>{future.length>manual.size?'More context songs on another page.':'End of this selection.'}</p>}</section>
  </div>
  {future.length>pageSize&&<div className="queue-pages"><button aria-label="Previous queue page" disabled={!offset} onClick={()=>onPage(Math.max(0,offset-pageSize))}>Previous</button><small>{offset+1}–{Math.min(offset+pageSize,future.length)} / {future.length}</small><button aria-label="Next queue page" disabled={offset+pageSize>=future.length} onClick={()=>onPage(offset+pageSize)}>More</button></div>}
 </div>;
}

// Queue rendering follows structural edits, not audio timeupdate events. Player callbacks read latest refs.
export const QueueTray=memo(QueueTrayView,(a,b)=>a.state.queue===b.state.queue&&a.state.order===b.state.order&&a.state.current===b.state.current&&a.state.contextLabel===b.state.contextLabel&&a.metadata===b.metadata&&a.ready===b.ready&&a.offset===b.offset&&a.pageSize===b.pageSize&&a.showEarlier===b.showEarlier);
