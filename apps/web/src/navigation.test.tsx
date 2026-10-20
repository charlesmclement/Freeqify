// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {useNavigationState,useHistoryOverlay,isBoolean,isString,navigateParameter} from './navigation.js';
function Fixture(){const [view,setView]=useNavigationState('view','Home',isString);const [open,setOpen]=useNavigationState('panel',false,isBoolean);return <><span>{view}</span><span>{open?'Opened':'Closed'}</span><button onClick={()=>setView('Albums')}>Albums</button><button onClick={()=>setOpen(true)}>Open</button><button onClick={()=>setOpen(false)}>Close</button></>;}
beforeEach(()=>window.history.replaceState(null,'','/'));
afterEach(cleanup);
it('records screens and panels, and uses Back and Forward for closing and reopening',async()=>{
 render(<Fixture/>);fireEvent.click(screen.getByText('Albums',{selector:'button'}));await screen.findByText('Albums',{selector:'span'});
 fireEvent.click(screen.getByText('Open'));await screen.findByText('Opened');
 fireEvent.click(screen.getByText('Close'));await screen.findByText('Closed');
 act(()=>window.history.forward());await screen.findByText('Opened');
 act(()=>window.history.back());await screen.findByText('Closed');
 act(()=>window.history.back());await screen.findByText('Home');
});
it('restores valid deep links and ignores malformed values',()=>{
 window.history.replaceState(null,'','/#/view=%22Search%22&panel=wrong');render(<Fixture/>);expect(screen.getByText('Search')).toBeTruthy();expect(screen.getByText('Closed')).toBeTruthy();
});
it('groups related changes and does not add duplicate entries',async()=>{
 const push=vi.spyOn(history,'pushState');
 await act(async()=>{navigateParameter('view','Albums','Home');navigateParameter('panel',true,false);});
 expect(push).toHaveBeenCalledTimes(1);
 const href=location.href;
 await act(async()=>{navigateParameter('panel',true,false);});expect(location.href).toBe(href);expect(push).toHaveBeenCalledTimes(1);
 await act(async()=>{navigateParameter('panel',false,false);navigateParameter('view','Home','Home');});
 await waitFor(()=>expect(location.hash).toBe(''));push.mockRestore();
});
it('does not insert a root sentinel or trap platform exit',()=>{
 const push=vi.spyOn(history,'pushState');render(<Fixture/>);expect(push).not.toHaveBeenCalled();expect(location.hash).toBe('');push.mockRestore();
});
it('handles reopening while a close traversal is still pending',async()=>{
 render(<Fixture/>);fireEvent.click(screen.getByText('Open'));await waitFor(()=>expect(location.hash).toContain('panel'));
 fireEvent.click(screen.getByText('Close'));
 await act(async()=>{await Promise.resolve();fireEvent.click(screen.getByText('Open'));});
 await screen.findByText('Opened');await waitFor(()=>expect(location.hash).toContain('panel'));
 act(()=>history.back());await screen.findByText('Closed');await waitFor(()=>expect(location.hash).toBe(''));
});
it('dismisses a directly opened panel in place without inventing a parent',async()=>{
 history.replaceState(null,'','/#/panel=true');render(<Fixture/>);
 const push=vi.spyOn(history,'pushState');fireEvent.click(screen.getByText('Close'));
 await waitFor(()=>expect(location.hash).toBe(''));expect(push).not.toHaveBeenCalled();push.mockRestore();
});

it('keeps dialog payloads out of URLs, restores Forward and clears them on logout',async()=>{
 function Overlay(){const [value,set]=useHistoryOverlay<{title:string}>('private');return <><button onClick={()=>set({title:'Private payload'})}>Choose</button>{value&&<p>{value.title}</p>}</>;}
 render(<Overlay/>);fireEvent.click(screen.getByText('Choose'));await screen.findByText('Private payload');
 await waitFor(()=>expect(location.hash).toContain('private'));expect(location.href).not.toContain('payload');
 act(()=>history.back());await waitFor(()=>expect(screen.queryByText('Private payload')).toBeNull());
 act(()=>history.forward());await screen.findByText('Private payload');
 act(()=>window.dispatchEvent(new Event('freeqify:logout')));expect(screen.queryByText('Private payload')).toBeNull();
});
