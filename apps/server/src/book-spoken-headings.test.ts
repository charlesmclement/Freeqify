import {expect,it} from 'vitest';
import {readSpokenHeading,spokenHeading} from './book-spoken-headings.js';
import {runBookTool} from './book-audio-reader.js';
import {readConfig} from './config.js';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {MusicLibrary} from './integrations/navidrome.js';
const segment=(text:string,start=0)=>({text,start,end:start+5,avg_logprob:-0.2,no_speech_prob:0.02,compression_ratio:1.4});
it('uses spoken section numbers without counting the prologue as chapter one',()=>{
 expect(spokenHeading([segment('Prologue. A beginning.')]).suggestedTitle).toBe('Prologue — A beginning');
 expect(spokenHeading([segment('Chapter 1. First chapter.')]).suggestedTitle).toBe('Chapter 1 — First chapter');
 expect(spokenHeading([segment('Chapter 2, Second chapter.')]).suggestedTitle).toBe('Chapter 2 — Second chapter');
 expect(spokenHeading([segment('Chapter twenty-one. The journey continues.')]).suggestedTitle).toBe('Chapter twenty-one — The journey continues');
});
it('recognizes an introduction after opening credits and keeps the words available for review',()=>{
 const result=spokenHeading([segment('Publisher presents.'),segment('Introduction. Bumper sticker shock. More narration follows.',30)]);
 expect(result.suggestedTitle).toBe('Introduction — Bumper sticker shock');expect(result.transcript).toContain('Publisher presents.');
});
it('does not invent headings from ordinary narration, uncertain speech, silence or long passages',()=>{
 expect(spokenHeading([segment('We met in chapter one. It was summer.')]).suggestedTitle).toBeNull();
 expect(spokenHeading([{...segment('Chapter one.'),avg_logprob:-1}])).toEqual({transcript:'',suggestedTitle:null});
 expect(spokenHeading([{...segment('Chapter one.'),no_speech_prob:0.9}]).suggestedTitle).toBeNull();
 expect(spokenHeading([])).toEqual({transcript:'',suggestedTitle:null});
 expect(spokenHeading([segment('Chapter 4. '+('words '.repeat(25))+'.')]).suggestedTitle).toBe('Chapter 4');
 expect(spokenHeading([segment('Chapter 4. Unfinished sentence')]).suggestedTitle).toBe('Chapter 4');
 expect(spokenHeading([segment('Chapter\n4. A\u0000 story.')]).suggestedTitle).toBe('Chapter 4 — A story');
});
it('bounds recognizer output and cancels native processes',async()=>{
 await expect(runBookTool(process.execPath,['-e','process.stdout.write("x".repeat(10000))'],new AbortController().signal,100)).rejects.toThrow('incomplete');
 const abort=new AbortController();const result=runBookTool(process.execPath,['-e','setInterval(()=>{},1000)'],abort.signal,100);abort.abort();await expect(result).rejects.toThrow('incomplete');
 const secret='FREEQIFY_TEST_BOOK_SECRET';process.env[secret]='private';
 try{expect((await runBookTool(process.execPath,['-e',`process.stdout.write(String(process.env.${secret}))`],new AbortController().signal,100)).toString()).toBe('undefined');}finally{delete process.env[secret];}
});
it('keeps local recognition optional and resolves only server-configured tool and model paths',()=>{
 expect(readConfig({}).audiobookSpeech).toBeUndefined();expect(()=>readConfig({AUDIOBOOKS_SPEECH_PYTHON:'python3'})).toThrow('both');
 expect(readConfig({AUDIOBOOKS_SPEECH_PYTHON:'tools/python',AUDIOBOOKS_SPEECH_MODEL:'models/small.en.pt',AUDIOBOOKS_FFMPEG_PATH:'tools/ffmpeg'},'/app').audiobookSpeech).toEqual({python:'/app/tools/python',model:'/app/models/small.en.pt',ffmpeg:'/app/tools/ffmpeg'});
});
it('reports an empty decoder result as a failed read instead of claiming there was no spoken heading',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'freeqify-speech-test-')),executable=join(directory,'empty-decoder');
 try{
  await writeFile(executable,'#!/usr/bin/env node\nprocess.exit(0);\n',{mode:0o700});
  await expect(readSpokenHeading({} as MusicLibrary,{id:'part',title:'Book',artist:'Author',album:'Book',albumId:'album',artworkId:null,duration:60,format:'m4b',trackNumber:1},'chapter',0,45,{ffmpeg:executable,python:'/missing-speech-reader',model:'/missing-model'},new AbortController().signal)).rejects.toMatchObject({code:'BOOK_SPEECH_UNAVAILABLE'});
 }finally{await rm(directory,{recursive:true,force:true});}
});
