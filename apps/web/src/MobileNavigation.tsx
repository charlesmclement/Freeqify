import type { LibraryView } from './Library.js';
import { Icon, type IconName } from './Icons.js';
const destinations:{label:string;view:LibraryView|null;icon:IconName}[]=[
 {label:'Home',view:'Overview',icon:'home'}, {label:'Search',view:'Search',icon:'search'},
 {label:'Library',view:'Albums',icon:'library'}, {label:'Playlists',view:'Playlists',icon:'playlists'}, {label:'Tools',view:null,icon:'tools'},
];
export function MobileNavigation({view,more,onNavigate,onMore,tools=false,onTools,offline=false}:{offline?:boolean;tools?:boolean;onTools?:()=>void;view:LibraryView;more:boolean;onNavigate:(view:LibraryView)=>void;onMore:()=>void}){
 return <nav className="mobile-navigation" aria-label="Mobile navigation">{destinations.map(item=>{
  const active=item.view===null?tools:!tools&&!more&&(item.view===view||(item.view==='Albums'&&['Artists','Tracks','Favorites','Downloaded'].includes(view)));
  return <button disabled={offline&&item.view!=='Albums'} key={item.label} aria-current={active?'page':undefined} aria-label={item.label} onClick={()=>item.view?onNavigate(offline?'Downloaded':item.view):(onTools??onMore)()}><Icon name={item.icon}/><span>{item.label}</span></button>;
 })}</nav>;
}
