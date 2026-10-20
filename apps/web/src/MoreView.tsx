import type { LibraryView } from './Library.js';
import { ProfileMenu, useAccount } from './Authentication.js';
import { Icon, type IconName } from './Icons.js';
export function MoreView({onNavigate,openAdmin}:{onNavigate:(view:LibraryView)=>void;openAdmin:()=>void}){
 const account=useAccount();
 const links:{view:LibraryView;icon:IconName}[]=[{view:'Downloaded',icon:'download'},{view:'Favorites',icon:'heart'},{view:'Recently played',icon:'track'},{view:'Artists',icon:'artist'},{view:'Tracks',icon:'track'}];
 return <section className="more-view" aria-labelledby="more-heading"><span className="eyebrow">YOUR SPACE</span><h1 id="more-heading">Make yourself at home.</h1><p>Your account, your collections, your frequency.</p>
 <div className="more-links">{links.map(link=><button key={link.view} onClick={()=>onNavigate(link.view)}><Icon name={link.icon}/>{link.view}<Icon name="chevron"/></button>)}</div>
 <section className="more-account"><h2>Your account</h2><ProfileMenu openAdmin={openAdmin}/>{account.state?.user?.role==='admin'&&<button className="account-primary" onClick={openAdmin}>Administration & artwork manager</button>}</section>
 <section className="install-note"><h2>Freeqify on your home screen</h2><p>Android: open Freeqify in Chrome, tap ⋮, then Install app or Add to Home screen → Install. iPhone: open it in Safari, tap Share → Add to Home Screen → Add. The Freeqify tile opens a dedicated app window.</p><p>Windows or Linux: use Chrome’s or Edge’s address-bar install icon or browser menu. Installation requires HTTPS and a supported browser. Manually download music in Freeqify for offline playback. Browser storage can be cleared; export files you want to keep independently.</p></section>
 </section>;
}
