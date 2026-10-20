/** Safe preparation primitives. No shell, service activation, identity changes or music writes. */
import {access, lstat, realpath, readdir, mkdir, open, statfs} from 'node:fs/promises';
import {constants} from 'node:fs';
import {isAbsolute, resolve, relative, dirname, join, basename} from 'node:path';
import {createServer} from 'node:net';
import {readPrivateFile} from './private-files.mjs';
export const repository = new URL('../', import.meta.url).pathname.replace(/\/$/,'');
export function absolute(value) {
 if(typeof value!=='string'||!isAbsolute(value)||/[\r\n\0"'`$%\\]/u.test(value))throw new Error('Use an absolute path without quotes, controls, shell or systemd expansion characters. Spaces and Unicode are supported.');
 return resolve(value);
}
export function overlaps(a,b){return [relative(a,b),relative(b,a)].some(p=>p===''||(!p.startsWith('../')&&p!=='..'&&!isAbsolute(p)));}
export async function canonical(path){
 path=absolute(path);
 let parent=path;const tail=[];
 while(true){try{return resolve(await realpath(parent),...tail.reverse());}catch(e){if(e.code!=='ENOENT')throw e;tail.push(basename(parent));const next=dirname(parent);if(next===parent)throw e;parent=next;}}
}
export async function musicDirectory(path){
 const selected=absolute(path);const resolved=await realpath(selected);
 if(!(await lstat(resolved)).isDirectory())throw new Error('The music path must be an existing directory.');
 await access(resolved,constants.R_OK|constants.X_OK);
 // Check as the invoking engine identity. Permission ACLs, descendants and mount
 // availability are separately verified by the sandbox probe and host checklist.
 await readdir(resolved);
 return {selected,resolved,uid:process.getuid()};
}
export async function safeLayout(paths){
 const result={};for(const [key,value] of Object.entries(paths))result[key]=await canonical(value);
 const entries=Object.entries(result);
 for(const [i,[key,path]] of entries.entries()){
  if(path==='/'||overlaps(repository,path))throw new Error(`${key} must be outside the repository.`);
  for(const [otherKey,other] of entries.slice(i+1))if(overlaps(path,other))throw new Error(`${key} overlaps ${otherKey}. Choose separate locations.`);
 }
 return result;
}
async function directoryHandle(path){
 const parts=absolute(path).split('/').filter(Boolean);let handle=await open('/',constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
 try{for(const part of parts){
  const next=await open(`/proc/self/fd/${handle.fd}/${part}`,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);await handle.close();handle=next;
  const info=await handle.stat();if(![0,process.getuid()].includes(info.uid)||((info.mode&0o022)!==0&&!(info.uid===0&&(info.mode&0o1000))))throw new Error('Unsafe writable parent.');
 }return handle;}catch(error){await handle.close();throw error;}
}
export async function privateDirectory(path){
 absolute(path);const parent=await directoryHandle(dirname(path));
 try{const info=await parent.stat();if(info.uid!==process.getuid()||(info.mode&0o077)!==0)throw new Error('Choose a pre-existing owner-only (0700) parent directory.');
 await mkdir(`/proc/self/fd/${parent.fd}/${basename(path)}`,{mode:0o700});}finally{await parent.close();}
}
export async function exclusivePrivate(path,text,maxBytes=1024*1024){
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>32*1024*1024||Buffer.byteLength(text)>maxBytes)throw new Error('Private output exceeds its reviewed size bound.');
 const parent=await directoryHandle(dirname(path));
 try{const info=await parent.stat();if(info.uid!==process.getuid()||(info.mode&0o077)!==0)throw new Error('Output parent must be owner-only (0700).');
 const handle=await open(`/proc/self/fd/${parent.fd}/${basename(absolute(path))}`,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try{await handle.writeFile(text);await handle.sync();}finally{await handle.close();}
 }finally{await parent.close();}
 readPrivateFile(path,false,maxBytes);
}
export async function availablePort(port){
 if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Choose an unprivileged port from 1024 through 65535.');
 const server=createServer();await new Promise((ok,no)=>{server.once('error',()=>no(new Error(`Port ${port} is unavailable; leave existing services alone and choose another.`)));server.listen(port,'127.0.0.1',ok);});
 await new Promise((ok,no)=>server.close(e=>e?no(e):ok()));
}
export async function headroom(path,bytes){const s=await statfs(path);if(s.bavail*s.bsize<bytes)throw new Error('Insufficient free space for the requested reserve.');}
export function environment(values){return Object.entries(values).map(([k,v])=>`${k}=${JSON.stringify(String(v))}`).join('\n')+'\n';}
export function serviceUnit({role,identity,release,node,config,state,music,memory='1G',cpu='50%',tasks=64}){
 if(!['server','engine'].includes(role)||!/^fq-[a-z][a-z0-9-]{0,24}$/.test(identity))throw new Error('Use a dedicated fq- service identity.');
 for(const p of [release,node,config,state])absolute(p);
 if(!/^\d+[MG]$/.test(memory)||!/^\d{1,3}%$/.test(cpu)||!Number.isInteger(tasks)||tasks<16||tasks>512)throw new Error('Invalid service resource budget.');
 const quote=p=>'"'+p+'"';
 return `[Unit]\nDescription=Freeqify ${role} (review before installation)\nAfter=network.target\n\n[Service]\nType=simple\nUser=${identity}\nGroup=${identity}\nWorkingDirectory=${quote(release)}\nEnvironment="NODE_ENV=production"\nEnvironment="FREEQIFY_CONFIG_FILE=${config}"\nExecStart=${quote(node)} ${quote(join(release,role==='server'?'scripts/start.mjs':'scripts/navidrome.mjs'))}\nRestart=on-failure\nRestartSec=5\nTimeoutStopSec=30\nKillMode=control-group\nUMask=0077\nNoNewPrivileges=yes\nProtectSystem=strict\nProtectHome=yes\nPrivateTmp=yes\nPrivateDevices=yes\nProtectKernelTunables=yes\nProtectKernelModules=yes\nProtectControlGroups=yes\nRestrictSUIDSGID=yes\nLockPersonality=yes\nCapabilityBoundingSet=\nRestrictAddressFamilies=AF_UNIX AF_INET AF_INET6\nIPAddressDeny=any\nIPAddressAllow=localhost\nReadWritePaths=${quote(state)}\n${role==='engine'?`ReadOnlyPaths=${quote(absolute(music))}\n`:''}MemoryMax=${memory}\nCPUQuota=${cpu}\nTasksMax=${tasks}\nLimitNOFILE=1024\nStandardOutput=journal\nStandardError=journal\n\n[Install]\nWantedBy=multi-user.target\n`;
}
