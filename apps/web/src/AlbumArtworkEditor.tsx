import {useNavigationState,isBoolean} from './navigation.js';
import { useEffect, useState, type ChangeEvent } from 'react';
import { useOptionalAccount } from './Authentication.js';
import { accountRequest } from './auth-api.js';
import {SharedCoverSearch} from './SharedCoverSearch.js';
import { artworkPresets } from './artwork-presets.js';
type Choice={mode:'auto'|'fallback'|'selected'|'custom'|'none';coverKey:string|null;shared?:boolean};
function coverName(name:string){return name.replace(/^(generic|genre)_\d+_/,'').replace(/\.jpg$/,'').replaceAll('_',' ');}
export function AlbumArtworkEditor({albumId,artist='',title=''}:{albumId:string;artist?:string;title?:string}) {
  const account=useOptionalAccount();
  const [open,setOpen]=useNavigationState('artwork',false,isBoolean);const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');const [choice,setChoice]=useState<Choice|null>(null);
  const [selected,setSelected]=useState<string>(artworkPresets[0]!);
  const endpoint=`library/artwork/album/${encodeURIComponent(albumId)}`;
  useEffect(()=>{
    if(!open)return;const controller=new AbortController();
    void accountRequest<Choice>(`${endpoint}/choice`,undefined,undefined,controller.signal)
      .then(result=>{if(!controller.signal.aborted){setChoice(result);if(result.coverKey)setSelected(result.coverKey);}})
      .catch(reason=>{if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'Cannot load artwork choices.');});
    return ()=>controller.abort();
  },[endpoint,open]);
  async function update(action:()=>Promise<unknown>){setBusy(true);setError('');
    try{await action();const result=await accountRequest<Choice>(`${endpoint}/choice`);setChoice(result);
      window.dispatchEvent(new Event('freeqify:artwork-changed'));}
    catch(reason){setError(reason instanceof Error?reason.message:'Could not change artwork.');}finally{setBusy(false);}
  }
  async function upload(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>1024*1024||file.size<32){setError('Choose a JPG, PNG, or WebP image smaller than 1 MB.');return;}
    await update(async()=>{
      const dataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Could not read image.'));reader.readAsDataURL(file);});
      await accountRequest(`${endpoint}/upload`,account?.state?.csrf,{contentType:file.type,base64:dataUrl.slice(dataUrl.indexOf(',')+1)});
    });
  }
  function change(mode:'none'|'auto'|'reroll'|'selected'){
    void update(()=>accountRequest(`${endpoint}/choice`,account?.state?.csrf,{mode,...(mode==='selected'?{coverKey:selected}:{})}));
  }
  // The editor is interactive only within an authenticated account session.
  // Library views can also be rendered by standalone read-only consumers/tests.
  if(!account?.state?.user)return null;
  return <div className="album-artwork-editor">
    <button className="album-play" type="button" onClick={()=>setOpen(!open)} aria-expanded={open}>{open?'Close artwork editor':'Edit artwork'}</button>
    {open&&<section className="artwork-controls" aria-label="Album artwork settings">
      {account.state.user.role==='admin'&&<SharedCoverSearch key={albumId} albumId={albumId} artist={artist} title={title} csrf={account.state.csrf} onChanged={()=>{void accountRequest<Choice>(`${endpoint}/choice`).then(setChoice).catch(()=>{});window.dispatchEvent(new Event('freeqify:artwork-changed'));}}/>}
      <p>{choice?.shared?'An administrator cover is active for everyone. Personal choices below take effect when it is removed.':'Personal artwork choices affect only your account. Original artwork is preserved.'}</p>
      <small>Current selection: {choice?.mode??'Loading…'}{choice?.coverKey?` (${coverName(choice.coverKey)})`:''}</small>
      <label>Upload your own cover (JPG, PNG or WebP, up to 1 MB)
        <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event=>void upload(event)}/>
      </label>
      <label>Choose a Freeqify cover
        <select value={selected} disabled={busy} onChange={event=>setSelected(event.target.value)}>
          {artworkPresets.map(key=><option value={key} key={key}>{coverName(key)}</option>)}
        </select>
      </label>
      <img className="artwork-editor-preview" alt="Selected Freeqify cover preview" src={`${import.meta.env.BASE_URL}freeqify-covers/${encodeURIComponent(selected)}`}/>
      <div className="artwork-edit-actions">
        <button type="button" disabled={busy} onClick={()=>change('selected')}>Use selected cover</button>
        <button type="button" disabled={busy} onClick={()=>change('reroll')}>Assign another random cover</button>
        <button type="button" disabled={busy} onClick={()=>change('none')}>Display no artwork</button>
        <button type="button" disabled={busy} onClick={()=>change('auto')}>Restore automatic artwork</button>
      </div>
      {error&&<p role="alert" className="account-error">{error}</p>}
    </section>}
  </div>;
}
