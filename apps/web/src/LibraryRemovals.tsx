import {useNavigationState,isBoolean} from './navigation.js';
import {useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import type {Page,RemovedLibraryItem} from '@freeqify/shared';
import {useOptionalAccount} from './Authentication.js';
import {accountRequest} from './auth-api.js';
const changed=(kind:string,id:string)=>window.dispatchEvent(new CustomEvent('freeqify:library-changed',{detail:{kind,id}}));
export function LibraryRemovalButton({kind,id,title}:{kind:'track'|'album';id:string;title:string}){
 const account=useOptionalAccount();const [confirm,setConfirm]=useNavigationState(`remove:${kind}:${id}`,false,isBoolean);
 if(account?.state?.user?.role!=='admin')return null;
 return <><button className={`queue-add library-remove-button${kind==='album'?' album-remove-button':''}`} title={`Remove ${title} from Freeqify`} aria-label={`Remove ${title} from Freeqify`} onClick={()=>setConfirm(true)}>{kind==='album'?'Remove':<span aria-hidden="true">−</span>}</button>{confirm&&createPortal(<RemovalDialog kind={kind} id={id} title={title} csrf={account.state.csrf} close={()=>setConfirm(false)}/>,document.body)}</>;
}
function RemovalDialog({kind,id,title,csrf,close}:{kind:'track'|'album';id:string;title:string;csrf:string;close:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),heading=useId();const [busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{const element=dialog.current!;if(element.showModal)element.showModal();else element.setAttribute('open','');return()=>element.close?.();},[]);
 async function remove(){
  setBusy(true);setError('');
  try{await accountRequest('library/remove',csrf,{kind,id,confirmed:true});close();changed(kind,id);}
  catch(e){setError(e instanceof Error?e.message:'Could not remove this item.');setBusy(false);}
 }
 return <dialog ref={dialog} className="personal-dialog library-removal-dialog" aria-labelledby={heading} onCancel={e=>{if(busy)e.preventDefault();else close();}}><h2 id={heading}>Remove from Freeqify?</h2><p><strong>{title}</strong></p><p>This {kind==='album'?'album and its tracks':'track'} will be hidden from everyone’s library and unavailable for new playback. Music files stay on disk.</p><p>Saved playlists, favorites and history are kept. An administrator can restore this item under Removed from Freeqify.</p>{error&&<p role="alert" className="account-error">{error}</p>}<div className="personal-actions"><button disabled={busy} onClick={()=>void remove()}>{busy?'Removing…':'Confirm removal'}</button><button disabled={busy} onClick={close}>Cancel</button></div></dialog>;
}
export function RemovedLibrary(){
 const account=useOptionalAccount();const [open,setOpen]=useState(false),[offset,setOffset]=useState(0),[revision,setRevision]=useState(0);
 const [data,setData]=useState<Page<RemovedLibraryItem>|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const admin=account?.state?.user?.role==='admin';
 useEffect(()=>{
  const refresh=()=>{setOffset(0);setRevision(n=>n+1);};window.addEventListener('freeqify:library-changed',refresh);return()=>window.removeEventListener('freeqify:library-changed',refresh);
 },[]);
 useEffect(()=>{
  if(!admin||!open)return;
  const controller=new AbortController();
  void accountRequest<Page<RemovedLibraryItem>>(`library/removed?offset=${offset}&limit=20`,undefined,undefined,controller.signal).then(value=>{if(!controller.signal.aborted){setError('');setData(value);}}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Could not load removed items.');});
  return()=>controller.abort();
 },[admin,open,offset,revision]);
 if(!admin)return null;
 async function restore(item:RemovedLibraryItem){
  setBusy(true);setError('');
  try{await accountRequest('library/removed/restore',account?.state?.csrf,{kind:item.kind,id:item.id,confirmed:true});changed(item.kind,item.id);}
  catch(e){setError(e instanceof Error?e.message:'Could not restore this item.');}
  finally{setBusy(false);}
 }
 return <details className="library-removals" onToggle={e=>setOpen(e.currentTarget.open)}><summary>Removed from Freeqify</summary><p>Administrator · Hidden for everyone; original files stay on disk. Restoring an album leaves any individually removed tracks hidden.</p>{error&&<p role="alert" className="account-error">{error}<button onClick={()=>{setError('');setRevision(n=>n+1);}}>Retry</button></p>}{!data&&!error&&open&&<p role="status">Loading removed items…</p>}{data&&<>{!data.items.length?<p>No items removed.</p>:<ul>{data.items.map(item=><li key={`${item.kind}:${item.id}`}><span><strong>{item.title}</strong><small>{item.artist} · {item.kind==='album'?'Album':'Track'}</small></span><button disabled={busy} aria-label={`Restore ${item.title} to Freeqify`} onClick={()=>void restore(item)}>Restore</button></li>)}</ul>}<div className="personal-actions">{offset>0&&<button disabled={busy} onClick={()=>{setData(null);setOffset(Math.max(0,offset-20));}}>Previous removed items</button>}{data.nextOffset!==null&&<button disabled={busy} onClick={()=>{setData(null);setOffset(data.nextOffset!);}}>More removed items</button>}</div></>}</details>;
}
