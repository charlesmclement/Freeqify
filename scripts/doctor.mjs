/** Dependency inventory only. Does not load private configuration or contact services. */
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
let failed=false;
function check(label,fn){try{console.log(`${label}: ${fn()}`);}catch{failed=true;console.log(`${label}: unavailable; review prerequisites, do not bypass isolation.`);}}
check('Node24 / node:sqlite',()=>{if(!process.versions.node.startsWith('24.'))throw Error();require('node:sqlite');return process.version;});
for(const [name,args] of [['npm',['--version']],['bwrap',['--version']],['ffmpeg',['-version']],['tar',['--version']],['findmnt',['--version']],['systemd-analyze',['--version']]])check(name,()=>execFileSync(name,args,{encoding:'utf8',timeout:5000,stdio:['ignore','pipe','pipe']}).split('\n')[0]);
console.log('No engine binary executed or installed. Check the chosen Navidrome binary/version separately after reviewing its source. No host isolation guarantee follows from dependency availability.');
process.exitCode=failed?1:0;
