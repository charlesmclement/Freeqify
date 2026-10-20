import {DownloadButton} from './DownloadButton.js';
import {useNavigationState,isString,isOffset} from './navigation.js';
import {LibraryRemovalButton,RemovedLibrary} from './LibraryRemovals.js';
import {LibraryScan} from './LibraryScan.js';
import {useOptionalAccount} from './Authentication.js';
import { HomeDashboard } from './HomeDashboard.js';
import { AlbumCarousel } from './AlbumCarousel.js';
import { Icon } from './Icons.js';
import {SongAddButton,AlbumQueueMenu} from './SongAddButton.js';
import { TrackActions } from './TrackActions.js';
import { AlbumArtwork } from './AlbumArtwork.js';
import { AlbumArtworkEditor } from './AlbumArtworkEditor.js';
import { PersonalView } from './PersonalViews.js';
import { duration } from './duration.js';
export { duration } from './duration.js';
import { usePlayer } from './Player.js';
import { useEffect, useState, type FormEvent } from 'react';
import type { AlbumSort, Album, AlbumDetail, Artist, ArtistDetail, LibraryOverview, Page, SearchResults, Track } from '@freeqify/shared';
import { readLibrary } from './library-api.js';
export const libraryViews = ['Overview','Playlists','Favorites','Recently played','Artists','Albums','Tracks','Search','Downloaded'] as const;
export type LibraryView = typeof libraryViews[number];
const libraryTabs:LibraryView[]=['Albums','Artists','Tracks','Favorites','Overview','Playlists','Recently played','Search','Downloaded'];
type Selection = { kind: 'artist' | 'artist-tracks' | 'album'; id: string } | null;
function Artwork({id,label,albumId=null}:{id:string|null;label:string;albumId?:string|null}) {
  return <AlbumArtwork artworkId={id} label={label} albumId={albumId}/>;
}
function Tracks({ tracks }: { tracks: Track[] }) {
  const player = usePlayer();
  return <div className="track-list"><table><caption className="sr-only">Library tracks</caption><thead><tr><th>Title</th><th>Artist / album</th><th>Format</th><th>Time</th></tr></thead><tbody>{tracks.map(track => <tr key={track.id}><td><button className="track-play" onClick={() => player.play(tracks, tracks.indexOf(track))}>{track.title}</button><span className="library-track-controls"><SongAddButton track={track}/><TrackActions track={track} downloadPlaceholder/><LibraryRemovalButton kind="track" id={track.id} title={track.title}/></span></td><td><span>{track.artist}</span><small>{track.album}</small></td><td>{track.format?.toUpperCase() ?? '—'}</td><td>{duration(track.duration)}</td></tr>)}</tbody></table></div>;
}
function Artists({ artists, open }: { artists: Artist[]; open: (value: Selection) => void }) {
  return <div className="library-grid">{artists.map(artist => <button className="library-card artist-card" key={artist.id} onClick={() => open({ kind: 'artist', id: artist.id })}><Artwork id={artist.artworkId} label={artist.name} /><strong>{artist.name}</strong><small>{artist.albumCount} {artist.albumCount === 1 ? 'album' : 'albums'}</small></button>)}</div>;
}
function Albums({ albums, open }: { albums: Album[]; open: (value: Selection) => void }) {
  return <div className="library-grid album-list">{albums.map(album => <button className="library-card album-card" key={album.id} onClick={() => open({ kind: 'album', id: album.id })}><Artwork id={album.artworkId} label={album.title} albumId={album.id} /><span className="album-card-copy"><strong>{album.title}</strong><small>{album.artist}{album.year ? ` · ${album.year}` : ''}</small>{album.trackCount!=null&&<small>{album.trackCount} tracks</small>}</span><Icon className="album-chevron" name="chevron"/></button>)}</div>;
}
type Resource = LibraryOverview | { items: Artist[] } | Page<Album> | Page<Track> | ArtistDetail | AlbumDetail | SearchResults;
function LibraryContent({ path, view, selection, offset, changeOffset, open, onView }: {
  path: string; view: LibraryView; selection: Selection; offset: number;
  changeOffset: (value: number) => void; open: (value: Selection) => void; onView:(value:LibraryView)=>void;
}) {
  const player = usePlayer();
  const [data, setData] = useState<Resource | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => { controller.abort(); setError('The music engine took too long to respond. Try again.'); }, 15000);
    readLibrary<Resource>(path, controller.signal).then(value => {
      if (!controller.signal.aborted) setData(value);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'The library is unavailable.');
    }).finally(() => clearTimeout(timeout));
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [path, retry]);
  if (error) return <div className="library-message" role="alert"><p>{error}</p><button onClick={() => { setError(''); setData(null); setRetry(n => n + 1); }}>Try again</button></div>;
  if (!data) return <p className="library-message" role="status">Loading your library…</p>;
  if (selection?.kind === 'artist') {
    const detail = data as ArtistDetail;
    return <><h3 className="library-detail-title">{detail.artist.name}</h3><button className="album-play" onClick={()=>{changeOffset(0);open({kind:'artist-tracks',id:detail.artist.id});}}>Show artist tracks</button>{detail.albums.length ? <Albums albums={detail.albums} open={open} /> : <p className="library-message">No albums found for this artist.</p>}</>;
  }
  if (selection?.kind === 'artist-tracks') {const page=data as Page<Track>; return <><Tracks tracks={page.items}/><div className="library-pages">{offset>0&&<button onClick={()=>changeOffset(Math.max(0,offset-48))}>Previous artist tracks</button>}{page.nextOffset!==null&&<button onClick={()=>changeOffset(page.nextOffset!)}>More artist tracks</button>}</div></>;}
  if (selection?.kind === 'album') {
    const detail = data as AlbumDetail;
    return <><div className="album-heading"><Artwork id={detail.album.artworkId} label={detail.album.title} albumId={detail.album.id} /><div><h3>{detail.album.title}</h3><p>{detail.album.artist}</p><small>{detail.tracks.length} tracks</small><AlbumQueueMenu tracks={detail.tracks} title={detail.album.title}/><DownloadButton album={{id:detail.album.id,title:detail.album.title,tracks:detail.tracks}}/></div><div className="album-actions"><button className="album-play" disabled={!detail.tracks.length} onClick={() => player.play(detail.tracks,0,{context:detail.album.title})}>Play album</button><AlbumArtworkEditor albumId={detail.album.id} artist={detail.album.artist} title={detail.album.title}/><LibraryRemovalButton kind="album" id={detail.album.id} title={detail.album.title}/></div></div>{detail.tracks.length ? <Tracks tracks={detail.tracks} /> : <p className="library-message">No tracks found in this album.</p>}</>;
  }
  if (view === 'Overview') {
    const overview = data as LibraryOverview;
    return <HomeDashboard overview={overview} onView={onView} open={id=>open({kind:'album',id})}/>;
  }
  if (view === 'Search') {
    const result = data as SearchResults;
    const any = result.artists.length + result.albums.length + result.tracks.length;
    return <>{!any ? <p className="library-message">No matching music found.</p> : <><h3 className="library-detail-title">Artists</h3>{result.artists.length ? <Artists artists={result.artists} open={open} /> : <p className="library-caption">No matching artists.</p>}<h3 className="library-detail-title">Albums</h3>{result.albums.length ? <Albums albums={result.albums} open={open} /> : <p className="library-caption">No matching albums.</p>}<h3 className="library-detail-title">Tracks</h3>{result.tracks.length ? <Tracks tracks={result.tracks} /> : <p className="library-caption">No matching tracks.</p>}</>}
      <div className="library-pages">{offset > 0 && <button onClick={() => changeOffset(Math.max(0, offset - 48))}>Previous results</button>}{(result.nextOffset!==undefined?result.nextOffset!==null:[result.artists, result.albums, result.tracks].some(items => items.length === 48)) && <button onClick={() => changeOffset(offset + 48)}>More results</button>}</div></>;
  }
  const received = data as Page<Album> | Page<Track> | { items: Artist[]; nextOffset?: number | null };
  const page=view==='Artists'?{items:received.items.slice(offset,offset+48),nextOffset:received.items.length>offset+48?offset+48:null}:received;
  return <>{page.items.length === 0 ? <p className="library-message">No {view.toLowerCase()} found{offset ? ' on this page' : ' in your library'}.</p> : view === 'Artists' ? <Artists artists={page.items as Artist[]} open={open} /> : view === 'Albums' ? <Albums albums={page.items as Album[]} open={open} /> : <Tracks tracks={page.items as Track[]} />}
    <div className="library-pages">{offset > 0 && <button onClick={() => changeOffset(Math.max(0, offset - 48))}>Previous page</button>}{page.nextOffset != null && <button onClick={() => changeOffset(page.nextOffset!)}>Next page</button>}</div></>;
}
export function Library({ view, onView }: { view: LibraryView; onView: (value: LibraryView) => void }) {
  const account=useOptionalAccount();
  const [sort,setSort]=useState<AlbumSort>('alphabeticalByName');
  const [selection, setSelection] = useNavigationState<Selection>('selection',null,(v):v is Selection=>v===null||typeof v==='object'&&v!==null&&'kind' in v&&['artist','artist-tracks','album'].includes(String(v.kind))&&'id' in v&&isString(v.id));
  useEffect(()=>{if(selection)document.getElementById('library')?.scrollIntoView?.({block:'start'});},[selection]);
  const [query, setQuery] = useNavigationState('query','',isString);
  const [edited,setEdited]=useState<{query:string;value:string}|null>(null);
  const draft=edited?.query===query?edited.value:query;
  const setDraft=(value:string)=>setEdited({query,value});
  const [offset, setOffset] = useNavigationState('offset',0,isOffset);
  const [revision, setRevision] = useState(0);
  useEffect(()=>{const refresh=()=>{setRevision(n=>n+1);};window.addEventListener('freeqify:library-changed',refresh);return()=>window.removeEventListener('freeqify:library-changed',refresh);},[]);
  function changeView(value: LibraryView) { setSelection(null); setOffset(0); onView(value); }
  let path = view === 'Overview' ? 'overview' : view.toLowerCase();
  if (selection) path = selection.kind==='artist-tracks' ? `artists/${encodeURIComponent(selection.id)}/tracks?offset=${offset}&limit=48` : `${selection.kind === 'artist' ? 'artists' : 'albums'}/${encodeURIComponent(selection.id)}`;
  else if (view === 'Search') path = `search?q=${encodeURIComponent(query)}&offset=${offset}&limit=48`;
  else if (view !== 'Overview' && view !== 'Artists') path += `?offset=${offset}&limit=48`;
  if(view==='Albums'&&!selection&&sort!=='alphabeticalByName')path+=`&sort=${sort}`;
  function search(event: FormEvent) { event.preventDefault(); setSelection(null); setOffset(0); setQuery(draft.trim()); setRevision(n => n + 1); }
  return <section className={`music-library library-view-${view.toLowerCase().replaceAll(' ','-')} ${selection?'library-has-selection':''}`} id="library" aria-labelledby="library-title">
    <div className="section-title"><h2 id="library-title">{selection?'Your Library':view==='Overview'?'Your frequency':view==='Search'?'Find your sound':'Your Library'}</h2><span>LOCAL MUSIC · YOUR FREQUENCY</span></div>
    <nav className="library-tabs" aria-label="Music library">{libraryTabs.map(value => <button key={value} data-category={value} className={['Albums','Artists','Tracks','Favorites'].includes(value)?'library-category':'library-other-tab'} aria-current={view === value ? 'page' : undefined} onClick={() => changeView(value)}>{['Albums','Artists','Tracks','Favorites'].includes(value)&&<Icon name={value==='Albums'?'album':value==='Artists'?'artist':value==='Tracks'?'track':'heart'}/>}<span>{value}</span></button>)}</nav>
    {view === 'Search' && <form className="library-search" onSubmit={search}><label className="sr-only" htmlFor="music-search">Search artists, albums and songs</label><input id="music-search" type="search" placeholder="Artists, albums, songs…" maxLength={200} value={draft} onChange={event => setDraft(event.target.value)} /><button type="submit" disabled={!draft.trim()}>Search library</button></form>}
    {view==='Albums'&&!selection&&<AlbumCarousel key={revision} open={id=>{setOffset(0);setSelection({kind:'album',id});}}/>}
    <div className="library-toolbar">{view==='Albums'&&!selection&&<label className="album-sort"><span>Albums</span><select aria-label="Sort albums" value={sort} onChange={event=>{setOffset(0);setSort(event.target.value as AlbumSort);}}><option value="alphabeticalByName">Title A–Z</option><option value="alphabeticalByArtist">Artist A–Z</option><option value="newest">Recently added</option></select></label>}{selection && <button onClick={() => setSelection(null)}>← Back to {view.toLowerCase()}</button>}<div className="library-maintenance"><LibraryScan admin={account?.state?.user?.role==='admin'} csrf={account?.state?.csrf} onComplete={()=>setRevision(n=>n+1)}/><button className="library-refresh" onClick={() => setRevision(n => n + 1)}>Refresh view</button></div></div>
    <RemovedLibrary/>
    {view==='Playlists'||view==='Favorites'||view==='Recently played'?<PersonalView key={`${view}:${revision}`}  view={view}/>:view === 'Search' && !query && !selection ? <p className="library-message">Find something in your collection. Search artists, albums, or songs.</p> : <LibraryContent key={`${path}:${revision}`} path={path} view={view} selection={selection} offset={offset} changeOffset={setOffset} open={setSelection} onView={changeView}/>}
  </section>;
}
