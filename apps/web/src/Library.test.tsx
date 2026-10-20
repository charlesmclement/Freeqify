// @vitest-environment jsdom
import { afterEach,beforeEach, expect, it, vi } from 'vitest';
import { act,cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { Library, duration, type LibraryView } from './Library.js';
import { App } from './App.js';
beforeEach(()=>{localStorage.clear();window.history.replaceState(null,'','/');});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function fixture(routes: Record<string, unknown>, initial: LibraryView = 'Overview') {
  const fetcher = vi.fn().mockImplementation(async (url: string) => {
    const value = routes[url.replace('/api/library/', '')];
    return value === undefined ? { ok: false, json: async () => ({ error: { code: 'UNAVAILABLE', message: 'The local music engine is unavailable.' } }) } : { ok: true, json: async () => value };
  });
  vi.stubGlobal('fetch', fetcher);
  function Harness() { const [view, setView] = useState(initial); return <Library key={view} view={view} onView={setView} />; }
  render(<Harness />); return fetcher;
}
it('shows actual overview counts and an empty-library state', async () => {
  fixture({ overview: { artists: 0, albums: 0, tracks: 0, scanning: false } });
  expect(screen.getByRole('status')).toHaveTextContent('Loading');
  expect(await screen.findByText(/Your library is empty/)).toBeVisible();
  expect(screen.getAllByText('0')).toHaveLength(3);
});
it('shows overview counts received from the backend', async () => {
  fixture({ overview: { artists: 7, albums: 23, tracks: 114, scanning: false } });
  expect(await screen.findByText('114')).toBeVisible(); expect(screen.getByText('23')).toBeVisible(); expect(screen.getByText('7')).toBeVisible();
});
it('navigates artist → album → MP3 and WAV tracks, with album playback controls', async () => {
  fixture({ artists: { items: [{ id: 'ar1', name: 'Artist One', albumCount: 1, artworkId: null }] },
    'artists/ar1': { artist: { id: 'ar1', name: 'Artist One' }, albums: [{ id: 'al1', title: 'Album One', artist: 'Artist One', artworkId: 'cover1' }] },
    'albums/al1': { album: { id: 'al1', title: 'Album One', artist: 'Artist One', artworkId: null }, tracks: [{ id: 't1', title: 'MP3 song', artist: 'Artist One', album: 'Album One', duration: 123, format: 'mp3' }, { id: 't2', title: 'Untitled track', artist: 'Unknown artist', album: 'Unknown album', duration: null, format: 'wav' }] },
  }, 'Artists');
  fireEvent.click(await screen.findByRole('button', { name: /Artist One/ }));
  const album = await screen.findByRole('button', { name: /Album One/ });
  fireEvent.error(within(album).getByRole('img'));
  expect(within(album).getByRole('img', { name: 'Artwork unavailable' })).toBeVisible();
  fireEvent.click(album);
  expect(await screen.findByText('MP3 song')).toBeVisible();
  expect(screen.getByText('2:03')).toBeVisible(); expect(screen.getByText('WAV')).toBeVisible(); expect(screen.getByText('Unknown artist')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Play album' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Add MP3 song' })).toBeDisabled();
});
it('searches artists, albums, and songs and handles empty matches', async () => {
  const fetcher = fixture({ 'search?q=no%20match&offset=0&limit=48': { artists: [], albums: [], tracks: [] } }, 'Search');
  expect(screen.getByText(/Find something/)).toBeVisible();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'no match' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search library' }));
  expect(await screen.findByText('No matching music found.')).toBeVisible();
  expect(fetcher).toHaveBeenCalledWith('/api/library/search?q=no%20match&offset=0&limit=48', expect.anything());
});
it('shows safe errors and supports retry', async () => {
  const fetcher = fixture({});
  expect(await screen.findByRole('alert')).toHaveTextContent('unavailable');
  fetcher.mockResolvedValue({ ok: true, json: async () => ({ artists: 1, albums: 1, tracks: 2, scanning: false }) });
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('2')).toBeVisible();
});
it('preserves the approved Phase 0 hero, vinyl artwork, brand, navigation, and tagline', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => ({ ok: true, json: async () => url.endsWith('/health') ? { status: 'ok', service: 'freeqify', phase: 0 } : url.endsWith('/auth/session') ? { user: { id: 'test-user', username: 'listener', role: 'listener', status: 'active', createdAt: 0 }, csrf: 'a'.repeat(64), expiresAt: Date.now() + 3600000 } : { artists: 0, albums: 0, tracks: 0, scanning: false } })));
  const { container } = render(<App />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Your Music.Your Frequency.');
  expect(container.querySelector('.record .record-label b')).toHaveTextContent('f.');
  expect(container.querySelector('.brand')).toHaveTextContent('Freeqify');
  expect(container.querySelector('.hero')).toBeInTheDocument();
  expect(screen.getByRole('navigation', { name: 'Your space' })).toBeVisible();
  expect(screen.getByText('Your Music. Your Frequency.')).toBeVisible();
  await waitFor(() => expect(screen.getByText('Server connected')).toBeVisible());
});
it('formats known durations and handles absent WAV duration', () => {
  expect(duration(125.9)).toBe('2:05'); expect(duration(null)).toBe('—'); expect(duration(0)).toBe('0:00');
});
it('renders HTML-looking metadata literally and keeps artwork in encoded local paths',async()=>{
 const marker='<b data-audit="canary">Literal & "quoted" text</b>';
 fixture({artists:{items:[{id:'safe',name:marker,albumCount:1,artworkId:'javascript:harmless-marker'}]}},'Artists');
 expect(await screen.findByText(marker)).toBeVisible();expect(document.querySelector('[data-audit="canary"]')).toBeNull();
 expect(screen.getByRole('img')).toHaveAttribute('src','/api/library/artwork/javascript%3Aharmless-marker');
});
it('encodes markup-looking search input rather than interpreting it as HTML',async()=>{
 const marker='<b data-audit="search">literal</b>';const path=`search?q=${encodeURIComponent(marker)}&offset=0&limit=48`;
 const fetcher=fixture({[path]:{artists:[],albums:[],tracks:[]}},'Search');fireEvent.change(screen.getByRole('searchbox'),{target:{value:marker}});fireEvent.click(screen.getByRole('button',{name:'Search library'}));
 expect(await screen.findByText('No matching music found.')).toBeVisible();expect(document.querySelector('[data-audit="search"]')).toBeNull();expect(fetcher).toHaveBeenCalledWith('/api/library/'+path,expect.anything());
});

