/** Explicit reviewed source allowlist, including uncommitted Phase 5C work. No Git writes. */
import {readFile,realpath,lstat,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join,dirname,resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {privateDirectory,exclusivePrivate,overlaps} from './installation.mjs';
export function allowedSource(name){
 if(typeof name!=='string'||isAbsolute(name)||name.split('/').some(p=>!p||p==='.'||p==='..'||['node_modules','dist','data','backups','.git'].includes(p)))return false;
 return ['.env.example','.gitignore','.npmrc','.nvmrc','AGENTS.md','LICENSE','README.md','package.json','package-lock.json','tsconfig.base.json','vitest.config.ts','eslint.config.js','deployment/source-files.json','deployment/nginx.conf.example','.github/workflows/check.yml'].includes(name)
  || /^docs\/[a-z0-9-]+\.md$/.test(name)
  || /^scripts\/[a-z0-9-]+\.(?:mjs|d\.mts)$/.test(name)
  || /^(?:apps\/(?:web|server)|packages\/shared)\/(?:package\.json|tsconfig\.json)$/.test(name)
  || /^apps\/web\/(?:index\.html|vite\.config\.ts|public\/(?:icon-(?:192|512)\.png|manifest\.webmanifest))$/.test(name)
  || /^(?:apps\/(?:web|server)|packages\/shared)\/src\/(?:[a-zA-Z0-9-]+\/)*[a-zA-Z0-9.-]+\.(?:ts|tsx|css|md)$/.test(name);
}
export async function packSource(root,destination,files){
 root=await realpath(root);destination=resolve(destination);
 if(overlaps(root,destination))throw new Error('Source transfer bundle must be outside the checkout.');
 files??=JSON.parse(await readFile(join(root,'deployment/source-files.json'),'utf8'));
 if(!Array.isArray(files)||!files.length||new Set(files).size!==files.length||files.some(p=>!allowedSource(p)))throw new Error('Invalid source allowlist; review exact source files.');
 // Validate and capture every approved file before creating output. No directory
 // recursion: newly added private files cannot enter an ordinary source transfer.
 const contents=[];let total=0;
 for(const name of files){const path=join(root,name);if(await realpath(path)!==path)throw new Error('Source symlink components refused.');const info=await lstat(path);if(!info.isFile()||info.nlink!==1||info.size>1024*1024)throw new Error('Source must be regular, unlinked and bounded.');const bytes=await readFile(path);total+=bytes.length;if(total>32*1024*1024)throw new Error('Source transfer exceeds 32 MiB review bound.');contents.push([name,bytes]);}
 await privateDirectory(destination);const staging=join(destination,'source');await mkdir(staging,{mode:0o700});
 for(const [name,bytes] of contents){await mkdir(dirname(join(staging,name)),{recursive:true,mode:0o700});await exclusivePrivate(join(staging,name),bytes);}
 const list=join(destination,'files.txt');await exclusivePrivate(list,files.join('\n')+'\n');
 const archive=join(destination,'source.tar.gz');
 execFileSync('tar',['--create','--gzip','--file',archive,'--directory',staging,'--no-recursion','--verbatim-files-from','--files-from',list],{env:{PATH:'/usr/bin:/bin'},stdio:'pipe'});
 // Bundle directory stays 0700, archive is explicitly private even under a loose umask.
 const {chmod}=await import('node:fs/promises');await chmod(archive,0o600);
 const sha256=createHash('sha256').update(await readFile(archive)).digest('hex');await exclusivePrivate(join(destination,'source.tar.gz.sha256'),`${sha256}  source.tar.gz\n`);
 return {files:files.length,sha256,archive};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 if(process.getuid()===0||process.argv.length!==3)throw new Error('As the operator: node scripts/source-transfer.mjs /absolute/NEW-private-bundle');
 const root=fileURLToPath(new URL('../',import.meta.url));console.log(await packSource(root,process.argv[2]));
 console.log('Review files.txt before transferring only source.tar.gz and its checksum. No SSH connection was made.');
}
