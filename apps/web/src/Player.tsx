import {OfflineStore} from './offline-store.js';
import {createPortal} from 'react-dom';
import {PlaybackSurfaceContext} from './PlaybackSurface.js';
import {QueueTray} from './QueueTray.js';
import {PlaybackContext as Context,type PlaybackActions as Actions,type PlaybackOptions as Options} from './PlaybackContext.js';
import {clearQueueDraft,readQueueDraft,writeQueueDraft} from './queue-draft.js';
export {usePlayer} from './PlaybackContext.js';
import { ScrollingTitle } from './ScrollingTitle.js';
import {useNavigationState,isBoolean} from './navigation.js';
import {ProgressiveAudio,supportsProgressiveAudio} from './progressive-audio.js';
import {SongBuffer,SongTooLarge} from './song-buffer.js';
import { MusicVisualizer } from './MusicVisualizer.js';
import { disposeSpectrum, resumeSpectrum } from './audio-spectrum.js';
import { Icon } from './Icons.js';
import { TrackActions } from './TrackActions.js';
import { AlbumArtwork } from './AlbumArtwork.js';
import { useListeningHistory } from './useListeningHistory.js';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { emptyPlayback, validPlayback, QUEUE_LIMIT, PERSONAL_PAGE_SIZE, type MediaReference, type PlaybackState, type Track } from '@freeqify/shared';
import { useAccount } from './Authentication.js';
import { accountRequest } from './auth-api.js';
import { libraryUrl, readLibrary } from './library-api.js';
import { startContext, manualKeys, upcoming, queueManually, clearManual, moveQueued, removeQueued, shuffleQueue, step } from './playback-queue.js';
import { duration } from './duration.js';
export function Playback({ children }: { children: ReactNode }) {
  const account = useAccount();
  return account.state?.user ? <Player key={account.state.user.id}>{children}</Player> : children;
}
function PlayerArtwork({id,albumId}:{id:string|null;albumId:string|null}) {
  return <AlbumArtwork artworkId={id} albumId={albumId} label="Album" player/>;
}
function Player({ children }: { children: ReactNode }) {
  const account = useAccount();
  const userId=account.state!.user!.id;
  const [draft]=useState(()=>readQueueDraft(userId));
  const [state, setState] = useState<PlaybackState>(()=>draft??emptyPlayback());
  const latest = useRef(state);
  const selectedByUser = useRef(Boolean(draft));
  const currentKey = state.current;
  const [ready, setReady] = useState(account.offline);
  const [playing, setPlaying] = useState(false);
  const [format, setFormat] = useState<'raw' | 'mp3'>('raw');
  const offlineMode=useRef(account.offline);offlineMode.current=account.offline;
  const [localStore]=useState(()=>new OfflineStore(userId));
  const [buffers]=useState(()=>new SongBuffer(undefined,async key=>{const id=key.slice(0,key.lastIndexOf(':'));const item=await localStore.track(id).catch(()=>undefined);if(item?.state==='complete'){if(key.endsWith(':mp3')&&!['audio/mpeg','audio/mp3'].includes(item.type)){if(offlineMode.current)throw new Error('MP3 compatibility requires a connection for this downloaded format.');return null;}try{return await localStore.completeBlob(id);}catch(error){window.dispatchEvent(new Event('freeqify:downloads-changed'));if(offlineMode.current)throw error;return null;}}if(offlineMode.current)throw new Error('This track has not been downloaded. Choose a saved track from Downloaded music.');return null;}));
  const [bufferStatus,setBufferStatus]=useState('');
  const [bufferReady,setBufferReady]=useState('');
  const [bufferRevision,setBufferRevision]=useState(0);
  const loadingSong=useRef(false);
  const interruptedSong=useRef(false);
  const progressive=useRef<ProgressiveAudio|null>(null);
  const [bufferWantsPlay,setBufferWantsPlay]=useState(false);
  useEffect(()=>()=>buffers.clear(),[buffers]);


  const [message, setMessage] = useState('');
  const [fullOpen,setFullOpen]=useNavigationState('fullOpen',false,isBoolean);
  const [immersive,setImmersive]=useNavigationState('immersive',false,isBoolean);
  const [chromeIdle,setChromeIdle]=useState(false);
  const [hasOpened,setHasOpened]=useState(false);
  const fullDialog=useRef<HTMLDialogElement>(null);
  const [mainSurface,setMainSurface]=useState<HTMLDivElement|null>(null);
  const [homeSurface,setHomeSurface]=useState(false);
  const mountSurface=useCallback((node:HTMLDivElement|null,home:boolean)=>{setMainSurface(node);setHomeSurface(home);},[]);
  const swipe=useRef<{id:number;x:number;y:number}|null>(null),suppressTrayClick=useRef(0);
  const [queueOpen,setQueueOpen]=useNavigationState('queueOpen',false,isBoolean);
  const [queueOffset,setQueueOffset]=useState(0);
  const [showEarlier,setShowEarlier]=useState(false);
  const [seekExpanded,setSeekExpanded]=useState(false);
  const queueMap=useMemo(()=>new Map(state.queue.map(t=>[t.key,t])),[state.queue]);
  const futureKeys=upcoming(state);
  const pageOffset=Math.min(queueOffset,Math.max(0,Math.floor((futureKeys.length-1)/PERSONAL_PAGE_SIZE)*PERSONAL_PAGE_SIZE));
  const visibleKeys=futureKeys.slice(pageOffset,pageOffset+PERSONAL_PAGE_SIZE);
  const earlierKeys=state.order.slice(Math.max(0,state.order.indexOf(state.current??'')-16),Math.max(0,state.order.indexOf(state.current??'')));
  const [metadata, setMetadata] = useState<Record<string, Track>>({});
  const [length, setLength] = useState(0);
  const [seekable, setSeekable] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(()=>{const element=audio.current;return()=>{queueMicrotask(()=>{if(element&&!element.isConnected)disposeSpectrum(element);});};},[]);
  const wantsPlay = useRef(false);
  const restorePosition = useRef(draft?.position??0);
  const dirty = useRef(Boolean(draft));
  const draftVersion=useRef(0),lastDraft=useRef(0),saving=useRef(false);
  const saveError = useRef(false);
  const current = state.queue.find(t => t.key === state.current);
  const track = current ? metadata[current.trackId] : undefined;
  const history = useListeningHistory(state.current, track);
  const currentIndex=state.current?state.order.indexOf(state.current):-1;
  const nextKey=state.order[currentIndex+1]??(state.repeat==='all'?state.order[0]:undefined);
  const nextItem=nextKey?queueMap.get(nextKey):undefined;
  const nextTrack=nextItem?metadata[nextItem.trackId]:undefined;
  useEffect(()=>{
    if(!fullOpen)return;
    const dialog=fullDialog.current!;
    const modal=immersive||!mainSurface,overflow=document.body.style.overflow;
    if(modal)document.body.style.overflow='hidden';
    if(modal&&dialog.showModal)dialog.showModal();else dialog.setAttribute('open','');
    if(mainSurface&&!immersive){document.getElementById('main')?.scrollTo?.({top:0});dialog.querySelector<HTMLButtonElement>('[aria-label="Close Now Playing"]')?.focus({preventScroll:true});}
    return ()=>{dialog.close?.();dialog.removeAttribute('open');if(modal)document.body.style.overflow=overflow;};
  },[fullOpen,immersive,mainSurface]);
  // Activity only updates React when chrome visibility changes, never on animation frames.
  useEffect(()=>{
    if(!fullOpen||!immersive||!playing||queueOpen)return;
    const dialog=fullDialog.current!;let timer:ReturnType<typeof setTimeout>;
    const schedule=()=>{clearTimeout(timer);timer=setTimeout(()=>{
      if(dialog.querySelector('details[open]')||dialog.querySelector('button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible')){schedule();return;}
      setChromeIdle(true);
    },3500);};
    const reveal=()=>{setChromeIdle(false);schedule();};
    for(const event of ['pointermove','pointerdown','keydown','focusin'])dialog.addEventListener(event,reveal);
    schedule();
    return()=>{clearTimeout(timer);for(const event of ['pointermove','pointerdown','keydown','focusin'])dialog.removeEventListener(event,reveal);};
  },[fullOpen,immersive,playing,queueOpen]);
  function toggleImmersive(){setChromeIdle(false);setQueueOpen(false);setImmersive(value=>!value);}
  function update(next: PlaybackState) {
    const previous=latest.current;
    const changed=next.queue!==previous.queue||next.order!==previous.order||next.current!==previous.current||next.shuffle!==previous.shuffle||next.repeat!==previous.repeat||next.volume!==previous.volume||next.muted!==previous.muted;
    if(changed)draftVersion.current++;
    if(changed||Date.now()-lastDraft.current>=5000){writeQueueDraft(userId,next);lastDraft.current=Date.now();}
    dirty.current = true; latest.current = next; setState(next);
  }
  const csrf=account.state!.csrf;
  const persist=useCallback(async()=>{
    if(account.offline||!dirty.current||saving.current)return;
    const snapshot=latest.current,version=draftVersion.current;saving.current=true;dirty.current=false;
    try{await accountRequest('playback',csrf,snapshot);if(version===draftVersion.current)clearQueueDraft(userId);}
    catch{dirty.current=true;if(!saveError.current){saveError.current=true;setMessage('Queue changes could not sync. They will retry when the server is reachable.');}}
    finally{saving.current=false;}
  },[csrf,userId,account.offline]);
  function select(key: string) { history.reset(); restorePosition.current = 0; if (key === latest.current.current && audio.current) { audio.current.currentTime = 0; resume(); } restorePosition.current = 0; wantsPlay.current = true;  setMessage(''); setFormat('raw'); update({ ...latest.current, current: key, position: 0 }); }
  function resume() {
    const element = audio.current; if (!element || !latest.current.current) return;
    wantsPlay.current = true;setBufferWantsPlay(loadingSong.current);
    resumeSpectrum(element);
    if(loadingSong.current)return;
    void element.play().catch(() => { wantsPlay.current = false; setMessage('Tap Play to start audio. If it remains unavailable, try MP3 compatibility.'); });
  }
  function pause() { wantsPlay.current = false;setBufferWantsPlay(false); audio.current?.pause(); }
  function move(direction: 1 | -1, ended = false) {
    restorePosition.current = 0;
    const before = latest.current;
    const next = step(before, direction, ended);
    if (next === before) { wantsPlay.current = false; audio.current?.pause(); return; }
    wantsPlay.current = true; setFormat('raw'); update(next);
    if (next.current === before.current && audio.current) { audio.current.currentTime = 0; resume(); }
  }
  useEffect(() => {
    const controller = new AbortController();
    if(account.offline)return ()=>controller.abort();
    accountRequest<PlaybackState>('playback', undefined, undefined, controller.signal).then(value => {
      if (!controller.signal.aborted) { if (validPlayback(value) && !selectedByUser.current) { restorePosition.current = value.position; latest.current = value; setState(value); } setReady(true); }
    }).catch(() => { if (!controller.signal.aborted) { setReady(true); setMessage('Could not restore the queue. You can still play music.'); } });
    return () => controller.abort();
  }, [account.offline]);
  useEffect(() => {
    const controller = new AbortController();
    const needed=new Set([state.current,...(queueOpen?visibleKeys:[]),...(queueOpen&&showEarlier?earlierKeys:[]),...(fullOpen&&nextKey?[nextKey]:[])]);
    const visible=state.queue.filter(item=>needed.has(item.key));
    const pending = [...new Map(visible.filter(item => !metadata[item.trackId]).map(item=>[item.trackId,item])).values()];
    const worker = async () => {
      while (pending.length && !controller.signal.aborted) {
        const item = pending.shift()!;
        try {
          const stored=await localStore.track(item.trackId).catch(()=>undefined);
          const value = stored?.state==='complete'?stored.track:account.offline?undefined:await readLibrary<Track>(`tracks/${encodeURIComponent(item.trackId)}`, controller.signal);
          if(!value)continue;
          if (!controller.signal.aborted) setMetadata(old => ({ ...Object.fromEntries(Object.entries(old).filter(([id])=>visible.some(item=>item.trackId===id))), [item.trackId]: value }));
        } catch { /* Missing metadata does not prevent trying a stream. */ }
      }
    };
    for (let i = 0; i < 4; i++) void worker();
    return () => controller.abort();
    // Metadata does not change queue membership.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.queue, state.current, state.order, queueOpen, pageOffset,fullOpen,nextKey,showEarlier,account.offline]);
  const bufferKey=current?`${current.trackId}:${format}`:'';
  const nextBufferKey=nextItem?`${nextItem.trackId}:raw`:'';
  useEffect(()=>{buffers.retain([bufferKey,nextBufferKey].filter(Boolean));},[bufferKey,nextBufferKey,buffers]);
  // This effect synchronizes the imperative media source and its loading state.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const element = audio.current; if (!element) return;
    let stopped=false;
    element.pause();element.removeAttribute('src');element.load();setLength(0);setSeekable(false);setBufferReady('');setBufferStatus('');
    loadingSong.current=!!current;interruptedSong.current=false;
    if (!current) {buffers.clear();loadingSong.current=false;setBufferWantsPlay(false);return;}

    const source=libraryUrl(`stream/${encodeURIComponent(current.trackId)}?format=${format}`);
    const needsMp3=format==='raw'&&!buffers.has(bufferKey)&&supportsProgressiveAudio()&&track?.format?.toLowerCase()!=='mp3';
    const attach=(url:string)=>{
     if(stopped)return;loadingSong.current=false;setBufferWantsPlay(false);element.src=url;element.load();
     setBufferReady(bufferKey);setBufferStatus('Whole song ready.');
     if(wantsPlay.current){resumeSpectrum(element);void element.play().catch(()=>setMessage('Tap Play to start audio.'));}
    };
    const progressiveSong=new ProgressiveAudio(element,()=>{
     if(stopped)return;loadingSong.current=false;setBufferWantsPlay(false);
     if(wantsPlay.current){resumeSpectrum(element);void element.play().catch(()=>setMessage('Tap Play to start audio.'));}
    },()=>{if(!stopped)restorePosition.current=element.currentTime;},()=>{if(!stopped)setBufferReady(bufferKey);},()=>{if(!stopped){loadingSong.current=true;setBufferWantsPlay(wantsPlay.current);}});
    progressive.current=progressiveSong;
    // Synchronize the loading indicator with the imperative audio source reset.
     setBufferStatus('Preparing audio buffer…');setBufferWantsPlay(wantsPlay.current);
     void buffers.get(bufferKey,source,(loaded,total)=>{if(!stopped)setBufferStatus(total?`Buffering song… ${Math.floor(100*loaded/total)}%`:`Buffering song… ${(loaded/1048576).toFixed(1)} MB`);},progressiveSong,()=>{if(needsMp3){setFormat('mp3');throw new DOMException('Selecting compatibility format','AbortError');}})
      .then(url=>{if(stopped)return;if(progressiveSong.finished){setBufferReady(bufferKey);setBufferStatus('Whole song ready.');}else{if(progressiveSong.attached)restorePosition.current=element.currentTime;progressiveSong.dispose();attach(url);}}).catch(e=>{if(stopped)return;loadingSong.current=false;setBufferWantsPlay(false);
       if(e instanceof SongTooLarge&&format==='raw'&&track?.format?.toLowerCase()!=='mp3'){setFormat('mp3');setMessage('Preparing a smaller MP3 buffer. Original audio is unchanged.');return;}
       interruptedSong.current=true;
       setBufferStatus(e instanceof Error?e.message:'Could not load the complete song. Retry when connected.');
      });
    return () => { stopped=true;progressiveSong.dispose();if(progressive.current===progressiveSong)progressive.current=null;element.pause();element.removeAttribute('src');element.load(); };
    // Source identity is independent of progress, navigation, and metadata updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey, format,bufferRevision]);
  // Session recovery must not reload a ready or currently playing source.
  const wasOffline=useRef(account.offline);
  useEffect(()=>{
    const reconnected=wasOffline.current&&!account.offline;wasOffline.current=account.offline;
    if(reconnected&&interruptedSong.current&&latest.current.current){
      restorePosition.current=latest.current.position;setBufferRevision(n=>n+1);
    }
  },[account.offline]);
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(()=>{
   if(bufferReady!==bufferKey||!nextItem||nextBufferKey===bufferKey)return;
   void buffers.get(nextBufferKey,libraryUrl(`stream/${encodeURIComponent(nextItem.trackId)}?format=raw`)).catch(()=>{/* Retry when selected; never interrupt the ready current song. */});
  },[bufferReady,bufferKey,nextBufferKey,nextItem?.trackId,buffers]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (audio.current) { audio.current.volume = state.volume; audio.current.muted = state.muted; } }, [state.volume, state.muted]);
  useEffect(() => {
    if (!ready) return;
    const save = () => {
      if (!dirty.current) return;
      void persist();
    };
    const timer = setInterval(save, 15000);
    const hidden = () => { if (document.visibilityState === 'hidden') save(); };
    document.addEventListener('visibilitychange', hidden);
    const online=()=>{void persist();};window.addEventListener('online',online);
    const leaving=()=>{if(dirty.current)writeQueueDraft(userId,latest.current);};window.addEventListener('pagehide',leaving);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', hidden);window.removeEventListener('online',online);window.removeEventListener('pagehide',leaving); };
  }, [ready,persist,userId]);
  useEffect(() => {
    if (!ready || !dirty.current) return;
    const timer = setTimeout(() => {
      void persist();
    }, 800);
    return () => clearTimeout(timer);
  }, [state.queue, state.order, currentKey, state.shuffle, state.repeat, state.volume, state.muted, ready,persist]);
  useEffect(() => {
    if(account.offline)return;
    const timer = setInterval(() => { if(Date.now()>=account.state!.expiresAt){window.dispatchEvent(new Event('freeqify:unauthenticated'));return;}void accountRequest('playback/status').catch(() => {}); }, 15000);
    return () => clearInterval(timer);
  }, [account.state,account.offline]);
  useEffect(() => {
    const stop = () => { progressive.current?.dispose();buffers.clear();loadingSong.current=false;setBufferWantsPlay(false);setBufferReady('');setBufferStatus('');selectedByUser.current=true; wantsPlay.current = false; audio.current?.pause(); audio.current?.removeAttribute('src'); audio.current?.load(); latest.current = emptyPlayback(); setState(emptyPlayback()); setMetadata({});dirty.current=false;clearQueueDraft(userId);setQueueOpen(false);setFullOpen(false); };
    window.addEventListener('freeqify:unauthenticated', stop); window.addEventListener('freeqify:logout', stop);
    return () => { window.removeEventListener('freeqify:unauthenticated', stop); window.removeEventListener('freeqify:logout', stop); if ('mediaSession' in navigator) Object.assign(navigator.mediaSession, { metadata: null }); };
  }, [buffers,setFullOpen,setQueueOpen,userId]);
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    Object.assign(navigator.mediaSession, { metadata: track ? new MediaMetadata({ title: track.title, artist: track.artist, album: track.album, artwork: account.offline ? [] : track.albumId ? [{ src: new URL(libraryUrl(`artwork/album/${encodeURIComponent(track.albumId)}`), location.href).href }] : track.artworkId ? [{ src: new URL(libraryUrl(`artwork/${encodeURIComponent(track.artworkId)}`), location.href).href }] : [] }) : null });
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [['play', resume], ['pause', pause], ['previoustrack', () => move(-1)], ['nexttrack', () => move(1)], ['seekto', details => { if (seekable && details.seekTime !== undefined && audio.current) audio.current.currentTime = Math.min(length, Math.max(0, details.seekTime)); }]];
    for (const [action, handler] of handlers) { try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* Optional browser capability. */ } }
    Object.assign(navigator.mediaSession, { playbackState: playing ? 'playing' : 'paused' });
    return () => { for (const [action] of handlers) { try { navigator.mediaSession.setActionHandler(action, null); } catch { /* Optional. */ } } };
    // Handlers read latest queue through the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, playing, seekable, length,account.offline]);
  function failed() {
    if (!current) return;
    if(progressive.current?.attached){progressive.current.failed();setBufferRevision(n=>n+1);return;}
    if (format === 'raw' && track?.format?.toLowerCase() !== 'mp3') { restorePosition.current = latest.current.position; setFormat('mp3'); setMessage('Trying MP3 compatibility playback…'); return; }
    wantsPlay.current=false;audio.current?.pause();setMessage('This song could not play. Try MP3 compatibility.');return;

  }
  function referenceTracks(refs:MediaReference[]) { return refs.map(ref=>({id:ref.trackId} as Track)); }
  function start(tracks:Track[],index=0,options:Options={}){
    if(tracks.length+manualKeys(latest.current).length>QUEUE_LIMIT){setMessage('Not enough queue space. Remove entries first; the queue holds 5,000 songs.');return;}
    selectedByUser.current=true;
    const label=options.context??(tracks[0]?.album&&tracks.every(t=>t.album===tracks[0]!.album)?tracks[0]!.album:'Current selection');
    const chosen=options.shuffle?Math.floor(Math.random()*tracks.length):index;
    const next=startContext(latest.current,tracks,chosen,label,options.shuffle);
    restorePosition.current=options.position??0;history.reset();wantsPlay.current=true;setMessage('');setFormat('raw');setQueueOffset(0);
    update(next);setMetadata(old=>({...old,...Object.fromEntries(tracks.filter(t=>t.title).map(t=>[t.id,t]))}));
  }
  function addManual(tracks:Track[],next=false){
    if(!ready)return;
    if(tracks.length+latest.current.queue.length>QUEUE_LIMIT){setMessage('Not enough queue space. The queue holds 5,000 songs; remove entries first.');return;}
    selectedByUser.current=true;update(queueManually(latest.current,tracks,next));
    setMetadata(old=>({...old,...Object.fromEntries(tracks.filter(t=>t.title).map(t=>[t.id,t]))}));setQueueOffset(0);setQueueOpen(true);
    setMessage(next?'Added to Play Next.':'Added to queue.');
  }
  const actions:Actions={ready,playReferences:(refs,index=0,options={})=>{start(referenceTracks(refs),index,options);if(refs.length+manualKeys(latest.current).length<=QUEUE_LIMIT)setQueueOpen(true);},addReferences:(refs,next=false)=>addManual(referenceTracks(refs),next),play:start,addTracks:addManual,add:track=>addManual([track]),playNext:track=>addManual([track],true)};
  function closeNowPlaying(){setQueueOpen(false);setFullOpen(false);setImmersive(false);setChromeIdle(false);queueMicrotask(()=>document.querySelector<HTMLButtonElement>('.mini-player-open')?.focus({preventScroll:true}));}
  function collapseQueue(){setQueueOpen(false);queueMicrotask(()=>{const target=fullOpen?fullDialog.current?.querySelector<HTMLButtonElement>('.listening-header-actions button[aria-expanded]'):document.querySelector<HTMLButtonElement>('.music-player>.player-queue-toggle');target?.focus({preventScroll:true});});}
  const audioSource=current?buffers.source(bufferKey):undefined;
  const sourceIndicator=()=>audioSource?<small className="playback-source" data-source={audioSource} title={audioSource==='device'?'Playing the completed downloaded file on this device.':'Audio supplied by the server, including its temporary playback buffer.'}>{audioSource==='device'?'↓ Device storage':'↗ Server stream'}</small>:null;
  const dockAvailable=!fullOpen||Boolean(mainSurface&&!immersive);
  const queueContents=()=><QueueTray showEarlier={showEarlier} toggleEarlier={()=>setShowEarlier(value=>!value)} historyKeys={earlierKeys} state={state} metadata={metadata} keys={visibleKeys} ready={ready} close={collapseQueue} select={select} remove={key=>{selectedByUser.current=true;update(removeQueued(latest.current,key));}} move={(key,target)=>{const before=latest.current,next=moveQueued(before,key,target);if(next===before)return false;selectedByUser.current=true;update(next);return true;}} clear={()=>{selectedByUser.current=true;update(clearManual(latest.current));}} offset={pageOffset} pageSize={PERSONAL_PAGE_SIZE} onPage={setQueueOffset}/>;
  const transport=()=>(<div className="player-controls"><button aria-label="Shuffle" aria-pressed={state.shuffle} onClick={() => update(shuffleQueue(latest.current))}><Icon name="shuffle"/></button><button aria-label="Previous track" onClick={() => { if ((audio.current?.currentTime ?? 0) > 3) {history.reset();audio.current!.currentTime = 0;} else move(-1); }}><span className="previous-icon"><Icon name="next"/></span></button><button className="player-play" aria-label={playing || bufferWantsPlay ? 'Pause' : 'Play'} disabled={!current} onClick={() => playing || bufferWantsPlay ? pause() : resume()}><Icon name={playing || bufferWantsPlay?'pause':'play'}/></button><button aria-label="Next track" onClick={() => move(1)}><Icon name="next"/></button><button aria-label={`Repeat ${state.repeat}`} onClick={() => update({ ...latest.current, repeat: state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off' })}><Icon name="repeat"/><span className="repeat-mode">{state.repeat}</span></button></div>);
  const progress=()=>(<div className="player-progress"><span>{duration(state.position)}</span><input aria-label="Seek" type="range" min="0" max={length || 1} step="0.1" value={Math.min(state.position, length || 0)} disabled={!seekable || !length} onChange={event => { const a = audio.current; if (a && seekable) { a.currentTime = Number(event.target.value); update({ ...latest.current, position: a.currentTime }); } }} /><span>{duration(length)} / −{duration(Math.max(0, length - state.position))}</span></div>);
  return <Context value={actions}><PlaybackSurfaceContext value={mountSurface}>{children}</PlaybackSurfaceContext><audio ref={audio} preload="metadata" onPlay={() => {setPlaying(true);setChromeIdle(false);}} onPause={() => {setPlaying(false);setChromeIdle(false);history.sample(audio.current?.currentTime??0,false);}} onEnded={() => {history.reset();move(1, true);}} onError={failed}
    onDurationChange={() => { const a=audio.current!;setLength(Number.isFinite(a.duration)?a.duration:track?.duration??0); }}
    onLoadedMetadata={() => { const a = audio.current!; setLength(Number.isFinite(a.duration) ? a.duration : track?.duration ?? 0); if (restorePosition.current && a.seekable.length) { a.currentTime = Math.min(restorePosition.current, a.duration || restorePosition.current); restorePosition.current = 0; } }}
    onTimeUpdate={() => { const a = audio.current!; if(Number.isFinite(a.duration)&&a.duration>0)setLength(a.duration);else if(track?.duration)setLength(track.duration); history.sample(a.currentTime,!a.paused&&!a.ended); if (Number.isFinite(a.currentTime)) update({ ...latest.current, position: a.currentTime }); setSeekable(a.seekable.length > 0); }} onProgress={() => setSeekable(Boolean(audio.current?.seekable.length))} />
    <section className={`music-player ${current?'has-track':''} ${seekExpanded?'seek-expanded':''} ${queueOpen&&dockAvailable?'queue-expanded':''}`} aria-label="Music player" aria-hidden={fullOpen&&(immersive||!mainSurface)?true:undefined} onPointerDown={event=>{
      if(event.pointerType==='mouse'||!event.isPrimary||(event.target as HTMLElement).closest('input,select,textarea,.queue-scroll,.song-action-menu'))return;
      swipe.current={id:event.pointerId,x:event.clientX,y:event.clientY};
    }} onPointerMove={event=>{const start=swipe.current;if(start?.id===event.pointerId&&Math.abs(event.clientY-start.y)>16)event.currentTarget.setPointerCapture?.(event.pointerId);}} onPointerUp={event=>{
      const start=swipe.current;swipe.current=null;if(!start||start.id!==event.pointerId)return;
      const dy=event.clientY-start.y,dx=event.clientX-start.x;
      if(Math.abs(dy)>=40&&Math.abs(dy)>Math.abs(dx)*1.4){event.preventDefault();suppressTrayClick.current=Date.now()+400;setQueueOpen(dy<0);}
      if(event.currentTarget.hasPointerCapture?.(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
    }} onPointerCancel={()=>{swipe.current=null;}} onClickCapture={event=>{if(event.detail!==0&&Date.now()<suppressTrayClick.current){event.preventDefault();event.stopPropagation();}}} onKeyDown={event=>{if(event.key==='Escape'&&queueOpen){event.preventDefault();event.stopPropagation();collapseQueue();}}}>
      <button className="tray-swipe-handle" aria-label={queueOpen?'Lower bottom tray':'Expand bottom tray'} aria-expanded={queueOpen} onClick={()=>setQueueOpen(!queueOpen)}><span/></button>
      <div className="player-track"><button className="mini-player-open" aria-label="Open Now Playing" disabled={!current} onClick={()=>{setHasOpened(true);setFullOpen(true);}}><PlayerArtwork key={track?.albumId ?? track?.artworkId ?? 'none'} id={track?.artworkId ?? null} albumId={track?.albumId ?? null} /><span><strong><ScrollingTitle text={track?.title ?? (current ? 'Loading track…' : 'Find your frequency')}/></strong><small>{track ? `${track.artist} · ${track.album}` : 'Choose a song from your library'}</small>{sourceIndicator()}</span></button></div>
      {transport()}
      <button className="player-queue-toggle" aria-label={queueOpen?'Hide playback queue':'Show playback queue'} aria-expanded={queueOpen} aria-controls="dock-queue" title="Playback queue" onClick={()=>setQueueOpen(!queueOpen)}><Icon name="queue"/></button>
      <button className="player-seek-toggle" aria-label={seekExpanded?'Hide seek bar':'Show seek bar'} title={seekExpanded?'Hide seek bar':'Show seek bar'} aria-expanded={seekExpanded} aria-controls="mini-player-seek" onClick={()=>setSeekExpanded(value=>!value)}><Icon name="chevron"/></button>
      <div id="mini-player-seek" className="mini-player-seek">{progress()}</div>
      <div id="dock-queue" className={`player-queue queue-slide ${queueOpen&&dockAvailable?'is-open':''}`} aria-label="Playback queue" aria-hidden={!queueOpen||!dockAvailable} inert={!queueOpen||!dockAvailable}><div className="queue-reveal">{dockAvailable&&queueContents()}</div></div>
      <div className="player-options"><button aria-label={state.muted ? 'Unmute' : 'Mute'} onClick={() => update({ ...latest.current, muted: !state.muted })}>{state.muted ? 'Unmute' : 'Mute'}</button><input aria-label="Volume" type="range" min="0" max="1" step="0.01" value={state.volume} onChange={event => update({ ...latest.current, volume: Number(event.target.value), muted: false })} />{track && <TrackActions track={track}/>} {current && format === 'raw' && <button onClick={() => { restorePosition.current = state.position; setFormat('mp3'); }}>MP3 compatibility</button>}</div>
      {history.error && <p className="player-message">{history.error}</p>}
      {bufferStatus&&<p className="player-message" role="status">{bufferStatus}</p>}
      {message && <p className="player-message" role="status">{message}</p>}
      {current && !seekable && <small className="player-message">Seeking becomes available when the stream supports it.</small>}

    </section>
    {mainSurface&&homeSurface&&!fullOpen&&createPortal(<div className="home-visualizer"><MusicVisualizer audio={audio} active={ready} playing={playing} user={userId} expanded={false} onExpand={()=>{setHasOpened(true);setFullOpen(true);}}/></div>,mainSurface)}
    {(hasOpened||fullOpen)&&createPortal(<dialog ref={fullDialog} className={`player-fullscreen listening-room ${immersive?'player-immersive':''} ${chromeIdle&&immersive&&playing?'player-chrome-idle':''}`} aria-labelledby="now-playing-title" aria-modal={immersive||!mainSurface?true:false} onCancel={event=>{event.preventDefault();if(queueOpen)setQueueOpen(false);else if(immersive)toggleImmersive();else closeNowPlaying();}} onKeyDown={event=>{
      if(event.key==='Escape'&&queueOpen){event.preventDefault();event.stopPropagation();collapseQueue();return;}
      if(event.key==='Escape'&&immersive&&!event.defaultPrevented){event.preventDefault();event.stopPropagation();toggleImmersive();return;}
      if(event.key==='Escape'&&!event.defaultPrevented){event.preventDefault();event.stopPropagation();closeNowPlaying();return;}
      if(event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey||(event.target as HTMLElement).closest('input,select,textarea,[contenteditable]'))return;
      if((event.target as HTMLElement).closest('button,summary')&&event.key.toLowerCase()!=='f')return;
      if(event.key===' '){event.preventDefault();if(audio.current?.paused)resume();else pause();}
      if(event.key.toLowerCase()==='f'){event.preventDefault();toggleImmersive();}
      if((event.key==='ArrowLeft'||event.key==='ArrowRight')&&seekable&&audio.current){event.preventDefault();audio.current.currentTime=Math.max(0,Math.min(length,audio.current.currentTime+(event.key==='ArrowRight'?5:-5)));}
    }}>
      <div className="now-playing-header"><button aria-label="Close Now Playing" onClick={closeNowPlaying}><Icon name="back"/></button><span><span className="brand-mark">≋</span> Freeqify<span className="brand-dot">.</span><small>THE LISTENING ROOM</small></span><div className="listening-header-actions"><button className="immersive-toggle" aria-pressed={immersive} onClick={toggleImmersive}>{immersive?'Exit immersive view':'Immersive view'} <span aria-hidden="true">{immersive?'↙':'↗'}</span></button><button aria-label="Show playback queue" aria-expanded={queueOpen} onClick={()=>{setChromeIdle(false);setQueueOpen(!queueOpen);}}><Icon name="queue"/></button></div></div>
      <div className="now-playing-label"><span className="eyebrow">ON YOUR FREQUENCY</span><h2 id="now-playing-title">Now Playing</h2></div>
      {fullOpen&&<MusicVisualizer audio={audio} active={fullOpen} playing={playing} user={account.state!.user!.id} expanded={immersive} onExpand={toggleImmersive}/>}
      <div className="now-playing-companion">
      <div className="now-playing-art"><AlbumArtwork albumId={track?.albumId??null} artworkId={track?.artworkId??null} label={track?.album??'Album'}/></div>
      <div className="now-playing-track"><div><h3>{track?.title??'Loading track…'}</h3><p>{track?.artist??'Loading artist…'}</p><small>{track?.album}</small>{sourceIndicator()}</div>{track&&<TrackActions track={track}/>}</div>
      {(!mainSurface||immersive)&&<div className="now-playing-transport">{progress()}{transport()}</div>}
      <button className="up-next" disabled={!nextItem} onClick={()=>move(1)}><span className="up-next-icon"><Icon name="queue"/></span><span><small>Up Next</small><strong>{nextItem?nextTrack?.title??'Loading next track…':'End of queue'}</strong>{nextTrack&&<small>{nextTrack.artist}</small>}</span><Icon name="next"/></button>
      <details className="full-player-options"><summary>Playback options</summary><label>Volume<input aria-label="Now Playing volume" type="range" min="0" max="1" step="0.01" value={state.volume} onChange={event=>update({...latest.current,volume:Number(event.target.value),muted:false})}/></label><button onClick={()=>update({...latest.current,muted:!state.muted})}>{state.muted?'Unmute':'Mute'}</button>{current&&format==='raw'&&<button onClick={()=>{restorePosition.current=state.position;setFormat('mp3');}}>MP3 compatibility</button>}<p>Playback starts with a safety buffer while the rest downloads. Unprepared songs may use MP3 compatibility; prepared songs keep their original audio. The next song prepares automatically in temporary memory.</p>{current&&<button onClick={()=>{restorePosition.current=latest.current.position;setBufferRevision(n=>n+1);}}>Retry song</button>}<p>Lyrics are not available for this library.</p></details>
      {bufferStatus&&<p className="player-message" role="status">{bufferStatus}</p>}{message&&<p className="player-message" role="status">{message}</p>}{history.error&&<p className="player-message">{history.error}</p>}
      <div className={`full-queue queue-slide ${queueOpen&&!dockAvailable?'is-open':''}`} aria-label="Up Next queue" aria-hidden={!queueOpen||dockAvailable} inert={!queueOpen||dockAvailable}>{queueOpen&&!dockAvailable&&queueContents()}</div>
      </div>
      <p className="listening-shortcuts">F · immersive &nbsp; / &nbsp; Space · play or pause &nbsp; / &nbsp; ← → · seek &nbsp; / &nbsp; Esc · return</p>
    </dialog>,mainSurface??document.body)}
    </Context>;
}
