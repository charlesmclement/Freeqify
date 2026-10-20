/** Read-only traversal under the actual engine identity, before indexing is allowed. */
import {access,realpath,readdir,stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {relative,isAbsolute,join} from 'node:path';
import {musicDirectory} from './installation.mjs';
export async function verifyMusic(path,expectedUid){
 if(!Number.isSafeInteger(expectedUid)||expectedUid<1||process.getuid()!==expectedUid)throw new Error('Run this check as the exact eventual unprivileged Navidrome UID.');
 const {resolved}=await musicDirectory(path);const seen=new Set();let entries=0;
 async function visit(path){
  if(++entries>100000)throw new Error('Verification exceeds 100,000 entries; review a bounded host-specific inventory before scanning.');
  const real=await realpath(path);const rel=relative(resolved,real);
  if(rel==='..'||rel.startsWith('../')||isAbsolute(rel))throw new Error(`Outside-library symlink requires an exact separate review: ${real}`);
  const info=await stat(real);if(info.isDirectory()){
   if(seen.has(real))return;seen.add(real);await access(real,constants.R_OK|constants.X_OK);
   for(const name of await readdir(real))await visit(join(real,name));
  }else if(info.isFile())await access(real,constants.R_OK);
  else throw new Error('Special media path refused; review the selected tree.');
 }
 await visit(resolved);return {resolved,uid:expectedUid,entries};
}
if(process.argv[1]===new URL(import.meta.url).pathname){
 const [uid,path,confirmation]=process.argv.slice(2);
 if(confirmation!=='CONFIRM')throw new Error('Usage: verify-music.mjs EXPECTED_ENGINE_UID ABSOLUTE_MUSIC_DIR CONFIRM. This only checks read access, never indexes.');
 console.log(await verifyMusic(path,Number(uid)));
 console.log('Read/traverse verification passed as the engine UID. Read-only sandbox and real-host confidentiality checks are still required before indexing.');
}
