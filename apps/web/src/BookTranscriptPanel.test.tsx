// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {afterEach,expect,it,vi} from 'vitest';
import {BookTranscriptPanel} from './BookTranscriptPanel.js';
vi.mock('./Authentication.js',()=>({useAccount:()=>({state:{csrf:'fixture-csrf'}})}));
const props={bookId:'book',partId:'part',position:2,duration:90,offline:false,seekable:true,onSeek:vi.fn()};
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.clearAllMocks();});
it('requests bounded private passages, follows time and seeks without starting playback',async()=>{
 const fetcher=vi.fn(async(_url:string,options:RequestInit)=>{const {position}=JSON.parse(String(options.body));return {ok:true,json:async()=>({status:'ready',provider:'Whisper',partId:'part',start:position,end:position+30,lines:[{time:position+1,text:`Passage ${position}`} ]})};});vi.stubGlobal('fetch',fetcher);
 const view=render(<BookTranscriptPanel {...props}/>);const first=await screen.findByRole('button',{name:'Passage 0'});expect(first).toHaveAttribute('aria-current','true');fireEvent.click(first);expect(props.onSeek).toHaveBeenCalledWith(1);
 await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));expect(JSON.parse(String(fetcher.mock.calls[0]![1].body))).toEqual({partId:'part',position:0});
 fireEvent.wheel(screen.getByLabelText('Audiobook transcript text'));fireEvent.click(screen.getByRole('button',{name:'Follow transcript'}));
 view.rerender(<BookTranscriptPanel {...props} position={32}/>);expect(await screen.findByRole('button',{name:'Passage 30'})).toHaveAttribute('aria-current','true');await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(3));
});
it('does no recognition offline and exposes disabled and retry states',async()=>{
 const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({status:'disabled',provider:'Whisper',partId:'part',start:0,end:30,lines:[]})});vi.stubGlobal('fetch',fetcher);
 const offline=render(<BookTranscriptPanel {...props} offline/>);expect(fetcher).not.toHaveBeenCalled();expect(screen.getByRole('status')).toHaveTextContent('Connect');offline.unmount();
 const disabled=render(<BookTranscriptPanel {...props}/>);await screen.findByText(/transcription is not enabled/);expect(fetcher).toHaveBeenCalledTimes(1);disabled.unmount();
 fetcher.mockResolvedValueOnce({ok:false,status:503,json:async()=>({error:{message:'Recognition unavailable'}})}).mockResolvedValue({ok:true,json:async()=>({status:'ready',provider:'Whisper',partId:'part',start:0,end:30,lines:[]})});
 render(<BookTranscriptPanel {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'Retry transcript'}));await screen.findByText('No clear speech was recognized in this passage.');
});
