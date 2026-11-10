import {expect,it,vi} from 'vitest';
import {LrclibLyrics,parseLrc} from './lyrics.js';
import type {Track} from '@freeqify/shared';
const track:Track={id:'song',title:'Test song',artist:'Test artist',album:'Test album',duration:120,albumId:null,artworkId:null,format:'mp3',trackNumber:1};
const entry={id:42,trackName:'Test Song',artistName:'Test Artist',duration:120,instrumental:false,plainLyrics:'Fixture opening\nFixture ending',syncedLyrics:'[00:05.00]Fixture opening\n[00:20.500]Fixture ending\n[01:00.00]'};
const signal=()=>new AbortController().signal;
it('parses repeated timestamps, metadata, offsets, fractions and blank instrumental gaps',()=>{
 expect(parseLrc('[ar:Fixture]\n[offset:-500]\n[0:01.2][00:03.250]One\n[0:06]Two\n[00:08.000]',20)).toEqual([{time:.7,text:'One'},{time:2.75,text:'One'},{time:5.5,text:'Two'},{time:7.5,text:''}]);
 expect(parseLrc('[00:01]First\n[00:01]Second',10)).toEqual([{time:1,text:'First\nSecond'}]);
});
it.each(['[00:99]bad','[300:00]bad','Untimed\n[00:05]Mixed','x'.repeat(65537),Array.from({length:601},()=> '[00:01]line').join('\n')])('rejects malformed and oversized timing rather than guessing',text=>{expect(parseLrc(text,120)).toEqual([]);});
it('uses a fixed HTTPS host, identifies Freeqify and caches a validated match',async()=>{
 const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json(entry));const provider=new LrclibLyrics(fetcher);
 const result=await provider.lookup(track,signal());expect(result).toMatchObject({status:'synced',provider:'LRCLIB',recordId:42,lines:[{time:5,text:'Fixture opening'},{time:20.5,text:'Fixture ending'},{time:60,text:''}]});
 const [url,options]=fetcher.mock.calls[0]!;expect(new URL(String(url)).origin).toBe('https://lrclib.net');expect(String(url)).toContain('duration=120');expect(options).toMatchObject({redirect:'error',headers:{'User-Agent':expect.stringContaining('Freeqify/')}});
 expect(await provider.lookup(track,signal())).toEqual(result);expect(fetcher).toHaveBeenCalledOnce();
});
it.each([{trackName:'Different song'},{artistName:'Someone else'},{duration:125}])('rejects wrong recording metadata: %j',async mismatch=>{
 const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({...entry,...mismatch}));expect(await new LrclibLyrics(fetcher).lookup(track,signal())).toEqual({status:'missing'});
});
it('tries a compilation without album only after a miss and still verifies identity',async()=>{
 let now=0;const fetcher=vi.fn<typeof fetch>().mockImplementation(async()=>{now+=600;return fetcher.mock.calls.length===1?new Response('',{status:404}):Response.json(entry);});
 expect((await new LrclibLyrics(fetcher,()=>now).lookup(track,signal())).status).toBe('synced');expect(fetcher).toHaveBeenCalledTimes(2);expect(new URL(String(fetcher.mock.calls[1]![0])).searchParams.has('album_name')).toBe(false);
});
it('distinguishes plain lyrics, instrumental tracks and missing content',async()=>{
 for(const [changes,status] of [[{syncedLyrics:null},'plain'],[{instrumental:true},'instrumental'],[{syncedLyrics:null,plainLyrics:null},'missing']] as const){expect((await new LrclibLyrics(vi.fn<typeof fetch>().mockResolvedValue(Response.json({...entry,...changes}))).lookup(track,signal())).status).toBe(status);}
});
it('honors Retry-After with a shared cooldown and never caches a transient failure',async()=>{
 let now=0;const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('limited',{status:429,headers:{'Retry-After':'60'}})).mockImplementation(async()=>Response.json(entry));const provider=new LrclibLyrics(fetcher,()=>now);
 expect((await provider.lookup(track,signal())).status).toBe('unavailable');now=60000;expect((await provider.lookup(track,signal())).status).toBe('unavailable');expect(fetcher).toHaveBeenCalledOnce();now=80000;expect((await provider.lookup(track,signal())).status).toBe('synced');
});
it('rejects oversized bodies, redirects and errors without exposing provider output',async()=>{
 for(const response of [new Response('private provider error',{status:500}),new Response('redirect',{status:302,headers:{location:'http://127.0.0.1/'}}),new Response('x'.repeat(262145)),new Response('{}',{headers:{'content-length':'999999'}})]){expect(await new LrclibLyrics(vi.fn<typeof fetch>().mockResolvedValue(response)).lookup(track,signal())).toEqual({status:'unavailable'});}
});
it('bounds concurrency, cancels upstream work, and leaves playback independent',async()=>{
 let finish!:(r:Response)=>void;const fetcher=vi.fn<typeof fetch>(()=>new Promise(resolve=>{finish=resolve;}));const provider=new LrclibLyrics(fetcher);const c=new AbortController();const first=provider.lookup(track,c.signal);await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledOnce());expect(await provider.lookup({...track,id:'other'},signal())).toEqual({status:'unavailable'});c.abort();expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true);finish(Response.json(entry));expect(await first).toEqual({status:'unavailable'});
});
it('never queries for unknown metadata or book-length audio',async()=>{const fetcher=vi.fn<typeof fetch>();const provider=new LrclibLyrics(fetcher);for(const change of [{artist:'Unknown artist'},{duration:null},{duration:10000}])expect(await provider.lookup({...track,...change},signal())).toEqual({status:'missing'});expect(fetcher).not.toHaveBeenCalled();});
