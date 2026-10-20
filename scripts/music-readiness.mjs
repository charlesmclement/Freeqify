/** Read-only readiness proof. Never creates a marker in a music collection. */
import {execFileSync} from 'node:child_process';
import {constants} from 'node:fs';
import {open,realpath} from 'node:fs/promises';
import {relative,isAbsolute,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {absolute,exclusivePrivate,musicDirectory} from './installation.mjs';
import {readPrivateFile} from './private-files.mjs';
export function mountedFilesystem(music){
 const text=execFileSync('findmnt',['--json','--target',music,'--output','TARGET,UUID,FSTYPE,FSROOT'],{encoding:'utf8',timeout:5000,maxBuffer:64*1024,env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});
 const entries=JSON.parse(text).filesystems;
 if(!Array.isArray(entries)||entries.length!==1)throw new Error('Cannot identify one required music filesystem.');
 const row=entries[0];
 if(!row.uuid||!row.target||!row.fstype||!row.fsroot)throw new Error('Music filesystem must expose a stable UUID, mount target, type and filesystem root. Stop for host-specific review.');
 return {target:row.target,uuid:row.uuid,fstype:row.fstype,fsroot:row.fsroot};
}
async function witness(music,name){
 if(typeof name!=='string'||!name||isAbsolute(name)||name.split('/').some(p=>!p||p==='.'||p==='..')||/[\r\n\0]/.test(name))throw new Error('Choose an existing library-relative regular file as readiness witness.');
 let directory=await open(music,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);let file;
 try{
  const parts=name.split('/');
  for(const part of parts.slice(0,-1)){const next=await open(`/proc/self/fd/${directory.fd}/${part}`,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);await directory.close();directory=next;}
  file=await open(`/proc/self/fd/${directory.fd}/${parts.at(-1)}`,constants.O_RDONLY|constants.O_NONBLOCK|constants.O_NOFOLLOW);
  const before=await file.stat();if(!before.isFile()||before.size===0)throw new Error('Readiness witness must be an existing nonempty regular file, without symlink components.');
  const bytes=Buffer.alloc(Math.min(before.size,65536));let offset=0;
  while(offset<bytes.length){const {bytesRead}=await file.read(bytes,offset,bytes.length-offset,offset);if(!bytesRead)throw new Error('Cannot read the complete readiness witness sample.');offset+=bytesRead;}
  const after=await file.stat();if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw new Error('Readiness witness changed during verification.');
  return {path:name,size:before.size,prefixSha256:createHash('sha256').update(bytes).digest('hex')};
 }finally{await file?.close();await directory.close();}
}
function filesystemIdentity(music,filesystem){
 if(!filesystem||['target','uuid','fstype','fsroot'].some(key=>typeof filesystem[key]!=='string'||!filesystem[key]))throw new Error('Music filesystem identity is incomplete.');
 if(!isAbsolute(filesystem.target)||!isAbsolute(filesystem.fsroot))throw new Error('Music mount paths must be absolute.');
 const path=relative(filesystem.target,music);
 if(path==='..'||path.startsWith('../')||isAbsolute(path))throw new Error('Required mount does not contain the music directory.');
 // systemd ReadOnlyPaths creates an extra bind mount. Compare the effective root
 // within the same UUID/type, rather than rejecting that legitimate namespace view.
 return {uuid:filesystem.uuid,fstype:filesystem.fstype,root:resolve(filesystem.fsroot,path)};
}
export async function captureReadiness(music,file,mount=mountedFilesystem){
 const {resolved}=await musicDirectory(music);const before=mount(resolved);filesystemIdentity(resolved,before);const sample=await witness(resolved,file);const after=mount(resolved);
 if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Music mount changed during verification.');
 return {version:1,music:resolved,filesystem:before,witness:sample};
}
export async function verifyReadiness(music,proof,mount=mountedFilesystem){
 if(proof?.version!==1||!proof.filesystem||!proof.witness)throw new Error('A confirmed music readiness file is required before starting the engine.');
 const resolved=await realpath(absolute(music));
 if(resolved!==proof.music)throw new Error('Music location differs from the confirmed readiness file. Stop and review the new location.');
 const expectedIdentity=filesystemIdentity(resolved,proof.filesystem);
 const actual=await captureReadiness(resolved,proof.witness.path,mount);
 if(JSON.stringify(filesystemIdentity(resolved,actual.filesystem))!==JSON.stringify(expectedIdentity)||JSON.stringify(actual.witness)!==JSON.stringify(proof.witness))throw new Error('Required music drive/mount or witness is missing or changed. No indexing is allowed.');
 return actual;
}
export async function requireMusicReady(music,proofFile){
 if(!proofFile)throw new Error('Set MUSIC_READINESS_FILE after confirming the mounted collection. Refusing engine startup before indexing.');
 return verifyReadiness(music,JSON.parse(readPrivateFile(proofFile,false,65536)));
}
if(process.argv[1]===new URL(import.meta.url).pathname){
 const [command,music,file,last]=process.argv.slice(2);
 if(process.getuid()===0)throw new Error('Check readiness as the unprivileged engine configuration owner.');
 if(command==='capture'&&last){
  const sample=await captureReadiness(music,last);console.log(JSON.stringify(sample,null,2));
  // Explicit final argument is an existing witness, not a file created in music.
  // Confirmation uses a dedicated flag, so scripted operation is equally explicit.
  if(process.argv[6]!=='CONFIRM-MOUNTED')throw new Error('Review the mounted drive, then append CONFIRM-MOUNTED. Nothing written.');
  await exclusivePrivate(absolute(file),JSON.stringify(sample,null,2)+'\n');
 }else if(command==='check'&&!last){await requireMusicReady(music,file);console.log('Confirmed music filesystem and existing-file witness are ready. No indexing started.');}
 else throw new Error('Usage: music-readiness.mjs capture MUSIC NEW_PROOF RELATIVE_EXISTING_FILE CONFIRM-MOUNTED | check MUSIC PROOF');
}
