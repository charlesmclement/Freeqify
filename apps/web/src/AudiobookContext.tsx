import {createContext,useContext} from 'react';
import type {Audiobook} from '@freeqify/shared';
import type {BookController,BookPlayerState,BookSource} from './audiobook-player.js';
export interface AudiobookPlayback {state:BookPlayerState;controller:BookController;start:(book:Audiobook,partId?:string,position?:number,source?:BookSource)=>void;close:()=>void}
export const AudiobookContext=createContext<AudiobookPlayback|null>(null);
export const useAudiobook=()=>useContext(AudiobookContext);
