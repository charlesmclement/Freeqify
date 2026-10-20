import {useLayoutEffect,useRef,useState,type CSSProperties} from 'react';

/** Move only overflowing text; the control and its hit target stay stationary. */
export function ScrollingTitle({text}:{text:string}){
 const frame=useRef<HTMLSpanElement>(null),copy=useRef<HTMLSpanElement>(null);
 const [distance,setDistance]=useState(0);
 useLayoutEffect(()=>{
  const measure=()=>setDistance(Math.max(0,(copy.current?.scrollWidth??0)-(frame.current?.clientWidth??0)));
  measure();
  if(typeof ResizeObserver==='undefined')return;
  const observer=new ResizeObserver(measure);
  if(frame.current)observer.observe(frame.current);
  if(copy.current)observer.observe(copy.current);
  return ()=>observer.disconnect();
 },[text]);
 const style={'--title-travel':`${-distance}px`,'--title-duration':`${Math.max(7,distance/20+4)}s`} as CSSProperties;
 return <span ref={frame} className="scrolling-title" title={text} style={style}><span ref={copy} key={text} className={distance>1?'scrolling-title-copy is-overflowing':'scrolling-title-copy'}>{text}</span></span>;
}
