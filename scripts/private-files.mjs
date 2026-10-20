import {constants,openSync,closeSync,fstatSync,readSync,lstatSync} from 'node:fs';
import {resolve} from 'node:path';
// Linux O_PATH allows traversal of execute-only shared-host ancestors without
// requiring permission to list them. Node does not expose this Linux flag.
const directoryFlags=0x200000|constants.O_DIRECTORY|constants.O_NOFOLLOW;
/** Linux descriptor-relative reads: no symlink components or writable untrusted parents. */
export function readPrivateFile(path, optional=false, maxBytes=32*1024*1024) {
 const absolute=resolve(path);
 let fd;
 try{
  try{lstatSync(absolute);}catch(error){if(optional&&error.code==='ENOENT')return undefined;throw error;}
  fd=openSync('/',directoryFlags);
  const parts=absolute.split('/').filter(Boolean);
  for(let i=0;i<parts.length;i++){
   const next=openSync(`/proc/self/fd/${fd}/${parts[i]}`,i<parts.length-1?directoryFlags:constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
   closeSync(fd);fd=next;const info=fstatSync(fd);const owner=process.getuid?.();
   if(i<parts.length-1){if(!info.isDirectory()||![0,owner].includes(info.uid)||((info.mode&0o022)!==0&&!(info.uid===0&&(info.mode&0o1000))))throw new Error();}
   else if(!info.isFile()||info.uid!==owner||(info.mode&0o077)!==0||info.size>maxBytes)throw new Error();
  }
  const info=fstatSync(fd);const bytes=Buffer.alloc(info.size+1);let size=0;
  while(size<bytes.length){const n=readSync(fd,bytes,size,bytes.length-size,null);if(!n)break;size+=n;}
  const after=fstatSync(fd);if(size!==info.size||after.mtimeMs!==info.mtimeMs||after.ctimeMs!==info.ctimeMs)throw new Error();
  return bytes.subarray(0,size).toString('utf8');
 }catch{throw new Error('Unsafe or unreadable private file: require an owner-owned regular file (0600), no symlinks, and non-writable trusted parent directories. Check the configured file path and permissions.');}
 finally{if(fd!==undefined)closeSync(fd);}
}
