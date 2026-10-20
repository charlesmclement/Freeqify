import {existsSync,realpathSync,statSync} from 'node:fs';
import {isAbsolute,resolve} from 'node:path';
export function executablePath(binary,path=process.env.PATH??''){
 const candidates=isAbsolute(binary)?[binary]:path.split(':').filter(Boolean).map(dir=>resolve(dir,binary));
 for(const item of candidates){try{const p=realpathSync(item);if(statSync(p).isFile()&&(statSync(p).mode&0o111))return p;}catch{/* Continue PATH lookup. */}}
 throw new Error('Configured engine executable was not found.');
}
/** Narrow readable tree. Shared host network is intentional for loopback service access. */
export function navidromeSandbox({binary,music,data,configFile}){
 const args=['--die-with-parent','--new-session','--unshare-user','--unshare-pid','--unshare-ipc','--unshare-uts','--dir','/engine','--dir','/etc'];
 for(const path of ['/usr','/bin','/sbin','/lib','/lib64'])if(existsSync(path))args.push('--ro-bind',realpathSync(path),path);
 for(const path of ['/etc/ld.so.cache','/etc/localtime','/etc/ssl/certs'])if(existsSync(path))args.push('--ro-bind',realpathSync(path),path);
 args.push('--dev','/dev','--proc','/proc','--tmpfs','/tmp','--ro-bind',binary,'/engine/navidrome','--ro-bind',music,'/music','--bind',data,'/state','--chdir','/state');
 if(configFile)args.push('--ro-bind',configFile,'/engine/navidrome.toml');
 args.push('--','/engine/navidrome');if(configFile)args.push('--configfile','/engine/navidrome.toml');return args;
}
