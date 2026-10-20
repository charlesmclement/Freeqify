import {createContext,useContext,useCallback} from 'react';
export const PlaybackSurfaceContext=createContext<((node:HTMLDivElement|null,home:boolean)=>void)|undefined>(undefined);
export function PlaybackSurface({home=false}:{home?:boolean}){const mount=useContext(PlaybackSurfaceContext);const attach=useCallback((node:HTMLDivElement|null)=>mount?.(node,home),[mount,home]);return <div className="player-main-host" ref={attach}/>;}
