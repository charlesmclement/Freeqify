import {expect,it} from 'vitest';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import type {MusicLibrary} from './integrations/navidrome.js';
import {detectBookChapters} from './audiobook-chapters.js';
const haveTools=spawnSync('ffmpeg',['-version']).status===0&&spawnSync('ffprobe',['-version']).status===0;
it.skipIf(!haveTools).each(['m4b','mp3'])('reads real embedded %s chapters through bounded original-media ranges',async format=>{
 const directory=await mkdtemp(join(tmpdir(),'freeqify-chapters-'));
 try{
  const metadata=join(directory,'chapters.txt'),file=join(directory,`book.${format}`);await writeFile(metadata,';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1000\ntitle=Opening\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=1000\nEND=3000\ntitle=Second chapter\n');
  expect(spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','anullsrc=r=8000:cl=mono','-i',metadata,'-t','3','-map_metadata','1','-map_chapters','1','-c:a',format==='m4b'?'aac':'libmp3lame',file]).status).toBe(0);
  const bytes=await readFile(file),ranges:string[]=[];
  const library={stream:async(_id:string,encoding:string,range:string)=>{expect(encoding).toBe('raw');ranges.push(range);const match=range?.match(/^bytes=(\d+)-(\d*)$/),start=Number(match?.[1]??0),end=match?.[2]?Number(match[2]):bytes.length-1;return new Response(bytes.subarray(start,end+1),{status:match?206:200,headers:{'content-type':format==='m4b'?'audio/mp4':'audio/mpeg','content-length':String(end-start+1),...(match?{'content-range':`bytes ${start}-${end}/${bytes.length}`}:{})}});}}as unknown as MusicLibrary;
  const result=await detectBookChapters(library,[{id:'part',title:'Book',artist:'Author',album:'Book',albumId:'album',artworkId:null,duration:3,format,trackNumber:1}],'ffprobe',new AbortController().signal);
  expect(result.complete).toBe(true);expect(result.chapters).toEqual([{partId:'part',position:0,title:'Opening'},{partId:'part',position:1,title:'Second chapter'}]);expect(ranges.length).toBeGreaterThan(0);
 }finally{await rm(directory,{recursive:true,force:true});}
});
it('reports unavailable chapter tooling without losing the book or throwing process errors',async()=>{
 const result=await detectBookChapters({} as MusicLibrary,[{id:'part',title:'Book',artist:'Author',album:'Book',albumId:'album',artworkId:null,duration:3,format:'mp3',trackNumber:1}],'/missing-freeqify-ffprobe',new AbortController().signal);expect(result.complete).toBe(false);expect(result.chapters).toEqual([]);expect(result.message).toContain('incomplete');
});
