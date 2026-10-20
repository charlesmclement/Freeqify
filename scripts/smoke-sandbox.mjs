/** Actual Bubblewrap against synthetic music/state/canaries only. */
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {navidromeSandbox,executablePath} from './sandbox.mjs';
const root=await mkdtemp('/tmp/freeqify-5c-sandbox-');
try{
 await mkdir(root+'/music');await mkdir(root+'/state');await writeFile(root+'/music/song','synthetic-original');await writeFile(root+'/private-canary','not-readable');
 const args=navidromeSandbox({binary:executablePath('/bin/sh'),music:root+'/music',data:root+'/state'});
 execFileSync('bwrap',[...args,'-c',`test "$(cat /music/song)" = synthetic-original && ! test -e '${root}/private-canary' && ! (echo denied > /music/song) 2>/dev/null && echo allowed > /state/probe`],{env:{PATH:'/usr/bin:/bin'},stdio:'pipe'});
 assert.equal(await readFile(root+'/music/song','utf8'),'synthetic-original');assert.equal((await readFile(root+'/state/probe','utf8')).trim(),'allowed');
 console.log('PASS synthetic Bubblewrap: original bytes preserved, music write denied, explicit state writable, unrelated private path absent. Actual engine and separate host UIDs remain unverified.');
}finally{await rm(root,{recursive:true,force:true});}
