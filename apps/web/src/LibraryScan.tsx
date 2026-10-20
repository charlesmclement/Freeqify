import {useEffect,useRef,useState} from 'react';
import type {LibraryScanStatus} from '@freeqify/shared';
import {accountRequest} from './auth-api.js';
/** Scan only through the configured music engine; never accepts a filesystem path. */
export function LibraryScan({admin,csrf,onComplete,disabled=false}:{admin:boolean;csrf?:string|undefined;onComplete:()=>void|Promise<void>;disabled?:boolean}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const operation=useRef<AbortController|null>(null),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),completed=useRef(onComplete);
 useEffect(()=>{completed.current=onComplete;},[onComplete]);
 useEffect(()=>()=>{operation.current?.abort();clearTimeout(timer.current);},[]);
 if(!admin)return null;
 async function scan(){
  if(operation.current)return;
  const controller=new AbortController();operation.current=controller;setBusy(true);setError('');setMessage('Starting music library scan…');const started=Date.now();
  const finish=async(status:LibraryScanStatus)=>{
   if(controller.signal.aborted)return;
   if(!status.scanning){setMessage(`Library scan complete · ${status.count} tracks indexed. Updating this view…`);await completed.current();if(!controller.signal.aborted){setMessage(`Library scan complete · ${status.count} tracks indexed.`);setBusy(false);operation.current=null;}return;}
   setMessage(`Scanning music library… ${status.count} tracks indexed so far.`);
   if(Date.now()-started>300000){setMessage('The scan is still running. Check again shortly.');setBusy(false);operation.current=null;return;}
   timer.current=setTimeout(()=>{if(document.visibilityState==='hidden'){void finish(status);return;}void accountRequest<LibraryScanStatus>('library/scan',undefined,undefined,controller.signal).then(finish).catch(fail);},5000);
  };
  const fail=(e:unknown)=>{if(!controller.signal.aborted){setError(e instanceof Error?e.message:'The library scan could not be checked.');setMessage('');setBusy(false);operation.current=null;}};
  try{await finish(await accountRequest<LibraryScanStatus>('library/scan',csrf,{},controller.signal));}catch(e){fail(e);}
 }
 return <div className="library-scan"><button disabled={disabled||busy} onClick={()=>void scan()}>{busy?'Scanning library…':'Scan music library'}</button><small>Administrator · Find newly imported music</small>{message&&<p role="status">{message}</p>}{error&&<p role="alert" className="account-error">{error}</p>}</div>;
}
