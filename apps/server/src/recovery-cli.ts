import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {stdin,stdout} from 'node:process';
import {createInterface} from 'node:readline/promises';
import {hidden} from './auth/terminal.js';
import {loadEnvironment} from './environment.js';
import {readConfig} from './config.js';
import {openAuthStore} from './auth/store.js';
if(!stdin.isTTY||!stdout.isTTY||process.argv.length>2||process.getuid?.()===0){
 console.error('Run recovery interactively as the application data owner, without arguments or root.');process.exitCode=1;
}else{
 let store;
 try{
  loadEnvironment();const config=readConfig();if(!existsSync(join(config.dataDir,'freeqify.sqlite')))throw new Error('Existing database required');store=openAuthStore(config);
  const reader=createInterface({input:stdin,output:stdout});
  console.log('Local administrator recovery changes only the selected active administrator password and revokes its sessions. Preserve and back up private application data before recovery.');
  const name=(await reader.question('Existing administrator username: ')).toLowerCase();
  const confirmation=await reader.question(`Type RECOVER ${name} to confirm: `);reader.close();
  if(confirmation!==`RECOVER ${name}`)throw new Error('Recovery cancelled.');
  const password=await hidden('New password (hidden): ');const again=await hidden('Confirm new password (hidden): ');
  if(password!==again)throw new Error('Passwords did not match. No change made.');
  await store.recoverAdministrator(name,password,confirmation);console.log('Administrator password replaced; its sessions revoked. Sign in again.');
 }catch{console.error('Recovery did not complete. Check confirmation, password policy, active administrator name and private file access. No database reset is required.');process.exitCode=1;}
 finally{store?.close();}
}
