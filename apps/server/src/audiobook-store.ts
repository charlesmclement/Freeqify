import type {ChapterDetection} from './audiobook-chapters.js';
import {randomUUID} from 'node:crypto';
import type {AlbumDetail,Audiobook,BookSummary} from '@freeqify/shared';
import type {AuthStore} from './auth/store.js';
import {AuthError} from './auth/password.js';
const invalid=(message='Invalid audiobook request.')=>new AuthError(400,'INVALID_INPUT',message);
function text(value:unknown,max:number,required=false){
 if(typeof value!=='string'||value.length>max||Array.from(value).some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127)||(required&&!value.trim()))throw invalid();
 return value.trim();
}
export function bookSummary(book:Audiobook):BookSummary {
 const {parts,chapters,bookmarks,...summary}=book;void parts;void chapters;void bookmarks;return summary;
}
export class AudiobookStore {
 constructor(private auth:AuthStore){}
 private active(user:string){if(!this.auth.db.prepare("SELECT id FROM users WHERE id=? AND status='active'").get(user))throw new AuthError(401,'UNAUTHENTICATED','Sign in to continue.');}
 get(user:string,id:string):Audiobook {
  this.active(user);const row=this.auth.db.prepare('SELECT payload FROM audiobooks WHERE user_id=? AND id=?').get(user,id);
  if(!row)throw new AuthError(404,'NOT_FOUND','Book not found.');return JSON.parse(String(row.payload)) as Audiobook;
 }
 list(user:string,offset:number,status='all'){
  this.active(user);const rows=this.auth.db.prepare("SELECT json_remove(payload,'$.parts','$.chapters','$.bookmarks') AS payload FROM audiobooks WHERE user_id=? AND (?='all' OR json_extract(payload,'$.status')=?) ORDER BY updated_at DESC,id LIMIT 49 OFFSET ?").all(user,status,status,offset);
  return {items:rows.slice(0,48).map(r=>bookSummary(JSON.parse(String(r.payload)))),nextOffset:rows.length>48?offset+48:null};
 }
 summariesForAlbums(user:string,ids:string[]):Map<string,BookSummary>{
  this.active(user);
  const read=this.auth.db.prepare("SELECT json_remove(payload,'$.parts','$.chapters','$.bookmarks') AS payload FROM audiobooks WHERE user_id=? AND album_id=?");
  const result=new Map<string,BookSummary>();
  for(const id of ids){const row=read.get(user,id);if(row)result.set(id,JSON.parse(String(row.payload)) as BookSummary);}
  return result;
 }
 private transaction<T>(user:string,work:()=>T):T{
  const db=this.auth.db;db.exec('BEGIN IMMEDIATE');
  try{this.active(user);const before=this.auth.storageUsage(user),result=work();this.auth.checkStorage(user,before);db.exec('COMMIT');return result;}
  catch(error){db.exec('ROLLBACK');throw error;}
 }
 private save(user:string,book:Audiobook){
  book.updatedAt=Date.now();const payload=JSON.stringify(book);
  if(Buffer.byteLength(payload)>4*1024*1024)throw invalid('Book metadata exceeds 4 MB.');
  this.auth.db.prepare('INSERT INTO audiobooks VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at').run(book.id,user,book.albumId,payload,book.updatedAt);
  return book;
 }
 add(user:string,album:AlbumDetail){return this.transaction(user,()=>{
  const existing=this.auth.db.prepare('SELECT id FROM audiobooks WHERE user_id=? AND album_id=?').get(user,album.album.id);
  if(existing)return this.get(user,String(existing.id));
  if(Number(this.auth.db.prepare('SELECT count(*) AS n FROM audiobooks WHERE user_id=?').get(user)!.n)>=200)throw invalid('Your bookshelf holds up to 200 books.');
  if(!album.tracks.length||album.tracks.length>5000)throw invalid('Choose a book with 1–5,000 parts.');
  for(const track of album.tracks)if(Buffer.byteLength(JSON.stringify(track))>this.auth.resources.metadataBytes)throw invalid('Part metadata exceeds the configured limit.');
  const parts=album.tracks;
  return this.save(user,{id:randomUUID(),albumId:album.album.id,title:album.album.title,author:album.album.artist,narrator:'',series:'',description:'',artworkId:album.album.artworkId,
   status:'unstarted',partId:parts[0]!.id,position:0,speed:1,revision:0,updatedAt:Date.now(),parts,partCount:parts.length,
   duration:parts.every(t=>t.duration!==null)?parts.reduce((n,t)=>n+t.duration!,0):null,
   chapters:parts.map((t,i)=>({id:randomUUID(),partId:t.id,position:0,title:t.title||`Part ${i+1}`,kind:'part'})),bookmarks:[]});
 });}
 append(user:string,id:string,revision:unknown,album:AlbumDetail){return this.transaction(user,()=>{
  const book=this.get(user,id);if(book.revision!==revision)throw new AuthError(409,'BOOK_CONFLICT','This book changed. Reload it before adding another volume.');
  const known=new Set(book.parts.map(p=>p.id)),parts=album.tracks.filter(p=>!known.has(p.id));
  if(!parts.length)throw invalid('These files are already in this book.');
  if(book.parts.length+parts.length>5000)throw invalid('A book can contain up to 5,000 parts.');
  if(book.chapters.length+parts.length>6000)throw invalid('Chapter limit reached.');
  for(const part of parts)if(Buffer.byteLength(JSON.stringify(part))>this.auth.resources.metadataBytes)throw invalid('Part metadata exceeds the configured limit.');
  book.parts.push(...parts);book.chapters.push(...parts.map(p=>({id:randomUUID(),partId:p.id,position:0,title:p.title,kind:'part' as const})));
  if(book.status==='finished')book.status='listening';book.partCount=book.parts.length;book.duration=book.parts.every(p=>p.duration!==null)?book.parts.reduce((n,p)=>n+p.duration!,0):null;book.revision++;
  return this.save(user,book);
 });}
 detect(user:string,id:string,revision:unknown,result:ChapterDetection){return this.transaction(user,()=>{
  const book=this.get(user,id);if(book.revision!==revision)throw new AuthError(409,'BOOK_CONFLICT','This book changed during the chapter scan. Pause playback and retry.');
  for(const chapter of result.chapters){
   if(!book.parts.some(p=>p.id===chapter.partId)||book.chapters.some(c=>c.partId===chapter.partId&&Math.abs(c.position-chapter.position)<0.1))continue;
   if(book.chapters.length>=6000)throw invalid('Chapter limit reached.');
   book.chapters.push({id:randomUUID(),...chapter,kind:'chapter',titleSource:'embedded'});
  }
  // At time zero the file boundary doubles as the first embedded chapter.
  for(const chapter of result.chapters.filter(c=>c.position===0)){const first=book.chapters.find(c=>c.partId===chapter.partId&&c.position===0&&c.kind==='part');if(first&&first.titleSource!=='manual'){first.title=chapter.title;first.titleSource='embedded';}}
  const order=new Map(book.parts.map((p,i)=>[p.id,i]));book.chapters.sort((a,b)=>order.get(a.partId)!-order.get(b.partId)!||a.position-b.position);
  book.chapterScan={complete:result.complete,message:result.message};book.revision++;return this.save(user,book);
 });}
 mutate(user:string,id:string,action:string,body:Record<string,unknown>){return this.transaction(user,()=>{
  const book=this.get(user,id);
  if(body.revision!==book.revision)throw new AuthError(409,'BOOK_CONFLICT','This book changed on another screen or device. Reload it before continuing.');
  const location=(input=body)=>{
   const part=book.parts.find(t=>t.id===input.partId),position=input.position;
   if(!part||typeof position!=='number'||!Number.isFinite(position)||position<0||position>604800||(part.duration!==null&&position>part.duration+1))throw invalid('Choose a valid position within this book.');
   return {partId:part.id,position:part.duration===null?position:Math.min(position,part.duration)};
  };
  if(action==='offline-sync'){
   const position=location();
   if(typeof body.speed!=='number'||!Number.isFinite(body.speed)||body.speed<0.5||body.speed>3||!['unstarted','listening','finished'].includes(String(body.status))||!Array.isArray(body.bookmarks)||body.bookmarks.length>500)throw invalid();
   const ids=new Set<string>();const bookmarks=body.bookmarks.map(value=>{
    if(!value||typeof value!=='object'||Array.isArray(value))throw invalid();const b=value as Record<string,unknown>;
    if(Object.keys(b).some(k=>!['id','partId','position','note','createdAt'].includes(k))||typeof b.id!=='string'||!(/^[A-Za-z0-9_-]{1,256}$/.test(b.id))||ids.has(b.id)||typeof b.createdAt!=='number'||!Number.isSafeInteger(b.createdAt)||b.createdAt<0||b.createdAt>8640000000000000)throw invalid();
    ids.add(b.id);return {id:b.id,...location(b),note:text(b.note,1000),createdAt:b.createdAt};
   });
   Object.assign(book,position,{speed:body.speed,status:body.status,bookmarks});
  }else if(action==='progress'){
   Object.assign(book,location());if(book.status!=='finished')book.status='listening';
  }else if(action==='metadata'){
   book.title=text(body.title,200,true);book.author=text(body.author,200);book.narrator=text(body.narrator,200);book.series=text(body.series,200);book.description=text(body.description,4000);
  }else if(action==='speed'){
   if(typeof body.speed!=='number'||!Number.isFinite(body.speed)||body.speed<0.5||body.speed>3)throw invalid();book.speed=body.speed;
  }else if(action==='status'){
   if(!['unstarted','listening','finished'].includes(String(body.status)))throw invalid();book.status=body.status as Audiobook['status'];
   if(book.status==='unstarted'){book.partId=book.parts[0]!.id;book.position=0;}
  }else if(action==='bookmark'){
   if(book.bookmarks.length>=500)throw invalid('A book can have up to 500 bookmarks.');
   book.bookmarks.push({id:randomUUID(),...location(),note:text(body.note,1000),createdAt:Date.now()});
  }else if(action==='bookmark-edit'){
   const bookmark=book.bookmarks.find(b=>b.id===body.bookmarkId);if(!bookmark)throw invalid();bookmark.note=text(body.note,1000);
  }else if(action==='bookmark-delete'){
   book.bookmarks=book.bookmarks.filter(b=>b.id!==body.bookmarkId);
  }else if(action==='chapter'){
   if(book.chapters.length>=6000)throw invalid('Chapter limit reached.');
   const point=location();if(book.chapters.some(c=>c.partId===point.partId&&Math.abs(c.position-point.position)<0.1))throw invalid('A chapter already starts here.');
   book.chapters.push({id:randomUUID(),...point,title:text(body.title,200,true),kind:'chapter',titleSource:'manual'});
   const order=new Map(book.parts.map((p,i)=>[p.id,i]));book.chapters.sort((a,b)=>order.get(a.partId)!-order.get(b.partId)!||a.position-b.position);
  }else if(action==='chapter-titles'){
   if(!Array.isArray(body.titles)||!body.titles.length||body.titles.length>48)throw invalid();
   const ids=new Set<string>();
   for(const input of body.titles){
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['chapterId','title','previousTitle'].includes(k)))throw invalid();
    const item=input as Record<string,unknown>,chapter=book.chapters.find(c=>c.id===item.chapterId);
    if(!chapter||ids.has(chapter.id))throw invalid();ids.add(chapter.id);
    if(item.previousTitle!==chapter.title)throw new AuthError(409,'BOOK_CONFLICT','A chapter name changed. Read the headings again before saving.');
    chapter.title=text(item.title,200,true);chapter.titleSource='manual';
   }
  }else if(action==='chapter-delete'){
   book.chapters=book.chapters.filter(c=>c.id!==body.chapterId||c.kind==='part');
  }else if(action==='move-part'){
   const index=book.parts.findIndex(p=>p.id===body.partId);if(index<0||(body.direction!==1&&body.direction!==-1))throw invalid();
   const target=index+body.direction;if(target<0||target>=book.parts.length)throw invalid();
   const part=book.parts.splice(index,1)[0]!;book.parts.splice(target,0,part);if(book.status==='unstarted'){book.partId=book.parts[0]!.id;book.position=0;}
   const order=new Map(book.parts.map((p,i)=>[p.id,i]));book.chapters.sort((a,b)=>order.get(a.partId)!-order.get(b.partId)!||a.position-b.position);
  }else if(action==='delete'){
   this.auth.db.prepare('DELETE FROM audiobooks WHERE id=? AND user_id=?').run(id,user);return null;
  }else throw invalid();
  book.revision++;return this.save(user,book);
 });}
}
