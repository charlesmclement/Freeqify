import {useEffect,useRef,type ReactNode} from 'react';
import {Icon} from './Icons.js';
export function Sheet({title,close,children}:{title:string;close:()=>void;children:ReactNode}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const dialog=ref.current!;const overflow=document.body.style.overflow;document.body.style.overflow='hidden';dialog.showModal?.();if(!dialog.open)dialog.setAttribute('open','');return()=>{dialog.close?.();document.body.style.overflow=overflow;};},[]);
 return <dialog className="import-sheet" ref={ref} aria-labelledby="import-sheet-title" onCancel={event=>{event.preventDefault();close();}}><header><h2 id="import-sheet-title">{title}</h2><button aria-label="Close dialog" onClick={close}><Icon name="close"/></button></header>{children}</dialog>;
}
