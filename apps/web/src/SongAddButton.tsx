import {useEffect,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import type {Track} from '@freeqify/shared';
import {usePersonal} from './PersonalContext.js';
import {usePlayer} from './PlaybackContext.js';

type MenuItem={label:string;action:()=>void;disabled?:boolean};
export function ActionMenu({label,children,items,className=''}:{label:string;children:ReactNode;items:MenuItem[];className?:string}){
 const [open,setOpen]=useState(false),[position,setPosition]=useState({left:0,top:0}),[host,setHost]=useState<HTMLElement|null>(null);
 const button=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null);
 const close=()=>{setOpen(false);button.current?.focus({preventScroll:true});};
 useEffect(()=>{
  if(!open)return;
  menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({preventScroll:true});
  const outside=(event:PointerEvent)=>{if(!menu.current?.contains(event.target as Node)&&!button.current?.contains(event.target as Node))setOpen(false);};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}};
  const dismiss=()=>setOpen(false);
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape,true);window.addEventListener('resize',dismiss);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape,true);window.removeEventListener('resize',dismiss);};
 },[open]);
 return <><button ref={button} className={className} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={event=>{if(open){setOpen(false);return;}const rect=event.currentTarget.getBoundingClientRect(),height=items.length*44+12;setHost(event.currentTarget.closest('dialog')??document.body);setPosition({left:Math.max(8,Math.min(rect.left,innerWidth-228)),top:Math.max(8,rect.bottom+height>innerHeight-8?rect.top-height:rect.bottom+4)});setOpen(true);}}>{children}</button>{open&&createPortal(<div ref={menu} role="menu" aria-label={label} className="song-action-menu" style={position} onKeyDown={event=>{
  const buttons=[...menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];const index=buttons.indexOf(document.activeElement as HTMLButtonElement);
  if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[next]?.focus();}
 }}>{items.map(item=><button key={item.label} role="menuitem" disabled={item.disabled} onClick={()=>{close();item.action();}}>{item.label}</button>)}</div>,host??document.body)}</>;
}
export function SongAddButton({track}:{track:Track}){
 const personal=usePersonal(),player=usePlayer();
 if(!personal)return <button className="queue-add" aria-label={`Add ${track.title}`} disabled>＋</button>;
 return <ActionMenu label={`Add ${track.title}`} className="queue-add song-add-button" items={[
  {label:'Add to Playlist',action:()=>personal.choose(track)},
  {label:'Add to Queue',action:()=>player.add(track),disabled:!player.ready},
  {label:'Play Next',action:()=>player.playNext(track),disabled:!player.ready},
 ]}>＋</ActionMenu>;
}
export function AlbumQueueMenu({tracks,title}:{tracks:Track[];title:string}){
 const player=usePlayer();return <ActionMenu label={`Queue ${title}`} className="album-play album-queue-menu" items={[
  {label:'Add album to Queue',action:()=>player.addTracks(tracks),disabled:!player.ready||!tracks.length},
  {label:'Play album Next',action:()=>player.addTracks(tracks,true),disabled:!player.ready||!tracks.length},
 ]}>Queue album</ActionMenu>;
}
