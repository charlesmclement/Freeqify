import {useEffect,useRef,useState} from 'react';
import type {BookTranscript} from '@freeqify/shared';
import {useAccount} from './Authentication.js';
import {accountRequest} from './auth-api.js';
import {activeLyric} from './LyricsPanel.js';

export function BookTranscriptPanel({bookId,partId,position,duration,offline,seekable,onSeek}:{bookId:string;partId:string;position:number;duration:number;offline:boolean;seekable:boolean;onSeek:(position:number)=>void}){
 const account=useAccount(),csrf=account.state?.csrf;
 const start=Math.floor(Math.max(0,Math.min(position,Math.max(0,duration-.01)))/30)*30;
 const [result,setResult]=useState<BookTranscript|null>(null),[error,setError]=useState<{start:number;text:string}|null>(null),[retry,setRetry]=useState(0),[following,setFollowing]=useState(true);
 const cache=useRef(new Map<number,BookTranscript>()),scroll=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(offline||!duration)return;
  const controller=new AbortController();
  async function read(at:number){
   const previous=cache.current.get(at);if(previous)return previous;
   const value=await accountRequest<BookTranscript>(`audiobooks/${bookId}/transcript`,csrf,{partId,position:at},controller.signal);
   if(controller.signal.aborted)return null;
   if(value.partId!==partId||value.start!==at)throw new Error('The transcript did not match this passage.');
   if(cache.current.size>=6)cache.current.delete(cache.current.keys().next().value!);
   cache.current.set(at,value);return value;
  }
  void (async()=>{
   try{
    const value=await read(start);if(!value||controller.signal.aborted)return;setResult(value);setError(null);
    if(value.status==='ready'&&start+30<duration){try{await read(start+30);}catch{/* Next passage can be retried when reached. */}}
   }catch(e){if(!controller.signal.aborted)setError({start,text:e instanceof Error?e.message:'This passage could not be transcribed.'});}
  })();
  return()=>controller.abort();
 },[bookId,partId,start,duration,offline,csrf,retry]);
 const current=result?.start===start&&result.partId===partId?result:null;
 const lines=current?.lines??[],active=activeLyric(lines,position);
 useEffect(()=>{
  if(!following||active<0)return;
  const container=scroll.current,row=container?.querySelector<HTMLElement>(`[data-line="${active}"]`);if(!container||!row)return;
  const top=row.getBoundingClientRect().top-container.getBoundingClientRect().top+container.scrollTop-container.clientHeight/2+row.clientHeight/2;
  container.scrollTo?.({top:Math.max(0,top),behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
 },[active,following,start]);
 const message=offline?'Connect to Freeqify to read audiobook transcripts.':!duration?'This book part has no known duration.':error?.start===start?error.text:!current?'Transcribing this passage locally… Your audiobook will keep playing.':current.status==='disabled'?'Audiobook transcription is not enabled on this server.':!lines.length?'No clear speech was recognized in this passage.':'';
 return <section className="lyrics-panel" aria-label="Audiobook transcript">
  <div className="lyrics-heading"><h3>Lyrics</h3><small>Whisper · automatic transcript</small></div>
  <p className="lyrics-caption">Recognized locally as you listen. Words and timing may contain errors.</p>
  {message?<p className="lyrics-message" role="status">{message}{!offline&&error?.start===start&&<> <button onClick={()=>{setError(null);setRetry(n=>n+1);}}>Retry transcript</button></>}</p>:<>
   <div ref={scroll} className="lyrics-scroll" tabIndex={0} aria-label="Audiobook transcript text" onWheel={()=>setFollowing(false)} onTouchStart={()=>setFollowing(false)} onPointerDown={()=>setFollowing(false)} onKeyDown={event=>{if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','PageUp','PageDown','Home','End',' '].includes(event.key)){event.stopPropagation();setFollowing(false);}}}>
    <ol>{lines.map((line,index)=><li key={`${start}:${index}`} data-line={index} className={index===active?'is-current':index<active?'is-past':''}><button aria-current={index===active?'true':undefined} disabled={!seekable} onClick={()=>{onSeek(Math.max(0,Math.min(duration,line.time)));setFollowing(true);}}>{line.text}</button></li>)}</ol>
   </div>
   <div className="lyrics-footer"><small>Local Whisper</small>{following?<small>Tap a line to seek</small>:<button onClick={()=>setFollowing(true)}>Follow transcript</button>}</div>
  </>}
 </section>;
}
