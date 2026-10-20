import type { ImportedMetadata } from '@freeqify/shared';
import {AuthError} from './auth/password.js';
const invalid=(message:string)=>new AuthError(400,'INVALID_CSV',message);
export const IMPORT_MAX_BYTES=2*1024*1024;
/** Strict RFC4180-style parser. No evaluation, URLs, archive extraction or filesystem input. */
export function parsePlaylistCsv(input:unknown):ImportedMetadata[]{
 if(typeof input!=='string'||Buffer.byteLength(input)>IMPORT_MAX_BYTES||input.includes('\0'))throw invalid('Use a UTF-8 CSV file no larger than 2 MB.');
 const text=input.replace(/^\uFEFF/,'');const rows:string[][]=[];let row:string[]=[],field='',quoted=false,closed=false;
 const push=()=>{if(field.length>4096)throw invalid('A CSV field exceeds 4,096 characters.');row.push(field);field='';closed=false;if(row.length>100)throw invalid('CSV has too many columns.');};
 const finish=()=>{push();if(row.some(v=>v.trim()))rows.push(row);row=[];if(rows.length>5001)throw invalid('A checklist supports up to 5,000 tracks.');};
 for(let i=0;i<text.length;i++){
  const c=text[i]!;
  if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;}
  else if(c==='"'){if(field||closed)throw invalid('CSV contains an unexpected quote.');quoted=true;}
  else if(c===',')push();else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;finish();}
  else{if(closed)throw invalid('CSV has text after a closing quote.');field+=c;}
  if(field.length>4096)throw invalid('A CSV field exceeds 4,096 characters.');
 }
 if(quoted)throw invalid('CSV contains an unfinished quoted field.');if(field||row.length||closed)finish();
 const header=rows.shift()?.map(x=>x.trim().toLowerCase());if(!header?.length||new Set(header).size!==header.length)throw invalid('CSV needs unique column headings.');
 const find=(...names:string[])=>names.map(n=>header.indexOf(n)).find(i=>i>=0)??-1;
 const columns={title:find('track name','track','title'),artist:find('artist name(s)','artist name','artist','artists'),album:find('album name','album'),albumArtist:find('album artist name(s)','album artist','albumartist'),duration:find('track duration (ms)','duration (ms)','duration_ms'),isrc:find('isrc'),spotifyTrackId:find('track uri','spotify track uri','track id'),spotifyAlbumId:find('album uri','spotify album uri','album id'),releaseDate:find('album release date','release date'),discNumber:find('disc number'),trackNumber:find('track number')};
 if(columns.title<0||columns.artist<0||columns.album<0)throw invalid('CSV requires Track Name, Artist Name(s), and Album Name columns (or Title, Artist, Album).');
 const output=rows.map((r,index)=>{
  if(r.length!==header.length)throw invalid(`Row ${index+2} has the wrong number of columns.`);
  const value=(key:keyof typeof columns)=>columns[key]<0?'':r[columns[key]]!.trim().normalize('NFC');
  const clean=(key:keyof typeof columns,max=512)=>{const s=value(key);if(s.length>max||Array.from(s).some(c=>(c.charCodeAt(0)<32&&c!=='\n'&&c!=='\t')||c.charCodeAt(0)===127))throw invalid(`Row ${index+2} contains invalid or oversized metadata.`);return s;};
  const title=clean('title'),artist=clean('artist'),album=clean('album');if(!title||!artist)throw invalid(`Row ${index+2} needs a title and artist.`);
  const number=(key:keyof typeof columns,max:number)=>{const v=value(key);if(!v)return null;if(!/^\d+$/.test(v)||Number(v)>max)throw invalid(`Row ${index+2} has invalid numeric metadata.`);return Number(v);};
  const uri=(key:'spotifyTrackId'|'spotifyAlbumId',type:string)=>{const v=value(key);if(!v)return null;const id=v.startsWith(`spotify:${type}:`)?v.slice(type.length+9):v;return /^[A-Za-z0-9]{22}$/.test(id)?id:null;};
  const isrc=clean('isrc',32).toUpperCase().replaceAll('-','');if(isrc&&!/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc))throw invalid(`Row ${index+2} has an invalid ISRC.`);
  return {title,artist,album,albumArtist:clean('albumArtist'),duration:(number('duration',604800000)??0)/1000||null,isrc:isrc||null,spotifyTrackId:uri('spotifyTrackId','track'),spotifyAlbumId:uri('spotifyAlbumId','album'),releaseDate:clean('releaseDate',32)||null,discNumber:number('discNumber',999),trackNumber:number('trackNumber',99999)};
 });
 // Header-only exports are real empty playlists, not a malformed import.
 return output;
}
