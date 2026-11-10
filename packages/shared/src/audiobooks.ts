import type {Album,Track} from './index.js';
export interface BookChapter {id:string;partId:string;position:number;title:string;kind:'part'|'chapter';titleSource?:'embedded'|'manual'}
export interface BookSpokenHeading {chapterId:string;position:number;transcript:string;suggestedTitle:string|null}
export interface BookBookmark {id:string;partId:string;position:number;note:string;createdAt:number}
export interface BookSummary {
 id:string;title:string;author:string;narrator:string;series:string;description:string;artworkId:string|null;albumId:string;
 status:'unstarted'|'listening'|'finished';partId:string;position:number;speed:number;revision:number;updatedAt:number;
 partCount:number;duration:number|null;
}
export interface Audiobook extends BookSummary {parts:Track[];chapters:BookChapter[];bookmarks:BookBookmark[];chapterScan?:{complete:boolean;message:string}}
/** Source books are visible before opening; personal state belongs only to the current listener. */
export interface BookCatalogEntry extends Album {book:BookSummary|null}
