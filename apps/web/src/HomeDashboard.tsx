import { useEffect, useState, type CSSProperties } from 'react';
import type { LibraryOverview, PersonalTrack } from '@freeqify/shared';
import type { LibraryView } from './Library.js';
import { AlbumArtwork } from './AlbumArtwork.js';
import { AlbumCarousel } from './AlbumCarousel.js';
import { accountRequest } from './auth-api.js';
import { usePersonal } from './PersonalContext.js';
import { usePlayer } from './Player.js';
import { Icon, type IconName } from './Icons.js';
export function HomeDashboard({overview,onView,open}:{overview:LibraryOverview;onView:(view:LibraryView)=>void;open:(id:string)=>void}){
 const personal=usePersonal();const player=usePlayer();const [history,setHistory]=useState<PersonalTrack[]>([]);const [loading,setLoading]=useState(Boolean(personal));const [error,setError]=useState('');const [retry,setRetry]=useState(0);
 const revision=personal?.revision;
 const hasPersonal=Boolean(personal);
 useEffect(()=>{
  if(!hasPersonal)return;
  const controller=new AbortController();
  void accountRequest<{items:PersonalTrack[]}>('personal/history?offset=0&limit=6',undefined,undefined,controller.signal)
   .then(page=>{if(!controller.signal.aborted){setHistory(Array.isArray(page.items)?page.items:[]);setError('');}})
   .catch(()=>{if(!controller.signal.aborted)setError('Your listening history could not be loaded.');})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return ()=>controller.abort();
 },[hasPersonal,revision,retry]);
 const albums=history.filter((item,index,all)=>item.track.albumId&&all.findIndex(other=>other.track.albumId===item.track.albumId)===index);
 const counts:{label:string;value:number;view:LibraryView;icon:IconName}[]=[{label:'Tracks',value:overview.tracks,view:'Tracks',icon:'track'},{label:'Albums',value:overview.albums,view:'Albums',icon:'album'},{label:'Artists',value:overview.artists,view:'Artists',icon:'artist'},...(personal?[{label:'Favorites',value:personal.summary.favoriteIds.length,view:'Favorites' as const,icon:'heart' as const}]:[])];
 return <div className="home-dashboard">
 {hasPersonal&&<section className="jump-section"><div className="content-heading"><h3>Jump back in</h3><button onClick={()=>onView('Recently played')}>See all <Icon name="chevron"/></button></div>
 {albums.length?<div className="artwork-carousel">{albums.map(item=><button className="carousel-card" key={item.track.albumId} onClick={()=>open(item.track.albumId!)}><AlbumArtwork albumId={item.track.albumId} artworkId={item.track.artworkId} label={item.track.album}/><span className="card-play"><Icon name="chevron"/></span><strong>{item.track.album}</strong><small>{item.track.artist}</small></button>)}</div>:<p className="library-caption">{loading?'Loading your recent music…':'Listen to your collection and your recent albums will appear here.'}</p>}</section>}
 <section className="home-statistics"><div className="content-heading"><h3>Your library</h3><button onClick={()=>onView('Albums')}>See all <Icon name="chevron"/></button></div><div className={`library-counts dashboard-counts ${personal?'has-favorites':''}`}>{counts.map(item=><button key={item.label} aria-label={`${item.value.toLocaleString()} ${item.label}`} onClick={()=>onView(item.view)}><Icon name={item.icon}/><strong style={{'--count-chars':item.value.toLocaleString().length} as CSSProperties}>{item.value.toLocaleString()}</strong><span>{item.label}</span></button>)}</div><p className="library-caption">{overview.scanning?'Navidrome is scanning. Counts may change; refresh when the scan finishes.':overview.tracks?'Your local collection, indexed by Navidrome. Choose a view to explore.':'Your library is empty. Check your music folder and Navidrome scan status.'}</p></section>
 {hasPersonal&&<section className="home-history"><div className="content-heading"><h3>Recently played</h3><button onClick={()=>onView('Recently played')}>See all <Icon name="chevron"/></button></div>{error?<p className="account-error">{error} <button onClick={()=>setRetry(n=>n+1)}>Retry history</button></p>:loading?<p className="library-caption" role="status">Loading listening history…</p>:history.length?<ol className="recent-track-list">{history.map(item=><li key={item.id}><button disabled={item.available===false} onClick={()=>player.play([item.track])}><AlbumArtwork albumId={item.track.albumId} artworkId={item.track.artworkId} label={item.track.album}/><span><strong>{item.track.title}</strong><small>{item.track.artist} · {item.track.album}</small>{item.available===false&&<small>Media unavailable</small>}</span><Icon name="play"/></button></li>)}</ol>:<p className="library-caption">Your listening history starts here. Play a song to make yourself at home.</p>}</section>}
 {personal&&<section className="home-playlists"><div className="content-heading"><h3>Your playlists</h3><button onClick={()=>onView('Playlists')}>See all <Icon name="chevron"/></button></div>{personal.error?<p className="account-error">{personal.error}</p>:personal.loading?<p className="library-caption">Loading playlists…</p>:personal.summary.playlists.length?<div className="artwork-carousel">{personal.summary.playlists.slice(0,6).map(playlist=><button className="carousel-card" key={playlist.id} onClick={()=>onView('Playlists')}><AlbumArtwork albumId={playlist.artworkAlbumId??null} artworkId={playlist.artworkId} label={playlist.name}/><strong>{playlist.name}</strong><small>Playlist · {playlist.count} tracks</small></button>)}</div>:<p className="library-caption">Create a playlist to keep your favorite songs together. <button onClick={()=>onView('Playlists')}>Create a playlist</button></p>}</section>}
 <AlbumCarousel open={open}/>
 </div>;
}
