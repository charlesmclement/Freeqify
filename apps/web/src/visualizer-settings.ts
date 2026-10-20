import {presetNames} from './milkdrop/names.js';
export const palettes=['Freeqify Green','Synthwave','Rainbow','Matrix','Classic','Ice','Amber CRT'] as const;
export type Palette=typeof palettes[number];
export type VisualizerSettings={enabled:boolean;engine:'spectrum2d'|'spectrum'|'milkdrop';preset:string;cycle:boolean;palette:Palette;sensitivity:number;response:number;angle:number;reduced:boolean};
export const defaultVisualizer:VisualizerSettings={enabled:true,engine:'spectrum2d',preset:presetNames[0],cycle:false,palette:'Freeqify Green',sensitivity:1.25,response:1,angle:20,reduced:false};
const bounded=(v:unknown,min:number,max:number,fallback:number)=>typeof v==='number'&&Number.isFinite(v)?Math.min(max,Math.max(min,v)):fallback;
export function readVisualizerSettings(user:string):VisualizerSettings{
 try{const v=JSON.parse(localStorage.getItem(`freeqify.visualizer.${user}`)??'null');if(!v||typeof v!=='object')return {...defaultVisualizer};return {engine:v.spectrumVersion===3&&(v.engine==='milkdrop'||v.engine==='spectrum')?v.engine:'spectrum2d',preset:presetNames.some(name=>name===v.preset)?v.preset:presetNames[0],cycle:v.cycle===true,enabled:typeof v.enabled==='boolean'?v.enabled:defaultVisualizer.enabled,palette:palettes.includes(v.palette)?v.palette:defaultVisualizer.palette,sensitivity:bounded(v.sensitivity,.5,2.5,1.25),response:bounded(v.response,.4,2,1),angle:bounded(v.angle,-40,40,20),reduced:false};}catch{return {...defaultVisualizer};}
}
export function saveVisualizerSettings(user:string,value:VisualizerSettings){try{localStorage.setItem(`freeqify.visualizer.${user}`,JSON.stringify({...value,spectrumVersion:3}));}catch{/* Private browsing/storage denial does not affect playback. */}}
