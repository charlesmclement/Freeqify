import {useEffect,useRef,useState} from 'react';
import type {Audiobook,BookChapter,BookSpokenHeading} from '@freeqify/shared';
import {accountRequest} from './auth-api.js';
import {useAccount} from './Authentication.js';
import {bookTime} from './audiobook-player.js';
interface Preview extends BookSpokenHeading {previousTitle:string;partId:string;title:string;selected:boolean}
export function BookSpokenHeadings({book,chapters,disabled,mutate,listen}:{book:Audiobook;chapters:BookChapter[];disabled:boolean;mutate:(action:string,input:Record<string,unknown>)=>Promise<boolean>;listen:(part:string,position:number)=>void}){
 const account=useAccount(),work=useRef<AbortController|null>(null);
 const [previews,setPreviews]=useState<Preview[]>([]),[progress,setProgress]=useState(''),[error,setError]=useState(''),[saving,setSaving]=useState(false);
 useEffect(()=>()=>work.current?.abort(),[]);
 useEffect(()=>{if(disabled)work.current?.abort();},[disabled]);
 async function read(){
  if(work.current||disabled)return;const controller=new AbortController();work.current=controller;setPreviews([]);setError('');
  const sections=chapters.slice(0,48);
  try{for(const [index,chapter]of sections.entries()){
   if(controller.signal.aborted)break;setProgress(`Reading opening ${index+1} of ${sections.length}…`);
   const result=await accountRequest<BookSpokenHeading>(`audiobooks/${book.id}/spoken-heading`,account.state!.csrf,{chapterId:chapter.id},controller.signal);
   if(controller.signal.aborted)break;
   const placeholder=chapter.titleSource==='embedded'||/^(?:\d+|(?:Section|Chapter|Part) \d+)$/i.test(chapter.title);
   setPreviews(current=>[...current,{...result,partId:chapter.partId,previousTitle:chapter.title,title:result.suggestedTitle??'',selected:!!result.suggestedTitle&&placeholder&&chapter.titleSource!=='manual'&&result.suggestedTitle!==chapter.title}]);
  }}catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'The opening could not be read.');}
  finally{if(work.current===controller){work.current=null;setProgress('');}}
 }
 async function save(){
  setSaving(true);setError('');try{
   const titles=previews.filter(p=>p.selected&&p.title.trim()).map(p=>({chapterId:p.chapterId,previousTitle:p.previousTitle,title:p.title.trim()}));
   if(await mutate('chapter-titles',{titles}))setPreviews([]);
  }catch(e){setError(e instanceof Error?e.message:'The names could not be saved.');}finally{setSaving(false);}
 }
 function edit(id:string,patch:Partial<Pick<Preview,'title'|'selected'>>){setPreviews(items=>items.map(p=>p.chapterId===id?{...p,...patch}:p));}
 return <div className="book-spoken-headings">
  <p className="library-caption">Read the opening words at the section breaks below. Review or edit the suggested names before saving. Audio is processed locally.</p>
  <button disabled={disabled||!!progress||saving} onClick={()=>void read()}>Read spoken headings{book.chapters.length>48?' on this page':''}</button>
  {progress&&<p role="status">{progress} <button onClick={()=>{work.current?.abort();}}>Cancel reading</button></p>}
  {error&&<p role="alert">{error}</p>}
  {!!previews.length&&<>
   <h3>Review spoken headings</h3><p className="library-caption">Speech recognition can mishear words. No clear heading means no suggested name. Saved names are kept until you choose to replace them.</p>
   <ol className="book-heading-previews">{previews.map(p=><li key={p.chapterId}>
    <strong>{p.previousTitle} · {bookTime(p.position)}</strong>
    <button onClick={()=>listen(p.partId,p.position)}>Listen to opening</button>
    <p><small>Words heard</small><br/>{p.transcript||'No clear speech was detected in this opening.'}</p>
    {!p.suggestedTitle&&<p className="library-caption">No clear spoken heading found. Keep the current name or enter one below.</p>}
    <label htmlFor={`heading-${p.chapterId}`}>Section name</label>
    <input id={`heading-${p.chapterId}`} disabled={disabled||saving} maxLength={200} value={p.title} onChange={e=>edit(p.chapterId,{title:e.target.value,selected:!!e.target.value.trim()})}/>
    <label className="book-heading-choice"><input type="checkbox" disabled={disabled||saving||!p.title.trim()} checked={p.selected} onChange={e=>edit(p.chapterId,{selected:e.target.checked})}/>Use this name</label>
   </li>)}</ol>
   <div className="book-actions"><button disabled={disabled||!!progress||saving||!previews.some(p=>p.selected&&p.title.trim())} onClick={()=>void save()}>{saving?'Saving names…':'Save selected names'}</button><button disabled={!!progress||saving} onClick={()=>setPreviews([])}>Discard suggestions</button></div>
  </>}
 </div>;
}
