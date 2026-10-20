// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,render,screen} from '@testing-library/react';
import {AlbumArtwork} from './AlbumArtwork.js';
const state=vi.hoisted(()=>({offline:false}));
vi.mock('./Authentication.js',()=>({useOptionalAccount:()=>({offline:state.offline})}));
vi.mock('./OfflineContext.js',()=>({useOffline:()=>({tracks:[{id:'song',state:'complete',track:{albumId:'album',artworkId:'art'},artwork:new Blob(['saved'],{type:'image/png'})}]})}));
afterEach(()=>{cleanup();state.offline=false;vi.unstubAllGlobals();});
it('keeps live cover choices online even when the album has downloaded artwork',()=>{render(<AlbumArtwork albumId="album" artworkId="art" label="Album"/>);expect(screen.getByRole('img').getAttribute('src')).toContain('/api/library/artwork/album/album?revision=0');act(()=>window.dispatchEvent(new Event('freeqify:artwork-changed')));expect(screen.getByRole('img').getAttribute('src')).toContain('revision=1');});
it('uses saved artwork only in device-only mode and returns to live resolution online',()=>{vi.stubGlobal('URL',class extends URL {static createObjectURL=vi.fn(()=> 'blob:saved-cover');static revokeObjectURL=vi.fn();});state.offline=true;const view=render(<AlbumArtwork albumId="album" artworkId="art" label="Album"/>);expect(screen.getByRole('img').getAttribute('src')).toBe('blob:saved-cover');state.offline=false;view.rerender(<AlbumArtwork albumId="album" artworkId="art" label="Album"/>);expect(screen.getByRole('img').getAttribute('src')).toContain('/api/library/artwork/album/album');expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:saved-cover');});
