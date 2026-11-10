import {useEffect,useRef,useState} from 'react';
import type {LyricLine,LyricsResult} from '@freeqify/shared';
import {readLibrary} from './library-api.js';

export function activeLyric(lines:LyricLine[],position:number){
 let low=0,high=lines.length-1,found=-1;
 while(low<=high){const middle=(low+high)>>>1;if(lines[middle]!.time<=position){found=middle;low=middle+1;}else high=middle-1;}
 return found;
}
export function LyricsPanel({trackId,position,duration,seekable,offline,onSeek}:{trackId:string;position:number;duration:number;seekable:boolean;offline:boolean;onSeek:(position:number)=>void}){
 const [result,setResult]=useState<LyricsResult|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const [following,setFollowing]=useState(true),[offset,setOffset]=useState(0);
 const scroll=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(offline)return;
  const controller=new AbortController();
  void readLibrary<LyricsResult>(`tracks/${encodeURIComponent(trackId)}/lyrics`,controller.signal)
   .then(value=>{if(!controller.signal.aborted)setResult(value);})
   .catch(()=>{if(!controller.signal.aborted)setError('Lyrics could not load. Your music will keep playing.');});
  return()=>controller.abort();
 },[trackId,retry,offline]);
 const lines=result?.status==='synced'?result.lines:[],active=activeLyric(lines,position+offset);
 useEffect(()=>{
  if(!following||active<0)return;
  const container=scroll.current,row=container?.querySelector<HTMLElement>(`[data-line="${active}"]`);
  if(!container||!row)return;
  const top=row.getBoundingClientRect().top-container.getBoundingClientRect().top+container.scrollTop-container.clientHeight/2+row.clientHeight/2;
  container.scrollTo?.({top:Math.max(0,top),behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
 },[active,following]);
 function reload(){setResult(null);setError('');setRetry(n=>n+1);}
 const message=offline?'Connect to Freeqify to look up lyrics.':error||(!result?'Finding lyrics…':result.status==='missing'?'No matching lyrics found for this recording.':result.status==='instrumental'?'Instrumental — no lyrics.':result.status==='disabled'?'Lyrics are not enabled on this server.':result.status==='unavailable'?'Lyrics are temporarily unavailable. Your music will keep playing.':'');
 return <section className="lyrics-panel" aria-label="Song lyrics">
  <div className="lyrics-heading"><h3>Lyrics</h3>{result?.status==='synced'&&!offline&&<div className="lyrics-timing"><button aria-label="Show lyrics half a second earlier" disabled={offset>=10} onClick={()=>setOffset(n=>Math.min(10,n+.5))}>Earlier</button><button aria-label="Reset lyrics timing" title="Positive timing shows lyrics earlier" onClick={()=>setOffset(0)}>{offset>0?'+':''}{offset.toFixed(1)}s</button><button aria-label="Show lyrics half a second later" disabled={offset<=-10} onClick={()=>setOffset(n=>Math.max(-10,n-.5))}>Later</button></div>}</div>
  {message?<p className="lyrics-message" role="status">{message}{!offline&&(error||result?.status==='unavailable')&&<> <button onClick={reload}>Retry lyrics</button></>}</p>:<>
   {result?.status==='plain'&&<p className="lyrics-caption">Timing isn’t available for this song.</p>}
   <div ref={scroll} className="lyrics-scroll" tabIndex={0} aria-label="Lyrics text" onWheel={()=>setFollowing(false)} onTouchStart={()=>setFollowing(false)} onPointerDown={()=>setFollowing(false)} onKeyDown={e=>{if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','PageUp','PageDown','Home','End',' '].includes(e.key)){e.stopPropagation();setFollowing(false);}}}>
    {result?.status==='synced'?<ol>{lines.map((line,index)=><li key={index} data-line={index} className={index===active?'is-current':index<active?'is-past':''}>{line.text?<button aria-current={index===active?'true':undefined} disabled={!seekable} onClick={()=>{onSeek(Math.max(0,Math.min(duration,line.time-offset)));setFollowing(true);}}>{line.text}</button>:<span className="lyrics-gap" aria-label="Instrumental passage">♪</span>}</li>)}</ol>:result?.status==='plain'?<p className="lyrics-plain">{result.text}</p>:null}
   </div>
   <div className="lyrics-footer"><a href="https://lrclib.net" target="_blank" rel="noopener noreferrer">Lyrics from LRCLIB</a>{result?.status==='synced'&&(!following?<button onClick={()=>setFollowing(true)}>Follow lyrics</button>:<small>Tap a line to seek</small>)}</div>
  </>}
 </section>;
}
