import {useCallback,useSyncExternalStore} from 'react';
// Hash routes keep authenticated APIs and prefixed production serving unchanged.
const listeners=new Set<()=>void>();
const notify=()=>listeners.forEach(listener=>listener());
let listening=false;
function subscribe(listener:()=>void){
  if(!listening){window.addEventListener('popstate',historyChanged);window.addEventListener('hashchange',historyChanged);window.addEventListener('freeqify:logout',clearOverlays);window.addEventListener('freeqify:unauthenticated',clearOverlays);listening=true;}
  listeners.add(listener);return()=>{listeners.delete(listener);};
}
function snapshot(){return `${payloadRevision}:${pending?(pending.size?`#/${pending}`:''):window.location.hash}`;}
function params(){if(pending)return pending;return new URLSearchParams(window.location.hash.startsWith('#/')?window.location.hash.slice(2):'');}
let queued=false;
let traversing=false;
let before='';
let pending:URLSearchParams|null=null;
function scheduleCommit(){
  if(queued||traversing)return;
  queued=true;
  queueMicrotask(()=>{
    queued=false;if(!pending||traversing)return;
    const next=pending;
    const url=new URL(before);url.hash=next.size?`/${next}`:'';
    if(url.href===before){pending=null;notify();return;}
    const trail:unknown=window.history.state?.freeqifyTrail;
    const parents=Array.isArray(trail)?trail.filter((item):item is string=>typeof item==='string'):[];
    const ancestor=parents.lastIndexOf(url.href);
    if(ancestor>=0){traversing=true;window.history.go(ancestor-parents.length);return;}
    pending=null;
    const original=new URL(before).hash;
    const originalParams=new URLSearchParams(original.startsWith('#/')?original.slice(2):'');
    // A directly opened panel has no owned parent to traverse: dismiss in place.
    if(!parents.length&&next.size<originalParams.size&&[...next].every(([key,value])=>originalParams.get(key)===value)){
      window.history.replaceState(window.history.state,'',url);notify();return;
    }
    window.history.pushState({freeqifyTrail:[...parents,before].slice(-100)},'',url);notify();
  });
}
function historyChanged(){
  if(traversing){traversing=false;before=window.location.href;scheduleCommit();}
  notify();
}
/** Related setters in one action produce one meaningful history entry. */
export function navigateParameter(key:string,value:unknown,initial:unknown){
  if(!pending){before=window.location.href;pending=params();}
  if(JSON.stringify(value)===JSON.stringify(initial))pending.delete(key);
  else pending.set(key,JSON.stringify(value));
  notify();scheduleCommit();
}
export function useNavigationState<T>(key:string,initial:T,valid:(value:unknown)=>value is T):[T,(value:T|((current:T)=>T))=>void]{
  useSyncExternalStore(subscribe,snapshot,snapshot);
  let current=initial;
  try{const value:unknown=JSON.parse(params().get(key)??'null');if(valid(value))current=value;}catch{/* Malformed external routes use a safe default. */}
  const set=useCallback((value:T|((current:T)=>T))=>{
    let previous=initial;try{previous=JSON.parse(params().get(key)??JSON.stringify(initial)) as T;}catch{/* Default malformed input. */}
    navigateParameter(key,typeof value==='function'?(value as (current:T)=>T)(previous):value,initial);
  },[key,initial]);
  return [current,set];
}
export const isBoolean=(value:unknown):value is boolean=>typeof value==='boolean';
export const isString=(value:unknown):value is string=>typeof value==='string'&&value.length<=512;
export const isNullableString=(value:unknown):value is string|null=>value===null||isString(value);
export const isOffset=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>=0&&Number(value)<=1000000;
// Dialog payloads stay in memory, never in shareable URLs or browser history.
let payloadRevision=0;
const overlayValues=new Map<string,unknown>();
function clearOverlays(){overlayValues.clear();payloadRevision++;notify();}
export function useHistoryOverlay<T>(key:string):[T|null,(value:T|null)=>void]{
  const [token,setToken]=useNavigationState<string|null>(key,null,isNullableString);
  const set=useCallback((value:T|null)=>{
    if(value===null){setToken(null);return;}
    const id=crypto.randomUUID();overlayValues.set(id,value);
    if(overlayValues.size>100)overlayValues.delete(overlayValues.keys().next().value!);
    setToken(id);
  },[setToken]);
  return [token?(overlayValues.get(token) as T|undefined)??null:null,set];
}
