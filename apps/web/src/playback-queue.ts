import { QUEUE_LIMIT, type PlaybackState, type Track, type QueuedTrack } from '@freeqify/shared';
export function upcoming(state:PlaybackState){return state.order.slice(state.order.indexOf(state.current??'')+1);}
export function manualKeys(state:PlaybackState){const manual=new Set(state.queue.filter(t=>t.origin==='manual').map(t=>t.key));return upcoming(state).filter(key=>manual.has(key));}
export function enqueue(state: PlaybackState, tracks: Track[], replace = false): PlaybackState {
  if(!replace)return queueManually(state,tracks);
  const map=new Map(state.queue.map(t=>[t.key,t]));
  const retained=manualKeys(state).map(key=>map.get(key)!);
  const added=tracks.slice(0,QUEUE_LIMIT-retained.length).map(track=>({source:'local' as const,trackId:track.id,key:crypto.randomUUID()}));
  return {...state,queue:[...added,...retained],order:[...added.slice(0,1).map(t=>t.key),...retained.map(t=>t.key),...added.slice(1).map(t=>t.key)],current:added[0]?.key??retained[0]?.key??null,position:0,shuffle:false};
}
/** Rebuild only the new context around its chosen start, retaining pending manual order. */
export function startContext(state:PlaybackState,tracks:Track[],index=0,label?:string,shuffle=false):PlaybackState{
 const next=enqueue(state,tracks,true),context=next.queue.filter(t=>t.origin!=='manual'),manual=next.queue.filter(t=>t.origin==='manual');
 const start=Math.max(0,Math.min(index,context.length-1));
 const current=context[start]?.key??manual[0]?.key??null;
 const order=shuffle?[...(current?[current]:[]),...manual.filter(t=>t.key!==current).map(t=>t.key),...context.filter(t=>t.key!==current).map(t=>t.key)]:[...context.slice(0,start).map(t=>t.key),...(current?[current]:[]),...manual.filter(t=>t.key!==current).map(t=>t.key),...context.slice(start+1).map(t=>t.key)];
 const result={...next,current,order,contextLabel:(label??'Current selection').split('').map(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127?' ':c).join('').slice(0,160)};
 return shuffle?shuffleQueue(result):result;
}
export function queueManually(state:PlaybackState,tracks:Track[],next=false):PlaybackState{
 const added:QueuedTrack[]=tracks.slice(0,QUEUE_LIMIT-state.queue.length).map(t=>({key:crypto.randomUUID(),source:'local',trackId:t.id,origin:'manual'}));
 if(!added.length)return state;
 const index=state.order.indexOf(state.current??'')+1;
 const split=next?index:index+manualKeys(state).length;
 const order=[...state.order.slice(0,split),...added.map(t=>t.key),...state.order.slice(split)];
 return {...state,queue:[...state.queue,...added],order,current:state.current??order[0]??null};
}
export function step(state: PlaybackState, direction: 1 | -1, ended = false): PlaybackState {
 if(ended&&state.repeat==='one')return {...state,position:0};
 const index=state.order.indexOf(state.current??''),next=index+direction;
 if(next<0||next>=state.order.length){if(state.repeat!=='all'||!state.order.length)return state;return {...state,current:state.order[(next+state.order.length)%state.order.length]!,position:0};}
 return {...state,current:state.order[next]!,position:0};
}
export function shuffleQueue(state:PlaybackState,random=Math.random):PlaybackState{
 const index=state.order.indexOf(state.current??'')+1,past=state.order.slice(0,index),pending=manualKeys(state),pinned=new Set([...past,...pending]);
 const rest=(state.shuffle?state.queue.map(t=>t.key):state.order).filter(key=>!pinned.has(key));
 if(!state.shuffle)for(let i=rest.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[rest[i],rest[j]]=[rest[j]!,rest[i]!];}
 return {...state,shuffle:!state.shuffle,order:[...past,...pending,...rest]};
}
export function removeQueued(state:PlaybackState,key:string):PlaybackState{
 const order=state.order.filter(k=>k!==key),index=state.order.indexOf(key);
 return {...state,queue:state.queue.filter(t=>t.key!==key),order,...(state.current===key?{current:order[Math.min(index,order.length-1)]??null,position:0}:{})};
}
export function clearManual(state:PlaybackState):PlaybackState{
 const pending=new Set(manualKeys(state));return {...state,queue:state.queue.filter(t=>!pending.has(t.key)),order:state.order.filter(key=>!pending.has(key))};
}
/** Reordering stays within each upcoming section, preserving manual priority. */
export function moveQueued(state:PlaybackState,key:string,target:string):PlaybackState{
 const pending=upcoming(state),manual=new Set(manualKeys(state));
 if(key===target||!pending.includes(key)||!pending.includes(target)||manual.has(key)!==manual.has(target))return state;
 const order=state.order.filter(k=>k!==key);order.splice(state.order.indexOf(target),0,key);
 const map=new Map(state.queue.map(t=>[t.key,t]));
 return {...state,order,queue:order.map(k=>map.get(k)!)};
}
