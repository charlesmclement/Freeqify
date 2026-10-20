/** Run as Freeqify config owner after creating a non-admin engine user. No HTTP calls. */
import {createInterface} from 'node:readline/promises';
import {parse} from 'dotenv';
import {hidden} from '../apps/server/dist/auth/terminal.js';
import {readPrivateFile} from './private-files.mjs';
import {absolute,exclusivePrivate,environment} from './installation.mjs';
if(process.getuid()===0||!process.stdin.isTTY||!process.stdout.isTTY||process.argv.length!==4)throw new Error('As the Freeqify owner in a real terminal: node scripts/configure-engine-credential.mjs EXISTING_SERVER_ENV NEW_SERVER_ENV. No password arguments.');
const source=absolute(process.argv[2]),destination=absolute(process.argv[3]);
const values=parse(readPrivateFile(source,false,1024*1024));
const passwordFile=absolute(values.NAVIDROME_PASSWORD_FILE);
const terminal=createInterface({input:process.stdin,output:process.stdout});
const username=await terminal.question('Existing non-administrator Navidrome service username: ');terminal.close();
if(!username||username.length>256||/[\r\n"'`$\\]/.test(username))throw new Error('Use a valid existing service username without configuration expansion characters.');
const password=await hidden('Existing engine service password (hidden): ');
const again=await hidden('Confirm password (hidden): ');
if(!password||password!==again)throw new Error('Passwords did not match; nothing written.');
await exclusivePrivate(passwordFile,password);
await exclusivePrivate(destination,environment({...values,NAVIDROME_USERNAME:username}));
console.log('New private credential and server configuration prepared. Original config unchanged. Review and install the new config deliberately before startup. If the second write failed, preserve the private password file and resolve the destination; never overwrite an existing credential silently.');
