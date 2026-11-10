import {useEffect,useState} from 'react';

/** A best-effort screen lock, scoped to the visible immersive view. */
export function useScreenWakeLock(active:boolean){
 const [error,setError]=useState('');
 useEffect(()=>{
  if(!active)return;
  let disposed=false,pending=false,lock:WakeLockSentinel|undefined;
  const hidden=()=>document.visibilityState==='hidden';
  async function acquire(){
   if(disposed||pending||lock||hidden())return;
   if(!navigator.wakeLock){setError('Keeping the screen awake is unavailable in this browser.');return;}
   pending=true;
   try{
    const requested=await navigator.wakeLock.request('screen');
    if(disposed||hidden()){await requested.release();return;}
    lock=requested;setError('');
    requested.addEventListener('release',()=>{if(lock===requested){lock=undefined;if(!disposed&&document.visibilityState!=='hidden')setError('Screen lock was released. Toggle Keep screen awake to retry.');}});
   }catch{if(!disposed)setError('Could not keep the screen awake. Toggle Keep screen awake to retry.');}
   finally{pending=false;}
  }
  const visibility=()=>{if(hidden()){const previous=lock;lock=undefined;void previous?.release().catch(()=>{});}else void acquire();};
  void acquire();document.addEventListener('visibilitychange',visibility);
  return()=>{disposed=true;document.removeEventListener('visibilitychange',visibility);void lock?.release().catch(()=>{});};
 },[active]);
 return active?error:'';
}
