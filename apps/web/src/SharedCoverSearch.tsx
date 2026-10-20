import {useEffect,useRef,useState,type FormEvent} from 'react';
import {accountRequest} from './auth-api.js';
import {libraryUrl} from './library-api.js';
type Candidate={token:string;title:string;artist:string;year:string};
type Status={enabled:boolean;selected:boolean;artist:string|null;title:string|null};
export function SharedCoverSearch({albumId,artist,title,csrf,onChanged}:{albumId:string;artist:string;title:string;csrf:string;onChanged:()=>void}) {
  const endpoint=`library/artwork/album/${encodeURIComponent(albumId)}`;
  const [status,setStatus]=useState<Status|null>(null);
  const [searchArtist,setArtist]=useState(artist);
  const [searchAlbum,setAlbum]=useState(title);
  const [items,setItems]=useState<Candidate[]|null>(null);
  const [selected,setSelected]=useState<Candidate|null>(null);
  const [ready,setReady]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const controller=useRef<AbortController|null>(null);
  useEffect(()=>{
    const request=new AbortController();controller.current=request;
    void accountRequest<Status>(`${endpoint}/shared`,undefined,undefined,request.signal)
      .then(value=>{if(!request.signal.aborted)setStatus(value);})
      .catch(reason=>{if(!request.signal.aborted)setError(reason instanceof Error?reason.message:'Cannot load shared cover settings.');});
    return ()=>request.abort();
  },[endpoint]);
  async function search(event:FormEvent){
    event.preventDefault();setBusy(true);setError('');setMessage('');setItems(null);setSelected(null);setReady(false);
    try{
      const result=await accountRequest<{items:Candidate[]}>(`${endpoint}/cover-search`,csrf,{artist:searchArtist,album:searchAlbum},controller.current?.signal);
      setItems(result.items);
    }catch(reason){if(!controller.current?.signal.aborted)setError(reason instanceof Error?reason.message:'Cover search failed.');}
    finally{setBusy(false);}
  }
  async function save(remove=false){
    if(!remove&&(!selected||!ready))return;
    setBusy(true);setError('');setMessage('');
    try{
      await accountRequest(`${endpoint}/shared`,csrf,remove?{mode:'remove'}:{mode:'select',token:selected!.token},controller.current?.signal);
      setStatus(await accountRequest<Status>(`${endpoint}/shared`,undefined,undefined,controller.current?.signal));
      setMessage(remove?'Shared cover removed. Previous artwork choices are restored.':'Cover saved for everyone.');onChanged();
    }catch(reason){if(!controller.current?.signal.aborted)setError(reason instanceof Error?reason.message:'Could not save shared cover.');}
    finally{setBusy(false);}
  }
  return <section className="shared-cover-search" aria-label="Cover search for everyone">
    <h4>Album cover for everyone</h4>
    <p>Administrator changes apply to all accounts. Original music files stay untouched.</p>
    {status?.selected&&<><p>Shared cover: {status.artist} — {status.title}</p><div className="artwork-edit-actions"><button type="button" disabled={busy} onClick={()=>void save(true)}>Remove shared cover</button></div></>}
    {status&&!status.enabled&&<p>Online search is disabled. Set MUSICBRAINZ_CONTACT in the server configuration to enable it.</p>}
    <form onSubmit={event=>void search(event)}>
      <label>Cover artist<input value={searchArtist} maxLength={200} disabled={busy} onChange={event=>setArtist(event.target.value)}/></label>
      <label>Cover album<input required value={searchAlbum} maxLength={200} disabled={busy} onChange={event=>setAlbum(event.target.value)}/></label>
      <p>Search sends these names to MusicBrainz. Previews come from Cover Art Archive.</p>
      <div className="artwork-edit-actions"><button disabled={busy||!status?.enabled||!searchAlbum.trim()}>{busy?'Working…':'Search for cover'}</button></div>
    </form>
    {items?.length===0&&<p role="status">No matching albums found. Try a shorter album title or leave the artist blank.</p>}
    {!!items?.length&&<><p>Choose a result to preview its cover. Some albums may have no image.</p><div className="cover-search-results">{items.map(item=><button type="button" key={item.token} disabled={busy} aria-pressed={selected?.token===item.token} onClick={()=>{setSelected(item);setReady(false);setError('');setMessage('');}}><strong>{item.title}</strong><small>{item.artist}{item.year?` · ${item.year}`:''}</small></button>)}</div></>}
    {selected&&<div className="cover-search-preview">
      <img key={selected.token} src={libraryUrl(`artwork/album/${encodeURIComponent(albumId)}/cover-preview/${encodeURIComponent(selected.token)}`)} alt={`${selected.title} cover preview`} onLoad={()=>setReady(true)} onError={()=>{setReady(false);setError('No preview available. Try another result, or search again if the preview expired.');}}/>
      <div className="artwork-edit-actions"><button type="button" disabled={busy||!ready} onClick={()=>void save()}>Use this cover for everyone</button></div>
    </div>}
    {error&&<p role="alert" className="account-error">{error}</p>}
    {message&&<p role="status">{message}</p>}
  </section>;
}
