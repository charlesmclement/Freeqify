import {Icon} from './Icons.js';
import {BookSpokenHeadings} from './BookSpokenHeadings.js';
import {useBookDownloads} from './BookDownloadsContext.js';
import {downloaded,type DeviceBook} from './book-downloads.js';
import type {BookSource} from './audiobook-player.js';
import {useEffect,useState,type FormEvent} from 'react';
import type {Audiobook,BookCatalogEntry,BookSummary,Page} from '@freeqify/shared';
import {accountRequest,AccountRequestError} from './auth-api.js';
import {useAccount} from './Authentication.js';
import {useAudiobook} from './AudiobookContext.js';
import {AlbumArtwork} from './AlbumArtwork.js';
import {AlbumArtworkEditor} from './AlbumArtworkEditor.js';
import {bookTime,bookElapsed} from './audiobook-player.js';
import {useNavigationState,isBoolean,isNullableString} from './navigation.js';
const statusName={unstarted:'Not started',listening:'In progress',finished:'Finished'};
export function Audiobooks(){
 const account=useAccount(),playback=useAudiobook(),device=useBookDownloads(),manager=device?.manager;
 const localBooks=account.offline?device?.entries:undefined;
 const [selected,select]=useNavigationState<string|null>('book',null,isNullableString);
 const [showShelf,setShowShelf]=useNavigationState('bookshelf',false,isBoolean),shelf=account.offline||showShelf;
 const [serverBooks,setBooks]=useState<BookSummary[]>([]),[book,setBook]=useState<Audiobook|null>(null),[error,setError]=useState(''),[serverLoading,setLoading]=useState(true),[revision,refresh]=useState(0);
 const [offset,setOffset]=useState(0),[serverNext,setNext]=useState<number|null>(null),[filter,setFilter]=useState('all');
 const localShelf=(localBooks??[]).filter(e=>e.state!=='removed'||e.pending).map(e=>e.book).filter(b=>filter==='all'||b.status===filter);
 const books=account.offline?localShelf.slice(offset,offset+48):serverBooks,loading=account.offline?false:serverLoading,next=account.offline?(localShelf.length>offset+48?offset+48:null):serverNext;
 useEffect(()=>{const change=()=>refresh(n=>n+1);window.addEventListener('freeqify:books-changed',change);return()=>window.removeEventListener('freeqify:books-changed',change);},[]);
 useEffect(()=>{const controller=new AbortController();
  if(account.offline||!shelf)return()=>controller.abort();
  accountRequest<Page<BookSummary>>(`audiobooks?offset=${offset}&status=${filter}`,undefined,undefined,controller.signal).then(data=>{setBooks(data.items);setNext(data.nextOffset);setLoading(false);}).catch(e=>{if(!controller.signal.aborted){setError(e.message);setLoading(false);}});
  return()=>controller.abort();
 },[offset,revision,filter,account.offline,shelf]);
 useEffect(()=>{if(!selected)return;const controller=new AbortController();const read=account.offline?manager?.store.get(selected).then(e=>{if(!e)throw new Error('This book is not saved on this device.');return e.book;}):accountRequest<Audiobook>(`audiobooks/${encodeURIComponent(selected)}`,undefined,undefined,controller.signal);void read?.then(b=>{if(!controller.signal.aborted)setBook(b);}).catch(e=>{if(!controller.signal.aborted){setError(e.message);setLoading(false);}});return()=>controller.abort();},[selected,revision,account.offline,manager]);
 const active=playback?.state.book?.id===selected?playback.state.book:null;
 const saved=device?.entries.find(e=>e.id===selected);
 const detail=active??((account.offline||saved?.pending)?saved?.book??null:book?.id===selected?book:null);
 const open=(id:string)=>{setError('');select(id);};
 async function mutate(action:string,input:Record<string,unknown>){
  if(!detail)return false;setError('');
  try{
   if(action==='delete')await manager?.forget(detail.id);
   let result:Audiobook|null;
   if(active&&playback)result=await playback.controller.mutate(action,input);
   else if(manager&&(account.offline||saved?.pending))result=await manager.write(detail,action,input);
   else result=(await accountRequest<{book:Audiobook|null}>(`audiobooks/${detail.id}/${action}`,account.state!.csrf,{...input,revision:detail.revision})).book;
   if(result){if(!account.offline&&!saved?.pending)await manager?.remember(result).catch(()=>{});setBook(result);if(action==='status'&&active)playback?.close();}else{if(active)playback?.close();select(null);setBook(null);}refresh(n=>n+1);return true;
  }catch(e){setError(e instanceof Error?e.message:'Book changes could not be saved.');return false;}
 }
 return <section className="music-library audiobook-library" id="library" aria-labelledby="audiobooks-title">
  <div className="section-title"><div><span className="eyebrow">YOUR STORIES · YOUR PACE</span><h2 id="audiobooks-title">Audiobooks</h2></div></div>
  <p className="library-caption">All your stories in one place. Your listening progress and bookmarks stay private.</p>
  {error&&<p role="alert">{error} <button onClick={()=>{setError('');if(active)playback?.close();refresh(n=>n+1);}}>Reload books</button></p>}
  {selected?<>
   <button className="library-back" aria-label="Back to audiobooks" title="Back to audiobooks" onClick={()=>{select(null);refresh(n=>n+1);}}><Icon name="back"/></button>
   {detail?<BookDetail key={detail.id} book={detail} mutate={mutate} changed={()=>refresh(n=>n+1)}/>:<p role="status">Loading book…</p>}
  </>:<>
   {!account.offline&&<nav className="library-tabs" aria-label="Audiobook library"><button aria-current={!shelf?'page':undefined} onClick={()=>{setError('');setShowShelf(false);}}>All books</button><button aria-current={shelf?'page':undefined} onClick={()=>{if(!shelf){setError('');setLoading(true);setShowShelf(true);}}}>My bookshelf</button></nav>}
   {!shelf?<BookPicker revision={revision} onOpen={open} onAdded={b=>{setBook(b);open(b.id);refresh(n=>n+1);}}/>:<>
   {account.offline&&<h3>Books on this device</h3>}
   <nav className="library-tabs" aria-label="Bookshelf filter">{['all','unstarted','listening','finished'].map(value=><button key={value} aria-current={filter===value?'page':undefined} onClick={()=>{if(filter!==value){setLoading(true);setOffset(0);setFilter(value);}}}>{value==='all'?'All saved books':statusName[value as keyof typeof statusName]}</button>)}</nav>
   {loading?<p role="status">Loading your bookshelf…</p>:!books.length&&filter!=='all'?<p>No books with this status yet.</p>:!books.length?<div className="book-empty"><h3>Make room for a story.</h3><p>{account.offline?'Download a book while connected to listen here offline.':'Books you open appear here with your saved place and notes.'}</p>{!account.offline&&<button className="account-primary" onClick={()=>setShowShelf(false)}>Browse all books</button>}</div>:<div className="library-grid book-grid">{books.map(b=><button className="library-card book-card" key={b.id} onClick={()=>open(b.id)}><AlbumArtwork kind="book" albumId={b.albumId} artworkId={b.artworkId} label={b.title}/><strong>{b.title}</strong><span>{b.author}</span>{b.series&&<small>{b.series}</small>}<small>{statusName[b.status]} · {b.partCount} {b.partCount===1?'part':'parts'}</small><small>{bookTime(b.duration)}</small></button>)}</div>}
   <div className="library-pages">{offset>0&&<button onClick={()=>setOffset(Math.max(0,offset-48))}>Previous books</button>}{next!==null&&<button onClick={()=>setOffset(next)}>More books</button>}</div>
   </>}
  </>}
 </section>;
}
function BookPicker({onAdded,onChoose,onOpen,revision=0}:{onAdded?:(book:Audiobook)=>void;onChoose?:(albumId:string)=>Promise<void>;onOpen?:(bookId:string)=>void;revision?:number}){
 const account=useAccount();const [query,setQuery]=useState(''),[search,setSearch]=useState(''),[offset,setOffset]=useState(0),[albums,setAlbums]=useState<BookCatalogEntry[]>([]),[next,setNext]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const [retry,setRetry]=useState(0);
 useEffect(()=>{const controller=new AbortController();const path=`audiobooks/catalog?q=${encodeURIComponent(search)}&offset=${offset}`;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const read=(attempt:number)=>{
   accountRequest<Page<BookCatalogEntry>>(path,undefined,undefined,controller.signal).then(data=>{if(controller.signal.aborted)return;setError('');setAlbums(data.items);setNext(data.nextOffset!==null);setLoading(false);}).catch(e=>{
    if(controller.signal.aborted)return;
    // Read-only retries recover a busy catalog or a brief upstream interruption.
    // Never retry creation/mutations, and keep configuration errors immediate.
    if(e instanceof AccountRequestError&&[429,502].includes(e.status)&&attempt<2){timer=setTimeout(()=>read(attempt+1),e.status===429?5000:attempt===0?1000:3000);return;}
    setError(e.message);setLoading(false);
   });
  };read(0);return()=>{controller.abort();clearTimeout(timer);};
 },[search,offset,revision,retry]);
 function browse(nextSearch:string,nextOffset:number){if(nextSearch===search&&nextOffset===offset)return;setError('');setAlbums([]);setNext(false);setLoading(true);setSearch(nextSearch);setOffset(nextOffset);}
 async function add(album:BookCatalogEntry){setBusy(true);setError('');try{if(onChoose)await onChoose(album.id);else if(album.book&&onOpen)onOpen(album.book.id);else onAdded?.(await accountRequest<Audiobook>('audiobooks',account.state!.csrf,{albumId:album.id}));}catch(e){setError(e instanceof Error?e.message:'Could not open book.');}finally{setBusy(false);}}
 return <div>{onChoose?<><h3>Add another volume</h3><p>Choose a book to append its files to this one.</p></>:<p className="library-caption">Choose any book to start or continue listening. Books stream by default; downloads are optional.</p>}<form className="library-search" onSubmit={e=>{e.preventDefault();browse(query.trim(),0);}}><label className="sr-only" htmlFor="book-search">Find audiobooks</label><input id="book-search" value={query} maxLength={200} onChange={e=>setQuery(e.target.value)} placeholder="Book title or author"/><button>Search</button></form>{error&&<p role="alert">{error} <button onClick={()=>{setError('');setLoading(true);setRetry(n=>n+1);}}>Retry books</button></p>}{busy&&<p role="status">Opening book and checking chapters…</p>}{loading?<p role="status">Loading Audiobooks…</p>:!error&&!albums.length&&<p>{search?"No books match this search.":"No books are indexed in Audiobooks yet. Playable audio files must be in the source folder and scanned by Navidrome."}</p>}<div className="library-grid album-list">{albums.map(album=><button disabled={busy} className="library-card album-card" key={album.id} onClick={()=>void add(album)}><AlbumArtwork kind="book" albumId={album.id} artworkId={album.artworkId} label={album.title}/><span><strong>{album.book?.title??album.title}</strong><small>{album.book?.author??album.artist} · {album.trackCount} {album.trackCount===1?'part':'parts'}</small>{!onChoose&&<small>{statusName[album.book?.status??'unstarted']}</small>}</span></button>)}</div><div className="library-pages">{offset>0&&<button onClick={()=>browse(search,Math.max(0,offset-48))}>Previous books</button>}{next&&<button onClick={()=>browse(search,offset+48)}>More books</button>}</div></div>;
}
function BookDetail({book,mutate,changed}:{book:Audiobook;mutate:(action:string,input:Record<string,unknown>)=>Promise<boolean>;changed:()=>void}){
 const account=useAccount(),device=useBookDownloads(),entry=device?.entries.find(e=>e.id===book.id);
 const [problem,setProblem]=useState(''),[busy,setBusy]=useState(false);
 const playback=useAudiobook(),active=playback?.state.book?.id===book.id;
 const partId=active?playback!.state.partId:book.partId,position=active?playback!.state.position:book.position;
 const [addingVolume,setAddingVolume]=useState(false);
 const [note,setNote]=useState(''),[chapter,setChapter]=useState(''),[tab,setTab]=useState<'chapters'|'bookmarks'|'details'>('chapters'),[page,setPage]=useState(0);
 const elapsed=bookElapsed(book,partId,position),remaining=elapsed===null||book.duration===null?null:Math.max(0,book.duration-elapsed)/book.speed;
 const structural=account.offline||entry?.state==='downloading'||!!entry?.pending||(active&&playback!.state.source==='download');
 async function listen(id?:string,at?:number,source?:BookSource){setProblem('');const mode=source??(active?playback!.state.source:account.offline?'download':'stream');try{if(active&&playback!.state.source===mode){playback!.controller.seek(id??partId,at??position,true);return;}if(active){await playback!.controller.settle();playback!.close();}const selected=device?await device.manager.prepare(book,mode==='download'):book;playback?.start(selected,id,at,mode);}catch(e){setProblem(e instanceof Error?e.message:'Could not open this book.');}}
 async function scan(){setBusy(true);setProblem('');try{if(active){await playback!.controller.settle();playback!.close();}const latest=await accountRequest<Audiobook>(`audiobooks/${book.id}`);const result=await accountRequest<{book:Audiobook}>(`audiobooks/${book.id}/detect-chapters`,account.state!.csrf,{revision:latest.revision});await device?.manager.remember(result.book);changed();}catch(e){setProblem(e instanceof Error?e.message:'Chapter scan failed.');}finally{setBusy(false);}}

 const partNames=new Map(book.parts.map((p,i)=>[p.id,`Part ${i+1}: ${p.title}`]));
 return <>
  <div className="book-heading"><AlbumArtwork kind="book" albumId={book.albumId} artworkId={book.artworkId} label={book.title}/><div><h1>{book.title}</h1><p>{book.author}</p>{book.narrator&&<p>Narrated by {book.narrator}</p>}{book.series&&<p>{book.series}</p>}<small>{statusName[book.status]} · {book.partCount} parts · {bookTime(book.duration)}</small><p>{bookTime(elapsed)} listened · {bookTime(remaining)} remaining at {book.speed}×</p><button className="account-primary" disabled={book.status==='finished'} onClick={()=>listen()}>{book.status==='finished'?'Finished — use Start over to listen again':active?'Continue playing':book.status==='unstarted'?'Start listening':'Resume book'}</button></div></div>
  {!account.offline&&<AlbumArtworkEditor kind="book" albumId={book.albumId} artist={book.author} title={book.title}/>}
  {problem&&<p role="alert">{problem}</p>}
  {device&&<BookDownloadControls book={book} entry={entry} changed={changed} play={()=>void listen(undefined,undefined,'download')}/>}
  {book.duration!==null&&elapsed!==null&&<progress aria-label="Book progress" max={book.duration||1} value={Math.min(elapsed,book.duration)}/>}
  <div className="book-actions"><button onClick={()=>{void mutate('status',{status:book.status==='finished'?'listening':'finished'});}}>{book.status==='finished'?'Mark in progress':'Mark finished'}</button><button onClick={()=>{if(window.confirm('Reset this book to the beginning? Bookmarks and chapters are kept.')){void mutate('status',{status:'unstarted'});}}}>Start over</button></div>
  <nav className="library-tabs" aria-label="Book sections">{(['chapters','bookmarks','details']as const).map(t=><button key={t} aria-current={t===tab?'page':undefined} onClick={()=>{setTab(t);setPage(0);}}>{t==='chapters'?'Parts & chapters':t==='bookmarks'?`Bookmarks (${book.bookmarks.length})`:'Book details'}</button>)}</nav>
  {tab==='chapters'?<><p className="library-caption">Parts follow the source album’s file order. Named chapters mark positions inside those parts.</p><p className="library-caption">{book.chapterScan?.message??'This book has not been checked for embedded chapters yet.'}</p><button disabled={structural||busy} onClick={()=>void scan()}>{busy?'Checking chapters…':'Detect chapters'}</button><BookSpokenHeadings key={`${book.id}:${page}`} book={book} chapters={book.chapters.slice(page,page+48)} disabled={structural||busy} mutate={mutate} listen={(part,at)=>void listen(part,at)}/><ol className="book-list">{book.chapters.slice(page,page+48).map(c=><li key={c.id}><button onClick={()=>listen(c.partId,c.position)}><small>{c.kind==='part'?'PART':'SECTION'} · {bookTime(c.position)}</small><strong>{c.title}</strong></button><button disabled={structural} aria-label={`Edit section ${c.title}`} onClick={()=>{const title=window.prompt('Section name',c.title);if(title?.trim())void mutate('chapter-titles',{titles:[{chapterId:c.id,previousTitle:c.title,title}]});}}>Edit</button>{c.kind==='chapter'&&<button disabled={structural} aria-label={`Delete chapter ${c.title}`} onClick={()=>void mutate('chapter-delete',{chapterId:c.id})}>Remove</button>}</li>)}</ol><form className="book-note" onSubmit={e=>{e.preventDefault();void mutate('chapter',{partId,position,title:chapter}).then(saved=>{if(saved)setChapter('');});}}><label htmlFor="chapter-title">Name a chapter at {bookTime(position)} in {partNames.get(partId)}</label><input disabled={structural} id="chapter-title" maxLength={200} required value={chapter} onChange={e=>setChapter(e.target.value)}/><button disabled={structural||!chapter.trim()}>Add chapter here</button></form></>:tab==='bookmarks'?<><form className="book-note" onSubmit={e=>{e.preventDefault();void mutate('bookmark',{partId,position,note}).then(saved=>{if(saved)setNote('');});}}><label htmlFor="bookmark-note">Bookmark at {bookTime(position)} · {partNames.get(partId)}</label><input id="bookmark-note" placeholder="A note to remember" maxLength={1000} value={note} onChange={e=>setNote(e.target.value)}/><button>Add bookmark</button></form>{!book.bookmarks.length&&<p>No bookmarks yet. Save a passage while listening or at your resume point.</p>}<ol className="book-list">{book.bookmarks.slice(page,page+48).map(b=><li key={b.id}><button onClick={()=>listen(b.partId,b.position)}><small>{partNames.get(b.partId)} · {bookTime(b.position)}</small><strong>{b.note||'Bookmark'}</strong></button><button onClick={()=>{const value=window.prompt('Bookmark note',b.note);if(value!==null)void mutate('bookmark-edit',{bookmarkId:b.id,note:value});}}>Edit</button><button aria-label={`Delete bookmark ${b.note||bookTime(b.position)}`} onClick={()=>void mutate('bookmark-delete',{bookmarkId:b.id})}>Remove</button></li>)}</ol></>:<fieldset className="book-edit-fields" disabled={structural}><BookMetadata key={`${book.id}:${book.title}:${book.author}:${book.narrator}:${book.series}:${book.description}`} book={book} save={mutate}/></fieldset>}
  {tab!=='details'&&<div className="library-pages">{page>0&&<button onClick={()=>setPage(Math.max(0,page-48))}>Previous</button>}{(tab==='chapters'?book.chapters.length:book.bookmarks.length)>page+48&&<button onClick={()=>setPage(page+48)}>More</button>}</div>}
  {structural&&<p className="library-caption">Reconnect, sync device changes, and close device playback to edit book details, chapters or file order.</p>}
  <fieldset className="book-edit-fields" disabled={structural}><details className="book-management"><summary>Manage book</summary><details onToggle={e=>setAddingVolume(e.currentTarget.open)}><summary>Add another volume</summary>{addingVolume&&<BookPicker onChoose={async albumId=>{await mutate('append',{albumId});}}/>}</details><PartOrder book={book} mutate={mutate}/><p>Removing a book deletes your progress, chapter markers, and bookmarks from this bookshelf. Source audio stays in Navidrome.</p><button onClick={()=>{if(window.confirm(`Remove “${book.title}” and its saved progress and bookmarks?`)){void mutate('delete',{});}}}>Remove from bookshelf</button></details></fieldset>
 </>;
}
function BookMetadata({book,save}:{book:Audiobook;save:(action:string,input:Record<string,unknown>)=>Promise<boolean>}){
 const [values,setValues]=useState({title:book.title,author:book.author,narrator:book.narrator,series:book.series,description:book.description});
 function submit(e:FormEvent){e.preventDefault();void save('metadata',values);}
 return <form className="book-metadata" onSubmit={submit}>{(['title','author','narrator','series','description']as const).map(key=><label key={key}>{key[0]!.toUpperCase()+key.slice(1)}<input required={key==='title'} maxLength={key==='description'?4000:200} value={values[key]} onChange={e=>setValues({...values,[key]:e.target.value})}/></label>)}<button className="account-primary">Save book details</button></form>;
}

