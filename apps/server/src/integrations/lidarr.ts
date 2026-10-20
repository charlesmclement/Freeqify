import type {Config} from '../config.js';
import type {ImportedMetadata,LidarrStatus} from '@freeqify/shared';
import {readPrivateFile} from '../../../../scripts/private-files.mjs';
import {AuthError} from '../auth/password.js';
import {normalized} from '../import-matching.js';
type ObjectRow=Record<string,unknown>;
const object=(v:unknown):ObjectRow=>{if(!v||typeof v!=='object'||Array.isArray(v))throw unavailable();return v as ObjectRow;};
const rows=(v:unknown)=>{if(!Array.isArray(v)||v.length>20000)throw unavailable();return v.map(object);};
const unavailable=()=>new AuthError(502,'LIDARR_UNAVAILABLE','Lidarr is unavailable or returned an unsupported response. Your checklist is safe.');
const mbid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
export interface LidarrCandidate {id:string;title:string;artist:string;year:number|null;monitored:boolean;present:boolean;canRequest:boolean}
export interface AlbumIntegration {status():Promise<LidarrStatus>;lookup(metadata:ImportedMetadata):Promise<LidarrCandidate[]>;state(id:string):Promise<{monitored:boolean;present:boolean}>;request(id:string,search:boolean):Promise<void>}
export class Lidarr implements AlbumIntegration{
 private readonly key:string;
 constructor(private readonly config:Config['lidarr'],private readonly fetcher:typeof fetch=fetch){this.key=config.apiKeyFile?readPrivateFile(config.apiKeyFile,false,4096)!.trim():'';}
 private async call(path:string,body?:unknown,method=body===undefined?'GET':'POST'):Promise<unknown>{
  if(!this.config.url||!this.key)throw new AuthError(503,'LIDARR_NOT_CONFIGURED','Lidarr is not configured. Importing and matching remain available.');
  try{
   const response=await this.fetcher(new URL('api/v1/'+path,this.config.url),{method,redirect:'error',signal:AbortSignal.timeout(10000),headers:{'X-Api-Key':this.key,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
   if(!response.ok)throw unavailable();if(response.status===204)return null;
   const reader=response.body?.getReader();if(!reader)throw unavailable();let size=0;const chunks:Uint8Array[]=[];
   try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8*1024*1024)throw unavailable();chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
   return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  }catch{throw unavailable();}
 }
 async status():Promise<LidarrStatus>{if(!this.config.url||!this.key)return {configured:false,connected:false,canRequest:false,message:'Lidarr is not configured. Your checklist still works.'};try{await this.call('system/status');return {configured:true,connected:true,canRequest:true,message:'Lidarr connected. Album requests require administrator confirmation.'};}catch{return {configured:true,connected:false,canRequest:false,message:'Lidarr is unavailable. Your checklist still works.'};}}
 private async existing(id:string){if(!mbid(id))throw new AuthError(400,'INVALID_ALBUM','Choose a reviewed album.');return rows(await this.call('album?foreignAlbumId='+encodeURIComponent(id))).filter(a=>a.foreignAlbumId===id);}
 async state(id:string){const album=(await this.existing(id))[0];return {monitored:album?.monitored===true,present:Number((album?.statistics as ObjectRow|undefined)?.trackFileCount??0)>0};}
 private async roots(){if(!this.config.rootFolderId)return null;return rows(await this.call('rootfolder')).find(r=>r.id===this.config.rootFolderId&&Number(r.defaultQualityProfileId)>0&&Number(r.defaultMetadataProfileId)>0&&typeof r.path==='string')??null;}
 async lookup(metadata:ImportedMetadata){
  if(!metadata.album)return [];
  const found=rows(await this.call('album/lookup?term='+encodeURIComponent((metadata.albumArtist||metadata.artist)+' '+metadata.album)));
  const artists=rows(await this.call('artist'));const root=await this.roots();const output:LidarrCandidate[]=[];
  for(const a of found.filter(a=>normalized(String(a.title??''))===normalized(metadata.album)).slice(0,8)){
   if(!mbid(a.foreignAlbumId))continue;const artist=object(a.artist);const present=await this.state(a.foreignAlbumId);
   output.push({id:a.foreignAlbumId,title:String(a.title).slice(0,512),artist:String(artist.artistName??'Unknown artist').slice(0,512),year:typeof a.releaseDate==='string'?Number(a.releaseDate.slice(0,4))||null:null,...present,canRequest:!!root||artists.some(r=>r.foreignArtistId===artist.foreignArtistId)});
  }return output;
 }
 async request(id:string,search:boolean){
  const existing=(await this.existing(id))[0];
  if(existing?.monitored===true)return; // Retries do not trigger a second automatic search.
  if(existing){await this.call('album/monitor',{albumIds:[Number(existing.id)],monitored:true},'PUT');}
  else{
   const album=rows(await this.call('album/lookup?term='+encodeURIComponent('lidarr:'+id))).find(a=>a.foreignAlbumId===id);if(!album)throw unavailable();
   const lookupArtist=object(album.artist);let artist=rows(await this.call('artist')).find(a=>a.foreignArtistId===lookupArtist.foreignArtistId);
   if(!artist){
    const root=await this.roots();if(!root)throw new AuthError(409,'LIDARR_SETUP_REQUIRED','Add this artist in Lidarr first, or ask the operator to select an existing root folder for new artists.');
    artist=object(await this.call('artist',{...lookupArtist,id:0,rootFolderPath:root.path,qualityProfileId:root.defaultQualityProfileId,metadataProfileId:root.defaultMetadataProfileId,tags:root.defaultTags??[],monitored:true,monitorNewItems:'none',addOptions:{monitor:'none',searchForMissingAlbums:false}}));
    // Lidarr can return an unmonitored artist for monitor:none. Enable only this
    // newly created artist; its other albums and future-item monitoring stay off.
    if(typeof artist.id!=='number'||artist.id<=0)throw unavailable();
    if(artist.monitored!==true)artist=object(await this.call('artist/'+artist.id,{...artist,monitored:true,monitorNewItems:'none'},'PUT'));
   }
   if(typeof artist.id!=='number'||artist.id<=0)throw unavailable();
   // Never change existing artist profiles, locations, monitoring or download settings.
   // Adding an artist can populate its albums synchronously in Lidarr.
   const populated=(await this.existing(id))[0];
   if(populated){if(populated.monitored!==true)await this.call('album/monitor',{albumIds:[Number(populated.id)],monitored:true},'PUT');}
   else object(await this.call('album',{...album,id:0,artistId:artist.id,artist,monitored:true,addOptions:{addType:'manual',searchForNewAlbum:false}}));
  }
  const confirmed=(await this.existing(id))[0];if(confirmed?.monitored!==true)throw unavailable();
  if(search)await this.call('command',{name:'AlbumSearch',albumIds:[Number(confirmed.id)]});
 }
}
