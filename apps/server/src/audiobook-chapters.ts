import type {Track} from '@freeqify/shared';
import type {MusicLibrary} from './integrations/navidrome.js';
import {withBookAudio,runBookTool} from './book-audio-reader.js';
export interface DetectedChapter {partId:string;position:number;title:string}
export interface ChapterDetection {chapters:DetectedChapter[];message:string;complete:boolean}
/** Read the embedded table; numeric entries are section indexes, not evidence of spoken chapter numbers. */
export async function detectBookChapters(library:MusicLibrary,parts:Track[],executable:string,signal:AbortSignal):Promise<ChapterDetection>{
 const chapters:DetectedChapter[]=[];let checked=0;
 try{await withBookAudio(library,signal,async(source,cancel)=>{
  for(const part of parts){
   cancel.throwIfAborted();
   const output=(await runBookTool(executable,['-v','error','-max_alloc','16777216','-protocol_whitelist','http,tcp','-format_whitelist','mov,mp3,flac,ogg,matroska,webm,wav,aac','-probesize','1048576','-analyzeduration','0','-show_chapters','-of','json',source(part)],cancel,1024*1024)).toString('utf8');
   const data=JSON.parse(output) as {chapters?:{start_time?:string;tags?:{title?:string}}[]};
   if(!Array.isArray(data.chapters)||data.chapters.length>6000)throw new Error();
   for(const [index,c]of data.chapters.entries()){
    const position=Number(c.start_time);if(!Number.isFinite(position)||position<0||position>604800||(part.duration!==null&&position>part.duration+1))continue;
    const raw=typeof c.tags?.title==='string'?c.tags.title:'';
    const title=Array.from(raw).filter(c=>c.charCodeAt(0)>=32&&c.charCodeAt(0)!==127).join('').trim().slice(0,200)||`Section ${index+1}`;
    if(chapters.length>=6000)throw new Error();chapters.push({partId:part.id,position:Math.min(position,part.duration??position),title});
   }
   checked++;
  }
 });}catch{/* Import remains usable without a readable embedded table. */}
 const complete=checked===parts.length;
 return {chapters,complete,message:complete?(chapters.length?`Found ${chapters.length} embedded sections. Their names come from file tags; read spoken headings to check them.`:'No embedded chapters found. File boundaries and your manual markers are available.'):`Chapter scan incomplete (${checked} of ${parts.length} files checked). Check the server chapter reader or retry. Manual markers remain available.`};
}
