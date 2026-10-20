import { useEffect, useRef, useState } from 'react';
import type { Track } from '@freeqify/shared';
import { ListeningAttempt } from './listening.js';
import { usePersonal } from './PersonalContext.js';
import { useAccount } from './Authentication.js';
import { accountRequest } from './auth-api.js';
export function useListeningHistory(key:string|null,track:Track|undefined) {
  const personal=usePersonal(); const account=useAccount(); const [error,setError]=useState('');
  const attempt=useRef<{key:string; timer:ListeningAttempt; generation:number; blocked:boolean; sending:boolean}|null>(null);
  useEffect(()=>{const clear=()=>{if(attempt.current)attempt.current.blocked=true;};window.addEventListener('freeqify:history-cleared',clear);return ()=>window.removeEventListener('freeqify:history-cleared',clear);},[]);
  function sample(position:number,playing:boolean) {
    if(account.offline||!personal||personal.loading||!account.state?.user||!key||!track) return;
    if(attempt.current?.key!==key) attempt.current={key,timer:new ListeningAttempt(),generation:personal.summary.generation,blocked:false,sending:false};
    const active=attempt.current; active.timer.sample(position,performance.now(),playing);
    if(active.blocked||active.sending||!active.timer.shouldSend(track.duration))return;
    const first=active.timer.listened<45; active.sending=true; active.timer.sent();
    void accountRequest('personal/history',account.state.csrf,{source:'local',trackId:track.id,eventId:active.timer.eventId,generation:active.generation,listened:active.timer.listened,position}).then(()=>{setError('');if(first)void personal.refresh().catch(()=>{});}).catch(reason=>{if(reason&&typeof reason==='object'&&'status' in reason&&reason.status===409){active.blocked=true;void personal.refresh().catch(()=>{});}else setError('Listening history could not be saved. Playback can continue.');}).finally(()=>{active.sending=false;});
  }
  return {sample,error,reset:()=>{attempt.current=null;}};
}
