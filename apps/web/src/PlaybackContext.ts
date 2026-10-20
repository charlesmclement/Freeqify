import {createContext,useContext} from 'react';
import type {MediaReference,Track} from '@freeqify/shared';
export type PlaybackOptions={shuffle?:boolean;position?:number;context?:string};
export interface PlaybackActions{
 ready:boolean;
 playReferences:(tracks:MediaReference[],index?:number,options?:PlaybackOptions)=>void;
 addReferences:(tracks:MediaReference[],next?:boolean)=>void;
 play:(tracks:Track[],index?:number,options?:PlaybackOptions)=>void;
 add:(track:Track)=>void;
 playNext:(track:Track)=>void;
 addTracks:(tracks:Track[],next?:boolean)=>void;
}
export const PlaybackContext=createContext<PlaybackActions>({ready:false,play:()=>{},add:()=>{},playNext:()=>{},addTracks:()=>{},playReferences:()=>{},addReferences:()=>{}});
export const usePlayer=()=>useContext(PlaybackContext);
