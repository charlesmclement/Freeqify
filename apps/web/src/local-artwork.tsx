import {useEffect,useState} from 'react';
import {useOffline} from './OfflineContext.js';
export function useLocalArtwork(albumId:string|null,artworkId:string|null){const local=useOffline();return local?.tracks.find(t=>t.state==='complete'&&t.artwork&&(albumId?t.track.albumId===albumId:artworkId&&t.track.artworkId===artworkId))?.artwork;}
export function SavedArtwork({blob,label,player=false}:{blob:Blob;label:string;player?:boolean}){const [url,setUrl]=useState('');useEffect(()=>{const url=URL.createObjectURL(blob);
 // Synchronize a browser-owned URL with the rendered image; revoke on replacement/unmount.
 // eslint-disable-next-line react-hooks/set-state-in-effect
 setUrl(url);return()=>URL.revokeObjectURL(url);},[blob]);const image=url?<img src={url} alt={`${label} artwork`}/>:<span>♫</span>;return player?image:<div className="library-art">{image}</div>;}
