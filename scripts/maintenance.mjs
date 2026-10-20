/** Offline copy-based maintenance only. Destinations must be NEW private directories. */
import {DatabaseSync,backup} from 'node:sqlite';
import {readdir,lstat,realpath,mkdir,copyFile,chmod,open} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {parse} from 'dotenv';
import {absolute,safeLayout,privateDirectory,exclusivePrivate,musicDirectory,environment,overlaps,repository,headroom} from './installation.mjs';
import {readPrivateFile} from './private-files.mjs';
export async function copyTree(source,destination){
 if(await realpath(source)!==absolute(source))throw new Error('Source path components must not be symlinks.');
 const info=await lstat(source);
 if(info.nlink>1&&!info.isDirectory())throw new Error('Hard-linked source files are not supported.');
 if(info.isSymbolicLink()||info.uid!==process.getuid()||(info.mode&0o077)!==0)throw new Error('Source must be owner-only, owned by this identity and symlink-free.');
 if(info.isDirectory()){
  await mkdir(destination,{mode:0o700});
  for(const name of await readdir(source))await copyTree(join(source,name),join(destination,name));
 }else if(info.isFile()){
  // SQLite snapshots include committed WAL records; never copy live main/sidecar files.
  if(source.endsWith('-wal')||source.endsWith('-shm'))return;
  const handle=await open(source,'r');const header=Buffer.alloc(16);await handle.read(header,0,16,0);await handle.close();
  if(header.toString()==='SQLite format 3\0'){
   const db=new DatabaseSync(source,{readOnly:true});try{await backup(db,destination);}finally{db.close();}
   await chmod(destination,0o600);
  }else{await copyFile(source,destination,1);await chmod(destination,0o600);}
 }else throw new Error('Special files cannot be backed up.');
}
export async function inventory(root,prefix=''){
 const result={};
 for(const name of (await readdir(join(root,prefix))).sort()){const rel=join(prefix,name);const path=join(root,rel);const info=await lstat(path);if(info.isSymbolicLink())throw new Error('Backup symlink refused.');if(info.isDirectory())Object.assign(result,await inventory(root,rel));else if(info.isFile()){const hash=createHash('sha256');for await(const bytes of createReadStream(path))hash.update(bytes);result[rel]=hash.digest('hex');}else throw new Error('Special file refused.');}
 return result;
}
async function treeBytes(path){const info=await lstat(path);if(info.isSymbolicLink())throw new Error('Symlink source refused.');if(!info.isDirectory())return info.size;let size=0;for(const name of await readdir(path))size+=await treeBytes(join(path,name));return size;}
export async function snapshot(source,destination,confirmation){
 if(confirmation!=='STOPPED')throw new Error('Stop only the selected application/engine before backup; pass STOPPED after verifying no writer remains.');
 await safeLayout({source,destination});
 await headroom(dirname(destination),(await treeBytes(source))*2+256*1024*1024);
 await privateDirectory(destination);
 await copyTree(source,join(destination,'payload'));
 await exclusivePrivate(join(destination,'manifest.json'),JSON.stringify({version:1,created:new Date().toISOString(),files:await inventory(join(destination,'payload'))},null,2));
}
export async function restore(source,destination,confirmation){
 if(confirmation!=='RESTORE-COPY')throw new Error('Restore only to a new isolated destination with RESTORE-COPY.');
 await safeLayout({source,destination});
 const manifest=JSON.parse(readPrivateFile(join(source,'manifest.json'),false,1024*1024));
 if(manifest.version!==1||JSON.stringify(manifest.files)!==JSON.stringify(await inventory(join(source,'payload'))))throw new Error('Backup integrity mismatch. Preserve originals and investigate.');
 await privateDirectory(destination);
 await copyTree(join(source,'payload'),join(destination,'restored'));
 // Drop all restored Freeqify sessions and unused invitation authority, including
 // stale bearer secrets from backups. Accounts, collections and passwords survive.
 const walk=async path=>{for(const n of await readdir(path)){const p=join(path,n);if((await lstat(p)).isDirectory())await walk(p);else if(n==='freeqify.sqlite'){
  const db=new DatabaseSync(p);try{db.exec('BEGIN IMMEDIATE; DELETE FROM sessions; DELETE FROM invitations; COMMIT;');}finally{db.close();}
 }}};
 await walk(join(destination,'restored'));
}
export async function reconfigureMusic(config,destination,music,confirmation){
 if(confirmation!=='CONFIRM')throw new Error('Confirm resolved music path with CONFIRM.');
 const selected=await musicDirectory(music);
 const env=parse(readPrivateFile(config,false,1024*1024));
 if(!env.NAVIDROME_DATA_DIR)throw new Error('Engine configuration lacks an explicit state path.');
 await safeLayout({music:selected.resolved,state:env.NAVIDROME_DATA_DIR});
 if(overlaps(repository,destination)||overlaps(selected.resolved,destination))throw new Error('New configuration must be private and outside music/code.');
 await exclusivePrivate(destination,environment({...env,MUSIC_DIR:selected.resolved,MUSIC_READINESS_FILE:''}));return selected;
}
if(process.argv[1]===new URL(import.meta.url).pathname){
 if(process.getuid()===0)throw new Error('Run offline maintenance as the data owner, never root.');
 const [command,source,destination,confirmation,extra]=process.argv.slice(2);
 if(!source||!destination)throw new Error('Usage: maintenance.mjs backup|restore SOURCE NEW_DEST CONFIRMATION; music ENGINE_ENV NEW_ENV CONFIRM MUSIC_DIR');
 absolute(source);absolute(destination);
 if(command==='backup')await snapshot(source,destination,confirmation);
 else if(command==='restore')await restore(source,destination,confirmation);
 else if(command==='music')console.log(await reconfigureMusic(source,destination,extra,confirmation));
 else throw new Error('Unknown maintenance command.');
 console.log(`Prepared ${command} at ${destination}. Nothing was installed, replaced, deleted or started.`);
}
