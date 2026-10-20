import {it,expect,afterEach} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm,chmod,stat} from 'node:fs/promises';
import {createServer} from 'node:net';
import {DatabaseSync} from 'node:sqlite';
// JavaScript installation tools are deliberately independent of the server build.
// @ts-expect-error Native deployment script module.
import {musicDirectory,safeLayout,serviceUnit,exclusivePrivate,availablePort} from '../../../scripts/installation.mjs';
// @ts-expect-error Native deployment script module.
import {snapshot,restore,reconfigureMusic} from '../../../scripts/maintenance.mjs';
const cleanup:(()=>Promise<unknown>)[]=[];
afterEach(async()=>{for(const fn of cleanup.splice(0).reverse())await fn();});
async function fixture(){const p=await mkdtemp('/tmp/freeqify-install-');await chmod(p,0o700);cleanup.push(()=>rm(p,{recursive:true,force:true}));return p;}
it('resolves spaces, Unicode, directory links and preserves synthetic originals',async()=>{
 const root=await fixture();const music=root+'/My 音楽';await mkdir(music);await writeFile(music+'/song.wav','synthetic bytes');const before=(await stat(music+'/song.wav')).mode;await symlink(music,root+'/linked');expect((await musicDirectory(root+'/linked')).resolved).toBe(music);expect(await readFile(music+'/song.wav','utf8')).toBe('synthetic bytes');expect((await stat(music+'/song.wav')).mode).toBe(before);
 await expect(musicDirectory(root+'/missing')).rejects.toThrow();await expect(musicDirectory(music+'/song.wav')).rejects.toThrow();await expect(musicDirectory('relative')).rejects.toThrow();await chmod(music,0);await expect(musicDirectory(music)).rejects.toThrow();await chmod(music,0o700);
});
it('rejects symlink-resolved overlaps and unsafe secret output',async()=>{
 const root=await fixture();await mkdir(root+'/music');await symlink(root+'/music',root+'/alias');await expect(safeLayout({music:root+'/music',data:root+'/alias/state'})).rejects.toThrow('overlaps');await exclusivePrivate(root+'/private.env','secret');expect((await stat(root+'/private.env')).mode&0o777).toBe(0o600);await expect(exclusivePrivate(root+'/private.env','replacement')).rejects.toThrow();expect(await readFile(root+'/private.env','utf8')).toBe('secret');
});
it('detects port conflicts without disturbing the listener',async()=>{
 const server=createServer();await new Promise<void>(ok=>server.listen(0,'127.0.0.1',ok));try{const address=server.address();if(!address||typeof address==='string')throw Error();await expect(availablePort(address.port)).rejects.toThrow('unavailable');expect(server.listening).toBe(true);}finally{await new Promise<void>(ok=>server.close(()=>ok()));}
});
it('generates bounded separate service templates and refuses interpolation',()=>{
 const params={role:'server',identity:'fq-web',release:'/opt/freeqify/release 1',node:'/usr/bin/node',config:'/etc/freeqify/web.env',state:'/var/lib/freeqify'};
 const unit=serviceUnit(params);expect(unit).toContain('ProtectHome=yes');expect(unit).toContain('ReadWritePaths="/var/lib/freeqify"');expect(unit).not.toContain('sudo');expect(unit).toContain('MemoryMax=1G');expect(()=>serviceUnit({...params,identity:'root'})).toThrow();expect(()=>serviceUnit({...params,release:'/opt/%h'})).toThrow();
});
it('backs up committed WAL state and restores copies with sessions/invitations revoked',async()=>{
 const root=await fixture();const source=root+'/source';await mkdir(source,{mode:0o700});const path=source+'/freeqify.sqlite';const db=new DatabaseSync(path);await chmod(path,0o600);db.exec("PRAGMA journal_mode=WAL; CREATE TABLE sessions(id); CREATE TABLE invitations(id); CREATE TABLE favorites(id); INSERT INTO sessions VALUES('old'); INSERT INTO invitations VALUES('old'); INSERT INTO favorites VALUES('kept'); PRAGMA user_version=5;");
 for(const suffix of ['-wal','-shm'])await chmod(path+suffix,0o600);
 await expect(snapshot(source,root+'/bad','yes')).rejects.toThrow();await snapshot(source,root+'/backup','STOPPED');await restore(root+'/backup',root+'/copy','RESTORE-COPY');const restored=new DatabaseSync(root+'/copy/restored/freeqify.sqlite');try{expect(restored.prepare('SELECT * FROM favorites').all()).toEqual([{id:'kept'}]);expect(restored.prepare('SELECT * FROM sessions').all()).toEqual([]);expect(restored.prepare('SELECT * FROM invitations').all()).toEqual([]);expect(restored.prepare('PRAGMA user_version').get()).toEqual({user_version:5});expect(db.prepare('SELECT * FROM sessions').all()).toHaveLength(1);}finally{restored.close();db.close();}
 await expect(restore(root+'/backup',root+'/copy','RESTORE-COPY')).rejects.toThrow();await writeFile(root+'/backup/payload/freeqify.sqlite','tampered');await expect(restore(root+'/backup',root+'/tampered','RESTORE-COPY')).rejects.toThrow('integrity');
});
it('prepares a corrected engine config without replacing existing config or music',async()=>{
 const root=await fixture();await mkdir(root+'/music');await exclusivePrivate(root+'/engine.env',`NAVIDROME_DATA_DIR="${root}/state"\nMUSIC_DIR="${root}/previous"\n`);await reconfigureMusic(root+'/engine.env',root+'/new.env',root+'/music','CONFIRM');expect(await readFile(root+'/new.env','utf8')).toContain(root+'/music');expect(await readFile(root+'/engine.env','utf8')).toContain('/previous');await chmod(root+'/engine.env',0o644);await expect(reconfigureMusic(root+'/engine.env',root+'/unsafe.env',root+'/music','CONFIRM')).rejects.toThrow('private file');
});
it('runs noninteractive preparation end-to-end without starting services or indexing',async()=>{
 const {execFileSync}=await import('node:child_process');const root=await fixture();await mkdir(root+'/音楽 collection');await writeFile(root+'/音楽 collection/original.wav','untouched');
 const spec={installationMode:'fresh',music:root+'/音楽 collection',confirmation:'CONFIRM',output:root+'/bundle',serverState:root+'/server-state',engineState:root+'/engine-state',backups:root+'/backups',release:root+'/release',node:process.execPath,binary:'/usr/bin/navidrome',port:36291,enginePort:36292,basePath:'/music/',serverIdentity:'fq-web-test',engineIdentity:'fq-engine-test',serverConfig:root+'/server-config/server.env',engineConfig:root+'/engine-config/engine.env',passwordFile:root+'/server-config/password'};
 await writeFile(root+'/spec.json',JSON.stringify(spec),{mode:0o600});execFileSync(process.execPath,['scripts/setup.mjs','--spec',root+'/spec.json'],{cwd:process.cwd(),env:{PATH:process.env.PATH},stdio:'pipe'});
 expect(await readFile(root+'/bundle/engine.env','utf8')).toContain(spec.music);expect(await readFile(root+'/bundle/freeqify-server.service','utf8')).toContain(spec.serverConfig);expect(JSON.parse(await readFile(root+'/bundle/installation.json','utf8')).status).toBe('prepared-not-deployed');expect(await readFile(root+'/音楽 collection/original.wav','utf8')).toBe('untouched');await expect(stat(root+'/engine-state')).rejects.toThrow();await expect(stat(root+'/server-state')).rejects.toThrow();
});
it('requires the exact eventual engine UID and rejects outside-tree media links',async()=>{
 // @ts-expect-error Native deployment script module.
 const {verifyMusic}=await import('../../../scripts/verify-music.mjs');const root=await fixture();await mkdir(root+'/music');await writeFile(root+'/music/song','synthetic');await expect(verifyMusic(root+'/music',process.getuid!()+1)).rejects.toThrow('exact');expect((await verifyMusic(root+'/music',process.getuid!())).entries).toBe(2);await writeFile(root+'/outside','private');await symlink(root+'/outside',root+'/music/external');await expect(verifyMusic(root+'/music',process.getuid!())).rejects.toThrow('Outside-library');
});
