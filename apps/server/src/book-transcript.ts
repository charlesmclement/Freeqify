import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import type {BookTranscript,Track} from '@freeqify/shared';
import type {MusicLibrary} from './integrations/navidrome.js';
import type {SpeechReader} from './book-spoken-headings.js';
import type {AuthStore} from './auth/store.js';
import {runBookTool,withBookAudio} from './book-audio-reader.js';
import {AuthError} from './auth/password.js';

export const transcriptWindow=30;
export function transcriptLines(value:unknown,start:number,seconds:number):BookTranscript['lines']{
 if(!Array.isArray(value)||value.length>100)throw new Error('Invalid transcript');
 const lines:BookTranscript['lines']=[];let end=0;
 for(const item of value){
  if(!item||typeof item!=='object')throw new Error('Invalid segment');
  const s=item as Record<string,unknown>;
  if(typeof s.text!=='string'||s.text.length>4000||!['start','end','avg_logprob','no_speech_prob','compression_ratio'].every(k=>typeof s[k]==='number'&&Number.isFinite(s[k])))throw new Error('Invalid segment');
  const begin=Number(s.start),finish=Number(s.end);
  if(begin<end-.1||finish<begin||begin<0||begin>=seconds||finish>seconds+2)throw new Error('Invalid timing');
  // Whisper may overlap adjacent boundaries by floating-point noise or end
  // its final segment in decoder padding. Keep starts inside the real passage.
  end=Math.min(finish,seconds);
  if(Number(s.avg_logprob)<-.8||Number(s.no_speech_prob)>=.5||Number(s.compression_ratio)>=2.4)continue;
  const text=s.text.replace(/[\p{Cc}\p{Cf}]/gu,' ').replace(/\s+/g,' ').trim();
  if(text)lines.push({time:start+begin,text});
 }
 return lines;
}
export async function transcribeBookPassage(library:MusicLibrary,part:Track,start:number,seconds:number,reader:SpeechReader,signal:AbortSignal){
 const cancel=AbortSignal.any([signal,AbortSignal.timeout(90000)]);
 try{
  const pcm=await withBookAudio(library,cancel,async(source,abort)=>runBookTool(reader.ffmpeg,['-nostdin','-v','error','-max_alloc','67108864','-threads','1','-protocol_whitelist','http,tcp','-format_whitelist','mov,mp3,flac,ogg,matroska,webm,wav,aac','-ss',String(start),'-i',source(part),'-t',String(seconds),'-vn','-sn','-dn','-ac','1','-ar','16000','-c:a','pcm_s16le','-f','s16le','pipe:1'],abort,transcriptWindow*16000*2));
  if(pcm.length<3200)throw new Error('No audio');
  const output=await runBookTool(reader.python,['-I',fileURLToPath(new URL('../../../scripts/read-book-heading.py',import.meta.url)),reader.model],cancel,64*1024,pcm);
  const lines=transcriptLines(JSON.parse(output.toString('utf8')),start,seconds);cancel.throwIfAborted();return lines;
 }catch{throw new AuthError(503,'BOOK_TRANSCRIPT_UNAVAILABLE','This passage could not be transcribed. Try again; audiobook playback is unchanged.');}
}
export const transcriptKey=(part:Track,model:string)=>createHash('sha256').update(JSON.stringify([part,model])).digest('hex');
export function cachedTranscript(auth:AuthStore,user:string,book:string,part:string,key:string,start:number):BookTranscript['lines']|undefined{
 const row=auth.db.prepare('SELECT payload FROM book_transcripts WHERE user_id=? AND book_id=? AND part_id=? AND source_key=? AND start=?').get(user,book,part,key,start);
 return row?JSON.parse(String(row.payload)) as BookTranscript['lines']:undefined;
}
export function saveTranscript(auth:AuthStore,user:string,book:string,part:string,key:string,start:number,lines:BookTranscript['lines']){
 const db=auth.db;db.exec('BEGIN IMMEDIATE');
 try{
  const before=auth.storageUsage(user);
  // This is a bounded derived-text cache, never an audio copy or source mutation.
  db.prepare('DELETE FROM book_transcripts WHERE user_id=? AND rowid IN (SELECT rowid FROM book_transcripts WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT -1 OFFSET 4095)').run(user,user);
  db.prepare('INSERT INTO book_transcripts(user_id,book_id,part_id,source_key,start,payload,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,book_id,part_id,source_key,start) DO UPDATE SET payload=excluded.payload,created_at=excluded.created_at').run(user,book,part,key,start,JSON.stringify(lines),Date.now());
  auth.checkStorage(user,before);db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
}