it('renders bounded artist pages instead of an entire large collection',async()=>{
 fixture({artists:{items:Array.from({length:110},(_,index)=>({id:`artist-${index}`,name:`Artist ${index}`,albumCount:1,artworkId:null}))}},'Artists');
 expect(await screen.findByText('Artist 47')).toBeVisible();
 expect(document.querySelectorAll('.artist-card')).toHaveLength(48);
 expect(screen.queryByText('Artist 48')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Next page'}));
 expect(await screen.findByText('Artist 48')).toBeVisible();
 expect(screen.queryByText('Artist 0')).not.toBeInTheDocument();
});

it.each(['album','artist-tracks'] as const)('refreshes after removal while retaining the current %s page and pagination',async kind=>{
 const selection={kind,id:kind==='album'?'dookie':'unknown'};
 window.history.replaceState(null,'',`/#/selection=${encodeURIComponent(JSON.stringify(selection))}&offset=48`);
 const track={id:'remaining',title:'Remaining song',artist:kind==='album'?'Green Day':'Unknown artist',album:'Dookie',albumId:'dookie',artworkId:null,duration:123,format:'mp3',trackNumber:2};
 const path=kind==='album'?'albums/dookie':'artists/unknown/tracks?offset=48&limit=48';
 const fetcher=fixture({[path]:kind==='album'?{album:{id:'dookie',title:'Dookie',artist:'Green Day',artworkId:null},tracks:[track]}:{items:[track],nextOffset:96}},'Artists');
 await screen.findByText('Remaining song');const href=window.location.href;
 const before=fetcher.mock.calls.filter(call=>call[0]===`/api/library/${path}`).length;
 act(()=>window.dispatchEvent(new CustomEvent('freeqify:library-changed',{detail:{kind:'track',id:'removed'}})));
 await waitFor(()=>expect(fetcher.mock.calls.filter(call=>call[0]===`/api/library/${path}`).length).toBeGreaterThan(before));
 expect(await screen.findByText('Remaining song')).toBeVisible();expect(window.location.href).toBe(href);
 if(kind==='album')expect(screen.getByRole('heading',{name:'Dookie'})).toBeVisible();
 else expect(screen.getByRole('button',{name:'Previous artist tracks'})).toBeVisible();
});
