import { useEffect, useState } from 'react';
import type { Album, Page } from '@freeqify/shared';
import { readLibrary } from './library-api.js';
import { AlbumArtwork } from './AlbumArtwork.js';
import { Icon } from './Icons.js';
export function AlbumCarousel({open}:{open:(id:string)=>void}){
 const [albums,setAlbums]=useState<Album[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [revision,setRevision]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();
  void readLibrary<Page<Album>>('albums?offset=0&limit=8&sort=newest',controller.signal)
   .then(page=>{if(!controller.signal.aborted){setAlbums(Array.isArray(page.items)?page.items:[]);setError('');}})
   .catch(()=>{if(!controller.signal.aborted)setError('Recently added albums could not be loaded.');})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return ()=>controller.abort();
 },[revision]);
 return <section className="album-carousel-section" aria-labelledby="recent-albums-title"><div className="content-heading"><h3 id="recent-albums-title">Recently Added</h3><span className="subtle-label">FROM YOUR LIBRARY</span></div>
 {loading?<p className="library-caption" role="status">Loading recent albums…</p>:error?<p className="library-caption">{error} <button onClick={()=>{setLoading(true);setRevision(n=>n+1);}}>Retry albums</button></p>:!albums.length?<p className="library-caption">New albums will appear here when your library has music.</p>:<div className="artwork-carousel">{albums.map(album=><button className="carousel-card" key={album.id} onClick={()=>open(album.id)}><AlbumArtwork albumId={album.id} artworkId={album.artworkId} label={album.title}/><strong>{album.title}</strong><small>{album.artist}</small><small>{album.trackCount} tracks <Icon name="chevron" width="14" height="14"/></small></button>)}</div>}
 </section>;
}
