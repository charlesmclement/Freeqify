// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {AlbumArtwork} from './AlbumArtwork.js';
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
it('keeps successful artwork on focus, but refreshes failures and manual changes',()=>{
 render(<AlbumArtwork albumId="album-1" artworkId={null} label="Album"/>);
 const before=screen.getByRole('img').getAttribute('src');
 act(()=>window.dispatchEvent(new Event('focus')));
 expect(screen.getByRole('img').getAttribute('src')).toBe(before);
 fireEvent.error(screen.getByRole('img'));
 expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Artwork unavailable');
 act(()=>window.dispatchEvent(new Event('focus')));
 expect(screen.getByRole('img').getAttribute('src')).toContain('revision=1');
 act(()=>window.dispatchEvent(new Event('freeqify:artwork-changed')));
 expect(screen.getByRole('img').getAttribute('src')).toContain('revision=2');
});

it('retries transient grid image failures a bounded number of times',()=>{
 vi.useFakeTimers();
 render(<AlbumArtwork albumId="album-1" artworkId={null} label="Album"/>);
 for(let i=0;i<2;i++){
  fireEvent.error(screen.getByRole('img'));
  act(()=>vi.advanceTimersByTime(4000));
  expect(screen.getByRole('img').getAttribute('src')).toContain(`revision=${i+1}`);
 }
 fireEvent.error(screen.getByRole('img'));
 act(()=>vi.advanceTimersByTime(10000));
 expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Artwork unavailable');
});

it('uses a stable neutral cover when the album image fails',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({mode:'fallback',coverKey:'generic_07_vinyl_warmth.jpg'})}));
 render(<AlbumArtwork albumId="album-1" artworkId={null} label="Album"/>);
 fireEvent.error(screen.getByRole('img'));
 await waitFor(()=>expect(screen.getByRole('img').getAttribute('src')).toMatch(/freeqify-covers\/generic_/));
 expect(screen.getByRole('img').getAttribute('src')).toContain('generic_07_vinyl_warmth.jpg');
 const source=screen.getByRole('img').getAttribute('src');
 act(()=>window.dispatchEvent(new Event('freeqify:artwork-changed')));
 fireEvent.error(screen.getByRole('img'));
 await waitFor(()=>expect(screen.getByRole('img').getAttribute('src')).toBe(source));
 fireEvent.error(screen.getByRole('img'));
 expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Artwork unavailable');
});
it('does not substitute a neutral cover for an explicit no-artwork choice',async()=>{
 const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({mode:'none'})});
 vi.stubGlobal('fetch',fetcher);
 render(<AlbumArtwork albumId="album-1" artworkId={null} label="Album"/>);
 fireEvent.error(screen.getByRole('img'));
 await waitFor(()=>expect(fetcher).toHaveBeenCalled());
 expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Artwork unavailable');
});

it('shares one random temporary neutral cover across every view of an album',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({mode:'auto',coverKey:null})}));
 const random=vi.spyOn(Math,'random').mockReturnValue(0.4);
 render(<><AlbumArtwork albumId="shared-random-album" artworkId={null} label="Album"/><AlbumArtwork albumId="shared-random-album" artworkId={null} label="Album" player/></>);
 for(const image of screen.getAllByRole('img'))fireEvent.error(image);
 await waitFor(()=>{
  const images=screen.getAllByRole('img');
  expect(images).toHaveLength(2);
  expect(images[0]?.getAttribute('src')).toMatch(/freeqify-covers\/generic_/);
  expect(images[1]?.getAttribute('src')).toBe(images[0]?.getAttribute('src'));
 });
 random.mockRestore();
});
