// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type {Audiobook,BookChapter} from '@freeqify/shared';
import {BookSpokenHeadings} from './BookSpokenHeadings.js';
import {accountRequest} from './auth-api.js';
vi.mock('./Authentication.js',()=>({useAccount:()=>({state:{csrf:'csrf'}})}));
vi.mock('./auth-api.js',()=>({accountRequest:vi.fn()}));
const chapters:BookChapter[]=[{id:'intro',partId:'part',position:0,title:'001',kind:'part'},{id:'first',partId:'part',position:100,title:'002',kind:'chapter'}];
const book={id:'book',chapters} as Audiobook;
beforeEach(()=>{vi.mocked(accountRequest).mockReset();});afterEach(cleanup);
it('previews spoken names without writing, then saves reviewed names using original marker IDs and titles',async()=>{
 vi.mocked(accountRequest).mockImplementation(async(_path,_csrf,input)=>{const id=(input as {chapterId:string}).chapterId;return {chapterId:id,position:id==='intro'?0:100,transcript:id==='intro'?'Prologue.':'Chapter 1. The beginning.',suggestedTitle:id==='intro'?'Prologue':'Chapter 1 — The beginning'} as never;});
 const mutate=vi.fn(async()=>true),listen=vi.fn();render(<BookSpokenHeadings book={book} chapters={chapters} disabled={false} mutate={mutate} listen={listen}/>);
 fireEvent.click(screen.getByRole('button',{name:'Read spoken headings'}));await screen.findByDisplayValue('Chapter 1 — The beginning');
 expect(mutate).not.toHaveBeenCalled();expect(accountRequest).toHaveBeenCalledTimes(2);
 expect(accountRequest).toHaveBeenCalledWith('audiobooks/book/spoken-heading','csrf',{chapterId:'first'},expect.any(AbortSignal));
 fireEvent.click(screen.getAllByRole('button',{name:'Listen to opening'})[1]!);expect(listen).toHaveBeenCalledWith('part',100);
 fireEvent.change(screen.getByDisplayValue('Prologue'),{target:{value:'Introduction'}});
 fireEvent.click(screen.getByRole('button',{name:'Save selected names'}));
 await waitFor(()=>expect(mutate).toHaveBeenCalledWith('chapter-titles',{titles:[{chapterId:'intro',previousTitle:'001',title:'Introduction'},{chapterId:'first',previousTitle:'002',title:'Chapter 1 — The beginning'}]}));
 await waitFor(()=>expect(screen.queryByRole('heading',{name:'Review spoken headings'})).not.toBeInTheDocument());
});
it('leaves unclear speech and previously edited names unselected',async()=>{
 vi.mocked(accountRequest).mockImplementation(async(_path,_csrf,input)=>{const id=(input as {chapterId:string}).chapterId;return {chapterId:id,position:0,transcript:'Words from the story.',suggestedTitle:id==='intro'?null:'Chapter 1'} as never;});
 render(<BookSpokenHeadings book={book} chapters={[chapters[0]!,{...chapters[1]!,titleSource:'manual'}]} disabled={false} mutate={vi.fn()} listen={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'Read spoken headings'}));await screen.findByDisplayValue('Chapter 1');
 expect(screen.getByText(/No clear spoken heading found/)).toBeVisible();for(const checkbox of screen.getAllByRole('checkbox'))expect(checkbox).not.toBeChecked();expect(screen.getByRole('button',{name:'Save selected names'})).toBeDisabled();
});
it('cancels reading on request and when leaving, without starting remaining sections',async()=>{
 vi.mocked(accountRequest).mockImplementation((_path,_csrf,_input,signal)=>new Promise((_resolve,reject)=>signal!.addEventListener('abort',()=>reject(new Error('Cancelled')))));
 const view=render(<BookSpokenHeadings book={book} chapters={chapters} disabled={false} mutate={vi.fn()} listen={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'Read spoken headings'}));expect(screen.getByRole('status')).toHaveTextContent('Reading opening 1 of 2');
 const signal=vi.mocked(accountRequest).mock.calls[0]![3]!;fireEvent.click(screen.getByRole('button',{name:'Cancel reading'}));await waitFor(()=>expect(screen.queryByRole('status')).not.toBeInTheDocument());expect(signal.aborted).toBe(true);expect(accountRequest).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button',{name:'Read spoken headings'}));const next=vi.mocked(accountRequest).mock.calls[1]![3]!;await act(async()=>view.unmount());expect(next.aborted).toBe(true);expect(accountRequest).toHaveBeenCalledTimes(2);
});
it('disables reading offline and preserves previews after a save conflict',async()=>{
 vi.mocked(accountRequest).mockResolvedValue({chapterId:'intro',position:0,transcript:'Prologue.',suggestedTitle:'Prologue'} as never);
 const props={book,chapters:[chapters[0]!],mutate:vi.fn(async()=>false),listen:vi.fn()};const view=render(<BookSpokenHeadings {...props} disabled/>);
 expect(screen.getByRole('button',{name:'Read spoken headings'})).toBeDisabled();expect(accountRequest).not.toHaveBeenCalled();view.rerender(<BookSpokenHeadings {...props} disabled={false}/>);
 fireEvent.click(screen.getByRole('button',{name:'Read spoken headings'}));await screen.findByDisplayValue('Prologue');fireEvent.click(screen.getByRole('button',{name:'Save selected names'}));await waitFor(()=>expect(props.mutate).toHaveBeenCalled());expect(screen.getByDisplayValue('Prologue')).toBeVisible();
});
