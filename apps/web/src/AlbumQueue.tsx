import {useEffect,useRef,useState} from 'react';
import type {LidarrQueue} from '@freeqify/shared';
import {accountRequest} from './auth-api.js';
import {Sheet} from './ImportSheet.js';
import {Icon} from './Icons.js';
const message=(e:unknown)=>e instanceof Error?e.message:'Album queue is unavailable. Try again.';
export function AlbumQueue({playlist,csrf,selected,disabled,canRequest,onUpdate,missing=0}:{playlist:string;csrf:string|undefined;selected:string[];disabled:boolean;canRequest:boolean;onUpdate:()=>void;missing?:number}){
 const [queue,setQueue]=useState<LidarrQueue|null>(null),[open,setOpen]=useState(false),[running,setRunning]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[choices,setChoices]=useState<Record<string,string>>({}),[search,setSearch]=useState(false);
 const controller=useRef<AbortController|null>(null),lock=useRef(false),update=useRef(onUpdate);
 useEffect(()=>{update.current=onUpdate;},[onUpdate]);
 const path=`imports/${playlist}/albums/queue`;
 useEffect(()=>{if(!canRequest)return;const c=new AbortController();void accountRequest<LidarrQueue|null>(path,csrf,undefined,c.signal).then(setQueue).catch(e=>{if(!c.signal.aborted)setError(message(e));});return()=>c.abort();},[path,csrf,canRequest]);
 useEffect(()=>{if(!running||!open||!queue||queue.automatic)return;const c=new AbortController();controller.current=c;
  void (async()=>{let current=queue;try{
   while(!c.signal.aborted&&(current.counts.queued>0||current.counts.pending>0&&current.counts.review<10)){
    const failures=current.counts.failed;
    current=await accountRequest<LidarrQueue>(path+'/step',csrf,{queueId:current.id},c.signal);
    if(!c.signal.aborted)setQueue(current);
    if(current.counts.failed>failures)break;
    // Leave room in the shared request budget for playback and other views.
    await new Promise(resolve=>setTimeout(resolve,250));
   }
   if(!c.signal.aborted){setRunning(false);update.current();}
  }catch(e){if(!c.signal.aborted){setError(message(e));setRunning(false);}}
  })();return()=>{c.abort();};
 // The pump owns its latest snapshot; individual progress updates must not restart it.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[running,open,queue?.id,queue?.automatic,path,csrf]);
 useEffect(()=>{if(!queue?.automatic)return;const c=new AbortController();const timer=setInterval(()=>{if(document.visibilityState==='hidden')return;void accountRequest<LidarrQueue|null>(path,csrf,undefined,c.signal).then(q=>{if(!c.signal.aborted)setQueue(q);}).catch(e=>{if(!c.signal.aborted)setError(message(e));});},3000);return()=>{clearInterval(timer);c.abort();};},[queue?.automatic,path,csrf]);
 useEffect(()=>()=>controller.current?.abort(),[]);
 async function action(fn:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await fn();}catch(e){setError(message(e));}finally{setBusy(false);lock.current=false;}}
 async function reload(){const q=await accountRequest<LidarrQueue|null>(path,csrf);setQueue(q);setChoices({});setSearch(false);return q;}
 const processing=busy||running&&!queue?.automatic;
 const finished=queue&&!queue.counts.pending&&!queue.counts.review&&!queue.counts.queued&&!queue.counts.failed;
 return <>
  <button className="import-missing-action" disabled={disabled||busy||!canRequest||!missing&&!queue} onClick={()=>{setOpen(true);controller.current?.abort();setRunning(false);void action(async()=>{setQueue(await accountRequest<LidarrQueue>(path+'/seek',csrf,{}));setChoices({});setSearch(false);});}}><Icon name="search"/><span><strong>Seek all</strong><small>Automatically request and search missing albums · Runs in the background</small></span><Icon name="chevron"/></button>
  <button className="import-missing-action" disabled={disabled||processing||!canRequest||!selected.length} onClick={()=>{setOpen(true);void action(async()=>{if(queue&&!finished)throw new Error('Resume or clear the saved album queue before starting another.');const q=await accountRequest<LidarrQueue>(path,csrf,{entries:selected});setQueue(q);setChoices({});setSearch(false);setRunning(true);});}}><Icon name="album"/><span><strong>Add missing music</strong><small>{selected.length?`${selected.length} tracks selected · Review containing albums`:'Select missing tracks above to review their albums'}</small></span><Icon name="chevron"/></button>
  {queue&&<button disabled={disabled||processing||!canRequest} onClick={()=>{setOpen(true);void action(async()=>{await reload();setRunning(true);});}}>View / resume album queue · {queue.counts.confirmed} of {queue.total} confirmed</button>}
  {error&&!open&&<p role="alert" className="account-error">{error}</p>}
  {open&&<Sheet title="Missing music queue" close={()=>{if(!busy){controller.current?.abort();setRunning(false);setOpen(false);}}}>
   {error&&<p role="alert" className="account-error">{error}</p>}
   {busy&&!queue&&<p role="status">Saving selected albums…</p>}
   {queue&&<>
    <p role="status">{queue.total} albums · {queue.counts.confirmed} confirmed · {queue.counts.skipped} skipped · {queue.counts.failed} failed</p>
    <p>{queue.counts.pending} awaiting lookup · {queue.counts.review} ready for review · {queue.counts.queued} confirmed requests waiting to send</p>
    {queue.automatic?<><p>Seek all runs on the server. You can close this dialog or the page. Unique exact artist/album matches are requested and searched automatically; ambiguous matches remain below for review.</p><p>{queue.paused?'Background processing is paused. Retry a failed album or press Seek all to resume.':'Background processing is enabled.'} Sign-out, session expiry or account revocation pauses further requests.</p><button disabled={busy} onClick={()=>void action(async()=>{setQueue(await accountRequest<LidarrQueue>(path+'/pause',csrf,{queueId:queue.id}));})}>Pause background queue</button></>:<p>Progress is saved. Manual processing pauses when this dialog closes; reopen it to resume. Use Seek all for automatic background requests.</p>}
    {running&&!queue.automatic&&<><p role="status">Processing albums in Lidarr…</p><button onClick={()=>{controller.current?.abort();setRunning(false);}}>Pause after current album</button></>}
    {!running&&!queue.automatic&&<button disabled={busy} onClick={()=>void action(async()=>{await reload();setRunning(true);})}>Refresh and continue</button>}
    <p>{queue.automatic?'Only ambiguous or unresolved albums need manual attention below. Other matching albums continue automatically.':'Choose exact albums, then confirm this batch. Nothing is requested until you confirm. Unselected albums stay ready for review.'}</p>
    {queue.albums.map(a=><fieldset key={a.key} disabled={processing}><legend>{a.title} · {a.tracks} selected tracks</legend><p>{a.artist}</p>{!a.candidates.length?<p>No album resolved. Skip this album or check its metadata in Lidarr.</p>:a.candidates.map(c=><label className="import-album-choice" key={c.id}><input type="radio" name={a.key} disabled={!c.canRequest} checked={choices[a.key]===c.id} onChange={()=>setChoices(v=>({...v,[a.key]:c.id}))}/><span><strong>{c.title}</strong><small>{c.artist}{c.year?` · ${c.year}`:''} · {c.monitored?'Already monitored':c.present?'Files present':'Not monitored'}</small>{!c.canRequest&&<small>Add the artist in Lidarr first to select its profiles and music location.</small>}</span></label>)}<button disabled={processing} onClick={()=>void action(async()=>{setQueue(await accountRequest<LidarrQueue>(path+'/retry',csrf,{queueId:queue.id,key:a.key}));setChoices(v=>{const next={...v};delete next[a.key];return next;});setRunning(true);})}>Look up this album again</button></fieldset>)}
    {queue.albums.length>0&&<><label className="import-search-toggle"><input type="checkbox" checked={search} disabled={processing} onChange={e=>setSearch(e.target.checked)}/>Automatic search</label><p>Off by default. Searches only confirmed albums. Already monitored albums are not searched again.</p>
     <button className="account-primary" disabled={processing||!Object.keys(choices).length} onClick={()=>void action(async()=>{const q=await accountRequest<LidarrQueue>(path+'/confirm',csrf,{queueId:queue.id,confirmed:true,search,choices:Object.entries(choices).map(([key,albumId])=>({key,albumId})),skip:[]});setQueue(q);setChoices({});setSearch(false);setRunning(true);})}>Confirm {Object.keys(choices).length} selected albums</button>
     <button disabled={processing} onClick={()=>void action(async()=>{const q=await accountRequest<LidarrQueue>(path+'/confirm',csrf,{queueId:queue.id,confirmed:true,search:false,choices:[],skip:queue.albums.map(a=>a.key)});setQueue(q);setChoices({});setSearch(false);setRunning(true);})}>Skip these {queue.albums.length} albums</button></>}
    {queue.failures.map(f=><article key={f.key}><strong>{f.title} · {f.artist}</strong><p>{f.message}</p><button disabled={processing} onClick={()=>void action(async()=>{setQueue(await accountRequest<LidarrQueue>(path+'/retry',csrf,{queueId:queue.id,key:f.key}));setRunning(true);})}>Retry {f.title}</button><button disabled={processing} onClick={()=>void action(async()=>{setQueue(await accountRequest<LidarrQueue>(path+'/skip',csrf,{queueId:queue.id,key:f.key}));setRunning(true);})}>Skip {f.title}</button></article>)}
    {finished&&<p>Queue complete. Confirmed means monitored in Lidarr; downloads may still be pending.</p>}
    <button disabled={processing} onClick={()=>{if(window.confirm('Clear this saved queue? Completed Lidarr requests remain monitored.'))void action(async()=>{await accountRequest(path+'/clear',csrf,{queueId:queue.id});setQueue(null);setChoices({});setOpen(false);update.current();});}}>Clear saved queue</button>
   </>}
  </Sheet>}
 </>;
}