function PartOrder({book,mutate}:{book:Audiobook;mutate:(action:string,input:Record<string,unknown>)=>Promise<boolean>}){
 const [offset,setOffset]=useState(0);
 return <details><summary>Review file order</summary><ol className="book-list">{book.parts.slice(offset,offset+48).map((part,index)=><li key={part.id}><span>{offset+index+1}. {part.title}</span><button disabled={offset+index===0} aria-label={`Move ${part.title} earlier`} onClick={()=>void mutate('move-part',{partId:part.id,direction:-1})}>↑</button><button disabled={offset+index===book.parts.length-1} aria-label={`Move ${part.title} later`} onClick={()=>void mutate('move-part',{partId:part.id,direction:1})}>↓</button></li>)}</ol><div className="library-pages">{offset>0&&<button onClick={()=>setOffset(offset-48)}>Earlier parts</button>}{offset+48<book.parts.length&&<button onClick={()=>setOffset(offset+48)}>Later parts</button>}</div></details>;
}

function BookDownloadControls({book,entry,changed,play}:{book:Audiobook;entry:DeviceBook|undefined;changed:()=>void;play:()=>void}){
 const account=useAccount(),device=useBookDownloads()!,playback=useAudiobook();const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 const bytes=entry?.parts.reduce((n,p)=>n+p.bytes,0)??0,total=entry?.parts.reduce((n,p)=>n+p.total,0)??0,complete=downloaded(entry);
 async function run(work:()=>Promise<unknown>){setError('');setBusy(true);try{await work();changed();}catch(e){setError(e instanceof Error?e.message:'Device copy unavailable.');}finally{setBusy(false);}}
 async function settle(){if(playback?.state.book?.id===book.id){await playback.controller.settle();playback.close();}}
 async function sync(choice?:'server'|'device'){if(choice&&!window.confirm(`Keep ${choice==='device'?'this device’s':'the server’s'} saved position, speed, status and bookmarks? This replaces the other saved version.`))return;await settle();await device.manager.sync(book.id,choice);playback?.controller.forgetSession();window.dispatchEvent(new Event('freeqify:books-changed'));}
 return <section className="book-downloads" aria-label="Book download"><strong>{complete?'Downloaded on this device':'Listen anywhere'}</strong><p className="library-caption">Streaming is the default. Download the original audio for this browser’s device library. Browser storage can be cleared; keep your originals on the server.</p>{bytes>0&&<p>{(bytes/1048576).toFixed(1)} MB saved · {entry?.parts.filter(p=>p.complete).length??0} of {book.parts.length} parts</p>}{entry?.state==='downloading'&&<progress aria-label="Book download progress" value={bytes} max={Math.max(total,1)}/>}
 <div className="book-actions">{!complete&&<button disabled={busy||account.offline||entry?.pending} onClick={()=>void run(async()=>{await settle();await device.manager.download(book);})}>{busy?'Downloading…':entry?'Retry download':'Download book'}</button>}{entry?.state==='downloading'&&<button onClick={()=>device.manager.cancel()}>Cancel book download</button>}{complete&&<button disabled={busy} onClick={play}>Play downloaded copy</button>}{!!entry?.parts.length&&<button disabled={busy} onClick={()=>void run(async()=>{await settle();await device.manager.remove(book.id);})}>Remove device copy</button>}</div>
 {entry?.pending&&<><p>Your listening changes are saved on this device and waiting to sync.</p><div className="book-actions"><button disabled={busy||account.offline} onClick={()=>void run(()=>sync())}>Sync book</button><button disabled={busy||account.offline} onClick={()=>void run(()=>sync('device'))}>Keep device changes</button><button disabled={busy||account.offline} onClick={()=>void run(()=>sync('server'))}>Keep server changes</button></div></>}{entry?.error&&<p role="alert">{entry.error}</p>}{error&&error!==entry?.error&&<p role="alert">{error}</p>}
 </section>;
}
