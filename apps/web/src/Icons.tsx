import type { SVGProps } from 'react';
export type IconName='download'|'tools'|'document'|'capture'|'upload'|'folder'|'home'|'search'|'library'|'playlists'|'more'|'heart'|'album'|'artist'|'track'|'back'|'next'|'shuffle'|'repeat'|'queue'|'close'|'chevron'|'settings'|'play'|'pause';
const paths:Record<IconName,string>={
 download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
 tools:'M14 6a5 5 0 0 0-6 6L2 18l4 4 6-6a5 5 0 0 0 6-6l-4 4-4-4Z',document:'M5 2h9l5 5v15H5ZM14 2v6h5M8 12h8M8 16h8',capture:'M4 17v-4M8 20V7M12 22V2M16 18V6M20 16v-4',upload:'M12 16V2m-5 5 5-5 5 5M3 14v8h18v-8',folder:'M2 5h8l2 3h10v13H2Z',
 home:'M3 10 12 3l9 7v11h-6v-7H9v7H3Z',search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
 library:'M4 4v16M9 4v16M14 4v16M18 4l4 15',playlists:'M3 5h14M3 11h14M3 17h8M17 15v7M14 19l3 3 3-3',more:'M5 12h.01M12 12h.01M19 12h.01',
 heart:'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',
 album:'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0M14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0',artist:'M17 7a5 5 0 1 1-10 0 5 5 0 0 1 10 0M3 22v-3a9 9 0 0 1 18 0v3Z',track:'M9 18V5l12-3v13M9 18c0 4-7 4-7 1 0-3 7-4 7-1M21 15c0 4-7 4-7 1 0-3 7-4 7-1',
 back:'m15 5-7 7 7 7',next:'M5 4v16l13-8ZM20 4v16',shuffle:'M3 6h3c5 0 7 12 12 12h3M17 14l4 4-4 4M3 18h3c2 0 3-2 4-4M14 8c1-1 2-2 4-2h3M17 2l4 4-4 4',repeat:'M20 7H7a4 4 0 0 0-4 4M17 3l4 4-4 4M4 17h13a4 4 0 0 0 4-4M7 13l-4 4 4 4',queue:'M3 5h18M3 11h13M3 17h10M18 16l4 3-4 3Z',close:'m5 5 14 14M19 5 5 19',chevron:'m9 5 7 7-7 7',settings:'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',play:'m7 3 15 9-15 9Z',pause:'M8 4v16M16 4v16',
};
export function Icon({name,...props}:{name:IconName}&SVGProps<SVGSVGElement>){return <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth={name==='more'?4:1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name]}/></svg>;}
