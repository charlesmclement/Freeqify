import {validPlayback,type PlaybackState} from '@freeqify/shared';
const key=(user:string)=>`freeqify.queue-draft.${user}`;
/** Private per-account recovery only: no audio, cookies or credentials. */
export function readQueueDraft(user:string):PlaybackState|null{
 try{const text=localStorage.getItem(key(user));if(!text||text.length>4*1024*1024)return null;const data:unknown=JSON.parse(text);return validPlayback(data)?data:null;}catch{return null;}
}
export function writeQueueDraft(user:string,state:PlaybackState){try{localStorage.setItem(key(user),JSON.stringify(state));}catch{/* Server persistence remains available if local storage is blocked/full. */}}
export function clearQueueDraft(user:string){try{localStorage.removeItem(key(user));}catch{/* Storage may be disabled. */}}
