import {AlbumArtwork} from './AlbumArtwork.js';
import {Icon} from './Icons.js';
import {useAudiobook} from './AudiobookContext.js';
import {bookTime,chapterAt} from './audiobook-player.js';
import {navigateParameter} from './navigation.js';
export function AudiobookControls(){
 const playback=useAudiobook();if(!playback?.state.book)return null;const {controller:c,state:s}=playback,b=s.book!;
 const part=b.parts.find(p=>p.id===s.partId),chapter=chapterAt(b,s.partId,s.position);
 return <section className="audiobook-dock" aria-label="Audiobook player">
  <button className="book-dock-title" onClick={()=>{navigateParameter('view','Audiobooks','Overview');navigateParameter('book',b.id,null);navigateParameter('tools',false,false);navigateParameter('more',false,false);navigateParameter('admin',false,false);}}><span className="book-dock-cover"><AlbumArtwork kind="book" albumId={b.albumId} artworkId={b.artworkId} label={b.title} player/></span><span className="book-dock-metadata"><small>{s.source==='download'?'DEVICE COPY':'STREAMING'} · {b.author}</small><strong>{b.title}</strong><span className="book-dock-chapter">{chapter?.title??part?.title}</span></span></button>
  <div className="book-transport"><button aria-label="Previous chapter" onClick={()=>c.chapter(-1)}><Icon name="back"/></button><button aria-label="Back 30 seconds" onClick={()=>c.skip(-30)}>−30s</button><button className="account-primary" onClick={()=>c.toggle()}>{s.playing||c.waitingToPlay?'Pause book':'Play book'}</button><button aria-label="Forward 30 seconds" onClick={()=>c.skip(30)}>+30s</button><button aria-label="Next chapter" onClick={()=>c.chapter(1)}><Icon name="chevron"/></button></div>
  <label className="book-seek"><span>{bookTime(s.position)}</span><input aria-label="Seek audiobook part" type="range" min={0} max={part?.duration??1} step={1} value={Math.min(s.position,part?.duration??1)} disabled={!s.ready||!part?.duration} onChange={e=>c.seek(s.partId,Number(e.target.value))}/><span>{bookTime(part?.duration??null)}</span></label>
  <div className="book-options"><label>Speed <select aria-label="Audiobook speed" value={b.speed} onChange={e=>void c.mutate('speed',{speed:Number(e.target.value)}).catch(()=>{})}>{[0.5,0.75,1,1.25,1.5,1.75,2,2.5,3].map(speed=><option key={speed} value={speed}>{speed}×</option>)}</select></label>
  <label>Sleep <select aria-label="Audiobook sleep timer" value={s.endChapter?'chapter':s.sleepUntil?'timer':'off'} onChange={e=>c.setSleep(e.target.value)}><option value="off">Off</option>{s.sleepUntil&&<option value="timer">Timer running</option>}<option value="chapter">End of chapter</option>{[5,15,30,45,60].map(n=><option key={n} value={n}>{n} minutes</option>)}</select></label>
  <button onClick={()=>void c.mutate('bookmark',{partId:s.partId,position:s.position,note:`Bookmark at ${bookTime(s.position)}`}).catch(()=>{})}>Bookmark</button><details className="book-volume"><summary>Volume{s.muted?' · muted':''}</summary><div><input aria-label="Audiobook volume" type="range" min="0" max="1" step="0.01" value={s.volume} onChange={e=>c.volume(Number(e.target.value))}/><button onClick={()=>c.mute()}>{s.muted?'Unmute book':'Mute book'}</button></div></details><button onClick={playback.close}>Return to music</button></div>
  {s.error&&<p role="alert">{s.error}</p>}
 </section>;
}
