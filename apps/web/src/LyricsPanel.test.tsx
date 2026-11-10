// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {LyricsPanel,activeLyric} from './LyricsPanel.js';
const lines=[{time:5,text:'A fixture opening'},{time:15,text:'A fixture ending'},{time:20,text:''}];
const result={status:'synced',provider:'LRCLIB',recordId:1,text:'',lines};
const props={trackId:'one',position:6,duration:30,seekable:true,offline:false,onSeek:vi.fn()};
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.clearAllMocks();});
it('highlights from media time, seeks on click and adjusts timing without starting audio',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>result}));const view=render(<LyricsPanel {...props}/>);
 const first=await screen.findByRole('button',{name:'A fixture opening'});expect(first).toHaveAttribute('aria-current','true');
 view.rerender(<LyricsPanel {...props} position={16}/>);expect(screen.getByRole('button',{name:'A fixture ending'})).toHaveAttribute('aria-current','true');
 fireEvent.click(screen.getByRole('button',{name:'Show lyrics half a second earlier'}));fireEvent.click(first);expect(props.onSeek).toHaveBeenCalledWith(4.5);
 fireEvent.wheel(screen.getByLabelText('Lyrics text'));fireEvent.click(screen.getByRole('button',{name:'Follow lyrics'}));expect(screen.queryByRole('button',{name:'Follow lyrics'})).not.toBeInTheDocument();
 view.rerender(<LyricsPanel {...props} position={21}/>);expect(screen.queryByRole('button',{current:true})).not.toBeInTheDocument();
});
it('does not fetch offline and distinguishes instrumental and plain lyrics',async()=>{
 const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({status:'instrumental'})});vi.stubGlobal('fetch',fetcher);const view=render(<LyricsPanel {...props} offline/>);expect(fetcher).not.toHaveBeenCalled();expect(screen.getByRole('status')).toHaveTextContent('Connect');view.unmount();
 const instrumental=render(<LyricsPanel {...props}/>);await screen.findByText('Instrumental — no lyrics.');instrumental.unmount();
 fetcher.mockResolvedValue({ok:true,json:async()=>({...result,status:'plain',lines:[],text:'<script>fixture text</script>'})});render(<LyricsPanel {...props}/>);await screen.findByText('Timing isn’t available for this song.');expect(screen.getByText('<script>fixture text</script>')).toBeVisible();expect(document.querySelector('script')).toBeNull();
});
it('retries a provider outage and aborts late responses after changing songs',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({status:'unavailable'})}).mockResolvedValue({ok:true,json:async()=>result});vi.stubGlobal('fetch',fetcher);const view=render(<LyricsPanel {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'Retry lyrics'}));await screen.findByRole('button',{name:'A fixture opening'});expect(fetcher).toHaveBeenCalledTimes(2);view.unmount();
 let finish!:(v:unknown)=>void;fetcher.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const slow=render(<LyricsPanel {...props}/>);await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(3));const signal=fetcher.mock.calls[2]![1].signal;slow.unmount();expect(signal.aborted).toBe(true);render(<LyricsPanel {...props} trackId="two"/>);await screen.findByRole('button',{name:'A fixture opening'});finish({ok:true,json:async()=>({status:'missing'})});await Promise.resolve();expect(screen.queryByText('No matching lyrics found for this recording.')).toBeNull();
});
it('finds the correct timestamp before, at, between and after markers',()=>{expect([0,5,14,15,40].map(t=>activeLyric(lines,t))).toEqual([-1,0,0,1,2]);});
