import {useState} from 'react';
import {Icon} from './Icons.js';
import {useAudiobook} from './AudiobookContext.js';
import {bookTime,chapterAt} from './audiobook-player.js';
import {navigateParameter} from './navigation.js';

export function AudiobookTransport(){
 const playback=useAudiobook();if(!playback?.state.book)return null;const {controller:c,state:s}=playback;
 return <div className="player-controls book-transport"><button aria-label="Previous chapter" onClick={()=>c.chapter(-1)}><span className="previous-icon"><Icon name="next"/></span></button><button aria-label="Back 30 seconds" onClick={()=>c.skip(-30)}>−30</button><button className="player-play" aria-label={s.playing||c.waitingToPlay?'Pause book':'Play book'} onClick={()=>c.toggle()}><Icon name={s.playing||c.waitingToPlay?'pause':'play'}/></button><button aria-label="Forward 30 seconds" onClick={()=>c.skip(30)}>+30</button><button aria-label="Next chapter" onClick={()=>c.chapter(1)}><Icon name="next"/></button></div>;
}
export function AudiobookProgress(){
 const playback=useAudiobook();if(!playback?.state.book)return null;const {controller:c,state:s}=playback,part=s.book!.parts.find(p=>p.id===s.partId);
 return <div className="player-progress book-seek"><span>{bookTime(s.position)}</span><input aria-label="Seek audiobook part" type="range" min={0} max={part?.duration??1} step={1} value={Math.min(s.position,part?.duration??1)} disabled={!s.ready||!part?.duration} onChange={e=>c.seek(s.partId,Number(e.target.value))}/><span>{bookTime(part?.duration??null)}</span></div>;
}
export function AudiobookOptions(){
 const playback=useAudiobook();if(!playback?.state.book)return null;const {controller:c,state:s}=playback,b=s.book!;
 function openBook(){navigateParameter('fullOpen',false,false);navigateParameter('immersive',false,false);navigateParameter('queueOpen',false,false);navigateParameter('view','Audiobooks','Overview');navigateParameter('book',b.id,null);navigateParameter('tools',false,false);navigateParameter('more',false,false);navigateParameter('admin',false,false);}
 return <div className="book-options"><label>Speed <select aria-label="Audiobook speed" value={b.speed} onChange={e=>void c.mutate('speed',{speed:Number(e.target.value)}).catch(()=>{})}>{[0.5,0.75,1,1.25,1.5,1.75,2,2.5,3].map(speed=><option key={speed} value={speed}>{speed}×</option>)}</select></label>
  <label>Sleep <select aria-label="Audiobook sleep timer" value={s.endChapter?'chapter':s.sleepUntil?'timer':'off'} onChange={e=>c.setSleep(e.target.value)}><option value="off">Off</option>{s.sleepUntil&&<option value="timer">Timer running</option>}<option value="chapter">End of chapter</option>{[5,15,30,45,60].map(n=><option key={n} value={n}>{n} minutes</option>)}</select></label>
  <button onClick={()=>void c.mutate('bookmark',{partId:s.partId,position:s.position,note:`Bookmark at ${bookTime(s.position)}`}).catch(()=>{})}>Bookmark</button><label>Volume <input aria-label="Audiobook volume" type="range" min="0" max="1" step="0.01" value={s.volume} onChange={e=>c.volume(Number(e.target.value))}/></label><button onClick={()=>c.mute()}>{s.muted?'Unmute book':'Mute book'}</button><button onClick={openBook}>Open book</button><button onClick={playback.close}>Return to music</button>
 </div>;
}
export function AudiobookChapters({close}:{close:()=>void}){
 const playback=useAudiobook(),[page,setPage]=useState(0);if(!playback?.state.book)return null;const {controller:c,state:s}=playback,b=s.book!;
 const current=chapterAt(b,s.partId,s.position),offset=Math.min(page,Math.max(0,Math.floor((b.chapters.length-1)/48)*48));
 return <div className="book-player-tray"><div className="queue-heading"><h3>Book chapters</h3><button aria-label="Collapse book chapters" onClick={close}><Icon name="chevron"/></button></div><AudiobookOptions/><ol className="book-list queue-scroll">{b.chapters.slice(offset,offset+48).map(chapter=><li key={chapter.id}><button aria-current={chapter.id===current?.id?'true':undefined} onClick={()=>c.go(chapter)}><strong>{chapter.title}</strong><small>{bookTime(chapter.position)}</small></button></li>)}</ol>{b.chapters.length>48&&<div className="library-pages">{offset>0&&<button onClick={()=>setPage(offset-48)}>Previous chapters</button>}{offset+48<b.chapters.length&&<button onClick={()=>setPage(offset+48)}>More chapters</button>}</div>}</div>;
}
