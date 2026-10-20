import {it,expect,afterEach,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,chmod,symlink,stat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {AuthStore} from './auth/store.js';
import {PersonalStore} from './personal-store.js';
import {readConfig} from './config.js';
import {emptyPlayback,type Track} from '@freeqify/shared';
import {LibraryError} from './integrations/navidrome.js';
import {captureReferenceBaseline,verifyReferenceBaseline} from './migration-review.js';
// @ts-expect-error Native deployment module.
import {captureReadiness,verifyReadiness} from '../../../scripts/music-readiness.mjs';
// @ts-expect-error Native deployment module.
import {packSource} from '../../../scripts/source-transfer.mjs';
// @ts-expect-error Native deployment module.
import {snapshot,restore} from '../../../scripts/maintenance.mjs';
const cleanups:(()=>Promise<unknown>)[]=[];
afterEach(async()=>{for(const fn of cleanups.splice(0).reverse())await fn();});
async function fixture(){const path=await mkdtemp('/tmp/freeqify-review-');await chmod(path,0o700);cleanups.push(()=>rm(path,{recursive:true,force:true}));return path;}
const fsIdentity={target:'/',uuid:'synthetic-drive-uuid',fstype:'ext4',fsroot:'/'};
it('detects a missing mount even when its empty directory still exists',async()=>{
 const root=await fixture();await mkdir(root+'/音楽');await writeFile(root+'/音楽/witness.wav','original bytes');
 const mounted={...fsIdentity,target:root+'/音楽'};const proof=await captureReadiness(root+'/音楽','witness.wav',()=>mounted);
 expect(await verifyReadiness(root+'/音楽',proof,()=>mounted)).toEqual(proof);
 await rm(root+'/音楽/witness.wav');await expect(verifyReadiness(root+'/音楽',proof,()=>fsIdentity)).rejects.toThrow();
 await expect(verifyReadiness(root+'/音楽',proof,()=>mounted)).rejects.toThrow();
 // Wrong filesystem with an identical witness still fails.
 await writeFile(root+'/音楽/witness.wav','original bytes');await expect(verifyReadiness(root+'/音楽',proof,()=>({...mounted,uuid:'another-drive'}))).rejects.toThrow('missing or changed');
 expect(await readFile(root+'/音楽/witness.wav','utf8')).toBe('original bytes');
});
it('supports an internal music folder and rejects changed witnesses, symlinks and empty libraries',async()=>{
 const root=await fixture();await mkdir(root+'/music');await writeFile(root+'/music/song','known');const proof=await captureReadiness(root+'/music','song',()=>fsIdentity);
 expect((await verifyReadiness(root+'/music',proof,()=>fsIdentity)).filesystem.uuid).toBe(fsIdentity.uuid);
 await writeFile(root+'/music/song','other');await expect(verifyReadiness(root+'/music',proof,()=>fsIdentity)).rejects.toThrow();
 await symlink(root+'/music/song',root+'/music/link');await expect(captureReadiness(root+'/music','link',()=>fsIdentity)).rejects.toThrow();await expect(captureReadiness(root+'/music','../music/song',()=>fsIdentity)).rejects.toThrow();await mkdir(root+'/empty');await expect(captureReadiness(root+'/empty','song',()=>fsIdentity)).rejects.toThrow();
});
it('refuses engine launch before state creation when readiness proof is absent',async()=>{
 const root=await fixture();await mkdir(root+'/empty-mount');await writeFile(root+'/engine.env',`MUSIC_DIR="${root}/empty-mount"\nNAVIDROME_DATA_DIR="${root}/state"\n`,{mode:0o600});
 expect(()=>execFileSync(process.execPath,['scripts/navidrome.mjs'],{cwd:process.cwd(),env:{PATH:process.env.PATH,FREEQIFY_CONFIG_FILE:root+'/engine.env'},stdio:'pipe'})).toThrow('Refusing engine startup');await expect(stat(root+'/state')).rejects.toThrow();
});
it('packages only explicitly approved source, including uncommitted refinements',async()=>{
 const root=await fixture();const repo=root+'/repository';await mkdir(repo);await mkdir(repo+'/scripts');await writeFile(repo+'/package.json','{"private":true}');await writeFile(repo+'/scripts/new-tool.mjs','// uncommitted source');
 for(const name of ['.env','freeqify.sqlite','song.flac'])await writeFile(repo+'/'+name,'PRIVATE-CANARY');await mkdir(repo+'/node_modules');await writeFile(repo+'/node_modules/secret','PRIVATE-CANARY');await mkdir(repo+'/dist');await writeFile(repo+'/dist/app.js','PRIVATE-CANARY');
 await packSource(repo,root+'/transfer',['package.json','scripts/new-tool.mjs']);const listing=execFileSync('tar',['-tzf',root+'/transfer/source.tar.gz'],{encoding:'utf8'});expect(listing.split('\n').filter(Boolean)).toEqual(['package.json','scripts/new-tool.mjs']);expect(await readFile(root+'/transfer/source/scripts/new-tool.mjs','utf8')).toContain('uncommitted');expect((await stat(root+'/transfer/source.tar.gz')).mode&0o777).toBe(0o600);
 for(const name of ['.env','freeqify.sqlite','song.flac','node_modules/secret','dist/app.js','../package.json'])await expect(packSource(repo,root+'/bad',[name])).rejects.toThrow('allowlist');await symlink(repo+'/package.json',repo+'/scripts/link.mjs');await expect(packSource(repo,root+'/linked',['scripts/link.mjs'])).rejects.toThrow('symlink');
});
it('restores paired synthetic state, preserves accounts/collections/queue and stops on changed catalog IDs',async()=>{
 const root=await fixture();await mkdir(root+'/web-state',{mode:0o700});await mkdir(root+'/engine-state',{mode:0o700});
 const file=root+'/web-state/freeqify.sqlite';let auth=new AuthStore(file,readConfig({}).auth);auth.db.prepare("INSERT INTO users VALUES('owner','owner','unchanged-password-hash','admin','active',1)").run();const store=new PersonalStore(auth);
 const track:Track={id:'preserved-id',title:'Synthetic track',artist:'Artist',album:'Album',albumId:'album-id',artworkId:null,duration:60,format:'wav',trackNumber:1};const playlist=store.create('owner','Keep');store.add('owner',playlist,track);store.add('owner',playlist,track);store.favorite('owner',track,true);store.record('owner',track,{eventId:'event',generation:0,listened:30,position:40});auth.savePlayback('owner',JSON.stringify({...emptyPlayback(),queue:[{source:'local',trackId:'queue-only',key:'key'}],order:['key'],current:'key'}));
 const engine=new DatabaseSync(root+'/engine-state/catalog.sqlite');engine.exec('CREATE TABLE synthetic_catalog(id TEXT PRIMARY KEY, metadata TEXT)');for(const t of [track,{...track,id:'queue-only'}])engine.prepare('INSERT INTO synthetic_catalog VALUES(?,?)').run(t.id,JSON.stringify(t));
 const catalog=(db:DatabaseSync)=>({track:vi.fn(async(id:string)=>{const row=db.prepare('SELECT metadata FROM synthetic_catalog WHERE id=?').get(id);if(!row)throw new LibraryError('NOT_FOUND');return JSON.parse(String(row.metadata)) as Track;})});
 const baseline=await captureReferenceBaseline(auth.db,catalog(engine));expect(baseline.references).toHaveLength(2);auth.close();engine.close();await chmod(file,0o600);await chmod(root+'/engine-state/catalog.sqlite',0o600);
 await snapshot(root+'/web-state',root+'/web-backup','STOPPED');await snapshot(root+'/engine-state',root+'/engine-backup','STOPPED');await restore(root+'/web-backup',root+'/target-web','RESTORE-COPY');await restore(root+'/engine-backup',root+'/target-engine','RESTORE-COPY');
 auth=new AuthStore(root+'/target-web/restored/freeqify.sqlite',readConfig({}).auth);const targetEngine=new DatabaseSync(root+'/target-engine/restored/catalog.sqlite');
 try{
  expect(await verifyReferenceBaseline(auth.db,catalog(targetEngine),baseline)).toEqual({checked:2,previouslyMissing:0});expect(auth.db.prepare('SELECT password_hash FROM users').get()?.password_hash).toBe('unchanged-password-hash');const personal=new PersonalStore(auth);expect(personal.entries('owner',playlist)).toHaveLength(2);expect(personal.favorites('owner')).toHaveLength(1);expect(personal.history('owner',0,48)[0]?.position).toBe(40);expect(String(auth.db.prepare('SELECT state FROM playback_state').get()?.state)).toContain('queue-only');
  targetEngine.prepare('UPDATE synthetic_catalog SET id=? WHERE id=?').run('replacement-id','preserved-id');await expect(verifyReferenceBaseline(auth.db,catalog(targetEngine),baseline)).rejects.toThrow('STOP migration');expect(auth.db.prepare('SELECT track_id FROM personal_entries LIMIT 1').get()?.track_id).toBe('preserved-id');
 }finally{auth.close();targetEngine.close();}
});

it('accepts the same read-only service bind view but rejects a different subtree',async()=>{
 const root=await fixture();await mkdir(root+'/music');await writeFile(root+'/music/song','known original');const proof=await captureReadiness(root+'/music','song',()=>fsIdentity);
 expect((await verifyReadiness(root+'/music',proof,()=>({...fsIdentity,target:root+'/music',fsroot:root+'/music'}))).music).toBe(root+'/music');
 await expect(verifyReadiness(root+'/music',proof,()=>({...fsIdentity,target:root+'/music',fsroot:'/other-subtree'}))).rejects.toThrow('missing or changed');
});
