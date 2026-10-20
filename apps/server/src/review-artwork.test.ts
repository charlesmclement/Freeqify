import {afterEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {reviewedArtwork} from './review-artwork.js';
import {migrations} from './storage/migrations.js';
import {AuthStore} from './auth/store.js';
import {readConfig} from './config.js';
const directories:string[]=[];
afterEach(async()=>{for(const dir of directories.splice(0))await rm(dir,{recursive:true,force:true});});
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'freeqify-artwork-review-'));directories.push(dir);
 await mkdir(join(dir,'downloaded'));
 const name=createHash('sha256').update('In Flames\0Clayman').digest('hex').slice(0,24)+'.jpg';
 const item={artist:'In Flames',album:'Clayman',status:'downloaded',file:'/previous/path/'+name};
 const bytes=Buffer.from([255,216,255,12,13,14]);
 await writeFile(join(dir,'downloaded',name),bytes);
 const report=(results:unknown[])=>writeFile(join(dir,'report.json'),JSON.stringify({results}));
 await report([item]);return {dir,item,bytes,report,name};
}
it('matches downloaded covers without relying on scanner album IDs or path locations',async()=>{
 const f=await fixture();expect((await reviewedArtwork(f.dir,'in flames',' CLAYMAN '))?.bytes).toEqual(f.bytes);
 expect(await reviewedArtwork(f.dir,'Different artist','Clayman')).toBeNull();
});
it('rejects ambiguous reports, arbitrary filenames and malformed image data',async()=>{
 const f=await fixture();await f.report([f.item,f.item]);expect(await reviewedArtwork(f.dir,'In Flames','Clayman')).toBeNull();
 await f.report([{...f.item,file:'/private/file.jpg'}]);expect(await reviewedArtwork(f.dir,'In Flames','Clayman')).toBeNull();
 await f.report([f.item]);await writeFile(join(f.dir,'downloaded',f.name),'invalid');expect(await reviewedArtwork(f.dir,'In Flames','Clayman')).toBeNull();
});
it('migrates genre choices to neutral artwork while retaining manual mode and no-artwork choices',async()=>{
 const f=await fixture();const path=join(f.dir,'accounts.sqlite');const old=new DatabaseSync(path);
 for(const migration of migrations.slice(0,6))old.exec(migration.sql);
 old.exec(`INSERT INTO users VALUES('owner','owner','unchanged','listener','active',1);
 INSERT INTO album_artwork_choices(user_id,album_id,mode,cover_key) VALUES('owner','one','selected','genre_07_hip_hop.jpg'),('owner','two','fallback','genre_03_deep_house.jpg');
 INSERT INTO album_artwork_choices(user_id,album_id,mode) VALUES('owner','three','none'); PRAGMA user_version=6;`);old.close();
 const auth=new AuthStore(path,readConfig({}).auth);
 try{expect(auth.db.prepare('SELECT mode,cover_key FROM album_artwork_choices ORDER BY album_id').all()).toEqual([
 {mode:'selected',cover_key:'generic_07_vinyl_warmth.jpg'}, {mode:'none',cover_key:null}, {mode:'fallback',cover_key:'generic_07_vinyl_warmth.jpg'}
 ]);expect(auth.db.prepare('SELECT password_hash FROM users').get()?.password_hash).toBe('unchanged');}finally{auth.close();}
});
