import type {ImportedMetadata,Track,ImportStatus} from '@freeqify/shared';
export const normalized=(v:string)=>v.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
const artists=(v:string)=>v.split(/,|;| feat\.? | featuring /i).map(normalized).sort().join('|');
export function matchImported(metadata:ImportedMetadata,tracks:Track[],rejected:string[]=[]):{status:ImportStatus;track:Track|null;candidates:Track[];reason:string}{
 const candidates=[...new Map(tracks.map(t=>[t.id,t])).values()].filter(t=>!rejected.includes(t.id)&&normalized(t.title)===normalized(metadata.title)&&artists(t.artist)===artists(metadata.artist)).slice(0,8);
 const confident=candidates.filter(t=>{
  if(metadata.isrc&&t.isrc&&metadata.isrc!==t.isrc.toUpperCase().replaceAll('-',''))return false;
  const duration=metadata.duration!==null&&t.duration!==null&&Math.abs(metadata.duration-t.duration)<=3;
  return duration&&((!!metadata.album&&normalized(metadata.album)===normalized(t.album))||(!!metadata.isrc&&metadata.isrc===t.isrc?.toUpperCase().replaceAll('-','')));
 });
 if(confident.length===1)return {status:'available',track:confident[0]!,candidates:[],reason:'Title, artist and recording metadata match.'};
 if(candidates.length)return {status:'review',track:null,candidates,reason:'Confirm the album, recording version and duration before using this match.'};
 // Related titles may differ by mix/live/remaster. Keep them review-only, never auto-accept.
 const related=tracks.filter(t=>!rejected.includes(t.id)&&artists(t.artist)===artists(metadata.artist)&&(normalized(t.title).includes(normalized(metadata.title))||normalized(metadata.title).includes(normalized(t.title)))).slice(0,8);
 return related.length?{status:'review',track:null,candidates:related,reason:'A different version may exist. Review before matching.'}:{status:'missing',track:null,candidates:[],reason:'No acceptable match found in the catalog search.'};
}
