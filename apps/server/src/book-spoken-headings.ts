import {fileURLToPath} from 'node:url';
import type {BookSpokenHeading,Track} from '@freeqify/shared';
import type {MusicLibrary} from './integrations/navidrome.js';
import {runBookTool,withBookAudio} from './book-audio-reader.js';
import {AuthError} from './auth/password.js';
export interface SpeechReader {python:string;model:string;ffmpeg:string}
interface Segment {start:number;end:number;text:string;avg_logprob:number;no_speech_prob:number;compression_ratio:number}
const clean=(text:string)=>text.replace(/[\p{Cc}\p{Cf}]/gu,' ').replace(/\s+/g,' ').trim();
/** An explicit spoken heading is evidence. Section indexes and ordinary prose
 * never supply a chapter number. Suggestions always remain editable previews. */
export function spokenHeading(value:unknown):Pick<BookSpokenHeading,'transcript'|'suggestedTitle'>{
 if(!Array.isArray(value)||value.length>100)throw new Error('Invalid recognition result');
 const segments:Segment[]=value.filter((s):s is Segment=>!!s&&typeof s==='object'&&typeof s.text==='string'&&s.text.length<=4000&&
  [s.start,s.end,s.avg_logprob,s.no_speech_prob,s.compression_ratio].every(n=>typeof n==='number'&&Number.isFinite(n))&&s.start>=0&&s.start<=45&&s.end>=s.start&&s.end<=50&&s.avg_logprob>=-0.8&&s.no_speech_prob<0.5&&s.compression_ratio<2.4);
 const transcript=clean(segments.map(s=>s.text).join(' ')).slice(0,600);
 const number='(?:\\d{1,3}|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)(?:[ -](?:and[ -])?(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)){0,4})';
 const heading=new RegExp(`^(chapter ${number}|prologue|introduction|preface|foreword|epilogue|afterword|acknowledg(?:e)?ments|conclusion)(?=$|[.!?:,])`,'i');
 let suggestedTitle:string|null=null;
 for(const segment of segments){
  const text=clean(segment.text),match=text.match(heading);if(!match)continue;
  const label=match[1]!,rest=text.slice(label.length).replace(/^[.!?:,]\s*/,'');
  // Keep only the next short sentence in the same recognized segment. Longer
  // passages or absent punctuation are ambiguous, so retain just the heading.
  const subtitle=rest.match(/^([^.!?]{1,120})[.!?]/)?.[1]?.trim();
  const title=subtitle&&subtitle.split(' ').length<=16?`${label} — ${subtitle}`:label;
  suggestedTitle=title.charAt(0).toUpperCase()+title.slice(1);break;
 }
 return {transcript,suggestedTitle};
}
export async function readSpokenHeading(library:MusicLibrary,part:Track,chapterId:string,position:number,seconds:number,reader:SpeechReader,signal:AbortSignal):Promise<BookSpokenHeading>{
 const controller=new AbortController(),abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 const deadline=setTimeout(abort,90000);
 try{
  const pcm=await withBookAudio(library,controller.signal,async(source,cancel)=>runBookTool(reader.ffmpeg,['-nostdin','-v','error','-max_alloc','67108864','-threads','1','-protocol_whitelist','http,tcp','-format_whitelist','mov,mp3,flac,ogg,matroska,webm,wav,aac','-ss',String(position),'-i',source(part),'-t',String(Math.max(0.1,Math.min(45,seconds))),'-vn','-sn','-dn','-ac','1','-ar','16000','-c:a','pcm_s16le','-f','s16le','pipe:1'],cancel,45*16000*2));
  if(pcm.length<3200)throw new Error('No readable audio');
  const output=await runBookTool(reader.python,['-I',fileURLToPath(new URL('../../../scripts/read-book-heading.py',import.meta.url)),reader.model],controller.signal,64*1024,pcm);
  const result=spokenHeading(JSON.parse(output.toString('utf8')));
  controller.signal.throwIfAborted();return {chapterId,position,...result};
 }catch{throw new AuthError(503,'BOOK_SPEECH_UNAVAILABLE','The spoken heading could not be read. Try again; existing chapter names are unchanged.');}
 finally{clearTimeout(deadline);signal.removeEventListener('abort',abort);abort();}
}
