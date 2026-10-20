import {OfflineProvider} from './OfflineContext.js';
import {OfflineView} from './OfflineView.js';
import {useNavigationState,isBoolean,navigateParameter} from './navigation.js';
import {PlaylistImport} from './PlaylistImport.js';
import { MobileNavigation } from './MobileNavigation.js';
import { MoreView } from './MoreView.js';
import { Icon } from './Icons.js';
import { PersonalProvider } from './PersonalContext.js';
import { Playback } from './Player.js';
import {PlaybackSurface} from './PlaybackSurface.js';
import { AccountProvider, ProfileMenu, SignInPanel, useAccount } from './Authentication.js';
import { Administration } from './Administration.js';
import { useEffect, useState } from 'react';
import { Library, libraryViews, type LibraryView } from './Library.js';
import { APP_NAME, TAGLINE, type HealthResponse } from '@freeqify/shared';
export function App() { return <AccountProvider><Freeqify /></AccountProvider>; }
function Freeqify() {
  const account = useAccount();
  const [tools,setTools]=useNavigationState('tools',false,isBoolean);
  const [more,setMore]=useNavigationState('more',false,isBoolean);
  const [admin,setAdmin]=useNavigationState('admin',false,isBoolean);
  const [view, setView] = useNavigationState<LibraryView>('view','Overview',(v):v is LibraryView=>libraryViews.includes(v as LibraryView));
  const [status, setStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => { setStatus('offline'); controller.abort(); }, 5000);
    fetch(`${import.meta.env.BASE_URL}api/health`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Unavailable');
        const data = await response.json() as Partial<HealthResponse>;
        if (data.status !== 'ok' || data.service !== 'freeqify' || data.phase !== 0) throw new Error('Invalid response');
        setStatus('online');
      }).catch(() => { if (!controller.signal.aborted) setStatus('offline'); })
      .finally(() => clearTimeout(timeout));
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [attempt]);
  function scrollTop(){ navigateParameter('fullOpen',false,false);navigateParameter('immersive',false,false);document.getElementById('main')?.scrollTo?.({top:0}); window.scrollTo?.({top:0}); }
  function navigate(next:LibraryView){setTools(false);setMore(false);setAdmin(false);setView(next);for(const key of ['selection','playlist','query','offset'])navigateParameter(key,null,null);scrollTop();}
  function openAdministration(){setTools(false);setMore(false);setAdmin(true);scrollTop();}
  const signedIn=Boolean(account.state?.user);
  useEffect(()=>{if(account.offline){setView('Downloaded');setTools(false);setMore(false);setAdmin(false);}},[account.offline,setView,setTools,setMore,setAdmin]);
  return <OfflineProvider><PersonalProvider><Playback><div className={`shell ${signedIn?'signed-in':''} ${tools?'has-tools':''} ${view==='Overview'&&!admin&&!more&&!tools?'is-home':'is-browsing'}`}>
    <aside className="sidebar" aria-label="Application information">
      <a className="brand" href={import.meta.env.BASE_URL} onClick={event=>{if(signedIn){event.preventDefault();navigate('Overview');}}}><span className="brand-mark" aria-hidden="true">≋</span>{APP_NAME}<span className="brand-dot">.</span></a>
      <div className="side-label">YOUR SPACE</div>
      <nav className="sidebar-nav" aria-label="Your space">{libraryViews.map(item => <button key={item} disabled={!account.state?.user||(account.offline&&item!=='Downloaded')} className={!tools&&view === item ? 'nav-current' : 'nav-item'} aria-current={!tools&&view === item ? 'page' : undefined} onClick={() => { navigate(item); document.getElementById('library')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }); }}><span aria-hidden="true">{{Overview:'⌂',Playlists:'☷',Favorites:'♡','Recently played':'◷',Artists:'◎',Albums:'▣',Tracks:'♫',Search:'⌕',Downloaded:'↓'}[item]}</span>{item}</button>)}<button disabled={!signedIn||account.offline} className={tools?'nav-current':'nav-item'} aria-current={tools?'page':undefined} onClick={()=>{setTools(true);setMore(false);setAdmin(false);scrollTop();}}><Icon name="tools"/>Tools</button></nav>
      <div className="sidebar-note"><span className="small-wave" aria-hidden="true">▂ ▅ █ ▃ ▆</span><strong>Made for your music.</strong><p>Open source. Self hosted.<br />Always on your frequency.</p></div>
      <span className="version">FOUNDATION · v0.1.0</span>
    </aside>
    <main id="main"><header className="app-header"><span className="header-caption">YOUR PERSONAL MUSIC SPACE</span><div className="header-account">{signedIn&&<button className="mobile-search" disabled={account.offline} aria-label="Search your music" onClick={()=>navigate('Search')}><Icon name="search"/></button>}<button className="offline-shortcut" aria-label="Downloaded music" title="Downloaded music" onClick={()=>navigate('Downloaded')}><Icon name="download"/></button><span className="phase-tag">PHASE 4</span><ProfileMenu openAdmin={openAdministration} /></div></header>
      {account.offline&&<p className="offline-banner" role="status">Device library · server unavailable <button onClick={account.refresh}>Reconnect</button></p>}
      <PlaybackSurface home={signedIn&&view==='Overview'&&!tools&&!more&&!admin}/>


      {account.state?.user ? <>
        {account.offline?<OfflineView/>:admin && account.state.user.role === 'admin' ? <><button className="back-to-library" onClick={() => setAdmin(false)}>← Back to library</button><Administration /></> : <>{view==='Downloaded'&&!tools&&!more?<OfflineView/>:tools?<PlaylistImport key={account.state.user.id} onMore={()=>{setTools(false);setMore(true);}}/>:more?<MoreView onNavigate={navigate} openAdmin={openAdministration}/>:<Library key={`${account.state.user.id}:${view}`} view={view} onView={navigate}/>}</>}
      </> : <SignInPanel /> }
      <section className="overview" aria-labelledby="overview-title"><div className="section-title"><h2 id="overview-title">A little closer to your collection</h2><span>BUILT TO BE YOURS</span></div><div className="cards">
        <article><span className="card-icon" aria-hidden="true">⌘</span><h3>Your server, your space</h3><p>Designed for your computer, home server, or compatible Linux host.</p><span className="card-meta">NATIVE LINUX FIRST</span></article>
        <article><span className="card-icon" aria-hidden="true">♫</span><h3>A home for your library</h3><p>Browse your collection through the local music engine. Your original files stay untouched.</p><span className="card-meta">NAVIDROME · LOCAL ENGINE</span></article>
        <article><span className="card-icon" aria-hidden="true">◎</span><h3>Built around privacy</h3><p>Private accounts and invitation-only access. Your music stays in your circle.</p><span className="card-meta">PRIVATE BY DESIGN</span></article>
      </div></section>
      <section className="system" aria-labelledby="system-title"><div><h2 id="system-title">The first track: a solid foundation.</h2><p>Private accounts are here. Your collection is ready to play.</p></div><div className="connection"><span role="status" className={`status ${status}`}><i />{status === 'online' ? 'Server connected' : status === 'offline' ? 'Server unavailable' : 'Checking server…'}</span>{status === 'offline' && <button onClick={() => { setStatus('checking'); setAttempt(a => a + 1); }}>Check again</button>}</div></section>
      <section className="hero" aria-labelledby="welcome"><div className="hero-copy"><span className="eyebrow">{signedIn?'WELCOME BACK':'A NEW HOME FOR YOUR SOUND'}</span><h1 id="welcome">Your Music.<br /><em>Your Frequency.</em></h1><p>A place for the music you love.<br />{' '}On your server. On your terms.</p><span className="foundation-tag"><span aria-hidden="true">✦</span> The foundation is here</span></div><div className="record" aria-hidden="true"><div className="record-label"><span>FREEQIFY</span><b>f.</b><span>SIDE A · 33⅓ RPM</span></div></div></section>
      <footer><span>{TAGLINE}</span><span>FREE & OPEN SOURCE <span aria-hidden="true">↗</span></span></footer>
    </main>
    {signedIn&&<MobileNavigation offline={account.offline} tools={tools} onTools={()=>{setTools(true);setMore(false);setAdmin(false);scrollTop();}} view={view} more={more||admin} onNavigate={navigate} onMore={()=>{setAdmin(false);setMore(true);scrollTop();}}/>}
  </div></Playback></PersonalProvider></OfflineProvider>;
}
