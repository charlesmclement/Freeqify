import {navigateParameter} from './navigation.js';
import type {LocalCollection} from './offline-store.js';
/** Shared removal wording: removing a file from multiple selections requires an explicit choice. */
export function confirmLocalRemoval(title:string,owners:LocalCollection[]){return owners.length<2||window.confirm(`Remove the local copy of “${title}” from all ${owners.length} downloaded selections (${owners.map(c=>c.name).join(', ')})? Server originals and the playback queue stay unchanged.`);}

export function openDownloads(){for(const key of ['fullOpen','immersive','queueOpen','tools','more','admin'])navigateParameter(key,false,false);navigateParameter('view','Downloaded','Overview');document.getElementById('main')?.scrollTo?.({top:0});}
