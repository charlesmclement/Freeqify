// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import {PlaybackSurface} from './PlaybackSurface.js';
import { AccountProvider } from './Authentication.js';
import { Playback, usePlayer } from './Player.js';
import { emptyPlayback, type Track } from '@freeqify/shared';
const tracks: Track[] = [0,1,2].map(i => ({ id: `t${i}`, title: `Song ${i}`, artist: 'Artist', album: 'Album', duration: 120, format: i ? 'wav' : 'mp3', artworkId: null, albumId: 'album', trackNumber: i+1 }));
const user = { id: 'listener', username: 'listener', role: 'listener', status: 'active', createdAt: 0 };
beforeEach(() => { localStorage.clear();window.history.replaceState(null,'','/'); vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {}); vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}); vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function Controls() { const p = usePlayer(); const [view, setView] = useState(false); return <><button onClick={() => p.play(tracks)}>Start album</button><button onClick={() => p.add(tracks[0]!)}>Add song</button><button onClick={() => setView(!view)}>Browse</button><div>{view ? 'Administrative view' : 'Library view'}</div></>; }
function setup(restored = emptyPlayback(),mainPane=false) {
  const fetcher = vi.fn().mockImplementation(async (url: string) => ({ ok: true, json: async () => url.endsWith('/auth/session') ? { user, csrf: 'a'.repeat(64), expiresAt: Date.now()+3600000 } : url.endsWith('/playback') ? restored : tracks.find(t => url.endsWith(t.id)) ?? { user } })); vi.stubGlobal('fetch', fetcher);
  render(<AccountProvider><Playback><Controls />{mainPane&&<main id="main"><PlaybackSurface/></main>}</Playback></AccountProvider>); return fetcher;
}
const element = () => document.querySelector('audio')!;
it('uses one persistent audio element across browsing, with play/pause and track selection', async () => {
  setup(); await waitFor(() => expect(document.querySelector('audio')).toBeTruthy()); await waitFor(() => expect(screen.getByText('Find your frequency')).toBeVisible());
  fireEvent.click(screen.getByText('Start album')); await waitFor(() => expect(element().src).toContain('/stream/t0?format=raw'));
  const audio = element(); fireEvent.play(audio); expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled(); fireEvent.click(screen.getByRole('button', { name: 'Pause' })); expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  fireEvent.click(screen.getByText('Browse')); expect(screen.getByText('Administrative view')).toBeVisible(); expect(element()).toBe(audio);
  fireEvent.click(screen.getByRole('button', { name: 'Next track' })); await waitFor(() => expect(audio.src).toContain('/stream/t1?format=raw'));
  fireEvent.click(screen.getByRole('button', { name: 'Previous track' })); await waitFor(() => expect(audio.src).toContain('/stream/t0?format=raw'));
});
it('restores a saved queue paused, seeks when supported, and clears media on logout', async () => {
  setup({ ...emptyPlayback(), queue: [{ key: 'entry', source: 'local', trackId: 't1' }], order: ['entry'], current: 'entry', position: 20, volume: 0.4 });
  await waitFor(() => expect(element()?.src).toContain('/stream/t1'));
  expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  Object.defineProperty(element(), 'duration', { configurable: true, value: 120 }); Object.defineProperty(element(), 'seekable', { configurable: true, value: { length: 1, start: () => 0, end: () => 120 } });
  fireEvent.loadedMetadata(element()); expect(element().currentTime).toBe(20); fireEvent.progress(element());
  fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '35' } }); expect(element().currentTime).toBe(35);
  fireEvent(window, new Event('freeqify:logout')); expect(element().getAttribute('src')).toBeNull(); expect(screen.getByRole('button', { name: 'Show playback queue' })).toBeVisible();
});
it('buffers MP3 compatibility after WAV decode failure and holds the song on another failure', async () => {
  setup(); await waitFor(() => expect(element()).toBeTruthy()); await waitFor(() => expect(screen.getByText('Find your frequency')).toBeVisible());
  fireEvent.click(screen.getByText('Start album')); fireEvent.click(screen.getByRole('button', { name: 'Next track' }));
  await waitFor(() => expect(element().src).toContain('/stream/t1?format=raw')); fireEvent.error(element()); await waitFor(() => expect(element().src).toContain('format=mp3')); expect(screen.getByRole('slider', { name: 'Seek' })).toBeDisabled();
  fireEvent.error(element()); expect(element().src).toContain('/stream/t1'); expect(screen.getByText('This song could not play. Try MP3 compatibility.')).toBeVisible();
});
it('prioritizes manual additions, reorders context and clears only manual songs without interrupting audio', async () => {
  setup(); await waitFor(()=>expect(screen.getByText('Find your frequency')).toBeVisible());fireEvent.click(screen.getByText('Start album'));
  await waitFor(()=>expect(element().src).toContain('/stream/t0'));const audio=element(),source=audio.src;
  fireEvent.click(screen.getByRole('button',{name:'Show playback queue'}));await screen.findByRole('button',{name:'Actions for Song 2'});
  fireEvent.click(screen.getByRole('button',{name:'Actions for Song 2'}));fireEvent.click(screen.getByRole('menuitem',{name:'Move up'}));expect(screen.getAllByRole('listitem')[1]).toHaveTextContent('Song 2');
  fireEvent.click(screen.getByRole('button',{name:'Actions for Song 1'}));fireEvent.click(screen.getByRole('menuitem',{name:'Remove from queue'}));expect(screen.getAllByRole('listitem')).toHaveLength(2);
  fireEvent.click(screen.getByText('Add song'));expect(screen.getAllByRole('listitem')).toHaveLength(3);
  fireEvent.click(screen.getByRole('button',{name:'Clear manual queue'}));expect(screen.getAllByRole('listitem')).toHaveLength(2);expect(audio.src).toBe(source);
  fireEvent.click(screen.getByRole('button',{name:'Repeat off'}));fireEvent.click(screen.getByRole('button',{name:'Repeat all'}));fireEvent.ended(audio);expect(audio.src).toBe(source);
  fireEvent.click(screen.getByRole('button',{name:'Collapse queue'}));expect(screen.getByRole('button',{name:'Show playback queue'})).toHaveAttribute('aria-expanded','false');expect(document.querySelectorAll('audio')).toHaveLength(1);
});
it('expands the mobile player, controls the same audio, and returns without reloading it',async()=>{
 setup();await waitFor(()=>expect(screen.getByText('Find your frequency')).toBeVisible());
 fireEvent.click(screen.getByText('Start album'));
 await waitFor(()=>expect(element().src).toContain('/stream/t0?format=raw'));
 const audio=element();const source=audio.src;const loads=vi.mocked(HTMLMediaElement.prototype.load).mock.calls.length;
 fireEvent.click(screen.getByRole('button',{name:'Open Now Playing'}));
 const dialog=await screen.findByRole('dialog',{name:'Now Playing'});
 expect(dialog).toHaveTextContent('Song 0');expect(dialog).toHaveTextContent('Song 1');
 expect(document.body.style.overflow).toBe('hidden');
 fireEvent.click(screen.getByRole('button',{name:'Shuffle'}));
 expect(element()).toBe(audio);expect(audio.src).toBe(source);
 expect(vi.mocked(HTMLMediaElement.prototype.load).mock.calls).toHaveLength(loads);
 fireEvent.click(screen.getByRole('button',{name:'Show playback queue'}));
 expect(screen.getByLabelText('Up Next queue')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Close Now Playing'}));
 expect(screen.queryByRole('dialog',{name:'Now Playing'})).not.toBeInTheDocument();
 expect(screen.getByLabelText('Playback queue')).toHaveAttribute('aria-hidden','true');
 expect(screen.getByLabelText('Up Next queue')).toHaveAttribute('aria-hidden','true');
 expect(document.body.style.overflow).toBe('');expect(element()).toBe(audio);expect(audio.src).toBe(source);
});

it('keeps full-player queue collapse independent of playback, seek and visualizer state',async()=>{
 setup();await waitFor(()=>expect(screen.getByText('Find your frequency')).toBeVisible());fireEvent.click(screen.getByText('Start album'));
 await waitFor(()=>expect(element().src).toContain('/stream/t0'));const audio=element(),source=audio.src;
 fireEvent.click(screen.getByRole('button',{name:'Show seek bar'}));
 fireEvent.click(screen.getByRole('button',{name:'Open Now Playing'}));const dialog=await screen.findByRole('dialog',{name:'Now Playing'});
 fireEvent.click(screen.getByRole('button',{name:'Show playback queue'}));await screen.findByRole('button',{name:'Actions for Song 2'});
 fireEvent.click(screen.getByRole('button',{name:'Actions for Song 2'}));fireEvent.click(screen.getByRole('menuitem',{name:'Remove from queue'}));expect(screen.getAllByRole('listitem')).toHaveLength(2);
 fireEvent.click(screen.getByRole('button',{name:'Actions for Song 1'}));expect(screen.getByRole('menuitem',{name:'Move up'})).toBeDisabled();fireEvent.keyDown(document,{key:'Escape'});
 fireEvent.click(screen.getByRole('button',{name:'Collapse queue'}));expect(dialog).toBeVisible();expect(dialog).not.toHaveClass('player-immersive');expect(audio.src).toBe(source);
 fireEvent.click(screen.getByRole('button',{name:'Close Now Playing'}));expect(screen.getByRole('button',{name:'Hide seek bar'})).toHaveAttribute('aria-expanded','true');expect(element()).toBe(audio);
});

vi.mock('./song-buffer.js',()=>({SongTooLarge:class extends Error{},SongBuffer:class{retain(){}clear(){}has(){return false;}source(){return 'server';}get(_key:string,source:string){return Promise.resolve(`blob:${source}`);}}}));

it('expands and collapses the dock seek controls without changing the audio source or loading it again',async()=>{
 setup();await waitFor(()=>expect(screen.getByText('Find your frequency')).toBeVisible());fireEvent.click(screen.getByText('Start album'));
 await waitFor(()=>expect(element().src).toContain('/stream/t0?format=raw'));
 const audio=element(),source=audio.src,loads=vi.mocked(HTMLMediaElement.prototype.load).mock.calls.length;
 const toggle=screen.getByRole('button',{name:'Show seek bar'});expect(toggle).toHaveAttribute('aria-expanded','false');
 fireEvent.click(toggle);expect(screen.getByRole('button',{name:'Hide seek bar'})).toHaveAttribute('aria-expanded','true');
 fireEvent.click(screen.getByRole('button',{name:'Hide seek bar'}));expect(toggle).toHaveAttribute('aria-expanded','false');
 expect(element()).toBe(audio);expect(audio.src).toBe(source);expect(vi.mocked(HTMLMediaElement.prototype.load).mock.calls).toHaveLength(loads);
});

it('recovers unacknowledged queue edits from this account paused without server queue restoration',async()=>{
 setup();await waitFor(()=>expect(screen.getByText('Find your frequency')).toBeVisible());fireEvent.click(screen.getByText('Start album'));await waitFor(()=>expect(element().src).toContain('/stream/t0'));
 fireEvent.click(screen.getByText('Add song'));const local=localStorage.getItem('freeqify.queue-draft.listener');expect(local).toBeTruthy();expect(JSON.parse(local!).queue).toHaveLength(4);
 cleanup();vi.mocked(HTMLMediaElement.prototype.play).mockClear();setup();await waitFor(()=>expect(element().src).toContain('/stream/t0'));expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
 await waitFor(()=>expect(screen.getByRole('button',{name:'Hide playback queue'})).toBeVisible());expect(screen.getAllByRole('listitem')).toHaveLength(4);
 fireEvent(window,new Event('freeqify:logout'));expect(localStorage.getItem('freeqify.queue-draft.listener')).toBeNull();
});

it('swipes the tray independently and keeps the visualizer in the main pane',async()=>{
 setup(emptyPlayback(),true);await waitFor(()=>expect(screen.getByText('Find your frequency')).toBeVisible());fireEvent.click(screen.getByText('Start album'));
 await waitFor(()=>expect(element().src).toContain('/stream/t0'));const audio=element(),source=audio.src;
 const swipe=(from:number,to:number)=>{const handle=document.querySelector('.player-controls .player-play')!;for(const [type,y] of [['pointerdown',from],['pointerup',to]] as const){const event=new Event(type,{bubbles:true});Object.assign(event,{pointerType:'touch',isPrimary:true,pointerId:8,clientX:40,clientY:y});fireEvent(handle,event);}};
 swipe(200,130);await waitFor(()=>expect(screen.getByRole('button',{name:'Lower bottom tray'})).toHaveAttribute('aria-expanded','true'));
 swipe(130,200);await waitFor(()=>expect(screen.getByRole('button',{name:'Expand bottom tray'})).toHaveAttribute('aria-expanded','false'));
 fireEvent.click(screen.getByRole('button',{name:'Open Now Playing'}));const dialog=await screen.findByRole('dialog',{name:'Now Playing'});
 expect(dialog.closest('#main')).toBeTruthy();expect(dialog).toHaveAttribute('aria-modal','false');expect(document.body.style.overflow).toBe('');
 expect(screen.getByRole('button',{name:'Expand bottom tray'})).toBeVisible();expect(element()).toBe(audio);expect(audio.src).toBe(source);
});

it('shows earlier queue songs and replays one without replacing the queue or audio element',async()=>{
 setup();await waitFor(()=>expect(screen.getByText('Find your frequency')).toBeVisible());fireEvent.click(screen.getByText('Start album'));
 await waitFor(()=>expect(element().src).toContain('/stream/t0'));const audio=element();
 fireEvent.click(screen.getByRole('button',{name:'Next track'}));fireEvent.click(screen.getByRole('button',{name:'Next track'}));
 fireEvent.click(screen.getByRole('button',{name:'Show playback queue'}));fireEvent.click(screen.getByRole('button',{name:'Earlier (2)'}));
 const earlier=screen.getByLabelText('Earlier in this queue');await waitFor(()=>expect(earlier).toHaveTextContent('Song 0'));
 fireEvent.click(screen.getByRole('button',{name:'Play Song 0'}));await waitFor(()=>expect(element().src).toContain('/stream/t0'));expect(element()).toBe(audio);expect(document.querySelectorAll('.queue-scroll li')).toHaveLength(3);
});
