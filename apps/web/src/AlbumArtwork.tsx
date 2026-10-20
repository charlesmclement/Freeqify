import {useOptionalAccount} from './Authentication.js';
import {useLocalArtwork,SavedArtwork} from './local-artwork.js';
import { useEffect, useRef, useState } from 'react';
import { artworkPresets } from './artwork-presets.js';
import { readLibrary, libraryUrl } from './library-api.js';
// Share a temporary choice across mounted views until a saved server choice is available.
const temporaryCovers=new Map<string,string>();
function neutralCover(albumId:string,preferred?:string|null){
  if(preferred && artworkPresets.includes(preferred as typeof artworkPresets[number])){
    temporaryCovers.set(albumId,preferred);return preferred;
  }
  let cover=temporaryCovers.get(albumId);
  if(!cover){cover=artworkPresets[Math.floor(Math.random()*artworkPresets.length)]!;temporaryCovers.set(albumId,cover);}
  return cover;
}
/** Same album image in library, player and history. Original artists still use their own artwork. */
type Props={albumId:string|null;artworkId:string|null;label:string;player?:boolean};
export function AlbumArtwork(props:Props){
  const saved=useLocalArtwork(props.albumId,props.artworkId);
  const account=useOptionalAccount();
  if(saved&&account?.offline)return <SavedArtwork blob={saved} label={props.label} player={props.player??false}/>;
  return <AlbumArtworkImage key={`${props.albumId??'no-album'}:${props.artworkId??'no-art'}`} {...props}/>;
}
function AlbumArtworkImage({albumId,artworkId,label,player=false}:Props) {
  const retries=useRef(0);
  const [revision,setRevision]=useState(0);
  const [missing,setMissing]=useState(false);
  const [fallback,setFallback]=useState(false);
  const [coverKey,setCoverKey]=useState<string|null>(null);
  const [fallbackBroken,setFallbackBroken]=useState(false);
  const [noArtwork,setNoArtwork]=useState(false);
  useEffect(()=>{
    if(!missing||!albumId)return;
    const controller=new AbortController();
    void readLibrary<{mode:string;coverKey:string|null}>(`artwork/album/${encodeURIComponent(albumId)}/choice`,controller.signal)
      .then(choice=>{if(!controller.signal.aborted){setNoArtwork(choice.mode==='none');setCoverKey(neutralCover(albumId,choice.mode==='fallback'||choice.mode==='selected'?choice.coverKey:null));setFallback(choice.mode!=='none');}})
      .catch(()=>{if(!controller.signal.aborted){setCoverKey(neutralCover(albumId));setFallback(true);}});
    return ()=>controller.abort();
  },[missing,albumId]);
  useEffect(()=>{
    const onChange=()=>{retries.current=0;setFallback(false);setFallbackBroken(false);setNoArtwork(false);setMissing(false);setRevision(value=>value+1);};
    window.addEventListener('freeqify:artwork-changed',onChange);
    // Refocusing must not discard an image that already loaded successfully.
    const onFocus=()=>{if(missing&&!noArtwork)onChange();};
    window.addEventListener('focus',onFocus);
    return ()=>{window.removeEventListener('freeqify:artwork-changed',onChange);window.removeEventListener('focus',onFocus);};
  },[missing,noArtwork]);
  useEffect(()=>{
    if(!missing || noArtwork || retries.current>=2)return;
    retries.current++;
    // Album grids can briefly exceed the server's catalog concurrency budget.
    // Spread bounded retries so a temporary rejection does not stick until reload.
    const timer=window.setTimeout(()=>{setFallback(false);setMissing(false);setRevision(value=>value+1);},1500+Math.random()*2000);
    return ()=>window.clearTimeout(timer);
  },[missing,noArtwork]);
  const url=albumId?libraryUrl(`artwork/album/${encodeURIComponent(albumId)}?revision=${revision}`):artworkId?libraryUrl(`artwork/${encodeURIComponent(artworkId)}`):null;
  if(missing&&albumId&&fallback&&!noArtwork&&!fallbackBroken){
    // Stable, neutral fallback while genuine artwork is temporarily unreachable.
    const source=`${import.meta.env.BASE_URL}freeqify-covers/${coverKey}`;
    const cover=<img src={source} alt={`${label} fallback artwork`} onError={()=>setFallbackBroken(true)}/>;
    return player?cover:<div className="library-art">{cover}</div>;
  }
  if(!url||missing)return player?<span className="player-vinyl" aria-hidden="true">f.</span>:<div className="library-art"><span role="img" aria-label="Artwork unavailable">♫</span></div>;
  const picture=<img loading={player?'eager':'lazy'} src={url} alt={`${label} artwork`} onError={()=>setMissing(true)}/>;
  return player?picture:<div className="library-art">{picture}</div>;
}
