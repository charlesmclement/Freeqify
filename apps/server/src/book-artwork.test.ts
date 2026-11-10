import {expect,it,vi} from 'vitest';
import {OnlineBookArtwork} from './book-artwork.js';
const jpeg=Buffer.from([255,216,255,0,8,9,10,11]);
const book={title:'A Book',author_name:['An Author'],cover_i:123,first_publish_year:2001};
function fixture(docs:unknown[]=[book],image:()=>Response=()=>new Response(jpeg,{headers:{'content-type':'image/jpeg'}})){
 const fetcher=vi.fn(async(url:string|URL,options?:RequestInit)=>{expect(options?.redirect).toBe('manual');return String(url).startsWith('https://openlibrary.org/search.json?')?Response.json({docs}):image();});
 return {fetcher,provider:new OnlineBookArtwork({contact:'test@example.invalid',fetcher:fetcher as typeof fetch,acquire:async()=>{}})};
}
it('matches author and title, coalesces lookups and caches verified covers',async()=>{
 const {provider,fetcher}=fixture();const results=await Promise.all([provider.lookup('An Author','A Book'),provider.lookup('An Author','A Book')]);
 expect(results[0]).toEqual({kind:'found',artwork:{bytes:jpeg,contentType:'image/jpeg'}});expect(results[1]).toEqual(results[0]);await provider.lookup('An Author','A Book');expect(fetcher).toHaveBeenCalledTimes(2);
 expect(String(fetcher.mock.calls[1]![0])).toBe('https://covers.openlibrary.org/b/id/123-L.jpg?default=false');
 const url=new URL(String(fetcher.mock.calls[0]![0]));expect(url.searchParams.get('author')).toBe('An Author');expect(url.searchParams.get('title')).toBe('A Book');
});
it('rejects wrong titles and authors rather than guessing',async()=>{
 for(const docs of [[{...book,title:'A Different Book'}],[{...book,author_name:['Someone else']}]]){const f=fixture(docs);expect(await f.provider.lookup('An Author','A Book')).toEqual({kind:'missing'});expect(f.fetcher).toHaveBeenCalledTimes(1);}
});
it('supports a metadata subtitle and ignores unusable cover identifiers',async()=>{
 const f=fixture([{...book,cover_i:'https://elsewhere.invalid'},book]);expect((await f.provider.lookup('An Author','A Book: A Subtitle')).kind).toBe('found');
 expect(await f.provider.candidateCover('../123')).toEqual({kind:'missing'});expect(f.fetcher).toHaveBeenCalledTimes(2);
});
it('refuses redirects, oversized images and mismatched image bytes',async()=>{
 for(const response of [()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}}),()=>new Response(jpeg,{headers:{'content-type':'image/jpeg','content-length':String(4*1024*1024)}}),()=>new Response('not a picture',{headers:{'content-type':'image/jpeg'}})]){const f=fixture([book],response);expect(await f.provider.candidateCover('123')).toEqual({kind:'unavailable'});expect(f.fetcher).toHaveBeenCalledTimes(1);}
});
it('distinguishes missing images from temporary provider failures and retries failures',async()=>{
 expect(await fixture([book],()=>new Response(null,{status:404})).provider.candidateCover('123')).toEqual({kind:'missing'});
 const f=fixture([book],()=>new Response(null,{status:503}));await f.provider.lookup('An Author','A Book');await f.provider.lookup('An Author','A Book');expect(f.fetcher).toHaveBeenCalledTimes(4);
});
it('bounds metadata and does not accept non-JSON responses',async()=>{
 for(const response of [()=>new Response('x'.repeat(256*1024+1),{headers:{'content-type':'application/json'}}),()=>new Response('{}',{headers:{'content-type':'text/html'}})]){const provider=new OnlineBookArtwork({contact:'test@example.invalid',fetcher:vi.fn(async()=>response()),acquire:async()=>{}});expect(await provider.search('An Author','A Book')).toEqual({kind:'unavailable'});}
});

it('uses the first matching edition when multiple covers belong to the same author and title',async()=>{
 const f=fixture([book,{...book,cover_i:456}]);expect((await f.provider.lookup('An Author','A Book')).kind).toBe('found');expect(String(f.fetcher.mock.calls[1]![0])).toContain('/123-L.jpg');
});

it('follows only HTTPS cover-provider redirects, with bounded hops',async()=>{
 const fetcher=vi.fn(async(url:string|URL)=>String(url).startsWith('https://covers.openlibrary.org/')?new Response(null,{status:302,headers:{location:'https://archive.org/download/cover.jpg'}}):new Response(jpeg,{headers:{'content-type':'image/jpeg'}}));
 const p=new OnlineBookArtwork({contact:'test@example.invalid',fetcher:fetcher as typeof fetch,acquire:async()=>{}});expect((await p.candidateCover('123')).kind).toBe('found');expect(fetcher).toHaveBeenCalledTimes(2);
 for(const location of ['https://archive.org.evil.invalid/image','https://user@archive.org/image','http://archive.org/image','https://archive.org:8000/image','https://archive.org/loop']){
  const redirect=vi.fn(async()=>new Response(null,{status:302,headers:{location}}));const provider=new OnlineBookArtwork({contact:'test@example.invalid',fetcher:redirect,acquire:async()=>{}});expect(await provider.candidateCover('123')).toEqual({kind:'unavailable'});expect(redirect.mock.calls.length).toBeLessThanOrEqual(4);
 }
});
